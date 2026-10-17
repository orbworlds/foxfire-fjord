/**
 * Island map raster for Foxfire Fjord: a winter topographic map. Snow with
 * blue-shadowed hillshade, bare gneiss on the steep faces, spruce woods
 * stippled from the real forest, Mirror Lake's ice, the fjord's shore-fast
 * ice and drift floes over a dark navy sea, a dark rock / black-sand shore
 * line, and blue-grey contours every 50 m. Pure functions over the baked
 * height grid so it can run in slices (or offline in node for previews).
 */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type RGB = [number, number, number];

/** snow by elevation: faintly blue in the low valleys, whiter on the fells */
const LAND: [number, RGB][] = [
  [0, [221, 228, 237]],
  [8, [229, 236, 244]],
  [120, [236, 241, 248]],
  [350, [243, 246, 251]],
  [700, [249, 251, 254]],
];

const SEA: [number, RGB][] = [
  [0, [52, 82, 112]],
  [3, [38, 64, 94]],
  [12, [26, 48, 76]],
  [40, [17, 34, 58]],
  [120, [11, 24, 44]],
];

const ROCK: RGB = [92, 99, 110];
const SHORE: RGB = [54, 60, 70];
const FAST_ICE: RGB = [204, 219, 234];
const DRIFT: RGB = [150, 176, 202];
const LAKE_ICE: RGB = [150, 178, 200];
const LAKE_DARK: RGB = [96, 126, 152];
const FOREST: RGB = [40, 60, 62];

function ramp(stops: [number, RGB][], v: number, out: RGB): RGB {
  if (v <= stops[0][0]) {
    out[0] = stops[0][1][0];
    out[1] = stops[0][1][1];
    out[2] = stops[0][1][2];
    return out;
  }
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      out[0] = ca[0] + (cb[0] - ca[0]) * t;
      out[1] = ca[1] + (cb[1] - ca[1]) * t;
      out[2] = ca[2] + (cb[2] - ca[2]) * t;
      return out;
    }
  }
  const c = stops[stops.length - 1][1];
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  return out;
}

export interface MapExtras {
  /** sea ice at a world point (from the ocean feature), if it is loaded */
  iceAt?: (x: number, z: number) => { fast: number; drift: number };
  /** the frozen lake: inside test (> 0 inside, metres from the shore) and its ice level */
  lake?: { depth: (x: number, z: number) => number; y: number };
  /** forest cover 0..1 per output pixel (row-major width × height), from the flora feature */
  forest?: Float32Array;
}

function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Render rows [row0, row1) of the map into `data` (RGBA, width × height over `view`).
 */
