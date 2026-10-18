/**
 * Fox Peak summit plan (world xz), around FOX_PEAK from the world layout.
 * The trail tops out at the north-west corner of a small level lookout
 * (567 m) whose north edge falls away to the lake valley, the cabin's knoll
 * and the fjord; a rocky knob rises 4 m east of it and carries the big cairn.
 * The bench faces north at the lookout's edge, sheltered on the windward
 * west-north-west side by a low crescent of dry-stone wall. The storm wind blows
 * from the west-north-west (SNOW_WIND), so rime feathers grow on the
 * windward faces and spindrift streams off the knob to the east.
 */
import { FOX_PEAK, SNOW_WIND } from '../../world/layout.js';
const dir = (x, z) => {
    const l = Math.hypot(x, z);
    return { fx: x / l, fz: z / l };
};
/** the lookout pad */
export const LOOKOUT = { x: FOX_PEAK.x, z: FOX_PEAK.z };
/** the big cairn on the knob's crest */
export const CAIRN = { x: FOX_PEAK.x + 14.8, z: FOX_PEAK.z + 1.0, r: 1.12, h: 2.7 };
/** the summit box with the visitors' book, on a post on the knob's west slope (facing the lookout) */
export const BOX = { x: FOX_PEAK.x + 11.6, z: FOX_PEAK.z - 0.4, ...dir(-1, 0.15) };
/** bench at the north edge, facing north over the island */
export const BENCH = { x: FOX_PEAK.x + 1.2, z: FOX_PEAK.z - 4.2, ...dir(0.08, -1) };
/** dry-stone windbreak: an arc round the bench on its windward side */
export const WINDBREAK = { x: BENCH.x - 0.1, z: BENCH.z + 0.5, r: 2.2, a0: 2.75, a1: 4.3, h: 0.62 };
/** where the wind comes from (unit xz) */
export const UPWIND = { x: -SNOW_WIND.x, z: -SNOW_WIND.z };
export const SUMMIT_ALT = Math.round(FOX_PEAK.y + 3.9);
