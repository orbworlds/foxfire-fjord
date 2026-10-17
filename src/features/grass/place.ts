/**
 * Per-candidate placement for blades and far tufts (straw on the scoured
 * crests, green grass and moss in the hot spring's melt ring, lyme grass on
 * Ice Beach's dunes, a few dried seed stalks).
 *
 * Candidate k of a chunk sits on an R2 low-discrepancy point (plus a small
 * hash jitter), so every prefix of the sequence is evenly spread: a chunk far
 * from the camera evaluates only the first few candidates, and coming closer
 * simply continues the sequence. A candidate either becomes one instance
 * (12 floats, see STRIDE) or is rejected by the ground rules.
 */
import type { World } from '../../world/world';
import { hash2 } from '../../world/noise';
import { KIND_LYME, KIND_MOSS, KIND_SEED, KIND_STRAW } from './config';
import { sampleGrid, swardVariation, type Fine, type GridSample, type GroundRules, type RuleGrid } from './ground';

const A1 = 0.7548776662466927;
const A2 = 0.5698402909980532;

/** share of the candidate budget that becomes lyme grass where lyme = 1 */
export const LYME_SHARE = 0.3;
export const LYME_SHARE_TUFT = 0.12;
const LYME_CELL = 1.6;
const LYME_PULL = 0.15;
/** straw grows in small tussocks poking out of the crust */
const TUSSOCK_CELL = 0.9;
const TUSSOCK_PULL = 0.3;
const SEED_SHARE = 0.03;

/** What the evaluators need to know about a chunk. */
export interface CandidateSource {
  x0: number;
  z0: number;
  size: number;
  grid: RuleGrid;
  /** max of density + share * lyme over the chunk grid */
  peak: number;
  nFull: number;
  offU: number;
  offV: number;
  /** jitter amplitude in unit chunk coordinates */
  jit: number;
  hseed: number;
  /** exact heights on the terrain's vertex lattice around the chunk */
  hgt: Float32Array;
  hx0: number;
  hz0: number;
  hs: number;
  hN: number;
}

/** Bilinear height from the chunk lattice (matches the rendered terrain surface). */
export function latticeHeight(c: CandidateSource, x: number, z: number): number {
  const n = c.hN;
  const fx = Math.min(n - 1.001, Math.max(0, (x - c.hx0) / c.hs));
  const fz = Math.min(n - 1.001, Math.max(0, (z - c.hz0) / c.hs));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const h = c.hgt;
  const o = j * n + i;
  const a = h[o];
  const b = h[o + 1];
  const d = h[o + n];
  const e = h[o + n + 1];
  return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
}

export interface PlaceEnv {
  world: World;
  rules: GroundRules;
}

