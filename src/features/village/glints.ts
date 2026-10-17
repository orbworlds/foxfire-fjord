/**
 * Reflections of Lysvik's lights in the open harbour water: each lamp, lit
 * window and masthead light near the berth or the channel throws a long,
 * broken streak across the ripples toward the viewer, the way harbour lights
 * do on a calm night. One draw; every streak is laid out in the vertex
 * shader from the camera position (where the reflection of a light of
 * height h falls between it and an eye of height e), switched by the same
 * schedules as the lights, and masked to the water the boats keep open.
 */
import * as THREE from 'three';
import { LIT_GLSL } from './materials';
import type { LightSpec } from './kit';
import { VILLAGE } from '../../world/layout';

export function buildGlints(lights: LightSpec[], open: (x: number, z: number) => number, shared: { uNight: THREE.IUniform; uSunDir: THREE.IUniform; uTime: THREE.IUniform }, uClock: { value: number }): THREE.Mesh | null {
  // lights high enough over the water and near enough to it
  const near = lights.filter((l) => l.y > 1.2 && open(l.x, l.z) < 30);
  if (!near.length) return null;
  const n = near.length;
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const light = new Float32Array(n * 4 * 3);
  const glow = new Float32Array(n * 4 * 4);
  const kind = new Float32Array(n * 4 * 4);
  const col = new Float32Array(n * 4 * 3);
  const idx: number[] = [];
  near.forEach((l, i) => {
    const cs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    cs.forEach(([a, b], j) => {
      const k = i * 4 + j;
      pos.set([l.x, 0, l.z], k * 3);
      corner.set([a, b], k * 2);
      light.set([l.x, l.y, l.z], k * 3);
      glow.set(l.glow, k * 4);
      kind.set([0, l.sched, l.size, 0], k * 4);
      col.set(l.color, k * 3);
    });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aLight', new THREE.BufferAttribute(light, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  // the streaks move with the camera: a generous bound around the harbour
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(VILLAGE.harbor.x, 0, VILLAGE.harbor.z + 40), 260);
  const q = VILLAGE.quay;
  const mat = new THREE.ShaderMaterial({
    name: 'village-glints',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBerth: { value: new THREE.Vector4(q.minX + 6, q.maxX - 6, q.minZ - 24, q.minZ + 5) },
        uChannel: { value: new THREE.Vector3(VILLAGE.harbor.x, VILLAGE.harbor.z, 22) },
      },
    ]),
    vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 aCorner;
attribute vec3 aLight;
attribute vec4 aGlow;
attribute vec4 aKind;
attribute vec3 aColor;
varying vec3 vCol;
varying vec2 vC;
varying vec2 vXZ;
varying float vLen;
${LIT_GLSL}
void main() {
  vec2 toCam = cameraPosition.xz - aLight.xz;
  float D = max(length(toCam), 1.0);
  vec2 d = toCam / D;
  float hL = max(aLight.y, 0.5);
  float hC = max(cameraPosition.y, 0.5);
  // the mirror point between the light and the eye, smeared along the line by the ripples
  float sMid = D * hL / (hL + hC);
  float len = clamp(sMid * 0.85 + 2.0, 2.5, 46.0);
  float width = 0.18 + aKind.z * 0.35 + 0.0025 * D;
  vec2 p = aLight.xz + d * (sMid + aCorner.y * len * 0.5) + vec2(-d.y, d.x) * aCorner.x * width;
  vec4 wp = vec4(p.x, 0.04, p.y, 1.0);
  vXZ = wp.xz;
  vC = aCorner;
  vLen = len;
  float lit = villageLit(aGlow, aKind.y);
  vCol = aColor * lit;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec4 uBerth;
uniform vec3 uChannel;
uniform float uTime;
varying vec3 vCol;
varying vec2 vC;
varying vec2 vXZ;
varying float vLen;
void main() {
  if (vCol.r + vCol.g + vCol.b < 1e-4) discard;
  // open water: the berth along the quay and the channel out of the basin
  float berth = max(max(uBerth.x - vXZ.x, vXZ.x - uBerth.y), max(uBerth.z - vXZ.y, vXZ.y - uBerth.w));
  float cx = uChannel.x - max(0.0, uChannel.y - vXZ.y) * 0.25;
  float channel = max(abs(vXZ.x - cx) - uChannel.z, max(uChannel.y - 190.0 - vXZ.y, vXZ.y - uBerth.z - 24.0));
  float water = 1.0 - smoothstep(-3.0, 1.0, min(berth, channel));
  if (water <= 0.0) discard;
  float along = vC.y * 0.5 + 0.5;
  float across = 1.0 - smoothstep(0.2, 1.0, abs(vC.x));
  // brightest at the mirror point, broken into ripple bands that crawl toward the viewer
  float core = exp(-pow((along - 0.5) * 2.2, 2.0));
  float s = along * vLen;
  float bands = 0.5 + 0.5 * sin(s * 2.3 - uTime * 1.7 + sin(s * 0.7 + uTime * 0.6) * 2.0);
  bands = mix(0.35, 1.0, bands * bands) * (0.75 + 0.25 * sin(s * 5.1 + uTime * 2.9));
  float a = core * across * bands * water;
  vec3 col = vCol * a * 0.32;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  mat.uniforms.uNight = shared.uNight;
  mat.uniforms.uSunDir = shared.uSunDir;
  mat.uniforms.uTime = shared.uTime;
  mat.uniforms.uClock = uClock;
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'village-glints';
  mesh.renderOrder = 6;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.userData.noPick = true;
  mesh.userData.snow = 0;
  mesh.userData.shelter = false;
  mesh.raycast = () => {};
  return mesh;
}

/** signed distance (m) to the harbour's open water: negative in the berth and the channel */
export function openWater(x: number, z: number): number {
  const q = VILLAGE.quay;
  const berth = Math.max(q.minX + 6 - x, x - q.maxX + 6, q.minZ - 24 - z, z - q.minZ - 5);
  const cz = VILLAGE.harbor.z;
  const cx = VILLAGE.harbor.x - Math.max(0, cz - z) * 0.25;
  const channel = Math.max(Math.abs(x - cx) - 22, cz - 190 - z, z - q.minZ);
  return Math.min(berth, channel);
}
