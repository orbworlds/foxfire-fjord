/**
 * Terrain material: MeshStandardMaterial patched in onBeforeCompile so three's
 * lights, shadows, fog and image-based lighting stay intact. The vertex stage
 * displaces CDLOD patches from the baked grid and the exact fine window; the
 * fragment stage runs `terrainShade` (snow, gneiss, ice, shore, paths) and adds
 * the winter light: terrain-scale shadows from the low sun or moon, sparkle and
 * translucency in the snow, blue sky-lit shadows, the aurora's green wash and a
 * sharp sky mirror on the polished lake ice.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { BEACH, LAKE, RINK, SPRING } from '../../world/layout';
import type { TerrainBake } from './bake';
import { DEEP_FLOOR, OUTSIDE_FADE, bakeLakeSkyline } from './bake';
import type { TerrainConfig } from './config';
import type { FineWindow } from './fine-window';
import { SHADE_COMMON_GLSL, SNOW_LIGHT_GLSL, TERRAIN_HEIGHT_GLSL, TERRAIN_SHADE_GLSL, TERRAIN_SHADOW_GLSL } from './shaders';
import type { VegMask } from './veg';

export interface TerrainUniforms {
  [name: string]: THREE.IUniform;
  tCoarseTex: THREE.IUniform<THREE.Texture>;
  tDataTex: THREE.IUniform<THREE.Texture>;
  tFineHTex: THREE.IUniform<THREE.Texture>;
  tFineNTex: THREE.IUniform<THREE.Texture>;
  tTileTex: THREE.IUniform<THREE.Texture>;
  tNoise: THREE.IUniform<THREE.Texture>;
  tLocalTex: THREE.IUniform<THREE.Texture>;
  tTrailTex: THREE.IUniform<THREE.Texture>;
  tShadowH: THREE.IUniform<THREE.Texture>;
  tCoarseInfo: THREE.IUniform<THREE.Vector4>;
  tCoarseSize: THREE.IUniform<THREE.Vector2>;
  tDeep: THREE.IUniform<THREE.Vector2>;
  tFine: THREE.IUniform<THREE.Vector4>;
  tFineOff: THREE.IUniform<number>;
  tFineFade: THREE.IUniform<THREE.Vector2>;
  tLodCam: THREE.IUniform<THREE.Vector3>;
  tLod: THREE.IUniform<THREE.Vector4>;
  tLocalInfo: THREE.IUniform<THREE.Vector4>;
  tWorldInfo: THREE.IUniform<THREE.Vector4>;
  tVegTex: THREE.IUniform<THREE.Texture>;
  tVegInfo: THREE.IUniform<THREE.Vector4>;
  /** Mirror Lake: centre xz, ice level, unused */
  tLake: THREE.IUniform<THREE.Vector4>;
  /** Mirror Lake half axes, rotation, and the rink's rotation */
  tLakeR: THREE.IUniform<THREE.Vector4>;
  /** skating rink: centre xz, half axes */
  tRink: THREE.IUniform<THREE.Vector4>;
  /** hot spring melt ring: centre xz, radius, ground level */
  tSpring: THREE.IUniform<THREE.Vector4>;
  /** Ice Beach black sand: centre xz, radius, top of the beach */
  tBeach: THREE.IUniform<THREE.Vector4>;
  /** the skyline seen from Mirror Lake (tan of elevation by azimuth), mirrored in the ice */
  tLakeSky: THREE.IUniform<THREE.Texture>;
}

