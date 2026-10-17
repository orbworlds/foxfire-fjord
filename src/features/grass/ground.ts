/**
 * Where anything grows through the snow, how tall and what kind — deterministic
 * ground rules for the winter ground cover.
 *
 * Almost everything is buried. Grass shows only where the snow is thin or gone:
 *   - wind-scoured ridges and convex tops (the terrain's scour: exposed, convex,
 *     high ground where it paints heather and rock through a thin crust), and
 *     a little on the exposed coastal knolls: short bleached straw;
 *   - the hot spring's melt ring: wet ground and lush green moss and grass in
 *     a ring round the pool, a strong patch of colour in the snow;
 *   - under dense spruce, where the crowns hold the snow off the ground: a few
 *     dry tufts in the needle litter;
 *   - Ice Beach's back dunes: tussocks of lyme grass on the black sand.
 *
 * Coarse rules are evaluated on a small per-chunk grid and interpolated; fine
 * rules (paths, masks, reservations, the cabin) per blade.
 */
import type * as THREE from 'three';
import type { World } from '../../world/world';
import { BEACH, HOUSE, HOUSE_FOOTPRINT, PATHS, SPRING, type Box2 } from '../../world/layout';
import { samplePath } from '../../world/paths';
import { meltAt } from '../spring/layout';
import { clamp, createSimplex2D, smoothstep } from '../../world/noise';

/** Hard keep-out around the cabin: walls, plinth, deck and the drift against them. */
export const HOUSE_KEEPOUT: Box2 = {
  minX: HOUSE.x + HOUSE_FOOTPRINT.minX - 1.2,
  maxX: HOUSE.x + HOUSE_FOOTPRINT.maxX + 1.2,
  minZ: HOUSE.z + HOUSE_FOOTPRINT.minZ - 1.2,
  maxZ: HOUSE.z + HOUSE_FOOTPRINT.maxZ + 1.2,
};

/** Outer radius of the hot spring's melt ring (matches the terrain's tSpring.z). */
export const MELT_R = 9.5;

const nPatch = createSimplex2D(9101);
const nPatch2 = createSimplex2D(9102);

/** Slow height variation of the tufts (taller and shorter swathes), ~0.7..1.3. */
export function swardVariation(x: number, z: number): number {
  return 1 + 0.22 * nPatch(x / 9, z / 9) + 0.14 * nPatch2(x / 31, z / 31);
}

/* ------------------------------------------------------------------ */
/* Paths: distance to the walking-surface edge                          */
/* ------------------------------------------------------------------ */

export interface PathHit {
  /** distance (m) beyond the visible path edge; negative on the path; Infinity if far */
  edge: number;
  tx: number;
  tz: number;
  /** index into PATHS */
  path: number;
}

const PATH_CELL = 8;
const PATH_REACH = 4;

export class PathField {
  private seg: Float32Array;
  private segPath: Uint16Array;
  private grid = new Map<number, number[]>();

