/**
 * Lysvik harbour: the quay wall of dressed stone with granite coping, timber
 * fenders, iron bollards and ladders; two riprap breakwaters of snow-capped
 * boulders with a small light tower at each head (red to port, green to
 * starboard coming in, flashing after dark); fishing boats moored alongside
 * the quay in the open berth (bobbing gently) or frozen into the ice off the
 * rorbuer, skiffs hauled up by the boathouses; the stockfish racks (hjell) on
 * the rocks, hung with cod drying in the frost; fish crates stacked on
 * pallets, insulated tubs, nets and barrels, a crane, and cars parked under
 * a night's snow along the back of the quay. Wheelhouse windows and masthead
 * lights rock with their boats (their own glow builder).
 */
import { Frame, IDENTITY, type Vec3 } from './builder';
import { mulberry32 } from '../../world/noise';
import { STYLE, SCHED, GLOW, snapSeed, snapSize } from './materials';
import { pick, jitter, scale3, WHITE, type Kit, type GlowParams } from './kit';
import type { VillagePlan, BoatSpot, Rack } from './plan';
import { CARD } from './textures';

export interface HarborInfo {
  breakwaters: { pts: { x: number; z: number }[]; hw: number; y: number }[];
  towers: { x: number; z: number; y: number; h: number; color: 'red' | 'green' }[];
  boats: { x: number; z: number; y: number; len: number; yaw: number; state: BoatSpot['state'] }[];
  racks: Rack[];
}

export function buildHarbor(k: Kit, plan: VillagePlan): HarborInfo {
  const r = mulberry32(8080);
  quayEdge(k, plan, r);
  const info: HarborInfo = { breakwaters: [], towers: [], boats: [], racks: plan.racks };
  for (const bw of plan.breakwaters) info.breakwaters.push(breakwater(k, bw, r, info));
  for (const b of plan.boats) info.boats.push(boat(k, b, plan));
  for (const rk of plan.racks) rack(k, rk);
  quayProps(k, plan, r);
  return info;
}

/* ------------------------------------------------------------------ */
/* the quay edge                                                      */
/* ------------------------------------------------------------------ */

function quayEdge(k: Kit, plan: VillagePlan, r: () => number): void {
  const q = plan.quay;
  const y = q.y;
  const S = k.stone;
  S.frame = IDENTITY;
  S.setColor([0.66, 0.66, 0.64]);
  const skip = (x: number) => {
    for (const lot of [plan.plant, plan.warehouse]) if (Math.abs(x - lot.x) < lot.w / 2 + 0.2 && lot.z < q.front + 2) return true;
    return false;
  };
  // the wall face along the front, down into the water, and round the two ends
  const faces: [number, number, number, number, Vec3][] = [
    [q.minX, q.front, q.maxX, q.front, [0, 0, -1]],
    [q.minX, q.back - 6, q.minX, q.front, [-1, 0, 0]],
    [q.maxX, q.front, q.maxX, q.back - 6, [1, 0, 0]],
  ];
  for (const [ax, az, bx, bz, n] of faces) {
    const L = Math.hypot(bx - ax, bz - az);
    S.polyN(
      [
        [ax, -5, az],
        [bx, -5, bz],
        [bx, y, bz],
        [ax, y, az],
      ],
      [
        [0, -5],
        [L, -5],
        [L, y],
        [0, y],
      ],
      n,
    );
  }
  // the working strip of the quay in front of the plow bank: packed snow, tyre tracks, grit
  {
    const P = k.paving;
    P.frame = IDENTITY;
    P.setColor([1, 1, 1]);
    const z0 = q.front + 0.7;
    const z1 = q.front + 12.5;
    for (let x = q.minX; x < q.maxX - 0.01; x += 6) {
      const x1 = Math.min(q.maxX, x + 6);
      const base = P.vertexCount;
      for (const [px, pz] of [
        [x, z0],
        [x1, z0],
        [x1, z1],
        [x, z1],
      ] as const) {
        P.set('aLane', pz - (z0 + z1) / 2, px, (z1 - z0) / 2, 1);
        P.vertex(px, y + 0.025, pz, 0, 1, 0, px, pz);
      }
      P.tri(base, base + 2, base + 1);
      P.tri(base, base + 3, base + 2);
    }
  }
  // granite coping along the edge
  const F = k.facade;
  F.frame = IDENTITY;
  k.style(F, STYLE.concrete, 0, 0, 0.3);
  F.setColor([0.62, 0.61, 0.58]);
  F.box((q.minX + q.maxX) / 2, y + 0.06, q.front + 0.35, q.maxX - q.minX + 0.1, 0.22, 0.7, '');
  for (const x of [q.minX, q.maxX]) F.box(x + (x < 0 && x === q.minX ? 0.35 : -0.35), y + 0.06, (q.front + q.back - 6) / 2, 0.7, 0.22, q.back - 6 - q.front, '');
  // timber fenders hanging down the face, iron bollards, ladders
  const N = k.nearFacade;
  for (let x = q.minX + 3; x < q.maxX - 2; x += 4.2) {
    if (skip(x)) continue;
    F.frame = IDENTITY;
    k.style(F, STYLE.timber, 0, 0, x);
    F.setColor([0.12, 0.1, 0.085]);
    F.box(x, y - 1.6, q.front - 0.14, 0.26, 3.6, 0.26, '');
  }
  N.frame = IDENTITY;
  for (let x = q.minX + 6; x < q.maxX - 4; x += 9 + r() * 3) {
    if (skip(x)) continue;
    k.style(N, STYLE.paint, 0, 0, x);
    N.setColor([0.03, 0.03, 0.032]);
    N.cylinder(x, y + 0.17, q.front + 0.5, 0.16, 0.13, 0.42, 8, false);
    N.cylinder(x, y + 0.59, q.front + 0.5, 0.22, 0.22, 0.07, 8, true);
    k.nearSnow.frame = IDENTITY;
    k.pillow(k.nearSnow, x, y + 0.66, q.front + 0.5, 0.36, 0.36, 0.08, x, 2, 2);
  }
  for (let x = q.minX + 14; x < q.maxX - 6; x += 32) {
    if (skip(x)) continue;
    N.frame = IDENTITY;
    k.style(N, STYLE.paint, 0, 0, x);
    N.setColor([0.08, 0.08, 0.085]);
    for (const dx of [-0.22, 0.22]) N.box(x + dx, y - 1.4, q.front - 0.05, 0.05, 3.4, 0.05, '');
    for (let yy = y - 3; yy < y; yy += 0.3) N.box(x, yy, q.front - 0.05, 0.44, 0.035, 0.035, '');
  }
}

