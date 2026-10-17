/**
 * The living room round the stove: a low sofa facing the fire with wool
 * cushions, a sheepskin thrown over its back and a plaid over the arm; a rag
 * rug and a reindeer hide in front of the hearth; a low pine table with a
 * candle, a mug and a book; an armchair with a sheepskin and a reading lamp
 * by the south windows; a stained bookshelf on the north wall between the
 * deck window and the wing door; a painted sideboard with a table lamp
 * between the east windows; candles on the deep window sills.
 *
 * House-local metres (y = 0 on the floor); see layout.ts for the openings.
 */
import * as THREE from 'three';
import { boxMinMax } from '../house/kit';
import { roundedBox } from '../../core/geometry';
import { mulberry32 } from '../../world/noise';
import type { InteriorMats } from './mats';
import type { Lights } from './lights';
import { drape, place, reliefPiece, rod, softBox, tube, turned, type V2 } from './kit';
import { bowl, candlestick, facing, frame, framePoint, leg, mug, shelfOfBooks, type Kit } from './furn';
import { lampScallop } from './scallop';

/** where things stand (house-local), shared with the cards and the viewpoints */
export const LIVING = {
  sofa: { x: 3.25, z: 0.45, rot: -Math.PI / 2, len: 2.1, depth: 0.9 },
  table: { x: 1.85, z: 0.45 },
  rug: { x: 1.75, z: 0.45, w: 2.9, d: 1.95 },
  hide: { x: 0.55, z: 0.5 },
  chair: { x: 1.15, z: 2.35 },
  lamp: { x: 0.6, z: 2.92 },
  shelf: { x0: 0.05, x1: 1.75, z: -3.26, d: 0.3, h: 2.02 },
  sideboard: { z0: -0.85, z1: 0.85, x: 5.76, d: 0.45, h: 0.78 },
};

export interface LivingBuild {
  /** pickable lamp objects: light index → mesh */
  lampPicks: { light: number; object: THREE.Object3D }[];
}