export function createTerrainUniforms(ctx: FeatureContext, bake: TerrainBake, veg: VegMask): TerrainUniforms {
  const w = ctx.world;
  const lb = w.localBounds;
  const wb = w.bounds;
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  const s = ctx.shared;
  return {
    tCoarseTex: { value: bake.coarseTex },
    tDataTex: { value: bake.dataTex },
    tFineHTex: { value: blank },
    tFineNTex: { value: blank },
    tTileTex: { value: blank },
    tNoise: { value: ctx.materials.noise },
    tLocalTex: { value: w.masks.localTexture },
    tTrailTex: { value: w.masks.trailTexture },
    tShadowH: { value: bake.shadowTex },
    tCoarseInfo: { value: new THREE.Vector4(bake.minX, bake.minZ, 1 / bake.stepX, 1 / bake.stepZ) },
    tCoarseSize: { value: new THREE.Vector2(bake.nx, bake.nz) },
    tDeep: { value: new THREE.Vector2(DEEP_FLOOR, OUTSIDE_FADE) },
    tFine: { value: new THREE.Vector4(1, 1, 1, 1) },
    tFineOff: { value: 0 },
    tFineFade: { value: new THREE.Vector2(-2, -1) },
    tLodCam: { value: new THREE.Vector3() },
    tLod: { value: new THREE.Vector4(1, 100, 0.7, 1.5) },
    tLocalInfo: { value: new THREE.Vector4(lb.minX, lb.minZ, 1 / (lb.maxX - lb.minX), 1 / (lb.maxZ - lb.minZ)) },
    tWorldInfo: { value: new THREE.Vector4(wb.minX, wb.minZ, 1 / (wb.maxX - wb.minX), 1 / (wb.maxZ - wb.minZ)) },
    tVegTex: { value: veg.tex },
    tVegInfo: { value: veg.info },
    tLake: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.y, 0) },
    tLakeR: { value: new THREE.Vector4(LAKE.rx, LAKE.rz, LAKE.rot, RINK.rot) },
    tRink: { value: new THREE.Vector4(RINK.x, RINK.z, RINK.rx, RINK.rz) },
    tSpring: { value: new THREE.Vector4(SPRING.x, SPRING.z, 9.5, SPRING.y) },
    tBeach: { value: new THREE.Vector4(BEACH.center.x, BEACH.center.z, BEACH.halfLength * 1.25, 3.2) },
    tLakeSky: { value: bakeLakeSkyline(bake) },
    tLightDir: s.uLightDir,
    tSunDir: s.uSunDir,
    tSkyCube: s.uSkyCube,
    tAuroraFill: s.uAuroraFill,
    tHorizon: s.uHorizonColor,
    tDay: s.uDay,
    tLightColor: s.uLightColor,
    tSkyColor: s.uSkyColor,
    tAuroraLight: s.uAuroraLight,
  };
}

/** Point the uniforms at a (re)built fine window and LOD configuration. */
export function bindTerrainConfig(u: TerrainUniforms, cfg: TerrainConfig, fine: FineWindow): void {
  u.tFineHTex.value = fine.heightTex;
  u.tFineNTex.value = fine.normalTex;
  u.tTileTex.value = fine.tileTex;
  u.tFine.value.set(fine.s, 1 / fine.s, fine.N, fine.B);
  u.tFineOff.value = fine.off;
  // fade fine → coarse inside the guaranteed window coverage around the camera
  const cover = (fine.T / 2 - 1) * fine.B * fine.s;
  u.tFineFade.value.set(cover * 0.56, cover * 0.94);
  u.tLod.value.set(cfg.nodeSize0 / cfg.gridN, cfg.range0, cfg.morphStart, 1.5);
}

/** Directional-light loop with the terrain shadow and the snow light hook spliced in. */
function patchedLightLoop(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const key = 'getDirectionalLightInfo( directionalLight, directLight );';
  const i0 = chunk.indexOf(key);
  const i1 = chunk.indexOf('RE_Direct(', i0);
  const i2 = chunk.indexOf(';', i1) + 1;
  if (i0 < 0 || i1 < 0) throw new Error('terrain: unexpected lights_fragment_begin chunk');
  return (
    chunk.slice(0, i0) +
    `${key}\n\t\tdirectLight.color *= tTerrainShadow;` +
    chunk.slice(i0 + key.length, i2) +
    '\n\t\ttSnowLight( directLight, geometryNormal, geometryViewDir, reflectedLight );' +
    chunk.slice(i2)
  );
}

