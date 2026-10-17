/**
 * Winter ground cover: GPU-instanced blades near the camera and crossed-card
 * tufts farther out, only where something shows through the snow — bleached
 * straw on the wind-scoured crests and knolls and in the needle litter under
 * dense spruce, green grass and moss in the hot spring's melt ring, lyme grass
 * on Ice Beach's dunes, a few dried seed stalks. Deterministic, chunked around
 * the camera and built in small time slices (ground.ts decides where).
 *
 * API (ctx.getFeature('grass')?.api):
 *   stats()          instance / chunk / draw counts
 *   setVisible(on)   hide or show all ground cover
 *   rebuild()        drop and rebuild every instance (e.g. after painting ground masks)
 *   settle(ms)       build everything around the camera now (screenshots, tests)
 *   settings()       current derived settings
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import { FAR_CHUNK, NEAR_CHUNK, grassSettings, type GrassSettings } from './config';
import { GroundRules, MELT_R, NoiseTex, TerrainData, VegCover, coarseRules, type Coarse, type Fine } from './ground';
import { SPRING } from '../../world/layout';
import { makeBladeMaterial, makeFieldUniforms } from './shaders';
import { BLADE_LOD0_LEVELS, BLADE_LOD1_LEVELS, CLUMP_BLADES, bladeGeometry, tuftGeometry } from './blades';
import { ChunkLayer, type LayerParams } from './field';

export interface GrassApi {
  stats(): Record<string, unknown>;
  setVisible(on: boolean): void;
  rebuild(): void;
  /** build everything around the current camera now, within budgetMs (screenshots, tests); returns ms spent */
  settle(budgetMs?: number): number;
  settings(): GrassSettings;
  /** debug: the coarse and fine ground rules at a point */
  probe(x: number, z: number): { coarse: Coarse; fine: Fine; h: number };
}

function nearParams(s: GrassSettings): LayerParams {
  return {
    density: s.bladeDensity,
    r0: s.lodR0,
    pow: s.lodPow,
    fadeInStart: 0,
    fadeInEnd: 0,
    fadeOutStart: s.nearFadeStart,
    fadeOutEnd: s.nearFadeEnd,
    maxDist: s.nearFadeEnd + 1,
    minDist: 0,
    lodDist: 16,
    heightStep: s.heightStep,
  };
}

function farParams(s: GrassSettings): LayerParams {
  return {
    density: s.tuftDensity,
    r0: s.tuftR0,
    pow: 1.6,
    fadeInStart: s.nearFadeStart,
    fadeInEnd: s.nearFadeEnd,
    fadeOutStart: Infinity,
    fadeOutEnd: Infinity,
    maxDist: s.farFadeEnd + 1,
    minDist: s.nearFadeStart - 1,
    lodDist: Infinity,
    heightStep: s.heightStep,
  };
}

interface TerrainApiShape {
  uniforms?: {
    tVegTex?: { value?: THREE.Texture };
    tVegInfo?: { value?: THREE.Vector4 };
    tDataTex?: { value?: THREE.Texture };
    tCoarseInfo?: { value?: THREE.Vector4 };
  };
}

/** A DataTexture with CPU-side RGBA data, or null. */
function cpuTexture(t: THREE.Texture | undefined): THREE.DataTexture | null {
  const img = t?.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  if (!img?.data || !img.width || !img.height || img.data.length < img.width * img.height * 4) return null;
  return t as THREE.DataTexture;
}