export function buildLiving(k: Kit, m: InteriorMats, lights: Lights, fancy: boolean): LivingBuild {
  const { B, shadows } = k;
  const lampPicks: LivingBuild['lampPicks'] = [];
  const rnd = mulberry32(211);

  /* ------------------------------ rag rug ------------------------------ */
  {
    const R = LIVING.rug;
    const g = new THREE.BoxGeometry(R.w, 0.008, R.d, 1, 1, 1);
    // v runs along the rug's length (x), u across it, in metres; the texture tiles every 1.5 m
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getZ(i) + R.d / 2) / 1.5, (p.getX(i) + R.w / 2) / 1.5 + 0.13);
    B.add(m.rug, place(g, R.x, 0.004, R.z), { role: 'rug' });
    // fringes: warp ends knotted in bunches at both short ends
    for (const end of [-1, 1]) {
      for (let zz = -R.d / 2 + 0.03; zz < R.d / 2 - 0.02; zz += 0.035) {
        const len = 0.05 + rnd() * 0.025;
        const a = (rnd() - 0.5) * 0.35;
        const x0 = R.x + end * R.w / 2;
        const q = new THREE.PlaneGeometry(len, 0.012);
        q.rotateX(-Math.PI / 2);
        q.translate(len / 2, 0, 0);
        q.rotateY(end > 0 ? a : Math.PI + a);
        B.add(m.linen, place(q, x0, 0.003, R.z + zz), { role: 'rug' });
      }
    }
    shadows.add(R.x, R.z, R.w, R.d, 0, 0.03, 0.12, 0.002);
  }

  /* --------------------------- reindeer hide --------------------------- */
  {
    const H = LIVING.hide;
    const g = reliefPiece(hideOutline(), { height: 0.022, edge: 0.07, step: fancy ? 0.035 : 0.05, lump: 0.0025, seed: 5 });
    // head toward the stove, lying across the rug's west end
    B.add(m.hide, place(g, H.x, 0.009, H.z, -Math.PI / 2 + 0.25), { role: 'hide' });
  }

  /* ------------------------------- sofa -------------------------------- */
  {
    const S = LIVING.sofa;
    const P = frame(S.x, S.z, S.rot);
    const L = S.len;
    const D = S.depth;
    const arm = 0.17;
    // legs: short, turned, stained
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(m.darkWood, P(place(leg(0.11, 0.024, 0.017), sx * (L / 2 - 0.08), 0, sz * (D / 2 - 0.08))), { role: 'sofa', cast: true });
    // a stained frame rail round the base
    B.add(m.darkWood, P(boxMinMax(-L / 2, 0.11, -D / 2, L / 2, 0.16, D / 2, 'x')), { role: 'sofa', cast: true });
    // base, arms, back: charcoal wool upholstery
    B.add(m.wool, P(place(softBox(L, 0.16, D, { r: 0.03, bulge: 0.01, side: 0.006, seed: 1 }), 0, 0.235, 0)), { role: 'sofa', cast: true });
    for (const sx of [-1, 1]) B.add(m.wool, P(place(softBox(arm, 0.3, D, { r: 0.06, bulge: 0.02, side: 0.008, seed: 2 + sx }), sx * (L / 2 - arm / 2), 0.46, 0)), { role: 'sofa', cast: true });
    B.add(m.wool, P(place(softBox(L - 2 * arm + 0.02, 0.36, 0.2, { r: 0.05, bulge: 0.01, side: 0.01, seed: 4 }), 0, 0.48, -D / 2 + 0.1)), { role: 'sofa', cast: true });
    // seat cushions, a little sat in
    const cw = (L - 2 * arm) / 2;
    for (const sx of [-1, 1]) {
      const g = softBox(cw - 0.01, 0.14, D - 0.2, { r: 0.045, bulge: 0.022, side: 0.012, sag: 0.018, dent: [sx * 0.05, 0.05], wrinkle: 0.0025, seed: 10 + sx });
      B.add(m.wool, P(place(g, sx * cw / 2, 0.38, 0.09)), { role: 'sofa', cast: true });
    }
    // back cushions leaning back
    for (const sx of [-1, 1]) {
      const g = softBox(cw - 0.02, 0.44, 0.17, { r: 0.06, bulge: 0.03, side: 0.03, wrinkle: 0.003, seed: 20 + sx });
      g.rotateX(-0.2);
      B.add(m.wool, P(place(g, sx * cw / 2, 0.64, -D / 2 + 0.25)), { role: 'sofa', cast: true });
    }
    // throw cushions: oat wool and a plaid one in the corners
    {
      const g = softBox(0.44, 0.42, 0.13, { r: 0.07, bulge: 0.0, side: 0.05, wrinkle: 0.004, seed: 31 });
      g.rotateX(-0.35);
      g.rotateZ(0.12);
      g.rotateY(0.35);
      B.add(m.woolOat, P(place(g, -L / 2 + arm + 0.27, 0.66, -0.12)), { role: 'sofa' });
      const h = softBox(0.4, 0.38, 0.12, { r: 0.07, side: 0.045, wrinkle: 0.004, seed: 32 });
      h.rotateX(-0.3);
      h.rotateZ(-0.2);
      h.rotateY(-0.4);
      B.add(m.plaidGrey, P(place(h, L / 2 - arm - 0.26, 0.64, -0.1)), { role: 'sofa' });
    }
    // a sheepskin thrown over the back and down onto the seat (right half)
    {
      const prof: V2[] = [
        [-0.42, 0.47],
        [-0.12, 0.46],
        [0.12, 0.47],
        [0.22, 0.56],
        [0.27, 0.75],
        [0.33, 0.86],
        [0.43, 0.88],
        [0.5, 0.8],
        [0.52, 0.66],
      ];
      // profile x = -sofa z (the drape is turned a quarter round below)
      const g = drape(prof, 0.62, {
        folds: 0.012,
        freq: 3,
        puff: 0.01,
        thick: 0.012,
        fleece: 0.03,
        hem: 0.02,
        seed: 41,
        density: fancy ? 26 : 18,
        shape: (u) => {
          // a fleece: rounded ends, a little narrower at the neck, two leg lobes
          const e = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.45;
          const lobe = 0.08 * Math.exp(-(((u - 0.2) / 0.07) ** 2)) + 0.07 * Math.exp(-(((u - 0.82) / 0.06) ** 2));
          const w = 0.4 + 0.1 * e + lobe + 0.025 * Math.sin(u * 31 + 1) + 0.015 * Math.sin(u * 57);
          return [-w - 0.02 * Math.sin(u * 23), w];
        },
      });
      g.rotateY(Math.PI / 2);
      B.add(m.sheepskin, P(place(g, 0.42, 0.03, 0)), { role: 'sheepskin' });
    }
    // a plaid folded over the left arm
    {
      const ax = -L / 2 + arm / 2;
      const prof: V2[] = [
        [ax + 0.24, 0.455],
        [ax + 0.1, 0.46],
        [ax + 0.075, 0.55],
        [ax + 0.06, 0.62],
        [ax, 0.635],
        [ax - 0.07, 0.62],
        [ax - 0.1, 0.5],
        [ax - 0.105, 0.3],
        [ax - 0.1, 0.17],
      ];
      const g = drape(prof, 0.5, { folds: 0.014, freq: 3.4, thick: 0.012, hem: 0.02, seed: 43, density: fancy ? 26 : 18 });
      B.add(m.plaidRed, P(place(g, 0, 0, 0.1)), { role: 'plaid' });
    }
    shadows.add(S.x, S.z, D + 0.05, L + 0.05, 0, 0.16, 0.6);
  }

  /* --------------------------- coffee table ---------------------------- */
  {
    const T = LIVING.table;
    const P = frame(T.x, T.z, 0);
    const w = 0.55;
    const d = 1.0;
    const h = 0.4;
    B.add(m.pine, P(place(roundedBox(w, 0.04, d, 0.008, 2, 'z'), 0, h - 0.02, 0)), { role: 'table', cast: true });
    B.add(m.pine, P(place(roundedBox(w - 0.1, 0.025, d - 0.12, 0.006, 2, 'z'), 0, 0.12, 0)), { role: 'table', cast: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(m.pine, P(place(leg(h - 0.04, 0.022, 0.017), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.06))), { role: 'table', cast: true });
    // on it: a stoneware mug, a book face down, a wooden bowl of pine cones, a candle on a dish
    const [mb, mh] = mug(0.042, 0.095);
    B.add(m.stoneware, P(place(mb, 0.1, h, -0.28, 0.7)), { role: 'table' });
    B.add(m.stoneware, P(place(mh, 0.1, h, -0.28, 0.7)), { role: 'table' });
    const book = new THREE.BoxGeometry(0.16, 0.028, 0.23);
    B.add(m.leather, P(place(book, -0.08, h + 0.014, -0.05, 0.25)), { role: 'table' });
    B.add(m.linen, P(place(new THREE.BoxGeometry(0.15, 0.022, 0.215), -0.083, h + 0.014, -0.053, 0.25)), { role: 'table' });
    B.add(m.pine, P(place(bowl(0.11, 0.06), 0.05, h, 0.3)), { role: 'table' });
    for (let c = 0; c < 5; c++) {
      const a = c * 1.3 + 0.4;
      const cone = turned([[0, 0], [0.018, 0.006], [0.022, 0.025], [0.014, 0.045], [0, 0.052]], 7);
      cone.rotateZ(Math.PI / 2 + (c % 2 ? 0.3 : -0.2));
      B.add(m.darkWood, P(place(cone, 0.05 + Math.cos(a) * 0.045, h + 0.035 + (c > 2 ? 0.018 : 0), 0.3 + Math.sin(a) * 0.045, a)), { role: 'table' });
    }
    // a pillar candle on a stoneware dish: this one lights the sofa
    const id = lights.add({ id: 'table-candle', zone: 'living', kind: 'candle', label: 'Candle', pos: framePoint(T.x, T.z, 0, new THREE.Vector3(-0.1, h + 0.12, 0.2)), power: 0.05, reach: 3 });
    B.add(m.stoneware, P(place(turned([[0, 0], [0.07, 0], [0.075, 0.012], [0.066, 0.014], [0, 0.008]], 20), -0.1, h, 0.2)), { role: 'table' });
    lights.candle(id, framePoint(T.x, T.z, 0, new THREE.Vector3(-0.1, h + 0.008, 0.2)), 0.11, 0.032, 0.8);
    lampPicks.push({ light: id, object: pickBox(0.08, 0.16, 0.08, framePoint(T.x, T.z, 0, new THREE.Vector3(-0.1, h + 0.07, 0.2))) });
    shadows.add(T.x, T.z, w, d, 0, 0.1, 0.45);
  }

  /* ----------------------------- armchair ------------------------------ */
  {
    const C = LIVING.chair;
    const rot = facing(C.x, C.z, -0.8, 0.4);
    const P = frame(C.x, C.z, rot);
    const W = 0.72;
    // a pine frame: two side frames with armrests, splayed back legs
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.03);
      B.add(m.pine, P(rod(new THREE.Vector3(x, 0, 0.3), new THREE.Vector3(x, 0.56, 0.32), 0.022, 8)), { role: 'chair', cast: true });
      B.add(m.pine, P(rod(new THREE.Vector3(x, 0, -0.32), new THREE.Vector3(x, 0.5, -0.24), 0.022, 8)), { role: 'chair', cast: true });
      B.add(m.pine, P(place(roundedBox(0.07, 0.03, 0.7, 0.01, 2, 'z'), x, 0.575, 0.02, 0, 0.08)), { role: 'chair', cast: true });
      B.add(m.pine, P(boxMinMax(x - 0.02, 0.24, -0.3, x + 0.02, 0.3, 0.3, 'z')), { role: 'chair', cast: true });
      // back uprights, raked
      B.add(m.pine, P(rod(new THREE.Vector3(x * 0.95, 0.28, -0.3), new THREE.Vector3(x * 0.9, 0.98, -0.52), 0.02, 8)), { role: 'chair', cast: true });
    }
    // seat and back cushions in oat wool
    B.add(m.woolOat, P(place(softBox(W - 0.08, 0.13, 0.6, { r: 0.04, bulge: 0.018, sag: 0.015, wrinkle: 0.002, seed: 51 }), 0, 0.36, 0.0)), { role: 'chair', cast: true });
    const back = softBox(W - 0.1, 0.62, 0.12, { r: 0.05, bulge: 0.0, side: 0.03, wrinkle: 0.002, seed: 52 });
    back.rotateX(-0.36);
    B.add(m.woolOat, P(place(back, 0, 0.7, -0.38)), { role: 'chair', cast: true });
    // a sheepskin over the back, its tail on the seat
    const prof: V2[] = [
      [-0.2, 0.44],
      [0.05, 0.44],
      [0.25, 0.47],
      [0.33, 0.62],
      [0.45, 0.88],
      [0.52, 1.03],
      [0.6, 1.03],
      [0.63, 0.9],
    ];
    const g = drape(prof, 0.56, {
      folds: 0.01,
      freq: 3,
      puff: 0.01,
      thick: 0.012,
      fleece: 0.03,
      hem: 0.015,
      seed: 53,
      density: fancy ? 24 : 16,
      shape: (u) => {
        const e = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.5;
        const w = 0.36 + 0.12 * e + 0.06 * Math.exp(-(((u - 0.15) / 0.06) ** 2)) + 0.025 * Math.sin(u * 27 + 2);
        return [-w - 0.02 * Math.sin(u * 19), w];
      },
    });
    g.rotateY(Math.PI / 2);
    B.add(m.sheepskin, P(place(g, 0, 0.0, 0.0)), { role: 'sheepskin' });
    shadows.add(C.x, C.z, W, 0.8, -rot, 0.14, 0.55);
  }

  /* ---------------------------- reading lamp ---------------------------- */
  {
    const Lp = LIVING.lamp;
    const shade = lampShadeMaterial(m.linen, 0xffe2b8);
    const P = frame(Lp.x, Lp.z, 0);
    B.add(m.iron, P(turned([[0, 0], [0.15, 0], [0.15, 0.012], [0.04, 0.03], [0, 0.03]], 22)), { role: 'lamp', cast: true });
    B.add(m.brass, P(rod(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, 1.36, 0), 0.011, 8)), { role: 'lamp', cast: true });
    B.add(m.brass, P(turned([[0, 1.33], [0.022, 1.33], [0.024, 1.38], [0.012, 1.4], [0, 1.4]], 10)), { role: 'lamp' });
    const sh = drumShade(0.21, 0.17, 0.27);
    sh.translate(0, 1.33, 0);
    B.add(shade, P(sh), { role: 'lamp' });
    const bulb = bulbMaterial();
    B.add(bulb, P(place(new THREE.SphereGeometry(0.03, 10, 8), 0, 1.42, 0)), { role: 'lamp' });
    // its light on the south wall behind it: bright arcs above and below the drum
    const sc = lampScallop({ bulb: new THREE.Vector3(Lp.x, 1.42, Lp.z), top: [0.18, 0.17], bottom: [0.09, 0.21], wallPoint: new THREE.Vector3(0, 0, 3.26), wallNormal: new THREE.Vector3(0, 0, -1), width: 1.16, height: 2.66, y0: 0.02, along: 0.69 });
    lights.group.add(sc.mesh);
    const id = lights.add({ id: 'reading-lamp', zone: 'living', kind: 'lamp', label: 'Reading lamp', pos: new THREE.Vector3(Lp.x, 1.35, Lp.z), power: 0.36, reach: 6.5, glow: [{ mat: shade, k: 0.45 }, { mat: bulb, k: 6 }], levels: [{ u: sc.level, k: 1 }] });
    lampPicks.push({ light: id, object: pickBox(0.45, 1.65, 0.45, new THREE.Vector3(Lp.x, 0.82, Lp.z)) });
    shadows.add(Lp.x, Lp.z, 0.3, 0.3, 0, 0.1, 0.4);
  }

  /* ----------------------------- bookshelf ----------------------------- */
  {
    const S = LIVING.shelf;
    const zb = S.z;
    const zf = S.z + S.d;
    const t = 0.028;
    const shelves = [0.06, 0.44, 0.8, 1.16, 1.52, 1.88];
    const mid = (S.x0 + S.x1) / 2;
    // carcass: sides, a middle upright, shelves, a plinth and a top board, a back of pine boards
    for (const x of [S.x0, S.x1 - t, mid - t / 2]) B.add(m.darkWood, boxMinMax(x, 0, zb, x + t, S.h, zf, 'y'), { role: 'shelf', cast: true });
    for (const y of shelves) B.add(m.darkWood, boxMinMax(S.x0, y - t, zb, S.x1, y, zf - 0.01, 'x'), { role: 'shelf', cast: true });
    B.add(m.darkWood, boxMinMax(S.x0 - 0.01, S.h, zb, S.x1 + 0.01, S.h + 0.03, zf + 0.015, 'x'), { role: 'shelf', cast: true });
    B.add(m.darkWood, boxMinMax(S.x0, 0, zf - 0.02, S.x1, 0.06, zf, 'x'), { role: 'shelf' });
    B.add(m.pine, boxMinMax(S.x0 + t, 0.06, zb, S.x1 - t, S.h, zb + 0.008, 'y'), { role: 'shelf' });
    // books: each shelf in two runs (either side of the middle upright), with gaps for objects
    let seed = 300;
    for (let i = 0; i < shelves.length - 1; i++) {
      const y = shelves[i];
      const maxH = shelves[i + 1] - y - t - 0.01;
      const gapsL: [number, number][] = i === 2 ? [[S.x0 + 0.08, S.x0 + 0.3]] : i === 4 ? [[mid - 0.32, mid - 0.06]] : [];
      const gapsR: [number, number][] = i === 1 ? [[S.x1 - 0.3, S.x1 - 0.05]] : i === 3 ? [[mid + 0.1, mid + 0.34]] : [];
      // a shelf rotated into the room: spines face +z
      for (const g of shelfOfBooks(S.x0 + t, mid - t / 2, y, zf - 0.025, maxH, seed++, gapsL)) B.add(m.books, g, { role: 'books' });
      for (const g of shelfOfBooks(mid + t / 2, S.x1 - t, y, zf - 0.025, maxH, seed++, gapsR)) B.add(m.books, g, { role: 'books' });
    }
    // objects in the gaps: a stoneware jug, a brass candlestick, a small birch-bark box, a wooden horse
    B.add(m.stoneware, place(turned([[0, 0], [0.05, 0], [0.065, 0.06], [0.06, 0.13], [0.035, 0.17], [0.04, 0.2], [0.0, 0.2]], 18), S.x0 + 0.19, shelves[2], zf - 0.14), { role: 'shelf' });
    const cs = candlestick(0.14);
    B.add(m.brass, place(cs.geo, S.x1 - 0.17, shelves[1], zf - 0.13), { role: 'shelf' });
    const cid = lights.add({ id: 'shelf-candle', zone: 'living', kind: 'candle', label: 'Candle', pos: new THREE.Vector3(S.x1 - 0.17, shelves[1] + 0.3, zf - 0.13), power: 0, on: true });
    lights.candle(cid, new THREE.Vector3(S.x1 - 0.17, shelves[1] + cs.top, zf - 0.13), 0.15, 0.011, 0.2);
    lampPicks.push({ light: cid, object: pickBox(0.1, 0.32, 0.1, new THREE.Vector3(S.x1 - 0.17, shelves[1] + 0.16, zf - 0.13)) });
    B.add(m.birch, place(roundedBox(0.16, 0.08, 0.11, 0.015, 2), mid - 0.19, shelves[4] + 0.04, zf - 0.12), { role: 'shelf' });
    B.add(m.pine, place(roundedBox(0.17, 0.008, 0.12, 0.003, 1), mid - 0.19, shelves[4] + 0.084, zf - 0.12), { role: 'shelf' });
    horse(B, m, mid + 0.22, shelves[3], zf - 0.12);
    shadows.add((S.x0 + S.x1) / 2, zb + S.d / 2, S.x1 - S.x0, S.d, 0, 0.12, 0.5);
  }

  /* ---------------------------- sideboard ------------------------------ */
  {
    const S = LIVING.sideboard;
    const x0 = S.x - S.d;
    // painted carcass, oiled pine top, two doors with wooden knobs, short legs
    B.add(m.painted, boxMinMax(x0, 0.1, S.z0, S.x, S.h - 0.03, S.z1, 'z'), { role: 'sideboard', cast: true });
    B.add(m.pine, place(roundedBox(S.d + 0.03, 0.03, S.z1 - S.z0 + 0.04, 0.006, 2, 'z'), x0 + S.d / 2 - 0.015, S.h - 0.015, (S.z0 + S.z1) / 2), { role: 'sideboard', cast: true });
    for (const s of [-1, 1]) {
      const zc = (S.z0 + S.z1) / 2 + s * (S.z1 - S.z0) / 4;
      B.add(m.painted, boxMinMax(x0 - 0.012, 0.16, zc - (S.z1 - S.z0) / 4 + 0.03, x0, S.h - 0.09, zc + (S.z1 - S.z0) / 4 - 0.03, 'z'), { role: 'sideboard' });
      B.add(m.pine, place(new THREE.SphereGeometry(0.014, 8, 6), x0 - 0.02, S.h - 0.2, zc - s * 0.16), { role: 'sideboard' });
      for (const z of [S.z0 + 0.04, S.z1 - 0.04]) B.add(m.darkWood, place(leg(0.1, 0.02, 0.015), x0 + 0.05 + (s > 0 ? S.d - 0.1 : 0), 0, z), { role: 'sideboard' });
    }
    // table lamp: a turned stoneware base and a linen shade
    const lx = x0 + S.d / 2;
    const lz = S.z0 + 0.42;
    const y0 = S.h;
    B.add(m.stoneware, place(turned([[0, 0], [0.06, 0], [0.09, 0.07], [0.085, 0.16], [0.03, 0.22], [0.015, 0.26], [0, 0.26]], 22), lx, y0, lz), { role: 'lamp' });
    B.add(m.brass, place(rod(new THREE.Vector3(0, 0.26, 0), new THREE.Vector3(0, 0.36, 0), 0.006, 6), lx, y0, lz), { role: 'lamp' });
    const shade = lampShadeMaterial(m.linen, 0xffdcb0);
    const sh = drumShade(0.17, 0.12, 0.22);
    sh.translate(lx, y0 + 0.3, lz);
    B.add(shade, sh, { role: 'lamp' });
    const bulb = bulbMaterial();
    B.add(bulb, place(new THREE.SphereGeometry(0.025, 10, 8), lx, y0 + 0.37, lz), { role: 'lamp' });
    const sc = lampScallop({ bulb: new THREE.Vector3(lx, y0 + 0.37, lz), top: [0.15, 0.12], bottom: [0.07, 0.17], wallPoint: new THREE.Vector3(5.76, 0, 0), wallNormal: new THREE.Vector3(-1, 0, 0), width: 1.72, height: 2.3, y0: S.h + 0.01, along: -0.01 });
    lights.group.add(sc.mesh);
    const id = lights.add({ id: 'table-lamp', zone: 'living', kind: 'lamp', label: 'Table lamp', pos: new THREE.Vector3(lx - 0.05, y0 + 0.36, lz), power: 0.26, reach: 5.5, glow: [{ mat: shade, k: 0.45 }, { mat: bulb, k: 6 }], levels: [{ u: sc.level, k: 1 }] });
    lampPicks.push({ light: id, object: pickBox(0.36, 0.55, 0.36, new THREE.Vector3(lx, y0 + 0.28, lz)) });
    // a stack of books, an enamel bowl, a pair of candles in brass
    for (let k = 0; k < 3; k++) {
      const g = new THREE.BoxGeometry(0.17 - k * 0.01, 0.03, 0.24 - k * 0.015);
      B.add(k === 1 ? m.leather : m.painted === m.painted && k === 0 ? m.darkWood : m.felt, place(g, lx + 0.01, y0 + 0.015 + k * 0.03, S.z1 - 0.32, 0.12 * k), { role: 'sideboard' });
    }
    B.add(m.enamelWhite, place(bowl(0.12, 0.07), lx, y0, S.z1 - 0.1), { role: 'sideboard' });
    shadows.add(x0 + S.d / 2, (S.z0 + S.z1) / 2, S.d, S.z1 - S.z0, 0, 0.1, 0.5);
  }

  /* ---------------------------- window sills ---------------------------- */
  {
    // the deep inner sills: candles in clusters, a lantern, cones, a little frost-light
    const sill = (x: number, z: number, y: number, along: 'x' | 'z', seed: number, label: string) => {
      const r = mulberry32(seed);
      const id = lights.add({ id: `sill-${label}`, zone: 'living', kind: 'candle', label: 'Candles', pos: new THREE.Vector3(x, y + 0.15, z), power: 0 });
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.13 + (r() - 0.5) * 0.03;
        const p = along === 'x' ? new THREE.Vector3(x + off, y, z + (r() - 0.5) * 0.04) : new THREE.Vector3(x + (r() - 0.5) * 0.04, y, z + off);
        const h = 0.07 + r() * 0.12;
        const rr = i === 0 ? 0.03 : 0.012 + r() * 0.006;
        if (rr < 0.02) {
          // a thin candle in a small brass holder
          B.add(m.brass, place(turned([[0, 0], [0.03, 0], [0.032, 0.006], [0.014, 0.012], [0.014, 0.03], [0, 0.03]], 12), p.x, p.y, p.z), { role: 'sill' });
          lights.candle(id, new THREE.Vector3(p.x, p.y + 0.03, p.z), h, rr, 0.1);
        } else {
          // a pillar candle on a small dish
          B.add(m.stoneware, place(turned([[0, 0], [0.05, 0], [0.052, 0.008], [0.0, 0.006]], 16), p.x, p.y, p.z), { role: 'sill' });
          lights.candle(id, new THREE.Vector3(p.x, p.y + 0.006, p.z), 0.08 + r() * 0.04, rr, 0.9);
        }
      }
      lampPicks.push({ light: id, object: pickBox(along === 'x' ? 0.45 : 0.18, 0.3, along === 'x' ? 0.18 : 0.45, new THREE.Vector3(x, y + 0.12, z)) });
    };
    const zs = 3.5 - 0.205;
    sill(-0.5, zs, 0.72, 'x', 401, 's1');
    sill(1.9, zs, 0.72, 'x', 402, 's2');
    sill(4.3, zs, 0.72, 'x', 403, 's3');
    sill(6 - 0.205, -1.5, 0.72, 'z', 404, 'e1');
    sill(6 - 0.205, 1.5, 0.72, 'z', 405, 'e2');
  }

  /* ---------------------- a pair of antlers, a clock ---------------------- */
  {
    // reindeer antlers on a small board above the sideboard, between the east windows
    const x = 5.76 - 0.02;
    const y = 1.75;
    const z = 0;
    B.add(m.darkWood, place(roundedBox(0.03, 0.22, 0.16, 0.01, 2), x - 0.015, y, z), { role: 'antlers' });
    for (const s of [-1, 1]) {
      const pts = [new THREE.Vector3(x - 0.04, y + 0.02, z + s * 0.04), new THREE.Vector3(x - 0.14, y + 0.14, z + s * 0.16), new THREE.Vector3(x - 0.2, y + 0.36, z + s * 0.26), new THREE.Vector3(x - 0.16, y + 0.58, z + s * 0.24), new THREE.Vector3(x - 0.08, y + 0.72, z + s * 0.15)];
      B.add(m.bone, tube(pts, 0.016, 18, 6), { role: 'antlers' });
      // tines
      for (const [t, len, a] of [
        [0.25, 0.16, 0.9],
        [0.5, 0.18, 0.6],
        [0.72, 0.14, 0.4],
      ] as const) {
        const c = new THREE.CatmullRomCurve3(pts).getPointAt(t);
        const tip = c.clone().add(new THREE.Vector3(-len * 0.6, len * Math.cos(a), s * len * Math.sin(a) * 0.4));
        B.add(m.bone, tube([c, c.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.02, 0)), tip], 0.009, 8, 5), { role: 'antlers' });
      }
      // the brow tine hangs forward over the board
      const brow = [pts[0].clone().add(new THREE.Vector3(-0.04, 0.03, 0)), new THREE.Vector3(x - 0.18, y + 0.06, z + s * 0.08), new THREE.Vector3(x - 0.26, y + 0.12, z + s * 0.05)];
      B.add(m.bone, tube(brow, 0.01, 10, 5), { role: 'antlers' });
    }
  }

  return { lampPicks };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** an outline of a reindeer hide (spine along z, head toward +z), ~1.1 × 0.95 m */