export function createTerrainMaterial(u: TerrainUniforms, cfg: TerrainConfig): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name: 'terrain', roughness: 0.9, metalness: 0 });
  mat.defines = { ...mat.defines, TERRAIN_TIER: cfg.tier };
  const lightLoop = patchedLightLoop();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_HEIGHT_GLSL}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        float tLevel = aNode.w;
        float tSpacing = tLod.x * exp2(tLevel);
        vec2 tG = position.xz;
        vec2 tP = aNode.xy + tG * tSpacing;
        float tEnd = tLod.y * exp2(tLevel);
        float tStart = tEnd * (tLevel < 0.5 ? tLod.z : 0.5 + 0.5 * tLod.z);
        float tDist = distance(vec3(tP.x, tCoarseH(tP), tP.y), tLodCam);
        float tK = clamp((tDist - tStart) / (tEnd - tStart), 0.0, 1.0);
        tP -= fract(tG * 0.5) * 2.0 * tK * tSpacing;
        float tWf;
        float tH = tHeight(tP, tWf);
        vec3 objectNormal = tNormalAt(tP, tWf);
        vTPos = vec3(tP.x, tH, tP.y);
        vTFine = tWf;
        // skirts hang below the edge but shade like the edge itself
        if (position.y > 0.5) tH -= tLod.w + tSpacing;
        vec3 tPos = vec3(tP.x, tH, tP.y);
        `,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = tPos;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${SHADE_COMMON_GLSL}\n${TERRAIN_SHADE_GLSL}\n${TERRAIN_SHADOW_GLSL}\nuniform samplerCube tSkyCube;\nuniform sampler2D tLakeSky;\nuniform vec3 tAuroraFill;\nuniform vec3 tHorizon;\nuniform vec3 tLightColor;\nuniform vec3 tSkyColor;\nuniform vec3 tAuroraLight;\nuniform float tDay;\n${SNOW_LIGHT_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 tAlb; float tRgh; vec3 tN; float tAO;
        terrainShade(vTPos, vTFine, tAlb, tRgh, tN, tAO);
        diffuseColor.rgb = tAlb;
        #if TERRAIN_TIER > 0
          tTerrainShadow = terrainSunShadow(vTPos, tLightDir);
        #endif
        `,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRgh;')
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);\nnonPerturbedNormal = normal;',
      )
      .replace('#include <lights_fragment_begin>', lightLoop)
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `
        // sky-lit snow is blue; the aurora washes it green between environment refreshes
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.84, 0.94, 1.14), tSnowW * 0.55);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * tAuroraFill * (0.5 + 0.5 * tN.y) * (0.35 + 0.65 * tSnowW) * RECIPROCAL_PI;
        reflectedLight.indirectDiffuse *= tAO;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          reflectedLight.indirectSpecular *= computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), tAO, material.roughness);
        #endif
        if (tIceW > 0.0) {
          // polished ice: a sharp mirror of the sky (and the aurora); the mountains darken it low down
          vec3 tVw = normalize(vTPos - cameraPosition);
          vec3 tRw = reflect(tVw, tN);
          tRw.y = max(tRw.y, 0.0);
          vec3 tSky = textureCube(tSkyCube, tRw).rgb;
          // the mountains round the lake mirrored under the sky: their baked skyline, lit roughly
          // like snowy faces under the key light, the sky and the aurora (paler toward the summits)
          float tAz = atan(tRw.x, -tRw.z);
          float tHz = texture(tLakeSky, vec2(tAz * 0.15915 + 0.5, 0.5)).r;
          float tEl = tRw.y / max(length(tRw.xz), 1e-4);
          float tEw = fwidth(tEl) + 0.002;
          float tIn = 1.0 - smoothstep(tHz - tEw, tHz + tEw, tEl);
          float tFrac = TSAT(tEl / max(tHz, 1e-3));
          float tStreak = texture(tNoise, vec2(tAz * 9.0, tEl * 7.0)).g;
          // dark rock ribs and couloir walls running down the faces, more of them high up
          float tRib = smoothstep(0.56, 0.72, texture(tNoise, vec2(tAz * 6.0, tEl * 1.2 + 0.37)).r) * smoothstep(0.25, 0.7, tFrac);
          // snow faces turned to the low sun (the Teeth's south walls) under the sky and the aurora
          vec3 tMtn = (tLightColor * 0.95 + tSkyColor * 2.2 + tAuroraLight * 0.9) * 0.85 * RECIPROCAL_PI;
          tMtn *= (0.65 + 0.4 * tFrac) * (0.85 + 0.3 * tStreak) * (1.0 - 0.6 * tRib);
          tSky = mix(tSky, tMtn, tIn);
          float tNv = saturate(dot(tN, -tVw));
          float tFr = 0.02 + 0.98 * pow(1.0 - tNv, 5.0);
          reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, tSky * tFr * tAO, tIceW);
        }
        `,
      );
  };
  mat.customProgramCacheKey = () => `fox-terrain-${cfg.tier}`;
  return mat;
}
