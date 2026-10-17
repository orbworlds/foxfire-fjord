/**
 * Deterministic, allocation-free noise for CPU-side world generation.
 * All world generation must be reproducible, so never use Math.random() for
 * placement — use `mulberry32(seed)` or `hash2`.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer-lattice hash in [0, 1). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
]);

function buildPerm(seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

export interface Noise2D {
  (x: number, y: number): number;
}

/** 2D simplex noise in roughly [-1, 1]. */
export function createSimplex2D(seed: number): Noise2D {
  const perm = buildPerm(seed);
  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = (perm[ii + perm[jj]] % 12) * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = (perm[ii + i1 + perm[jj + j1]] % 12) * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = (perm[ii + 1 + perm[jj + 1]] % 12) * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}

/** Fractal Brownian motion over a 2D noise. Output roughly in [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(fx, fy);
    norm += amp;
    amp *= gain;
    // rotate each octave slightly to break grid alignment
    const nx = fx * 1.6 - fy * 1.2;
    const ny = fx * 1.2 + fy * 1.6;
    fx = nx * (lacunarity / 2) + 17.3;
    fy = ny * (lacunarity / 2) - 9.1;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests, good for gullies and ridges. */
export function ridged(noise: Noise2D, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(fx, fy));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= 0.5;
    const nx = fx * 1.6 - fy * 1.2;
    const ny = fx * 1.2 + fy * 1.6;
    fx = nx + 5.7;
    fy = ny - 3.3;
  }
  return Math.min(1, sum);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
