/**
 * Pleated wool blinds for the glass wing: one under every roof bay (running
 * from the knee wall up to the ridge, folding down into a narrow stack at the
 * eave) and one over each lower pane of the north gable (rising from the
 * sill). Every blind is a strip of pleats folded in the vertex shader from a
 * single uniform array, so all of them draw in one call and animate with no
 * CPU work beyond a few numbers. Drawn at night they glow amber from outside:
 * the room's lamplight shining through the wool.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { approach, proxyMaterial, smooth01 } from './kit';
import { W, W_CX, wingUnder } from './plan';
import { KNEE_T, slopeFrame, type GableBay, type RoofBay } from './wing';

export type BlindPreset = 'aurora' | 'privacy' | 'warm';

/** pleat depth (m) */
const PLEAT = 0.045;
/** cos of the pleat angle when stacked (open) and when drawn */
const COS_OPEN = 0.07;
const COS_DRAWN = 0.975;
const TIME = 2.2;

interface BlindDef {
  /** stack end (house-local), extension direction, across direction, room-side normal */
  A: THREE.Vector3;
  T: THREE.Vector3;
  B: THREE.Vector3;
  N: THREE.Vector3;
  length: number;
  width: number;
  kind: 'roof' | 'gable';
  center: THREE.Vector3;
}

const PARS = /* glsl */ `
uniform float uBlind[32];
attribute vec4 aP;  // s along T from the stack end, edge parity (0 base / 1 out), blind index, face sign
attribute vec3 aT;
attribute vec3 aN;
varying float vDrawn;
varying float vFace;
vec2 foxPleat() {
  float f = uBlind[int(aP.z + 0.5)];
  float c = mix(${COS_OPEN.toFixed(3)}, ${COS_DRAWN.toFixed(3)}, f);
  return vec2(c, sqrt(max(0.0, 1.0 - c * c)));
}
vec3 foxPleatPos(vec2 cs) {
  return position - aT * aP.x + aT * (aP.x * cs.x) + aN * (aP.y * ${PLEAT.toFixed(3)} * cs.y);
}
`;

export interface Blinds {
  object: THREE.Group;
  proxies: THREE.Group;
  count: number;
  /** blind index under a raycast hit on the proxies, or -1 */
  blindAt(hit: THREE.Intersection | null | undefined): number;
  isDrawn(i: number): boolean;
  set(i: number, drawn: boolean): void;
  toggle(i: number): void;
  applyPreset(p: BlindPreset): void;
  preset(): BlindPreset | null;
  /** share of the glass left uncovered (0..1) */
  openness(): number;
  update(dt: number, shot: boolean): void;
}

