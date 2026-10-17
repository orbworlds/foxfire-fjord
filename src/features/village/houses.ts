/**
 * Lysvik's buildings: painted Nordic cabins (one, one-and-a-half and two
 * storeys, red, ochre, yellow and white boards with white corner boards and
 * window frames, some with a projecting cross gable, a gabled entry porch, a
 * lamp by the door and a chimney), red rorbuer on stilts at the water's edge,
 * tarred boathouses with slipways, stabbur on posts, woodsheds with stacked
 * firewood, the general store with its lit shop windows and sign, the fish
 * landing and the red warehouse over the harbour, and the old school.
 */
import { Frame, IDENTITY, type GeoBuilder, type Vec3 } from './builder';
import { mulberry32 } from '../../world/noise';
import { STYLE, GLOW, SCHED } from './materials';
import { Kit, wallFrames, pick, jitter, WHITE, type GlowParams, type WallFrame } from './kit';
import { gableRoof, chimney, type RoofSpec, type RoofInfo, type GableLook } from './roofs';
import type { Lot, VillagePlan } from './plan';
import { pickets } from './church';
import { kickSled } from './harbor';

export interface BuildingInfo {
  kind: Lot['kind'];
  x: number;
  z: number;
  /** base (floor / plinth top) and total height above it */
  y: number;
  h: number;
  w: number;
  d: number;
  /** yaw so that local +z faces the front */
  yaw: number;
  /** one line for the info card */
  desc: string;
  /** a name for the card title (store, landing…) */
  name?: string;
}

/** A shovelled footpath from a front door toward its lane (finished by the lanes builder). */
export interface DoorPath {
  /** world polyline from the foot of the steps outward; the lanes builder adds the last leg */
  pts: [number, number][];
  lane: string;
  /** the house it belongs to (its own footprint is not an obstacle for the first metre) */
  lot: Lot;
}

/* ------------------------------------------------------------------ */
/* palettes (linear albedo)                                           */
/* ------------------------------------------------------------------ */

const PAINT: Record<string, Vec3> = {
  white: [0.8, 0.79, 0.74],
  red: [0.3, 0.032, 0.017],
  ochre: [0.56, 0.29, 0.055],
  yellow: [0.66, 0.47, 0.11],
  cream: [0.72, 0.63, 0.44],
  blueGrey: [0.27, 0.33, 0.37],
  green: [0.17, 0.25, 0.16],
  grey: [0.46, 0.46, 0.44],
  tar: [0.014, 0.012, 0.011],
  silver: [0.26, 0.24, 0.21],
  brown: [0.09, 0.05, 0.03],
};
const PAINT_NAMES: Record<string, string> = {
  white: 'white',
  red: 'falu red',
  ochre: 'ochre',
  yellow: 'yellow',
  cream: 'cream',
  blueGrey: 'grey-blue',
  green: 'green',
  grey: 'pale grey',
};
const ROOFS: Vec3[] = [
  [0.028, 0.028, 0.03],
  [0.05, 0.05, 0.052],
  [0.022, 0.03, 0.026],
  [0.2, 0.045, 0.025],
  [0.07, 0.068, 0.065],
];
const TRIM = WHITE;
const SOFFIT: Vec3 = [0.7, 0.69, 0.65];

interface Look extends GableLook {
  name: string;
  paint: string;
}

function pickPaint(r: () => number): string {
  const x = r();
  if (x < 0.32) return 'white';
  if (x < 0.56) return 'red';
  if (x < 0.7) return 'ochre';
  if (x < 0.79) return 'yellow';
  if (x < 0.86) return 'cream';
  if (x < 0.91) return 'blueGrey';
  if (x < 0.95) return 'green';
  return 'grey';
}

function lookFor(r: () => number, paint: string, seed: number): Look {
  const tint = jitter(PAINT[paint], r, 0.07);
  let st: number = STYLE.clap;
  let variant = 0;
  if (paint === 'red' || paint === 'ochre') {
    st = r() < 0.75 ? STYLE.panel : STYLE.clap;
    variant = r() < 0.5 ? 0 : 1;
  } else if (paint === 'white') {
    st = r() < 0.7 ? STYLE.clap : STYLE.panel;
    variant = 1;
  } else if (r() < 0.4) {
    st = STYLE.panel;
    variant = r() < 0.5 ? 0 : 1;
  }
  const clad = st === STYLE.panel ? (variant === 0 ? 'board-and-batten' : 'standing boards') : 'weatherboard';
  return { st, variant, tint, seed, paint, name: `${PAINT_NAMES[paint] ?? paint} ${clad}` };
}

/* ------------------------------------------------------------------ */
/* windows and lights                                                 */
/* ------------------------------------------------------------------ */

interface Occupants {
  occupied: boolean;
  seed: number;
  warmth: number;
  r: () => number;
}

function glowFor(o: Occupants, kind: number, litProb = 0.82, sched: number = SCHED.home): GlowParams {
  const r = o.r;
  const lit = o.occupied && r() < litProb;
  const base = kind === GLOW.shop ? 1.1 : kind === GLOW.church ? 0.75 : kind === GLOW.works ? 0.8 : kind === GLOW.attic ? 0.5 : 0.6;
  return {
    threshold: lit ? 0.05 + r() * 0.45 : 9,
    warmth: Math.min(1, Math.max(0, o.warmth + (r() - 0.5) * 0.25)),
    intensity: base * (0.75 + r() * 0.5),
    seed: Math.min(0.999, Math.max(0, o.seed + (r() - 0.5) * 0.05)),
    sched,
  };
}

/** n windows spread along a wall storey (skipping [skip0, skip1] on the wall, e.g. a porch) */
function windowRow(
  k: Kit,
  wf: WallFrame,
  o: Occupants,
  y0: number,
  W: number,
  H: number,
  n: number,
  opts: { skip?: [number, number]; kind?: number; pool?: number; ground?: (x: number) => number; prob?: number; pair?: boolean } = {},
): void {
  if (n <= 0) return;
  const margin = 0.55;
  const span = wf.L - margin * 2;
  const step = span / n;
  for (let i = 0; i < n; i++) {
    if (opts.prob !== undefined && o.r() > opts.prob) continue;
    const pair = opts.pair && step > W * 2 + 0.5;
    const cx = margin + step * (i + 0.5);
    const xs = pair ? [cx - W / 2 - 0.12, cx + W / 2 + 0.12] : [cx];
    for (const x of xs) {
      const x0 = x - W / 2;
      if (opts.skip && x0 + W > opts.skip[0] - 0.15 && x0 < opts.skip[1] + 0.15) continue;
      const kind = opts.kind ?? GLOW.sash;
      const g = glowFor(o, kind);
      k.opening(wf, x0, y0, W, H, kind, TRIM, g, { trim: TRIM, pool: opts.pool, ground: opts.ground?.(x), minPx: 2, gain: 2.2 });
    }
  }
}

/** corner boards (white) at the four corners of a w×d body in frame B */
function cornerBoards(k: Kit, B: Frame, w: number, d: number, y0: number, H: number, seed: number): void {
  const F = k.facade;
  F.frame = B;
  k.style(F, STYLE.paint, 0, 0, seed);
  F.setColor(TRIM);
  const t = 0.13;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box((sx * (w + 0.02)) / 2 - (sx * t) / 2 + sx * 0.02, y0 + H / 2, (sz * (d + 0.02)) / 2 - (sz * t) / 2 + sz * 0.02, t, H, t, 'y');
}

/** a band of white trim around the body at height y (floor joist board / drip board) */
function band(k: Kit, B: Frame, w: number, d: number, y: number, h: number, seed: number): void {
  const F = k.facade;
  F.frame = B;
  k.style(F, STYLE.paint, 0, 0, seed);
  F.setColor(TRIM);
  F.box(0, y, 0, w + 0.05, h, d + 0.05, 'yY');
}

/** door with a white frame and a glazed upper part */
function door(k: Kit, wf: WallFrame, x0: number, y0: number, o: Occupants, color: Vec3, glazed = true): void {
  const F = k.facade;
  F.frame = wf.f;
  k.style(F, STYLE.paint, 0, 0, o.seed);
  F.setColor(color);
  const W = 0.95;
  const H = 2.05;
  F.box(x0 + W / 2, y0 + H / 2, 0.02, W, H, 0.04, 'z');
  // frame
  F.setColor(TRIM);
  F.box(x0 - 0.06, y0 + H / 2 + 0.03, 0.04, 0.12, H + 0.06, 0.08, 'z');
  F.box(x0 + W + 0.06, y0 + H / 2 + 0.03, 0.04, 0.12, H + 0.06, 0.08, 'z');
  F.box(x0 + W / 2, y0 + H + 0.1, 0.05, W + 0.3, 0.14, 0.1, 'z');
  if (glazed) {
    const g = glowFor(o, GLOW.door, 0.6);
    k.opening(wf, x0 + 0.2, y0 + 1.2, W - 0.4, 0.62, GLOW.door, TRIM, g, { light: false, recess: 0.045 });
  }
}

