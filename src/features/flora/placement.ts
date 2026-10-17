/**
 * The boreal forest scatter (deterministic).
 *
 * The terrain's vegetation mask (terrain/veg.ts: R tree cover, G open dwarf
 * scrub, B clearing factor, A birch share) decides everything, so the trees
 * stand exactly where the terrain darkens its snow and draws its far canopy:
 * Norway spruce in the sheltered valleys and on the lower slopes (treeline
 * ~150-200 m), mountain birch on the margins, the coast, the lake shore and up
 * to ~300 m, juniper and dwarf birch poking out of the snow above the trees,
 * nothing on the lake, the fjord, the crests or in the clearings and view
 * corridors the mask keeps open. On top of the mask:
 *   - a jittered 4.6 m grid; spruce stands close, birch woods stay open;
 *   - stand edges get young spruce, the treeline narrow snow-loaded candles;
 *   - dried fireweed and angelica stalks along the path shoulders and in the
 *     glades of the lowland woods; lyme-grass tussocks on Ice Beach's dunes;
 *   - every tour viewpoint keeps its frame: nothing rises above the sightline;
 *   - no trunk on a path, a building or any reserved spot.
 */
import type * as THREE from 'three';
import type { World } from '../../world/world';
import { BEACH, HOUSE, SITES, VIEWPOINTS, VILLAGE } from '../../world/layout';
import { coastDistance } from '../../world/terrain-height';
import { hash2, createSimplex2D, fbm, smoothstep as smooth } from '../../world/noise';

export const TPL = {
  spruceTall: 0,
  spruceMid: 1,
  spruceNarrow: 2,
  spruceYoung: 3,
  birchTall: 4,
  birchLow: 5,
  juniper: 6,
  dwarfBirch: 7,
  stalks: 8,
  lyme: 9,
} as const;

/** template heights in metres at scale 1 (sightline tests) */
export const TPL_HEIGHT = [17, 11, 7.5, 3.2, 9, 5.5, 0.75, 0.8, 1.25, 0.95];

/** low plants: no shadow casting, cheaper quality key */
export const SMALL_TEMPLATES = [TPL.juniper, TPL.dwarfBirch, TPL.stalks, TPL.lyme];

export interface ForestData {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  yaw: Float32Array;
  /** tilt about x and z (radians) */
  tiltX: Float32Array;
  tiltZ: Float32Array;
  template: Uint8Array;
  /** 0/1: mirror the impostor */
  flip: Uint8Array;
  /** brightness multiplier */
  tint: Float32Array;
  /** quality key in [0,1): an instance is shown when key < threshold(quality) */
  key: Float32Array;
}

export function densityThreshold(vegetationDensity: number): number {
  return 0.55 + 0.45 * Math.min(1, Math.max(0, vegetationDensity));
}

/* ------------------------------------------------------------------ */
/* The vegetation mask                                                 */
/* ------------------------------------------------------------------ */

export interface VegSample {
  tree: number;
  open: number;
  clear: number;
  birch: number;
}