/* ------------------------------------------------------------------ */
/* breakwaters of boulders and the harbour lights                     */
/* ------------------------------------------------------------------ */

function breakwater(k: Kit, bw: VillagePlan['breakwaters'][number], r: () => number, info: HarborInfo): HarborInfo['breakwaters'][number] {
  const pts = bw.pts;
  const dense: { x: number; z: number; tx: number; tz: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 1.6));
    for (let j = 0; j < n; j++) dense.push({ x: ax + ((bx - ax) * j) / n, z: az + ((bz - az) * j) / n, tx: (bx - ax) / L, tz: (bz - az) / L });
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const tl = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
  dense.push({ x: last[0], z: last[1], tx: (last[0] - prev[0]) / tl, tz: (last[1] - prev[1]) / tl });
  const S = k.stone;
  S.frame = IDENTITY;
  const hw = bw.width / 2;
  const crest: [number, number][] = [];
  dense.forEach((p, i) => {
    const nx = -p.tz;
    const nz = p.tx;
    const end = Math.min(i, dense.length - 1 - i);
    const taper = Math.min(1, 0.55 + end * 0.15);
    // boulders across the mound: big ones on the crest, a skirt of others falling into the sea
    for (const a of [-1.15, -0.75, -0.35, 0, 0.35, 0.75, 1.15]) {
      const off = a * hw * taper + (r() - 0.5) * 0.8;
      const crestH = bw.top * taper - 0.2 * Math.abs(a);
      const yy = crestH * (1 - Math.pow(Math.abs(a) / 1.2, 2.4)) - 0.4 * Math.abs(a) + (r() - 0.5) * 0.4;
      const s = 0.9 + r() * 0.9 - 0.15 * Math.abs(a);
      const g = 0.3 + r() * 0.2;
      S.setColor([g, g * 0.98, g * 0.95]);
      // the crest stones are seen up close: rounder (more facets) and a little rotated in shape
      const crestStone = Math.abs(a) < 0.5;
      S.blob(p.x + nx * off + (r() - 0.5) * 0.6, yy - s * 0.35, p.z + nz * off + (r() - 0.5) * 0.6, s * (0.85 + r() * 0.6), s * (0.55 + r() * 0.35), s * (0.85 + r() * 0.6), crestStone ? 0.18 : 0.25, Math.floor(r() * 1e5), crestStone && k.fancy ? 1 : 0);
    }
    crest.push([p.x, p.z]);
  });
  // the snow that lies along the crest between the stones
  k.bank(k.snow, crest, bw.width * 0.55, 0.35, 77, () => bw.top - 0.15);
  // the harbour light at the head
  const [hx, hz] = last;
  const red = bw.light === 'red';
  const ty = bw.top - 0.1;
  const F = k.facade;
  F.frame = IDENTITY;
  k.style(F, STYLE.concrete, 0, 0, 0.7);
  F.setColor([0.62, 0.62, 0.6]);
  F.cylinder(hx, ty - 1.2, hz, 1.6, 1.5, 1.5, 12, true);
  k.style(F, STYLE.paint, 0, 0, 0.2);
  F.setColor(WHITE);
  F.cylinder(hx, ty + 0.3, hz, 0.75, 0.62, 3.6, 10, false);
  F.setColor(red ? [0.45, 0.03, 0.02] : [0.03, 0.25, 0.08]);
  F.cylinder(hx, ty + 1.6, hz, 0.71, 0.68, 1.1, 10, false);
  F.setColor([0.06, 0.06, 0.06]);
  F.cylinder(hx, ty + 3.9, hz, 0.82, 0.82, 0.08, 10, true);
  F.cylinder(hx, ty + 4.55, hz, 0.42, 0.04, 0.45, 10, true);
  k.nearSnow.frame = IDENTITY;
  k.pillow(k.nearSnow, hx, ty + 0.3, hz, 3.0, 3.0, 0.3, hx, 5, 5);
  const g: GlowParams = { threshold: 0.05, warmth: 0.5, intensity: 3.2, seed: red ? 0.13 : 0.61, sched: red ? SCHED.flashRed : SCHED.flashGreen };
  k.lampGlass(k.glow, IDENTITY, hx, ty + 4.22, hz, 0.5, 0.55, 0.5, g, { size: 1.2, minPx: 3.4, gain: 2.4 });
  info.towers.push({ x: hx, z: hz, y: ty, h: 5, color: bw.light });
  return { pts: crest.map(([x, z]) => ({ x, z })), hw: hw * 0.6, y: bw.top - 0.1 };
}

/* ------------------------------------------------------------------ */
/* boats                                                              */
/* ------------------------------------------------------------------ */

const HULLS: Vec3[] = [
  [0.8, 0.8, 0.78],
  [0.8, 0.8, 0.78],
  [0.03, 0.08, 0.22],
  [0.28, 0.03, 0.02],
  [0.03, 0.12, 0.08],
];
const STRIPES: Vec3[] = [
  [0.03, 0.1, 0.35],
  [0.4, 0.03, 0.02],
  [0.03, 0.22, 0.12],
  [0.55, 0.32, 0.03],
];