/** an outdoor lamp by a door: a small lantern with its glow sprite and a pool on the snow */
function doorLamp(k: Kit, wf: WallFrame, x: number, y: number, o: Occupants, groundY: number): void {
  const F = wf.f;
  const N = k.nearFacade;
  N.frame = F;
  k.style(N, STYLE.paint, 0, 0, o.seed);
  N.setColor([0.05, 0.05, 0.05]);
  N.box(x, y + 0.05, 0.09, 0.05, 0.3, 0.12, '');
  const on = o.occupied || o.r() < 0.4;
  const g: GlowParams = { threshold: on ? 0.05 + o.r() * 0.2 : 9, warmth: 0.75, intensity: 1.6, seed: o.seed, sched: SCHED.street };
  k.lampGlass(k.glow, F, x, y - 0.12, 0.16, 0.13, 0.2, 0.13, g, { size: 0.35, minPx: 1.8, gain: 1.5 });
  if (on) {
    const px = F.wx(x, 1.4);
    const pz = F.wz(x, 1.4);
    k.groundPool(px, pz, 2.6, g, 0.5, groundY);
  }
}

/** entry steps in front of a door: one block per 18 cm of rise, snowed */
function steps(k: Kit, wf: WallFrame, xc: number, rise: number, width: number, seed: number, out = 0): void {
  if (rise < 0.12) return;
  rise = Math.min(rise, 2.6);
  const n = Math.max(1, Math.round(rise / 0.18));
  // cast concrete steps, each a block down into the ground, swept but still white at the edges
  const C = k.facade;
  C.frame = wf.f;
  k.style(C, STYLE.concrete, 0, 0, seed);
  C.setColor([0.66, 0.66, 0.64]);
  const tread = 0.3;
  for (let i = 0; i < n; i++) {
    const top = -(rise * i) / n - 0.09;
    const zz = out + tread * (i + 0.5);
    C.box(xc, top - 0.3, zz, width, 0.6, tread + 0.01, i ? 'z' : '', 0);
  }
  const Sn = k.nearSnow;
  Sn.frame = wf.f;
  for (let i = 0; i < n; i++) {
    const top = -(rise * i) / n - 0.09;
    for (const side of [-1, 1]) k.pillow(Sn, xc + side * width * 0.36, top, out + tread * (i + 0.5), width * 0.26, tread * 0.95, 0.07, seed + i * 3 + side, 2, 2);
  }
  // a hand rail down one side
  const N = k.nearFacade;
  N.frame = wf.f;
  k.style(N, STYLE.paint, 0, 0, seed);
  N.setColor([0.05, 0.05, 0.055]);
  const x = xc + width / 2 - 0.06;
  const z1 = out + tread * n;
  N.beam([x, 0.85, out + 0.05], [x, -rise + 0.85, z1], 0.04, 0.04);
  N.beam([x, -rise - 0.1, z1], [x, -rise + 0.87, z1], 0.04, 0.04);
}

/* ------------------------------------------------------------------ */
/* cabins                                                             */
/* ------------------------------------------------------------------ */

function lotFrame(lot: Lot, y = lot.y): { F: Frame; B: Frame; bw: number; bd: number } {
  const F = Frame.facing(lot.x, y, lot.z, lot.fx, lot.fz);
  if (lot.gableFront) return { F, B: F.child(0, 0, 0, -Math.PI / 2), bw: lot.d, bd: lot.w };
  return { F, B: F, bw: lot.w, bd: lot.d };
}

function snowDepth(r: () => number, pitch: number): number {
  return Math.max(0.12, (0.32 + r() * 0.2) * (pitch > 1.0 ? 0.75 : 1));
}