export function renderMapRows(
  grid: Float32Array,
  nx: number,
  nz: number,
  bounds: Rect,
  view: Rect,
  width: number,
  height: number,
  data: Uint8ClampedArray,
  row0: number,
  row1: number,
  extras: MapExtras = {},
): void {
  const cellX = (bounds.maxX - bounds.minX) / (nx - 1);
  const cellZ = (bounds.maxZ - bounds.minZ) / (nz - 1);
  const mpp = (view.maxX - view.minX) / width;
  const sample = (x: number, z: number): number => {
    const fx = (x - bounds.minX) / cellX;
    const fz = (z - bounds.minZ) / cellZ;
    const ix = fx < 0 ? 0 : fx > nx - 2 ? nx - 2 : Math.floor(fx);
    const iz = fz < 0 ? 0 : fz > nz - 2 ? nz - 2 : Math.floor(fz);
    const tx = Math.min(1, Math.max(0, fx - ix));
    const tz = Math.min(1, Math.max(0, fz - iz));
    const k = iz * nx + ix;
    const a = grid[k];
    const b = grid[k + 1];
    const c = grid[k + nx];
    const d = grid[k + nx + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
  // light from the north-west, 40° above the horizon (classic cartographic hillshade)
  const alt = 40 * (Math.PI / 180);
  const lx = -Math.cos(alt) * Math.SQRT1_2;
  const ly = Math.sin(alt);
  const lz = -Math.cos(alt) * Math.SQRT1_2;
  const exaggeration = 1.6;
  const col: RGB = [0, 0, 0];
  const ex = Math.max(cellX, mpp);
  const ez = Math.max(cellZ, mpp);
  const { iceAt, lake, forest } = extras;
  for (let j = row0; j < row1; j++) {
    const z = view.minZ + ((j + 0.5) / height) * (view.maxZ - view.minZ);
    for (let i = 0; i < width; i++) {
      const x = view.minX + ((i + 0.5) / width) * (view.maxX - view.minX);
      const h = sample(x, z);
      const k = (j * width + i) * 4;
      if (h < 0) {
        ramp(SEA, -h, col);
        let r = col[0];
        let g = col[1];
        let b = col[2];
        if (iceAt) {
          const ice = iceAt(x, z);
          // floes as a fine speckle, fast ice as a pale sheet with a faint grain
          const n = hash2(i, j);
          const drift = Math.min(1, ice.drift * 1.3) * (n > 0.45 ? 0.75 : 0.25);
          r += (DRIFT[0] - r) * drift;
          g += (DRIFT[1] - g) * drift;
          b += (DRIFT[2] - b) * drift;
          const fast = Math.min(1, ice.fast * 1.15);
          const grain = 0.94 + 0.06 * n;
          r += (FAST_ICE[0] * grain - r) * fast;
          g += (FAST_ICE[1] * grain - g) * fast;
          b += (FAST_ICE[2] * grain - b) * fast;
        }
        // the shore: a dark rim of black sand and rock under the water's edge
        if (h > -1.4) {
          const w = 1 + h / 1.4;
          r += (SHORE[0] - r) * w * 0.55;
          g += (SHORE[1] - g) * w * 0.55;
          b += (SHORE[2] - b) * w * 0.55;
        }
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
        continue;
      }
      const hx = (sample(x + ex, z) - sample(x - ex, z)) / (2 * ex);
      const hz = (sample(x, z + ez) - sample(x, z - ez)) / (2 * ez);
      const slope = Math.sqrt(hx * hx + hz * hz);
      ramp(LAND, h, col);
      let r = col[0];
      let g = col[1];
      let b = col[2];
      // bare rock where the snow cannot hold (steeper than ~40°), streaked
      const rock = Math.min(1, Math.max(0, (slope - 0.72) / 0.5)) * (0.75 + 0.25 * hash2(i * 3, j));
      r += (ROCK[0] - r) * rock;
      g += (ROCK[1] - g) * rock;
      b += (ROCK[2] - b) * rock;
      // spruce woods: stippled from the real trees
      if (forest) {
        const f = forest[j * width + i];
        if (f > 0) {
          const m = Math.min(0.82, f * 0.9);
          r += (FOREST[0] - r) * m;
          g += (FOREST[1] - g) * m;
          b += (FOREST[2] - b) * m;
        }
      }
      // Mirror Lake's ice: black ice in the middle, snowier toward the shore
      let onIce = false;
      if (lake && Math.abs(h - lake.y) < 0.25) {
        const d = lake.depth(x, z);
        if (d > 0) {
          onIce = true;
          const t = Math.min(1, d / 60);
          const streak = 0.5 + 0.5 * Math.sin(x * 0.045 + z * 0.11 + Math.sin(z * 0.03) * 2);
          r = LAKE_ICE[0] + (LAKE_DARK[0] - LAKE_ICE[0]) * t * (0.7 + 0.3 * streak);
          g = LAKE_ICE[1] + (LAKE_DARK[1] - LAKE_ICE[1]) * t * (0.7 + 0.3 * streak);
          b = LAKE_ICE[2] + (LAKE_DARK[2] - LAKE_ICE[2]) * t * (0.7 + 0.3 * streak);
        }
      }
      if (!onIce) {
        const nxv = -hx * exaggeration;
        const nzv = -hz * exaggeration;
        const inv = 1 / Math.sqrt(nxv * nxv + 1 + nzv * nzv);
        const shade = ((nxv * lx + ly + nzv * lz) * inv) / ly;
        const s = 0.5 + 0.5 * Math.min(1.3, Math.max(0, shade));
        // shadows on snow turn blue: red and green fall faster than blue
        r *= s;
        g *= 0.08 + 0.92 * s;
        b *= 0.3 + 0.7 * s;
        // contours every 50 m, index contours every 250 m
        if (h > 4) {
          const grad = slope * mpp;
          if (grad > 1e-4) {
            const f = h / 50;
            const dist = Math.abs(f - Math.round(f)) * 50;
            const px = dist / grad;
            const index = Math.round(f) % 5 === 0;
            const a = Math.max(0, 1 - px / (index ? 0.95 : 0.7)) * (index ? 0.26 : 0.13);
            r += (70 - r) * a;
            g += (92 - g) * a;
            b += (128 - b) * a;
          }
        }
      }
      // a dark line of black sand and rock right at the shore
      if (h < 1.2) {
        const w = 1 - h / 1.2;
        r += (SHORE[0] - r) * w * 0.8;
        g += (SHORE[1] - g) * w * 0.8;
        b += (SHORE[2] - b) * w * 0.8;
      }
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
  }
}

/**
 * Forest cover per map pixel from tree crowns: 1 − exp(−Σ crown area / pixel area),
 * spruce counting fully and birch by half (bare winter crowns).
 */
export function forestCover(trees: { x: number; z: number; kind: number; r: number }[], view: Rect, width: number, height: number, out?: Float32Array): Float32Array {
  const acc = out ?? new Float32Array(width * height);
  const sx = width / (view.maxX - view.minX);
  const sz = height / (view.maxZ - view.minZ);
  const pixArea = 1 / (sx * sz);
  for (const t of trees) {
    if (t.kind > 1) continue;
    const i = Math.floor((t.x - view.minX) * sx);
    const j = Math.floor((t.z - view.minZ) * sz);
    if (i < 0 || j < 0 || i >= width || j >= height) continue;
    acc[j * width + i] += (Math.PI * t.r * t.r * (t.kind === 0 ? 1 : 0.4)) / pixArea;
  }
  return acc;
}

/** Turn accumulated crown area into a 0..1 cover with a soft 3×3 spread (call once after all forestCover batches). */
export function finishForest(acc: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let s = acc[j * width + i] * 0.6;
      if (i > 0) s += acc[j * width + i - 1] * 0.1;
      if (i < width - 1) s += acc[j * width + i + 1] * 0.1;
      if (j > 0) s += acc[(j - 1) * width + i] * 0.1;
      if (j < height - 1) s += acc[(j + 1) * width + i] * 0.1;
      out[j * width + i] = 1 - Math.exp(-s * 1.4);
    }
  }
  return out;
}

/** Land bounding box of the grid (cells above sea level), padded. */
export function landBounds(grid: Float32Array, nx: number, nz: number, bounds: Rect, pad: number): Rect {
  let minI = nx;
  let maxI = 0;
  let minJ = nz;
  let maxJ = 0;
  const step = Math.max(1, Math.floor(nx / 256));
  for (let j = 0; j < nz; j += step) {
    for (let i = 0; i < nx; i += step) {
      if (grid[j * nx + i] > 0.5) {
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
      }
    }
  }
  if (maxI <= minI || maxJ <= minJ) return { ...bounds };
  const cx = (bounds.maxX - bounds.minX) / (nx - 1);
  const cz = (bounds.maxZ - bounds.minZ) / (nz - 1);
  return {
    minX: Math.max(bounds.minX, bounds.minX + minI * cx - pad),
    maxX: Math.min(bounds.maxX, bounds.minX + maxI * cx + pad),
    minZ: Math.max(bounds.minZ, bounds.minZ + minJ * cz - pad),
    maxZ: Math.min(bounds.maxZ, bounds.minZ + maxJ * cz + pad),
  };
}

/** Grow a rect to a square around its centre (the round minimap). */
export function squareRect(r: Rect): Rect {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const h = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2;
  return { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
}
