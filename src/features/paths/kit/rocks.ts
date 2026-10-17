/**
 * Procedural stone geometry shared by the outdoor sites:
 *   - boulderGeometry: rounded gneiss boulders (hot-spring rim, cairns, beach stones)
 *   - flatStoneGeometry: slabs and flags (a ring mesh whose outline is shaped by
 *                        a few harmonics): hut plinths, the cairn, stepping stones
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSimplex2D, mulberry32 } from '../../../world/noise';
import { applyBoxUV } from '../../../core/geometry';

const nA = createSimplex2D(101);
const nB = createSimplex2D(202);
const nC = createSimplex2D(303);

/** Cheap 3D noise from three rotated 2D simplex slices, roughly [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  return (nA(x + 0.31 * z, y - 0.27 * z) + nB(y + 0.17 * x, z - 0.21 * x) + nC(z + 0.23 * y, x - 0.19 * y)) * 0.42;
}

export interface BoulderOpts {
  /** half extents in meters */
  sx: number;
  sy: number;
  sz: number;
  /** icosahedron subdivision (2 → 320 tris, 3 → 1280 tris) */
  detail?: number;
  /** low-frequency lumpiness */
  lumps?: number;
  /** fine surface roughness */
  grain?: number;
  /** number of flattening planes (weathered facets) */
  facets?: number;
  /** 0..1 how strongly facets are cut */
  facetDepth?: number;
  /** flatten everything below -flatBottom * sy (sunk / resting face) */
  flatBottom?: number;
  /** depth of sharp ridged-noise cracks and seams (0 = none) */
  crease?: number;
}

/** A rounded, slightly faceted boulder centered at the origin (meter UVs, smooth normals). */
export function boulderGeometry(seed: number, o: BoulderOpts): THREE.BufferGeometry {
  const rnd = mulberry32(seed * 7919 + 13);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const ox = rnd() * 50;
  const oy = rnd() * 50;
  const oz = rnd() * 50;
  const planes: { n: THREE.Vector3; c: number }[] = [];
  const nf = o.facets ?? 5;
  for (let i = 0; i < nf; i++) {
    const th = rnd() * Math.PI * 2;
    const y = rnd() * 1.5 - 0.5;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    planes.push({ n: new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r), c: 0.7 + rnd() * 0.22 });
  }
  const lumps = o.lumps ?? 0.16;
  const grain = o.grain ?? 0.035;
  const depth = o.facetDepth ?? 0.75;
  const fb = -(o.flatBottom ?? 0.55);
  const crease = o.crease ?? 0;
  const creaseOf = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r =
      1 +
      lumps * noise3(v.x * 1.2 + ox, v.y * 1.2 + oy, v.z * 1.2 + oz) +
      grain * noise3(v.x * 4.5 + oy, v.y * 4.5 + oz, v.z * 4.5 + ox) +
      grain * 0.45 * noise3(v.x * 11 + oz, v.y * 11 + ox, v.z * 11 + oy);
    if (crease > 0) {
      const k = 1 - Math.min(1, Math.abs(noise3(v.x * 2.3 + oz, v.y * 2.3 + ox, v.z * 2.3 + oy)) * 2.4);
      creaseOf[i] = k * k * k;
      r -= crease * creaseOf[i];
    }
    v.multiplyScalar(r);
    for (const pl of planes) {
      const d = v.dot(pl.n) - pl.c;
      if (d > 0) v.addScaledVector(pl.n, -d * depth);
    }
    if (v.y < fb) v.y = fb + (v.y - fb) * 0.2;
    pos.setXYZ(i, v.x * o.sx, v.y * o.sy, v.z * o.sz);
  }
  g.computeVertexNormals();
  applyBoxUV(g);
  // per-vertex crack depth 0..1 (index-aligned) so callers can darken the seams
  g.userData.crease = creaseOf;
  return g;
}

/** Add / overwrite a vertex color attribute computed from (local position, normal). */
export function paintVertices(
  g: THREE.BufferGeometry,
  fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color, i: number) => void,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    c.setRGB(1, 1, 1);
    fn(p, n, c, i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Unit "flat stone" ring mesh: radius 1 at the widest ring, bottom at y = 0,
 * top at y = 1, centered on the y axis. Rings: top center, inner top, bevel,
 * shoulder, buried foot. No bottom cap (always sunk into the ground).
 */
export function puckGeometry(segments = 20): THREE.BufferGeometry {
  // [radius, y, normal y-bias]
  const rings: [number, number][] = [
    [0.5, 1.0],
    [0.84, 0.985],
    [0.95, 0.93],
    [1.0, 0.8],
    [0.99, 0.35],
    [0.96, 0.0],
  ];
  const positions: number[] = [0, 1.012, 0];
  for (const [r, y] of rings) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % segments);
    idx.push(0, b, a);
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = 1 + k * segments;
    const r1 = r0 + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(r0 + s, r0 + s1, r1 + s);
      idx.push(r0 + s1, r1 + s1, r1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i);
    uv[i * 2 + 1] = pos.getZ(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Outline harmonics for a stone outline. `angular` (0..1) adds higher harmonics for split slabs. */
export function stoneHarmonics(seed: number, angular = 0): { a: number[]; p: number[] } {
  const rnd = mulberry32(seed * 104729 + 7);
  const ks = [2, 3, 4, 5, 7];
  const base = [0.06, 0.07, 0.045, 0.03, 0.018];
  const a: number[] = [];
  const p: number[] = [];
  for (let i = 0; i < ks.length; i++) {
    a.push(base[i] * (0.4 + rnd() * 0.9) * (1 + angular * (i >= 2 ? 1.6 : 0.6)));
    p.push(rnd() * Math.PI * 2);
  }
  return { a, p };
}

/**
 * CPU version of the flat stone: a puck reshaped by outline harmonics,
 * scaled to (rx, thickness, rz). Meter UVs; bottom at y = 0.
 */
export function flatStoneGeometry(seed: number, rx: number, thickness: number, rz: number, angular = 0, segments = 22): THREE.BufferGeometry {
  const g = puckGeometry(segments);
  const { a, p } = stoneHarmonics(seed, angular);
  const ks = [2, 3, 4, 5, 7];
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rnd = mulberry32(seed * 31 + 3);
  const dome = 0.02 + rnd() * 0.05;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = pos.getY(i);
    const th = Math.atan2(z, x);
    let R = 1;
    for (let k = 0; k < ks.length; k++) R += a[k] * Math.cos(ks[k] * th + p[k]);
    const rr = Math.hypot(x, z);
    if (y > 0.9) y += dome * (1 - rr * rr) * 1.0;
    pos.setXYZ(i, x * R * rx, y * thickness, z * R * rz);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  applyBoxUV(g);
  return g;
}