export function buildBlinds(ctx: FeatureContext, roofBays: RoofBay[], gableBays: GableBay[]): Blinds {
  const defs: BlindDef[] = [];
  const RAFTER = 0.045;
  // roof: inside the rafters, from the knee wall's inner face to the ridge beam
  for (const bay of roofBays) {
    if (Math.min(bay.z0, bay.z1) < W.minZ - 0.01) continue; // the overhang bay is outside
    const { up, along } = slopeFrame(bay.side);
    const xi = bay.side < 0 ? W.minX + KNEE_T : W.maxX - KNEE_T;
    const xr = W_CX - bay.side * 0.08;
    const inset = 0.03;
    const yA = wingUnder(xi) - inset;
    const yR = wingUnder(xr) - inset;
    const zc = (bay.z0 + bay.z1) / 2;
    const A = new THREE.Vector3(xi, yA, zc);
    const R = new THREE.Vector3(xr, yR, zc);
    const len = A.distanceTo(R);
    const T = up.clone();
    const N = new THREE.Vector3().crossVectors(T, along).normalize();
    // N must point into the room (down and inward)
    if (N.y > 0) N.negate();
    const width = Math.abs(bay.z0 - bay.z1) - RAFTER * 2;
    defs.push({ A, T, B: along.clone(), N, length: len, width, kind: 'roof', center: A.clone().addScaledVector(T, len / 2) });
  }
  // gable: rising from the sill inside the mullions
  const zg = W.minZ + 0.17;
  for (const g of gableBays) {
    const A = new THREE.Vector3((g.x0 + g.x1) / 2, g.y0 + 0.04, zg);
    const T = new THREE.Vector3(0, 1, 0);
    const N = new THREE.Vector3(0, 0, 1);
    const len = g.y1 - g.y0 - 0.06;
    defs.push({ A, T, B: new THREE.Vector3(1, 0, 0), N, length: len, width: g.x1 - g.x0 - 0.01, kind: 'gable', center: A.clone().addScaledVector(T, len / 2) });
  }
  const count = defs.length;

  /* ------------------------------ geometry ------------------------------ */
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const aP: number[] = [];
  const aT: number[] = [];
  const aN: number[] = [];
  const idx: number[] = [];
  defs.forEach((d, bi) => {
    const n = Math.max(2, Math.round(d.length / PLEAT));
    const p = d.length / n;
    for (let k = 0; k < n; k++) {
      const s0 = k * p;
      const s1 = (k + 1) * p;
      const rising = k % 2 === 0;
      const par0 = rising ? 0 : 1;
      const par1 = rising ? 1 : 0;
      const sign = rising ? -1 : 1;
      const base = pos.length / 3;
      for (const [s, par] of [
        [s0, par0],
        [s1, par1],
      ]) {
        for (const b of [-0.5, 0.5]) {
          const v = d.A.clone().addScaledVector(d.T, s).addScaledVector(d.B, b * d.width);
          pos.push(v.x, v.y, v.z);
          nor.push(d.N.x, d.N.y, d.N.z);
          uv.push(b * d.width, s);
          aP.push(s, par, bi, sign);
          aT.push(d.T.x, d.T.y, d.T.z);
          aN.push(d.N.x, d.N.y, d.N.z);
        }
      }
      // two triangles; wind them so the front faces the room (+N)
      const v0 = new THREE.Vector3(pos[base * 3], pos[base * 3 + 1], pos[base * 3 + 2]);
      const v1 = new THREE.Vector3(pos[(base + 1) * 3], pos[(base + 1) * 3 + 1], pos[(base + 1) * 3 + 2]);
      const v2 = new THREE.Vector3(pos[(base + 2) * 3], pos[(base + 2) * 3 + 1], pos[(base + 2) * 3 + 2]);
      const fn = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0));
      if (fn.dot(d.N) >= 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aP', new THREE.Float32BufferAttribute(aP, 4));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 3));
  geo.setAttribute('aN', new THREE.Float32BufferAttribute(aN, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  /* ------------------------------ material ------------------------------ */
  const fold = new Float32Array(32);
  const foldU = { value: fold };
  const M = ctx.materials;
  const mat = M.get('linen', 'glasswing').clone();
  mat.name = 'woolBlind';
  mat.color.set(0xe6d6bd);
  mat.side = THREE.DoubleSide;
  mat.emissive.set(0xffbe82);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBlind = foldU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        vec2 foxCS = foxPleat();
        vec3 objectNormal = normalize(aN * foxCS.x + aT * (foxCS.y * aP.w));
        vDrawn = uBlind[int(aP.z + 0.5)];
        vFace = aP.w;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = foxPleatPos(foxCS);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDrawn;\nvarying float vFace;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // lamplight through the wool: seen from outside (back faces) and only where it hangs flat
        // the weave and the pleats show in the glow: alternate faces catch it differently
        float weave = 0.7 + 0.6 * dot(diffuseColor.rgb, vec3(0.333));
        float pleat = vFace > 0.0 ? 1.0 : 0.72;
        totalEmissiveRadiance *= (gl_FrontFacing ? 0.12 : 1.0) * mix(0.15, 1.0, vDrawn) * weave * pleat;`,
      );
  };
  mat.customProgramCacheKey = () => 'fox-blind-2';
  M.registerInterior(mat, 'glasswing', { nightEnv: 0.35 });
  M.registerNightGlow(mat, 0.34, 'glasswing');

  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uBlind = foldU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = foxPleatPos(foxPleat());');
  };
  depth.customProgramCacheKey = () => 'fox-blind-depth-1';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wing-blinds';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  const object = new THREE.Group();
  object.name = 'house-blinds';
  object.userData.snow = 0;
  object.add(mesh);

  /* ------------------------------ proxies ------------------------------ */
  const proxies = new THREE.Group();
  proxies.name = 'house-blind-proxies';
  const pm = proxyMaterial();
  const proxyMeshes: THREE.Mesh[] = defs.map((d, i) => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const p = new THREE.Mesh(g, pm);
    p.matrixAutoUpdate = false;
    p.userData.blind = i;
    proxies.add(p);
    return p;
  });
  const syncProxy = (i: number, f: number) => {
    const d = defs[i];
    const span = Math.max(0.12, d.length * (COS_OPEN + (COS_DRAWN - COS_OPEN) * f));
    const Bv = d.B.clone().multiplyScalar(d.width);
    const Tv = d.T.clone().multiplyScalar(span);
    const at = d.A.clone().addScaledVector(d.N, 0.03);
    proxyMeshes[i].matrix.makeBasis(Bv, Tv, d.N).setPosition(at);
    proxyMeshes[i].matrixWorldNeedsUpdate = true;
  };

  /* ------------------------------ state ------------------------------ */
  const target = new Float32Array(count);
  const cur = new Float32Array(count);
  const wait = new Float32Array(count);
  let busy = false;
  let presetName: BlindPreset | null = 'aurora';
  const origin = new THREE.Vector3(W_CX, W.ridgeH, W.maxZ);
  const put = (i: number, v: number, delay = 0) => {
    if (target[i] === v) return;
    target[i] = v;
    wait[i] = delay;
    busy = true;
  };
  for (let i = 0; i < count; i++) syncProxy(i, 0);
  const openness = () => {
    let a = 0;
    let o = 0;
    defs.forEach((d, i) => {
      const area = d.length * d.width * (d.kind === 'roof' ? 1.4 : 1);
      a += area;
      o += area * (1 - smooth01(cur[i]));
    });
    return a > 0 ? o / a : 1;
  };

  return {
    object,
    proxies,
    count,
    blindAt(hit) {
      const i = hit?.object.userData.blind;
      return typeof i === 'number' ? i : -1;
    },
    isDrawn: (i) => target[i] > 0.5,
    set(i, drawn) {
      presetName = null;
      put(i, drawn ? 1 : 0);
    },
    toggle(i) {
      presetName = null;
      put(i, target[i] > 0.5 ? 0 : 1);
    },
    applyPreset(p) {
      presetName = p;
      defs.forEach((d, i) => {
        const v = p === 'warm' ? 1 : p === 'privacy' ? (d.kind === 'gable' ? 1 : 0) : 0;
        put(i, v, d.center.distanceTo(origin) * 0.08);
      });
    },
    preset: () => presetName,
    openness,
    update(dt, shot) {
      if (!busy) return;
      const step = shot ? 1e3 : dt;
      let any = false;
      for (let i = 0; i < count; i++) {
        if (cur[i] === target[i]) continue;
        any = true;
        if (wait[i] > 0) {
          wait[i] -= step;
          continue;
        }
        cur[i] = approach(cur[i], target[i], 1 / TIME, step);
        fold[i] = smooth01(cur[i]);
        syncProxy(i, fold[i]);
      }
      busy = any;
      M.setZoneDaylight('glasswing', 0.35 + 0.65 * openness());
    },
  };
}
