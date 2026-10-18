/**
 * Ice Beach props: silver driftwood logs at the back of the beach with soft
 * snow cushions on top, a split-log driftwood bench on two stumps looking out
 * to sea, and a band of black pebbles along the storm line (wet and glossy
 * low down, dusted with snow higher up).
 */
import * as THREE from 'three';
import { snowCap } from '../../core/geometry.js';
import { mulberry32 } from '../../world/noise.js';
import { boulderGeometry, noise3, paintVertices } from '../paths/kit/rocks.js';
import { logGeometry, placeLog } from '../paths/kit/wood.js';
import { BENCH, DRIFTWOOD, SHORE, shorePoint } from './layout.js';
/** silver-grey salt-bleached wood over the weathered timber texture, dark in the checks */
function bleach(g, seed, dark = 1) {
    const checks = g.userData.checks;
    return paintVertices(g, (p, n, c, i) => {
        const k = 0.86 + 0.24 * noise3(p.x * 2.3 + seed, p.y * 2.3, p.z * 2.3);
        const up = Math.max(0, n.y);
        const ck = checks ? checks[i] : 0;
        c.setRGB(1.04 * k, 1.02 * k, 1.0 * k).multiplyScalar(dark * (0.82 + 0.22 * up) * (1 - 0.6 * ck));
    });
}
/** snow on a placed (world-space) log: a cushion along its top */
function capOf(g, thickness) {
    return snowCap(g, { thickness, cell: Math.max(0.018, thickness / 3), overhang: thickness * 0.4, sag: 0.45, minUp: 0.62, lumps: 0.45, align: 'auto' });
}
export function buildProps(ctx) {
    const H = (x, z) => ctx.world.heightAt(x, z);
    // level-line search on the baked grid (fast); final heights are exact
    const Hf = (x, z) => ctx.world.heightAtFast(x, z);
    const rnd = mulberry32(5150);
    const wood = [];
    const snow = [];
    const pebblesWet = [];
    const pebblesDry = [];
    const circles = [];
    const segments = [];
    const logs = [];
    const heading0 = Math.atan2(SHORE.tz, SHORE.tx);
    /* ---------- driftwood, snowed ---------- */
    DRIFTWOOD.forEach(([s, level, len, dHead, r0, r1, flare], i) => {
        const p = shorePoint(Hf, s, level);
        if (!p)
            return;
        const head = heading0 + dHead;
        const g = logGeometry(300 + i, {
            length: len,
            r0,
            r1,
            bend: (rnd() - 0.5) * 0.8,
            bow: (rnd() - 0.3) * 0.12,
            knobs: 0.2,
            flare,
            flatBottom: 0.55,
            checks: 0.22,
            splinter: 0.9,
            radial: 18,
        });
        const dx = Math.cos(head);
        const dz = Math.sin(head);
        const a = new THREE.Vector3(p.x - (dx * len) / 2, 0, p.z - (dz * len) / 2);
        const b = new THREE.Vector3(p.x + (dx * len) / 2, 0, p.z + (dz * len) / 2);
        const ya = H(a.x, a.z);
        const yb = H(b.x, b.z);
        // half buried in the sand and the drifted snow
        a.y = ya + r0 * 0.25;
        b.y = yb + r1 * 0.25;
        placeLog(g, a, b);
        wood.push(bleach(g, i * 11));
        const cap = capOf(g, Math.min(0.1, r0 * 0.45));
        if (cap)
            snow.push(cap);
        logs.push({ x: p.x, z: p.z });
        // a broken side branch on the bigger logs
        if (len > 2.5) {
            const t = 0.35 + rnd() * 0.3;
            const bx = a.x + (b.x - a.x) * t;
            const bz = a.z + (b.z - a.z) * t;
            const side = rnd() > 0.5 ? 1 : -1;
            const blen = 0.5 + rnd() * 0.6;
            const br = logGeometry(400 + i, { length: blen, r0: r0 * 0.45, r1: r0 * 0.22, bend: 0.08, knobs: 0.2, checks: 0.15, splinter: 1.2, radial: 10 });
            const by = a.y + (b.y - a.y) * t;
            const ex = bx - dz * side * blen * 0.8 + dx * blen * 0.4;
            const ez = bz + dx * side * blen * 0.8 + dz * blen * 0.4;
            placeLog(br, new THREE.Vector3(bx, by + r0 * 0.2, bz), new THREE.Vector3(ex, Math.max(H(ex, ez) + 0.04, by - 0.05), ez));
            wood.push(bleach(br, i * 13));
            const bc = capOf(br, Math.min(0.06, r0 * 0.3));
            if (bc)
                snow.push(bc);
        }
        if (r0 >= 0.15)
            segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: r0 * 0.9, yMax: Math.max(ya, yb) + r0 * 1.8 });
    });
    /* ---------- black pebbles along the storm line ---------- */
    const tones = [
        [0.16, 0.16, 0.17],
        [0.11, 0.11, 0.12],
        [0.22, 0.21, 0.2],
        [0.08, 0.085, 0.09],
        [0.28, 0.27, 0.26],
    ];
    const count = ctx.quality.fancy ? 260 : 160;
    const pebbles = new Map();
    const pebbleTemplate = (detail, t) => {
        const key = `${detail}:${t}`;
        let g = pebbles.get(key);
        if (!g) {
            g = boulderGeometry(700 + detail * 10 + t, { sx: 1, sy: 1, sz: 1, detail, lumps: 0.08, grain: 0.008, facets: 0, flatBottom: 0.35 });
            pebbles.set(key, g);
        }
        return g;
    };
    for (let k = 0; k < count; k++) {
        // clumped along the shore, in a band between the swash and the storm line
        const s = (rnd() * 2 - 1) * SHORE.half * 0.95;
        const level = 0.5 + Math.pow(rnd(), 0.8) * 1.9;
        const p = shorePoint(Hf, s + (rnd() - 0.5) * 6, level);
        if (!p)
            continue;
        const r = 0.03 + Math.pow(rnd(), 2.2) * 0.16;
        // a handful of unit pebble shapes, stretched per pebble (building each one is slow)
        const g = pebbleTemplate(r > 0.1 ? 2 : 1, Math.floor(rnd() * 6)).clone();
        g.scale(r * (1.1 + rnd() * 0.35), r * (0.5 + rnd() * 0.25), r * (0.8 + rnd() * 0.2));
        g.computeVertexNormals();
        const tone = tones[Math.floor(rnd() * tones.length)];
        const ns = rnd() * 30;
        const wet = level < 1.1;
        paintVertices(g, (q, n, c) => {
            const m = 0.88 + 0.2 * noise3(q.x * 9 + ns, q.y * 9, q.z * 9);
            c.setRGB(tone[0] * m, tone[1] * m, tone[2] * m).multiplyScalar((wet ? 0.7 : 1) * (0.9 + 0.14 * Math.max(0, n.y)));
        });
        g.rotateY(rnd() * Math.PI * 2);
        g.translate(p.x, H(p.x, p.z) + r * 0.08, p.z);
        (wet ? pebblesWet : pebblesDry).push(g);
    }
    for (const g of pebbles.values())
        g.dispose();
    /* ---------- split-log driftwood bench on two stumps, facing the sea ---------- */
    let bench = null;
    const bp = shorePoint(Hf, BENCH.s, BENCH.level);
    if (bp) {
        const rot = heading0;
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        const gy = H(bp.x, bp.z);
        const seatY = gy + 0.44;
        const half = BENCH.len / 2;
        const seat = logGeometry(501, { length: BENCH.len, r0: 0.21, r1: 0.18, bend: 0.06, knobs: 0.07, flatTop: 0.3, radial: 12, segments: 10 });
        seat.translate(0, -0.21 * 0.3, 0);
        placeLog(seat, new THREE.Vector3(bp.x - c * half, seatY, bp.z - sn * half), new THREE.Vector3(bp.x + c * half, seatY, bp.z + sn * half), 0);
        wood.push(bleach(seat, 5, 1.05));
        const sc = snowCap(seat, { thickness: 0.09, cell: 0.025, overhang: 0.05, lumps: 0.3, align: rot });
        if (sc)
            snow.push(sc);
        for (const t of [-0.62, 0.62]) {
            const sx = bp.x + c * half * t;
            const sz = bp.z + sn * half * t;
            const stump = logGeometry(t > 0 ? 511 : 510, { length: 0.36, r0: 0.17, r1: 0.15, knobs: 0.1, radial: 10, segments: 3 });
            placeLog(stump, new THREE.Vector3(sx, H(sx, sz) - 0.05, sz), new THREE.Vector3(sx + 0.001, seatY - 0.26 + 0.05, sz), rnd() * 6);
            wood.push(bleach(stump, 7 + t, 0.9));
        }
        segments.push({ ax: bp.x - c * half, az: bp.z - sn * half, bx: bp.x + c * half, bz: bp.z + sn * half, r: 0.24, yMax: seatY });
        bench = { x: bp.x, y: seatY, z: bp.z, rot };
    }
    return { wood, snow, pebblesWet, pebblesDry, circles, segments, bench, logs };
}
