/**
 * Snow-capped gneiss boulders: four procedural cut-and-lobed shapes scattered
 * on a jittered 9 m lattice by terrain category (sea shores, outcrops on steep
 * slopes, talus in gullies, glacial erratics, blockfields on scoured tops,
 * stones along the lake shore, skerries), drawn as near (shadow-casting) and
 * far instanced meshes streamed around the camera.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../../core/quality';
import type { FeatureContext } from '../../core/types';
import { SKERRIES, SPRING, VILLAGE } from '../../world/layout';
import { lakeSd } from '../../world/terrain-height';
import { hash2, mulberry32, smoothstep } from '../../world/noise';
import type { TerrainBake } from './bake';
import type { TerrainUniforms } from './material';
import {
  ROCK_FRAGMENT_PARS,
  ROCK_REACH,
  ROCK_SELECT_NORMAL,
  ROCK_SELECT_POSITION,
  ROCK_SHADE,
  ROCK_VERTEX_PARS,
  ROCK_WORLD_VARYINGS,
  SHADE_COMMON_GLSL,
  TERRAIN_SHADOW_GLSL,
} from './shaders';

const VARIANTS = 4;
const CELL = 96;

interface ShapeSpec {
  s: [number, number, number];
  lobes: number[];
  cuts: number[];
}

/** 0 ice-rounded boulder, 1 angular block, 2 slab / ledge, 3 tall frost-split block. */
function makeSpecs(): ShapeSpec[] {
  const defs = [
    { s: [1.0, 0.72, 0.92], cuts: 3, lo: 0.74, hi: 0.92, lobe: 0.1, columns: false },
    { s: [1.0, 0.86, 0.8], cuts: 7, lo: 0.6, hi: 0.84, lobe: 0.07, columns: false },
    { s: [1.35, 0.5, 1.05], cuts: 6, lo: 0.62, hi: 0.86, lobe: 0.06, columns: false },
    { s: [0.82, 1.3, 0.9], cuts: 8, lo: 0.64, hi: 0.86, lobe: 0.05, columns: false },
  ] as const;
  return defs.map((d, v) => {
    const rnd = mulberry32(9001 + v * 131);
    const dir = () => {
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      return [r * Math.cos(t), u, r * Math.sin(t)];
    };
    const lobes: number[] = [];
    for (let i = 0; i < 4; i++) lobes.push(...dir(), 1.5 + rnd() * 2.5, d.lobe * (0.5 + rnd()), rnd() * Math.PI * 2);
    const cuts: number[] = [];
    for (let i = 0; i < d.cuts; i++) {
      let n = dir();
      if (d.columns && i < d.cuts - 2) {
        const a = (i / (d.cuts - 2)) * Math.PI * 2 + rnd() * 0.4;
        n = [Math.cos(a), (rnd() - 0.5) * 0.15, Math.sin(a)];
      } else if (d.columns) n = [(rnd() - 0.5) * 0.7, 1, (rnd() - 0.5) * 0.7];
      const l = Math.hypot(n[0], n[1], n[2]);
      cuts.push(n[0] / l, n[1] / l, n[2] / l, d.lo + rnd() * (d.hi - d.lo));
    }
    return { s: [...d.s] as [number, number, number], lobes, cuts };
  });
}

function shapeVertex(spec: ShapeSpec, dir: THREE.Vector3, out: THREE.Vector3): void {
  let r = 1;
  const L = spec.lobes;
  for (let i = 0; i < L.length; i += 6) r += L[i + 4] * Math.cos((dir.x * L[i] + dir.y * L[i + 1] + dir.z * L[i + 2]) * L[i + 3] + L[i + 5]);
  const [sx, sy, sz] = spec.s;
  out.set(dir.x * r * sx, dir.y * r * sy, dir.z * r * sz);
  const C = spec.cuts;
  for (let i = 0; i < C.length; i += 4) {
    const nx = C[i];
    const ny = C[i + 1];
    const nz = C[i + 2];
    const support = Math.hypot(sx * nx, sy * ny, sz * nz);
    const k = out.x * nx + out.y * ny + out.z * nz - C[i + 3] * support;
    if (k > 0) out.set(out.x - k * nx, out.y - k * ny, out.z - k * nz);
  }
  const base = -0.6 * sy;
  if (out.y < base) out.y = base + (out.y - base) * 0.35;
}