function boat(k: Kit, b: BoatSpot, plan: VillagePlan): HarborInfo['boats'][number] {
  const r = mulberry32(Math.floor(Math.abs(b.seed) * 1e6) + 17);
  const L = b.len;
  const type = b.type;
  const open = type >= 2;
  const B = L * (open ? 0.31 : 0.3);
  const y0 = b.state === 'land' ? k.h(b.x, b.z) + 0.55 : b.state === 'frozen' ? 0.06 : 0;
  // bow along +z
  const F = Frame.facing(b.x, y0, b.z, b.hx, b.hz);
  const Bt = k.boat;
  Bt.frame = F;
  const bobPhase = r();
  Bt.set('aBob', b.x, y0, b.z, b.state === 'afloat' ? bobPhase : -1);
  const wooden = open;
  const hull: Vec3 = wooden ? pick(r, [[0.62, 0.6, 0.55], [0.05, 0.12, 0.2], [0.35, 0.22, 0.12]] as Vec3[]) : pick(r, HULLS);
  const stripe = hull[0] > 0.5 ? pick(r, STRIPES) : [0.75, 0.75, 0.72] as Vec3;
  const bottom: Vec3 = [0.22, 0.04, 0.03];
  const N = 11;
  const st: { z: number; sheer: number; sec: [number, number][] }[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = (t - 0.5) * L;
    // open boats are double-ended with high stems (a Nordland boat); decked boats have a transom
    const fore = t < 0.45 ? (open ? Math.sin((t / 0.45) * Math.PI * 0.5) : 0.82 + 0.18 * Math.sin(((t / 0.45) * Math.PI) / 2)) : Math.pow(Math.max(0, Math.cos((((t - 0.45) / 0.55) * Math.PI) / 2)), 0.7);
    const half = (B / 2) * Math.max(open ? 0.04 : 0.02, fore);
    const sheerRise = open ? 0.55 * (Math.pow(Math.abs(t - 0.5) * 2, 3)) : 0.5 * t * t;
    const sheer = (open ? 0.62 : 1.05) + sheerRise;
    const keel = -(open ? 0.35 : 0.65) * (t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.6 : 1);
    st.push({
      z,
      sheer,
      sec: [
        [0, keel],
        [half * 0.7, keel * 0.4],
        [half * 0.95, 0.12],
        [half, sheer],
      ],
    });
  }
  const bands = [bottom, stripe, hull];
  for (let i = 0; i < N - 1; i++) {
    const A = st[i];
    const C = st[i + 1];
    for (let band = 0; band < 3; band++) {
      Bt.setColor(band === 1 && open ? hull : bands[band]);
      for (const side of [1, -1]) {
        const a0 = A.sec[band];
        const a1 = A.sec[band + 1];
        const c0 = C.sec[band];
        const c1 = C.sec[band + 1];
        const dx = a1[0] - a0[0];
        const dy = a1[1] - a0[1];
        Bt.polyN(
          [
            [a0[0] * side, a0[1], A.z],
            [c0[0] * side, c0[1], C.z],
            [c1[0] * side, c1[1], C.z],
            [a1[0] * side, a1[1], A.z],
          ],
          null,
          [dy * side, -dx, 0],
        );
      }
    }
    // deck (decked boats) or floorboards (open boats)
    const dA = A.sheer - (open ? 0.42 : 0.14);
    const dC = C.sheer - (open ? 0.42 : 0.14);
    const hA = A.sec[3][0] * (open ? 0.8 : 1);
    const hC = C.sec[3][0] * (open ? 0.8 : 1);
    Bt.setColor(wooden ? [0.3, 0.23, 0.15] : [0.45, 0.47, 0.46]);
    Bt.polyN(
      [
        [-hA, dA, A.z],
        [hA, dA, A.z],
        [hC, dC, C.z],
        [-hC, dC, C.z],
      ],
      null,
      [0, 1, 0],
    );
    // snow on deck: a pillow per section
    if (!open || b.state !== 'afloat') {
      k.snow.frame = F;
      const ww = Math.min(hA, hC) * 1.7;
      if (ww > 0.3) k.pillow(k.snow, 0, (dA + dC) / 2, (A.z + C.z) / 2, ww, Math.abs(C.z - A.z) * 1.02, b.state === 'afloat' ? 0.1 : 0.2, i + b.seed * 100, 3, 2);
    }
  }
  // transom
  if (!open) {
    const s0 = st[0];
    const ring: Vec3[] = [];
    for (let j = 0; j < 4; j++) ring.push([s0.sec[j][0], s0.sec[j][1], s0.z]);
    for (let j = 3; j >= 1; j--) ring.push([-s0.sec[j][0], s0.sec[j][1], s0.z]);
    Bt.setColor(hull);
    Bt.polyN(ring, null, [0, 0, -1]);
  }
  const deckAt = (t: number) => st[Math.round(t * (N - 1))].sheer - 0.14;
  if (open) {
    Bt.setColor([0.3, 0.23, 0.15]);
    for (const t of [0.32, 0.55, 0.75]) Bt.box(0, deckAt(t) - 0.12, (t - 0.5) * L, B * 0.78, 0.05, 0.24, '');
    // the stems: tall and curved at both ends
    Bt.setColor(hull);
    for (const end of [0, 1]) {
      const z = (end - 0.5) * L;
      Bt.beam([0, st[end ? N - 1 : 0].sheer - 0.4, z * 0.98], [0, st[end ? N - 1 : 0].sheer + 0.35, z * 1.03], 0.08, 0.1);
    }
  } else {
    // wheelhouse: aft on a sjark, forward on the bigger boats; a raked front, windows all round, a visor
    const fwd = type === 1;
    const t0 = fwd ? 0.5 : 0.14;
    const t1 = fwd ? 0.7 : 0.34;
    const z0 = (t0 - 0.5) * L;
    const z1 = (t1 - 0.5) * L;
    const yd = deckAt((t0 + t1) / 2);
    const cw = B * 0.62;
    const ch = fwd ? 2.0 : 1.75;
    const rake = 0.45;
    const cabin: Vec3 = r() < 0.75 ? [0.82, 0.82, 0.8] : pick(r, [[0.06, 0.12, 0.3], [0.35, 0.04, 0.03]] as Vec3[]);
    const roofC: Vec3 = pick(r, [[0.82, 0.82, 0.8], [0.06, 0.12, 0.3], [0.35, 0.04, 0.03], [0.05, 0.2, 0.1]] as Vec3[]);
    const hw2 = cw / 2;
    const yT = yd + ch;
    const yW0 = yd + ch * 0.56;
    const yW1 = yd + ch * 0.9;
    const front = (y: number) => z1 - rake * ((y - yd) / ch);
    Bt.setColor(cabin);
    // sides (with the raked front edge), back, raked front, below and above the window band
    for (const sx of [-1, 1]) {
      const pts: Vec3[] = [
        [sx * hw2, yd, z0],
        [sx * hw2, yd, z1],
        [sx * hw2, yW0, front(yW0)],
        [sx * hw2, yW0, z0],
      ];
      Bt.polyN(pts, null, [sx, 0, 0]);
      Bt.polyN(
        [
          [sx * hw2, yW1, z0],
          [sx * hw2, yW1, front(yW1)],
          [sx * hw2, yT, front(yT)],
          [sx * hw2, yT, z0],
        ],
        null,
        [sx, 0, 0],
      );
    }
    Bt.polyN(
      [
        [-hw2, yd, z0],
        [hw2, yd, z0],
        [hw2, yT, z0],
        [-hw2, yT, z0],
      ],
      null,
      [0, 0, -1],
    );
    Bt.polyN(
      [
        [-hw2, yd, z1],
        [hw2, yd, z1],
        [hw2, yW0, front(yW0)],
        [-hw2, yW0, front(yW0)],
      ],
      null,
      [0, rake / ch, 1],
    );
    Bt.polyN(
      [
        [-hw2, yW1, front(yW1)],
        [hw2, yW1, front(yW1)],
        [hw2, yT, front(yT)],
        [-hw2, yT, front(yT)],
      ],
      null,
      [0, rake / ch, 1],
    );
    // the window band: dark glass all round
    Bt.setColor([0.012, 0.016, 0.02]);
    for (const sx of [-1, 1]) {
      Bt.polyN(
        [
          [sx * hw2, yW0, z0 + 0.15],
          [sx * hw2, yW0, front(yW0)],
          [sx * hw2, yW1, front(yW1)],
          [sx * hw2, yW1, z0 + 0.15],
        ],
        null,
        [sx, 0, 0],
      );
    }
    Bt.polyN(
      [
        [-hw2, yW0, front(yW0)],
        [hw2, yW0, front(yW0)],
        [hw2, yW1, front(yW1)],
        [-hw2, yW1, front(yW1)],
      ],
      null,
      [0, rake / ch, 1],
    );
    Bt.polyN(
      [
        [-hw2, yW0, z0],
        [hw2, yW0, z0],
        [hw2, yW1, z0],
        [-hw2, yW1, z0],
      ],
      null,
      [0, 0, -1],
    );
    // roof with a visor over the front windows
    Bt.setColor(roofC);
    Bt.box(0, yT + 0.04, (z0 + front(yT)) / 2 + 0.12, cw + 0.14, 0.08, front(yT) - z0 + 0.5, '');
    k.snow.frame = F;
    k.pillow(k.snow, 0, yT + 0.08, (z0 + front(yT)) / 2 + 0.12, cw + 0.1, front(yT) - z0 + 0.45, 0.16, b.seed * 50, 3, 3);
    // mast with a boom, radar and lights
    Bt.setColor([0.78, 0.78, 0.76]);
    const mz = fwd ? z1 + 0.6 : (z0 + z1) / 2;
    const my = fwd ? deckAt(t1 + 0.05) : yT;
    Bt.beam([0, my, mz], [0, my + 3.6, mz], 0.08, 0.08);
    Bt.beam([0, my + 0.6, mz], [0, my + 2.6, mz - L * 0.28], 0.055, 0.055);
    Bt.box(0, yT + 0.32, (z0 + z1) / 2, 0.9, 0.07, 0.16, '');
    Bt.box(0, yT + 0.2, (z0 + z1) / 2, 0.08, 0.2, 0.08, '');
    if (fwd) {
      // a net drum aft and a hatch
      Bt.setColor([0.3, 0.3, 0.32]);
      Bt.tube([-B * 0.3, deckAt(0.2) + 0.55, -L * 0.3], [B * 0.3, deckAt(0.2) + 0.55, -L * 0.3], 0.5, 0.5, 10, true);
      Bt.setColor([0.06, 0.12, 0.3]);
      Bt.box(0, deckAt(0.85) + 0.15, L * 0.33, B * 0.4, 0.3, 1.2, 'y');
    } else {
      // a hauler on the rail and a hatch forward
      Bt.setColor([0.3, 0.3, 0.32]);
      Bt.box(B * 0.32, deckAt(0.6) + 0.35, L * 0.1, 0.35, 0.5, 0.35, 'y');
      Bt.setColor(cabin);
      Bt.box(0, deckAt(0.7) + 0.12, L * 0.22, B * 0.42, 0.24, 1.0, 'y');
    }
    // the gunwale: a white cap rail along the sheer and a dark rubbing strake below it
    for (const side of [-1, 1]) {
      for (let i = 1; i < N - 1; i++) {
        const A = st[i];
        const C = st[i + 1];
        Bt.setColor([0.85, 0.85, 0.83]);
        Bt.beam([A.sec[3][0] * side, A.sheer + 0.04, A.z], [C.sec[3][0] * side, C.sheer + 0.04, C.z], 0.09, 0.07);
        Bt.setColor([0.04, 0.04, 0.045]);
        Bt.beam([A.sec[3][0] * side * 1.01, A.sheer - 0.28, A.z], [C.sec[3][0] * side * 1.01, C.sheer - 0.28, C.z], 0.06, 0.08);
      }
    }
    // fenders hanging over the quay side
    if (b.state === 'afloat') {
      Bt.setColor([0.03, 0.03, 0.03]);
      // the quay lies to the south: the local side whose x axis points that way
      const qs = Math.sign(F.exz) || 1;
      for (const t of [0.3, 0.5, 0.7]) {
        const sti = st[Math.round(t * (N - 1))];
        Bt.blob(sti.sec[3][0] * 1.05 * qs, sti.sheer - 0.5, (t - 0.5) * L, 0.16, 0.28, 0.16, 0.05, Math.floor(t * 10), 0);
      }
    }
    // a light at the masthead: anchor light after dark
    const g: GlowParams = { threshold: 0.08, warmth: 0.6, intensity: 2.0, seed: r(), sched: SCHED.street };
    const BG = k.boatGlow;
    BG.set('aBob', b.x, y0, b.z, b.state === 'afloat' ? bobPhase : -1);
    if (b.state === 'afloat' && r() < 0.6) k.lampGlass(BG, F, 0, my + 3.65, mz, 0.12, 0.14, 0.12, g, { size: 0.25, minPx: 2, gain: 1.4 });
    // wheelhouse windows lit when the crew is aboard: a warm pane over each window, framed in the
    // wheelhouse colour (the glow shader draws the frames), on the sides and the raked front
    if (b.state === 'afloat' && r() < 0.35) {
      const G = BG;
      G.frame = F;
      G.setColor(cabin);
      const gw: GlowParams = { threshold: 0.1, warmth: 0.6, intensity: 0.45, seed: r(), sched: SCHED.home };
      G.set('aGlow', gw.threshold, gw.warmth, gw.intensity, snapSeed(gw.seed));
      const Hs = yW1 - yW0;
      const e = 0.012;
      for (const sx of [-1, 1]) {
        const za = z0 + 0.15;
        const zb = front(yW1) - 0.04;
        const m = Math.max(2, Math.round((zb - za) / 0.62));
        const pw = (zb - za) / m;
        for (let i = 0; i < m; i++) {
          const a = za + pw * i;
          G.set('aKind', GLOW.door, SCHED.home, snapSize(pw), snapSize(Hs));
          G.polyN(
            [
              [sx * (hw2 + e), yW0, a],
              [sx * (hw2 + e), yW0, a + pw],
              [sx * (hw2 + e), yW1, a + pw],
              [sx * (hw2 + e), yW1, a],
            ],
            sx > 0
              ? [
                  [pw, 0],
                  [0, 0],
                  [0, Hs],
                  [pw, Hs],
                ]
              : [
                  [0, 0],
                  [pw, 0],
                  [pw, Hs],
                  [0, Hs],
                ],
            [sx, 0, 0],
          );
        }
      }
      {
        const fl = Math.hypot(1, rake / ch);
        const ny = rake / ch / fl;
        const nz = 1 / fl;
        const Hf = Math.hypot(Hs, front(yW1) - front(yW0));
        const m = Math.max(2, Math.round(cw / 0.55));
        const pw = cw / m;
        for (let i = 0; i < m; i++) {
          const a = -hw2 + pw * i;
          G.set('aKind', GLOW.door, SCHED.home, snapSize(pw), snapSize(Hf));
          G.polyN(
            [
              [a, yW0 + ny * e, front(yW0) + nz * e],
              [a + pw, yW0 + ny * e, front(yW0) + nz * e],
              [a + pw, yW1 + ny * e, front(yW1) + nz * e],
              [a, yW1 + ny * e, front(yW1) + nz * e],
            ],
            [
              [0, 0],
              [pw, 0],
              [pw, Hf],
              [0, Hf],
            ],
            [0, ny, nz],
          );
        }
      }
      k.light(F.wx(0, (z0 + z1) / 2), y0 + (yW0 + yW1) / 2, F.wz(0, (z0 + z1) / 2), gw, 0.8, 1.6, 1.6);
    }
  }
  // mooring lines to the quay bollards / the rorbu landing
  if (b.state !== 'land') {
    const NF = k.nearFacade;
    NF.frame = IDENTITY;
    k.style(NF, STYLE.timber, 0, 0, 0);
    NF.setColor([0.55, 0.48, 0.32]);
    for (const end of [-1, 1]) {
      const sx = F.wx(0, end * L * 0.42);
      const sz = F.wz(0, end * L * 0.42);
      const tx = sx + (plan.onQuay(sx, sz + 3) ? 0 : 0) + end * b.hx * 2.5;
      const tz = b.state === 'afloat' && b.z < plan.quay.front + 1 ? plan.quay.front + 0.5 : sz + end * b.hz * 2.5;
      NF.beam([sx, y0 + st[end > 0 ? N - 2 : 1].sheer, sz], [tx, b.state === 'afloat' ? plan.quay.y + 0.45 : y0 + 1.2, tz], 0.025, 0.025);
    }
  }
  if (b.state === 'frozen') {
    // snow drifted against the hull where it is locked in the ice, a little higher on the windward side
    for (const side of [-1, 1]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < N; i++) {
        const lx = side * (st[i].sec[2][0] + 0.32);
        pts.push([F.wx(lx, st[i].z), F.wz(lx, st[i].z)]);
      }
      k.bank(k.snow, pts, 1.1, side > 0 ? 0.34 : 0.24, b.seed * 77 + side, () => 0.03, side);
    }
  }
  if (b.state === 'land') {
    // trestles under a hauled-up boat
    const T = k.nearFacade;
    T.frame = F;
    k.style(T, STYLE.timber, 0, 0, 0);
    T.setColor([0.18, 0.15, 0.12]);
    for (const t of [-0.25, 0.25]) T.box(0, -0.55, t * L, B * 0.9, 0.18, 0.18, '');
  }
  return { x: b.x, z: b.z, y: y0, len: L, yaw: Math.atan2(b.hx, b.hz), state: b.state };
}

