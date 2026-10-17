/**
 * Stranded glacier ice on the black sand: smooth, glassy chunks from fist-
 * to car-sized, rounded by the sea, with a few clean fracture faces. Most of
 * each chunk is clear (dark, showing what lies behind it, blue-green where
 * the light went through a lot of ice); bands and cores of tiny bubbles are
 * milky white, and the chunks stranded above the swash have a frosted crust
 * on top. Clustered where the swash dumps them; some lie half in the water.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../world/noise';
import { boulderGeometry, noise3, paintVertices } from '../paths/kit/rocks';
import { HERO_ICE, ICE_CLUSTERS, shorePoint, type HeightFn } from './layout';

export interface IceParts {
  /** chunks in the swash: wet, never snowed */
  wet: THREE.BufferGeometry[];
  /** chunks stranded higher up: a frosted top and a dusting of snow */
  dry: THREE.BufferGeometry[];
  /** big chunks (for colliders and the info card) */
  big: { x: number; z: number; r: number; top: number }[];
}

function gauss(rnd: () => number): number {
  return (rnd() + rnd() + rnd() - 1.5) * 1.15;
}

/** unit chunk shapes per detail level (building a shape costs ~2 ms; 170 of them would be too slow) */
const TEMPLATES = 8;

export function buildIce(H: HeightFn, Hf: HeightFn, fancy: boolean): IceParts {
  const rnd = mulberry32(8803);
  const templates = new Map<string, THREE.BufferGeometry>();
  const template = (detail: number, t: number): THREE.BufferGeometry => {
    const key = `${detail}:${t}`;
    let g = templates.get(key);
    if (!g) {
      g = boulderGeometry(9000 + detail * 100 + t, {
        sx: 1,
        sy: 1,
        sz: 1,
        detail,
        // rounded by the sea, with clean fracture faces where it broke off the berg
        lumps: 0.2,
        grain: 0.01,
        facets: 4 + (t % 4),
        facetDepth: 1,
        flatBottom: 0.35,
      });
      templates.set(key, g);
    }
    return g;
  };
  const wet: THREE.BufferGeometry[] = [];
  const dry: THREE.BufferGeometry[] = [];
  const big: IceParts['big'] = [];
  const N = fancy ? 230 : 150;
  const shares = ICE_CLUSTERS.map((c) => c[2]);
  const total = shares.reduce((a, b) => a + b, 0);
  for (let k = 0; k < N + HERO_ICE.length; k++) {
    let s: number;
    let level: number;
    let r: number;
    let roll = rnd();
    const hero = k >= N ? HERO_ICE[k - N] : null;
    if (hero) {
      [s, level, r] = hero;
      roll = level > 0.6 ? 0.9 : 0.5;
    } else {
      // pick a cluster by share
      let u = rnd() * total;
      let ci = 0;
      while (ci < ICE_CLUSTERS.length - 1 && u > shares[ci]) u -= shares[ci++];
      const [s0, spread] = ICE_CLUSTERS[ci];
      s = s0 + gauss(rnd) * spread;
      // most lie at the edge of the swash and on the wet sand, some higher up, a few big ones at the storm line
      level = roll < 0.5 ? -0.25 + rnd() * 0.6 : roll < 0.88 ? 0.35 + rnd() * 0.9 : 1.3 + rnd() * 1.0;
      // sizes: many fist-sized pieces, fewer big ones; the biggest were stranded by the highest waves
      r = 0.07 + Math.pow(rnd(), 2.3) * 0.95;
      if (roll >= 0.88) r = Math.max(r, 0.45 + rnd() * 0.8);
    }
    const p = shorePoint(Hf, s, level);
    if (!p) continue;
    const slab = rnd() < 0.35;
    // fine enough that the sea-rounded body shades smoothly and only the fracture faces read as edges
    const detail = r > 0.9 ? (fancy ? 6 : 5) : r > 0.5 ? (fancy ? 5 : 4) : r > 0.25 ? (fancy ? 4 : 3) : 2;
    // shapes come from a small set of unit templates per detail level, stretched and turned per chunk
    const g = template(detail, Math.floor(rnd() * TEMPLATES)).clone();
    g.scale(r * (1 + rnd() * 0.5), r * (slab ? 0.35 + rnd() * 0.2 : 0.6 + rnd() * 0.35), r * (0.7 + rnd() * 0.4));
    g.computeVertexNormals();
    const high = level > 0.6;
    // bubble bands: tilted layers of milky ice; some chunks have a white core
    const ax = new THREE.Vector3(rnd() - 0.5, 1.5, rnd() - 0.5).normalize();
    const freq = 3 + rnd() * 5;
    const ph = rnd() * 10;
    const core = rnd() < 0.15 ? 0.3 + rnd() * 0.35 : 0;
    const blue = 0.8 + rnd() * 0.4;
    // a few chunks are white through and through (old bubbly ice), most are clear with milky bands
    const kind = rnd();
    const allMilky = kind < 0.1 ? 0.55 + rnd() * 0.3 : 0;
    const bandT = kind > 0.6 ? 0.95 : 0.76;
    const ns = rnd() * 40;
    paintVertices(g, (q, n, c) => {
      const qn = new THREE.Vector3(q.x / r, q.y / r, q.z / r);
      const band = Math.sin(qn.dot(ax) * freq + ph + noise3(qn.x * 1.5 + ns, qn.y * 1.5, qn.z * 1.5) * 0.9);
      // bubble layers as soft bands; old white ice cloudy all through, a little clearer toward the rim
      let milky = Math.max(
        THREE.MathUtils.smoothstep(band, bandT, bandT + 0.3) * 0.66,
        allMilky * (0.85 + 0.25 * noise3(qn.x * 1.4 + ns, qn.y * 1.4, qn.z * 1.4)) * (1 - 0.35 * THREE.MathUtils.smoothstep(qn.length(), 0.6, 1.1)),
      );
      if (core > 0) milky = Math.max(milky, (1 - THREE.MathUtils.smoothstep(qn.length(), core * 0.5, core * 1.2)) * 0.5);
      // frost on the dry top of stranded chunks
      if (high) milky = Math.max(milky, THREE.MathUtils.smoothstep(n.y, 0.5, 0.9) * (0.25 + 0.3 * noise3(q.x * 7 + ns, q.y * 7, q.z * 7)));
      // clear ice: dark blue-green (the material shows what is behind it); milky: blue-white
      c.setRGB(0.012, 0.022 * blue, 0.028 * blue).lerp(new THREE.Color(0.72, 0.82, 0.9), milky);
    });
    g.rotateY(rnd() * Math.PI * 2);
    g.rotateZ((rnd() - 0.5) * 0.35);
    // crisp edges where the fracture faces meet the sea-rounded body: glass, not jelly
    const gc = toCreasedNormals(g, 0.62);
    const gy = H(p.x, p.z);
    // in the swash the sand is wet and soft: chunks sit in their own scour hollows
    const sink = level < 0.4 ? 0.25 : 0.15;
    gc.translate(p.x, Math.max(gy, -0.6) + r * 0.25 - r * sink, p.z);
    (high ? dry : wet).push(gc);
    if (r > 0.45) big.push({ x: p.x, z: p.z, r: r * 1.1, top: gy + r });
  }
  for (const g of templates.values()) g.dispose();
  return { wet, dry, big };
}