/* mulberry32 seeded per candidate: deterministic, allocation free */
let rs = 0;
function rseed(a: number, b: number, c: number): void {
  rs = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x632be5ab, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) | 0;
}
function rnd(): number {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Chunk-specific constants for the candidate sequence. */
export function sequenceSeed(cx: number, cz: number, layer: number): { offU: number; offV: number; hseed: number } {
  return {
    offU: hash2(cx, cz, 31 + layer),
    offV: hash2(cx, cz, 37 + layer),
    hseed: ((cz & 0xffff) << 16) ^ (cx & 0xffff) ^ (layer * 0x5bd1e995),
  };
}

/* candidate position of the last beginCandidate() call */
let cu = 0;
let cv = 0;

/**
 * Seeds candidate k and computes its chunk-unit position; returns the index of
 * the sub-cell (of `sub` × `sub`) it falls into. Must precede evalBlade / evalTuft.
 */
export function beginCandidate(c: CandidateSource, k: number, layerSalt: number, sub: number): number {
  rseed(k, c.hseed, layerSalt);
  const ju = rnd();
  const jv = rnd();
  cu = frac(c.offU + k * A1 + (ju - 0.5) * c.jit);
  cv = frac(c.offV + k * A2 + (jv - 0.5) * c.jit);
  return Math.min(sub - 1, Math.floor(cv * sub)) * sub + Math.min(sub - 1, Math.floor(cu * sub));
}

export const SALT_BLADE = 0x51ed27;
export const SALT_TUFT = 0x2f6b4d;

const gs: GridSample = { density: 0, height: 0, dry: 0, lyme: 0, moss: 0, nx: 0, nz: 0 };
const fine: Fine = { density: 0, height: 1 };

function writeTint(out: Float32Array, o: number, kind: number, dryShare: number): void {
  const r = rnd();
  // straw zones are all bleached; in the melt ring a few blades have died back
  const dry = r < dryShare ? 0.82 + 0.18 * rnd() : 0.12 * rnd() * rnd();
  out[o + 8] = (rnd() - 0.5) * 1.6;
  out[o + 9] = kind === KIND_LYME ? Math.min(1, dry + 0.5) : kind === KIND_MOSS ? 0 : dry;
  out[o + 10] = gs.nx;
  out[o + 11] = gs.nz;
}

/** Near-range blade clump. Returns false if candidate k grows nothing. */
export function evalBlade(env: PlaceEnv, c: CandidateSource, k: number, out: Float32Array, o: number): boolean {
  const pick = rnd();
  const u = cu;
  const v = cv;
  sampleGrid(c.grid, u, v, gs);
  const pv = pick * c.peak;
  let kind: number;
  if (pv < gs.density) kind = gs.moss > 0.25 && rnd() < 0.5 ? KIND_MOSS : KIND_STRAW;
  else if (pv < gs.density + LYME_SHARE * gs.lyme) kind = KIND_LYME;
  else return false;

  let x = c.x0 + u * c.size;
  let z = c.z0 + v * c.size;
  let facing: number;
  let lean: number;
  if (kind !== KIND_LYME) {
    facing = rnd() * Math.PI * 2;
    const r = rnd();
    lean = kind === KIND_MOSS ? 0.7 + 0.5 * r : 0.08 + 0.4 * r * r;
    if (kind === KIND_STRAW && gs.moss < 0.3) {
      const ix = Math.floor(x / TUSSOCK_CELL);
      const iz = Math.floor(z / TUSSOCK_CELL);
      if (hash2(ix, iz, 95) > 0.3 + 0.5 * Math.min(1, gs.density * 1.5)) return false;
      x = (ix + 0.3 + 0.4 * hash2(ix, iz, 96)) * TUSSOCK_CELL + (x - (ix + 0.5) * TUSSOCK_CELL) * TUSSOCK_PULL;
      z = (iz + 0.3 + 0.4 * hash2(ix, iz, 97)) * TUSSOCK_CELL + (z - (iz + 0.5) * TUSSOCK_CELL) * TUSSOCK_PULL;
      lean += 0.25;
    }
  } else {
    // lyme grass grows in tussocks with bare sand between
    const ix = Math.floor(x / LYME_CELL);
    const iz = Math.floor(z / LYME_CELL);
    if (hash2(ix, iz, 91) > 0.2 + 0.45 * gs.lyme) return false;
    const px = (ix + 0.3 + 0.4 * hash2(ix, iz, 92)) * LYME_CELL;
    const pz = (iz + 0.3 + 0.4 * hash2(ix, iz, 93)) * LYME_CELL;
    const dx = (x - px) * LYME_PULL;
    const dz = (z - pz) * LYME_PULL;
    x = px + dx;
    z = pz + dz;
    const nd = Math.min(1, Math.sqrt(dx * dx + dz * dz) / (LYME_CELL * 0.6 * LYME_PULL));
    facing = Math.atan2(dz, dx) - Math.PI * 0.5 + (rnd() - 0.5) * 1.6;
    lean = 0.25 + 0.5 * nd + 0.15 * rnd();
  }

  env.rules.fine(x, z, fine);
  if (fine.density <= 0) return false;
  if (rnd() > fine.density) return false;
  const hMul = fine.height;

  const r2 = rnd();
  const r3 = rnd();
  let height: number;
  let width: number;
  if (kind === KIND_STRAW) {
    height = gs.height * hMul * swardVariation(x, z) * (0.62 + 0.76 * Math.pow(r2, 0.9));
    width = 0.009 + 0.006 * r3;
    if (rnd() < SEED_SHARE) {
      kind = KIND_SEED;
      height *= 1.7 + 0.6 * rnd();
      width = 0.004;
      lean *= 0.4;
    }
  } else if (kind === KIND_MOSS) {
    // low cushions of moss and liverwort in the warm wet ground
    height = (0.035 + 0.045 * r2) * hMul;
    width = 0.035 + 0.025 * r3;
  } else {
    height = (0.45 + 0.4 * r2) * (0.6 + 0.4 * gs.lyme) * hMul;
    width = 0.011 + 0.005 * r3;
  }
  if (height < 0.03) return false;

  out[o] = x - c.x0;
  out[o + 1] = latticeHeight(c, x, z) - 0.03;
  out[o + 2] = z - c.z0;
  out[o + 3] = k / c.nFull;
  out[o + 4] = height;
  out[o + 5] = width;
  out[o + 6] = facing;
  out[o + 7] = kind * 2 + Math.min(1.6, lean);
  writeTint(out, o, kind, gs.dry);
  return true;
}

/** Far-range tuft (three crossed cards standing in for a clump of blades). */
export function evalTuft(env: PlaceEnv, c: CandidateSource, k: number, out: Float32Array, o: number): boolean {
  const pick = rnd();
  const u = cu;
  const v = cv;
  sampleGrid(c.grid, u, v, gs);
  const pv = pick * c.peak;
  let kind: number;
  if (pv < gs.density) kind = gs.moss > 0.25 && rnd() < 0.5 ? KIND_MOSS : KIND_STRAW;
  else if (pv < gs.density + LYME_SHARE_TUFT * gs.lyme) kind = KIND_LYME;
  else return false;

  let x = c.x0 + u * c.size;
  let z = c.z0 + v * c.size;
  if (kind === KIND_LYME) {
    const ix = Math.floor(x / LYME_CELL);
    const iz = Math.floor(z / LYME_CELL);
    if (hash2(ix, iz, 91) > 0.2 + 0.45 * gs.lyme) return false;
    x = (ix + 0.3 + 0.4 * hash2(ix, iz, 92)) * LYME_CELL;
    z = (iz + 0.3 + 0.4 * hash2(ix, iz, 93)) * LYME_CELL;
  }

  env.rules.fine(x, z, fine);
  if (fine.density <= 0) return false;
  if (rnd() > fine.density) return false;
  const hMul = fine.height;

  const r2 = rnd();
  const r3 = rnd();
  let height: number;
  let width: number;
  if (kind === KIND_STRAW) {
    height = gs.height * hMul * swardVariation(x, z) * (0.78 + 0.44 * r2);
    width = 0.07 + 0.04 * r3;
  } else if (kind === KIND_MOSS) {
    height = (0.05 + 0.04 * r2) * hMul;
    width = 0.14 + 0.06 * r3;
  } else {
    height = (0.5 + 0.3 * r2) * (0.6 + 0.4 * gs.lyme) * hMul;
    width = 0.08 + 0.03 * r3;
  }
  if (height < 0.035) return false;

  out[o] = x - c.x0;
  out[o + 1] = latticeHeight(c, x, z) - 0.03;
  out[o + 2] = z - c.z0;
  out[o + 3] = k / c.nFull;
  out[o + 4] = height;
  out[o + 5] = width;
  out[o + 6] = rnd() * Math.PI;
  out[o + 7] = kind * 2 + (kind === KIND_MOSS ? 0.9 : 0.12 + 0.2 * rnd());
  writeTint(out, o, kind, gs.dry);
  return true;
}
