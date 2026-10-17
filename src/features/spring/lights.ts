/**
 * Small warm lights for the outdoor sites, all unlit and additive (no scene
 * lights): candle and torch flames as camera-facing billboards in one
 * instanced draw, ice lanterns (frosted ice cylinders glowing from the
 * candle inside), and soft pools of their light on the snow. Each site owns
 * one LightSet and calls `update` once a frame with how dark it is.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { poolGeometry, poolMaterial } from '../house/fx';

export interface FlameSpot {
  x: number;
  y: number;
  z: number;
  /** flame height (m): a candle ~0.05, a wax torch ~0.3 */
  size: number;
}

const FLAME_VERT = /* glsl */ `
attribute vec4 aFlame; // xyz base, size
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  float br = 0.85 + 0.1 * sin(uTime * (6.0 + aSeed * 5.0) + aSeed * 40.0) + 0.06 * sin(uTime * 15.0 + aSeed * 17.0);
  float s = aFlame.w * br;
  vec3 c = aFlame.xyz;
  vec3 toCam = cameraPosition - c;
  vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  // a slender flame: half as wide as tall, leaning a little in the draught
  float lean = 0.12 * sin(uTime * 1.3 + aSeed * 9.0) * (position.y + 0.5);
  vec3 p = c + side * (position.x * s * 0.5 + lean * s) + vec3(0.0, (position.y + 0.5) * s, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 uv = vUv;
  float t = uTime + vSeed * 31.0;
  float n = texture2D(uNoise, vec2(uv.x * 0.5 + vSeed, uv.y * 0.4 - t * 0.5)).r;
  float x = uv.x - 0.5 + (n - 0.5) * 0.25 * uv.y;
  float w = 0.2 * pow(max(1.0 - uv.y, 0.0), 0.8) + 0.015;
  float across = exp(-pow(x / w, 2.0) * 2.4);
  float up = smoothstep(0.0, 0.14, uv.y) * (1.0 - smoothstep(0.35, 0.95, uv.y + (n - 0.5) * 0.3));
  float heat = across * up;
  if (heat < 0.01) discard;
  vec3 col = vec3(1.0, 0.3, 0.05) * smoothstep(0.0, 0.4, heat);
  col += vec3(0.0, 0.42, 0.12) * smoothstep(0.3, 0.8, heat);
  col += vec3(0.0, 0.22, 0.35) * smoothstep(0.75, 1.1, heat) * (1.0 - uv.y);
  // a blue root at the wick
  col += vec3(0.05, 0.1, 0.5) * smoothstep(0.25, 0.0, uv.y) * across;
  gl_FragColor = vec4(col * heat * uIntensity * 1.8, 1.0);
}
`;

const SHELL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aLamp; // xyz candle position, shell height
varying vec3 vW;
varying vec3 vN;
varying vec4 vLamp;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vLamp = aLamp;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHELL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform vec3 uAuroraLight;
varying vec3 vW;
varying vec3 vN;
varying vec4 vLamp;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(N, V));
  // frozen bubbles and frost: milky streaks in the ice
  float n1 = texture2D(uNoise, vec2(atan(vW.z - vLamp.z, vW.x - vLamp.x) * 0.6, vW.y * 2.5)).r;
  float n2 = texture2D(uNoise, vW.xz * 7.0 + vW.y * 3.0).g;
  float milk = 0.45 + 0.4 * n1 + 0.25 * (n2 - 0.5);
  // daylight: clear blue-green ice, milky where it froze full of air, mirroring the sky at grazing angles
  float fres = pow(1.0 - ndv, 3.0);
  vec3 sky = uSkyColor * 0.8 + uHorizonColor * 0.2;
  vec3 day = sky * vec3(0.6, 0.8, 0.92) * (0.3 + 0.55 * milk) + sky * fres * 0.9;
  day += uLightColor * max(dot(N, uLightDir), 0.0) * 0.14 * milk;
  // a wet glint of the low sun
  vec3 Hh = normalize(uLightDir + V);
  day += uLightColor * pow(max(dot(N, Hh), 0.0), 70.0) * 0.8;
  day += uAuroraLight * 0.5;
  // the candle inside: brightest at its height, where the ice is thin (the rim, grazing view) a little less
  float dy = vW.y - vLamp.y;
  float hot = exp(-dy * dy / (vLamp.w * vLamp.w * 0.35));
  float flick = 0.88 + 0.08 * sin(uTime * 9.0 + vLamp.x * 13.0) + 0.04 * sin(uTime * 23.0 + vLamp.z * 7.0);
  vec3 glow = vec3(1.0, 0.52, 0.2) * (0.35 + 0.65 * hot) * (0.55 + 0.6 * milk) * (0.6 + 0.4 * ndv) * uIntensity * flick;
  vec3 col = day + glow * 1.6;
  float a = clamp(0.14 + 0.36 * milk * milk + 0.5 * fres, 0.0, 0.85);
  // lit, the whole shell glows
  a = max(a, (0.42 + 0.3 * milk) * min(uIntensity, 1.0));
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

