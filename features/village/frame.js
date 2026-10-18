/**
 * Lysvik's planning frame, aligned with the south shore of the fjord mouth:
 *   u — along the shore, increasing toward the east (the road from the cabin
 *       comes in from that side)
 *   v — inland, increasing up the slope toward the south (v = 0 at the back
 *       of the quay, negative over the harbour)
 * The village ground rises gently along +v and is nearly level along u, so
 * the lanes on the terraces run parallel to u.
 */
import { VILLAGE } from '../../world/layout.js';
export const AX_U = { x: 1, z: 0 };
export const AX_V = { x: 0, z: 1 };
export const ORIGIN = { x: VILLAGE.center.x, z: VILLAGE.quay.maxZ };
export function toWorld(u, v) {
    return [ORIGIN.x + u * AX_U.x + v * AX_V.x, ORIGIN.z + u * AX_U.z + v * AX_V.z];
}
export function toUV(x, z) {
    const dx = x - ORIGIN.x;
    const dz = z - ORIGIN.z;
    return [dx * AX_U.x + dz * AX_U.z, dx * AX_V.x + dz * AX_V.z];
}