export function buildCabin(k: Kit, lot: Lot, plan: VillagePlan, doors: DoorPath[] = []): BuildingInfo {
  const r = mulberry32(lot.seed);
  const L0 = lotFrame(lot);
  const F = L0.F;
  const bd = L0.bd;
  // a lower side wing takes part of the frontage: the main body shifts the other way
  const wing = !lot.gableFront && lot.wing ? lot.wing : null;
  const bw = wing ? L0.bw - wing.w : L0.bw;
  const B = wing ? L0.B.child((-wing.side * wing.w) / 2, 0, 0, 0) : L0.B;
  const paint = pickPaint(r);
  const look = lookFor(r, paint, r());
  const o: Occupants = { occupied: r() < 0.9, seed: r(), warmth: 0.35 + r() * 0.55, r };
  const roll = r();
  const kind = bw < 7.4 || roll < 0.3 ? 'one' : roll < 0.68 ? 'oneHalf' : 'two';
  const wallH = kind === 'one' ? 2.8 : kind === 'oneHalf' ? 3.75 : 5.55;
  const pitch = kind === 'two' ? 0.62 + r() * 0.2 : 0.85 + r() * 0.22;
  const groundAt = (x: number, z: number) => k.h(x, z);
  const yG = lot.yMin - lot.y;

  // plinth
  k.plinth(B, bw + 0.08, bd + 0.08, 0.02, yG, look.seed, r() < 0.3);
  // walls
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);
  band(k, B, bw, bd, 0.06, 0.12, look.seed);
  if (kind === 'two') band(k, B, bw, bd, 2.85, 0.1, look.seed);

  // which wall faces the lane, where the porch goes
  const frontWall = lot.gableFront ? 1 : 0;
  const longFront = lot.gableFront ? (r() < 0.5 ? 0 : 2) : 0;
  const porchWall = lot.gableFront && r() < 0.5 ? frontWall : longFront;
  const pwf = walls[porchWall];
  const porchX = pwf.L * (0.22 + r() * 0.18) * (r() < 0.5 ? 1 : -1) + pwf.L / 2;
  const porchW = 2.3 + r() * 0.4;
  const hasArk = kind === 'oneHalf' && !lot.gableFront && bw > 8.2 && r() < 0.55;
  const arkW = 3.4 + r() * 0.8;
  const arkX = bw / 2 + (r() - 0.5) * 0.8;

  const wallGround = (wf: WallFrame) => (x: number) => groundAt(wf.f.wx(x, 1.5), wf.f.wz(x, 1.5));
  // windows: ground floor all round, upper floor on two-storey houses
  const gH = 1.28;
  const gW = 0.98;
  for (let i = 0; i < 4; i++) {
    const wf = walls[i];
    const gable = i === 1 || i === 3;
    const n = Math.max(1, Math.round((wf.L - 1.2) / (gable ? 2.6 : 2.3)));
    const skip: [number, number] | undefined = i === porchWall ? [porchX - porchW / 2, porchX + porchW / 2] : hasArk && i === 0 ? [arkX - arkW / 2, arkX + arkW / 2] : undefined;
    windowRow(k, wf, o, 0.88, gW, gH, n, { skip, pool: i === 0 || i === frontWall ? 0.28 : 0.16, ground: wallGround(wf) });
    if (kind === 'two') windowRow(k, wf, o, 3.55, gW, gH - 0.1, n, { skip: hasArk && i === 0 ? skip : undefined, prob: 0.92 });
  }

  // roof
  const slidRoll = r();
  const roofSpec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch,
    eave: 0.45 + r() * 0.15,
    verge: 0.3 + r() * 0.12,
    cover: pick(r, ROOFS),
    coverStyle: r() < 0.6 ? STYLE.roofMetal : STYLE.roofTile,
    trim: TRIM,
    soffit: SOFFIT,
    gable: look,
    snow: snowDepth(r, pitch),
    slid: slidRoll < 0.18 ? [0.3 + r() * 0.4, r() < 0.5 ? 0.25 + r() * 0.4 : 0] : [0, 0],
    icicles: o.occupied ? 0.45 + r() * 0.4 : 0.15,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, roofSpec);

  // attic windows in the gables (1.5 storeys) or a small one under the apex
  for (const i of [1, 3]) {
    const wf = walls[i];
    const yA = wallH + 0.25;
    const room = (roof.ridgeY - yA) * 0.75;
    if (kind === 'oneHalf') {
      const n = bd > 7 ? 2 : 1;
      windowRow(k, wf, o, yA - 0.95, 0.9, Math.min(1.15, room), n, { pair: false });
    } else if (room > 0.9) {
      const g = glowFor(o, GLOW.attic, 0.4);
      k.opening(wf, wf.L / 2 - 0.35, yA + 0.1, 0.7, 0.7, GLOW.attic, TRIM, g, { trim: TRIM });
    }
  }

  // the projecting cross gable (ark) on the front of a storey-and-a-half house
  if (hasArk) {
    const proj = 0.9 + r() * 0.5;
    // deep enough that the cross gable's ridge dives under the main roof
    const arkRidge = wallH + 1.0 + 0.18 + (arkW / 2) * pitch * 1.05;
    const back = Math.min(bd - 0.6, Math.max(2.2, (arkRidge + 0.5 - (wallH + 0.18)) / pitch + 0.3));
    const aD = proj + back;
    const A = B.child(arkX - bw / 2, 0, bd / 2 + proj - aD / 2, 0);
    const aWalls = wallFrames(A, arkW, aD);
    const aH = wallH + 1.0;
    for (const wf of [aWalls[0], aWalls[1], aWalls[3]]) k.wall(wf, 0, aH, look.st, look.variant, look.tint, look.seed, k.facade, 0, wf.L);
    cornerBoards(k, A, arkW, aD, 0, aH, look.seed);
    k.plinth(A, arkW + 0.08, aD + 0.08, 0.02, yG, look.seed);
    windowRow(k, aWalls[0], o, 0.88, gW, gH, 2, { pool: 0.18, ground: wallGround(aWalls[0]) });
    windowRow(k, aWalls[0], o, wallH - 0.2, 0.9, 1.15, 2, {});
    const R = A.child(0, 0, 0, -Math.PI / 2);
    gableRoof(k, R, {
      ...roofSpec,
      w: aD + 0.6,
      d: arkW,
      y: aH,
      pitch: roofSpec.pitch * 1.05,
      eave: 0.35,
      verge: 0.35,
      closed: '-x',
      slid: [0, 0],
      snow: roofSpec.snow * 0.9,
      seed: roofSpec.seed + 5,
    });
  }

  // entry porch with a little gable roof and a lamp
  let doorAt: [number, number] = [lot.x, lot.z];
  let doorOut: [number, number] = [lot.fx, lot.fz];
  {
    const pD = 1.7 + r() * 0.4;
    const pH = 2.5;
    const P = pwf.f.child(porchX, 0, pD / 2, 0);
    const pWalls = wallFrames(P, porchW, pD);
    for (const wf of [pWalls[0], pWalls[1], pWalls[3]]) k.wall(wf, 0, pH, look.st, look.variant, look.tint, look.seed);
    cornerBoards(k, P, porchW, pD, 0, pH, look.seed);
    k.plinth(P, porchW + 0.08, pD + 0.08, 0.02, yG, look.seed);
    const doorWall = pWalls[0];
    const doorCol: Vec3 = pick(r, [TRIM, [0.13, 0.17, 0.2], [0.24, 0.05, 0.03], [0.1, 0.18, 0.12]] as Vec3[]);
    door(k, doorWall, porchW / 2 - 0.475, 0, o, doorCol);
    const g0 = groundAt(doorWall.f.wx(porchW / 2, 1), doorWall.f.wz(porchW / 2, 1));
    doorLamp(k, doorWall, porchW / 2 + 0.75, 2.05, o, g0);
    const rise = -yG > 0 ? lot.y - g0 : 0;
    steps(k, doorWall, porchW / 2, rise, 1.3, lot.seed);
    // the shovelled path starts at the foot of the steps
    const nSteps = rise < 0.12 ? 0 : Math.max(1, Math.round(Math.min(rise, 2.6) / 0.18));
    const zFoot = 0.3 * nSteps + 0.2;
    doorAt = [doorWall.f.wx(porchW / 2, zFoot), doorWall.f.wz(porchW / 2, zFoot)];
    doorOut = [doorWall.f.ezx, doorWall.f.ezz];
    const sideWin = pWalls[1];
    if (pD > 1.6) {
      const g = glowFor(o, GLOW.sash, 0.5);
      k.opening(sideWin, pD / 2 - 0.3, 1.1, 0.6, 0.9, GLOW.attic, TRIM, g, { trim: TRIM });
    }
    const Rp = P.child(0, 0, 0, -Math.PI / 2);
    gableRoof(k, Rp, {
      w: pD + 0.4,
      d: porchW,
      y: pH,
      pitch: Math.max(0.8, pitch),
      eave: 0.25,
      verge: 0.25,
      cover: roofSpec.cover,
      coverStyle: roofSpec.coverStyle,
      trim: TRIM,
      soffit: SOFFIT,
      gable: look,
      closed: '-x',
      snow: roofSpec.snow * 0.85,
      icicles: roofSpec.icicles,
      seed: roofSpec.seed + 11,
    });
  }

  // a glassed veranda on a gable end of the bigger houses: small panes all round, a balcony on its roof
  const sideMargin = lot.obb.hx - lot.w / 2;
  if (kind === 'two' && !lot.gableFront && !wing && sideMargin > 1.5 && r() < 0.55) {
    // (the porch of a house with its eaves to the lane is on the long front)
    const gi = r() < 0.5 ? 1 : 3;
    const gwf = walls[gi];
    const vd = Math.min(2.1, sideMargin - 0.3);
    const vw = Math.min(gwf.L - 1.4, 3.4);
    const vh = 2.65;
    const V = gwf.f.child(gwf.L / 2, 0, vd / 2, 0);
    const vWalls = wallFrames(V, vw, vd);
    const gy = Math.min(lot.yMin, k.h(V.ox, V.oz)) - lot.y;
    k.plinth(V, vw + 0.08, vd + 0.08, 0.02, gy, look.seed);
    const Fa = k.facade;
    const vg: GlowParams = glowFor(o, GLOW.works, 0.85);
    vg.intensity *= 0.6;
    for (const wi of [0, 1, 3]) {
      const wf = vWalls[wi];
      // a white frame: a solid band below the glazing, posts at the corners, a beam on top
      Fa.frame = wf.f;
      k.style(Fa, STYLE.paint, 0, 0, look.seed);
      Fa.setColor(TRIM);
      Fa.box(wf.L / 2, 0.42, 0.02, wf.L, 0.84, 0.04, 'z');
      Fa.box(wf.L / 2, vh - 0.12, 0.02, wf.L, 0.24, 0.04, 'z');
      k.opening(wf, 0.08, 0.86, wf.L - 0.16, vh - 1.1, GLOW.works, TRIM, vg, { light: wi === 0, pool: wi === 0 ? 0.2 : 0, ground: lot.yMin });
    }
    cornerBoards(k, V, vw, vd, 0, vh, look.seed);
    Fa.frame = V;
    k.style(Fa, STYLE.paint, 0, 0, look.seed);
    Fa.setColor(TRIM);
    Fa.box(0, vh + 0.08, 0, vw + 0.3, 0.16, vd + 0.3, '');
    k.snow.frame = V;
    k.pillow(k.snow, 0, vh + 0.16, 0.05, vw + 0.2, vd + 0.15, 0.3, look.seed * 31, 5, 3, 0.04);
    // the balcony railing on the roof
    for (const [x0, z0, x1, z1] of [
      [-vw / 2, vd / 2, vw / 2, vd / 2],
      [-vw / 2, -vd / 2 + 0.1, -vw / 2, vd / 2],
      [vw / 2, -vd / 2 + 0.1, vw / 2, vd / 2],
    ] as const) {
      Fa.box((x0 + x1) / 2, vh + 1.12, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.06, 0.06, Math.abs(z1 - z0) + 0.06, '');
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.25));
      for (let i = 0; i <= n; i++) Fa.box(x0 + ((x1 - x0) * i) / n, vh + 0.7, z0 + ((z1 - z0) * i) / n, 0.04, 0.84, 0.04, 'yY');
    }
  }

  // chimney on the ridge, smoking when someone is home
  const cx = (r() - 0.5) * bw * 0.5;
  const top = roof.ridgeY + 0.75 + r() * 0.35;
  const smoke = chimney(k, B, cx, (r() - 0.5) * 0.4, 0.55, wallH - 0.5, top, r() < 0.55, lot.seed % 991);
  if (o.occupied) k.smoke.push([B.wx(smoke[0], smoke[2]), B.oy + smoke[1], B.wz(smoke[0], smoke[2]), 0.7 + r() * 0.6]);

  // the heap of snow along the eaves that shed
  eaveBanks(k, B, bw, bd, roof, roofSpec);

  // the side wing: a lower, shallower volume against one gable, its roof running into the main gable
  if (wing) {
    const ww = wing.w + 0.06;
    const wd = Math.max(4, bd - 0.8 - r() * 0.8);
    const wH = 2.55;
    const W = B.child(wing.side * (bw / 2 + ww / 2 - 0.06), 0, -(bd - wd) / 2, 0);
    const wWalls = wallFrames(W, ww, wd);
    const outer = wing.side > 0 ? 1 : 3;
    const gy = Math.min(lot.yMin, k.h(W.ox, W.oz)) - lot.y;
    k.plinth(W, ww + 0.08, wd + 0.08, 0.02, gy, look.seed);
    for (const i of [0, 2, outer]) k.wall(wWalls[i], 0, wH, look.st, look.variant, look.tint, look.seed);
    cornerBoards(k, W, ww, wd, 0, wH, look.seed);
    windowRow(k, wWalls[0], o, 0.9, 0.9, 1.15, 1, { pool: 0.15, ground: wallGround(wWalls[0]) });
    windowRow(k, wWalls[outer], o, 0.9, 0.9, 1.15, wd > 5.5 ? 2 : 1, { prob: 0.8 });
    windowRow(k, wWalls[2], o, 0.9, 0.9, 1.15, 1, { prob: 0.5 });
    gableRoof(k, W, {
      ...roofSpec,
      w: ww,
      d: wd,
      y: wH,
      pitch: Math.min(1.0, pitch),
      eave: 0.35,
      verge: 0.3,
      gable: look,
      closed: wing.side > 0 ? '-x' : '+x',
      slid: [0, 0],
      snow: roofSpec.snow * 0.95,
      seed: roofSpec.seed + 23,
    });
  }

  // life around the house: a picket fence along the front yard, firewood under the eaves, skis, a kick-sled
  // the door and its outward normal in the lot's frame (x along the frontage, z toward the lane)
  const lux = lot.fz;
  const luz = -lot.fx;
  const dLx = (doorAt[0] - lot.x) * lux + (doorAt[1] - lot.z) * luz;
  const dLz = (doorAt[0] - lot.x) * lot.fx + (doorAt[1] - lot.z) * lot.fz;
  const oLx = doorOut[0] * lux + doorOut[1] * luz;
  const oLz = doorOut[0] * lot.fx + doorOut[1] * lot.fz;
  const toWorld = (x: number, z: number): [number, number] => [lot.x + lux * x + lot.fx * z, lot.z + luz * x + lot.fz * z];
  const frontDoor = oLz > 0.7;
  const hasFence = lot.obb.hz * 2 - lot.d > 2.2 && r() < 0.4;
  const zF = lot.d / 2 + Math.max(0.8, (lot.obb.hz * 2 - lot.d) * 0.35);
  if (oLz > -0.3) {
    // out of the door, round the corner if it opens to the side, then on toward the lane
    const pts: [number, number][] = [doorAt];
    if (frontDoor) pts.push(toWorld(dLx, Math.max(dLz + 1.2, zF + 1.0)));
    else {
      const mx = dLx + oLx * 1.3;
      pts.push(toWorld(mx, dLz + oLz * 1.3), toWorld(mx, Math.max(lot.d / 2 + 1.2, zF + 1.0)));
    }
    doors.push({ pts, lane: lot.lane, lot });
  }
  if (hasFence) {
    const x0 = -lot.w / 2 - 0.8;
    const x1 = lot.w / 2 + 0.8;
    const gate = frontDoor ? Math.max(x0 + 1, Math.min(x1 - 1, dLx)) : (r() - 0.5) * lot.w * 0.4;
    const P = (x: number): [number, number] => [F.wx(x, zF), F.wz(x, zF)];
    pickets(k, [P(x0), P(gate - 0.6)], groundAt);
    pickets(k, [P(gate + 0.6), P(x1)], groundAt);
  }
  if (r() < 0.45) {
    const wi = r() < 0.5 ? 1 : 3;
    const wf = walls[wi];
    const L = Math.min(wf.L - 1.2, 2 + r() * 2);
    const x0 = (wf.L - L) / 2;
    const Fa = k.facade;
    Fa.frame = wf.f;
    k.style(Fa, STYLE.woodpile, 0, 0, look.seed);
    Fa.setColor([1, 1, 1]);
    const gy = groundAt(wf.f.wx(wf.L / 2, 0.3), wf.f.wz(wf.L / 2, 0.3)) - lot.y;
    const hh = 1.1 + r() * 0.4;
    Fa.box(x0 + L / 2, gy + hh / 2, 0.3, L, hh, 0.55, 'y', 0);
    k.snow.frame = wf.f;
    k.pillow(k.snow, x0 + L / 2, gy + hh, 0.3, L + 0.05, 0.6, 0.14, look.seed * 99, 4, 2);
  }
  if (r() < 0.25) {
    // a pair of skis and poles leaning by the porch
    const wf = pwf;
    const x = porchX + porchW / 2 + 0.5 + r() * 0.4;
    const gy = groundAt(wf.f.wx(x, 0.4), wf.f.wz(x, 0.4)) - lot.y;
    const N = k.nearFacade;
    N.frame = wf.f;
    k.style(N, STYLE.paint, 0, 0, look.seed);
    N.setColor(pick(r, [[0.5, 0.06, 0.03], [0.05, 0.12, 0.3], [0.55, 0.4, 0.2]] as Vec3[]));
    for (const dx of [0, 0.11]) N.beam([x + dx, gy - 0.1, 0.55], [x + dx + 0.04, gy + 1.85, 0.08], 0.07, 0.015);
    N.setColor([0.08, 0.08, 0.08]);
    for (const dx of [0.3, 0.38]) N.beam([x + dx, gy - 0.1, 0.5], [x + dx, gy + 1.45, 0.1], 0.015, 0.015);
  }
  if (r() < 0.18) {
    const wf = pwf;
    const x = porchX - porchW / 2 - 1.2;
    kickSled(k, wf.f.wx(x, 1.6), wf.f.wz(x, 1.6), Math.atan2(wf.f.exx, wf.f.exz) + (r() - 0.5) * 0.5, r);
  }

  const H = roof.ridgeY + 0.6;
  return {
    kind: 'house',
    x: lot.x,
    z: lot.z,
    y: lot.y,
    h: H,
    w: lot.w,
    d: lot.d,
    yaw: Math.atan2(lot.fx, lot.fz),
    desc: `${kind === 'one' ? 'single-storey' : kind === 'oneHalf' ? 'storey-and-a-half' : 'two-storey'} house in ${look.name}${hasArk ? ' with a cross gable' : ''}`,
  };
}