export interface LightSet {
  object: THREE.Group;
  /** call every frame: night 0..1 (how dark it is), t seconds */
  update(night: number, t: number): void;
  /** current light level 0..1 (after dusk, flickering) */
  level: number;
  dispose(): void;
}

export interface IceLanternSpot {
  x: number;
  /** base (the rock or snow it stands on) */
  y: number;
  z: number;
  r?: number;
  h?: number;
}

export interface LightPool {
  x: number;
  z: number;
  r: number;
  /** relative strength */
  k?: number;
}

/**
 * Flames (candles, torches), ice lanterns round their candles, and pools of
 * light on the ground. `ground(x, z)` gives the surface the pools lie on.
 */
export function buildLights(
  ctx: FeatureContext,
  opts: {
    name: string;
    flames: FlameSpot[];
    iceLanterns?: IceLanternSpot[];
    pools?: LightPool[];
    ground: (x: number, z: number) => number;
    /** when the lights are lit: night level where they start and where they are full */
    on?: [number, number];
    poolStrength?: number;
  },
): LightSet {
  const group = new THREE.Group();
  group.name = opts.name;
  group.userData.snow = 0;
  group.userData.shelter = false;
  const intensity = { value: 0 };
  const rnd = mulberry32(opts.name.length * 977 + 13);
  const disposables: { dispose(): void }[] = [];

  // ---- ice lanterns: candles inside frosted ice cylinders ----
  const flames = opts.flames.slice();
  if (opts.iceLanterns?.length) {
    const pos: number[] = [];
    const nrm: number[] = [];
    const lamp: number[] = [];
    const idx: number[] = [];
    for (const l of opts.iceLanterns) {
      const r = l.r ?? 0.11;
      const h = l.h ?? 0.24;
      const seg = 14;
      const rings = 5;
      const base = pos.length / 3;
      const k1 = rnd() * 6.28;
      const k2 = rnd() * 6.28;
      // outer wall (rings up), then the inner wall back down: a thick, slightly wonky bowl
      const wall = (rr: number, sgn: number) => {
        for (let j = 0; j <= rings; j++) {
          const v = j / rings;
          for (let i = 0; i < seg; i++) {
            const a = (i / seg) * Math.PI * 2;
            // a ragged, melted rim
            const rim = v === 1 ? 0.018 * Math.sin(a * 3 + k1) + 0.012 * Math.sin(a * 5 + k2) + 0.006 * Math.sin(a * 11 + k1) : 0;
            // a lumpy, hand-made shell, a little narrower at the top where it melted back
            const bulge =
              (1 + 0.08 * Math.sin(v * Math.PI) + 0.04 * Math.sin(a * 2 + k1) + 0.035 * Math.sin(a * 3 + k2 + v * 2.2) + 0.02 * Math.sin(a * 5 + k1 * 2 - v * 3)) *
              (1 - 0.07 * v);
            const x = Math.cos(a) * rr * bulge;
            const z = Math.sin(a) * rr * bulge;
            pos.push(l.x + x, l.y + v * h + rim, l.z + z);
            nrm.push((Math.cos(a) * sgn), 0, Math.sin(a) * sgn);
            lamp.push(l.x, l.y + h * 0.35, l.z, h);
          }
        }
      };
      wall(r, 1);
      wall(r * 0.72, -1);
      const outer = base;
      const inner = base + (rings + 1) * seg;
      for (let j = 0; j < rings; j++) {
        for (let i = 0; i < seg; i++) {
          const i1 = (i + 1) % seg;
          const a = outer + j * seg + i;
          const b = outer + j * seg + i1;
          const c = outer + (j + 1) * seg + i;
          const d = outer + (j + 1) * seg + i1;
          idx.push(a, b, c, b, d, c);
          const a2 = inner + j * seg + i;
          const b2 = inner + j * seg + i1;
          const c2 = inner + (j + 1) * seg + i;
          const d2 = inner + (j + 1) * seg + i1;
          idx.push(a2, c2, b2, b2, c2, d2);
        }
      }
      // the rim joining outer and inner walls
      for (let i = 0; i < seg; i++) {
        const i1 = (i + 1) % seg;
        const a = outer + rings * seg + i;
        const b = outer + rings * seg + i1;
        const c = inner + rings * seg + i;
        const d = inner + rings * seg + i1;
        idx.push(a, c, b, b, c, d);
      }
      flames.push({ x: l.x, y: l.y + 0.03, z: l.z, size: 0.07 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aLamp', new THREE.Float32BufferAttribute(lamp, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({
      name: 'iceLantern',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNoise: { value: ctx.materials.noise } }]),
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    m.uniforms.uTime = ctx.shared.uTime;
    m.uniforms.uIntensity = intensity;
    m.uniforms.uSkyColor = ctx.shared.uSkyColor;
    m.uniforms.uHorizonColor = ctx.shared.uHorizonColor;
    m.uniforms.uLightColor = ctx.shared.uLightColor;
    m.uniforms.uLightDir = ctx.shared.uLightDir;
    m.uniforms.uAuroraLight = ctx.shared.uAuroraLight;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = `${opts.name}-ice`;
    mesh.renderOrder = 5;
    mesh.userData.noMerge = true;
    group.add(mesh);
    disposables.push(g, m);
  }

  // ---- flames: one instanced billboard draw ----
  let flameMesh: THREE.Mesh | null = null;
  if (flames.length) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const data = new Float32Array(flames.length * 4);
    const seeds = new Float32Array(flames.length);
    const box = new THREE.Box3();
    flames.forEach((f, i) => {
      data.set([f.x, f.y, f.z, f.size], i * 4);
      seeds[i] = rnd();
      box.expandByPoint(new THREE.Vector3(f.x, f.y, f.z));
      box.expandByPoint(new THREE.Vector3(f.x, f.y + f.size * 1.5, f.z));
    });
    g.setAttribute('aFlame', new THREE.InstancedBufferAttribute(data, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    g.instanceCount = flames.length;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    g.boundingSphere.radius += 1;
    const m = new THREE.ShaderMaterial({
      name: 'flames',
      uniforms: { uNoise: { value: ctx.materials.noise }, uTime: ctx.shared.uTime, uIntensity: intensity },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    flameMesh = new THREE.Mesh(g, m);
    flameMesh.name = `${opts.name}-flames`;
    flameMesh.renderOrder = 6;
    flameMesh.raycast = () => {};
    flameMesh.userData.noMerge = true;
    group.add(flameMesh);
    disposables.push(g, m, quad);
  }

  // ---- pools of light on the snow ----
  let poolMat: THREE.MeshBasicMaterial | null = null;
  if (opts.pools?.length) {
    const geos = opts.pools.map((p) => {
      const g = poolGeometry(p.x, p.z, p.r, p.r, [1, 0], opts.ground, 0.05);
      // relative strength per pool through vertex colours
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3).fill(p.k ?? 1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    });
    let count = 0;
    let icount = 0;
    for (const g of geos) {
      count += g.getAttribute('position').count;
      icount += g.index!.count;
    }
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);
    const idx = new Uint32Array(icount);
    let o = 0;
    let io = 0;
    for (const g of geos) {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array as Float32Array, o * 3);
      uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
      col.set(g.getAttribute('color').array as Float32Array, o * 3);
      const ix = g.index!.array;
      for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + o;
      o += n;
      io += ix.length;
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    poolMat = poolMaterial(0xffa25a);
    poolMat.vertexColors = true;
    const mesh = new THREE.Mesh(g, poolMat);
    mesh.name = `${opts.name}-pools`;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.userData.noMerge = true;
    group.add(mesh);
    disposables.push(g, poolMat);
  }

  const [on0, on1] = opts.on ?? [0.2, 0.65];
  const poolK = opts.poolStrength ?? 0.14;
  const set: LightSet = {
    object: group,
    level: 0,
    update(night, t) {
      const on = THREE.MathUtils.smoothstep(night, on0, on1);
      const flick = 0.9 + 0.06 * Math.sin(t * 8.3) * Math.sin(t * 2.9 + 1.1) + 0.04 * Math.sin(t * 19.7);
      set.level = on * flick;
      intensity.value = set.level;
      if (flameMesh) flameMesh.visible = on > 0.01;
      if (poolMat) {
        poolMat.opacity = on * poolK * flick;
        poolMat.visible = on > 0.01;
      }
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
  return set;
}