/** Local vertical extent [bottom, top] of each variant at unit scale. */
function shapeExtents(specs: ShapeSpec[], detail: number): [number, number][] {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const p = ico.getAttribute('position');
  const dir = new THREE.Vector3();
  const out = new THREE.Vector3();
  const ext = specs.map((spec): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.count; i++) {
      shapeVertex(spec, dir.fromBufferAttribute(p, i).normalize(), out);
      lo = Math.min(lo, out.y);
      hi = Math.max(hi, out.y);
    }
    return [lo, hi];
  });
  ico.dispose();
  return ext;
}

/**
 * One unindexed geometry holding all variants as position/normal sets (same topology).
 * Faces lying on a cut plane take its exact normal so fractures read as crisp facets
 * even at low tessellation; the rest is smoothed over the non-flat faces only.
 */
function buildGeometry(detail: number, specs: ShapeSpec[]): THREE.BufferGeometry {
  let base: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  base = mergeVertices(base);
  const p0 = base.getAttribute('position');
  const index = base.getIndex()!.array;
  const nv = p0.count;
  const nf = index.length / 3;
  const geo = new THREE.BufferGeometry();
  const dir = new THREE.Vector3();
  const out = new THREE.Vector3();
  const P = new Float32Array(nv * 3);
  const smooth = new Float32Array(nv * 3);
  const faceN = new Float32Array(nf * 3);
  const facePlane = new Int16Array(nf);
  for (let v = 0; v < VARIANTS; v++) {
    const spec = specs[v];
    for (let i = 0; i < nv; i++) {
      dir.fromBufferAttribute(p0, i).normalize();
      shapeVertex(spec, dir, out);
      out.toArray(P, i * 3);
    }
    const C = spec.cuts;
    const [sx, sy, sz] = spec.s;
    smooth.fill(0);
    for (let f = 0; f < nf; f++) {
      const a = index[f * 3] * 3;
      const b = index[f * 3 + 1] * 3;
      const c = index[f * 3 + 2] * 3;
      facePlane[f] = -1;
      for (let k = 0; k < C.length && facePlane[f] < 0; k += 4) {
        const d = C[k + 3] * Math.hypot(sx * C[k], sy * C[k + 1], sz * C[k + 2]);
        const on = (o: number) => Math.abs(P[o] * C[k] + P[o + 1] * C[k + 1] + P[o + 2] * C[k + 2] - d) < 1e-4;
        if (on(a) && on(b) && on(c)) facePlane[f] = k;
      }
      const ux = P[b] - P[a];
      const uy = P[b + 1] - P[a + 1];
      const uz = P[b + 2] - P[a + 2];
      const wx = P[c] - P[a];
      const wy = P[c + 1] - P[a + 1];
      const wz = P[c + 2] - P[a + 2];
      faceN[f * 3] = uy * wz - uz * wy;
      faceN[f * 3 + 1] = uz * wx - ux * wz;
      faceN[f * 3 + 2] = ux * wy - uy * wx;
      if (facePlane[f] >= 0) continue;
      for (const o of [a, b, c]) {
        smooth[o] += faceN[f * 3];
        smooth[o + 1] += faceN[f * 3 + 1];
        smooth[o + 2] += faceN[f * 3 + 2];
      }
    }
    const pos = new Float32Array(nf * 9);
    const nrm = new Float32Array(nf * 9);
    for (let f = 0; f < nf; f++) {
      const k = facePlane[f];
      for (let j = 0; j < 3; j++) {
        const o = index[f * 3 + j] * 3;
        const t = f * 9 + j * 3;
        pos[t] = P[o];
        pos[t + 1] = P[o + 1];
        pos[t + 2] = P[o + 2];
        out.set(smooth[o], smooth[o + 1], smooth[o + 2]);
        if (k >= 0) out.set(C[k], C[k + 1], C[k + 2]);
        out.normalize().toArray(nrm, t);
      }
    }
    geo.setAttribute(v === 0 ? 'position' : `position${v}`, new THREE.BufferAttribute(pos, 3));
    geo.setAttribute(v === 0 ? 'normal' : `normal${v}`, new THREE.BufferAttribute(nrm, 3));
  }
  base.dispose();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return geo;
}

interface Category {
  dMin: number;
  dMax: number;
  variants: number[];
  embed: number;
}

