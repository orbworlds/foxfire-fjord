/**
 * What the sea needs to know about Foxfire Fjord's coast, baked once from the
 * world's height grid: the signed shore distance (slush lines follow it round
 * every bay and skerry), the offshore direction, black-sand shelves vs rock,
 * and the winter sea ice: how sheltered each stretch of water is (the inner
 * fjord lies mirror-calm), where shore-fast ice has grown (the fjord head,
 * sheltered coves, the sides of Lysvik harbour), and where drift ice floats.
 */
import * as THREE from 'three';
import type { World } from '../../world/world';
import { createSimplex2D, fbm, smoothstep, clamp } from '../../world/noise';
import { VILLAGE, BEACH } from '../../world/layout';

export interface CoastData {
  /** RGBA half float over world.bounds: R signed shore distance (m, + offshore), G sandy bottom 0..1, BA unit offshore direction */
  texture: THREE.DataTexture;
  /** uv = (x * xf.x + xf.y, z * xf.z + xf.w), texel centers aligned with the grid samples */
  xf: THREE.Vector4;
  /** the raw grid (for the ice bake) */
  grid: { w: number; h: number; cell: number; minX: number; minZ: number; sd: Float32Array; height: Float32Array };
}

export interface IceData {
  /** RGBA8 on the coast grid: R shelter 0..1, G shore-fast ice 0..1, B drift-ice density 0..1, A slush/grease ice 0..1 */
  texture: THREE.DataTexture;
  /** CPU lookup of the same fields (bilinear) */
  sample(x: number, z: number): { shelter: number; fast: number; drift: number; slush: number };
}

/** uv transform for a texture whose texels sit exactly on a grid spanning `bounds` inclusively. */
export function gridUvTransform(bounds: World['bounds'], nx: number, nz: number): THREE.Vector4 {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  const ax = (nx - 1) / (w * nx);
  const az = (nz - 1) / (h * nz);
  return new THREE.Vector4(ax, (-bounds.minX * (nx - 1)) / w / nx + 0.5 / nx, az, (-bounds.minZ * (nz - 1)) / h / nz + 0.5 / nz);
}

/** Two-pass 3×3 chamfer distance transform (meters) from cells where `seed` is set. */
function chamfer(seed: Uint8Array, w: number, h: number, cell: number): Float32Array {
  const d = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : INF;
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - w] + a);
        if (i > 0) v = Math.min(v, d[k - w - 1] + b);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + b);
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < w - 1) v = Math.min(v, d[k + 1] + a);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + a);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + b);
        if (i > 0) v = Math.min(v, d[k + w - 1] + b);
      }
      d[k] = v;
    }
  }
  return d;
}

/** Separable box blur with radius r, in place, `passes` times. */
function blur(src: Float32Array, w: number, h: number, r: number, passes: number): void {
  const tmp = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < h; j++) {
      const row = j * w;
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let o = -r; o <= r; o++) s += src[row + Math.min(w - 1, Math.max(0, i + o))];
        tmp[row + i] = s * inv;
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let o = -r; o <= r; o++) s += tmp[Math.min(h - 1, Math.max(0, j + o)) * w + i];
        src[j * w + i] = s * inv;
      }
    }
  }
}

/**
 * Bakes what the ocean shader needs to know about the coast from the world's
 * height grid: a smooth signed distance to the shoreline (surf lines travel
 * along it, so they wrap around the bay, the harbor and every islet), the
 * offshore direction, and whether the bottom is sand (gentle shelf) or rock.
 */