/** CPU reader of the terrain's vegetation mask (bilinear, clamped). */
export class VegMask {
  private data: ArrayLike<number>;
  private w: number;
  private h: number;
  constructor(
    tex: THREE.DataTexture,
    readonly info: THREE.Vector4,
  ) {
    const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
    this.data = img.data;
    this.w = img.width;
    this.h = img.height;
    // texels with any tree or scrub cover in their 3x3 neighbourhood (bilinear support)
    const w = this.w;
    const h = this.h;
    const any = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) any[i] = this.data[i * 4] > 0 || this.data[i * 4 + 1] > 0 ? 1 : 0;
    this.live = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let v = 0;
        for (let dj = -1; dj <= 1 && !v; dj++) {
          const jj = Math.min(h - 1, Math.max(0, j + dj));
          for (let di = -1; di <= 1; di++) {
            if (any[jj * w + Math.min(w - 1, Math.max(0, i + di))]) {
              v = 1;
              break;
            }
          }
        }
        this.live[j * w + i] = v;
      }
    }
  }
  private live: Uint8Array;
  get bounds(): { minX: number; minZ: number; maxX: number; maxZ: number } {
    return { minX: this.info.x, minZ: this.info.y, maxX: this.info.x + 1 / this.info.z, maxZ: this.info.y + 1 / this.info.w };
  }
  sample(x: number, z: number, out: VegSample): VegSample {
    const fx = (x - this.info.x) * this.info.z * this.w - 0.5;
    const fz = (z - this.info.y) * this.info.w * this.h - 0.5;
    if (fx < 0 || fz < 0 || fx > this.w - 1 || fz > this.h - 1) {
      out.tree = out.open = out.birch = 0;
      out.clear = 1;
      return out;
    }
    const i = Math.min(this.w - 2, Math.floor(fx));
    const j = Math.min(this.h - 2, Math.floor(fz));
    if (!this.live[j * this.w + i]) {
      // no cover anywhere near: skip the bilinear reads
      out.tree = out.open = 0;
      out.birch = 0.5;
      out.clear = 1;
      return out;
    }
    const tx = fx - i;
    const tz = fz - j;
    const d = this.data;
    const o = (j * this.w + i) * 4;
    const o2 = o + this.w * 4;
    const ch = (c: number) => {
      const a = d[o + c] + (d[o + 4 + c] - d[o + c]) * tx;
      const b = d[o2 + c] + (d[o2 + 4 + c] - d[o2 + c]) * tx;
      return (a + (b - a) * tz) / 255;
    };
    out.tree = ch(0);
    out.open = ch(1);
    out.clear = ch(2);
    out.birch = ch(3);
    return out;
  }
}

/** Without the terrain feature: a plain elevation / slope / coast treeline. */
function fallbackVeg(world: World, x: number, z: number, out: VegSample): VegSample {
  const h = world.heightAtFast(x, z);
  out.tree = out.open = 0;
  out.clear = 1;
  out.birch = 0.5;
  if (h < 1.5) return out;
  const cd = coastDistance(x, z);
  const sl = Math.hypot(world.heightAtFast(x + 4, z) - world.heightAtFast(x - 4, z), world.heightAtFast(x, z + 4) - world.heightAtFast(x, z - 4)) / 8;
  const base = smooth(10, 45, cd) * (1 - smooth(0.62, 1.05, sl));
  out.tree = Math.min(0.95, base * (1 - smooth(150, 300, h)) * smooth(-0.5, -0.1, fbm(nClear, x / 240, z / 240, 3)));
  out.birch = smooth(120, 220, h) * 0.8 + 0.2;
  out.open = (1 - out.tree) * smooth(220, 280, h) * (1 - smooth(380, 470, h)) * 0.6;
  return out;
}

const nClear = createSimplex2D(9101);
const nKind = createSimplex2D(9707);
const nDune = createSimplex2D(9808);

/* ------------------------------------------------------------------ */
/* Scatter                                                             */
/* ------------------------------------------------------------------ */

const frame = () => new Promise<void>((r) => setTimeout(r, 0));

/** A tree another feature plants (village api.plantings): drawn with the forest's templates. */
export interface Planting {
  kind: 'spruce' | 'birch' | 'rowan';
  x: number;
  z: number;
  /** metres */
  height: number;
  seed: number;
}

export interface ScatterOptions {
  /** the terrain's mask; null falls back to a simple treeline */
  veg: VegMask | null;
  /** hand-placed hero trees: the scatter keeps clear of them */
  keepOut: { x: number; z: number; r: number }[];
  /** spruces and birches planted by other features: placed as given (they did their own clearance tests) */
  plant?: Planting[];
}

