/**
 * Aurora Cabin's working drawings: every derived dimension of the building
 * (wall build-up, roof planes, overhangs, the cross-gable valley between the
 * cabin's north slope and the glass wing) in house-local metres, y = 0 at the
 * finished floor. Pure math; the builders in shell.ts, wing.ts and deck.ts
 * read everything from here so the parts always meet.
 */
import { HOUSE, HOUSE_OPENINGS, type HouseOpening, type HouseWall } from '../../world/layout';

export const C = HOUSE.cabin;
export const W = HOUSE.wing;
export const D = HOUSE.deck;

/** wall build-up: outer cladding face to inner panelling face */
export const WALL_T = 0.24;
/** ground level around the cabin (local y) */
export const GROUND = HOUSE.groundY - HOUSE.floorY;
/** fieldstone plinth: from below the snow to just under the floor */
export const PLINTH_BOT = GROUND - 0.25;
/** cladding laps down over the plinth to here */
export const CLAD_BOT = -0.1;

/* ------------------------------ cabin roof ------------------------------ */

/** half depth of the cabin (wall face to ridge line) */
export const C_HALF = (C.maxZ - C.minZ) / 2;
export const C_MIDZ = (C.maxZ + C.minZ) / 2;
/** rise per metre of the cabin roof */
export const KC = (C.ridgeH - C.wallH) / C_HALF;
/** roof build-up (rafters, boards, roofing), measured square to the slope */
export const C_ROOF_T = 0.3;
export const C_COS = 1 / Math.hypot(1, KC);
/** vertical thickness of the cabin roof slab */
export const C_DY = C_ROOF_T / C_COS;
/** eave overhang (horizontal, beyond the long walls) and rake overhang (beyond the gables) */
export const C_EAVE = 0.55;
export const C_RAKE = 0.45;
export const C_EAVE_Z = C_HALF + C_EAVE;
export const C_RAKE_X = C.maxX + C_RAKE;

/** underside of the cabin roof (ceiling line) at local z */
export function cabinUnder(z: number): number {
  return C.ridgeH - KC * Math.abs(z - C_MIDZ);
}
export function cabinTop(z: number): number {
  return cabinUnder(z) + C_DY;
}

/* ------------------------------- wing roof ------------------------------ */

export const W_CX = (W.minX + W.maxX) / 2;
export const W_HALF = (W.maxX - W.minX) / 2;
export const KW = (W.ridgeH - W.wallH) / W_HALF;
/** rafter depth of the glass roof (square to the slope) */
export const W_ROOF_T = 0.2;
export const W_COS = 1 / Math.hypot(1, KW);
export const W_DY = W_ROOF_T / W_COS;
/** glass roof eave overhang beyond the knee walls, and past the north gable */
export const W_EAVE = 0.3;
export const W_RAKE = 0.28;
export const W_EAVE_DX = W_HALF + W_EAVE;
export const W_NORTH = W.minZ - W_RAKE;

export function wingUnder(x: number): number {
  return W.ridgeH - KW * Math.abs(x - W_CX);
}
export function wingTop(x: number): number {
  return wingUnder(x) + W_DY;
}

/* --------------------------- the valley (notch) -------------------------- */

/**
 * The wing's roof runs south into the cabin's north slope. The cabin roof is
 * cut away wherever the wing's top surface is above the cabin's underside
 * (so no eave or fascia pokes into the glass room), and the wing's roof runs
 * south to that same line: south of it the cabin's slab sits wholly above the
 * wing. Along the cut the wing's roofing lies a little below the cabin's (a
 * valley gutter), and the snow fills it.
 */
/** |x - W_CX| where the wing's top equals height h */
const wingDxAt = (h: number) => (wingTop(W_CX) - h) / KW;
/** z (north half, negative) where the cabin's underside equals height h */
const cabinZUnder = (h: number) => C_MIDZ - (C.ridgeH - h) / KC;

/** the notch in the cabin's north slope: apex on the wing's ridge line, base on the cabin's eave line */
export const NOTCH = (() => {
  const eaveZ = C_MIDZ - C_EAVE_Z;
  const apexZ = cabinZUnder(wingTop(W_CX));
  const dx = wingDxAt(cabinUnder(eaveZ));
  // where the notch line crosses the cabin's north wall face
  const dxWall = wingDxAt(cabinUnder(C.minZ));
  return { apexZ, eaveZ, x0: W_CX - dx, x1: W_CX + dx, wallX0: W_CX - dxWall, wallX1: W_CX + dxWall };
})();

/* ------------------------------- openings ------------------------------- */

export interface WallFrame {
  wall: HouseWall;
  /** outer face plane: point on it and outward normal (x, z) */
  nx: number;
  nz: number;
  /** the face's coordinate along the wall maps to local x or z */
  axis: 'x' | 'z';
  /** outer face position on the normal axis */
  face: number;
}

export const WALLS: Record<HouseWall, WallFrame> = {
  south: { wall: 'south', nx: 0, nz: 1, axis: 'x', face: C.maxZ },
  north: { wall: 'north', nx: 0, nz: -1, axis: 'x', face: C.minZ },
  east: { wall: 'east', nx: 1, nz: 0, axis: 'z', face: C.maxX },
  west: { wall: 'west', nx: -1, nz: 0, axis: 'z', face: C.minX },
};

export const OPENINGS: HouseOpening[] = HOUSE_OPENINGS;
export const OPENINGS_BY_ID: Record<string, HouseOpening> = Object.fromEntries(HOUSE_OPENINGS.map((o) => [o.id, o]));

export function openingsOn(wall: HouseWall): HouseOpening[] {
  return OPENINGS.filter((o) => o.wall === wall);
}

/** true if the opening lies inside the glass wing (the partition door) */
export function isInterior(o: HouseOpening): boolean {
  return o.wall === 'north' && o.c > W.minX && o.c < W.maxX;
}

/**
 * Local point on a wall: `s` along it, height `y`, `d` metres inward from the
 * outer face (negative = outside).
 */
export function wallPoint(f: WallFrame, s: number, y: number, d: number): [number, number, number] {
  const n = f.face - d * (f.axis === 'x' ? f.nz : f.nx);
  return f.axis === 'x' ? [s, y, n] : [n, y, s];
}

/** window glass sits this far in from the outer face (deep-set windows) */
export const GLASS_IN = 0.085;
/** architrave (white trim) width round the openings, and how far it stands proud */
export const TRIM_W = 0.11;
export const TRIM_T = 0.028;