/* ------------------------------------------------------------------ */
/* stockfish racks (hjell)                                            */
/* ------------------------------------------------------------------ */

function rack(k: Kit, rk: Rack): void {
  const r = mulberry32(rk.seed);
  // local x along the rack, z across
  const F = Frame.facing(rk.x, 0, rk.z, -rk.hz, rk.hx);
  const Fa = k.facade;
  Fa.frame = F;
  k.style(Fa, STYLE.timber, 0, 0, r());
  Fa.setColor([0.2, 0.17, 0.13]);
  const half = rk.len / 2;
  const nB = Math.max(2, Math.round(rk.len / 3.2));
  const top = 4.2 + r() * 0.6;
  const ground = (x: number) => k.h(F.wx(x, 0), F.wz(x, 0));
  const tiers = [1.7, 2.75, 3.75];
  for (let i = 0; i <= nB; i++) {
    const x = -half + (rk.len * i) / nB;
    const g = ground(x);
    Fa.beam([x, g - 0.3, -1.3], [x, g + top + 0.15, 0], 0.13, 0.13);
    Fa.beam([x, g - 0.3, 1.3], [x, g + top + 0.15, 0], 0.13, 0.13);
  }
  const g0 = ground(-half);
  const g1 = ground(half);
  const gy = (x: number) => g0 + ((g1 - g0) * (x + half)) / rk.len;
  Fa.beam([-half - 0.3, gy(-half) + top, 0], [half + 0.3, gy(half) + top, 0], 0.12, 0.12);
  // rails on both faces, hung with fish
  const C = k.cards;
  C.frame = F;
  for (const tY of tiers) {
    const zOff = (1.3 * (top - tY)) / (top + 0.3);
    for (const side of [-1, 1]) {
      Fa.frame = F;
      Fa.beam([-half - 0.2, gy(-half) + tY, side * zOff], [half + 0.2, gy(half) + tY, side * zOff], 0.08, 0.08);
      if (r() < 0.12) continue;
      const band = r() < 0.2 ? CARD.fish2 : CARD.fish;
      const [u0, v0, u1, v1] = band;
      const W = 1.6;
      const Hh = 0.8;
      C.setColor(jitter([1, 1, 1], r, 0.08));
      for (let x = -half; x < half - 0.2; x += W) {
        const x1 = Math.min(half, x + W);
        const frac = (x1 - x) / W;
        const ya = gy(x) + tY + 0.04;
        const yb = gy(x1) + tY + 0.04;
        const z = side * (zOff + 0.06);
        C.polyN(
          [
            [x, ya - Hh, z],
            [x1, yb - Hh, z],
            [x1, yb, z],
            [x, ya, z],
          ],
          [
            [u0, v0],
            [u0 + (u1 - u0) * frac, v0],
            [u0 + (u1 - u0) * frac, v1],
            [u0, v1],
          ],
          [0, 0, side],
        );
      }
    }
  }
  // a dusting of snow along the ridge pole
  k.nearSnow.frame = F;
  for (let x = -half; x < half; x += 2) k.pillow(k.nearSnow, x + 1, gy(x + 1) + top + 0.06, 0, 2, 0.16, 0.06, x * 7 + rk.seed, 3, 1);
}