  constructor() {
    const s: number[] = [];
    const sp: number[] = [];
    PATHS.forEach((p, pi) => {
      const samples = samplePath(p, 1);
      const half = p.width * 0.5 + (p.kind === 'boardwalk' ? 0.1 : 0.3);
      for (let i = 0; i < samples.length - 1; i++) {
        s.push(samples[i].x, samples[i].z, samples[i + 1].x, samples[i + 1].z, half);
        sp.push(pi);
      }
    });
    this.seg = new Float32Array(s);
    this.segPath = new Uint16Array(sp);
    const n = sp.length;
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const r = this.seg[o + 4] + PATH_REACH;
      const x0 = Math.floor((Math.min(this.seg[o], this.seg[o + 2]) - r) / PATH_CELL);
      const x1 = Math.floor((Math.max(this.seg[o], this.seg[o + 2]) + r) / PATH_CELL);
      const z0 = Math.floor((Math.min(this.seg[o + 1], this.seg[o + 3]) - r) / PATH_CELL);
      const z1 = Math.floor((Math.max(this.seg[o + 1], this.seg[o + 3]) + r) / PATH_CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = (cx + 4096) * 8192 + (cz + 4096);
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  query(x: number, z: number, out: PathHit): PathHit {
    out.edge = Infinity;
    out.path = -1;
    const list = this.grid.get((Math.floor(x / PATH_CELL) + 4096) * 8192 + (Math.floor(z / PATH_CELL) + 4096));
    if (!list) return out;
    const s = this.seg;
    for (let k = 0; k < list.length; k++) {
      const o = list[k] * 5;
      const ax = s[o];
      const az = s[o + 1];
      const abx = s[o + 2] - ax;
      const abz = s[o + 3] - az;
      const len2 = abx * abx + abz * abz || 1e-6;
      let t = ((x - ax) * abx + (z - az) * abz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + abx * t);
      const dz = z - (az + abz * t);
      const e = Math.sqrt(dx * dx + dz * dz) - s[o + 4];
      if (e < out.edge) {
        out.edge = e;
        const l = Math.sqrt(len2);
        out.tx = abx / l;
        out.tz = abz / l;
        out.path = this.segPath[list[k]];
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* CPU readers of the terrain's textures                                */
/* ------------------------------------------------------------------ */

/** CPU reader for the shared RGBA noise texture: bilinear with repeat wrapping, like the shaders sample it. */
export class NoiseTex {
  private data: ArrayLike<number>;
  private n: number;

  constructor(tex: THREE.DataTexture) {
    const img = tex.image as { data: ArrayLike<number>; width: number };
    this.data = img.data;
    this.n = img.width;
  }

  /** channel c (0 r … 3 a) at texture coordinates (u, v), 0..1 */
  sample(u: number, v: number, c: number): number {
    const n = this.n;
    const fx = u * n - 0.5;
    const fy = v * n - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const i0 = ((i % n) + n) % n;
    const j0 = ((j % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const j1 = (j0 + 1) % n;
    const d = this.data;
    const a = d[(j0 * n + i0) * 4 + c];
    const b = d[(j0 * n + i1) * 4 + c];
    const e = d[(j1 * n + i0) * 4 + c];
    const f = d[(j1 * n + i1) * 4 + c];
    return ((a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty) / 255;
  }
}

/** Bilinear, clamped reader of an RGBA8 texture laid over the world: uv = (xz - info.xy) * info.zw. */
class WorldTex {
  private data: ArrayLike<number>;
  private w: number;
  private h: number;
  constructor(
    tex: THREE.DataTexture,
    /** (minX, minZ, 1 / width, 1 / depth) in metres */
    private info: THREE.Vector4,
  ) {
    const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
    this.data = img.data;
    this.w = img.width;
    this.h = img.height;
  }
  sample(x: number, z: number, c: number): number {
    const fx = Math.min(this.w - 1, Math.max(0, (x - this.info.x) * this.info.z * this.w - 0.5));
    const fz = Math.min(this.h - 1, Math.max(0, (z - this.info.y) * this.info.w * this.h - 0.5));
    const i = Math.min(this.w - 2, Math.floor(fx));
    const j = Math.min(this.h - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const d = this.data;
    const o = (j * this.w + i) * 4 + c;
    const o2 = o + this.w * 4;
    const a = d[o] + (d[o + 4] - d[o]) * tx;
    const b = d[o2] + (d[o2 + 4] - d[o2]) * tx;
    return (a + (b - a) * tz) / 255;
  }
}

/**
 * The terrain's vegetation mask (R tree cover, G open scrub, B clearing, A birch
 * share): grass gathers in the needle litter under dense spruce.
 */
export class VegCover extends WorldTex {
  tree(x: number, z: number): number {
    return this.sample(x, z, 0);
  }
  birch(x: number, z: number): number {
    return this.sample(x, z, 3);
  }
}

/**
 * The terrain's baked macro data (RGBA8: normal x, normal z, cavity, wind shelter),
 * so the grass finds the same scoured crests the terrain paints with heather.
 */
export class TerrainData {
  private data: ArrayLike<number>;
  private w: number;
  private h: number;
  constructor(
    tex: THREE.DataTexture,
    /** tCoarseInfo: (minX, minZ, texels per metre x, texels per metre z), texel centres at integers */
    private info: THREE.Vector4,
  ) {
    const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
    this.data = img.data;
    this.w = img.width;
    this.h = img.height;
  }
  private ch(x: number, z: number, c: number): number {
    const fx = Math.min(this.w - 1.001, Math.max(0, (x - this.info.x) * this.info.z));
    const fz = Math.min(this.h - 1.001, Math.max(0, (z - this.info.y) * this.info.w));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const d = this.data;
    const o = (j * this.w + i) * 4 + c;
    const o2 = o + this.w * 4;
    const a = d[o] + (d[o + 4] - d[o]) * tx;
    const b = d[o2] + (d[o2 + 4] - d[o2]) * tx;
    return (a + (b - a) * tz) / 255;
  }
  /** cavity as the terrain shader reads it: > 0 concave, < 0 convex */
  cavity(x: number, z: number): number {
    return (this.ch(x, z, 2) - 0.5) * 8;
  }
  /** -1 scoured … +1 sheltered lee */
  shelter(x: number, z: number): number {
    return (this.ch(x, z, 3) - 0.5) * 2;
  }
}

/* ------------------------------------------------------------------ */
/* Coarse rules                                                         */
/* ------------------------------------------------------------------ */

export interface Coarse {
  /** 0..1 fraction of the maximum blade density (straw and moss) */
  density: number;
  /** mean blade height (m) */
  height: number;
  /** fraction of the blades that are bleached straw (the rest keep some colour) */
  dry: number;
  /** 0..1 lyme-grass zone on the back beach */
  lyme: number;
  /** 0..1 the hot spring's melt ring (green, lush) */
  moss: number;
}

/** Melt ring weight at a point, as the terrain shader draws it (sd jittered by the same noise). */
export function meltWeight(noise: NoiseTex | null, x: number, z: number, h: number): number {
  const dx = x - SPRING.x;
  const dz = z - SPRING.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > MELT_R * 1.12 + 3) return 0;
  // the spring's melt decal (spring/layout.ts) decides where the ground is bare; the sward stays on it
  let m = meltAt(x, z);
  if (noise) m += (noise.sample(x / 11, z / 11, 2) - 0.5) * 0.3;
  const w = smoothstep(0.34, 0.72, m);
  return w * clamp((h - SPRING.y + 6) / 3, 0, 1);
}

export function coarseRules(rules: GroundRules, x: number, z: number, h: number, slope: number, out: Coarse): Coarse {
  out.density = out.height = out.dry = out.lyme = out.moss = 0;
  if (h < 1.6) return out;
  const { veg, noise, terrain } = rules;

  // the hot spring's melt ring (drawn by its own always-detailed layer)
  const melt = meltWeight(noise, x, z, h);
  if (rules.melt === 'only') {
    out.moss = melt;
    out.density = melt;
    out.height = 0.2 + 0.22 * melt;
    out.dry = 0.08;
    return out;
  }
  if (melt > 0 && rules.melt === 'all') {
    out.moss = melt;
    out.density = melt;
    out.height = 0.16 + 0.1 * melt;
    out.dry = 0.08;
  }

  // lyme grass on Ice Beach's back dunes (mirrors the flora's tussock band)
  const bdx = x - BEACH.center.x;
  const bdz = z - BEACH.center.z;
  const bd = Math.sqrt(bdx * bdx + bdz * bdz) / (BEACH.halfLength * 1.35);
  if (bd < 1 && h < 9) {
    const band = smoothstep(2.5, 3.6, h) * (1 - smoothstep(6.5, 9, h)) * (1 - smoothstep(0.85, 1, bd)) * (1 - smoothstep(0.45, 0.65, slope));
    out.lyme = band;
  }

  // wind-scoured crests and knolls: straw through a thin crust
  let scour = 0;
  if (terrain && melt < 0.5) {
    const cav = terrain.cavity(x, z);
    const exposed = clamp(-terrain.shelter(x, z) * 1.6, 0, 1);
    let nCg = 0.5;
    if (noise) {
      const r2x = 0.6216 * x + 0.7833 * z;
      const r2z = -0.7833 * x + 0.6216 * z;
      nCg = noise.sample(r2x / 90, r2z / 90, 1);
    }
    // as the terrain shader's `scour` (heather and rock through the snow) …
    const high = exposed * clamp((h - 140) / 220, 0, 1) * clamp(0.4 - cav * 0.25, 0, 1) * clamp((nCg - 0.38) * 3, 0, 1);
    // … and the lower convex knolls the storms keep bare in patches
    const low = exposed * clamp(-cav * 0.4 - 0.2, 0, 1) * smoothstep(12, 40, h) * (1 - smoothstep(140, 200, h)) * clamp((nCg - 0.55) * 3, 0, 1) * 0.4;
    // … and the high domes and summits, scoured from every side
    const top = clamp(-cav * 0.35, 0, 1) * smoothstep(360, 480, h) * clamp((nCg - 0.3) * 2.5, 0, 1);
    scour = Math.max(smoothstep(0.08, 0.4, Math.max(high, top)), low);
    // not on the rock faces
    scour *= 1 - smoothstep(0.7, 1.0, slope);
  }
  // dry tufts in the needle litter under dense spruce
  let litter = 0;
  if (veg && melt < 0.5) {
    const t = veg.tree(x, z);
    if (t > 0.4) litter = smoothstep(0.5, 0.8, t) * (1 - smoothstep(0.35, 0.6, veg.birch(x, z))) * 0.14;
  }
  const straw = Math.max(scour * 0.7, litter);
  if (straw > out.density) {
    const k = straw;
    out.height = out.density > 0 ? out.height : 0.16 + 0.16 * scour * (1 - 0.4 * smoothstep(400, 600, h));
    out.dry = out.density > 0 ? out.dry : 0.92;
    out.density = k;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Per-chunk coarse grid                                                */
/* ------------------------------------------------------------------ */

export interface RuleGrid {
  n: number;
  step: number;
  x0: number;
  z0: number;
  density: Float32Array;
  height: Float32Array;
  dry: Float32Array;
  lyme: Float32Array;
  moss: Float32Array;
  nx: Float32Array;
  nz: Float32Array;
  minY: number;
  maxY: number;
  /** largest density + lyme value anywhere in the chunk (0 → nothing grows) */
  peak: number;
}

const coarseTmp: Coarse = { density: 0, height: 0, dry: 0, lyme: 0, moss: 0 };

/** Builds a chunk's rule grid in row slices: exact heights first, then the rules. */
export class RuleGridBuilder {
  readonly grid: RuleGrid;
  private hb: Float32Array;
  private nb: number;
  private hRow = 0;
  private rRow = 0;

  constructor(
    private rules: GroundRules,
    x0: number,
    z0: number,
    size: number,
    step: number,
  ) {
    const n = Math.round(size / step) + 1;
    this.nb = n + 2;
    this.hb = new Float32Array(this.nb * this.nb);
    this.grid = {
      n,
      step,
      x0,
      z0,
      density: new Float32Array(n * n),
      height: new Float32Array(n * n),
      dry: new Float32Array(n * n),
      lyme: new Float32Array(n * n),
      moss: new Float32Array(n * n),
      nx: new Float32Array(n * n),
      nz: new Float32Array(n * n),
      minY: Infinity,
      maxY: -Infinity,
      peak: 0,
    };
  }

  /** Continue until the grid is complete (true) or `deadline` (performance.now()) passes (false). */
  step(deadline: number): boolean {
    const g = this.grid;
    const { n, step, x0, z0 } = g;
    const { nb, hb, rules } = this;
    while (this.hRow < nb) {
      if (performance.now() > deadline) return false;
      const j = this.hRow++;
      for (let i = 0; i < nb; i++) hb[j * nb + i] = rules.world.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    }
    while (this.rRow < n) {
      if (performance.now() > deadline) return false;
      const j = this.rRow++;
      for (let i = 0; i < n; i++) {
        const c = (j + 1) * nb + (i + 1);
        const h = hb[c];
        const ddx = (hb[c - 1] - hb[c + 1]) / (2 * step);
        const ddz = (hb[c - nb] - hb[c + nb]) / (2 * step);
        const inv = 1 / Math.sqrt(ddx * ddx + 1 + ddz * ddz);
        const k = j * n + i;
        g.nx[k] = ddx * inv;
        g.nz[k] = ddz * inv;
        const slope = Math.sqrt(ddx * ddx + ddz * ddz);
        coarseRules(rules, x0 + i * step, z0 + j * step, h, slope, coarseTmp);
        g.density[k] = coarseTmp.density;
        g.height[k] = coarseTmp.height;
        g.dry[k] = coarseTmp.dry;
        g.lyme[k] = coarseTmp.lyme;
        g.moss[k] = coarseTmp.moss;
        g.peak = Math.max(g.peak, coarseTmp.density + coarseTmp.lyme);
        if (h < g.minY) g.minY = h;
        if (h > g.maxY) g.maxY = h;
      }
    }
    return true;
  }
}

export interface GridSample {
  density: number;
  height: number;
  dry: number;
  lyme: number;
  moss: number;
  nx: number;
  nz: number;
}

/** Bilinear lookup at chunk-relative unit coordinates (u, v) ∈ [0, 1]. */
export function sampleGrid(g: RuleGrid, u: number, v: number, out: GridSample): GridSample {
  const f = g.n - 1;
  const fx = clamp(u, 0, 1) * f;
  const fz = clamp(v, 0, 1) * f;
  const ix = Math.min(f - 1, Math.floor(fx));
  const iz = Math.min(f - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const a = iz * g.n + ix;
  const b = a + 1;
  const c = a + g.n;
  const d = c + 1;
  const w0 = (1 - tx) * (1 - tz);
  const w1 = tx * (1 - tz);
  const w2 = (1 - tx) * tz;
  const w3 = tx * tz;
  out.density = g.density[a] * w0 + g.density[b] * w1 + g.density[c] * w2 + g.density[d] * w3;
  out.height = g.height[a] * w0 + g.height[b] * w1 + g.height[c] * w2 + g.height[d] * w3;
  out.dry = g.dry[a] * w0 + g.dry[b] * w1 + g.dry[c] * w2 + g.dry[d] * w3;
  out.lyme = g.lyme[a] * w0 + g.lyme[b] * w1 + g.lyme[c] * w2 + g.lyme[d] * w3;
  out.moss = g.moss[a] * w0 + g.moss[b] * w1 + g.moss[c] * w2 + g.moss[d] * w3;
  out.nx = g.nx[a] * w0 + g.nx[b] * w1 + g.nx[c] * w2 + g.nx[d] * w3;
  out.nz = g.nz[a] * w0 + g.nz[b] * w1 + g.nz[c] * w2 + g.nz[d] * w3;
  return out;
}

/* ------------------------------------------------------------------ */
/* Fine rules                                                           */
/* ------------------------------------------------------------------ */

export interface Fine {
  /** 0..1 density multiplier */
  density: number;
  /** 0..1 height multiplier (trimmed edges) */
  height: number;
}

export class GroundRules {
  readonly paths = new PathField();
  private px: [number, number, number, number] = [0, 0, 0, 0];
  private hit: PathHit = { edge: Infinity, tx: 0, tz: 0, path: -1 };

  constructor(
    readonly world: World,
    readonly veg: VegCover | null = null,
    readonly noise: NoiseTex | null = null,
    readonly terrain: TerrainData | null = null,
    /** the melt ring: with everything else ('all'), left out ('none') or alone ('only') */
    readonly melt: 'all' | 'none' | 'only' = 'all',
  ) {}

  fine(x: number, z: number, out: Fine): Fine {
    out.density = 0;
    out.height = 1;
    const k = HOUSE_KEEPOUT;
    if (x > k.minX && x < k.maxX && z > k.minZ && z < k.maxZ) return out;
    const masks = this.world.masks;
    const m = masks.sampleLocal(x, z, this.px);
    if (m[2] > 0.06 || m[1] > 0.1 || m[0] > 0.2) return out;
    const p = this.paths.query(x, z, this.hit);
    if (p.edge < 0.1) return out;
    // the spring's own site is reserved as a whole: there only the pool and the hut side are kept clear
    const sdx = x - SPRING.x;
    const sdz = z - SPRING.z;
    const sd = Math.sqrt(sdx * sdx + sdz * sdz);
    if (sd < MELT_R + 1.5) {
      if (sd < SPRING.r + 0.7 || x > SPRING.x + 7.5) return out;
    } else if (this.world.isReserved(x, z)) return out;
    let d = 1;
    let hgt = 1;
    if (p.edge < 1.5) {
      d = 0.22 + 0.78 * smoothstep(0.1, 1.2, p.edge);
      hgt = 0.42 + 0.58 * smoothstep(0.1, 1.5, p.edge);
    }
    if (m[0] > 0.01) d *= 1 - Math.min(1, m[0] * 4);
    out.density = d;
    out.height = hgt;
    return out;
  }

  /** Path edge info at a point (shared scratch object — copy what you need). */
  pathAt(x: number, z: number): PathHit {
    return this.paths.query(x, z, this.hit);
  }
}