/** the ridge of snow that slid off the roof, along the drip line of each eave */
function eaveBanks(k: Kit, B: Frame, w: number, d: number, roof: RoofInfo, spec: RoofSpec): void {
  const slid = spec.slid ?? [0, 0];
  for (const [si, sd] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const big = slid[si] > 0.05;
    const hgt = big ? 0.7 + slid[si] * 0.9 : 0.35;
    const out = d / 2 + roof.eaveOut + 0.15;
    const pts: [number, number][] = [];
    const n = Math.max(3, Math.ceil(w / 1.2));
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 - 0.2 + ((w + 0.4) * i) / n;
      pts.push([B.wx(x, out * sd), B.wz(x, out * sd)]);
    }
    k.bank(k.snow, pts, big ? 2.0 : 1.3, hgt, spec.seed + si * 31);
  }
}

/* ------------------------------------------------------------------ */
/* rorbuer                                                            */
/* ------------------------------------------------------------------ */

export function buildRorbu(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  // B: ridge along the length; +x end faces the water (lot front)
  const paint = r() < 0.86 ? 'red' : r() < 0.6 ? 'ochre' : 'white';
  const look = lookFor(r, paint, r());
  look.st = STYLE.panel;
  const o: Occupants = { occupied: r() < 0.92, seed: r(), warmth: 0.5 + r() * 0.4, r };
  const wallH = 2.55 + r() * 0.5;
  const pitch = 0.85 + r() * 0.2;

  // stilts: a grid of timber piles down to the rocks or into the sea, braced
  const Fa = k.facade;
  Fa.frame = B;
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.16, 0.14, 0.12]);
  const nx = Math.max(2, Math.round(bw / 2.3));
  const nz = Math.max(2, Math.round(bd / 2.4));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = -bw / 2 + 0.15 + ((bw - 0.3) * i) / nx;
      const z = -bd / 2 + 0.15 + ((bd - 0.3) * j) / nz;
      const g = k.h(B.wx(x, z), B.wz(x, z));
      const bottom = Math.max(-6, g - 0.3) - B.oy;
      if (bottom > -0.25) continue;
      Fa.box(x, bottom / 2, z, 0.24, -bottom, 0.24, 'y', 0);
    }
  }
  // cross beams under the floor
  for (let i = 0; i <= nx; i++) {
    const x = -bw / 2 + 0.15 + ((bw - 0.3) * i) / nx;
    Fa.box(x, -0.2, 0, 0.2, 0.25, bd, '');
  }
  // floor frame
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.2, 0.17, 0.14]);
  Fa.box(0, -0.06, 0, bw + 0.1, 0.16, bd + 0.1, '');

  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);

  // the water gable: a door onto a landing, a window beside it, a window in the gable
  const water = walls[1];
  door(k, water, water.L * 0.28 - 0.47, 0, o, TRIM);
  const g1 = glowFor(o, GLOW.sash);
  k.opening(water, water.L * 0.66 - 0.45, 0.95, 0.9, 1.15, GLOW.sash, TRIM, g1, { trim: TRIM, pool: 0.12, ground: 0.05 });
  const g2 = glowFor(o, GLOW.attic, 0.5);
  k.opening(water, water.L / 2 - 0.4, wallH + 0.35, 0.8, 0.85, GLOW.attic, TRIM, g2, { trim: TRIM });
  doorLamp(k, water, water.L * 0.28 + 0.75, 2.05, o, 0.0);
  // landing with a railing over the water
  {
    const L = B.child(bw / 2 + 0.9, 0, 0, 0);
    Fa.frame = L;
    k.style(Fa, STYLE.timber, 0, 0, look.seed);
    Fa.setColor([0.3, 0.27, 0.23]);
    Fa.box(0, -0.06, 0, 1.8, 0.12, bd * 0.9, '');
    k.style(Fa, STYLE.paint, 0, 0, look.seed);
    Fa.setColor(TRIM);
    Fa.box(0.85, 0.95, 0, 0.06, 0.06, bd * 0.9, '');
    for (let z = -bd * 0.45; z <= bd * 0.45 + 0.01; z += bd * 0.15) Fa.box(0.85, 0.48, z, 0.05, 0.95, 0.05, 'y');
    Fa.box(0, 0.95, bd * 0.45, 1.75, 0.06, 0.06, '');
    Fa.box(0, 0.95, -bd * 0.45, 1.75, 0.06, 0.06, '');
    k.style(Fa, STYLE.timber, 0, 0, look.seed);
    Fa.setColor([0.16, 0.14, 0.12]);
    for (const z of [-bd * 0.42, bd * 0.42]) Fa.box(0.7, -3.1, z, 0.22, 6, 0.22, 'y');
    k.snow.frame = L;
    k.pillow(k.snow, 0, 0.0, 0, 1.7, bd * 0.85, 0.22, lot.seed, 4, 6);
    // a ladder down to the boats
    Fa.frame = L;
    k.style(Fa, STYLE.timber, 0, 0, look.seed);
    Fa.setColor([0.25, 0.22, 0.2]);
    for (const z of [-0.25, 0.25]) Fa.box(0.92, -1.4, z + bd * 0.2, 0.06, 2.8, 0.06, 'y');
    for (let y = -2.6; y < 0; y += 0.3) Fa.box(0.92, y, bd * 0.2, 0.05, 0.04, 0.5, '');
  }
  // long walls: two small windows each; the land gable: a door with steps
  for (const i of [0, 2]) windowRow(k, walls[i], o, 0.95, 0.85, 1.05, 2, {});
  const land = walls[3];
  door(k, land, land.L / 2 - 0.47, 0, o, TRIM, false);
  const gl = k.h(land.f.wx(land.L / 2, 1), land.f.wz(land.L / 2, 1));
  steps(k, land, land.L / 2, Math.max(0, lot.y - gl), 1.2, lot.seed);

  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch,
    eave: 0.35,
    verge: 0.3,
    cover: pick(r, [ROOFS[0], ROOFS[1], ROOFS[2]]),
    coverStyle: STYLE.roofMetal,
    trim: r() < 0.7 ? TRIM : look.tint,
    soffit: SOFFIT,
    gable: look,
    snow: snowDepth(r, pitch) * 0.9,
    icicles: o.occupied ? 0.55 : 0.25,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  // a stove pipe
  const N = k.facade;
  N.frame = B;
  k.style(N, STYLE.paint, 0, 0, look.seed);
  N.setColor([0.04, 0.04, 0.045]);
  const px = -bw * 0.2;
  const pz = bd * 0.18;
  const ptop = roof.topAt(px, pz) + 0.6;
  N.cylinder(px, wallH, pz, 0.09, 0.09, ptop - wallH, 8, false);
  N.cylinder(px, ptop, pz, 0.16, 0.02, 0.14, 8, true);
  if (o.occupied) k.smoke.push([B.wx(px, pz), B.oy + ptop + 0.2, B.wz(px, pz), 0.5]);
  return { kind: 'rorbu', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.5, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: `rorbu in ${look.name} on timber stilts` };
}

