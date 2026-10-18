/**
 * The glass wing: an A-frame of glass on low tarred knee walls, projecting
 * north from the cabin toward the fjord and the aurora. Slim pine rafters
 * carry the glazed roof (black steel cover caps over the glazing bars, a
 * steel ridge with a roll of snow along it); the north gable is glazed from
 * a low sill to the ridge between pine mullions. South of the partition the
 * wing's roof turns opaque where it runs into the cabin's north slope.
 *
 * Exports the glazing bays (for the wool blinds) and the opaque roof's top
 * faces (for the snow slab).
 */
import * as THREE from 'three';
import { applyBoxUV, glassPane } from '../../core/geometry.js';
import { Batch, boxMinMax, member, slab, snowStrip } from './kit.js';
import { C, CLAD_BOT, KW, NOTCH, PLINTH_BOT, W, W_CX, W_EAVE_DX, W_NORTH, W_ROOF_T, wingTop, wingUnder } from './plan.js';
/** knee wall thickness */
export const KNEE_T = 0.2;
/** the north gable's timber sill: glass starts this high */
export const GABLE_SILL = 0.26;
/** glazing transom across the gable's inner bays */
export const GABLE_TRANSOM = 2.45;
/** rafter pairs (z) from the partition to the north gable, plus the barge rafter on the overhang */
export const RAFTER_Z = (() => {
    const n = 7;
    const out = [];
    for (let i = 0; i <= n; i++)
        out.push(W.maxZ + ((W.minZ - W.maxZ) * i) / n);
    return out;
})();
/** gable mullions (x) */
export const MULLION_X = [0, 1, 2, 3, 4, 5, 6].map((i) => W.minX + i);
const RAFTER_W = 0.075;
const CAP_W = 0.06;
const CAP_H = 0.03;
/** slope direction (unit, eave → ridge) and outward normal of one side of the glass roof */
export function slopeFrame(side) {
    const k = 1 / Math.hypot(1, (W.ridgeH - W.wallH) / ((W.maxX - W.minX) / 2));
    const s = Math.sqrt(1 - k * k);
    // side -1 = west slope (rises toward +x), +1 = east slope (rises toward -x)
    const up = new THREE.Vector3(-side * k, s, 0);
    const along = new THREE.Vector3(0, 0, side < 0 ? 1 : -1);
    const out = new THREE.Vector3().crossVectors(along, up);
    return { up, out, along };
}
/** a convex glass piece in the gable plane (points x, y), with pane coordinates from its bounding box */
function gablePiece(pts, z) {
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const pos = [];
    const nor = [];
    const uv = [];
    const pane = [];
    for (const [x, y] of pts) {
        pos.push(x, y, z);
        nor.push(0, 0, -1);
        // seen from the north, +u runs toward -x
        uv.push((maxX - x) / (maxX - minX), (y - minY) / (maxY - minY));
        pane.push(maxX - x, y - minY, maxX - minX, maxY - minY);
    }
    const idx = [];
    // fan; face north (-z): the points come counter-clockwise seen from +z, so flip
    for (let i = 1; i < pts.length - 1; i++)
        idx.push(0, i + 1, i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aPane', new THREE.Float32BufferAttribute(pane, 4));
    g.setIndex(idx);
    return g;
}
export function buildWing(m) {
    const B = new Batch();
    const xW = W.minX;
    const xE = W.maxX;
    const zN = W.minZ;
    const zS = W.maxZ;
    const roofBays = [];
    const gableBays = [];
    /* ---- plinth, knee walls and the gable sill ---- */
    const inset = 0.025;
    B.add(m.stone, boxMinMax(xW + inset, PLINTH_BOT, zN + inset, xW + inset + 0.3, -0.02, zS), { cast: true, role: 'plinth' });
    B.add(m.stone, boxMinMax(xE - inset - 0.3, PLINTH_BOT, zN + inset, xE - inset, -0.02, zS), { cast: true, role: 'plinth' });
    B.add(m.stone, boxMinMax(xW + inset + 0.3, PLINTH_BOT, zN + inset, xE - inset - 0.3, -0.02, zN + inset + 0.3), { cast: true, role: 'plinth' });
    for (const side of [-1, 1]) {
        const xo = side < 0 ? xW : xE;
        const xi = xo - side * KNEE_T;
        const lo = Math.min(xo, xi);
        const hi = Math.max(xo, xi);
        // outer cladding (vertical boards), up to the roof's underside at the outer face
        const clad = boxMinMax(side < 0 ? xo - 0.001 : xo - 0.03, CLAD_BOT, zN, side < 0 ? xo + 0.03 : xo + 0.001, W.wallH, zS, 'y');
        B.add(m.clad, clad, { cast: true, role: 'walls' });
        // the knee wall's body with a sloped top following the rafters, panelled inside
        const top = (x) => wingUnder(x) - 0.004;
        const body = slab([
            [lo, zN + KNEE_T * 0.8],
            [hi, zN + KNEE_T * 0.8],
            [hi, zS],
            [lo, zS],
        ], (x) => top(x), () => 0, 'all', 'z');
        B.add(m.wallW, body.top, { role: 'interior' });
        body.bottom.dispose();
        if (body.sides)
            B.add(m.wallW, body.sides, { role: 'interior' });
        // blocking between the rafters above the wall: dark outside
        B.add(m.clad, boxMinMax(side < 0 ? xo - 0.002 : xo - 0.035, W.wallH - 0.02, zN, side < 0 ? xo + 0.035 : xo + 0.002, wingTop(xo) - 0.01, zS, 'z'), { cast: true, role: 'walls' });
    }
    // north sill wall under the gable glass
    B.add(m.clad, boxMinMax(xW, CLAD_BOT, zN - 0.002, xE, GABLE_SILL, zN + 0.03, 'y'), { cast: true, role: 'walls' });
    B.add(m.wallW, boxMinMax(xW + KNEE_T, 0, zN + 0.03, xE - KNEE_T, GABLE_SILL, zN + 0.16, 'x'), { role: 'interior' });
    B.add(m.frame, boxMinMax(xW + KNEE_T, GABLE_SILL, zN + 0.0, xE - KNEE_T, GABLE_SILL + 0.035, zN + 0.2, 'x'), { role: 'interior' });
    // floor
    B.add(m.floorW, boxMinMax(xW + KNEE_T, -0.06, zN + 0.16, xE - KNEE_T, 0, zS, 'z'), { role: 'interior' });
    /* ---- rafters, ridge beam, caps ---- */
    const mid = (x) => (wingUnder(x) + wingTop(x)) / 2 - 0.004;
    const xe0 = W_CX - W_EAVE_DX;
    const xe1 = W_CX + W_EAVE_DX;
    const rz = [...RAFTER_Z, W_NORTH + 0.04];
    rz.forEach((z, i) => {
        const w = i === rz.length - 1 ? 0.05 : RAFTER_W;
        for (const xe of [xe0, xe1]) {
            const a = new THREE.Vector3(xe, mid(xe), z);
            const b = new THREE.Vector3(W_CX, mid(W_CX), z);
            B.add(m.frame, member(a, b, w, W_ROOF_T - 0.01), { cast: true, role: 'frame' });
            // the steel cover cap over the glass along the rafter
            const k = (wingTop(W_CX) - wingTop(xe)) / Math.abs(W_CX - xe);
            const off = (CAP_H / 2) * Math.hypot(1, k);
            const ca = new THREE.Vector3(xe, wingTop(xe) + off, z);
            const cb = new THREE.Vector3(W_CX, wingTop(W_CX) + off, z);
            B.add(m.steel, member(ca, cb, CAP_W, CAP_H), { cast: true, role: 'frame' });
        }
    });
    // ridge beam (inside) and the steel ridge over the glass
    B.add(m.frame, boxMinMax(W_CX - 0.07, W.ridgeH - 0.3, W_NORTH + 0.02, W_CX + 0.07, wingTop(W_CX) - 0.01, zS - 0.01, 'z'), { cast: true, role: 'frame' });
    const ridge = boxMinMax(W_CX - 0.17, wingTop(W_CX) - 0.04, W_NORTH - 0.02, W_CX + 0.17, wingTop(W_CX) + 0.06, NOTCH.apexZ + 0.2, 'z');
    B.add(m.steel, ridge, { cast: true, role: 'frame' });
    // mid-slope purlin bars between the rafters (glass in two lengths) and the eave rails
    const purlinT = 0.52;
    for (const side of [-1, 1]) {
        const xe = side < 0 ? xe0 : xe1;
        const xp = xe + (W_CX - xe) * purlinT;
        const k = (wingTop(W_CX) - wingTop(xe)) / Math.abs(W_CX - xe);
        const off = (CAP_H / 2) * Math.hypot(1, k);
        B.add(m.steel, boxMinMax(xp - 0.03, wingTop(xp) - 0.01, W_NORTH, xp + 0.03, wingTop(xp) + off * 1.4, zS, 'z'), { cast: true, role: 'frame' });
        B.add(m.frame, boxMinMax(xp - 0.035, mid(xp) - 0.06, W_NORTH + 0.05, xp + 0.035, wingTop(xp) - 0.01, zS, 'z'), { cast: true, role: 'frame' });
        // eave: a steel fascia and gutter rail
        B.add(m.steel, boxMinMax(xe - (side < 0 ? 0.04 : -0.0), wingUnder(xe) - 0.05, W_NORTH - 0.02, xe + (side < 0 ? 0 : 0.04), wingTop(xe) + 0.03, zS, 'z'), { cast: true, role: 'frame' });
        for (let i = 0; i < rz.length - 1; i++) {
            const z0 = Math.max(rz[i], rz[i + 1]);
            const z1 = Math.min(rz[i], rz[i + 1]);
            roofBays.push({ side, z0, z1, x0: xe, x1: W_CX });
        }
    }
    /* ---- roof glass ---- */
    for (const bay of roofBays) {
        const { up, out, along } = slopeFrame(bay.side);
        const xp = bay.x0 + (bay.x1 - bay.x0) * purlinT;
        const spans = [
            [bay.x0, xp],
            [xp, bay.x1],
        ];
        const zc = (bay.z0 + bay.z1) / 2;
        const bw = Math.abs(bay.z0 - bay.z1) + 0.01;
        for (const [xa, xb] of spans) {
            const pa = new THREE.Vector3(xa, wingTop(xa) + 0.002, zc);
            const pb = new THREE.Vector3(xb, wingTop(xb) + 0.002, zc);
            const len = pa.distanceTo(pb);
            const g = glassPane(bw, len);
            g.applyMatrix4(new THREE.Matrix4().makeBasis(along, up, out).setPosition(pa.clone().add(pb).multiplyScalar(0.5)));
            B.add(m.glassW, g, { role: 'glass', receive: false });
        }
    }
    /* ---- north gable: mullions, transom, glass ---- */
    const zg = zN + 0.04;
    for (const x of MULLION_X) {
        const top = wingUnder(x) + (x === W_CX ? 0 : 0);
        const half = x === xW || x === xE ? 0.06 : 0.045;
        const x0 = x === xW ? x : x === xE ? x - 2 * half : x - half;
        B.add(m.frame, boxMinMax(x0, GABLE_SILL, zN - 0.02, x0 + 2 * half, Math.max(GABLE_SILL + 0.1, top), zN + 0.14, 'y'), { cast: true, role: 'frame' });
        B.add(m.steel, boxMinMax(x0 + 0.005, GABLE_SILL, zN - 0.045, x0 + 2 * half - 0.005, Math.max(GABLE_SILL + 0.1, top), zN - 0.02, 'y'), { cast: true, role: 'frame' });
    }
    for (let i = 0; i < MULLION_X.length - 1; i++) {
        const xa = MULLION_X[i];
        const xb = MULLION_X[i + 1];
        const ya = wingUnder(xa);
        const yb = wingUnder(xb);
        const yLow = Math.min(ya, yb);
        const yHigh = Math.max(ya, yb);
        const transom = yHigh > GABLE_TRANSOM + 0.6 ? GABLE_TRANSOM : null;
        const xl = xa + 0.045;
        const xr = xb - 0.045;
        // lower pane
        const lower = [
            [xl, GABLE_SILL],
            [xr, GABLE_SILL],
            [xr, transom ?? wingUnder(xr)],
            [xl, transom ?? wingUnder(xl)],
        ];
        B.add(m.glassW, gablePiece(lower, zg), { role: 'glass', receive: false });
        gableBays.push({ x0: xl, x1: xr, y0: GABLE_SILL, y1: transom ?? yLow });
        if (transom !== null) {
            B.add(m.frame, boxMinMax(xa, transom - 0.04, zN - 0.02, xb, transom + 0.04, zN + 0.12, 'x'), { cast: true, role: 'frame' });
            B.add(m.steel, boxMinMax(xa, transom - 0.035, zN - 0.04, xb, transom + 0.035, zN - 0.02, 'x'), { cast: true, role: 'frame' });
            const upper = [
                [xl, transom + 0.04],
                [xr, transom + 0.04],
                [xr, wingUnder(xr)],
                [xl, wingUnder(xl)],
            ];
            B.add(m.glassW, gablePiece(upper, zg), { role: 'glass', receive: false });
        }
    }
    /* ---- the opaque valley roof south of the partition ---- */
    const roofTops = [];
    for (const side of [-1, 1]) {
        const xw = side < 0 ? NOTCH.wallX0 : NOTCH.wallX1;
        const plan = [
            [xw, C.minZ],
            [W_CX, C.minZ],
            [W_CX, NOTCH.apexZ],
        ];
        const s = slab(plan, (x) => wingTop(x), (x) => wingUnder(x), [], 'z');
        B.add(m.roof, s.top, { cast: true, role: 'roof' });
        // no underside: it lies inside the cabin's roof space, and near the wing's eaves it dips below the
        // cabin's ceiling, where it showed through as a dark strip from the living room
        s.bottom.dispose();
        roofTops.push(s.top);
    }
    /* ---- snow roll along the glass ridge ---- */
    {
        B.add(m.snow, ridgeSnow(W_NORTH - 0.02, NOTCH.apexZ + 0.1, 31), { role: 'snow', cast: true });
        // and a little on each steel cover cap, thinning toward the ridge where the wind scours it
        let seed = 1;
        for (const z of RAFTER_Z) {
            for (const xe of [xe0, xe1]) {
                const k = (wingTop(W_CX) - wingTop(xe)) / Math.abs(W_CX - xe);
                const off = CAP_H * Math.hypot(1, k);
                const a = new THREE.Vector3(xe + (W_CX - xe) * 0.02, wingTop(xe) + off, z);
                const b = new THREE.Vector3(W_CX - (W_CX - xe) * 0.05, wingTop(W_CX) + off, z);
                const n = xe < W_CX ? new THREE.Vector3(-k, 1, 0).normalize() : new THREE.Vector3(k, 1, 0).normalize();
                B.add(m.snow, snowStrip(a, b, CAP_W + 0.03, 0.045, seed++, n), { role: 'snow' });
            }
        }
    }
    return { meshes: B.build('wing'), roofTops, roofBays, gableBays };
}
/**
 * The snow saddle along the glass ridge: a rounded crest over the steel ridge
 * whose flanks thin out down both slopes onto the glass, wandering in height
 * and reach along its length, tapering at the ends. Seen from the beds it is a
 * white band along the top of every roof pane.
 */
function ridgeSnow(z0, z1, seed) {
    const ridge = wingTop(W_CX) + 0.06;
    const len = Math.abs(z1 - z0);
    const segs = Math.max(8, Math.round(len / 0.12));
    const prof = 12;
    let st = seed * 9301 + 49297;
    const rnd = () => ((st = (st * 9301 + 49297) % 233280) / 233280);
    const k = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const pos = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const z = z0 + (z1 - z0) * t;
        const d = t * len;
        // the ends: rounded off over the gable's overhang, thinner where the cabin's roof shelters it
        const end = Math.min(1, (d / 0.35) ** 0.6, ((len - d) / 0.6) ** 0.8);
        const wob = (f, p) => Math.sin(d * f + p);
        const crest = (0.19 + 0.05 * wob(1.9, k[0]) + 0.03 * wob(5.3, k[1])) * end;
        for (const side of [-1, 1]) {
            // each flank reaches its own way down the slope
            const R = 0.42 + 0.08 * wob(1.3, k[side < 0 ? 2 : 3]) + 0.04 * wob(4.1, k[side < 0 ? 3 : 2]);
            for (let j = 0; j <= prof; j++) {
                if (side > 0 && j === 0)
                    continue;
                const u = j / prof;
                // u = 0 on the crest, 1 where the flank meets the glass
                const y = ridge + crest * (1 - u * u) - KW * R * u * u;
                pos.push(W_CX + side * R * u, Math.max(y, ridge - KW * R * u + 0.004), z);
            }
        }
    }
    const row = 2 * prof + 1;
    // per ring: the west flank from the crest outward (j = 0..prof), then the east flank (1..prof)
    const at = (i, sx) => i * row + sx;
    // order the ring west-edge → crest → east-edge
    const ringIdx = (j) => (j <= prof ? prof - j : j);
    for (let i = 0; i < segs; i++) {
        for (let j = 0; j < 2 * prof; j++) {
            const a = at(i, ringIdx(j));
            const b = at(i, ringIdx(j + 1));
            const c = at(i + 1, ringIdx(j));
            const d = at(i + 1, ringIdx(j + 1));
            idx.push(a, c, b, b, c, d);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // face up
    const n = g.getAttribute('normal');
    let up = 0;
    for (let i = 0; i < n.count; i++)
        up += n.getY(i);
    if (up < 0) {
        for (let i = 0; i < idx.length; i += 3) {
            const tmp = idx[i + 1];
            idx[i + 1] = idx[i + 2];
            idx[i + 2] = tmp;
        }
        g.setIndex(idx);
        g.computeVertexNormals();
    }
    return applyBoxUV(g);
}
