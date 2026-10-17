/**
 * The snow round the cabin: drifts piled against the walls (deep on the lee
 * east and south sides, scoured thin on the windward west and north), the
 * deck's snow with a path shovelled from the door to the tub and the steps,
 * boot prints trodden round the yard, and the warm pools that the windows,
 * the glass wing, the fire pit and the lantern string throw on the snow.
 */
import * as THREE from 'three';
import { HOUSE, SNOW_WIND } from '../../world/layout';
import { mulberry32 } from '../../world/noise';
import { C, D, W } from './plan';
import { DECK_STEPS, PIT, SLED, STEP_DIR, TUB, TUB_STOVE, groundAt } from './deck';

/* ------------------------------ helpers ------------------------------ */

/**
 * The terrain surface as the terrain mesh draws it near the camera: exact
 * heights sampled on the fine window's grid (64 m / gridN, by quality) and
 * interpolated between them. Snow laid on the ground (drifts, prints, pools)
 * follows this rather than the exact height, so it neither floats over nor
 * sinks into the drawn snow between the grid points.
 */
export function terrainSurface(terrainDetail: number): (x: number, z: number) => number {
  const gridN = terrainDetail >= 1 ? 64 : terrainDetail >= 0.75 ? 48 : 32;
  const s = 64 / gridN;
  const cache = new Map<number, number>();
  const H = (i: number, j: number) => {
    const k = i * 100003 + j;
    let v = cache.get(k);
    if (v === undefined) {
      v = groundAt(i * s - HOUSE.x, j * s - HOUSE.z);
      cache.set(k, v);
    }
    return v;
  };
  return (x, z) => {
    // the grid is aligned in world coordinates
    const fx = (x + HOUSE.x) / s;
    const fz = (z + HOUSE.z) / s;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = H(i, j) + (H(i + 1, j) - H(i, j)) * tx;
    const b = H(i, j + 1) + (H(i + 1, j + 1) - H(i, j + 1)) * tx;
    return a + (b - a) * tz;
  };
}

type Seg = [number, number, number, number];

