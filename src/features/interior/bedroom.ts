/**
 * The glass wing as a bedroom under the aurora: two low pine beds side by
 * side with their heads to the cabin and their feet to the north glass, so
 * you lie and look up through the glazed gable. Thick duvets turned back at
 * the pillows, reindeer hides over the feet, a plaid, sheepskins on the
 * floor; a runner of rag rug down the middle; storm lanterns on the gable's
 * sill and on stools by the pillows; a low headboard shelf with books.
 */
import * as THREE from 'three';
import { boxMinMax } from '../house/kit';
import { roundedBox } from '../../core/geometry';
import { HOUSE } from '../../world/layout';
import type { InteriorMats } from './mats';
import type { Lights } from './lights';
import { drape, place, reliefPiece, rod, softBox, turned, type V2 } from './kit';
import { mug, shelfOfBooks, type Kit } from './furn';
import { bulbMaterial, drumShade, lampShadeMaterial, pickBox } from './living';

const W = HOUSE.wing;
/** inner faces of the knee walls (x) and the gable sill (z) */
const XI0 = W.minX + 0.2;
const XI1 = W.maxX - 0.2;
const GABLE_Z = W.minZ + 0.2;
const W_MID = (W.minX + W.maxX) / 2;

export const BEDS = [
  { x: XI0 + 0.8, w: 1.3 },
  { x: XI1 - 0.8, w: 1.3 },
];
/** head (south) and foot (north) of the beds */
export const BED_Z = { head: -6.15, foot: -8.35 };

export interface BedroomBuild {
  lampPicks: { light: number; object: THREE.Object3D }[];
  /** the lanterns' glass (for the cards) */
  lanterns: THREE.Vector3[];
  /** pull cords for the wool blinds, one by each bed head (pick boxes) */
  cords: THREE.Object3D[];
}

