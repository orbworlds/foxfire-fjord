/**
 * Lysvik's site plan (deterministic): the quay along the fjord shore, the
 * lanes over the quay terraces (layout.VILLAGE_TERRACES), the main street
 * from the quay up past the road junction to the churchyard stair, and the
 * lots: Nordic cabins along the lanes, rows of rorbuer on stilts either side
 * of the quay, boathouses on the shallows, the fish landing and the red
 * warehouse over the water, the general store at the foot of the main
 * street, the white church on the top terrace, stabbur and woodsheds in the
 * yards; plus moored and frozen-in boats, stockfish racks, the breakwaters
 * and the harbour lights.
 */
import { mulberry32 } from '../../world/noise.js';
import { PATHS, VILLAGE, VILLAGE_TERRACES, VIEWPOINTS } from '../../world/layout.js';
import { samplePath } from '../../world/paths.js';
import { toWorld, toUV } from './frame.js';
/* ------------------------------------------------------------------ */
/* small geometry helpers                                             */
/* ------------------------------------------------------------------ */
export function obbFromLot(x, z, fx, fz, w, d, mFront, mBack, mSide) {
    // local x axis = (fz, -fx)
    const off = (mFront - mBack) / 2;
    return { cx: x + fx * off, cz: z + fz * off, ux: fz, uz: -fx, hx: w / 2 + mSide, hz: d / 2 + (mFront + mBack) / 2 };
}
export function obbOverlap(a, b, margin = 0) {
    const dx = b.cx - a.cx;
    const dz = b.cz - a.cz;
    const axes = [
        [a.ux, a.uz],
        [-a.uz, a.ux],
        [b.ux, b.uz],
        [-b.uz, b.ux],
    ];
    for (const [px, pz] of axes) {
        const ra = a.hx * Math.abs(a.ux * px + a.uz * pz) + a.hz * Math.abs(-a.uz * px + a.ux * pz);
        const rb = b.hx * Math.abs(b.ux * px + b.uz * pz) + b.hz * Math.abs(-b.uz * px + b.ux * pz);
        if (Math.abs(dx * px + dz * pz) > ra + rb + margin)
            return false;
    }
    return true;
}
export function obbContains(o, x, z, pad = 0) {
    const dx = x - o.cx;
    const dz = z - o.cz;
    const lx = dx * o.ux + dz * o.uz;
    const lz = -dx * o.uz + dz * o.ux;
    return Math.abs(lx) <= o.hx + pad && Math.abs(lz) <= o.hz + pad;
}
export function obbCorners(o, pad = 0) {
    const out = [];
    const zx = -o.uz;
    const zz = o.ux;
    for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
    ]) {
        out.push([o.cx + o.ux * (o.hx + pad) * sx + zx * (o.hz + pad) * sz, o.cz + o.uz * (o.hx + pad) * sx + zz * (o.hz + pad) * sz]);
    }
    return out;
}
/** sample heights over an OBB (grid n×n incl. edges) → [min, max] */
export function obbHeights(o, h, n = 4) {
    let mn = Infinity;
    let mx = -Infinity;
    const zx = -o.uz;
    const zz = o.ux;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const a = (i / (n - 1)) * 2 - 1;
            const b = (j / (n - 1)) * 2 - 1;
            const y = h(o.cx + o.ux * o.hx * a + zx * o.hz * b, o.cz + o.uz * o.hx * a + zz * o.hz * b);
            if (y < mn)
                mn = y;
            if (y > mx)
                mx = y;
        }
    }
    return [mn, mx];
}
function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** Smooth a world polyline (Catmull-Rom) and resample at `spacing`. */
export function resample(pts, spacing) {
    if (pts.length < 2)
        return pts.map((p) => ({ x: p[0], z: p[1], tx: 1, tz: 0, s: 0 }));
    const raw = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
        for (let k = 0; k < n; k++) {
            const t = k / n;
            raw.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
        }
    }
    raw.push(pts[pts.length - 1]);
    const cum = [0];
    for (let i = 1; i < raw.length; i++)
        cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = cum[cum.length - 1];
    const count = Math.max(2, Math.round(total / spacing) + 1);
    const out = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
        const s = (total * k) / (count - 1);
        while (j < cum.length - 2 && cum[j + 1] < s)
            j++;
        const seg = cum[j + 1] - cum[j] || 1;
        const t = (s - cum[j]) / seg;
        out.push({ x: raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t, z: raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t, tx: 0, tz: 0, s });
    }
    for (let k = 0; k < out.length; k++) {
        const a = out[Math.max(0, k - 1)];
        const b = out[Math.min(out.length - 1, k + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        out[k].tx = dx / l;
        out[k].tz = dz / l;
    }
    return out;
}
function inBox(b, x, z, pad = 0) {
    return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
}
/* ------------------------------------------------------------------ */
/* the plan                                                           */
/* ------------------------------------------------------------------ */
export function makePlan(h, isReserved) {
    const Q = VILLAGE.quay;
    const T = VILLAGE_TERRACES;
    const C = VILLAGE.center;
    const rnd = mulberry32(4242);
    /* ---------------- shoreline ---------------- */
    const shoreCache = new Map();
    const shoreZ = (x) => {
        const key = Math.round(x);
        const hit = shoreCache.get(key);
        if (hit !== undefined)
            return hit;
        let prev = h(x, Q.maxZ + 30);
        let out = Q.minZ - 40;
        for (let zz = Q.maxZ + 28; zz > Q.minZ - 80; zz -= 2) {
            const cur = h(x, zz);
            if (prev >= 0.3 && cur < 0.3) {
                // refine within the last 2 m
                let hi = zz + 2;
                let lo = zz;
                for (let it = 0; it < 5; it++) {
                    const mid = (hi + lo) / 2;
                    if (h(x, mid) >= 0.3)
                        hi = mid;
                    else
                        lo = mid;
                }
                out = (hi + lo) / 2;
                break;
            }
            prev = cur;
        }
        shoreCache.set(key, out);
        return out;
    };
    /* ---------------- terraces by role ---------------- */
    // sort the declared terraces into the quay rows (lowest), the middle rows and the top terrace (church)
    // (rows by distance from the quay: the two nearest are the quay rows, the farthest one the top)
    const byZ = [...T].sort((a, b) => a.minZ + a.maxZ - b.minZ - b.maxZ);
    const top = byZ[byZ.length - 1];
    const low = byZ.slice(0, 2).sort((a, b) => a.minX - b.minX);
    const mid = byZ.slice(2, byZ.length - 1).sort((a, b) => a.minX - b.minX);
    const lowW = low[0];
    const lowE = low[low.length - 1];
    const midW = mid[0];
    const midE = mid[mid.length - 1];
    /* ---------------- carved paths (the terrain draws them) ---------------- */
    const lanes = [];
    const nearVillage = (x, z) => Math.hypot(x - C.x, (z - C.z) * 1.1) < VILLAGE.radius + 40;
    for (const id of ['road', 'beach', 'quay']) {
        const def = PATHS.find((p) => p.id === id);
        if (!def)
            continue;
        const s = samplePath(def, 2).filter((p) => nearVillage(p.x, p.z));
        if (s.length < 2)
            continue;
        lanes.push({ id, kind: 'carved', width: def.width + 1.6, pts: resample(s.map((p) => [p.x, p.z]), 2), lamps: id === 'beach' ? 0 : id === 'quay' ? 0 : 26 });
    }
    const road = PATHS.find((p) => p.id === 'road');
    const pathEnd = road ? [road.points[road.points.length - 1][0], road.points[road.points.length - 1][1]] : [C.x, C.z];
    /* ---------------- the main street and the side lanes ---------------- */
    const gapLow = (lowW.maxX + lowE.minX) / 2;
    const gapMid = (midW.maxX + midE.minX) / 2;
    const stairX = (top.minX + top.maxX) / 2;
    const addLane = (id, kind, width, pts, lamps) => {
        lanes.push({ id, kind, width, pts: resample(pts, 2), lamps });
    };
    addLane('main', 'street', 4.6, [
        [gapLow, Q.maxZ + 0.5],
        [gapLow, lowW.maxZ - 2],
        [(gapLow + gapMid) / 2 + 1, (lowW.maxZ + midE.minZ) / 2],
        [gapMid, midE.minZ + 4],
        [pathEnd[0] + 1.5, pathEnd[1] + 1],
        [(gapMid + stairX) / 2, (midW.maxZ + top.minZ) / 2 - 3],
        [stairX, top.minZ - 6],
    ], 22);
    // lanes across the quay-row terraces (their back rows face them)
    const lowLaneZ = (t) => t.minZ + (t.maxZ - t.minZ) * 0.47;
    addLane('lowW', 'lane', 3.0, [
        [lowW.minX - 14, lowLaneZ(lowW) + 1],
        [lowW.minX + 2, lowLaneZ(lowW)],
        [gapLow - 2.4, lowLaneZ(lowW)],
    ], 28);
    addLane('lowE', 'lane', 3.0, [
        [gapLow + 2.4, lowLaneZ(lowE)],
        [lowE.maxX - 2, lowLaneZ(lowE)],
        [lowE.maxX + 12, lowLaneZ(lowE) - 2],
    ], 28);
    // along the front edge of the west middle terrace and on west, out of the village
    addLane('midW', 'lane', 3.2, [
        [midW.minX - 58, midW.minZ + 4],
        [midW.minX - 20, midW.minZ + 1.5],
        [midW.minX + 4, midW.minZ + 2.2],
        [gapMid - 3, midW.minZ + 2.2],
    ], 26);
    // the west lane down to the quay's west end
    addLane('west', 'lane', 3.0, [
        [midW.minX - 20, midW.minZ + 1.5],
        [lowW.minX - 6, lowW.minZ + 12],
        [Q.minX - 3, Q.maxZ + 1],
    ], 26);
    // the east lane from the road down to the quay's east end
    addLane('east', 'lane', 3.2, [
        [midE.maxX - 14, pathEnd[1] - 3],
        [lowE.maxX + 6, lowE.minZ + 14],
        [Q.maxX - 6, Q.maxZ + 1],
    ], 26);
    // the upper lane between the middle terraces and the churchyard
    const upZ = (mid[0].maxZ + top.minZ) / 2 + 1;
    addLane('upper', 'lane', 3.0, [
        [midW.minX - 34, upZ + 6],
        [midW.minX, upZ + 2],
        [stairX - 8, upZ],
        [stairX + 8, upZ],
        [midE.maxX, upZ - 1],
        [midE.maxX + 26, upZ - 6],
    ], 28);
    // the top lane above the churchyard
    const topZ = top.maxZ + 12;
    addLane('top', 'lane', 2.8, [
        [top.minX - 70, topZ + 6],
        [top.minX - 10, topZ],
        [top.maxX + 10, topZ - 1],
        [top.maxX + 60, topZ - 8],
    ], 30);
    // a footpath linking the top lane down past the churchyard's west side
    addLane('churchW', 'lane', 2.2, [
        [top.minX - 6, topZ],
        [top.minX - 5, top.minZ + 4],
        [top.minX - 8, upZ + 1],
    ], 0);
    /* ---------------- lane dots for overlap tests ---------------- */
    const laneDots = [];
    const DOT_CELL = 12;
    const dotGrid = new Map();
    const indexLanes = () => {
        laneDots.length = 0;
        dotGrid.clear();
        for (const lane of lanes) {
            const fine = resample(lane.pts.map((p) => [p.x, p.z]), 1);
            for (const p of fine)
                laneDots.push({ x: p.x, z: p.z, r: lane.width / 2 + (lane.kind === 'carved' ? 1.8 : 0.6), id: lane.id });
        }
        laneDots.forEach((d, i) => {
            const key = Math.floor(d.z / DOT_CELL) * 100003 + Math.floor(d.x / DOT_CELL);
            let l = dotGrid.get(key);
            if (!l)
                dotGrid.set(key, (l = []));
            l.push(i);
        });
    };
    indexLanes();
    const hitsLane = (o, pad = 0) => {
        const r = Math.hypot(o.hx, o.hz) + 4;
        for (let cz = Math.floor((o.cz - r) / DOT_CELL); cz <= Math.floor((o.cz + r) / DOT_CELL); cz++) {
            for (let cx = Math.floor((o.cx - r) / DOT_CELL); cx <= Math.floor((o.cx + r) / DOT_CELL); cx++) {
                const l = dotGrid.get(cz * 100003 + cx);
                if (!l)
                    continue;
                for (const i of l) {
                    const d = laneDots[i];
                    if (obbContains(o, d.x, d.z, d.r + pad))
                        return d.id;
                }
            }
        }
        return null;
    };
    const hitsDot = (x, z, r) => {
        const rr = r + 4;
        for (let cz = Math.floor((z - rr) / DOT_CELL); cz <= Math.floor((z + rr) / DOT_CELL); cz++) {
            for (let cx = Math.floor((x - rr) / DOT_CELL); cx <= Math.floor((x + rr) / DOT_CELL); cx++) {
                const l = dotGrid.get(cz * 100003 + cx);
                if (!l)
                    continue;
                for (const i of l) {
                    const d = laneDots[i];
                    if (Math.hypot(d.x - x, d.z - z) < d.r + r)
                        return true;
                }
            }
        }
        return false;
    };
    /* ---------------- lots ---------------- */
    const placed = [];
    const mkLot = (kind, x, z, fx, fz, w, d, m, lane, seed, gableFront = false) => {
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
        const obb = obbFromLot(x, z, fx, fz, w, d, m[0], m[1], m[2]);
        const foot = obbFromLot(x, z, fx, fz, w, d, 0, 0, 0);
        const [mn, mx] = obbHeights(foot, h, 4);
        const [u, v] = toUV(x, z);
        return { kind, x, z, fx, fz, w, d, y: mx + 0.45, yMin: mn, yMax: mx, seed, lane, dist: Math.hypot(u - 10, (v - 40) * 1.2), obb, foot, gableFront };
    };
    const overlaps = (o, margin) => placed.some((p) => obbOverlap(p, o, margin));
    /* the churchyard on the top terrace: tower to the north (toward the stair), chancel to the south */
    const churchW = 8.6;
    const churchD = 15.5;
    const towerD = 4.6;
    const chancelD = 5.2;
    const cz0 = top.minZ + 7;
    const church = mkLot('church', stairX, cz0 + towerD + churchD / 2, 0, -1, churchW, churchD, [towerD + 0.5, chancelD + 0.5, 0.5], 'main', 7171, true);
    church.y = top.y + 0.35;
    church.yMin = top.y;
    const yardPad = { ...top };
    placed.push({ cx: (top.minX + top.maxX) / 2, cz: (top.minZ + top.maxZ) / 2, ux: 1, uz: 0, hx: (top.maxX - top.minX) / 2 + 1, hz: (top.maxZ - top.minZ) / 2 + 1 });
    // the stair climbs from the upper lane's south edge (it must not run under the lane) to the gate
    const footZ = Math.max(top.minZ - 6.5, upZ + 1.8);
    const stairFoot = [stairX, h(stairX, footZ), footZ];
    const stairTop = [stairX, top.y, top.minZ + 0.6];
    /* the general store: the quay corner of the west quay terrace, at the foot of the main street */
    const store = mkLot('store', lowW.maxX - 7.2, lowW.minZ + 5.6, 0, -1, 12.5, 9.5, [1.2, 2, 0.6], 'quay', 3301);
    placed.push(store.obb);
    /* the fish landing over the water at the west end of the quay, the red warehouse at the east end */
    const plant = mkLot('plant', Q.minX + 17, Q.minZ - 7.5, 0, -1, 15, 20, [0.5, 0.5, 0.5], 'quay', 5151, true);
    plant.y = Q.y + 0.25;
    placed.push(plant.obb);
    const warehouse = mkLot('warehouse', Q.maxX - 13, Q.minZ - 5.5, 0, -1, 11, 15, [0.5, 0.5, 0.5], 'quay', 6161, true);
    warehouse.y = Q.y + 0.25;
    placed.push(warehouse.obb);
    /* rorbuer: two rows on stilts along the shore beyond the quay ends, gable ends to the water */
    const rorbuer = [];
    const rr = mulberry32(2626);
    const rorbuRow = (x0, dir, n) => {
        let x = x0;
        for (let i = 0; i < n; i++) {
            const w = 5.6 + rr() * 1.4;
            const d = 8.5 + rr() * 2;
            x += (dir * w) / 2;
            const sz = Math.min(shoreZ(x - 2), shoreZ(x + 2));
            // a third of the house over the water, the rest on the rocks
            const z = sz + d * 0.2 + (rr() - 0.5) * 1.2;
            const lot = mkLot('rorbu', x, z, (rr() - 0.5) * 0.06, -1, w, d, [1.6, 0.6, 0.35], 'shore', Math.floor(rr() * 1e6), true);
            lot.y = Math.max(2.5, lot.yMax + 0.6) + rr() * 0.25;
            if (!overlaps(lot.obb, 0.2) && !isReserved(x, z, 1)) {
                rorbuer.push(lot);
                placed.push(lot.obb);
            }
            x += dir * (w / 2 + 2.2 + rr() * 2.2);
        }
    };
    rorbuRow(Q.minX - 9, -1, 7);
    rorbuRow(Q.maxX + 8, 1, 7);
    /* boathouses on the shallows at both ends */
    const naust = [];
    const rn = mulberry32(5353);
    const naustRow = (x0, dir, n) => {
        let x = x0;
        for (let i = 0; i < n; i++) {
            const w = 6 + rn() * 1.5;
            const d = 9 + rn() * 3;
            x += (dir * w) / 2;
            const sz = shoreZ(x);
            // the sea door just at the waterline, the back up on the beach
            const z = sz + d / 2 - 1.2;
            const lot = mkLot('naust', x, z, (rn() - 0.5) * 0.1, -1, w, d, [3.5, 0.4, 0.5], 'shore', Math.floor(rn() * 1e6), true);
            lot.y = Math.max(0.6, lot.yMin + 0.2);
            if (!overlaps(lot.obb, 0.3) && !isReserved(x, z, 1) && lot.yMax - lot.yMin < 4.5) {
                naust.push(lot);
                placed.push(lot.obb);
            }
            x += dir * (w / 2 + 3 + rn() * 3);
        }
    };
    naustRow(rorbuer.filter((l) => l.x < Q.minX).reduce((m, l) => Math.min(m, l.x - l.w / 2), Q.minX) - 14, -1, 3);
    naustRow(rorbuer.filter((l) => l.x > Q.maxX).reduce((m, l) => Math.max(m, l.x + l.w / 2), Q.maxX) + 12, 1, 3);
    /* the old school / community house on the upper lane, east of the churchyard */
    let school = null;
    {
        const lot = mkLot('school', top.maxX + 22, upZ + 12, 0, -1, 17, 9, [2, 2, 1], 'upper', 9191);
        if (!overlaps(lot.obb, 0.5) && !hitsLane(lot.foot, 0.5) && lot.yMax - lot.yMin < 3) {
            school = lot;
            placed.push(lot.obb);
        }
    }
    const cands = [];
    const laneById = new Map(lanes.map((l) => [l.id, l]));
    const pushPseudo = (id, pts) => laneById.set(id, { id, kind: 'lane', width: 0.4, pts: resample(pts, 2), lamps: 0 });
    // the quay rows face the harbour over the quay
    pushPseudo('quayW', [
        [lowW.minX - 22, Q.maxZ + 1],
        [gapLow - 3, Q.maxZ + 1],
    ]);
    pushPseudo('quayE', [
        [gapLow + 3, Q.maxZ + 1],
        [lowE.maxX + 20, Q.maxZ + 1],
    ]);
    const genAlong = (laneId, side, opts) => {
        const lane = laneById.get(laneId);
        if (!lane)
            return;
        const pts = lane.pts;
        const total = pts[pts.length - 1].s;
        let s = (opts.s0 ?? 2) + rnd() * 3;
        const s1 = total - (opts.s1 ?? 2);
        while (s < s1) {
            const gable = rnd() < (opts.gable ?? 0.3);
            let w = opts.w[0] + rnd() * (opts.w[1] - opts.w[0]);
            let d = opts.d[0] + rnd() * (opts.d[1] - opts.d[0]);
            if (gable)
                [w, d] = [Math.min(w, d + 0.5), Math.max(w, d)];
            const wingRoll = rnd();
            const wing = !gable && wingRoll < 0.32 ? { side: (wingRoll < 0.16 ? 1 : -1), w: 3 + rnd() * 1.6 } : undefined;
            if (wing)
                w += wing.w;
            const gap = opts.gap[0] + rnd() * (opts.gap[1] - opts.gap[0]);
            const setback = opts.setback[0] + rnd() * (opts.setback[1] - opts.setback[0]);
            const sm = s + w / 2;
            if (sm + w / 2 > s1)
                break;
            const p = pts[Math.min(pts.length - 1, Math.round(sm / 2))];
            const nx = -p.tz * side;
            const nz = p.tx * side;
            const off = lane.width / 2 + setback + d / 2;
            const x = p.x + nx * off;
            const z = p.z + nz * off;
            const mF = Math.max(0.6, setback - 0.6);
            const mB = 1.5 + rnd() * 3;
            const mS = 0.8 + rnd() * 1.6;
            const lot = mkLot('house', x, z, -nx, -nz, w, d, [mF, mB, mS], laneId, Math.floor(rnd() * 1e6), gable);
            lot.wing = wing;
            // terraces make good building land: prefer them
            const onTerrace = T.some((t) => inBox(t, x, z, -1));
            const score = opts.prio + 60 * (1 - Math.min(1, lot.dist / 190)) + (onTerrace ? 18 : 0) + rnd() * 18;
            cands.push({ lot, score, margin: opts.margin ?? 0.4 });
            s += w + gap;
        }
    };
    const house = { w: [7.2, 10.5], d: [6.4, 8.4], gap: [2.5, 6], setback: [1.5, 3.5] };
    genAlong('quayW', 1, { ...house, prio: 40, setback: [1.4, 2.6], gap: [1.6, 3.6], gable: 0.25 });
    genAlong('quayE', 1, { ...house, prio: 40, setback: [1.4, 2.6], gap: [1.6, 3.6], gable: 0.25 });
    for (const id of ['lowW', 'lowE']) {
        genAlong(id, 1, { ...house, prio: 28 });
        genAlong(id, -1, { ...house, prio: 10, gable: 0.6 });
    }
    genAlong('midW', 1, { ...house, prio: 30 });
    genAlong('midW', -1, { ...house, prio: 14, gable: 0.5 });
    genAlong('main', 1, { ...house, prio: 30, s0: 10, gable: 0.5, setback: [1.6, 2.6] });
    genAlong('main', -1, { ...house, prio: 30, s0: 10, gable: 0.5, setback: [1.6, 2.6] });
    genAlong('road', 1, { ...house, prio: 26, setback: [2.6, 4.5] });
    genAlong('road', -1, { ...house, prio: 18, setback: [2.6, 4.5] });
    genAlong('beach', 1, { ...house, prio: 16, setback: [2.6, 4.5] });
    genAlong('beach', -1, { ...house, prio: 16, setback: [2.6, 4.5] });
    for (const id of ['west', 'east']) {
        genAlong(id, 1, { ...house, prio: 14, gable: 0.5 });
        genAlong(id, -1, { ...house, prio: 14, gable: 0.5 });
    }
    genAlong('upper', 1, { ...house, prio: 18 });
    genAlong('upper', -1, { ...house, prio: 20, gable: 0.4 });
    genAlong('top', 1, { ...house, prio: 8 });
    genAlong('top', -1, { ...house, prio: 12 });
    cands.sort((a, b) => b.score - a.score);
    const houses = [];
    const TARGET = 62;
    const why = {};
    const rej = (k) => {
        why[k] = (why[k] ?? 0) + 1;
    };
    for (const c of cands) {
        if (houses.length >= TARGET)
            break;
        const lot = c.lot;
        if (lot.dist > 190) {
            rej('dist');
            continue;
        }
        // a plinth up to ~2.4 m on the downhill side; keep off the beach and the quay
        if (lot.yMax - lot.yMin > 2.4) {
            rej('steep');
            continue;
        }
        if (lot.yMin < 2.2) {
            rej('low');
            continue;
        }
        let bad = false;
        for (const [x, z] of obbCorners(lot.obb, 0.2)) {
            if (isReserved(x, z, 0.6) || inBox(Q, x, z, 1)) {
                bad = true;
                break;
            }
        }
        if (bad) {
            rej('reserved/quay');
            continue;
        }
        const hl = hitsLane(lot.foot, 0.4);
        if (hl) {
            rej('lane:' + hl);
            continue;
        }
        if (overlaps(lot.obb, c.margin)) {
            rej('overlap');
            continue;
        }
        // the churchyard terrace stays the church's
        if (inBox(top, lot.x, lot.z, 6)) {
            rej('church');
            continue;
        }
        placed.push(lot.obb);
        houses.push(lot);
    }
    if (globalThis.PLAN_DEBUG)
        console.log('rejected', why, 'cands', cands.length);
    /* ---------------- stabbur and woodsheds in the yards ---------------- */
    const stabbur = [];
    const sheds = [];
    const ry = mulberry32(7373);
    for (const hs of houses) {
        const roll = ry();
        const isStabbur = roll < 0.13;
        if (!isStabbur && roll > 0.5)
            continue;
        const sw = isStabbur ? 3.6 + ry() * 0.8 : 2.6 + ry() * 1.6;
        const sd = isStabbur ? 3.2 + ry() * 0.8 : 2.2 + ry() * 0.8;
        const ux = hs.fz;
        const uz = -hs.fx;
        const side = ry() < 0.5 ? -1 : 1;
        const tries = [
            [side * (hs.w / 2 - sw / 2), -(hs.d / 2 + 2.2 + sd / 2)],
            [side * (hs.w / 2 + 2.0 + sw / 2), -hs.d / 2 + sd / 2],
            [-side * (hs.w / 2 + 2.0 + sw / 2), -hs.d / 2 + sd / 2],
        ];
        for (const [lx, lz] of tries) {
            const x = hs.x + ux * lx + hs.fx * lz;
            const z = hs.z + uz * lx + hs.fz * lz;
            const lot = mkLot(isStabbur ? 'stabbur' : 'shed', x, z, hs.fx, hs.fz, sw, sd, [0.6, 0.6, 0.6], hs.lane, Math.floor(ry() * 1e6), isStabbur);
            if (lot.yMax - lot.yMin > (isStabbur ? 1.6 : 1.2) || lot.yMin < 2.2)
                continue;
            if (hitsLane(lot.foot, 0.3) || placed.some((o) => o !== hs.obb && obbOverlap(o, lot.obb, 0.3)) || obbOverlap(hs.foot, lot.foot, 1.2))
                continue;
            let bad = false;
            for (const [cx, cz] of obbCorners(lot.obb))
                if (isReserved(cx, cz, 0.4) || inBox(Q, cx, cz, 1))
                    bad = true;
            if (bad)
                continue;
            placed.push(lot.obb);
            (isStabbur ? stabbur : sheds).push(lot);
            break;
        }
    }
    /* ---------------- breakwaters (riprap) ---------------- */
    const bwW = [
        [Q.minX - 2, Q.minZ - 1],
        [Q.minX - 8, Q.minZ - 22],
        [Q.minX - 2, Q.minZ - 44],
        [Q.minX + 22, Q.minZ - 60],
        [Q.minX + 44, Q.minZ - 66],
    ];
    const bwE = [
        [Q.maxX + 2, Q.minZ - 1],
        [Q.maxX + 10, Q.minZ - 24],
        [Q.maxX + 6, Q.minZ - 50],
        [Q.maxX - 16, Q.minZ - 70],
        [Q.maxX - 46, Q.minZ - 80],
    ];
    const breakwaters = [
        { pts: bwW, width: 7, top: 2.9, light: 'red' },
        { pts: bwE, width: 7.5, top: 3.0, light: 'green' },
    ];
    /* ---------------- boats ---------------- */
    const boats = [];
    const rb = mulberry32(3131);
    // alongside the quay front between the fish landing and the warehouse, bows east
    {
        let x = plant.x + plant.w / 2 + 6;
        const xEnd = warehouse.x - warehouse.w / 2 - 4;
        let i = 0;
        while (x < xEnd - 8) {
            const type = i % 4 === 1 ? 1 : i % 4 === 3 ? 2 : 0;
            const len = type === 1 ? 13 + rb() * 3 : type === 2 ? 7 + rb() * 1.5 : 9 + rb() * 2.5;
            const beam = len * (type === 2 ? 0.3 : 0.29);
            const cx = x + len / 2;
            if (cx + len / 2 > xEnd)
                break;
            boats.push({ x: cx, z: Q.minZ - beam / 2 - 1.2, hx: 1, hz: (rb() - 0.5) * 0.03, len, type, state: 'afloat', seed: rb() });
            // now and then a second boat moored outside the first
            if (type === 0 && rb() < 0.45) {
                const l2 = 8.5 + rb() * 2;
                boats.push({ x: cx + (rb() - 0.5) * 2, z: Q.minZ - beam - l2 * 0.145 - 1.6, hx: rb() < 0.5 ? 1 : -1, hz: (rb() - 0.5) * 0.04, len: l2, type: 0, state: 'afloat', seed: rb() });
            }
            x += len + 3 + rb() * 4;
            i++;
        }
    }
    // frozen in off the rorbuer rows, moored to their landings
    rorbuer.forEach((r, i) => {
        // every third rorbu has its boat frozen in at the landing
        if (i % 3 !== 1)
            return;
        const zW = r.z - r.d / 2 - 3.2;
        const len = 6.5 + rb() * 3.5;
        boats.push({ x: r.x + (rb() - 0.5) * 1.5, z: zW - len / 2, hx: (rb() - 0.5) * 0.25, hz: -1, len, type: rb() < 0.4 ? 2 : 0, state: 'frozen', seed: rb() });
    });
    // hauled up beside the boathouses, on trestles
    for (const n of naust) {
        if (rb() > 0.6)
            continue;
        const side = rb() < 0.5 ? -1 : 1;
        const x = n.x + side * (n.w / 2 + 2.4);
        const z = n.z + (rb() - 0.3) * 3;
        if (h(x, z) < 0.5 || hitsDot(x, z, 2))
            continue;
        // not on top of the boat hauled up by the neighbouring boathouse
        if (boats.some((b) => b.state === 'land' && Math.hypot(b.x - x, b.z - z) < 3.5))
            continue;
        boats.push({ x, z, hx: (rb() - 0.5) * 0.3, hz: -1, len: 5 + rb() * 1.5, type: 3, state: 'land', seed: rb() });
    }
    /* ---------------- stockfish racks ---------------- */
    const racks = [];
    const rk = mulberry32(8484);
    const rackField = (x0, z0, n, len, dirX, dirZ, rowGap) => {
        for (let i = 0; i < n; i++) {
            const L = len[0] + rk() * (len[1] - len[0]);
            const x = x0 + (rk() - 0.5) * 6 - dirZ * i * rowGap;
            const z = z0 + (rk() - 0.5) * 3 + dirX * i * rowGap;
            const a = (rk() - 0.5) * 0.12;
            const hx = dirX * Math.cos(a) - dirZ * Math.sin(a);
            const hz = dirX * Math.sin(a) + dirZ * Math.cos(a);
            let ok = true;
            for (let s = -L / 2; s <= L / 2; s += 2) {
                const px = x + hx * s;
                const pz = z + hz * s;
                if (h(px, pz) < 0.6 || hitsDot(px, pz, 2) || isReserved(px, pz, 0.5) || placed.some((o) => obbContains(o, px, pz, 2)))
                    ok = false;
            }
            if (!ok)
                continue;
            racks.push({ x, z, hx, hz, len: L, y: h(x, z), seed: Math.floor(rk() * 1e6) });
        }
    };
    // on the rocks west of the rorbuer and up the east headland, rows across the wind
    rackField(Q.minX - 110, Q.maxZ + 4, 4, [14, 22], 0.94, 0.34, 8);
    rackField(Q.maxX + 122, Q.maxZ + 8, 4, [14, 22], 0.92, -0.38, 8);
    rackField(midW.minX - 40, midW.maxZ + 20, 2, [12, 16], 0.85, 0.52, 9);
    /* ---------------- views to keep clear of trees ---------------- */
    const sightlines = [];
    const addSight = (cx, cz, tx, tz, tMax) => sightlines.push({ cx, cz, dx: tx - cx, dz: tz - cz, tMax });
    for (const id of ['village', 'harbor']) {
        const vp = VIEWPOINTS.find((p) => p.id === id);
        if (vp)
            addSight(vp.pos[0], vp.pos[2], vp.target[0], vp.target[2], 0.6);
    }
    // up the main street from the quay to the church
    addSight(gapLow, Q.maxZ, stairX, top.minZ, 1);
    const basin = [VILLAGE.harbor.x, VILLAGE.harbor.z];
    return {
        lanes,
        houses,
        rorbuer,
        naust,
        stabbur,
        sheds,
        store,
        plant,
        warehouse,
        school,
        churchyard: { pad: yardPad, church, stairFoot, stairTop },
        quay: { minX: Q.minX, maxX: Q.maxX, front: Q.minZ, back: Q.maxZ, y: Q.y },
        breakwaters,
        boats,
        racks,
        pathEnd,
        basin,
        shoreZ,
        isFree(x, z, r) {
            if (isReserved(x, z, r) || hitsDot(x, z, r))
                return false;
            if (inBox(Q, x, z, r))
                return false;
            for (const o of placed)
                if (obbContains(o, x, z, r))
                    return false;
            return true;
        },
        onQuay(x, z) {
            return x >= Q.minX && x <= Q.maxX && z >= Q.minZ && z <= Q.maxZ + 0.5;
        },
        blocksView(x, z) {
            for (const s of sightlines) {
                const L2 = s.dx * s.dx + s.dz * s.dz;
                const px = x - s.cx;
                const pz = z - s.cz;
                const t = (px * s.dx + pz * s.dz) / L2;
                if (t < 0.03 || t > s.tMax)
                    continue;
                const L = Math.sqrt(L2);
                const lateral = Math.abs(px * s.dz - pz * s.dx) / L;
                if (lateral < 5 + 0.08 * t * L)
                    return true;
            }
            return false;
        },
    };
}
/** u/v of a world point (re-exported for builders) */
export { toUV, toWorld };
