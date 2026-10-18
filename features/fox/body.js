/**
 * The arctic fox's body, built procedurally: a smooth blend of ellipsoids
 * and round cones (a signed distance field) turned into a mesh by surface
 * nets, skinned to a small skeleton (spine, neck, head, ears, five tail
 * bones, three bones per leg) with weights from the same field, and painted
 * with per-vertex fur length and colour. Winter coat: a round, dense body,
 * short legs, small rounded ears, a short muzzle and a huge bushy tail.
 *
 * Fox space: +z forward (nose), +y up, +x the fox's left; the origin on the
 * ground under the middle of the body. The rest pose is standing.
 */
import * as THREE from 'three';
/** bone names in index order (parents first) */
export const BONES = [
    'root',
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'earL',
    'earR',
    'tail1',
    'tail2',
    'tail3',
    'tail4',
    'tail5',
    'shoulderL',
    'elbowL',
    'wristL',
    'shoulderR',
    'elbowR',
    'wristR',
    'hipL',
    'kneeL',
    'hockL',
    'hipR',
    'kneeR',
    'hockR',
];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const JOINT = {
    root: { p: [0, 0, 0], parent: null },
    hips: { p: [0, 0.26, -0.13], parent: 'root' },
    spine: { p: [0, 0.27, 0.0], parent: 'hips' },
    chest: { p: [0, 0.27, 0.12], parent: 'spine' },
    neck: { p: [0, 0.29, 0.19], parent: 'chest' },
    head: { p: [0, 0.355, 0.265], parent: 'neck' },
    earL: { p: [0.034, 0.405, 0.282], parent: 'head' },
    earR: { p: [-0.034, 0.405, 0.282], parent: 'head' },
    tail1: { p: [0, 0.285, -0.225], parent: 'hips' },
    tail2: { p: [0, 0.27, -0.3], parent: 'tail1' },
    tail3: { p: [0, 0.252, -0.375], parent: 'tail2' },
    tail4: { p: [0, 0.236, -0.45], parent: 'tail3' },
    tail5: { p: [0, 0.222, -0.525], parent: 'tail4' },
    shoulderL: { p: [0.055, 0.235, 0.15], parent: 'chest' },
    elbowL: { p: [0.055, 0.135, 0.162], parent: 'shoulderL' },
    wristL: { p: [0.055, 0.048, 0.152], parent: 'elbowL' },
    shoulderR: { p: [-0.055, 0.235, 0.15], parent: 'chest' },
    elbowR: { p: [-0.055, 0.135, 0.162], parent: 'shoulderR' },
    wristR: { p: [-0.055, 0.048, 0.152], parent: 'elbowR' },
    hipL: { p: [0.058, 0.235, -0.15], parent: 'hips' },
    kneeL: { p: [0.058, 0.15, -0.1], parent: 'hipL' },
    hockL: { p: [0.058, 0.078, -0.19], parent: 'kneeL' },
    hipR: { p: [-0.058, 0.235, -0.15], parent: 'hips' },
    kneeR: { p: [-0.058, 0.15, -0.1], parent: 'hipR' },
    hockR: { p: [-0.058, 0.078, -0.19], parent: 'kneeR' },
};
export function jointRest(name) {
    return new THREE.Vector3(...JOINT[name].p);
}
const WHITE = [0.95, 0.94, 0.91];
const CREAM = [0.95, 0.92, 0.85];
const GREYW = [0.8, 0.8, 0.8];
const BLACK = [0.02, 0.018, 0.018];
const NOSE_GREY = [0.16, 0.14, 0.14];
export const ell = (c, r, bone, fur, col = WHITE, k = 0.035) => ({ kind: 0, a: c, b: c, r, r1: 0, r2: 0, bone: B[bone], fur, col, k });
export const cone = (a, b, r1, r2, bone, fur, col = WHITE, k = 0.03) => ({ kind: 1, a, b, r: [0, 0, 0], r1, r2, bone: B[bone], fur, col, k });
export const mir = (p) => [-p[0], p[1], p[2]];
function primitives() {
    const P = [
        // body: round and dense in the winter coat
        ell([0, 0.255, -0.1], [0.1, 0.1, 0.12], 'hips', 0.038),
        ell([0, 0.262, 0.02], [0.098, 0.105, 0.12], 'spine', 0.04),
        ell([0, 0.258, 0.125], [0.094, 0.108, 0.09], 'chest', 0.04),
        // the ruff on the chest, creamy
        ell([0, 0.222, 0.175], [0.07, 0.075, 0.055], 'chest', 0.05, CREAM),
        // neck and head
        cone([0, 0.27, 0.16], [0, 0.335, 0.245], 0.068, 0.054, 'neck', 0.045),
        ell([0, 0.37, 0.29], [0.06, 0.055, 0.066], 'head', 0.02),
        ell([0.036, 0.352, 0.292], [0.04, 0.038, 0.044], 'head', 0.032),
        ell(mir([0.036, 0.352, 0.292]), [0.04, 0.038, 0.044], 'head', 0.032),
        // a short muzzle, furred to the nose, the cheeks puffed out round it
        cone([0, 0.357, 0.318], [0, 0.344, 0.394], 0.033, 0.0125, 'head', 0.01, WHITE, 0.026),
        ell([0.03, 0.344, 0.318], [0.034, 0.03, 0.036], 'head', 0.03, WHITE, 0.03),
        ell(mir([0.03, 0.344, 0.318]), [0.034, 0.03, 0.036], 'head', 0.03, WHITE, 0.03),
        // the black leather of the nose, and the dark line of the mouth under it
        ell([0, 0.347, 0.406], [0.0128, 0.0102, 0.009], 'head', 0, BLACK, 0.005),
        ell([0, 0.331, 0.379], [0.008, 0.0038, 0.012], 'head', 0, NOSE_GREY, 0.004),
        // ears: short, broad and rounded, set wide
        cone([0.036, 0.398, 0.279], [0.056, 0.451, 0.268], 0.027, 0.0095, 'earL', 0.01, WHITE, 0.012),
        cone(mir([0.036, 0.398, 0.279]), mir([0.056, 0.451, 0.268]), 0.027, 0.0095, 'earR', 0.01, WHITE, 0.012),
    ];
    // the brush: a fat, tapering tail
    const tailPts = [
        [0, 0.285, -0.22],
        [0, 0.272, -0.28],
        [0, 0.258, -0.34],
        [0, 0.245, -0.4],
        [0, 0.233, -0.46],
        [0, 0.224, -0.515],
        [0, 0.218, -0.56],
    ];
    const tailR = [0.035, 0.05, 0.06, 0.064, 0.06, 0.05, 0.034];
    const tailJoints = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
    for (let i = 0; i < tailPts.length - 1; i++) {
        // the bone whose joint the segment's middle has passed
        const mz = (tailPts[i][2] + tailPts[i + 1][2]) / 2;
        let bone = 'tail1';
        for (const t of tailJoints)
            if (JOINT[t].p[2] >= mz)
                bone = t;
        P.push(cone(tailPts[i], tailPts[i + 1], tailR[i], tailR[i + 1], bone, 0.06, WHITE, 0.03));
    }
    // legs (left; mirrored for the right)
    for (const side of ['L', 'R']) {
        const m = side === 'L' ? (p) => p : mir;
        const b = (n) => `${n}${side}`;
        P.push(ell(m([0.05, 0.232, 0.14]), [0.042, 0.07, 0.055], b('shoulder'), 0.035));
        P.push(cone(m([0.055, 0.235, 0.15]), m([0.055, 0.135, 0.162]), 0.034, 0.024, b('shoulder'), 0.025));
        P.push(cone(m([0.055, 0.135, 0.162]), m([0.055, 0.048, 0.152]), 0.022, 0.018, b('elbow'), 0.016));
        P.push(cone(m([0.055, 0.048, 0.152]), m([0.055, 0.024, 0.165]), 0.018, 0.019, b('wrist'), 0.018, WHITE, 0.012));
        P.push(ell(m([0.055, 0.02, 0.172]), [0.024, 0.019, 0.034], b('wrist'), 0.02, GREYW, 0.012));
        P.push(ell(m([0.052, 0.228, -0.14]), [0.058, 0.085, 0.085], b('hip'), 0.038));
        P.push(cone(m([0.058, 0.232, -0.15]), m([0.058, 0.15, -0.1]), 0.05, 0.03, b('hip'), 0.03));
        P.push(cone(m([0.058, 0.15, -0.1]), m([0.058, 0.078, -0.19]), 0.025, 0.017, b('knee'), 0.018));
        P.push(cone(m([0.058, 0.078, -0.19]), m([0.058, 0.026, -0.17]), 0.017, 0.018, b('hock'), 0.016, WHITE, 0.012));
        P.push(ell(m([0.058, 0.02, -0.155]), [0.024, 0.019, 0.034], b('hock'), 0.02, GREYW, 0.012));
    }
    return P;
}
/* ---------------- distance functions ---------------- */
function sdEll(px, py, pz, p) {
    const x = px - p.a[0];
    const y = py - p.a[1];
    const z = pz - p.a[2];
    const ax = x / p.r[0];
    const ay = y / p.r[1];
    const az = z / p.r[2];
    const bx = ax / p.r[0];
    const by = ay / p.r[1];
    const bz = az / p.r[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.r[0], p.r[1], p.r[2]);
}
/** round cone between a (radius r1) and b (radius r2) (iq) */
function sdCone(px, py, pz, p) {
    const bax = p.b[0] - p.a[0];
    const bay = p.b[1] - p.a[1];
    const baz = p.b[2] - p.a[2];
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = p.r1 - p.r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pax = px - p.a[0];
    const pay = py - p.a[1];
    const paz = pz - p.a[2];
    const y = pax * bax + pay * bay + paz * baz;
    const z = y - l2;
    const qx = pax * l2 - bax * y;
    const qy = pay * l2 - bay * y;
    const qz = paz * l2 - baz * y;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = y * y * l2;
    const z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k)
        return Math.sqrt(x2 + z2) * il2 - p.r2;
    if (Math.sign(y) * a2 * y2 < k)
        return Math.sqrt(x2 + y2) * il2 - p.r1;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - p.r1;
}
function sdPrim(x, y, z, p) {
    return p.kind === 0 ? sdEll(x, y, z, p) : sdCone(x, y, z, p);
}
/** polynomial smooth minimum */
function smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}
/**
 * Build the fox: surface nets over the SDF on a grid of `cell` metres.
 * Attributes: position, normal, color, skinIndex, skinWeight, aFur (fur length in m).
 */
