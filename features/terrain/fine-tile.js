/**
 * One tile of the fine window: exact heights with a border, normals and the
 * path core / shoulder weights, packed for upload. Runs in a worker or on the
 * main thread; must stay free of three and other bare imports.
 */
import { heightAt, pathCarve } from '../../world/terrain-height.js';
/** Exact heights (+1 texel border for central-difference normals) for one tile. */
export function computeFineTile(job) {
    const { id, tx, tz, B, s } = job;
    const W = B + 2;
    const hb = new Float32Array(W * W);
    const ox = tx * B - 1;
    const oz = tz * B - 1;
    for (let j = 0; j < W; j++) {
        const z = (oz + j) * s;
        const row = j * W;
        for (let i = 0; i < W; i++)
            hb[row + i] = heightAt((ox + i) * s, z);
    }
    const h = new Float32Array(B * B);
    const n = new Uint8Array(B * B * 4);
    const inv = 1 / (2 * s);
    for (let j = 0; j < B; j++) {
        const z = (tz * B + j) * s;
        for (let i = 0; i < B; i++) {
            const c = (j + 1) * W + i + 1;
            const k = j * B + i;
            h[k] = hb[c];
            const dx = (hb[c + 1] - hb[c - 1]) * inv;
            const dz = (hb[c + W] - hb[c - W]) * inv;
            const len = Math.sqrt(dx * dx + 1 + dz * dz);
            const o = k * 4;
            n[o] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
            n[o + 1] = Math.round(((-dz / len) * 0.5 + 0.5) * 255);
            const pc = pathCarve((tx * B + i) * s, z);
            n[o + 2] = Math.round(pc.core * 255);
            n[o + 3] = Math.round(pc.weight * 255);
        }
    }
    return { id, tx, tz, h, n };
}
