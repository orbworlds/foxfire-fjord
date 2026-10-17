/**
 * The kitchen nook at the cabin's west end and the table by its window:
 * painted base cupboards along the north wall under a slate worktop, a white
 * farmhouse sink with a brass tap under the window, a two-plate cooker, open
 * pine shelves of stoneware mugs, plates and jars, a red enamel coffee kettle
 * and a box coffee grinder on the counter, a tall painted pantry cupboard on
 * the gable wall, and a small dining table under the west window with four
 * chairs, two candles and an enamel pendant lamp over it.
 */
import * as THREE from 'three';
import { boxMinMax } from '../house/kit';
import { roundedBox } from '../../core/geometry';
import { mulberry32 } from '../../world/noise';
import type { InteriorMats } from './mats';
import type { Lights } from './lights';
import { place, rod, softBox, tube, turned } from './kit';
import { bowl, candlestick, frame, jar, leg, mug, type Kit } from './furn';
import { bulbMaterial, pickBox } from './living';
import { lampScallop } from './scallop';

export const KITCHEN = {
  counter: { x0: -5.76, x1: -3.38, z0: -3.26, z1: -2.66, h: 0.9 },
  sink: { x: -4.9 },
  ret: { z1: -1.35 },
  pantry: { z0: -1.2, z1: -0.35, d: 0.5, h: 1.9 },
  table: { x: -5.0, z: 0.9, w: 1.3, d: 0.78, h: 0.74 },
};

export interface KitchenBuild {
  lampPicks: { light: number; object: THREE.Object3D }[];
}