export function buildFoxBody(cell = 0.011) {
    return buildBody({
        joints: JOINT,
        prims: primitives(),
        eyes: { l: [0.031, 0.378, 0.338], r: [-0.031, 0.378, 0.338], radius: 0.0102 },
        nose: [0, 0.347, 0.406],
        blend: 0.012,
        colorBlend: 0.004,
        eyeRim: 2.6,
    }, cell);
}
/** Build any animal from a BodySpec (see buildFoxBody). */
export function buildBody(spec, cell) {
    const prims = spec.prims;
    const JOINT = spec.joints;
    // bounds
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const p of prims) {
        const r = p.kind === 0 ? Math.max(...p.r) : Math.max(p.r1, p.r2);
        for (const q of [p.a, p.b]) {
            minX = Math.min(minX, q[0] - r);
            minY = Math.min(minY, q[1] - r);
            minZ = Math.min(minZ, q[2] - r);
            maxX = Math.max(maxX, q[0] + r);
            maxY = Math.max(maxY, q[1] + r);
            maxZ = Math.max(maxZ, q[2] + r);
        }
    }
    const pad = cell * 2;
    minX -= pad;
    minY -= pad;
    minZ -= pad;
    maxX += pad;
    maxY += pad;
    maxZ += pad;
    const nx = Math.ceil((maxX - minX) / cell) + 1;
    const ny = Math.ceil((maxY - minY) / cell) + 1;
    const nz = Math.ceil((maxZ - minZ) / cell) + 1;
    // field (with a per-primitive bounding test to skip far primitives cheaply)
    const field = new Float32Array(nx * ny * nz);
    const reach = prims.map((p) => {
        const r = p.kind === 0 ? Math.max(...p.r) : Math.max(p.r1, p.r2);
        const cx = (p.a[0] + p.b[0]) / 2;
        const cy = (p.a[1] + p.b[1]) / 2;
        const cz = (p.a[2] + p.b[2]) / 2;
        const half = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
        return { cx, cy, cz, R: r + half + p.k + cell * 3 };
    });
    const sdf = (x, y, z) => {
        let d = 1;
        for (let i = 0; i < prims.length; i++) {
            const rc = reach[i];
            const dx = x - rc.cx;
            const dy = y - rc.cy;
            const dz = z - rc.cz;
            if (dx * dx + dy * dy + dz * dz > rc.R * rc.R)
                continue;
            d = smin(d, sdPrim(x, y, z, prims[i]), prims[i].k);
        }
        return d;
    };
    for (let k = 0; k < nz; k++) {
        const z = minZ + k * cell;
        for (let j = 0; j < ny; j++) {
            const y = minY + j * cell;
            for (let i = 0; i < nx; i++)
                field[(k * ny + j) * nx + i] = sdf(minX + i * cell, y, z);
        }
    }
    const F = (i, j, k) => field[(k * ny + j) * nx + i];
    // surface nets: one vertex per cell that straddles the surface
    const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const pos = [];
    const corner = new Float32Array(8);
    // corner c = (c & 1, (c >> 1) & 1, (c >> 2) & 1); the 12 cube edges as corner pairs
    const OX = [0, 1, 0, 1, 0, 1, 0, 1];
    const OY = [0, 0, 1, 1, 0, 0, 1, 1];
    const OZ = [0, 0, 0, 0, 1, 1, 1, 1];
    const E0 = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
    const E1 = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
    const far = cell * 2.5;
    for (let k = 0; k < nz - 1; k++) {
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const f000 = field[(k * ny + j) * nx + i];
                // the field is roughly a distance: a cell this far from the surface cannot contain it
                if (f000 > far || f000 < -far)
                    continue;
                let mask = 0;
                for (let c = 0; c < 8; c++) {
                    const v = field[((k + OZ[c]) * ny + j + OY[c]) * nx + i + OX[c]];
                    corner[c] = v;
                    if (v < 0)
                        mask |= 1 << c;
                }
                if (mask === 0 || mask === 255)
                    continue;
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let n = 0;
                for (let e2 = 0; e2 < 12; e2++) {
                    const c0 = E0[e2];
                    const c1 = E1[e2];
                    const f0 = corner[c0];
                    const f1 = corner[c1];
                    if (f0 < 0 === f1 < 0)
                        continue;
                    const t = f0 / (f0 - f1);
                    sx += OX[c0] + (OX[c1] - OX[c0]) * t;
                    sy += OY[c0] + (OY[c1] - OY[c0]) * t;
                    sz += OZ[c0] + (OZ[c1] - OZ[c0]) * t;
                    n++;
                }
                cellVert[(k * (ny - 1) + j) * (nx - 1) + i] = pos.length / 3;
                pos.push(minX + (i + sx / n) * cell, minY + (j + sy / n) * cell, minZ + (k + sz / n) * cell);
            }
        }
    }
    const CV = (i, j, k) => cellVert[(k * (ny - 1) + j) * (nx - 1) + i];
    const idx = [];
    // quads across every grid edge with a sign change
    for (let k = 1; k < nz - 1; k++) {
        for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
                const f0 = F(i, j, k);
                if (f0 > far || f0 < -far)
                    continue;
                const inside = f0 < 0;
                // x edge (i,j,k)-(i+1,j,k): cells sharing it differ in j-1/j, k-1/k
                if (i < nx - 1 && inside !== F(i + 1, j, k) < 0) {
                    const a = CV(i, j - 1, k - 1);
                    const b2 = CV(i, j, k - 1);
                    const c = CV(i, j, k);
                    const d = CV(i, j - 1, k);
                    if (a >= 0 && b2 >= 0 && c >= 0 && d >= 0) {
                        if (inside)
                            idx.push(a, b2, c, a, c, d);
                        else
                            idx.push(a, c, b2, a, d, c);
                    }
                }
                if (j < ny - 1 && inside !== F(i, j + 1, k) < 0) {
                    const a = CV(i - 1, j, k - 1);
                    const b2 = CV(i, j, k - 1);
                    const c = CV(i, j, k);
                    const d = CV(i - 1, j, k);
                    if (a >= 0 && b2 >= 0 && c >= 0 && d >= 0) {
                        if (inside)
                            idx.push(a, c, b2, a, d, c);
                        else
                            idx.push(a, b2, c, a, c, d);
                    }
                }
                if (k < nz - 1 && inside !== F(i, j, k + 1) < 0) {
                    const a = CV(i - 1, j - 1, k);
                    const b2 = CV(i, j - 1, k);
                    const c = CV(i, j, k);
                    const d = CV(i - 1, j, k);
                    if (a >= 0 && b2 >= 0 && c >= 0 && d >= 0) {
                        if (inside)
                            idx.push(a, b2, c, a, c, d);
                        else
                            idx.push(a, c, b2, a, d, c);
                    }
                }
            }
        }
    }
    const nv = pos.length / 3;
    // normals from the field's gradient; skin weights, fur and colour from the primitives
    const nrm = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const fur = new Float32Array(nv);
    const skinIndex = new Uint16Array(nv * 4);
    const skinWeight = new Float32Array(nv * 4);
    const e = cell * 0.5;
    const eyes = {
        l: new THREE.Vector3(...spec.eyes.l),
        r: new THREE.Vector3(...spec.eyes.r),
        radius: spec.eyes.radius,
    };
    // seat each eye in the surface: its centre a third of a radius under the skin, so it bulges
    for (const ep of [eyes.l, eyes.r]) {
        for (let it = 0; it < 6; it++) {
            const d = sdf(ep.x, ep.y, ep.z);
            const gx = sdf(ep.x + e, ep.y, ep.z) - sdf(ep.x - e, ep.y, ep.z);
            const gy = sdf(ep.x, ep.y + e, ep.z) - sdf(ep.x, ep.y - e, ep.z);
            const gz = sdf(ep.x, ep.y, ep.z + e) - sdf(ep.x, ep.y, ep.z - e);
            const gl = Math.hypot(gx, gy, gz) || 1;
            const step = d + eyes.radius * 0.35;
            ep.x -= (gx / gl) * step;
            ep.y -= (gy / gl) * step;
            ep.z -= (gz / gl) * step;
        }
    }
    const nose = spec.nose ? new THREE.Vector3(...spec.nose) : new THREE.Vector3(0, -100, 0);
    const colorBlend = spec.colorBlend ?? spec.blend;
    const eyeRim = spec.eyeRim ?? 2.2;
    const boneW = new Float32Array(BONES.length);
    const pv = new THREE.Vector3();
    const dist = new Float32Array(prims.length);
    for (let v = 0; v < nv; v++) {
        const x = pos[v * 3];
        const y = pos[v * 3 + 1];
        const z = pos[v * 3 + 2];
        const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
        const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
        const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) || 1;
        nrm[v * 3] = gx / gl;
        nrm[v * 3 + 1] = gy / gl;
        nrm[v * 3 + 2] = gz / gl;
        let dmin = Infinity;
        for (let i = 0; i < prims.length; i++) {
            dist[i] = sdPrim(x, y, z, prims[i]);
            dmin = Math.min(dmin, dist[i]);
        }
        boneW.fill(0);
        let wsum = 0;
        let fl = 0;
        let cr = 0;
        let cg = 0;
        let cb = 0;
        let csum = 0;
        for (let i = 0; i < prims.length; i++) {
            const w = Math.exp(-(dist[i] - dmin) / spec.blend);
            if (w < 1e-4)
                continue;
            const p = prims[i];
            boneW[p.bone] += w;
            wsum += w;
            fl += p.fur * w;
            const wc = Math.exp(-(dist[i] - dmin) / colorBlend);
            csum += wc;
            cr += p.col[0] * wc;
            cg += p.col[1] * wc;
            cb += p.col[2] * wc;
        }
        // keep the four strongest bones
        const order = [];
        for (let b = 0; b < boneW.length; b++)
            if (boneW[b] > 0)
                order.push(b);
        order.sort((a, b) => boneW[b] - boneW[a]);
        order.length = Math.min(order.length, 4);
        let ws = 0;
        for (const b of order)
            ws += boneW[b];
        order.forEach((b, s) => {
            skinIndex[v * 4 + s] = b;
            skinWeight[v * 4 + s] = boneW[b] / ws;
        });
        let f = fl / wsum;
        // no fur over the eyes and the nose; a dark rim round the eyes
        pv.set(x, y, z);
        const de = Math.min(pv.distanceTo(eyes.l), pv.distanceTo(eyes.r));
        f *= THREE.MathUtils.smoothstep(de, eyes.radius * 1.1, eyes.radius * (eyeRim + 0.5));
        f *= THREE.MathUtils.smoothstep(pv.distanceTo(nose), eyes.radius * 1.4, eyes.radius * 3.5);
        // shorter fur under the belly and inside the legs
        const under = Math.max(0, -nrm[v * 3 + 1]) * THREE.MathUtils.smoothstep(y, 0.12, 0.2);
        f *= 1 - 0.4 * under;
        fur[v] = f;
        let r = cr / csum;
        let g = cg / csum;
        let b = cb / csum;
        const rim = 1 - THREE.MathUtils.smoothstep(de, eyes.radius * 1.15, eyes.radius * eyeRim);
        r *= 1 - 0.85 * rim;
        g *= 1 - 0.85 * rim;
        b *= 1 - 0.85 * rim;
        col[v * 3] = r;
        col[v * 3 + 1] = g;
        col[v * 3 + 2] = b;
    }
    // orient every triangle with the field's gradient (outward)
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3;
        const b2 = idx[t + 1] * 3;
        const c = idx[t + 2] * 3;
        const ux = pos[b2] - pos[a];
        const uy = pos[b2 + 1] - pos[a + 1];
        const uz = pos[b2 + 2] - pos[a + 2];
        const vx = pos[c] - pos[a];
        const vy = pos[c + 1] - pos[a + 1];
        const vz = pos[c + 2] - pos[a + 2];
        const fx = uy * vz - uz * vy;
        const fy = uz * vx - ux * vz;
        const fz = ux * vy - uy * vx;
        const gx = nrm[a] + nrm[b2] + nrm[c];
        const gy = nrm[a + 1] + nrm[b2 + 1] + nrm[c + 1];
        const gz = nrm[a + 2] + nrm[b2 + 2] + nrm[c + 2];
        if (fx * gx + fy * gy + fz * gz < 0) {
            const tmp = idx[t + 1];
            idx[t + 1] = idx[t + 2];
            idx[t + 2] = tmp;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aFur', new THREE.BufferAttribute(fur, 1));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    // the skeleton in its rest pose
    const bones = [];
    for (const name of BONES) {
        const b = new THREE.Bone();
        b.name = name;
        const j = JOINT[name];
        const p = new THREE.Vector3(...j.p);
        if (j.parent) {
            p.sub(new THREE.Vector3(...JOINT[j.parent].p));
            bones[B[j.parent]].add(b);
        }
        b.position.copy(p);
        bones.push(b);
    }
    return { geometry: geo, bones, eyes };
}
