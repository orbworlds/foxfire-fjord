/**
 * Hot-spring site plan (world coordinates), anchored on SPRING from the world
 * layout. The shelf is flat at SPRING.y over roughly x -386…-367,
 * z -34…-20; beyond its north-west brink the crag drops twenty metres to the
 * strandflat, so the pool hangs over the fjord with the Teeth beyond. The
 * hot water comes out of a rock pile at the pool's south-west end and pours
 * in along a split-log trough; the boardwalk from the cabin path arrives at
 * the east rim; a red changing hut with a bench stands on the shelf's east
 * end, its back to the cliff edge. The tour camera stands south-east of the
 * pool looking north-west across it.
 */
import { SPRING } from '../../world/layout.js';
export const GROUND_Y = SPRING.y;
export const POOL = {
    x: SPRING.x,
    z: SPRING.z,
    /** half axes of the organic outline (m) */
    a: 3.5,
    b: 2.55,
    /** rotation of the long axis (rad): local +x points north-east along the brink, local +z south-east */
    rot: -0.93,
    /** the basin is held up by the boulder ring, a hand above the shelf */
    water: GROUND_Y + 0.16,
    depth: 1.05,
};
/** where the tour camera looks at the pool from (unit xz, camera -> pool) */
export const VIEW_DIR = { x: -0.707, z: -0.707 };
/** the boardwalk's end at the east rim (paths feature) */
export const BOARDWALK_END = { x: -376, z: -25 };
/** outline angle (pool space) of the hot-water source and its trough */
export const SOURCE_PHI = Math.PI - 0.25;
/** Changing hut: ridge north-south, the door and a bench on its west front facing the pool. */
export const HUT = {
    x: -370.55,
    z: -30.25,
    rotY: -Math.PI / 2,
    w: 2.5,
    d: 2.0,
    wallH: 2.0,
    pitch: 0.9,
};
/** sign at the end of the path from the cabin, facing the arriving walker (front normal (fx, fz)) */
export const SIGN = { x: -365.9, z: -19.3, fx: 0.86, fz: 0.5 };
/** wax torches stuck in the snow either side of the boardwalk, a step before the pool */
export const TORCHES = [
    [-374.55, -25.5],
    [-375.6, -23.55],
];
/** Outline radius multiplier (organic wobble) for angle phi in pool space. */
export function outlineWobble(phi) {
    return 1 + 0.07 * Math.sin(2 * phi + 0.6) + 0.05 * Math.sin(3 * phi + 2.1) + 0.03 * Math.sin(5 * phi + 1.3);
}
const C = Math.cos(POOL.rot);
const S = Math.sin(POOL.rot);
/** World point on the pool outline at angle phi, pushed outward by `grow` metres, with the outward normal. */
export function outlinePoint(phi, grow = 0) {
    const w = outlineWobble(phi);
    const lx = Math.cos(phi) * POOL.a * w;
    const lz = Math.sin(phi) * POOL.b * w;
    let nx = lx / (POOL.a * POOL.a);
    let nz = lz / (POOL.b * POOL.b);
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const px = lx + nx * grow;
    const pz = lz + nz * grow;
    return {
        x: POOL.x + px * C - pz * S,
        z: POOL.z + px * S + pz * C,
        nx: nx * C - nz * S,
        nz: nx * S + nz * C,
    };
}
/** Pool-space outline angle of the direction from the pool centre toward (x, z). */
export function phiToward(x, z) {
    const dx = x - POOL.x;
    const dz = z - POOL.z;
    const lx = dx * C + dz * S;
    const lz = -dx * S + dz * C;
    return Math.atan2(lz / POOL.b, lx / POOL.a);
}
/** the step-in from the boardwalk */
export const ENTRY_PHI = phiToward(BOARDWALK_END.x, BOARDWALK_END.z);
/** The trough: from between the source boulders out over the water. */
export const TROUGH = (() => {
    const from = outlinePoint(SOURCE_PHI, 1.25);
    const to = outlinePoint(SOURCE_PHI + 0.02, -0.4);
    return {
        rock: outlinePoint(SOURCE_PHI, 1.75),
        from: { x: from.x, y: GROUND_Y + 0.98, z: from.z },
        to: { x: to.x, y: GROUND_Y + 0.66, z: to.z },
    };
})();
/**
 * The melt ring's reach beyond the pool outline (m) at outline angle phi:
 * lobed and uneven, widest on the warm lee side.
 */
export function meltReach(phi) {
    return 2.5 + 0.9 * (0.5 + 0.5 * Math.sin(3 * phi + 1.0)) + 0.45 * Math.sin(7 * phi + 2.3) + 0.25 * Math.sin(13 * phi + 0.4);
}
/**
 * How bare the ground is at (x, z): 1 at the rocks, fading to 0 at the melt
 * ring's ragged edge (before the decal's own noise). The melt decal draws
 * exactly this; the grass that greens the ring follows it.
 */
export function meltAt(x, z) {
    const phi = phiToward(x, z);
    const o = outlinePoint(phi, 0);
    const rO = Math.hypot(o.x - POOL.x, o.z - POOL.z);
    const r = Math.hypot(x - POOL.x, z - POOL.z);
    const grow = r - rO;
    const reach = meltReach(phi);
    if (grow <= -0.35)
        return 1;
    const k = Math.pow(Math.min(1.5, (grow + 0.35) / (reach + 0.35)), 1 / 1.2);
    const t = Math.min(1, Math.max(0, (k - 0.3) / 0.7));
    return 1 - t * t * (3 - 2 * t);
}
