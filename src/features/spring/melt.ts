/**
 * The melt ring: the warm pool and its steam keep a band of the shelf bare.
 * Close to the rocks the ground is wet gravel and black moss, further out
 * matted, straw-coloured grass with green cushions of moss, then rotten,
 * slushy snow in islands until the ordinary snow takes over along a ragged
 * edge. A decal laid on the terrain as drawn (so it never floats or sinks),
 * alpha-blended, lit like the ground.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { drawnSurface } from '../fox/prints';
import { terrainConfig } from '../terrain/config';
import { GROUND_Y, meltReach, outlinePoint } from './layout';

export function buildMelt(ctx: FeatureContext): THREE.Mesh {
  const surf = drawnSurface(terrainConfig(ctx.quality).fineSpacing);
  const segs = 144;
  const rings = 12;
  const pos: number[] = [];
  const melt: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const phi = (i / segs) * Math.PI * 2;
    // reach of the melt beyond the outline: lobed and uneven
    const reach = meltReach(phi);
    for (let j = 0; j <= rings; j++) {
      const k = j / rings;
      const grow = -0.35 + (reach + 0.35) * Math.pow(k, 1.2);
      const p = outlinePoint(phi, grow);
      const h = surf(p.x, p.z);
      // nothing over the brink: the ring stops where the shelf falls away
      const onShelf = THREE.MathUtils.smoothstep(h, GROUND_Y - 0.6, GROUND_Y - 0.15);
      pos.push(p.x, h + 0.012, p.z);
      melt.push((1 - THREE.MathUtils.smoothstep(k, 0.3, 1.0)) * onShelf);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * (rings + 1) + j;
      const b = a + 1;
      const c = a + rings + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aMelt', new THREE.Float32BufferAttribute(melt, 1));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    name: 'springMelt',
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  const uniforms = { uNoise: { value: ctx.materials.noise } };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMelt;\nvarying float vMelt;\nvarying vec2 vMeltXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMelt = aMelt;\nvMeltXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nvarying float vMelt;\nvarying vec2 vMeltXZ;\nfloat mWet = 0.0;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec2 p = vMeltXZ;
  float n1 = texture2D(uNoise, p * 0.23).r;
  float n2 = texture2D(uNoise, p * 0.9 + 0.37).g;
  float n3 = texture2D(uNoise, p * 3.7 + 0.71).b;
  float n4 = texture2D(uNoise, p * 5.3 + 0.13).a;
  // a ragged edge with islands of snow left in the bare ground
  float m = vMelt + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.25;
  float bare = smoothstep(0.18, 0.42, m);
  // wet next to the water, drying outward
  mWet = smoothstep(0.55, 0.95, vMelt + (n2 - 0.5) * 0.2);
  vec3 gravel = vec3(0.2, 0.19, 0.18) * (0.85 + 0.3 * n4);
  vec3 earth = vec3(0.12, 0.095, 0.07);
  vec3 straw = vec3(0.44, 0.37, 0.24) * (0.75 + 0.4 * n3);
  vec3 moss = vec3(0.17, 0.23, 0.1) * (0.88 + 0.24 * n4);
  vec3 c = mix(straw, earth, smoothstep(0.35, 0.75, n3) * 0.6);
  c = mix(c, moss, smoothstep(0.48, 0.78, n2) * 0.8);
  c = mix(c, gravel, mWet * smoothstep(0.35, 0.6, n1 + 0.15));
  c *= mix(1.0, 0.7, mWet);
  // rotten, greyed slush where the snow is going
  float slush = smoothstep(0.32, 0.18, m) * smoothstep(0.0, 0.12, m);
  c = mix(c, vec3(0.72, 0.76, 0.8) * (0.9 + 0.15 * n4), slush * 0.75);
  diffuseColor.rgb = c;
  diffuseColor.a = smoothstep(0.0, 0.2, m);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.6, mWet);`,
      );
  };
  mat.customProgramCacheKey = () => 'fox-springMelt-v2';
  mat.userData.snow = 0;
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'spring-melt';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.snow = 0;
  mesh.userData.shelter = false;
  mesh.userData.noMerge = true;
  mesh.raycast = () => {};
  return mesh;
}