const CATS: Category[] = [
  { dMin: 0.7, dMax: 3.6, variants: [0, 0, 0, 1, 1, 2], embed: 0.25 }, // rocky sea shores, cliff foot
  { dMin: 2.4, dMax: 7.5, variants: [1, 1, 2, 3, 3], embed: 0.42 }, // outcrops on steep slopes
  { dMin: 0.6, dMax: 2.6, variants: [1, 1, 2, 0], embed: 0.3 }, // talus blocks in gullies and below the walls
  { dMin: 1.6, dMax: 4.8, variants: [0, 0, 2], embed: 0.22 }, // glacial erratics on open ground
  { dMin: 0.6, dMax: 2.2, variants: [1, 2, 1], embed: 0.32 }, // blockfield on scoured tops
  { dMin: 0.5, dMax: 1.7, variants: [0, 0, 1], embed: 0.35 }, // stones along the lake shore
  { dMin: 1.2, dMax: 4.8, variants: [0, 1, 3, 1], embed: 0.25 }, // skerries
];

export interface RockSystem {
  object: THREE.Group;
  /** placement density this system was built with (rebuild when rockDensity() changes) */
  density: number;
  update(camera: THREE.Camera): void;
  dispose(): void;
  stats(): { total: number; near: number; far: number; triangles: number };
}

export const rockDensity = (q: QualitySettings): number => (q.terrainDetail >= 1 ? 1 : q.terrainDetail >= 0.75 ? 0.8 : 0.55);