export async function scatterForest(world: World, opts: ScatterOptions): Promise<ForestData> {
  const G = 4.6;
  const vb = opts.veg?.bounds ?? { minX: -1760, maxX: 1720, minZ: -2100, maxZ: 1520 };
  const X0 = vb.minX;
  const Z0 = vb.minZ;
  const nx = Math.ceil((vb.maxX - vb.minX) / G);
  const nz = Math.ceil((vb.maxZ - vb.minZ) / G);
  const vs: VegSample = { tree: 0, open: 0, clear: 1, birch: 0.5 };
  const veg = (x: number, z: number) => (opts.veg ? opts.veg.sample(x, z, vs) : fallbackVeg(world, x, z, vs));
  const hf = (x: number, z: number) => world.heightAtFast(x, z);

  // every outdoor tour viewpoint keeps its frame clear: no treetop above the eye→target sightline
  const cones = VIEWPOINTS.filter((v) => !v.interior).map((v) => {
    const dx = v.target[0] - v.pos[0];
    const dz = v.target[2] - v.pos[2];
    const dist = Math.max(1, Math.hypot(dx, dz));
    return { x: v.pos[0], z: v.pos[2], ey: v.pos[1], slope: (v.target[1] - v.pos[1]) / dist, az: Math.atan2(dz, dx) };
  });
  const blocked = (x: number, z: number, top: number) => {
    for (const c of cones) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 420) continue;
      let da = Math.atan2(dz, dx) - c.az;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      // the frame's centre stays open; its edges may hold a framing tree
      if (Math.abs(da) > 0.42) continue;
      const lineY = c.ey + c.slope * d - 1.5;
      if (top > lineY) return true;
    }
    return false;
  };
  const keep = opts.keepOut;
  const nearHero = (x: number, z: number) => {
    for (const k of keep) if ((x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r) return true;
    return false;
  };
  const village = (x: number, z: number) => Math.hypot(x - VILLAGE.center.x, z - VILLAGE.center.z) < VILLAGE.radius * 0.85;
  // the sites stay clear (the mask clears them on its 8 m grid; this is the exact edge)
  const clearBoxes = [
    { minX: HOUSE.x - 26, maxX: HOUSE.x + 22, minZ: HOUSE.z - 24, maxZ: HOUSE.z + 20 },
    ...Object.values(SITES).map((b) => ({ minX: b.minX - 5, maxX: b.maxX + 5, minZ: b.minZ - 5, maxZ: b.maxZ + 5 })),
  ];
  const onSite = (x: number, z: number) => clearBoxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  // Ice Beach stays open: black sand, stranded ice and lyme-grass dunes, the wood starting behind them
  const beachR = BEACH.halfLength * 1.35;
  const beachOpen = (x: number, z: number, h: number) => {
    const bd = Math.hypot(x - BEACH.center.x, z - BEACH.center.z) / beachR;
    if (bd > 1.25) return false;
    return h < 9 + 5 * smooth(0.8, 1.25, bd) + 4 * hash2(Math.floor(x), Math.floor(z), 77);
  };

  const cap = 260000;
  const X = new Float32Array(cap);
  const Y = new Float32Array(cap);
  const Z = new Float32Array(cap);
  const S = new Float32Array(cap);
  const YAW = new Float32Array(cap);
  const TX = new Float32Array(cap);
  const TZ = new Float32Array(cap);
  const T = new Uint8Array(cap);
  const FL = new Uint8Array(cap);
  const TI = new Float32Array(cap);
  const K = new Float32Array(cap);
  let n = 0;

  const push = (x: number, z: number, h: number, t: number, s: number, i: number, j: number, salt: number, sx: number, sz: number) => {
    if (n >= cap) return;
    const r1 = hash2(i, j, 31 + salt);
    const r2 = hash2(i, j, 47 + salt);
    const r3 = hash2(i, j, 59 + salt);
    const low = SMALL_TEMPLATES.includes(t as (typeof SMALL_TEMPLATES)[number]);
    X[n] = x;
    Z[n] = z;
    // skirts and stems sink into the snow
    Y[n] = h - (low ? 0.08 : 0.3);
    S[n] = s;
    YAW[n] = r1 * Math.PI * 2;
    // slight lean, mostly downhill (birches more: snow creep bends their bases)
    const birch = t === TPL.birchTall || t === TPL.birchLow;
    const lean = (low ? 0.05 : birch ? 0.06 : 0.02) * r2 + Math.min(birch ? 0.1 : 0.04, Math.hypot(sx, sz) * 0.05);
    const la = Math.atan2(-sz, -sx) + (r3 - 0.5) * 1.6;
    TX[n] = Math.sin(la) * lean;
    TZ[n] = -Math.cos(la) * lean;
    T[n] = t;
    FL[n] = r3 < 0.5 ? 1 : 0;
    TI[n] = 0.86 + 0.26 * hash2(i, j, 71 + salt);
    K[n] = Math.pow(hash2(i, j, 83 + salt), 1 / (low ? 1.6 : 1));
    n++;
  };

  const slopeAt = (x: number, z: number, out: [number, number]) => {
    out[0] = (hf(x + 2, z) - hf(x - 2, z)) * 0.25;
    out[1] = (hf(x, z + 2) - hf(x, z - 2)) * 0.25;
    return out;
  };
  const sl: [number, number] = [0, 0];
  for (let j = 0; j < nz; j++) {
    if (j % 40 === 39) await frame();
    for (let i = 0; i < nx; i++) {
      const x = X0 + (i + 0.15 + 0.7 * hash2(i, j, 1)) * G;
      const z = Z0 + (j + 0.15 + 0.7 * hash2(i, j, 2)) * G;
      const v = veg(x, z);
      const tree = v.tree;
      const open = v.open;
      // decide what the cell wants before sampling any heights (most cells want nothing)
      const birchShare = v.birch;
      // spruce stands close ranks; birch woods stay open with snow between the trees
      const pTree = tree > 0.02 ? Math.pow(tree, 1.1) * (0.95 - 0.3 * birchShare) : 0;
      const wantTree = hash2(i, j, 5) < pTree;
      const wantShrub = !wantTree && open > 0.02 && hash2(i, j, 13) < open * 0.55;
      const glade = tree > 0.04 && tree < 0.5 ? 0.06 * (1 - tree * 2) : 0;
      let wantHerb = false;
      if (!wantTree && !wantShrub) {
        const r = hash2(i, j, 16);
        if (r < glade) wantHerb = true;
        else if (r < glade + 0.35) {
          const pc = world.pathCarve(x, z);
          wantHerb = pc.weight > 0.04 && pc.weight < 0.45;
        }
        if (!wantHerb) continue;
      }
      const h = hf(x, z);
      if (h < 1.4) continue;
      if (village(x, z) || onSite(x, z)) continue;

      if (wantTree) {
        let t: number;
        let s = 0.82 + 0.4 * hash2(i, j, 10);
        const exposure = smooth(110, 250, h);
        if (hash2(i, j, 6) < birchShare) {
          t = h < 150 && tree > 0.3 && hash2(i, j, 7) < 0.75 - exposure * 0.5 ? TPL.birchTall : TPL.birchLow;
          s *= 1 - 0.3 * exposure;
        } else {
          const kind = fbm(nKind, x / 90, z / 90, 2);
          if (tree < 0.32 && hash2(i, j, 8) < 0.5) {
            t = TPL.spruceYoung;
            s = 0.65 + 0.8 * hash2(i, j, 10);
          } else if (h > 105 + 45 * kind || tree < 0.45) t = TPL.spruceNarrow;
          else if (tree > 0.62 && h < 95 && hash2(i, j, 9) < 0.42 + 0.3 * kind) t = TPL.spruceTall;
          else t = TPL.spruceMid;
          s *= 1 - 0.28 * exposure;
        }
        if (nearHero(x, z) || beachOpen(x, z, h)) continue;
        if (world.pathCarve(x, z).weight > 0.3 || world.isReserved(x, z, 2)) continue;
        slopeAt(x, z, sl);
        if (blocked(x, z, h + TPL_HEIGHT[t] * s)) {
          // the view slope keeps only low growth
          if (hash2(i, j, 11) < 0.15 && !blocked(x, z, h + 1)) push(x, z, h, hash2(i, j, 12) < 0.5 ? TPL.juniper : TPL.dwarfBirch, 0.8 + 0.4 * hash2(i, j, 13), i, j, 0, sl[0], sl[1]);
          continue;
        }
        push(x, z, h, t, s, i, j, 0, sl[0], sl[1]);
        continue;
      }

      if (wantShrub) {
        // open ground: juniper and dwarf birch through the snow above the trees and in the clearings
        if (world.isReserved(x, z, 0.8) || world.pathCarve(x, z).weight > 0.5) continue;
        slopeAt(x, z, sl);
        const juniper = hash2(i, j, 14) < 0.4 + 0.3 * fbm(nKind, x / 60, z / 60, 2);
        const m = 1 + Math.floor(hash2(i, j, 15) * 2.5);
        for (let k = 0; k < m; k++) {
          const px = x + (hash2(i, j, 100 + k) - 0.5) * G * 0.8;
          const pz = z + (hash2(i, j, 120 + k) - 0.5) * G * 0.8;
          const ph = hf(px, pz);
          const s = (0.7 + 0.6 * hash2(i, j, 140 + k)) * (juniper ? 1 : 0.9);
          if (ph < 1.5 || blocked(px, pz, ph + 1)) continue;
          push(px, pz, ph, juniper ? TPL.juniper : TPL.dwarfBirch, s, i, j, 200 + k, sl[0], sl[1]);
        }
        continue;
      }

      // dried herbs in the lowland glades and along the path shoulders
      if (h > 160 || world.isReserved(x, z, 0.6)) continue;
      const m = 1 + Math.floor(hash2(i, j, 17) * 3);
      for (let k = 0; k < m; k++) {
        const px = x + (hash2(i, j, 160 + k) - 0.5) * G * 0.7;
        const pz = z + (hash2(i, j, 180 + k) - 0.5) * G * 0.7;
        if (world.pathCarve(px, pz).weight > 0.5) continue;
        const ph = hf(px, pz);
        if (ph < 1.5) continue;
        push(px, pz, ph, TPL.stalks, 0.7 + 0.5 * hash2(i, j, 200 + k), i, j, 300 + k, 0, 0);
      }
    }
  }

  // lyme grass on Ice Beach's back dunes, in tussocks with bare black sand between
  {
    const B = 1.9;
    const R = BEACH.halfLength * 1.35;
    const cx = BEACH.center.x;
    const cz = BEACH.center.z;
    for (let j = -Math.ceil(R / B); j <= Math.ceil(R / B); j++) {
      for (let i = -Math.ceil(R / B); i <= Math.ceil(R / B); i++) {
        const ii = i + 5000;
        const jj = j + 5000;
        const x = cx + (i + 0.15 + 0.7 * hash2(ii, jj, 401)) * B;
        const z = cz + (j + 0.15 + 0.7 * hash2(ii, jj, 402)) * B;
        const bd = Math.hypot(x - cx, z - cz) / R;
        if (bd > 1) continue;
        const h = hf(x, z);
        if (h < 2.5 || h > 9) continue;
        const sx = (hf(x + 1.5, z) - hf(x - 1.5, z)) / 3;
        const sz = (hf(x, z + 1.5) - hf(x, z - 1.5)) / 3;
        const slope = Math.hypot(sx, sz);
        if (slope > 0.6) continue;
        // above the swash and the stranded ice, thinning out where the snow lies deep
        const band = smooth(2.5, 3.6, h) * (1 - smooth(6.5, 9, h)) * (1 - smooth(0.85, 1, bd));
        // colonies of tussocks with bare sand and snow between them
        const clump = smooth(0.0, 0.28, fbm(nDune, x / 24, z / 24, 3));
        if (hash2(ii, jj, 403) > band * clump) continue;
        if (world.isReserved(x, z, 0.5) || world.pathCarve(x, z).weight > 0.4) continue;
        if (blocked(x, z, h + 0.9)) continue;
        push(x, z, h, TPL.lyme, 0.85 + 0.6 * hash2(ii, jj, 404), ii, jj, 500, sx * 2, sz * 2);
      }
    }
  }

  // planted trees (Lysvik's yards and groves), always shown
  (opts.plant ?? []).forEach((p, k) => {
    if (p.kind === 'rowan' || n >= cap) return;
    const t = p.kind === 'spruce' ? (p.height > 13 ? TPL.spruceTall : p.height > 8.5 ? TPL.spruceMid : TPL.spruceNarrow) : p.height > 7 ? TPL.birchTall : TPL.birchLow;
    slopeAt(p.x, p.z, sl);
    push(p.x, p.z, hf(p.x, p.z), t, p.height / TPL_HEIGHT[t], 7000 + k, p.seed % 65536, 600, sl[0], sl[1]);
    K[n - 1] *= 0.5;
  });

  // sort by key so quality changes can truncate the arrays
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => K[a] - K[b]);
  const take = <A extends Float32Array | Uint8Array>(src: A, ctor: new (n: number) => A): A => {
    const out = new ctor(n);
    for (let i = 0; i < n; i++) out[i] = src[order[i]];
    return out;
  };
  return {
    count: n,
    x: take(X, Float32Array),
    y: take(Y, Float32Array),
    z: take(Z, Float32Array),
    scale: take(S, Float32Array),
    yaw: take(YAW, Float32Array),
    tiltX: take(TX, Float32Array),
    tiltZ: take(TZ, Float32Array),
    template: take(T, Uint8Array),
    flip: take(FL, Uint8Array),
    tint: take(TI, Float32Array),
    key: take(K, Float32Array),
  };
}