/* ------------------------------------------------------------------ */
/* boathouses                                                         */
/* ------------------------------------------------------------------ */

export function buildNaust(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const paint = r() < 0.6 ? 'tar' : r() < 0.6 ? 'red' : 'silver';
  const tint = jitter(PAINT[paint], r, 0.08);
  const seed = r();
  const wallH = 2.3 + r() * 0.3;
  const pitch = 0.75 + r() * 0.15;
  // dry-stone foundation following the beach
  const yG = lot.yMin - lot.y;
  k.plinth(B, bw + 0.2, bd + 0.2, 0.0, yG, seed, true);
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, STYLE.panel, 1, tint, seed);
  // the big double door on the sea gable
  const sea = walls[1];
  const F = k.facade;
  F.frame = sea.f;
  k.style(F, STYLE.panel, 1, 0, seed);
  F.setColor(jitter(tint, r, 0.15));
  const dw = Math.min(sea.L - 1.0, 3.4);
  F.box(sea.L / 2, 1.3, 0.05, dw, 2.6, 0.08, 'z');
  k.style(F, STYLE.timber, 0, 0, seed);
  F.setColor([0.2, 0.18, 0.16]);
  F.box(sea.L / 2, 1.3, 0.1, 0.06, 2.6, 0.04, 'z');
  for (const y of [0.5, 2.1]) F.box(sea.L / 2, y, 0.11, dw, 0.12, 0.04, 'z');
  // slipway: two rails and cross planks from the door down into the water
  const S = B.child(bw / 2 + 3.5, 0, 0, 0);
  F.frame = S;
  k.style(F, STYLE.timber, 0, 0, seed);
  F.setColor([0.12, 0.11, 0.1]);
  const g0 = k.h(S.wx(-3.5, 0), S.wz(-3.5, 0)) - S.oy;
  const g1 = k.h(S.wx(3.5, 0), S.wz(3.5, 0)) - S.oy;
  for (const z of [-0.9, 0.9]) F.beam([-3.5, Math.max(g0, -1.5) + 0.12, z], [3.5, Math.min(g1, -0.3) - 0.1, z], 0.18, 0.16);
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch,
    eave: 0.3,
    verge: 0.25,
    cover: pick(r, [ROOFS[0], ROOFS[2], [0.12, 0.09, 0.06]]),
    coverStyle: r() < 0.5 ? STYLE.roofTile : STYLE.roofMetal,
    trim: paint === 'tar' ? [0.04, 0.035, 0.03] : TRIM,
    soffit: [0.05, 0.045, 0.04],
    gable: { st: STYLE.panel, variant: 1, tint, seed },
    snow: snowDepth(r, pitch) * 1.1,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  eaveBanks(k, B, bw, bd, roof, spec);
  return { kind: 'naust', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.4, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: `boathouse in ${paint === 'tar' ? 'pine-tarred boards' : paint === 'red' ? 'red boards' : 'silvered boards'}` };
}

/* ------------------------------------------------------------------ */
/* stabbur and woodsheds                                              */
/* ------------------------------------------------------------------ */

export function buildStabbur(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const seed = r();
  const logTint = jitter(r() < 0.5 ? [0.07, 0.04, 0.025] : [0.16, 0.05, 0.03], r, 0.15);
  const postH = 0.85;
  const yG = lot.yMin - lot.y;
  // posts on flat cap stones
  const Fa = k.facade;
  Fa.frame = B;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = (sx * (bw - 0.5)) / 2;
      const z = (sz * (bd - 0.5)) / 2;
      const g = k.h(B.wx(x, z), B.wz(x, z)) - B.oy;
      k.style(Fa, STYLE.timber, 0, 0, seed);
      Fa.setColor([0.18, 0.15, 0.12]);
      Fa.box(x, (g + postH) / 2, z, 0.26, postH - g, 0.26, 'y', 0);
      k.stone.frame = B;
      k.stone.setColor([0.75, 0.75, 0.72]);
      k.stone.box(x, postH + 0.04, z, 0.5, 0.08, 0.5, '');
    }
  }
  const y1 = postH + 0.08;
  const walls = wallFrames(B.child(0, y1, 0, 0), bw, bd);
  const h1 = 2.0;
  for (const wf of walls) k.wall(wf, 0, h1, STYLE.log, 0, logTint, seed);
  // the overhanging upper storey (svalgang)
  const ow = bw + 0.6;
  const od = bd + 0.6;
  const U = B.child(0, y1 + h1, 0, 0);
  const uWalls = wallFrames(U, ow, od);
  const h2 = 1.35;
  for (const wf of uWalls) k.wall(wf, 0, h2, STYLE.panel, 1, jitter(logTint, r, 0.2), seed);
  Fa.frame = U;
  k.style(Fa, STYLE.timber, 0, 0, seed);
  Fa.setColor([0.1, 0.07, 0.05]);
  Fa.box(0, -0.06, 0, ow + 0.05, 0.12, od + 0.05, 'Y');
  // a small door with a free-standing stair
  const front = walls[0];
  door(k, front, front.L / 2 - 0.4, 0, { occupied: false, seed, warmth: 0.5, r }, [0.08, 0.06, 0.04], false);
  const S = k.stone;
  S.frame = front.f;
  S.setColor([0.78, 0.78, 0.75]);
  const rise = y1 - yG;
  const n = Math.max(2, Math.round(rise / 0.22));
  for (let i = 0; i < n; i++) S.box(front.L / 2, y1 - 0.15 - (rise * (i + 1)) / n + rise / n / 2, 0.45 + i * 0.3, 0.9, rise / n, 0.3, '', 0);
  const spec: RoofSpec = {
    w: ow,
    d: od,
    y: y1 + h1 + h2,
    pitch: 1.0,
    eave: 0.35,
    verge: 0.3,
    cover: [0.05, 0.045, 0.04],
    coverStyle: STYLE.roofTile,
    trim: [0.08, 0.06, 0.04],
    soffit: [0.08, 0.06, 0.04],
    gable: { st: STYLE.panel, variant: 1, tint: logTint, seed },
    snow: 0.38,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  return { kind: 'stabbur', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.3, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'stabbur: a log storehouse raised on posts against damp and mice' };
}