export function createRocks(ctx: FeatureContext, bake: TerrainBake, uniforms: TerrainUniforms, tier: number): RockSystem {
  const world = ctx.world;
  const density = rockDensity(ctx.quality);
  const nearR = density >= 1 ? 150 : density >= 0.8 ? 120 : 90;
  const farMax = ROCK_REACH.max;
  const colliderIds: number[] = [];

  // ---- deterministic placement on a jittered 9 m lattice
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const sizes: number[] = [];
  const mats: number[] = [];
  const attrs: number[] = [];
  const C = 9;
  const nx = Math.floor((bake.maxX - bake.minX) / C);
  const nz = Math.floor((bake.maxZ - bake.minZ) / C);
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const probs = new Float64Array(CATS.length);
  const specs = makeSpecs();
  const ext = shapeExtents(specs, 2);

  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const r0 = hash2(gx, gz, 4242);
      if (r0 > 0.4 * density) continue;
      const x = bake.minX + (gx + hash2(gx, gz, 11)) * C;
      const z = bake.minZ + (gz + hash2(gx, gz, 12)) * C;
      const h = bake.sample(bake.heights, x, z);
      if (h < -4) continue;
      const sl = bake.sample(bake.slope, x, z);
      const cav = bake.sample(bake.cavity, x, z);
      const calm = bake.sample(bake.calm, x, z);
      const shel = bake.sample(bake.shelter, x, z);
      const ls = h > 90 && h < 140 ? lakeSd(x, z) : 1e9;
      if (ls < 0.5) continue;

      probs[0] = Math.pow(1 - calm, 1.5) * smoothstep(-3, -1, h) * (1 - smoothstep(8, 16, h)) * (0.12 + 0.5 * smoothstep(0.15, 0.7, sl)) * 0.45;
      probs[1] = h > 6 ? smoothstep(0.85, 1.45, sl) * 0.16 : 0;
      probs[2] = h > 12 && sl < 1.0 ? (smoothstep(1.5, 5, cav) * 0.07 + smoothstep(0.55, 0.9, sl) * 0.025) : 0;
      probs[3] = h > 4 && sl < 0.3 ? 0.006 : 0;
      probs[4] = h > 300 && sl < 0.7 ? 0.05 * smoothstep(0.05, 0.4, -shel) : 0;
      probs[5] = ls < 9 ? 0.09 * (1 - smoothstep(4, 9, ls)) : 0;
      probs[6] = 0;
      for (const isl of SKERRIES) {
        const d = Math.hypot(x - isl.x, z - isl.z) / isl.r;
        if (d < 1.7 && h > -3.5) probs[6] = Math.max(probs[6], 0.3 * (1 - smoothstep(1.1, 1.7, d)));
      }
      let acc = 0;
      let cat = -1;
      for (let c = 0; c < CATS.length; c++) {
        acc += probs[c] * density;
        if (r0 < acc) {
          cat = c;
          break;
        }
      }
      if (cat < 0) continue;

      const def = CATS[cat];
      const rs = hash2(gx, gz, 13);
      const diam = def.dMin + (def.dMax - def.dMin) * Math.pow(rs, 2.2);
      const rad = diam * 0.5;
      if (world.isReserved(x, z, rad + 1.2)) continue;
      if (world.pathCarve(x, z).weight > 0.3) continue;
      if (Math.hypot(x - SPRING.x, z - SPRING.z) < 16 + rad + 2) continue;
      if (Math.hypot(x - VILLAGE.center.x, z - VILLAGE.center.z) < VILLAGE.radius + 40) continue;
      if (Math.hypot(x - VILLAGE.harbor.x, z - VILLAGE.harbor.z) < 110) continue;

      const variant = def.variants[Math.floor(hash2(gx, gz, 14) * def.variants.length)];
      const r1 = hash2(gx, gz, 15);
      const r2 = hash2(gx, gz, 16);
      const r3 = hash2(gx, gz, 17);
      const sx = rad * (0.85 + 0.3 * r1);
      const sy = rad * (0.8 + 0.4 * r2);
      const sz = rad * (0.85 + 0.3 * r3);
      // footprint: bury `embed` of the rock's real height below the lowest ground under it so no edge floats
      const y0 = world.heightAt(x, z);
      let hMin = y0;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r1;
        hMin = Math.min(hMin, world.heightAt(x + Math.cos(a) * rad * 0.75, z + Math.sin(a) * rad * 0.75));
      }
      const [lo, hi] = ext[variant];
      const tall = (hi - lo) * sy;
      const y = Math.min(y0, hMin + 0.1 * tall) - lo * sy - def.embed * tall;
      const n = world.normalAt(x, z, Math.max(1, rad));
      nrm.set(n[0], n[1], n[2]).lerp(up, 0.35).normalize();
      q1.setFromUnitVectors(up, nrm);
      q2.setFromAxisAngle(up, hash2(gx, gz, 18) * Math.PI * 2);
      q1.multiply(q2);
      pos.set(x, y, z);
      scl.set(sx, sy, sz);
      m.compose(pos, q1, scl);
      xs.push(x);
      ys.push(y);
      zs.push(z);
      sizes.push(diam);
      for (let k = 0; k < 16; k++) mats.push(m.elements[k]);
      attrs.push(variant, hash2(gx, gz, 19));
      if (rad > 0.6 && y + hi * sy > 0) colliderIds.push(ctx.colliders.addCircle(x, z, Math.max(sx, sz) * 0.8, { yMin: y + lo * sy, yMax: y + hi * sy }));
    }
  }
  const total = xs.length;
  const matArr = new Float32Array(mats);
  const attrArr = new Float32Array(attrs);

  // ---- spatial cells, instances sorted large → small for size-based far culling
  interface Cell {
    box: THREE.Box3;
    items: number[];
  }
  const cellMap = new Map<number, Cell>();
  for (let i = 0; i < total; i++) {
    const cx = Math.floor(xs[i] / CELL);
    const cz = Math.floor(zs[i] / CELL);
    const key = cz * 4096 + cx;
    let c = cellMap.get(key);
    if (!c) {
      c = { box: new THREE.Box3(new THREE.Vector3(cx * CELL, Infinity, cz * CELL), new THREE.Vector3((cx + 1) * CELL, -Infinity, (cz + 1) * CELL)), items: [] };
      cellMap.set(key, c);
    }
    c.items.push(i);
    const r = sizes[i];
    c.box.min.y = Math.min(c.box.min.y, ys[i] - r);
    c.box.max.y = Math.max(c.box.max.y, ys[i] + r * 1.5);
  }
  const cells = [...cellMap.values()];
  for (const c of cells) {
    c.items.sort((a, b) => sizes[b] - sizes[a]);
    c.box.min.x -= 4;
    c.box.min.z -= 4;
    c.box.max.x += 4;
    c.box.max.z += 4;
  }

  // ---- meshes: near (detail 2, casts shadows) and far (detail 1)
  const geoNear = buildGeometry(2, specs);
  const geoFar = buildGeometry(1, specs);
  const maxNear = Math.min(total, 900);
  const maxFar = Math.max(1, total);
  const material = createRockMaterial(uniforms, tier);
  const depthMaterial = createRockDepthMaterial();
  const triNear = geoNear.getAttribute('position').count / 3;
  const triFar = geoFar.getAttribute('position').count / 3;
  const near = new THREE.InstancedMesh(geoNear, material, Math.max(1, maxNear));
  const far = new THREE.InstancedMesh(geoFar, material, maxFar);
  const nearAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, maxNear) * 2), 2);
  const farAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxFar * 2), 2);
  geoNear.setAttribute('aRock', nearAttr);
  geoFar.setAttribute('aRock', farAttr);
  for (const [mesh, attr] of [
    [near, nearAttr],
    [far, farAttr],
  ] as const) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    attr.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
  }
  near.castShadow = true;
  near.customDepthMaterial = depthMaterial;
  near.name = 'rocks-near';
  far.name = 'rocks-far';
  const group = new THREE.Group();
  group.name = 'terrain-rocks';
  group.add(near, far);

  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQuat = new THREE.Quaternion();
  const camPos = new THREE.Vector3();
  let nNear = 0;
  let nFar = 0;

  const put = (mesh: THREE.InstancedMesh, attr: THREE.InstancedBufferAttribute, slot: number, i: number) => {
    const dst = mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    const s = i * 16;
    for (let k = 0; k < 16; k++) dst[o + k] = matArr[s + k];
    const a = attr.array as Float32Array;
    a[slot * 2] = attrArr[i * 2];
    a[slot * 2 + 1] = attrArr[i * 2 + 1];
  };

  const commit = (mesh: THREE.InstancedMesh, attr: THREE.InstancedBufferAttribute, n: number) => {
    mesh.count = n;
    mesh.visible = n > 0;
    if (n === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * 2);
    attr.needsUpdate = true;
  };

  const refresh = (camera: THREE.Camera) => {
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    nNear = 0;
    nFar = 0;
    for (const c of cells) {
      const d = c.box.distanceToPoint(camPos);
      if (d > farMax) continue;
      if (d > 60 && !frustum.intersectsBox(c.box)) continue;
      for (const i of c.items) {
        const dx = xs[i] - camPos.x;
        const dy = ys[i] - camPos.y;
        const dz = zs[i] - camPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const reach = Math.min(farMax, ROCK_REACH.a + ROCK_REACH.b * 1.2 * sizes[i]);
        if (dist < nearR && nNear < maxNear) put(near, nearAttr, nNear++, i);
        else if (dist < reach) put(far, farAttr, nFar++, i);
        else if (d > nearR && d > reach) break;
      }
    }
    commit(near, nearAttr, nNear);
    commit(far, farAttr, nFar);
  };

  return {
    object: group,
    density,
    update(camera) {
      camPos.setFromMatrixPosition(camera.matrixWorld);
      const moved = camPos.distanceToSquared(lastPos) > 4;
      const turned = Math.abs(lastQuat.dot(camera.quaternion)) < 0.9995;
      if (!moved && !turned) return;
      lastPos.copy(camPos);
      lastQuat.copy(camera.quaternion);
      refresh(camera);
    },
    dispose() {
      for (const id of colliderIds) ctx.colliders.remove(id);
      colliderIds.length = 0;
      geoNear.dispose();
      geoFar.dispose();
      material.dispose();
      depthMaterial.dispose();
    },
    stats: () => ({ total, near: nNear, far: nFar, triangles: nNear * triNear + nFar * triFar }),
  };
}