export function buildKitchen(k: Kit, m: InteriorMats, lights: Lights): KitchenBuild {
  const { B, shadows } = k;
  const lampPicks: KitchenBuild['lampPicks'] = [];
  const C = KITCHEN.counter;
  const rnd = mulberry32(501);
  const top = C.h;

  /* --------------------- base cupboards and worktop --------------------- */
  {
    // north run (x) and a short return along the west wall (z)
    const runs: { x0: number; x1: number; z0: number; z1: number; along: 'x' | 'z' }[] = [
      { x0: C.x0, x1: C.x1, z0: C.z0, z1: C.z1, along: 'x' },
      { x0: C.x0, x1: C.x0 + (C.z1 - C.z0), z0: C.z1, z1: KITCHEN.ret.z1, along: 'z' },
    ];
    for (const r of runs) {
      // toe kick, carcass, worktop
      if (r.along === 'x') {
        B.add(m.black, boxMinMax(r.x0, 0, r.z0, r.x1, 0.1, r.z1 - 0.06, 'x'), { role: 'kitchen' });
        B.add(m.painted, boxMinMax(r.x0, 0.1, r.z0, r.x1, top - 0.04, r.z1 - 0.02, 'x'), { role: 'kitchen', cast: true });
      } else {
        B.add(m.black, boxMinMax(r.x0, 0, r.z0, r.x1 - 0.06, 0.1, r.z1, 'z'), { role: 'kitchen' });
        B.add(m.painted, boxMinMax(r.x0, 0.1, r.z0, r.x1 - 0.02, top - 0.04, r.z1, 'z'), { role: 'kitchen', cast: true });
      }
    }
    // worktop: oiled slate, the sink cut out of it
    const sx0 = KITCHEN.sink.x - 0.32;
    const sx1 = KITCHEN.sink.x + 0.32;
    B.add(m.slate, boxMinMax(C.x0, top - 0.04, C.z0, sx0, top, C.z1 + 0.02, 'x'), { role: 'kitchen', cast: true });
    B.add(m.slate, boxMinMax(sx1, top - 0.04, C.z0, C.x1 + 0.02, top, C.z1 + 0.02, 'x'), { role: 'kitchen', cast: true });
    B.add(m.slate, boxMinMax(sx0, top - 0.04, C.z0, sx1, top, C.z0 + 0.06, 'x'), { role: 'kitchen' });
    B.add(m.slate, boxMinMax(C.x0, top - 0.04, C.z1 + 0.02, C.x0 + 0.62, top, KITCHEN.ret.z1 + 0.02, 'z'), { role: 'kitchen', cast: true });
    // cupboard doors with a raised panel and a wooden knob
    const doorsX = [C.x0 + 0.62, sx0, sx1, C.x1];
    for (let i = 0; i < doorsX.length - 1; i++) {
      const a = doorsX[i] + 0.01;
      const b = doorsX[i + 1] - 0.01;
      if (b - a < 0.15) continue;
      const n = Math.max(1, Math.round((b - a) / 0.5));
      const w = (b - a) / n;
      for (let j = 0; j < n; j++) {
        const d0 = a + j * w + 0.006;
        const d1 = a + (j + 1) * w - 0.006;
        B.add(m.painted, boxMinMax(d0, 0.13, C.z1 - 0.02, d1, top - 0.07, C.z1, 'y'), { role: 'kitchen' });
        B.add(m.painted, boxMinMax(d0 + 0.06, 0.2, C.z1, d1 - 0.06, top - 0.14, C.z1 + 0.008, 'y'), { role: 'kitchen' });
        B.add(m.pine, place(new THREE.SphereGeometry(0.013, 8, 6), j % 2 ? d0 + 0.05 : d1 - 0.05, top - 0.17, C.z1 + 0.014), { role: 'kitchen' });
      }
    }
    // under the sink: a linen curtain instead of a door
    B.add(m.linen, boxMinMax(sx0 + 0.02, 0.12, C.z1 - 0.01, sx1 - 0.02, top - 0.24, C.z1, 'y'), { role: 'kitchen' });
    // return doors (facing +x)
    B.add(m.painted, boxMinMax(C.x0 + 0.6, 0.13, C.z1 + 0.04, C.x0 + 0.62, top - 0.07, KITCHEN.ret.z1 - 0.02, 'y'), { role: 'kitchen' });
    B.add(m.pine, place(new THREE.SphereGeometry(0.013, 8, 6), C.x0 + 0.635, top - 0.17, KITCHEN.ret.z1 - 0.08), { role: 'kitchen' });
    shadows.add((C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2 + 0.05, C.x1 - C.x0, C.z1 - C.z0 + 0.04, 0, 0.1, 0.45);
  }

  /* ----------------------------- the sink ----------------------------- */
  {
    const x = KITCHEN.sink.x;
    const z0 = C.z0 + 0.06;
    const z1 = C.z1 + 0.025;
    const y0 = top - 0.22;
    const t = 0.03;
    const w = 0.62;
    // a fireclay farmhouse sink: apron front, walls, a basin floor
    B.add(m.enamelWhite, place(roundedBox(w, 0.22, 0.03, 0.01, 2), x, y0 + 0.11, z1 - 0.015), { role: 'sink', cast: true });
    B.add(m.enamelWhite, boxMinMax(x - w / 2, y0, z0, x + w / 2, top, z0 + t, 'x'), { role: 'sink' });
    B.add(m.enamelWhite, boxMinMax(x - w / 2, y0, z0, x - w / 2 + t, top, z1 - 0.02, 'z'), { role: 'sink' });
    B.add(m.enamelWhite, boxMinMax(x + w / 2 - t, y0, z0, x + w / 2, top, z1 - 0.02, 'z'), { role: 'sink' });
    B.add(m.enamelWhite, boxMinMax(x - w / 2, y0, z0, x + w / 2, y0 + 0.03, z1 - 0.02, 'x'), { role: 'sink' });
    // brass tap rising from the back, a swan neck over the basin
    const tp = [new THREE.Vector3(x, top, z0 + 0.03), new THREE.Vector3(x, top + 0.22, z0 + 0.04), new THREE.Vector3(x, top + 0.29, z0 + 0.12), new THREE.Vector3(x, top + 0.22, z0 + 0.2), new THREE.Vector3(x, top + 0.17, z0 + 0.21)];
    B.add(m.brass, tube(tp, 0.012, 20, 8), { role: 'sink' });
    for (const s of [-1, 1]) {
      B.add(m.brass, rod(new THREE.Vector3(x + s * 0.09, top, z0 + 0.03), new THREE.Vector3(x + s * 0.09, top + 0.06, z0 + 0.03), 0.01, 8), { role: 'sink' });
      B.add(m.ceramic, place(turned([[0, 0], [0.022, 0], [0.024, 0.012], [0.0, 0.02]], 10), x + s * 0.09, top + 0.06, z0 + 0.03), { role: 'sink' });
    }
    // a dish brush and an enamel bowl draining
    B.add(m.enamelWhite, place(bowl(0.1, 0.06), x - 0.15, y0 + 0.03, (z0 + z1) / 2), { role: 'sink' });
  }

  /* ----------------------------- cooker ------------------------------- */
  {
    // two black cast plates on a small enamel cooker set into the worktop's east end
    const x = C.x1 - 0.34;
    const z = (C.z0 + C.z1) / 2 + 0.02;
    B.add(m.enamelWhite, boxMinMax(x - 0.29, top, z - 0.26, x + 0.29, top + 0.02, z + 0.26, 'x'), { role: 'cooker' });
    for (const s of [-1, 1]) {
      B.add(m.iron, place(turned([[0, 0], [0.095, 0], [0.095, 0.012], [0.0, 0.012]], 24), x + s * 0.14, top + 0.02, z), { role: 'cooker' });
      B.add(m.black, place(new THREE.TorusGeometry(0.06, 0.003, 4, 24), x + s * 0.14, top + 0.033, z, 0, Math.PI / 2), { role: 'cooker' });
    }
    // the red enamel coffee kettle on the left plate
    const kx = x - 0.14;
    const ky = top + 0.032;
    B.add(m.enamelRed, place(turned([[0, 0], [0.075, 0], [0.085, 0.015], [0.085, 0.09], [0.07, 0.13], [0.05, 0.15], [0.05, 0.16], [0, 0.16]], 24), kx, ky, z), { role: 'enamel', cast: true });
    B.add(m.enamelRed, place(turned([[0, 0], [0.052, 0], [0.04, 0.012], [0.012, 0.02], [0.012, 0.035], [0.02, 0.04], [0, 0.045]], 16), kx, ky + 0.16, z), { role: 'enamel' });
    B.add(m.enamelRed, tube([new THREE.Vector3(kx + 0.07, ky + 0.04, z), new THREE.Vector3(kx + 0.12, ky + 0.09, z), new THREE.Vector3(kx + 0.15, ky + 0.15, z)], 0.012, 12, 8), { role: 'enamel' });
    B.add(m.black, tube([new THREE.Vector3(kx - 0.06, ky + 0.13, z), new THREE.Vector3(kx - 0.12, ky + 0.12, z), new THREE.Vector3(kx - 0.12, ky + 0.04, z), new THREE.Vector3(kx - 0.08, ky + 0.03, z)], 0.008, 14, 6), { role: 'enamel' });
    // a cast-iron pan on the right plate
    B.add(m.iron, place(turned([[0, 0], [0.11, 0], [0.12, 0.04], [0.112, 0.042], [0.1, 0.008], [0, 0.008]], 24), x + 0.14, top + 0.033, z), { role: 'cooker' });
    B.add(m.iron, place(new THREE.BoxGeometry(0.18, 0.012, 0.03), x + 0.14 + 0.2, top + 0.065, z, 0, 0, 0.18), { role: 'cooker' });
  }

  /* ------------------- counter things: grinder, board ------------------- */
  {
    // a box coffee grinder: dovetailed pine box, a drawer, a brass hopper and crank
    const gx = -5.48;
    const gz = C.z0 + 0.25;
    B.add(m.darkWood, place(roundedBox(0.14, 0.13, 0.14, 0.006, 2), gx, top + 0.065, gz), { role: 'grinder', cast: true });
    B.add(m.pine, boxMinMax(gx - 0.045, top + 0.02, gz + 0.07, gx + 0.045, top + 0.06, gz + 0.075, 'x'), { role: 'grinder' });
    B.add(m.brass, place(new THREE.SphereGeometry(0.006, 6, 5), gx, top + 0.04, gz + 0.08), { role: 'grinder' });
    B.add(m.brass, place(turned([[0.03, 0], [0.055, 0.04], [0.058, 0.045], [0.0, 0.045]], 16), gx, top + 0.13, gz), { role: 'grinder' });
    B.add(m.iron, rod(new THREE.Vector3(gx, top + 0.175, gz), new THREE.Vector3(gx, top + 0.2, gz), 0.006, 6), { role: 'grinder' });
    B.add(m.iron, tube([new THREE.Vector3(gx, top + 0.2, gz), new THREE.Vector3(gx + 0.06, top + 0.205, gz + 0.01), new THREE.Vector3(gx + 0.11, top + 0.2, gz + 0.02)], 0.004, 8, 5), { role: 'grinder' });
    B.add(m.darkWood, place(turned([[0, 0], [0.012, 0], [0.014, 0.02], [0.008, 0.04], [0, 0.042]], 10), gx + 0.11, top + 0.2, gz + 0.02), { role: 'grinder' });
    // a bread board with a loaf, a knife; a stoneware crock of spoons; jars of coffee and oats
    B.add(m.pine, place(roundedBox(0.4, 0.025, 0.26, 0.008, 2, 'x'), -4.15, top + 0.0125, C.z0 + 0.32, 0.12), { role: 'kitchen' });
    const loaf = softBox(0.24, 0.1, 0.12, { r: 0.045, bulge: 0.025, side: 0.01, seed: 61 });
    B.add(m.leather, place(loaf, -4.17, top + 0.075, C.z0 + 0.32, 0.12), { role: 'kitchen' });
    B.add(m.stoneware, place(turned([[0, 0], [0.06, 0], [0.065, 0.14], [0.06, 0.15], [0.055, 0.02], [0, 0.02]], 18), -3.6, top, C.z0 + 0.1), { role: 'kitchen' });
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      B.add(m.pine, rod(new THREE.Vector3(-3.6 + Math.cos(a) * 0.02, top + 0.03, C.z0 + 0.1 + Math.sin(a) * 0.02), new THREE.Vector3(-3.6 + Math.cos(a) * 0.05, top + 0.3, C.z0 + 0.1 + Math.sin(a) * 0.05), 0.006, 5), { role: 'kitchen' });
    }
    for (let i = 0; i < 3; i++) B.add(i === 1 ? m.enamelWhite : m.steel, place(jar(0.045, 0.13 + i * 0.02), C.x0 + 0.2, top, -2.45 + i * 0.13), { role: 'kitchen' });
  }

  /* --------------------------- open shelves --------------------------- */
  {
    // two pine shelves on brackets right of the window, a rail of cup hooks under the lower one
    const x0 = -4.42;
    const x1 = -3.42;
    const zb = C.z0;
    const d = 0.24;
    const ys = [1.42, 1.78];
    for (const y of ys) {
      B.add(m.pine, boxMinMax(x0, y - 0.028, zb, x1, y, zb + d, 'x'), { role: 'shelves', cast: true });
      for (const x of [x0 + 0.08, x1 - 0.08]) B.add(m.iron, boxMinMax(x - 0.01, y - 0.17, zb, x + 0.01, y - 0.028, zb + 0.16, 'z'), { role: 'shelves' });
    }
    // lower shelf: stoneware plates standing, bowls stacked, jars
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(0.12, 0.12, 0.016, 24);
      g.rotateX(Math.PI / 2 - 0.12);
      B.add(i % 3 === 0 ? m.enamelWhite : m.stoneware, place(g, x0 + 0.16 + i * 0.022, ys[0] + 0.12, zb + 0.06), { role: 'shelves' });
    }
    for (let i = 0; i < 3; i++) B.add(m.ceramic, place(bowl(0.08, 0.05), x0 + 0.45, ys[0] + i * 0.02, zb + 0.12), { role: 'shelves' });
    for (let i = 0; i < 3; i++) B.add(i === 2 ? m.copper : m.steel, place(jar(0.04, 0.12 + 0.02 * (i % 2)), x0 + 0.65 + i * 0.1, ys[0], zb + 0.12), { role: 'shelves' });
    // upper shelf: mugs in a row, an enamel jug
    for (let i = 0; i < 5; i++) {
      const [b, h] = mug(0.038, 0.088);
      const rot = -0.6 + rnd() * 0.5;
      const mat = i % 2 ? m.stoneware : m.enamelWhite;
      B.add(mat, place(b, x0 + 0.12 + i * 0.12, ys[1], zb + 0.12, rot), { role: 'mugs' });
      B.add(mat, place(h, x0 + 0.12 + i * 0.12, ys[1], zb + 0.12, rot), { role: 'mugs' });
    }
    B.add(m.enamelWhite, place(turned([[0, 0], [0.06, 0], [0.07, 0.08], [0.055, 0.16], [0.06, 0.2], [0, 0.2]], 18), x1 - 0.12, ys[1], zb + 0.12), { role: 'shelves' });
    // cups hanging on hooks under the lower shelf
    for (let i = 0; i < 4; i++) {
      const hx = x0 + 0.2 + i * 0.17;
      B.add(m.brass, tube([new THREE.Vector3(hx, ys[0] - 0.028, zb + 0.12), new THREE.Vector3(hx, ys[0] - 0.06, zb + 0.12), new THREE.Vector3(hx + 0.015, ys[0] - 0.07, zb + 0.12)], 0.003, 8, 4), { role: 'mugs' });
      const [b, h] = mug(0.036, 0.085);
      for (const g of [b, h]) {
        g.translate(-0.036 - 0.02, -0.085 * 0.52, 0);
        g.rotateZ(Math.PI / 2 + 0.1);
        B.add(i % 2 ? m.enamelRed : m.stoneware, place(g, hx + 0.012, ys[0] - 0.1, zb + 0.12, 0), { role: 'mugs' });
      }
    }
    // a small enamel wall lamp over the counter
    const lx = -3.92;
    const ly = 2.2;
    const lz = zb + 0.18;
    B.add(m.iron, rod(new THREE.Vector3(lx, ly + 0.08, zb), new THREE.Vector3(lx, ly + 0.08, lz), 0.008, 6), { role: 'lamp' });
    const shade = enamelShade();
    B.add(m.enamelWhite, place(shade, lx, ly, lz), { role: 'lamp' });
    const bulb = bulbMaterial();
    B.add(bulb, place(new THREE.SphereGeometry(0.03, 10, 8), lx, ly - 0.02, lz), { role: 'lamp' });
    const sc = lampScallop({ bulb: new THREE.Vector3(lx, ly - 0.02, lz), top: [0.12, 0.015], bottom: [0.02, 0.125], wallPoint: new THREE.Vector3(0, 0, zb), wallNormal: new THREE.Vector3(0, 0, 1), width: 0.92, height: 1.62, y0: top + 0.005, along: -3.85 });
    lights.group.add(sc.mesh);
    const id = lights.add({ id: 'kitchen-lamp', zone: 'living', kind: 'lamp', label: 'Kitchen lamp', pos: new THREE.Vector3(lx, ly - 0.06, lz + 0.1), power: 0.24, reach: 4.5, glow: [{ mat: bulb, k: 6 }], levels: [{ u: sc.level, k: 1.3 }] });
    lampPicks.push({ light: id, object: pickBox(0.3, 0.3, 0.3, new THREE.Vector3(lx, ly, lz)) });
  }

  /* --------------------------- pantry cupboard --------------------------- */
  {
    const P = KITCHEN.pantry;
    const x0 = C.x0;
    const x1 = C.x0 + P.d;
    B.add(m.painted, boxMinMax(x0, 0.06, P.z0, x1, P.h, P.z1, 'y'), { role: 'pantry', cast: true });
    B.add(m.painted, boxMinMax(x0, P.h, P.z0 - 0.02, x1 + 0.03, P.h + 0.05, P.z1 + 0.02, 'z'), { role: 'pantry' });
    B.add(m.black, boxMinMax(x0, 0, P.z0 + 0.03, x1 - 0.03, 0.06, P.z1 - 0.03, 'z'), { role: 'pantry' });
    // two tall doors, raised panels, iron latches
    const zm = (P.z0 + P.z1) / 2;
    for (const [a, b] of [
      [P.z0 + 0.02, zm - 0.004],
      [zm + 0.004, P.z1 - 0.02],
    ]) {
      B.add(m.painted, boxMinMax(x1, 0.1, a, x1 + 0.02, P.h - 0.05, b, 'y'), { role: 'pantry' });
      for (const [y0, y1] of [
        [0.18, 0.9],
        [1.0, P.h - 0.13],
      ]) B.add(m.painted, boxMinMax(x1 + 0.02, y0, a + 0.06, x1 + 0.028, y1, b - 0.06, 'y'), { role: 'pantry' });
    }
    B.add(m.iron, boxMinMax(x1 + 0.02, 1.0, zm - 0.06, x1 + 0.035, 1.03, zm + 0.06, 'z'), { role: 'pantry' });
    // a basket of birch-bark on top
    B.add(m.birch, place(roundedBox(0.3, 0.16, 0.34, 0.02, 2), x0 + 0.24, P.h + 0.13, zm), { role: 'pantry' });
    shadows.add(x0 + P.d / 2, zm, P.d, P.z1 - P.z0, 0, 0.1, 0.5);
  }

  /* ------------------------ dining table, chairs ------------------------ */
  {
    const T = KITCHEN.table;
    const x0 = C.x0 + 0.02;
    const cx = x0 + T.w / 2;
    const P = frame(cx, T.z, 0);
    // a trestle-ish table: thick plank top, apron, four square legs
    B.add(m.pine, P(place(roundedBox(T.w, 0.045, T.d, 0.006, 2, 'x'), 0, T.h - 0.0225, 0)), { role: 'dining', cast: true });
    B.add(m.pine, P(boxMinMax(-T.w / 2 + 0.06, T.h - 0.13, -T.d / 2 + 0.06, T.w / 2 - 0.06, T.h - 0.045, -T.d / 2 + 0.085, 'x')), { role: 'dining' });
    B.add(m.pine, P(boxMinMax(-T.w / 2 + 0.06, T.h - 0.13, T.d / 2 - 0.085, T.w / 2 - 0.06, T.h - 0.045, T.d / 2 - 0.06, 'x')), { role: 'dining' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(m.pine, P(boxMinMax(sx * (T.w / 2 - 0.06) - 0.03, 0, sz * (T.d / 2 - 0.06) - 0.03, sx * (T.w / 2 - 0.06) + 0.03, T.h - 0.045, sz * (T.d / 2 - 0.06) + 0.03, 'y')), { role: 'dining', cast: true });
    // a linen runner down the middle
    B.add(m.linen, P(boxMinMax(-T.w / 2 + 0.08, T.h, -0.16, T.w / 2 - 0.08, T.h + 0.002, 0.16, 'x')), { role: 'dining' });
    // two candles in brass sticks: they light the table
    const id = lights.add({ id: 'dining-candles', zone: 'living', kind: 'candle', label: 'Candles', pos: new THREE.Vector3(cx + 0.05, T.h + 0.3, T.z), power: 0, reach: 3 });
    for (const dx of [-0.12, 0.14]) {
      const cs = candlestick(0.13);
      B.add(m.brass, P(place(cs.geo, dx, T.h + 0.002, dx > 0 ? 0.03 : -0.04)), { role: 'dining' });
      lights.candle(id, new THREE.Vector3(cx + dx, T.h + 0.002 + cs.top, T.z + (dx > 0 ? 0.03 : -0.04)), 0.2, 0.011, 0.25);
    }
    lampPicks.push({ light: id, object: pickBox(0.45, 0.4, 0.2, new THREE.Vector3(cx, T.h + 0.2, T.z)) });
    // two mugs and a bowl of lingonberries? keep it simple: mugs and a jug
    for (const [dx, dz] of [
      [-0.38, 0.22],
      [0.32, -0.25],
    ]) {
      const [b, h] = mug(0.038, 0.088);
      B.add(m.stoneware, P(place(b, dx, T.h, dz, dx * 3)), { role: 'dining' });
      B.add(m.stoneware, P(place(h, dx, T.h, dz, dx * 3)), { role: 'dining' });
    }
    // an enamel milk jug: round belly, a waist, a flared lip with a pouring spout, a strap handle
    for (const g of enamelJug()) B.add(m.enamelWhite, P(place(g, 0.42, T.h, 0.12, 2.4)), { role: 'dining' });
    // chairs: two on each long side, painted red spindle-backs
    const chair = (x: number, z: number, rot: number) => {
      const Q = frame(x, z, rot);
      const sw = 0.42;
      const sh = 0.45;
      B.add(m.pine, Q(place(roundedBox(sw, 0.035, 0.4, 0.008, 2, 'x'), 0, sh, 0)), { role: 'chairs', cast: true });
      for (const sx of [-1, 1]) {
        B.add(m.paintedRed, Q(place(leg(sh - 0.02, 0.018, 0.014), sx * (sw / 2 - 0.04), 0, 0.16)), { role: 'chairs', cast: true });
        B.add(m.paintedRed, Q(rod(new THREE.Vector3(sx * (sw / 2 - 0.04), 0, -0.17), new THREE.Vector3(sx * (sw / 2 - 0.04), 0.92, -0.22), 0.016, 8)), { role: 'chairs', cast: true });
      }
      B.add(m.paintedRed, Q(place(roundedBox(sw - 0.04, 0.07, 0.025, 0.008, 2, 'x'), 0, 0.86, -0.215, 0, 0.06)), { role: 'chairs' });
      for (let s = -2; s <= 2; s++) B.add(m.paintedRed, Q(rod(new THREE.Vector3(s * 0.065, sh + 0.02, -0.19), new THREE.Vector3(s * 0.065, 0.83, -0.213), 0.007, 6)), { role: 'chairs' });
      B.add(m.paintedRed, Q(rod(new THREE.Vector3(-sw / 2 + 0.04, 0.16, 0.16), new THREE.Vector3(sw / 2 - 0.04, 0.16, 0.16), 0.009, 6)), { role: 'chairs' });
      shadows.add(x, z, sw, 0.42, -rot, 0.1, 0.4);
    };
    chair(cx - 0.3, T.z - T.d / 2 - 0.2, 0);
    chair(cx + 0.32, T.z - T.d / 2 - 0.26, 0.15);
    chair(cx - 0.28, T.z + T.d / 2 + 0.22, Math.PI);
    chair(cx + 0.95, T.z + 0.05, -Math.PI / 2 - 0.1);
    // a wool seat pad on one chair
    B.add(m.woolOat, place(softBox(0.38, 0.04, 0.36, { r: 0.015, bulge: 0.01, seed: 71 }), cx - 0.3, 0.49, T.z - T.d / 2 - 0.2), { role: 'chairs' });
    // the pendant over the table: a white enamel shade on a cloth cord
    const py = 1.62;
    B.add(m.black, rod(new THREE.Vector3(cx, 2.56, T.z), new THREE.Vector3(cx, py + 0.1, T.z), 0.004, 5), { role: 'lamp' });
    const shade = enamelShade(1.4);
    B.add(m.enamelWhite, place(shade, cx, py, T.z), { role: 'lamp' });
    const bulb = bulbMaterial();
    B.add(bulb, place(new THREE.SphereGeometry(0.035, 10, 8), cx, py - 0.03, T.z), { role: 'lamp' });
    const pid = lights.add({ id: 'pendant', zone: 'living', kind: 'lamp', label: 'Pendant lamp', pos: new THREE.Vector3(cx, py - 0.12, T.z), power: 0.3, reach: 5, glow: [{ mat: bulb, k: 6 }] });
    lampPicks.push({ light: pid, object: pickBox(0.4, 0.3, 0.4, new THREE.Vector3(cx, py, T.z)) });
    shadows.add(cx, T.z, T.w, T.d, 0, 0.16, 0.35);
  }

  return { lampPicks };
}

/** an enamel jug (hollow, with a rim), handle toward -x, spout toward +x */
function enamelJug(): THREE.BufferGeometry[] {
  const body = turned([
    [0, 0.002],
    [0.045, 0],
    [0.058, 0.03],
    [0.06, 0.07],
    [0.048, 0.12],
    [0.044, 0.14],
    [0.05, 0.168],
    [0.047, 0.17],
    [0.04, 0.142],
    [0.042, 0.12],
    [0.0, 0.02],
  ], 22);
  const handle = new THREE.TorusGeometry(0.045, 0.007, 6, 14, Math.PI * 1.15);
  handle.rotateZ(Math.PI * 0.42);
  handle.translate(-0.058, 0.1, 0);
  const spout = new THREE.ConeGeometry(0.022, 0.035, 10, 1, true);
  spout.rotateZ(-Math.PI / 2 - 0.5);
  spout.translate(0.055, 0.162, 0);
  return [body, handle, spout];
}

/** an enamel pendant / wall shade: a shallow dome, open below, base at y = 0 (×s) */
function enamelShade(s = 1): THREE.BufferGeometry {
  // inside (from the top down to the rim), then the outside back up: a shell with both faces
  const prof: [number, number][] = [
    [0.0, 0.1 * s],
    [0.02 * s, 0.097 * s],
    [0.057 * s, 0.077 * s],
    [0.097 * s, 0.028 * s],
    [0.121 * s, -0.003],
    [0.13 * s, -0.006],
    [0.128 * s, 0.0],
    [0.1 * s, 0.031 * s],
    [0.06 * s, 0.081 * s],
    [0.025 * s, 0.102 * s],
    [0.018 * s, 0.13 * s],
    [0.0, 0.13 * s],
  ];
  const g = turned(prof, 26);
  return g;
}