/* ------------------------------------------------------------------ */
/* on the quay: fish crates, a crane, kick-sleds                      */
/* ------------------------------------------------------------------ */

const CRATES: Vec3[] = [
  [0.03, 0.12, 0.42],
  [0.03, 0.12, 0.42],
  [0.04, 0.16, 0.5],
  [0.5, 0.06, 0.03],
  [0.6, 0.62, 0.6],
  [0.05, 0.22, 0.12],
];

/** a plastic fish crate (local frame of N): a ribbed body, a lip round the top, hand holes in the ends */
function crate(k: Kit, x: number, y: number, z: number, col: Vec3): void {
  const N = k.nearFacade;
  N.setColor(col);
  N.box(x, y + 0.125, z, 1.06, 0.23, 0.7, 'y');
  N.box(x, y + 0.265, z, 1.12, 0.05, 0.76, '');
  N.setColor(scale3(col, 0.6));
  for (const sz of [-1, 1]) for (const t of [-0.3, 0, 0.3]) N.box(x + t, y + 0.12, z + sz * 0.355, 0.04, 0.2, 0.02, '');
  N.setColor([0.01, 0.01, 0.012]);
  for (const sx of [-1, 1]) N.box(x + sx * 0.535, y + 0.19, z, 0.012, 0.055, 0.22, '');
}