export function buildCoastTexture(world: World): CoastData {
  const step = world.gridNX > 700 ? 2 : 1;
  const w = Math.floor((world.gridNX - 1) / step) + 1;
  const h = Math.floor((world.gridNZ - 1) / step) + 1;
  const b = world.bounds;
  const cell = ((b.maxX - b.minX) / (world.gridNX - 1)) * step;
  const height = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) height[j * w + i] = world.heightGrid[j * step * world.gridNX + i * step];
  }

  const land = new Uint8Array(w * h);
  const water = new Uint8Array(w * h);
  for (let k = 0; k < land.length; k++) {
    land[k] = height[k] > 0 ? 1 : 0;
    water[k] = 1 - land[k];
  }
  const toLand = chamfer(land, w, h, cell);
  const toWater = chamfer(water, w, h, cell);
  const sd = new Float32Array(w * h);
  for (let k = 0; k < sd.length; k++) {
    sd[k] = land[k] ? -Math.max(0, toWater[k] - cell * 0.5) : Math.max(0, toLand[k] - cell * 0.5);
    sd[k] = Math.min(260, Math.max(-60, sd[k]));
  }
  blur(sd, w, h, 2, 2);

  // sandy where the bottom is a gentle shelf, rocky off cliffs and around islets
  const sand = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const hl = height[j * w + Math.max(0, i - 1)];
      const hr = height[j * w + Math.min(w - 1, i + 1)];
      const hd = height[Math.max(0, j - 1) * w + i];
      const hu = height[Math.min(h - 1, j + 1) * w + i];
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * cell);
      sand[k] = 1 - THREE.MathUtils.smoothstep(slope, 0.075, 0.17);
    }
  }
  blur(sand, w, h, 2, 2);

  const data = new Uint16Array(w * h * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const gx = sd[j * w + Math.min(w - 1, i + 1)] - sd[j * w + Math.max(0, i - 1)];
      const gz = sd[Math.min(h - 1, j + 1) * w + i] - sd[Math.max(0, j - 1) * w + i];
      const gl = Math.hypot(gx, gz) || 1;
      data[k * 4] = toHalf(sd[k]);
      data[k * 4 + 1] = toHalf(sand[k]);
      data[k * 4 + 2] = toHalf(gx / gl);
      data[k * 4 + 3] = toHalf(gz / gl);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { texture: tex, xf: gridUvTransform(b, w, h), grid: { w, h, cell, minX: b.minX, minZ: b.minZ, sd, height } };
}

/** The open channel kept free of ice in front of Lysvik's quay, where the boats lie. */
/**
 * Lysvik harbour: open water only where the boats keep it open, a berth along the quay front and a
 * channel out to the fjord; the rest of the basin lies frozen. Signed distance (m, > 0 in the ice).
 */
function harbourIce(x: number, z: number): number {
  const q = VILLAGE.quay;
  const berth = Math.max(q.minX + 6 - x, x - q.maxX + 6, q.minZ - 24 - z, z - q.minZ - 5);
  const cz = VILLAGE.harbor.z;
  // the channel bends a little toward the open fjord in the west as it leaves the basin
  const cx = VILLAGE.harbor.x - Math.max(0, cz - z) * 0.25;
  const channel = Math.max(Math.abs(x - cx) - 22, cz - 190 - z, z - q.minZ);
  return Math.min(berth, channel);
}
/** Fast ice fills the fjord east of here (ragged edge). */
const FJORD_ICE_X = 760;

/**
 * Bakes the sea-ice fields. Shelter is the share of 24 compass rays (out to
 * 1.8 km, nearer land weighing more) that hit land; shore-fast ice grows
 * where the water is sheltered and near the shore, fills the fjord head and
 * the coves beside the harbour (leaving the lead in front of the quay open);
 * drift ice gathers off the fast-ice edge and thins toward the fjord mouth.
 */