export function buildBedroom(k: Kit, m: InteriorMats, lights: Lights, fancy: boolean): BedroomBuild {
  const { B, shadows } = k;
  const w = m.wing;
  const lampPicks: BedroomBuild['lampPicks'] = [];
  const lanterns: THREE.Vector3[] = [];
  const dens = fancy ? 24 : 16;

  /* ------------------------------- beds ------------------------------- */
  BEDS.forEach((bed, bi) => {
    const x = bed.x;
    const zh = BED_Z.head;
    const zf = BED_Z.foot;
    const len = zh - zf;
    const zc = (zh + zf) / 2;
    const bw = bed.w;
    const frameH = 0.2;
    const matT = 0.18;
    const top = frameH + matT;
    // a low platform of oiled pine on a recessed plinth
    B.add(w.darkWood, boxMinMax(x - bw / 2 + 0.06, 0, zf + 0.06, x + bw / 2 - 0.06, 0.08, zh - 0.06, 'z'), { role: 'bed' });
    B.add(w.pine, place(roundedBox(bw + 0.06, frameH - 0.08, len + 0.06, 0.012, 2, 'z'), x, 0.08 + (frameH - 0.08) / 2, zc), { role: 'bed', cast: true });
    // headboard: a low panel with a shelf on top (books, a cup)
    const hz = zh + 0.04;
    B.add(w.pine, boxMinMax(x - bw / 2 - 0.03, 0.08, hz, x + bw / 2 + 0.03, 0.78, hz + 0.05, 'x'), { role: 'bed', cast: true });
    B.add(w.pine, place(roundedBox(bw + 0.12, 0.03, 0.2, 0.006, 2, 'x'), x, 0.795, hz + 0.08), { role: 'bed', cast: true });
    // a few books on the headboard of the west bed (the east one stays clear of the view from the door)
    if (bi === 0) for (const g of shelfOfBooks(x - bw / 2, x - bw / 2 + 0.4, 0.81, hz + 0.17, 0.25, 700 + bi)) {
      // turn them so the spines face the bed
      g.rotateY(Math.PI);
      g.translate(2 * (x - bw / 2 + 0.2), 0, 2 * (hz + 0.08));
      B.add(w.books, g, { role: 'books' });
    }
    // mattress
    B.add(w.linen, place(softBox(bw - 0.04, matT, len - 0.04, { r: 0.05, bulge: 0.012, side: 0.01, seed: 90 + bi }), x, frameH + matT / 2, zc), { role: 'bed', cast: true });
    // pillows propped against the headboard
    for (const s of bi === 0 ? [-1, 1] : [0]) {
      const pw = bi === 0 ? bw / 2 - 0.04 : bw * 0.7;
      const p = softBox(pw, 0.36, 0.13, { r: 0.07, bulge: 0.0, side: 0.06, wrinkle: 0.004, seed: 95 + s + bi * 3 });
      p.rotateX(0.55);
      B.add(w.linen, place(p, x + s * (bw / 4 + 0.005), top + 0.13, zh - 0.17), { role: 'bed' });
      const p2 = softBox(pw * 0.92, 0.3, 0.11, { r: 0.06, side: 0.05, wrinkle: 0.004, seed: 97 + s + bi * 5 });
      p2.rotateX(0.75);
      B.add(bi === 0 ? w.duvetGrey : w.duvet, place(p2, x + s * (bw / 4 + 0.005), top + 0.08, zh - 0.32), { role: 'bed' });
    }
    // the duvet: thick, quilted in channels, falling over both sides, turned back at the pillows
    {
      const hw = bw / 2 - 0.02;
      const prof: V2[] = [
        [-hw - 0.05, frameH - 0.02],
        [-hw - 0.055, frameH + 0.06],
        [-hw - 0.03, top + 0.02],
        [-hw + 0.08, top + 0.05],
        [0, top + 0.06],
        [hw - 0.08, top + 0.05],
        [hw + 0.03, top + 0.02],
        [hw + 0.055, frameH + 0.06],
        [hw + 0.05, frameH - 0.02],
      ];
      const dl = len - 0.42;
      const g = drape(prof, dl, { folds: 0.014, freq: 2.2, puff: 0.09, quilt: 0.03, quiltFreq: 3.2, thick: 0.035, hem: 0.025, seed: 101 + bi, density: dens });
      B.add(bi === 0 ? w.duvetGrey : w.duvet, place(g, x, 0, zf + dl / 2 - 0.03), { role: 'duvet', cast: true });
      // the turned-back fold: a flatter band lying over the duvet's top end
      const fold: V2[] = [
        [-hw - 0.03, top + 0.09],
        [-hw + 0.1, top + 0.13],
        [0, top + 0.14],
        [hw - 0.1, top + 0.13],
        [hw + 0.03, top + 0.09],
      ];
      const f = drape(fold, 0.3, { folds: 0.01, freq: 3, puff: 0.025, thick: 0.03, seed: 111 + bi, density: dens });
      B.add(bi === 0 ? w.duvetGrey : w.duvet, place(f, x, 0, zf + dl - 0.16), { role: 'duvet' });
    }
    // a reindeer hide over the foot of one bed, a plaid over the other
    if (bi === 0) {
      // over the duvet's puffed top (it stands ~0.15 above the mattress)
      const prof: V2[] = [
        [-(bw / 2) - 0.13, 0.14],
        [-(bw / 2) - 0.08, top + 0.07],
        [-(bw / 2) + 0.12, top + 0.19],
        [0, top + 0.21],
        [bw / 2 - 0.12, top + 0.19],
        [bw / 2 + 0.08, top + 0.07],
        [bw / 2 + 0.13, 0.14],
      ];
      const g = drape(prof, 0.95, {
        folds: 0.012,
        freq: 2.4,
        thick: 0.012,
        seed: 121,
        density: dens,
        unitUV: true,
        shape: (u) => {
          // hide outline: legs at the ends of the profile's span, narrower in the middle
          const legs = 0.12 * Math.exp(-(((u - 0.12) / 0.07) ** 2)) + 0.12 * Math.exp(-(((u - 0.88) / 0.07) ** 2));
          const body = 0.36 + 0.06 * Math.sin(Math.PI * u);
          return [-body - legs, body + legs * 0.4];
        },
      });
      // thrown across the foot of the bed, hanging over both sides
      B.add(w.hide, place(g, x, 0, zf + 0.5), { role: 'hide' });
    } else {
      const prof: V2[] = [
        [-(bw / 2) - 0.12, 0.2],
        [-(bw / 2) - 0.07, top + 0.08],
        [-(bw / 2) + 0.12, top + 0.18],
        [0, top + 0.2],
        [bw / 2 - 0.12, top + 0.18],
        [bw / 2 + 0.07, top + 0.08],
        [bw / 2 + 0.12, 0.16],
      ];
      const g = drape(prof, 0.6, { folds: 0.014, freq: 3, thick: 0.012, hem: 0.02, seed: 123, density: dens });
      B.add(w.plaid, place(g, x, 0, zf + 0.45), { role: 'plaid' });
    }
    shadows.add(x, zc, bw + 0.15, len + 0.1, 0, 0.18, 0.6);
    // a sheepskin on the floor beside it (aisle side)
    const side = bi === 0 ? 1 : -1;
    const sk = reliefPiece(sheepOutline(), { height: 0.03, edge: 0.08, step: fancy ? 0.04 : 0.06, lump: 0.004, seed: 131 + bi });
    B.add(w.sheepskin, place(sk, x + side * (bw / 2 + 0.36), 0.002, zc + 0.35, 0.3 * side), { role: 'sheepskin' });
  });

  /* --------------------------- runner rug --------------------------- */
  {
    const x = (W.minX + W.maxX) / 2;
    const z0 = W.maxZ - 0.35;
    const z1 = GABLE_Z + 1.6;
    const g = new THREE.BoxGeometry(0.9, 0.008, z0 - z1);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 0.45) / 1.5 + 0.3, (p.getZ(i) - z1) / 1.5);
    B.add(w.rug, place(g, x, 0.004, (z0 + z1) / 2), { role: 'rug' });
  }

  /* ---------- a nook at the glass for watching the sky: fleece, floor cushions, a tray ---------- */
  {
    const x = (W.minX + W.maxX) / 2;
    const z = GABLE_Z + 0.95;
    const sk = reliefPiece(sheepOutline(1.45), { height: 0.035, edge: 0.1, step: fancy ? 0.04 : 0.06, lump: 0.005, seed: 151 });
    B.add(w.sheepskin, place(sk, x, 0.002, z, 0.15), { role: 'sheepskin' });
    // two big floor cushions, leaning a little toward each other
    for (const [dx, rot, mat] of [
      [-0.38, 0.25, w.wool],
      [0.36, -0.2, w.plaid],
    ] as const) {
      const c = softBox(0.58, 0.16, 0.58, { r: 0.07, bulge: 0.04, side: 0.03, sag: 0.03, wrinkle: 0.003, seed: 161 + dx * 10 });
      B.add(mat, place(c, x + dx, 0.1, z + 0.12, rot), { role: 'nook', cast: true });
    }
    // a wooden tray on the fleece: a steel flask, two enamel mugs, a candle in a jar
    const tx = x + 0.02;
    const tz = z - 0.42;
    B.add(w.pine, place(roundedBox(0.46, 0.022, 0.3, 0.006, 2, 'x'), tx, 0.045, tz, 0.1), { role: 'nook', cast: true });
    for (const s2 of [-1, 1]) B.add(w.pine, place(new THREE.BoxGeometry(0.46, 0.035, 0.012), tx, 0.065, tz + s2 * 0.145, 0.1), { role: 'nook' });
    B.add(w.steel, place(turned([[0, 0], [0.04, 0], [0.042, 0.02], [0.042, 0.2], [0.034, 0.22], [0.03, 0.25], [0.032, 0.27], [0, 0.27]], 16), tx - 0.13, 0.056, tz), { role: 'nook', cast: true });
    for (const dx of [0.03, 0.14]) {
      const [b, h] = mug(0.036, 0.08);
      B.add(w.enamel, place(b, tx + dx, 0.056, tz + (dx > 0.1 ? 0.05 : -0.04), dx * 9), { role: 'nook' });
      B.add(w.enamel, place(h, tx + dx, 0.056, tz + (dx > 0.1 ? 0.05 : -0.04), dx * 9), { role: 'nook' });
    }
    shadows.add(x, z, 1.3, 0.9, 0.15, 0.2, 0.3);
  }

  /* ----------------------------- lanterns ----------------------------- */
  const jarGlass = lanternGlass(w.linen);
  jarGlass.emissiveIntensity = 0.25;
  const lantern = (at: THREE.Vector3, id: string, label: string, scale = 1) => {
    const L = lanternGeometry(scale);
    const glassMat = lanternGlass(w.linen);
    for (const [g, part] of L) {
      g.translate(at.x, at.y, at.z);
      B.add(part === 'glass' ? glassMat : part === 'brass' ? w.brass : w.steel, g, { role: 'lantern' });
    }
    const flameAt = new THREE.Vector3(at.x, at.y + 0.075 * scale, at.z);
    const li = lights.add({ id, zone: 'glasswing', kind: 'candle', label, pos: flameAt.clone().add(new THREE.Vector3(0, 0.08, 0)), power: 0.11 * scale, reach: 4.5, glow: [{ mat: glassMat, k: 0.6 }] });
    lights.candle(li, new THREE.Vector3(at.x, at.y + 0.022 * scale, at.z), 0.07 * scale, 0.016 * scale, 0.5);
    lampPicks.push({ light: li, object: pickBox(0.16 * scale, 0.32 * scale, 0.16 * scale, new THREE.Vector3(at.x, at.y + 0.15 * scale, at.z)) });
    lanterns.push(at);
  };
  // on the floor along the gable glass (the gable's blinds rise from its low sill), in a cluster and a single
  const glassZ = GABLE_Z + 0.2;
  lantern(new THREE.Vector3(XI0 + 0.45, 0, glassZ), 'gable-lantern-w', 'Storm lantern', 1.3);
  lantern(new THREE.Vector3(XI0 + 0.82, 0, glassZ + 0.12), 'gable-lantern-w2', 'Storm lantern', 0.95);
  lantern(new THREE.Vector3(XI1 - 0.5, 0, glassZ + 0.04), 'gable-lantern-e', 'Storm lantern', 1.15);
  // a row of night lights in glass jars along the foot of the gable glass
  {
    const id = lights.add({ id: 'gable-candles', zone: 'glasswing', kind: 'candle', label: 'Night lights', pos: new THREE.Vector3(W_MID, 0.25, glassZ), power: 0, glow: [{ mat: jarGlass, k: 0.3 }] });
    const xs = [XI0 + 1.25, XI0 + 1.55, XI1 - 1.6, XI1 - 1.25, XI1 - 0.95];
    xs.forEach((x, i) => {
      const z = glassZ - 0.02 + (i % 2) * 0.05;
      B.add(jarGlass, place(turned([[0, 0], [0.034, 0], [0.036, 0.004], [0.036, 0.075], [0.032, 0.078], [0.031, 0.006], [0, 0.006]], 16), x, 0, z), { role: 'lantern' });
      lights.candle(id, new THREE.Vector3(x, 0.006, z), 0.03, 0.028, 0.9);
    });
    lampPicks.push({ light: id, object: pickBox(XI1 - XI0 - 1.8, 0.2, 0.2, new THREE.Vector3(W_MID, 0.08, glassZ)) });
  }
  // stools by the pillows, a lantern and a mug on each
  for (const [bi, side] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const bed = BEDS[bi];
    const sx = bed.x + side * (bed.w / 2 + 0.28);
    const sz = BED_Z.head - 0.3;
    B.add(w.pine, place(turned([[0, 0], [0.17, 0], [0.175, 0.02], [0.165, 0.035], [0, 0.035]], 22), sx, 0.42, sz), { role: 'stool', cast: true });
    for (let k2 = 0; k2 < 3; k2++) {
      const a = (k2 / 3) * Math.PI * 2 + 0.3;
      B.add(w.pine, rod(new THREE.Vector3(sx + Math.cos(a) * 0.1, 0.42, sz + Math.sin(a) * 0.1), new THREE.Vector3(sx + Math.cos(a) * 0.15, 0, sz + Math.sin(a) * 0.15), 0.016, 6, 0.014), { role: 'stool', cast: true });
    }
    shadows.add(sx, sz, 0.3, 0.3, 0, 0.08, 0.4);
    lantern(new THREE.Vector3(sx - side * 0.04, 0.455, sz + 0.03), bi === 0 ? 'bed-lantern-w' : 'bed-lantern-e', 'Bedside lantern', 0.85);
  }

  /* --------- a painted chest of drawers by the door, a lamp and a jug on it --------- */
  {
    const cx = XI0 + 0.24;
    const cz = W.maxZ - 1.1;
    const d = 0.44;
    const wdt = 0.9;
    const h = 0.82;
    B.add(w.painted, boxMinMax(cx - d / 2, 0.08, cz - wdt / 2, cx + d / 2, h - 0.03, cz + wdt / 2, 'z'), { role: 'chest', cast: true });
    B.add(w.pine, place(roundedBox(d + 0.03, 0.03, wdt + 0.04, 0.006, 2, 'z'), cx + 0.01, h - 0.015, cz), { role: 'chest', cast: true });
    for (const [y0, y1] of [
      [0.12, 0.34],
      [0.37, 0.56],
      [0.59, h - 0.06],
    ]) {
      B.add(w.painted, boxMinMax(cx + d / 2, y0, cz - wdt / 2 + 0.03, cx + d / 2 + 0.015, y1, cz + wdt / 2 - 0.03, 'z'), { role: 'chest' });
      for (const s2 of [-1, 1]) B.add(w.pine, place(new THREE.SphereGeometry(0.014, 8, 6), cx + d / 2 + 0.025, (y0 + y1) / 2, cz + s2 * 0.22), { role: 'chest' });
    }
    for (const s2 of [-1, 1]) for (const s3 of [-1, 1]) B.add(w.darkWood, boxMinMax(cx + s2 * (d / 2 - 0.04) - 0.02, 0, cz + s3 * (wdt / 2 - 0.04) - 0.02, cx + s2 * (d / 2 - 0.04) + 0.02, 0.08, cz + s3 * (wdt / 2 - 0.04) + 0.02, 'y'), { role: 'chest' });
    // a small lamp: a stoneware base and a pleated linen shade
    const lz = cz - 0.22;
    B.add(w.enamel, place(turned([[0, 0], [0.06, 0], [0.07, 0.05], [0.05, 0.14], [0.02, 0.2], [0.0, 0.2]], 18), cx, h, lz), { role: 'lamp' });
    const shade = lampShadeMaterial(w.linen, 0xffd8a8);
    const sh = drumShade(0.13, 0.09, 0.17);
    sh.translate(cx, h + 0.19, lz);
    B.add(shade, sh, { role: 'lamp' });
    const bulb = bulbMaterial();
    B.add(bulb, place(new THREE.SphereGeometry(0.02, 8, 6), cx, h + 0.25, lz), { role: 'lamp' });
    const li = lights.add({ id: 'wing-lamp', zone: 'glasswing', kind: 'lamp', label: 'Bedroom lamp', pos: new THREE.Vector3(cx + 0.06, h + 0.24, lz), power: 0.16, reach: 4.5, glow: [{ mat: shade, k: 0.45 }, { mat: bulb, k: 5 }] });
    lampPicks.push({ light: li, object: pickBox(0.3, 0.42, 0.3, new THREE.Vector3(cx, h + 0.2, lz)) });
    // a jug and a folded towel
    B.add(w.enamel, place(turned([[0, 0], [0.05, 0], [0.06, 0.07], [0.045, 0.14], [0.05, 0.17], [0, 0.17]], 16), cx - 0.02, h, cz + 0.2), { role: 'chest' });
    B.add(w.linen, place(softBox(0.24, 0.05, 0.18, { r: 0.015, bulge: 0.004, seed: 171 }), cx, h + 0.025, cz + 0.02, 0.1), { role: 'chest' });
    shadows.add(cx, cz, d, wdt, 0, 0.1, 0.45);
  }

  /* ------------------- a bench by the door with spare blankets ------------------- */
  {
    const bx = XI1 - 0.3;
    const bz = W.maxZ - 0.75;
    B.add(w.pine, place(roundedBox(0.4, 0.04, 0.95, 0.008, 2, 'z'), bx, 0.42, bz), { role: 'bench', cast: true });
    for (const s of [-1, 1]) B.add(w.pine, boxMinMax(bx - 0.17, 0, bz + s * 0.38 - 0.02, bx + 0.17, 0.4, bz + s * 0.38 + 0.02, 'z'), { role: 'bench', cast: true });
    // folded blankets
    B.add(w.plaid, place(softBox(0.36, 0.07, 0.48, { r: 0.025, bulge: 0.008, wrinkle: 0.002, seed: 141 }), bx, 0.475, bz - 0.15), { role: 'bench' });
    B.add(w.wool, place(softBox(0.34, 0.06, 0.44, { r: 0.022, bulge: 0.006, wrinkle: 0.002, seed: 142 }), bx + 0.005, 0.54, bz - 0.14, 0.06), { role: 'bench' });
    shadows.add(bx, bz, 0.4, 0.95, 0, 0.1, 0.45);
  }

  /* -------------- blind cords: a wooden toggle on a cord by each bed head -------------- */
  const cords: THREE.Object3D[] = [];
  for (const [x, nx] of [
    [XI0 + 0.015, 1],
    [XI1 - 0.015, -1],
  ] as const) {
    const z = BED_Z.head - 0.12;
    const yTop = 1.32;
    // a brass cleat on the knee wall's top, the cord hanging to a pine toggle
    B.add(w.brass, place(new THREE.BoxGeometry(0.02, 0.06, 0.015), x + nx * 0.01, yTop, z), { role: 'cord' });
    B.add(w.linen, rod(new THREE.Vector3(x + nx * 0.02, yTop, z), new THREE.Vector3(x + nx * 0.035, 0.98, z), 0.0025, 4), { role: 'cord' });
    B.add(w.pine, place(turned([[0, 0], [0.01, 0.0], [0.013, 0.03], [0.01, 0.06], [0, 0.06]], 8), x + nx * 0.035, 0.92, z), { role: 'cord' });
    cords.push(pickBox(0.1, 0.45, 0.1, new THREE.Vector3(x + nx * 0.03, 1.12, z)));
  }

  return { lampPicks, lanterns, cords };
}