function quayProps(k: Kit, plan: VillagePlan, r: () => number): void {
  const q = plan.quay;
  const N = k.nearFacade;
  // stacks of fish crates by the fish landing and along the quay
  const stacks: [number, number][] = [];
  const px = plan.plant.x + plan.plant.w / 2 + 3;
  stacks.push([px, q.front + 3], [px + 1.4, q.front + 3.2], [px + 0.6, q.front + 4.6], [px + 7, q.front + 2.8]);
  for (let x = q.minX + 30; x < q.maxX - 30; x += 22 + r() * 10) stacks.push([x, q.front + 2.4 + r()]);
  N.frame = IDENTITY;
  for (const [x, z] of stacks) {
    const yaw = (r() - 0.5) * 0.3;
    const F = Frame.fromAngle(x, q.y, z, yaw);
    N.frame = F;
    k.style(N, STYLE.paint, 0, 0, x);
    // a pallet, and two or four stacks of crates on it
    const pallet = r() < 0.6;
    const y0 = pallet ? 0.14 : 0;
    if (pallet) {
      N.setColor([0.32, 0.25, 0.17]);
      N.box(0, 0.12, 0, 2.3, 0.04, 1.55, '');
      for (const t of [-0.6, 0, 0.6]) N.box(0, 0.05, t, 2.2, 0.1, 0.12, '');
    }
    const col = pick(r, CRATES);
    const spots: [number, number][] = pallet ? [[-0.56, -0.38], [0.56, -0.38], [-0.56, 0.38], [0.56, 0.38]] : [[0, 0]];
    for (const [sx, sz] of spots) {
      if (pallet && r() < 0.2) continue;
      const n = (pallet ? 2 : 1) + Math.floor(r() * (pallet ? 5 : 4));
      const c = r() < 0.8 ? col : pick(r, CRATES);
      const ox = sx + (r() - 0.5) * 0.04;
      const oz = (pallet ? sz * 1.0 : 0) + (r() - 0.5) * 0.04;
      // crates are 0.7 deep: on a pallet they sit two by two across
      for (let i = 0; i < n; i++) crate(k, ox + (r() - 0.5) * 0.03, y0 + i * 0.27, oz * (pallet ? 1 : 0), c);
      k.nearSnow.frame = F;
      k.pillow(k.nearSnow, ox, y0 + 0.27 * n + 0.02, oz * (pallet ? 1 : 0), 1.1, 0.74, 0.1, x + z + sx * 7 + sz * 3, 3, 3, 0.02);
      N.frame = F;
    }
  }
  // insulated fish tubs, coils of rope, heaps of nets, barrels
  const TUBS: Vec3[] = [
    [0.06, 0.16, 0.38],
    [0.5, 0.5, 0.48],
    [0.55, 0.2, 0.03],
  ];
  for (let x = q.minX + 26; x < q.maxX - 26; x += 9 + r() * 9) {
    const z = q.front + 3 + r() * 7;
    const yaw = (r() - 0.5) * 0.6;
    const F = Frame.fromAngle(x, q.y, z, yaw);
    const kind = r();
    if (kind < 0.4) {
      N.frame = F;
      k.style(N, STYLE.paint, 0, 0, x);
      const tc = pick(r, TUBS);
      for (const [ox, oz] of r() < 0.6 ? [[0, 0], [1.28, 0.1]] : [[0, 0]]) {
        N.setColor(tc);
        N.box(ox, 0.43, oz, 1.16, 0.86, 0.96, 'y');
        N.box(ox, 0.86, oz, 1.24, 0.08, 1.04, '');
        N.setColor(scale3(tc, 0.55));
        N.box(ox, 0.06, oz, 1.2, 0.12, 1.0, 'y');
      }
      k.nearSnow.frame = F;
      k.pillow(k.nearSnow, 0.3, 0.9, 0, 2.2, 1.0, 0.15, x, 4, 3);
    } else if (kind < 0.7) {
      // a heap of nets and floats under snow
      const Fo = k.nearSnow;
      Fo.frame = F;
      k.pillow(Fo, 0, 0.0, 0, 2.2 + r(), 1.6 + r() * 0.6, 0.55 + r() * 0.3, x * 3, 5, 4);
      N.frame = F;
      k.style(N, STYLE.paint, 0, 0, x);
      N.setColor(pick(r, [[0.05, 0.14, 0.08], [0.04, 0.08, 0.2], [0.5, 0.1, 0.02]] as Vec3[]));
      N.blob(0.9, 0.18, 0.5, 0.5, 0.25, 0.4, 0.2, Math.floor(r() * 999), 0);
      N.setColor([0.75, 0.2, 0.03]);
      for (let i = 0; i < 4; i++) N.blob(-0.8 + i * 0.4, 0.15, -0.7, 0.14, 0.14, 0.14, 0.05, i, 0);
    } else {
      // barrels
      N.frame = F;
      k.style(N, STYLE.paint, 0, 0, x);
      for (let i = 0; i < 3; i++) {
        N.setColor(pick(r, [[0.3, 0.05, 0.03], [0.05, 0.1, 0.25], [0.2, 0.2, 0.2]] as Vec3[]));
        N.cylinder(i * 0.65, 0, (i % 2) * 0.5, 0.3, 0.3, 0.9, 8, true);
        k.nearSnow.frame = F;
        k.pillow(k.nearSnow, i * 0.65, 0.9, (i % 2) * 0.5, 0.5, 0.5, 0.1, x + i, 2, 2);
      }
    }
  }
  // the plowed snow pushed up into heaps at the quay ends
  k.snow.frame = IDENTITY;
  for (const [x, z, sx, sz, t] of [
    [q.minX + 26, q.front + 9, 9, 6, 2.2],
    [q.maxX - 22, q.front + 9.5, 8, 5.5, 1.9],
  ] as const) k.pillow(k.snow, x, q.y, z, sx, sz, t, x, 7, 5, 0.2);
  // a small crane on the quay front
  {
    const cx = (plan.plant.x + plan.warehouse.x) / 2 + 12;
    const cz = q.front + 1.4;
    const F = k.facade;
    F.frame = IDENTITY;
    k.style(F, STYLE.paint, 0, 0, 0.3);
    F.setColor([0.55, 0.38, 0.03]);
    F.cylinder(cx, q.y, cz, 0.28, 0.2, 5.5, 8, false);
    F.beam([cx, q.y + 5.3, cz], [cx + 1.2, q.y + 6.4, cz - 5.2], 0.18, 0.2);
    F.setColor([0.05, 0.05, 0.05]);
    F.beam([cx + 1.2, q.y + 6.3, cz - 5.2], [cx + 1.2, q.y + 2.8, cz - 5.2], 0.03, 0.03);
    F.box(cx, q.y + 0.25, cz, 1.2, 0.5, 1.2, '');
  }
  // cars parked along the back of the quay below the store, nose to the terrace
  {
    const mainX = plan.lanes.find((l) => l.id === 'main')?.pts[0]?.x ?? q.minX;
    let n = 0;
    for (let x = plan.store.x - 10; x < plan.store.x + 14 && n < 4; x += 2.9 + r() * 0.6) {
      if (Math.abs(x - mainX) < 5) continue;
      if (r() < 0.25) continue;
      parkedCar(k, x, q.back - 3.4 + (r() - 0.5) * 0.4, Math.PI + (r() - 0.5) * 0.12, r);
      n++;
    }
    // and one by the fish landing
    parkedCar(k, plan.plant.x + plan.plant.w / 2 + 10, q.front + 15, Math.PI / 2 + (r() - 0.5) * 0.2, r);
  }
  // kick-sleds parked by the store
  const s = plan.store;
  for (let i = 0; i < 3; i++) {
    const x = s.x - 3 + i * 1.1 + (r() - 0.5) * 0.3;
    const z = s.z + (s.fz * (s.d / 2 + 2.6));
    kickSled(k, x, z, Math.PI / 2 + (r() - 0.5) * 0.4, r);
  }
}