const create: FeatureFactory = (ctx) => {
  const root = new THREE.Group();
  root.name = 'grass';
  const { world, camera, renderer } = ctx;

  let settings = grassSettings(ctx.quality);
  const tu = (ctx.getFeature('terrain')?.api as TerrainApiShape | undefined)?.uniforms;
  const vegTex = cpuTexture(tu?.tVegTex?.value);
  const dataTex = cpuTexture(tu?.tDataTex?.value);
  const field = makeFieldUniforms(ctx.shared, ctx.materials.noise, world);
  const noiseImg = ctx.materials.noise.image as { data?: ArrayLike<number>; width?: number } | undefined;
  const vegCover = vegTex && tu?.tVegInfo?.value ? new VegCover(vegTex, tu.tVegInfo.value) : null;
  const noiseTex = noiseImg?.data && noiseImg.width ? new NoiseTex(ctx.materials.noise) : null;
  const terrainData = dataTex && tu?.tCoarseInfo?.value ? new TerrainData(dataTex, tu.tCoarseInfo.value) : null;
  const rules = new GroundRules(world, vegCover, noiseTex, terrainData, 'none');
  // the melt ring is small and it is the point of the hot spring view: its own layer, full detail from afar
  const ringRules = new GroundRules(world, vegCover, noiseTex, terrainData, 'only');

  const nearLod = { value: new THREE.Vector4() };
  const nearFade = { value: new THREE.Vector4() };
  const farLod = { value: new THREE.Vector4() };
  const farFade = { value: new THREE.Vector4() };
  const bladeMat = makeBladeMaterial(field, { tuft: false, lod: nearLod, fade: nearFade });
  const tuftMat = makeBladeMaterial(field, { tuft: true, lod: farLod, fade: farFade });

  const near = new ChunkLayer(
    {
      name: 'grass-blades',
      size: NEAR_CHUNK,
      sub: 4,
      gridStep: 2,
      tuft: false,
      material: bladeMat,
      templates: [bladeGeometry(BLADE_LOD0_LEVELS, CLUMP_BLADES), bladeGeometry(BLADE_LOD1_LEVELS, CLUMP_BLADES)],
      layerSeed: 1,
    },
    world,
    rules,
    nearParams(settings),
  );
  const far = new ChunkLayer(
    {
      name: 'grass-tufts',
      size: FAR_CHUNK,
      sub: 4,
      gridStep: 4,
      tuft: true,
      material: tuftMat,
      templates: [tuftGeometry(3)],
      layerSeed: 2,
    },
    world,
    rules,
    farParams(settings),
  );
  const ringLod = { value: new THREE.Vector4() };
  const ringFade = { value: new THREE.Vector4() };
  const ringMat = makeBladeMaterial(field, { tuft: false, lod: ringLod, fade: ringFade });
  const ringParams = (s: GrassSettings): LayerParams => ({
    density: 22 + 10 * Math.min(1, s.bladeDensity / 32),
    r0: 30,
    pow: 1.4,
    fadeInStart: 0,
    fadeInEnd: 0,
    fadeOutStart: 140,
    fadeOutEnd: 190,
    maxDist: 191,
    minDist: 0,
    lodDist: 12,
    heightStep: s.heightStep,
  });
  const ring = new ChunkLayer(
    {
      name: 'grass-melt-ring',
      size: NEAR_CHUNK,
      sub: 4,
      gridStep: 1,
      tuft: false,
      material: ringMat,
      templates: [bladeGeometry(BLADE_LOD0_LEVELS, CLUMP_BLADES), bladeGeometry(BLADE_LOD1_LEVELS, CLUMP_BLADES)],
      layerSeed: 3,
      region: { x: SPRING.x, z: SPRING.z, r: MELT_R * 1.15 + 1 },
    },
    world,
    ringRules,
    ringParams(settings),
  );
  root.add(near.group, far.group, ring.group);

  const applyUniforms = () => {
    const s = settings;
    nearLod.value.set(s.lodR0, s.lodPow, 0, 1);
    nearFade.value.set(s.nearFadeStart, s.nearFadeEnd, s.widthScale, 0.75);
    farLod.value.set(s.tuftR0, 1.6, s.nearFadeStart, s.nearFadeEnd);
    farFade.value.set(s.farFadeStart, s.farFadeEnd, s.widthScale, 0.85);
    ringLod.value.set(30, 1.4, 0, 1);
    // broad blades: a lush, closed sward rather than single stalks
    ringFade.value.set(140, 190, 2.4, 0.75);
    field.uTerrainShadow.value = s.terrainShadow ? 1 : 0;
  };
  applyUniforms();

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const bufSize = new THREE.Vector2();

  const syncCamera = () => {
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    camera.getWorldPosition(camPos);
    renderer.getDrawingBufferSize(bufSize);
    field.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) / Math.max(1, bufSize.y / camera.zoom);
  };

  /** Build what the camera sees synchronously (load, quality change), the rest in slices. */
  const buildNow = (budgetMs: number) => {
    syncCamera();
    const t0 = performance.now();
    const deadline = t0 + budgetMs;
    near.update(camPos, frustum, deadline, true);
    ring.update(camPos, frustum, deadline, true);
    far.update(camPos, frustum, deadline, true);
    return performance.now() - t0;
  };

  const initMs = buildNow(ctx.params.shot ? 2500 : 600);
  const initStats = { ms: Math.round(initMs), near: near.stats(), far: far.stats() };

  const offQuality = ctx.events.on('quality-changed', () => {
    settings = grassSettings(ctx.quality);
    applyUniforms();
    near.setParams(nearParams(settings));
    far.setParams(farParams(settings));
    ring.setParams(ringParams(settings));
    buildNow(300);
  });

  let visible = true;
  const api: GrassApi = {
    stats: () => {
      syncCamera();
      const n = near.drawStats(frustum);
      const f = far.drawStats(frustum);
      const r = ring.drawStats(frustum);
      const draw = { calls: n.calls + f.calls + r.calls, triangles: n.triangles + f.triangles + r.triangles, near: n, far: f, ring: r };
      return {
        draw,
        initial: initStats,
        near: near.stats(),
        far: far.stats(),
        ring: ring.stats(),
        settings,
        rules: { veg: !!rules.veg, noise: !!rules.noise, terrain: !!rules.terrain },
      };
    },
    setVisible(on: boolean) {
      visible = on;
      near.group.visible = far.group.visible = ring.group.visible = on;
    },
    rebuild() {
      near.setParams(nearParams(settings));
      far.setParams(farParams(settings));
      ring.setParams(ringParams(settings));
    },
    settle(budgetMs = 3000) {
      syncCamera();
      const t0 = performance.now();
      const deadline = t0 + budgetMs;
      near.update(camPos, frustum, deadline);
      ring.update(camPos, frustum, deadline);
      far.update(camPos, frustum, deadline);
      return performance.now() - t0;
    },
    settings: () => settings,
    probe(x: number, z: number) {
      const h = world.heightAt(x, z);
      const coarse: Coarse = { density: 0, height: 0, dry: 0, lyme: 0, moss: 0 };
      const fine: Fine = { density: 0, height: 0 };
      coarseRules(rules, x, z, h, 0, coarse);
      if (coarse.density <= 0) coarseRules(ringRules, x, z, h, 0, coarse);
      rules.fine(x, z, fine);
      return { coarse, fine, h };
    },
  };

  return {
    id: 'grass',
    object: root,
    api,
    update() {
      if (!visible) return;
      syncCamera();
      const deadline = performance.now() + settings.budgetMs;
      near.update(camPos, frustum, deadline);
      ring.update(camPos, frustum, deadline);
      far.update(camPos, frustum, deadline);
    },
    dispose() {
      offQuality();
      near.dispose();
      far.dispose();
      ring.dispose();
      ringMat.dispose();
      bladeMat.dispose();
      tuftMat.dispose();
    },
  };
};

export default create;