export function buildShed(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const seed = r();
  const paint = pick(r, ['red', 'red', 'silver', 'tar', 'ochre']);
  const tint = jitter(PAINT[paint], r, 0.1);
  const H = 2.1;
  const yG = lot.yMin - lot.y;
  k.plinth(B, bw + 0.06, bd + 0.06, -0.1, yG, seed);
  const walls = wallFrames(B, bw, bd);
  for (const i of [1, 2, 3]) k.wall(walls[i], 0, H, STYLE.panel, 0, tint, seed);
  // the open front, stacked full of firewood
  const Fa = k.facade;
  Fa.frame = walls[0].f;
  k.style(Fa, STYLE.woodpile, 0, 0, seed);
  Fa.setColor([1, 1, 1]);
  Fa.box(bw / 2, 0.95, -0.25, bw - 0.2, 1.9, 0.1, 'z');
  k.style(Fa, STYLE.timber, 0, 0, seed);
  Fa.setColor([0.2, 0.17, 0.14]);
  for (const x of [0.06, bw - 0.06]) Fa.box(x, H / 2, -0.06, 0.12, H, 0.12, 'y');
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: H,
    pitch: 0.75,
    eave: 0.35,
    verge: 0.25,
    cover: pick(r, ROOFS),
    coverStyle: STYLE.roofMetal,
    trim: paint === 'tar' ? tint : TRIM,
    soffit: [0.12, 0.1, 0.08],
    gable: { st: STYLE.panel, variant: 0, tint, seed },
    snow: 0.36,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  return { kind: 'shed', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.2, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'woodshed stacked with birch logs for the winter' };
}

/* ------------------------------------------------------------------ */
/* the general store                                                  */
/* ------------------------------------------------------------------ */

export interface SignSpot {
  /** sign board center (world), facing (unit xz), size */
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  w: number;
  h: number;
  text: string;
  sub: string;
  light: boolean;
}

export function buildStore(k: Kit, lot: Lot, signs: SignSpot[]): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const look: Look = { st: STYLE.clap, variant: 1, tint: PAINT.white, seed: r(), paint: 'white', name: 'white weatherboard' };
  const o: Occupants = { occupied: true, seed: 0.9, warmth: 0.75, r };
  const wallH = 5.6;
  const yG = lot.yMin - lot.y;
  k.plinth(B, bw + 0.08, bd + 0.08, 0.02, yG, look.seed);
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);
  band(k, B, bw, bd, 2.95, 0.12, look.seed);
  const front = walls[0];
  // two shop windows and a glazed double door in the middle
  const shopG: GlowParams = { threshold: 0.04, warmth: 0.85, intensity: 0.62, seed: 0.37, sched: SCHED.work };
  const dw = 1.6;
  const mid = front.L / 2;
  const span = (front.L - 1.2 - dw - 0.6) / 2;
  for (const x0 of [0.6, mid + dw / 2 + 0.3]) {
    k.opening(front, x0, 0.55, span, 1.85, GLOW.shop, [0.18, 0.2, 0.22], shopG, { trim: TRIM, pool: 0.5, ground: lot.yMin, minPx: 3, gain: 2 });
  }
  const F = k.facade;
  F.frame = front.f;
  k.style(F, STYLE.paint, 0, 0, look.seed);
  F.setColor([0.18, 0.2, 0.22]);
  F.box(mid, 1.15, 0.03, dw + 0.16, 2.3, 0.06, 'z');
  k.opening(front, mid - dw / 2 + 0.06, 0.08, dw - 0.12, 2.05, GLOW.shop, [0.18, 0.2, 0.22], { ...shopG, intensity: 0.45 }, { recess: 0.07, light: false });
  F.setColor(TRIM);
  F.box(mid, 2.45, 0.08, dw + 0.5, 0.12, 0.16, 'z');
  const gFront = k.h(front.f.wx(mid, 2.2), front.f.wz(mid, 2.2));
  steps(k, front, mid, Math.max(0, lot.y - gFront), 2.4, lot.seed);
  {
    // the bench under the shop window, where the village news gets made; snow brushed off half the seat
    const bx = 2.6;
    const gy = Math.min(0, k.h(front.f.wx(bx, 0.45), front.f.wz(bx, 0.45)) - lot.y);
    const N = k.nearFacade;
    N.frame = front.f;
    k.style(N, STYLE.timber, 0, 0, 3);
    N.setColor([0.5, 0.36, 0.24]);
    for (let s = 0; s < 3; s++) N.box(bx, gy + 0.45, 0.24 + s * 0.13, 1.8, 0.035, 0.1, '');
    for (const y of [0.62, 0.78]) N.box(bx, gy + y, 0.1, 1.8, 0.09, 0.03, '');
    N.setColor([0.08, 0.08, 0.09]);
    for (const x of [bx - 0.78, bx + 0.78]) {
      N.box(x, gy + 0.22, 0.4, 0.05, 0.45, 0.05, 'Y');
      N.box(x, gy + 0.5, 0.08, 0.05, 0.85, 0.05, 'Y');
      N.box(x, gy + 0.43, 0.24, 0.05, 0.035, 0.36, '');
    }
    k.nearSnow.frame = front.f;
    k.pillow(k.nearSnow, bx + 0.45, gy + 0.47, 0.37, 0.85, 0.38, 0.05, 41, 3, 1);
  }
  // the sign board between the shop windows and the flat upstairs, lit by two gooseneck lamps
  signs.push({ x: front.f.wx(mid, 0.07), y: lot.y + 3.05, z: front.f.wz(mid, 0.07), fx: front.f.ezx, fz: front.f.ezz, w: Math.min(front.L - 1.4, 7.0), h: 0.72, text: 'LYSVIK HANDEL', sub: 'Dagligvarer · Post · Fiskeutstyr', light: true });
  for (const x of [mid - 2.2, mid + 2.2]) {
    const g: GlowParams = { threshold: 0.04, warmth: 0.7, intensity: 1.4, seed: 0.5, sched: SCHED.work };
    F.frame = front.f;
    k.style(F, STYLE.paint, 0, 0, 1);
    F.setColor([0.05, 0.05, 0.05]);
    F.beam([x, 3.62, 0.02], [x, 3.66, 0.5], 0.035, 0.035);
    F.beam([x, 3.66, 0.5], [x, 3.55, 0.62], 0.035, 0.035);
    k.lampGlass(k.glow, front.f, x, 3.52, 0.62, 0.2, 0.06, 0.14, g, { size: 0.3, minPx: 1.6, gain: 1.4 }, 'Y');
  }
  k.groundPool(front.f.wx(mid, 2.5), front.f.wz(mid, 2.5), 5, { threshold: 0.04, warmth: 0.8, intensity: 1, seed: 0.3, sched: SCHED.work }, 0.45);
  // the flat upstairs: sash windows all round
  for (let i = 0; i < 4; i++) {
    const wf = walls[i];
    const n = Math.max(1, Math.round((wf.L - 1.2) / 2.4));
    windowRow(k, wf, o, 3.75, 0.98, 1.15, n, {});
    if (i > 0) windowRow(k, wf, o, 0.9, 0.98, 1.25, Math.max(1, n - 1), { prob: 0.8, pool: 0.12, ground: () => lot.yMin });
  }
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch: 0.7,
    eave: 0.5,
    verge: 0.35,
    cover: ROOFS[0],
    coverStyle: STYLE.roofMetal,
    trim: TRIM,
    soffit: SOFFIT,
    gable: look,
    snow: 0.36,
    icicles: 0.6,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  const sm = chimney(k, B, bw * 0.22, 0, 0.6, wallH - 0.5, roof.ridgeY + 0.9, true, 77);
  k.smoke.push([B.wx(sm[0], sm[2]), B.oy + sm[1], B.wz(sm[0], sm[2]), 1]);
  // a flagpole with a long red pennant
  flagpole(k, B.wx(bw / 2 + 2.2, bd / 2 + 1.2), B.wz(bw / 2 + 2.2, bd / 2 + 1.2), r);
  return { kind: 'store', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.6, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'the general store', name: 'Lysvik Handel' };
}