const CARS: Vec3[] = [
  [0.32, 0.02, 0.015],
  [0.02, 0.05, 0.14],
  [0.42, 0.43, 0.44],
  [0.75, 0.75, 0.74],
  [0.015, 0.015, 0.017],
  [0.05, 0.12, 0.06],
];

/** a parked car under a night's snow: body, glasshouse, wheels, snow on the roof, the bonnet and the boot */
export function parkedCar(k: Kit, x: number, z: number, yaw: number, r: () => number): void {
  const L = 4.2 + r() * 0.4;
  const W = 1.76;
  const y = Math.min(k.h(x + Math.sin(yaw) * L * 0.4, z + Math.cos(yaw) * L * 0.4), k.h(x - Math.sin(yaw) * L * 0.4, z - Math.cos(yaw) * L * 0.4), k.h(x, z));
  const F = Frame.fromAngle(x, y, z, yaw);
  for (const t of [-0.25, 0.25]) k.solids.push([F.wx(0, t * L), F.wz(0, t * L), 1.05, y]);
  const N = k.nearFacade;
  N.frame = F;
  k.style(N, STYLE.paint, 0, 0, x);
  const body = pick(r, CARS);
  N.setColor(body);
  // the lower body, a little tucked in at the bumpers
  N.box(0, 0.62, 0, W, 0.56, L - 0.3, '');
  N.box(0, 0.56, 0, W - 0.1, 0.42, L, '');
  // the glasshouse: dark glass on raked pillars, the roof in the body colour
  const zb0 = -L * 0.27;
  const zb1 = L * 0.2;
  const zt0 = -L * 0.2;
  const zt1 = L * 0.06;
  const y0 = 0.9;
  const y1 = 1.4;
  const w0 = W / 2 - 0.08;
  const w1 = W / 2 - 0.2;
  N.setColor([0.015, 0.02, 0.025]);
  for (const sx of [-1, 1]) N.polyN([[sx * w0, y0, zb0], [sx * w0, y0, zb1], [sx * w1, y1, zt1], [sx * w1, y1, zt0]], null, [sx, 0.2, 0]);
  N.polyN([[-w0, y0, zb1], [w0, y0, zb1], [w1, y1, zt1], [-w1, y1, zt1]], null, [0, 0.6, 1]);
  N.polyN([[-w0, y0, zb0], [w0, y0, zb0], [w1, y1, zt0], [-w1, y1, zt0]], null, [0, 0.6, -1]);
  N.setColor(body);
  N.box(0, y1 + 0.02, (zt0 + zt1) / 2, w1 * 2 + 0.04, 0.05, zt1 - zt0 + 0.06, '');
  // wheels
  N.setColor([0.02, 0.02, 0.022]);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) N.tube([sx * (W / 2 - 0.2), 0.32, sz * L * 0.32], [sx * (W / 2 + 0.01), 0.32, sz * L * 0.32], 0.32, 0.32, 10, true);
  // snow: thick on the roof, a blanket over the bonnet and the boot, a drift banked along one side
  const S = k.nearSnow;
  S.frame = F;
  k.pillow(S, 0, y1 + 0.04, (zt0 + zt1) / 2, w1 * 2 + 0.12, zt1 - zt0 + 0.2, 0.2 + r() * 0.08, x + z, 4, 4, 0.03);
  k.pillow(S, 0, 0.9, (zb1 + L / 2) / 2, W - 0.04, L / 2 - zb1 - 0.05, 0.12, x * 3 + z, 4, 3, 0.03);
  k.pillow(S, 0, 0.9, (-L / 2 + zb0) / 2, W - 0.04, zb0 + L / 2 - 0.05, 0.1, x * 5 + z, 4, 3, 0.03);
}