function segDist(px: number, pz: number, s: Seg): number {
  const [ax, az, bx, bz] = s;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

function sdBox(px: number, pz: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const qx = Math.abs(px - cx) - (b.maxX - b.minX) / 2;
  const qz = Math.abs(pz - cz) - (b.maxZ - b.minZ) / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** cheap smooth value noise (deterministic) */
function valueNoise(seed: number): (x: number, z: number) => number {
  const r = mulberry32(seed);
  const P = 64;
  const g = new Float32Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (i: number, j: number) => g[(((j % P) + P) % P) * P + (((i % P) + P) % P)];
  return (x, z) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    let fx = x - xi;
    let fz = z - zi;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * fx;
    const b = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * fx;
    return a + (b - a) * fz;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** a heightfield mesh over a grid: y(x, z) or null (hole) */
function fieldMesh(x0: number, x1: number, z0: number, z1: number, cell: number, y: (x: number, z: number) => number | null, skirt?: number, floor?: number): THREE.BufferGeometry | null {
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const ys = new Float32Array(nx * nz);
  const ok = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = Math.min(x1, x0 + i * cell);
      const z = Math.min(z1, z0 + j * cell);
      const v = y(x, z);
      if (v !== null) {
        ys[j * nx + i] = v;
        ok[j * nx + i] = 1;
      }
    }
  }
  const map = new Int32Array(nx * nz).fill(-1);
  const pos: number[] = [];
  const idx: number[] = [];
  const vert = (k: number) => {
    if (map[k] >= 0) return map[k];
    const i = k % nx;
    const j = (k - i) / nx;
    map[k] = pos.length / 3;
    pos.push(Math.min(x1, x0 + i * cell), ys[k], Math.min(z1, z0 + j * cell));
    return map[k];
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k00 = j * nx + i;
      const k10 = k00 + 1;
      const k01 = k00 + nx;
      const k11 = k01 + 1;
      if (!(ok[k00] && ok[k10] && ok[k01] && ok[k11])) continue;
      if (floor !== undefined && ys[k00] < floor && ys[k10] < floor && ys[k01] < floor && ys[k11] < floor) continue;
      const a = vert(k00);
      const b = vert(k10);
      const c = vert(k01);
      const d = vert(k11);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  // a skirt down from the open boundary edges (so a slab never looks paper-thin)
  if (skirt) {
    const edges = new Map<string, [number, number]>();
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e];
        const b = idx[t + ((e + 1) % 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [a, b]);
      }
    }
    for (const [a, b] of edges.values()) {
      const ia = pos.length / 3;
      pos.push(pos[a * 3], pos[a * 3 + 1] - skirt, pos[a * 3 + 2]);
      pos.push(pos[b * 3], pos[b * 3 + 1] - skirt, pos[b * 3 + 2]);
      idx.push(a, ia, b, b, ia, ia + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i], pos[i + 2]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/* ------------------------------ deck snow ------------------------------ */

/** paths shovelled on the deck: door → tub steps → deck steps, round the tub */
const DECK_PATHS: { s: Seg; w: number }[] = (() => {
  const door: [number, number] = [-2.6, C.minZ - 0.1];
  const bend: [number, number] = [-2.75, -5.0];
  const steps: [number, number] = [TUB.x + STEP_DIR.x * (TUB.r + 0.75), TUB.z + STEP_DIR.y * (TUB.r + 0.75)];
  const west: [number, number] = [D.minX + 0.2, (DECK_STEPS.z0 + DECK_STEPS.z1) / 2];
  const southOfTub: [number, number] = [TUB.x - 0.4, TUB.z + TUB.r + 0.5];
  return [
    { s: [door[0], door[1], bend[0], bend[1]], w: 0.5 },
    { s: [bend[0], bend[1], steps[0], steps[1]], w: 0.5 },
    { s: [steps[0], steps[1], southOfTub[0], southOfTub[1]], w: 0.45 },
    { s: [southOfTub[0], southOfTub[1], west[0], west[1]], w: 0.48 },
    // along the wall to the firewood
    { s: [door[0] - 0.4, C.minZ - 0.45, C.minX + 0.4, C.minZ - 0.5], w: 0.35 },
  ];
})();

/** snow depth on the deck at (x, z) */
function deckSnowDepth(x: number, z: number, n: (x: number, z: number) => number): number {
  let dPath = Infinity;
  for (const p of DECK_PATHS) dPath = Math.min(dPath, segDist(x, z, p.s) - p.w);
  // round the tub and its stove: trodden clear
  dPath = Math.min(dPath, Math.hypot(x - TUB.x, z - TUB.z) - (TUB.r + 0.42));
  dPath = Math.min(dPath, Math.hypot(x - TUB_STOVE.x, z - TUB_STOVE.z) - 0.55);
  const T = 0.2 + 0.08 * (n(x * 0.7, z * 0.7) - 0.5) + 0.04 * (n(x * 3.1 + 7, z * 3.1) - 0.5);
  // shovelled banks: clear on the path, a low berm at its edge, then the even cover
  const bank = smooth(0.0, 0.32, dPath) * (1 + 0.45 * Math.exp(-Math.pow((dPath - 0.3) / 0.16, 2)));
  // under the cabin's eave the deck stays nearly bare
  const shelter = 0.12 + 0.88 * smooth(0.0, 0.9, C.minZ - 0.55 - z);
  // rounded off at the deck's edges
  const de = -sdBox(x, z, D);
  const edge = Math.sqrt(smooth(-0.01, 0.16, de));
  return T * bank * shelter * edge;
}

const deckNoise = valueNoise(91);

/** top of the deck's snow (or the bare boards on the paths) at local (x, z) */
export function deckSurface(x: number, z: number): number {
  return D.topY + deckSnowDepth(x, z, deckNoise);
}

export function deckSnow(fancy: boolean): THREE.BufferGeometry | null {
  const n = deckNoise;
  const top = D.topY;
  // zero depth sinks just under the boards, so the bank meets them along a smooth line (not the grid)
  return fieldMesh(D.minX, D.maxX, D.minZ, D.maxZ, fancy ? 0.06 : 0.09, (x, z) => top + deckSnowDepth(x, z, n) - 0.012, 0.03, top - 0.004);
}

/* ------------------------------ drifts ------------------------------ */

const BUILT = [
  { minX: C.minX, maxX: C.maxX, minZ: C.minZ, maxZ: C.maxZ },
  { minX: W.minX, maxX: W.maxX, minZ: W.minZ, maxZ: W.maxZ },
];
const DECK_BOX = { minX: D.minX - 0.8, maxX: D.maxX, minZ: D.minZ - 0.1, maxZ: D.maxZ };
/** keep clear: the entry steps and the start of the yard path, the deck steps, the firewood stack */
const CLEAR: { s: Seg; w: number }[] = [
  { s: [-3.2, C.maxZ, -3.2, C.maxZ + 2.6], w: 0.9 },
  { s: [-3.2, C.maxZ + 2.2, -8.6, 6.4], w: 0.7 },
  { s: [DECK_STEPS.x0 - 0.2, -6.0, DECK_STEPS.x0 - 2.5, -6.5], w: 0.55 },
  { s: [C.minX - 0.3, C.minZ + 0.25, C.minX - 0.3, -0.35], w: 0.38 },
  // the kick sled and the skis by the door stand on trodden snow
  { s: [SLED.x - 0.9, SLED.z, SLED.x + 0.9, SLED.z], w: 0.55 },
  { s: [-2.2, C.maxZ + 0.2, -1.5, C.maxZ + 0.2], w: 0.35 },
];

const WIND = new THREE.Vector2(SNOW_WIND.x, SNOW_WIND.z);

export interface Drift {
  /** drift depth (m) at local (x, z) */
  depth(x: number, z: number): number;
  geometry: THREE.BufferGeometry | null;
}

export function buildDrifts(fancy: boolean, ground: (x: number, z: number) => number = groundAt): Drift {
  const n = valueNoise(57);
  const depth = (x: number, z: number): number => {
    let d = Infinity;
    let side = 0;
    for (const b of BUILT) {
      const s = sdBox(x, z, b);
      if (s < d) {
        d = s;
        // outward direction of the nearest face
        const cx = Math.max(b.minX, Math.min(b.maxX, x));
        const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
        const ox = x - cx;
        const oz = z - cz;
        const l = Math.hypot(ox, oz) || 1;
        side = (ox / l) * WIND.x + (oz / l) * WIND.y;
      }
    }
    if (d <= 0 || d > 3.2) return 0;
    if (sdBox(x, z, DECK_BOX) < 0.15) return 0;
    let clr = Infinity;
    for (const c of CLEAR) clr = Math.min(clr, segDist(x, z, c.s) - c.w - 0.25);
    if (clr <= 0) return 0;
    // shovelled away from the door and the paths: a long, soft ramp down to them
    const clearK = smooth(0, 1.4, clr);
    const nn = n(x * 0.55, z * 0.55);
    // the drift swells and sags along the wall
    const along = n(x * 0.22 + 11, z * 0.22 + 3);
    // lee faces (side > 0) gather a deep drift, windward faces a thin, scoured one
    const lee = smooth(-0.3, 0.6, side);
    const A = (0.16 + 0.36 * lee) * (0.65 + 0.7 * along) + 0.12 * (nn - 0.5);
    const L = 0.55 + 0.9 * lee * (0.7 + 0.6 * along);
    // a little scour right at a windward wall
    const scour = (1 - lee) * Math.exp(-d / 0.25) * 0.6;
    const t = A * Math.exp(-d / L) * (1 - scour) * clearK * smooth(3.2, 2.2, d);
    return Math.max(0, t + 0.03 * (n(x * 2.3 + 5, z * 2.3) - 0.5) * smooth(0, 0.2, t));
  };
  const geo = fieldMesh(C.minX - 3.2, C.maxX + 3.2, W.minZ - 3.2, C.maxZ + 3.2, fancy ? 0.14 : 0.2, (x, z) => {
    const t = depth(x, z);
    if (t < 0.002) return null;
    // thin edges sink well into the ground, so the drift meets the (coarser) terrain mesh along a
    // smooth line instead of showing its rim where the two disagree
    return ground(x, z) + t + 0.03 - 0.09 * (1 - smooth(0, 0.2, t));
  });
  return { depth, geometry: geo };
}

/* ------------------------------ footprints ------------------------------ */

function printTexture(): THREE.Texture {
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  // a boot print: ball and heel, blue-grey in the cavity, soft edged (computed per pixel: no read-back)
  const sole = (x: number, y: number, cy: number, ry: number, rx: number) => {
    const d = Math.hypot((x - W / 2) / rx, (y - cy) / ry);
    return 1 - Math.min(1, Math.max(0, (d - 0.75) / 0.35));
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = Math.max(sole(x, y, 41, 33, 22), sole(x, y, 100, 20, 18));
      // deeper (darker) toward the toe and the heel's back edge
      const depth = 0.75 + 0.25 * Math.sin((y / H) * Math.PI);
      const o = (y * W + x) * 4;
      img.data[o] = Math.round(255 - k * 74 * depth);
      img.data[o + 1] = Math.round(255 - k * 58 * depth);
      img.data[o + 2] = Math.round(255 - k * 40 * depth);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** trails of boot prints (local polylines) */
const TRAILS: [number, number][][] = [
  // from the deck steps to the fire pit, and on to look at the fjord
  [
    [DECK_STEPS.x0 - 0.3, -6.1],
    [-10.2, -6.6],
    [PIT.x + 1.6, PIT.z + 0.9],
  ],
  [
    [PIT.x - 0.6, PIT.z - 1.7],
    [PIT.x - 1.2, PIT.z - 4.2],
    [PIT.x - 0.4, PIT.z - 7.0],
  ],
  // round the cabin to the glass wing's north end at night
  [
    [-2.2, C.maxZ + 1.6],
    [2.4, C.maxZ + 1.9],
    [6.9, C.maxZ + 1.2],
    [7.6, -1.0],
    [7.2, -6.2],
    [5.6, W.minZ - 2.0],
    [2.6, W.minZ - 3.0],
    [-0.6, W.minZ - 1.7],
    [D.minX + 1.0, D.minZ - 1.2],
    [DECK_STEPS.x0 - 0.5, -6.4],
  ],
  // to the woodpile on the west gable
  [
    [-4.4, C.maxZ + 2.3],
    [-6.8, C.maxZ + 0.6],
    [C.minX - 0.95, -1.0],
  ],
];

export function buildFootprints(drift: Drift, ground: (x: number, z: number) => number = groundAt): THREE.Mesh {
  const rnd = mulberry32(83);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const stride = 0.36;
  for (const tr of TRAILS) {
    let left = true;
    for (let i = 0; i < tr.length - 1; i++) {
      const [ax, az] = tr[i];
      const [bx, bz] = tr[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      for (let s = rnd() * stride; s < len; s += stride * (0.9 + rnd() * 0.2)) {
        const side = left ? -1 : 1;
        left = !left;
        const wob = (rnd() - 0.5) * 0.25;
        const fx = dx * Math.cos(wob) - dz * Math.sin(wob);
        const fz = dz * Math.cos(wob) + dx * Math.sin(wob);
        const cx = ax + dx * s - dz * side * 0.11;
        const cz = az + dz * s + dx * side * 0.11;
        const hw = 0.06;
        const hl = 0.15;
        const base = pos.length / 3;
        const py = ground(cx, cz) + drift.depth(cx, cz) + 0.03;
        for (const [u, v] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const px = cx + -fz * u * hw + fx * v * hl;
          const pz = cz + fx * u * hw + fz * v * hl;
          pos.push(px, py, pz);
          uv.push((u + 1) / 2, (v + 1) / 2);
        }
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face up whatever the winding came out as
  const nrm = g.getAttribute('normal');
  if (nrm.count && nrm.getY(0) < 0) {
    const ix = g.index!.array as Uint16Array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  const mat = new THREE.MeshBasicMaterial({
    name: 'footprints',
    map: printTexture(),
    blending: THREE.MultiplyBlending,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    fog: false,
  });
  mat.userData.snow = 0;
  const m = new THREE.Mesh(g, mat);
  m.name = 'house-footprints';
  m.renderOrder = 1;
  m.raycast = () => {};
  m.userData.snow = 0;
  return m;
}

/* ------------------------------ fire pit ground ------------------------------ */

/**
 * The ground round the fire pit: a ring of melt, ash and wet gravel just
 * outside the stones, then snow trodden flat and grey-blue by boots, fading
 * into the untouched cover. A multiply decal lying on the terrain.
 */
export function buildPitGround(poolGeo: (x: number, z: number, rx: number, rz: number) => THREE.BufferGeometry): THREE.Mesh {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const rnd = mulberry32(17);
  const noise = valueNoise(23);
  // boot prints scattered in the trodden ring
  const prints: [number, number, number][] = [];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.3 + 0.55 * Math.sqrt(rnd());
    prints.push([Math.cos(a) * r, Math.sin(a) * r, rnd() * Math.PI]);
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n * 2 - 1;
      const v = (y + 0.5) / n * 2 - 1;
      const r = Math.hypot(u, v);
      const nn = noise(u * 9 + 3, v * 9 + 1);
      let k = 1;
      // melt and ash ring just outside the stones (stones at r ≈ 0.24 of the 2.8 m radius)
      const ring = Math.exp(-Math.pow((r - 0.3 - 0.04 * (nn - 0.5)) / 0.07, 2));
      k *= 1 - 0.36 * ring * (0.7 + 0.6 * nn);
      // trodden snow: a soft grey-blue scuffing, densest near the fire
      const trod = smooth(0.95, 0.45, r) * (0.55 + 0.45 * noise(u * 23, v * 23));
      k *= 1 - 0.14 * trod;

      const o = (y * n + x) * 4;
      // ash is warm grey-brown, the scuffs a cool blue-grey
      img.data[o] = Math.round(255 * Math.min(1, k * (1 - 0.06 * trod) * (1 + 0.04 * ring)));
      img.data[o + 1] = Math.round(255 * Math.min(1, k * (1 - 0.03 * trod)));
      img.data[o + 2] = Math.round(255 * Math.min(1, k * (1 + 0.02 * trod) * (1 - 0.08 * ring)));
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // boot prints scuffed into the trodden ring
  g.globalCompositeOperation = 'multiply';
  for (const [px, pz, rot] of prints) {
    const fade = smooth(1.0, 0.5, Math.hypot(px, pz));
    g.save();
    g.translate((px * 0.5 + 0.5) * n, (pz * 0.5 + 0.5) * n);
    g.rotate(rot);
    g.fillStyle = `rgba(${Math.round(255 - 40 * fade)}, ${Math.round(255 - 30 * fade)}, ${Math.round(255 - 22 * fade)}, 1)`;
    g.beginPath();
    g.ellipse(0, 0, 0.035 * n * 0.5, 0.085 * n * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    name: 'pitGround',
    map: tex,
    blending: THREE.MultiplyBlending,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
  mat.userData.snow = 0;
  const mesh = new THREE.Mesh(poolGeo(PIT.x, PIT.z, 2.8, 2.8), mat);
  mesh.name = 'house-pit-ground';
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  mesh.userData.snow = 0;
  return mesh;
}