/** a white flagpole with a long red pennant streaming in the wind */
export function flagpole(k: Kit, x: number, z: number, r: () => number): void {
  const y = k.h(x, z);
  const F = k.facade;
  F.frame = IDENTITY;
  k.style(F, STYLE.paint, 0, 0, 0.3);
  F.setColor(TRIM);
  F.cylinder(x, y - 0.3, z, 0.07, 0.04, 9.3, 8, false);
  F.cylinder(x, y + 9.0, z, 0.08, 0.08, 0.1, 8, true);
  // the pennant: a long tapering strip, red with a white middle stripe
  const wind = Math.atan2(0.53, 0.85) + (r() - 0.5) * 0.3;
  const dx = Math.cos(wind);
  const dz = Math.sin(wind);
  const N = k.nearFacade;
  N.frame = IDENTITY;
  k.style(N, STYLE.paint, 0, 0, 0.2);
  const L = 4.6;
  const segs = 8;
  for (const [col, w0, off] of [
    [[0.42, 0.02, 0.02] as Vec3, 0.34, 0],
    [[0.8, 0.8, 0.78] as Vec3, 0.1, 0.003],
  ] as const) {
    N.setColor(col);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const sag = (t: number) => -0.5 * t * t - 0.12 * Math.sin(t * 7);
      const wv = (t: number) => 0.25 * Math.sin(t * 5.5 + 1) * t;
      const P = (t: number, s: number): Vec3 => [x + dx * L * t - dz * wv(t) - dz * off, y + 8.95 + sag(t) + s * w0 * (1 - t * 0.85), z + dz * L * t + dx * wv(t) + dx * off];
      const a = P(t0, -0.5);
      const b = P(t1, -0.5);
      const c = P(t1, 0.5);
      const d = P(t0, 0.5);
      N.polyN([a, b, c, d], null, [-dz, 0, dx]);
      N.polyN([d, c, b, a], null, [dz, 0, -dx]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* the fish landing and the warehouse over the water                  */
/* ------------------------------------------------------------------ */

function piles(k: Kit, B: Frame, w: number, d: number, spacing: number, seed: number, b: GeoBuilder = k.facade): void {
  b.frame = B;
  k.style(b, STYLE.timber, 0, 0, seed);
  b.setColor([0.13, 0.12, 0.1]);
  const nx = Math.max(1, Math.round(w / spacing));
  const nz = Math.max(1, Math.round(d / spacing));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = -w / 2 + (w * i) / nx;
      const z = -d / 2 + (d * j) / nz;
      const g = k.h(B.wx(x, z), B.wz(x, z)) - B.oy;
      if (g > -0.3) continue;
      const bottom = Math.max(-8, g - 0.5);
      b.box(x, bottom / 2 - 0.1, z, 0.32, -bottom, 0.32, 'y', 0);
    }
  }
}

export function buildPlant(k: Kit, lot: Lot, signs: SignSpot[]): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  // B: ridge along the length (local x), +x gable toward the open water
  const tint = jitter(PAINT.ochre, r, 0.05);
  const look: Look = { st: STYLE.panel, variant: 1, tint, seed: r(), paint: 'ochre', name: 'ochre boards' };
  const o: Occupants = { occupied: true, seed: 0.78, warmth: 0.6, r };
  const wallH = 6.4;
  piles(k, B, bw, bd + 1, 2.6, look.seed);
  const Fa = k.facade;
  Fa.frame = B;
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.2, 0.18, 0.15]);
  Fa.box(0, -0.15, 0, bw + 2.4, 0.3, bd + 2.4, '');
  k.snow.frame = B;
  k.pillow(k.snow, 0, 0.0, bd / 2 + 0.65, bw + 2.2, 1.2, 0.18, 51, 8, 2);
  k.pillow(k.snow, 0, 0.0, -bd / 2 - 0.65, bw + 2.2, 1.2, 0.18, 52, 8, 2);
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);
  band(k, B, bw, bd, 3.15, 0.12, look.seed);
  // long walls: rows of factory windows on both floors, a loading door onto the quay side
  for (const i of [0, 2]) {
    const wf = walls[i];
    const n = Math.max(2, Math.round(wf.L / 3));
    for (const y0 of [1.1, 4.0]) windowRow(k, wf, o, y0, 1.4, 1.3, n, { kind: GLOW.works, skip: i === 0 && y0 < 2 ? [wf.L * 0.55, wf.L * 0.55 + 3.2] : undefined, prob: 0.9 });
  }
  // the land gable: a door and windows toward the quay and the village
  {
    const wf = walls[3];
    door(k, wf, wf.L * 0.3 - 0.47, 0, o, [0.18, 0.2, 0.22]);
    windowRow(k, wf, o, 1.1, 1.2, 1.3, 2, { kind: GLOW.works, skip: [wf.L * 0.3 - 0.6, wf.L * 0.3 + 0.6] });
    windowRow(k, wf, o, 4.0, 1.2, 1.3, 2, { kind: GLOW.works });
  }
  // the sea gable: loading doors one above the other and a hoist beam under the apex
  const sea = walls[1];
  for (const [y0, h] of [
    [0.0, 2.8],
    [3.4, 2.4],
  ] as const) {
    Fa.frame = sea.f;
    k.style(Fa, STYLE.panel, 1, 0, look.seed);
    Fa.setColor(jitter(tint, r, 0.1));
    Fa.box(sea.L / 2, y0 + h / 2, 0.05, 2.6, h, 0.08, 'z');
    k.style(Fa, STYLE.paint, 0, 0, look.seed);
    Fa.setColor(TRIM);
    Fa.box(sea.L / 2 - 1.36, y0 + h / 2, 0.08, 0.12, h + 0.1, 0.08, 'z');
    Fa.box(sea.L / 2 + 1.36, y0 + h / 2, 0.08, 0.12, h + 0.1, 0.08, 'z');
    Fa.box(sea.L / 2, y0 + h + 0.06, 0.08, 2.84, 0.12, 0.08, 'z');
  }
  // the harbour side loading door, open and lit
  const quaySide = walls[0];
  const workG: GlowParams = { threshold: 0.03, warmth: 0.5, intensity: 0.7, seed: 0.61, sched: SCHED.work };
  k.opening(quaySide, quaySide.L * 0.55, 0.05, 3.2, 2.8, GLOW.works, [0.2, 0.2, 0.2], workG, { trim: TRIM, pool: 0.4, ground: lot.y, minPx: 3 });
  // floodlights under the eaves on the quay side
  for (const t of [0.25, 0.75]) {
    const x = quaySide.L * t;
    const g: GlowParams = { threshold: 0.03, warmth: 0.45, intensity: 2.2, seed: t, sched: SCHED.work };
    k.lampGlass(k.glow, quaySide.f, x, wallH - 0.4, 0.25, 0.4, 0.25, 0.3, g, { size: 0.5, minPx: 2.5, gain: 1.6 });
    k.groundPool(quaySide.f.wx(x, 4.5), quaySide.f.wz(x, 4.5), 6, g, 0.6, lot.y);
    k.lamps.push([quaySide.f.wx(x, 0.5), lot.y + wallH - 0.4, quaySide.f.wz(x, 0.5), 9]);
  }
  signs.push({ x: quaySide.f.wx(quaySide.L * 0.3, 0.07), y: lot.y + 3.9, z: quaySide.f.wz(quaySide.L * 0.3, 0.07), fx: quaySide.f.ezx, fz: quaySide.f.ezz, w: 5.2, h: 0.85, text: 'LYSVIK FISK', sub: 'Fiskemottak', light: false });
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch: 0.62,
    eave: 0.5,
    verge: 0.4,
    cover: ROOFS[1],
    coverStyle: STYLE.roofMetal,
    trim: TRIM,
    soffit: SOFFIT,
    gable: look,
    snow: 0.4,
    icicles: 0.5,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  // the hoist beam out of the sea gable
  Fa.frame = B;
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.15, 0.13, 0.11]);
  Fa.box(bw / 2 + 0.6, roof.ridgeY - 0.6, 0, 1.6, 0.25, 0.25, '');
  Fa.beam([bw / 2 + 1.3, roof.ridgeY - 0.75, 0], [bw / 2 + 1.3, roof.ridgeY - 1.9, 0], 0.03, 0.03);
  return { kind: 'plant', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.5, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'fish landing on piles over the harbour', name: 'Lysvik Fisk' };
}