/** a Nordic kick-sled: a chair on two long steel runners with a tall handlebar */
export function kickSled(k: Kit, x: number, z: number, yaw: number, r: () => number): void {
  const y = k.h(x, z) + 0.02;
  const F = Frame.fromAngle(x, y, z, yaw);
  const N = k.nearFacade;
  N.frame = F;
  k.style(N, STYLE.paint, 0, 0, 0.5);
  N.setColor([0.1, 0.1, 0.11]);
  for (const sx of [-0.22, 0.22]) {
    N.beam([sx, 0.02, -0.9], [sx, 0.02, 0.85], 0.03, 0.02);
    N.beam([sx, 0.02, 0.85], [sx, 0.12, 0.98], 0.03, 0.02);
    N.beam([sx, 0.02, 0.45], [sx, 1.05, 0.52], 0.025, 0.025);
  }
  N.beam([-0.22, 1.05, 0.52], [0.22, 1.05, 0.52], 0.03, 0.03);
  N.setColor(pick(r, [[0.3, 0.05, 0.03], [0.6, 0.48, 0.3], [0.05, 0.12, 0.2]] as Vec3[]));
  N.box(0, 0.55, 0.32, 0.46, 0.04, 0.34, '');
  N.box(0, 0.78, 0.5, 0.46, 0.44, 0.04, '');
}