export function hideOutline(): V2[] {
  const right: V2[] = [
    [0.0, -0.6],
    [0.06, -0.57],
    [0.14, -0.5],
    [0.3, -0.5],
    [0.4, -0.58],
    [0.47, -0.66],
    [0.48, -0.56],
    [0.42, -0.42],
    [0.36, -0.28],
    [0.37, -0.05],
    [0.35, 0.16],
    [0.44, 0.26],
    [0.54, 0.33],
    [0.47, 0.4],
    [0.3, 0.4],
    [0.17, 0.46],
    [0.11, 0.58],
    [0.05, 0.66],
    [0.0, 0.68],
  ];
  const left = right
    .slice(1, -1)
    .reverse()
    .map(([x, z], i) => [-x * (1 + 0.04 * Math.sin(i * 1.3)), z + 0.01 * Math.cos(i)] as V2);
  return [...right, ...left];
}

/** an open drum shade (outer and inner wall), radii at the bottom and top, height h, base at y = 0 */
export function drumShade(rBottom: number, rTop: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 28, 1, true);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * rBottom, uv.getY(i) * h);
  return g;
}

/**
 * A linen shade lit from inside: the material glows (emissive set per frame by
 * the lights) and shows the light through the cloth from both sides.
 */
export function lampShadeMaterial(linen: THREE.MeshStandardMaterial, glow: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const s = linen.clone();
  s.name = 'lampShade';
  s.side = THREE.DoubleSide;
  s.color.set(0xf4ead8);
  s.emissive.set(glow);
  s.emissiveIntensity = 1;
  s.userData.snow = 0;
  return s;
}

export function bulbMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'bulb', color: 0xfff4e0, emissive: 0xffc888, emissiveIntensity: 4, roughness: 0.3 });
  m.userData.snow = 0;
  return m;
}

/** an invisible pick box (house-local centre) */
export function pickBox(w: number, h: number, d: number, c: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.copy(c);
  mesh.name = 'pick';
  mesh.userData.snow = 0;
  return mesh;
}

/** a little carved wooden horse, painted red, for a shelf */
function horse(B: Kit['B'], m: InteriorMats, x: number, y: number, z: number): void {
  const s = new THREE.Shape();
  const pts: V2[] = [
    [-0.05, 0],
    [-0.035, 0],
    [-0.03, 0.04],
    [0.02, 0.04],
    [0.025, 0],
    [0.04, 0],
    [0.045, 0.06],
    [0.06, 0.09],
    [0.07, 0.115],
    [0.055, 0.12],
    [0.035, 0.1],
    [0.02, 0.075],
    [-0.04, 0.075],
    [-0.055, 0.06],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -0.011);
  g.rotateY(0.4);
  B.add(m.paintedRed, place(g, x, y + 0.004, z), { role: 'shelf' });
}