export function buildWarehouse(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const tint = jitter(PAINT.red, r, 0.05);
  const look: Look = { st: STYLE.panel, variant: 0, tint, seed: r(), paint: 'red', name: 'red board-and-batten' };
  const o: Occupants = { occupied: r() < 0.5, seed: 0.3, warmth: 0.5, r };
  const wallH = 7.2;
  piles(k, B, bw, bd + 1, 2.4, look.seed);
  const Fa = k.facade;
  Fa.frame = B;
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.2, 0.18, 0.15]);
  Fa.box(0, -0.15, 0, bw + 1.6, 0.3, bd + 1.6, '');
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);
  // loading doors stacked up the sea gable, white-framed, and up the quay gable
  for (const wi of [1, 3]) {
    const wf = walls[wi];
    for (const y0 of [0.1, 3.0, 5.6]) {
      if (y0 > wallH) continue;
      const h = y0 < 1 ? 2.5 : 1.9;
      Fa.frame = wf.f;
      k.style(Fa, STYLE.panel, 1, 0, look.seed);
      Fa.setColor(jitter(tint, r, 0.12));
      Fa.box(wf.L / 2, y0 + h / 2, 0.05, 1.8, h, 0.08, 'z');
      k.style(Fa, STYLE.paint, 0, 0, look.seed);
      Fa.setColor(TRIM);
      Fa.box(wf.L / 2 - 0.96, y0 + h / 2, 0.09, 0.12, h + 0.1, 0.08, 'z');
      Fa.box(wf.L / 2 + 0.96, y0 + h / 2, 0.09, 0.12, h + 0.1, 0.08, 'z');
      Fa.box(wf.L / 2, y0 + h + 0.06, 0.09, 2.04, 0.12, 0.08, 'z');
      Fa.box(wf.L / 2, y0 + h / 2, 0.1, 0.06, h, 0.05, 'z');
    }
  }
  for (const i of [0, 2]) windowRow(k, walls[i], o, 3.4, 0.8, 0.9, Math.max(2, Math.round(walls[i].L / 4)), { kind: GLOW.attic, prob: 0.85 });
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch: 0.8,
    eave: 0.4,
    verge: 0.45,
    cover: ROOFS[0],
    coverStyle: STYLE.roofTile,
    trim: TRIM,
    soffit: SOFFIT,
    gable: look,
    snow: 0.42,
    icicles: 0.2,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  Fa.frame = B;
  k.style(Fa, STYLE.timber, 0, 0, look.seed);
  Fa.setColor([0.15, 0.13, 0.11]);
  Fa.box(bw / 2 + 0.7, roof.ridgeY - 0.55, 0, 1.8, 0.25, 0.25, '');
  Fa.beam([bw / 2 + 1.45, roof.ridgeY - 0.7, 0], [bw / 2 + 1.45, roof.ridgeY - 2.2, 0], 0.03, 0.03);
  return { kind: 'warehouse', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 0.5, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'warehouse on piles: salt, nets and lines on three lofts', name: 'Old warehouse' };
}

/* ------------------------------------------------------------------ */
/* the old school                                                     */
/* ------------------------------------------------------------------ */

export function buildSchool(k: Kit, lot: Lot): BuildingInfo {
  const r = mulberry32(lot.seed);
  const { B, bw, bd } = lotFrame(lot);
  const look: Look = { st: STYLE.clap, variant: 1, tint: PAINT.cream, seed: r(), paint: 'cream', name: 'cream weatherboard' };
  const o: Occupants = { occupied: true, seed: 0.55, warmth: 0.7, r };
  const wallH = 5.6;
  const yG = lot.yMin - lot.y;
  k.plinth(B, bw + 0.08, bd + 0.08, 0.02, yG, look.seed);
  const walls = wallFrames(B, bw, bd);
  for (const wf of walls) k.wall(wf, 0, wallH, look.st, look.variant, look.tint, look.seed);
  cornerBoards(k, B, bw, bd, 0, wallH, look.seed);
  band(k, B, bw, bd, 2.9, 0.12, look.seed);
  for (let i = 0; i < 4; i++) {
    const wf = walls[i];
    const n = Math.max(1, Math.round((wf.L - 1) / 2.1));
    const skip: [number, number] | undefined = i === 0 ? [wf.L / 2 - 1.2, wf.L / 2 + 1.2] : undefined;
    windowRow(k, wf, o, 0.95, 1.05, 1.45, n, { skip, pool: 0.12, ground: () => lot.yMin });
    windowRow(k, wf, o, 3.6, 1.05, 1.4, n, {});
  }
  const front = walls[0];
  door(k, front, front.L / 2 - 0.47, 0, o, [0.1, 0.18, 0.12]);
  doorLamp(k, front, front.L / 2 + 0.85, 2.1, o, lot.yMin);
  steps(k, front, front.L / 2, lot.y - lot.yMin, 1.6, lot.seed);
  const spec: RoofSpec = {
    w: bw,
    d: bd,
    y: wallH,
    pitch: 0.72,
    eave: 0.5,
    verge: 0.4,
    cover: ROOFS[3],
    coverStyle: STYLE.roofTile,
    trim: TRIM,
    soffit: SOFFIT,
    gable: look,
    snow: 0.4,
    icicles: 0.5,
    seed: lot.seed % 9973,
  };
  const roof = gableRoof(k, B, spec);
  // a little bell turret on the ridge
  const Fa = k.facade;
  Fa.frame = B;
  k.style(Fa, STYLE.paint, 0, 0, look.seed);
  Fa.setColor(TRIM);
  Fa.box(0, roof.ridgeY + 0.55, 0, 0.9, 1.1, 0.9, 'y');
  Fa.setColor([0.03, 0.03, 0.035]);
  Fa.cylinder(0, roof.ridgeY + 1.1, 0, 0.75, 0.02, 1.1, 4, true);
  const sm = chimney(k, B, -bw * 0.3, 0, 0.6, wallH - 0.5, roof.ridgeY + 0.8, true, 31);
  k.smoke.push([B.wx(sm[0], sm[2]), B.oy + sm[1], B.wz(sm[0], sm[2]), 0.8]);
  eaveBanks(k, B, bw, bd, roof, spec);
  return { kind: 'school', x: lot.x, z: lot.z, y: lot.y, h: roof.ridgeY + 2.2, w: lot.w, d: lot.d, yaw: Math.atan2(lot.fx, lot.fz), desc: 'the old school, now the village hall', name: 'The old school' };
}

/* ------------------------------------------------------------------ */
/* all of them                                                        */
/* ------------------------------------------------------------------ */

/**
 * The boardwalk along the water in front of each rorbu row: timber decking on
 * piles linking one landing to the next, a white rail on the sea side and
 * snow on the boards.
 */
function rorbuWalk(k: Kit, plan: VillagePlan): void {
  const rows = [plan.rorbuer.filter((l) => l.x < plan.quay.minX), plan.rorbuer.filter((l) => l.x > plan.quay.maxX)];
  const Fa = k.facade;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 0; i < row.length - 1; i++) {
      const A = row[i];
      const B = row[i + 1];
      // the landings sit 0.9 m out from each water gable, 0.9 of the house width long
      const za = A.z + A.fz * (A.d / 2 + 0.9);
      const zb = B.z + B.fz * (B.d / 2 + 0.9);
      const xa = A.x + (A.w * 0.9) / 2 - 0.05;
      const xb = B.x - (B.w * 0.9) / 2 + 0.05;
      if (xb - xa < 0.2 || xb - xa > 7) continue;
      const ya = A.y - 0.06;
      const yb = B.y - 0.06;
      const hw = 0.8;
      Fa.frame = IDENTITY;
      k.style(Fa, STYLE.timber, 0, 0, A.seed % 97);
      Fa.setColor([0.3, 0.27, 0.23]);
      const dir = Math.atan2(zb - za, xb - xa);
      const L = Math.hypot(xb - xa, zb - za);
      const F = Frame.fromAngle((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2, -dir);
      Fa.frame = F;
      Fa.beam([-L / 2, ya - (ya + yb) / 2, 0], [L / 2, yb - (ya + yb) / 2, 0], hw * 2, 0.12);
      // piles at both ends and a white rail on the sea side
      Fa.setColor([0.16, 0.14, 0.12]);
      for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) Fa.box(x, -3.1, -hw + 0.1, 0.2, 6, 0.2, 'y');
      k.style(Fa, STYLE.paint, 0, 0, 0.3);
      Fa.setColor(TRIM);
      Fa.beam([-L / 2, ya - (ya + yb) / 2 + 0.95, -hw + 0.03], [L / 2, yb - (ya + yb) / 2 + 0.95, -hw + 0.03], 0.06, 0.06);
      for (const t of [0.25, 0.5, 0.75]) {
        const x = -L / 2 + L * t;
        const y = ya + (yb - ya) * t - (ya + yb) / 2;
        Fa.box(x, y + 0.48, -hw + 0.03, 0.05, 0.95, 0.05, 'yY');
      }
      k.snow.frame = F;
      k.pillow(k.snow, 0, (ya + yb) / 2 - F.oy + 0.06, 0, L, hw * 1.8, 0.16, A.seed % 991, 4, 2);
    }
  }
}

export async function buildBuildings(k: Kit, plan: VillagePlan, signs: SignSpot[], doors: DoorPath[] = [], breathe: () => Promise<void> = async () => {}): Promise<BuildingInfo[]> {
  const out: BuildingInfo[] = [];
  // in slices, so the main thread can breathe between them
  for (let i = 0; i < plan.houses.length; i++) {
    out.push(buildCabin(k, plan.houses[i], plan, doors));
    if (i % 24 === 23) await breathe();
  }
  await breathe();
  for (const lot of plan.rorbuer) out.push(buildRorbu(k, lot));
  rorbuWalk(k, plan);
  for (const lot of plan.naust) out.push(buildNaust(k, lot));
  for (const lot of plan.stabbur) out.push(buildStabbur(k, lot));
  for (const lot of plan.sheds) out.push(buildShed(k, lot));
  out.push(buildStore(k, plan.store, signs));
  out.push(buildPlant(k, plan.plant, signs));
  out.push(buildWarehouse(k, plan.warehouse));
  if (plan.school) out.push(buildSchool(k, plan.school));
  return out;
}