/** a sheepskin's outline (≈0.95 × 0.65 m, × scale) */
function sheepOutline(scale = 1): V2[] {
  const pts: V2[] = [];
  const N = 36;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.12 * Math.cos(a * 4 + 0.5) + 0.06 * Math.sin(a * 7) + 0.18 * Math.max(0, Math.cos(a * 2)) ** 8;
    pts.push([Math.cos(a) * 0.46 * r * scale, Math.sin(a) * 0.32 * r * scale]);
  }
  return pts;
}

/**
 * A storm lantern (base at y = 0): steel base and cap, four corner rods, a
 * glass chimney, a wire bail; returns geometry tagged by part.
 */
function lanternGeometry(s: number): [THREE.BufferGeometry, 'steel' | 'glass' | 'brass'][] {
  const out: [THREE.BufferGeometry, 'steel' | 'glass' | 'brass'][] = [];
  const S = (g: THREE.BufferGeometry) => g.scale(s, s, s);
  out.push([S(turned([[0, 0], [0.065, 0], [0.068, 0.01], [0.062, 0.022], [0.0, 0.022]], 16)), 'steel']);
  out.push([S(turned([[0.0, 0.2], [0.06, 0.2], [0.064, 0.21], [0.045, 0.235], [0.02, 0.25], [0.02, 0.262], [0.0, 0.262]], 16)), 'steel']);
  // glass globe
  out.push([S(turned([[0.0, 0.022], [0.042, 0.022], [0.055, 0.07], [0.058, 0.12], [0.05, 0.17], [0.042, 0.2], [0.0, 0.2]], 18)), 'glass']);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    out.push([S(rod(new THREE.Vector3(Math.cos(a) * 0.06, 0.02, Math.sin(a) * 0.06), new THREE.Vector3(Math.cos(a) * 0.058, 0.205, Math.sin(a) * 0.058), 0.003, 4)), 'steel']);
  }
  out.push([S(new THREE.TorusGeometry(0.05, 0.003, 4, 20, Math.PI).translate(0, 0.25, 0)), 'brass']);
  return out;
}

/** lantern glass: a pale, slightly frosted globe that glows with its candle */
function lanternGlass(linen: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const g = linen.clone();
  g.name = 'lanternGlass';
  g.map = null;
  g.bumpMap = null;
  g.color.set(0xd8d2c4);
  g.roughness = 0.25;
  g.transparent = true;
  g.opacity = 0.55;
  g.depthWrite = false;
  g.emissive.set(0xffa860);
  g.emissiveIntensity = 0.5;
  g.userData.snow = 0;
  return g;
}