export function buildIceTexture(coast: CoastData): IceData {
  const { w, h, cell, minX, minZ, sd, height } = coast.grid;
  const N = w * h;
  // ---- shelter on a coarse grid
  const cs = 4;
  const cw = Math.ceil(w / cs) + 1;
  const ch = Math.ceil(h / cs) + 1;
  const coarse = new Float32Array(cw * ch);
  const DIRS = 24;
  const maxD = 1800;
  const stepM = cell * 3;
  const landAt = (x: number, z: number) => {
    const i = Math.round((x - minX) / cell);
    const j = Math.round((z - minZ) / cell);
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    return height[j * w + i] > 0;
  };
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      const x = minX + ci * cs * cell;
      const z = minZ + cj * cs * cell;
      let acc = 0;
      for (let d = 0; d < DIRS; d++) {
        const a = (d / DIRS) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        for (let t = stepM; t < maxD; t += stepM * (1 + t / 600)) {
          if (landAt(x + dx * t, z + dz * t)) {
            acc += 1 - 0.45 * (t / maxD);
            break;
          }
        }
      }
      coarse[cj * cw + ci] = acc / DIRS;
    }
  }
  const shelter = new Float32Array(N);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const fx = i / cs;
      const fz = j / cs;
      const i0 = Math.min(cw - 2, Math.floor(fx));
      const j0 = Math.min(ch - 2, Math.floor(fz));
      const tx = fx - i0;
      const tz = fz - j0;
      const a = coarse[j0 * cw + i0];
      const b = coarse[j0 * cw + i0 + 1];
      const c = coarse[(j0 + 1) * cw + i0];
      const d = coarse[(j0 + 1) * cw + i0 + 1];
      shelter[j * w + i] = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }
  }

  // ---- fast ice and drift ice
  const nA = createSimplex2D(4401);
  const nB = createSimplex2D(4402);
  const fast = new Float32Array(N);
  const drift = new Float32Array(N);
  const slush = new Float32Array(N);
  const hx = VILLAGE.harbor.x;
  const hz = VILLAGE.harbor.z;
  for (let j = 0; j < h; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = minX + i * cell;
      const d = sd[k];
      if (d <= -2) continue;
      const s = shelter[k];
      const sh = smoothstep(0.5, 0.88, s);
      const n1 = fbm(nA, x / 260, z / 260, 3);
      const n2 = fbm(nB, x / 60, z / 60, 2);
      // a belt of shore ice along sheltered shores, ragged at its edge
      const belt = (5 + 42 * sh) * (0.7 + 0.6 * (n1 * 0.5 + 0.5)) + n2 * 6;
      let f = clamp((belt - d) / 4, 0, 1) * smoothstep(0.5, 0.68, s);
      // the fjord head: frozen right across, a ragged edge drifting west along the shores
      const head = FJORD_ICE_X + n1 * 140 + n2 * 25 - Math.max(0, 160 - d) * 0.9;
      f = Math.max(f, clamp((x - head) / 12, 0, 1) * smoothstep(0.55, 0.7, s));
      // Lysvik harbour: ice in the coves either side of the quay, the lead in front of it open
      const hd = Math.hypot(x - hx, (z - hz) * 1.3);
      let lead = 0;
      if (hd < 340) {
        const open = harbourIce(x, z) - n2 * 6;
        const hi = clamp((230 + n1 * 40 - d) / 8, 0, 1) * clamp(open / 4, 0, 1) * (1 - smoothstep(260, 340, hd));
        // the boats keep the berth and the channel clear of the shore-ice belt too
        f *= clamp((open + 2) / 4, 0, 1);
        f = Math.max(f, hi);
        // slush and brash in the channel the boats keep open
        lead = clamp(-open / 6, 0, 1) * (1 - smoothstep(200, 300, hd));
      }
      // the Ice Beach is open to the swell: no shore ice there, a little slush in the swash
      const beachK = 1 - smoothstep(BEACH.halfLength + 30, BEACH.halfLength + 150, Math.hypot(x - BEACH.center.x, z - BEACH.center.z));
      f *= 1 - beachK;
      fast[k] = f;
      // drift ice: off the fast-ice edge and in the inner fjord, none out at sea
      const inner = smoothstep(0.52, 0.8, s) * (0.25 + 0.75 * smoothstep(-900, FJORD_ICE_X, x));
      // dense off the fast-ice edge, a scatter of floes in front of the cabin, open water at the mouth
      const off = Math.exp(-Math.max(0, x < head ? head - x : 0) / 260);
      drift[k] = clamp(inner * (0.1 + 0.9 * off) * (0.75 + 0.35 * n1) * (1 - f), 0, 1);
      // slush and grease ice along the shores and the ice edges
      slush[k] = Math.max(clamp(1 - d / (8 + 25 * sh), 0, 1) * smoothstep(0.42, 0.75, s) * (1 - 0.65 * beachK), lead * 0.7);
    }
  }
  // the slush also gathers along the fast-ice edge
  const edge = new Float32Array(N);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      const g = Math.abs(fast[k + 1] - fast[k - 1]) + Math.abs(fast[k + w] - fast[k - w]);
      edge[k] = Math.min(1, g * 2);
    }
  }
  const data = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    data[k * 4] = Math.round(shelter[k] * 255);
    data[k * 4 + 1] = Math.round(fast[k] * 255);
    data[k * 4 + 2] = Math.round(drift[k] * 255);
    data[k * 4 + 3] = Math.round(Math.min(1, Math.max(slush[k], edge[k] * 0.8)) * 255);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const sample = (x: number, z: number) => {
    const fx = clamp((x - minX) / cell, 0, w - 1.001);
    const fz = clamp((z - minZ) / cell, 0, h - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const at = (c: number) => {
      const k = j * w + i;
      const a = data[k * 4 + c];
      const b = data[(k + 1) * 4 + c];
      const cc = data[(k + w) * 4 + c];
      const d = data[(k + w + 1) * 4 + c];
      return ((a + (b - a) * tx) * (1 - tz) + (cc + (d - cc) * tx) * tz) / 255;
    };
    return { shelter: at(0), fast: at(1), drift: at(2), slush: at(3) };
  };
  return { texture: tex, sample };
}