function createRockMaterial(u: TerrainUniforms, tier: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name: 'terrain-rock', roughness: 0.8, metalness: 0 });
  mat.defines = { ...mat.defines, TERRAIN_TIER: tier };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = u.tNoise;
    shader.uniforms.tShadowH = u.tShadowH;
    shader.uniforms.tWorldInfo = u.tWorldInfo;
    shader.uniforms.tLightDir = u.tLightDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', ROCK_SELECT_NORMAL)
      .replace('#include <begin_vertex>', ROCK_SELECT_POSITION)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${ROCK_WORLD_VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${SHADE_COMMON_GLSL}\n${ROCK_FRAGMENT_PARS}\nuniform vec4 tWorldInfo;\nuniform vec3 tLightDir;\n${TERRAIN_SHADOW_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `${ROCK_SHADE}\nfloat rShadow = 1.0;\n#if TERRAIN_TIER > 0\nrShadow = terrainSunShadow(vRPos + rNw * 0.6, tLightDir);\n#endif`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.82, 0.3, rWet);')
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(tBump(rNw, vRPos, rBumpH), 0.0)).xyz);\nnonPerturbedNormal = normal;',
      )
      .replace(
        '#include <lights_fragment_begin>',
        THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= rShadow;',
        ),
      )
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= rAO;\nreflectedLight.directDiffuse *= mix(1.0, rAO, 0.5);');
  };
  mat.customProgramCacheKey = () => `fox-terrain-rock-${tier}`;
  return mat;
}

function createRockDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  // the shadow pass sees the light camera as cameraPosition
  mat.defines = { ROCK_NO_FADE: '' };
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', ROCK_SELECT_POSITION);
  };
  mat.customProgramCacheKey = () => 'fox-terrain-rock-depth';
  return mat;
}
