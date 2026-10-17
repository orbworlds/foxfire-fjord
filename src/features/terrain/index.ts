import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import { bakeTerrain } from './bake';
import { createPatchGeometry, LodSelector } from './cdlod';
import { terrainConfig, type TerrainConfig } from './config';
import { FineWindow } from './fine-window';
import { bindTerrainConfig, createTerrainMaterial, createTerrainUniforms } from './material';
import { createRocks, rockDensity } from './rocks';
import { SNOW_COLOR_GLSL, TERRAIN_SHADOW_GLSL } from './shaders';
import { bakeVegetation } from './veg';

/**
 * The island's land: a CDLOD quadtree drawn as two instanced patch meshes
 * (full nodes + half-resolution quarters), displaced on the GPU from the baked
 * world grid and, near the camera, from an exact `heightAt` window streamed by
 * workers. The shading (snow, gneiss faces, Mirror Lake's ice, the sea shore,
 * Ice Beach, trails) patches MeshStandardMaterial so shadows, fog and IBL stay
 * intact. Snow-capped gneiss boulders are two more instanced meshes (near / far).
 */
const create: FeatureFactory = async (ctx) => {
  const root = new THREE.Group();
  root.name = 'terrain';
  const camera = ctx.camera;

  let cfg: TerrainConfig = terrainConfig(ctx.quality);
  const bake = bakeTerrain(ctx.world, cfg, ctx.renderer);
  const veg = bakeVegetation(bake);
  const uniforms = createTerrainUniforms(ctx, bake, veg);

  let fine = new FineWindow(ctx.renderer, cfg);
  bindTerrainConfig(uniforms, cfg, fine);
  let material = createTerrainMaterial(uniforms, cfg);
  let selector = new LodSelector(cfg, bake);

  const meshFull = new THREE.Mesh(createPatchGeometry(cfg.gridN, cfg.maxNodes), material);
  const meshQuarter = new THREE.Mesh(createPatchGeometry(cfg.gridN / 2, cfg.maxNodes), material);
  for (const m of [meshFull, meshQuarter]) {
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    root.add(m);
  }
  meshFull.name = 'terrain-patches';
  meshQuarter.name = 'terrain-quarters';

  let rocks = createRocks(ctx, bake, uniforms, cfg.tier);
  root.add(rocks.object);

  const groundAlt = () => camera.position.y - bake.coarseHeight(camera.position.x, camera.position.z);
  const wantFine = () => groundAlt() < 360;

  const upload = (mesh: THREE.Mesh, data: Float32Array, n: number) => {
    const geo = mesh.geometry as THREE.InstancedBufferGeometry;
    const attr = geo.getAttribute('aNode') as THREE.InstancedBufferAttribute;
    const arr = attr.array as Float32Array;
    const len = n * 4;
    let same = n === geo.instanceCount;
    if (same) {
      for (let i = 0; i < len; i++) {
        if (arr[i] !== data[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      for (let i = 0; i < len; i++) arr[i] = data[i];
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(len, 4));
      attr.needsUpdate = true;
    }
    geo.instanceCount = n;
    mesh.visible = n > 0;
  };

  const refresh = (dt: number) => {
    camera.updateMatrixWorld();
    uniforms.tLodCam.value.copy(camera.position);
    fine.update(camera.position, wantFine(), dt);
    selector.select(camera, camera.position);
    upload(meshFull, selector.full, selector.nFull);
    upload(meshQuarter, selector.quarter, selector.nQuarter);
    rocks.update(camera);
  };

  const rebuild = () => {
    const next = terrainConfig(ctx.quality);
    if (next.gridN === cfg.gridN && next.fineN === cfg.fineN && next.tier === cfg.tier) return;
    cfg = next;
    fine.dispose();
    fine = new FineWindow(ctx.renderer, cfg);
    bindTerrainConfig(uniforms, cfg, fine);
    material.dispose();
    material = createTerrainMaterial(uniforms, cfg);
    selector = new LodSelector(cfg, bake);
    meshFull.geometry.dispose();
    meshQuarter.geometry.dispose();
    meshFull.geometry = createPatchGeometry(cfg.gridN, cfg.maxNodes);
    meshQuarter.geometry = createPatchGeometry(cfg.gridN / 2, cfg.maxNodes);
    meshFull.material = material;
    meshQuarter.material = material;
    if (rocks.density !== rockDensity(ctx.quality)) {
      root.remove(rocks.object);
      rocks.dispose();
      rocks = createRocks(ctx, bake, uniforms, cfg.tier);
      root.add(rocks.object);
    }
    refresh(0);
  };
  const offQuality = ctx.events.on('quality-changed', rebuild);

  // stream the exact heights around a ground-level start camera before the first frame
  if (wantFine()) await fine.prime(camera.position, cfg.range0 * 0.8, ctx.params.shot ? 60000 : 5000);
  refresh(0);

  return {
    id: 'terrain',
    object: root,
    update(dt) {
      refresh(dt);
    },
    dispose() {
      offQuality();
      fine.dispose();
      material.dispose();
      meshFull.geometry.dispose();
      meshQuarter.geometry.dispose();
      rocks.dispose();
      veg.tex.dispose();
      bake.coarseTex.dispose();
      bake.dataTex.dispose();
      bake.shadowTex.dispose();
    },
    api: {
      /** uniforms of the terrain shader (height/normal/mask textures, LOD camera) */
      uniforms,
      /**
       * Vegetation cover texture (R tree cover, G dwarf scrub, B clearing, A birch share)
       * sampled at uv = (xz - vegInfo.xy) * vegInfo.zw; the boreal treeline the flora
       * scatter should follow.
       */
      vegTexture: veg.tex,
      vegInfo: veg.info,
      /**
       * GLSL `float terrainSunShadow(vec3 worldPos, vec3 lightDir)` — terrain-scale
       * cast shadow for a low sun/moon. Needs uniforms `tShadowH`, `tWorldInfo` and
       * `#define TSAT(x) clamp(x, 0.0, 1.0)`.
       */
      sunShadowGLSL: TERRAIN_SHADOW_GLSL,
      /**
       * GLSL (vertex- or fragment-safe): terrain palette, the snow wind frame `T_WIND` and
       * `vec3 tSnowColorAt(vec2 xz, float dist)`, the albedo of open snow as the terrain
       * draws it, for things that sit in the snow to match it. Declares
       * `uniform sampler2D tNoise` (bind `uniforms.tNoise`).
       */
      snowGLSL: SNOW_COLOR_GLSL,
      stats() {
        const tFull = selector.nFull * (cfg.gridN * cfg.gridN * 2 + cfg.gridN * 8);
        const h = cfg.gridN / 2;
        const tQuarter = selector.nQuarter * (h * h * 2 + h * 8);
        return {
          nodes: selector.nFull,
          quarters: selector.nQuarter,
          overflow: selector.overflow,
          triangles: tFull + tQuarter,
          fine: fine.stats(),
          rocks: rocks.stats(),
          altitude: groundAlt(),
        };
      },
    },
  };
};

export default create;
