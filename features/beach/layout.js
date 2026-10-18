/**
 * Ice Beach site plan (world metres): a shore frame around BEACH from
 * world/layout and a search for the level lines of the black-sand slope, so
 * the stranded ice sits in the swash, the pebbles along the storm line and the
 * driftwood at the back of the beach wherever the terrain puts them.
 */
import { BEACH } from '../../world/layout.js';
/** Shore frame: centre, F toward the sea, T along the shore (north-north-west for +s). */
export const SHORE = {
    cx: BEACH.center.x,
    cz: BEACH.center.z,
    fx: BEACH.facing.x,
    fz: BEACH.facing.z,
    tx: -BEACH.facing.z,
    tz: BEACH.facing.x,
    half: BEACH.halfLength,
};
/**
 * The point at along-shore offset `s` (m) where the beach crosses height
 * `level` (m above the sea), searching seaward from the back of the beach.
 * Returns null when there is no such crossing (cliff, headland).
 */
export function shorePoint(H, s, level) {
    const bx = SHORE.cx + SHORE.tx * s;
    const bz = SHORE.cz + SHORE.tz * s;
    const at = (t) => H(bx + SHORE.fx * t, bz + SHORE.fz * t) - level;
    let t0 = -90;
    if (at(t0) < 0)
        return null;
    let t1 = t0;
    for (let t = t0 + 4; t <= 200; t += 4) {
        if (at(t) < 0) {
            t1 = t;
            break;
        }
        t0 = t;
    }
    if (t1 === -90)
        return null;
    for (let k = 0; k < 16; k++) {
        const m = (t0 + t1) / 2;
        if (at(m) >= 0)
            t0 = m;
        else
            t1 = m;
    }
    const t = (t0 + t1) / 2;
    return { x: bx + SHORE.fx * t, z: bz + SHORE.fz * t, t };
}
/** Where the beach path reaches the sand: the driftwood bench looks out to sea from here. */
export const BENCH = { s: -2, level: 2.6, len: 2.3 };
/** Ice clusters along the shore: along-shore offset, spread (m), share of the chunks. */
export const ICE_CLUSTERS = [
    [-66, 12, 0.1],
    [-44, 6, 0.2],
    [-30, 6, 0.16],
    [-12, 9, 0.14],
    [8, 7, 0.12],
    [30, 12, 0.12],
    [56, 10, 0.1],
    [88, 16, 0.08],
];
/**
 * The big ones, placed: along-shore offset, level (m above the sea), radius (m). They give the
 * beach view its foreground and the swash something to break round.
 */
export const HERO_ICE = [
    [-37.5, 0.1, 1.25],
    [-41, 0.7, 0.8],
    [-33, -0.05, 1.55],
    [-27.5, 0.45, 0.95],
    [-14, 0.25, 1.15],
    [6, 0.0, 1.4],
    [33, 0.55, 1.05],
];
/** Driftwood logs at the back of the beach: along-shore offset, level, length, heading offset (rad), r0, r1, root flare. */
export const DRIFTWOOD = [
    [-84, 3.1, 4.2, 0.2, 0.2, 0.11, 0.8],
    [-58, 2.7, 2.2, -0.5, 0.12, 0.08, 0],
    [-36, 3.4, 5.1, 0.12, 0.24, 0.13, 0.9],
    [-14, 2.4, 1.8, 1.1, 0.1, 0.07, 0],
    [10, 3.0, 3.4, -0.3, 0.17, 0.1, 0.5],
    [27, 2.2, 2.4, 0.6, 0.13, 0.08, 0.3],
    [46, 3.6, 6.2, -0.1, 0.27, 0.15, 1.0],
    [71, 2.6, 2.0, 1.4, 0.1, 0.06, 0],
    [96, 3.2, 3.8, 0.25, 0.19, 0.1, 0.6],
];
