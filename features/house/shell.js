/**
 * The main cabin's fabric: fieldstone plinth, near-black tarred
 * board-and-batten walls with deep-set, white-trimmed six-light windows, the
 * steep gable roof (notched where the glass wing runs into it) with its
 * fascias, barge boards, thick snow slab and icicles, the fieldstone chimney,
 * and the interior shell: pine floor, panelled walls and vaulted ceiling,
 * tie beams, the chimney breast and the stone hearth.
 *
 * Everything is merged per material through kit.Batch; roles name the parts
 * for the info cards.
 */
import * as THREE from 'three';
import { applyBoxUV, glassPane, icicles, snowCap } from '../../core/geometry.js';
import { HOUSE } from '../../world/layout.js';
import { mulberry32 } from '../../world/noise.js';
import { Batch, boxMinMax, member, mergeAll, planeFace, slab, snowStrip } from './kit.js';
import { C, CLAD_BOT, C_EAVE_Z, C_MIDZ, C_RAKE_X, GLASS_IN, NOTCH, OPENINGS, PLINTH_BOT, TRIM_T, TRIM_W, W, WALLS, WALL_T, W_CX, W_EAVE_DX, cabinTop, cabinUnder, isInterior, openingsOn, wingTop, wingUnder, } from './plan.js';
/** ceiling lining sits this far under the roof's underside */
const CEIL_GAP = 0.02;
const CH = HOUSE.chimney;
/* ------------------------------ wall frames ------------------------------ */
/**
 * Wall coordinates: a along the wall (left to right seen from outside), y up,
 * n outward from the outer face (n = 0 on the face, -WALL_T on the inner face).
 */
export function wallMatrix(f) {
    const N = new THREE.Vector3(f.nx, 0, f.nz);
    const Y = new THREE.Vector3(0, 1, 0);
    const U = new THREE.Vector3().crossVectors(Y, N); // U × Y = N
    const O = f.axis === 'x' ? new THREE.Vector3(0, 0, f.face) : new THREE.Vector3(f.face, 0, 0);
    return new THREE.Matrix4().makeBasis(U, Y, N).setPosition(O);
}
/** wall coordinate a of a position s along the wall's axis (x or z) */
export function aOf(f, s) {
    // U = Y × N: south (+z) → +x, north → -x, east (+x) → -z, west → +z
    if (f.axis === 'x')
        return f.nz > 0 ? s : -s;
    return f.nx > 0 ? -s : s;
}
/** box in wall coordinates (a, y, n ranges) */
function wbox(M, a0, a1, y0, y1, n0, n1, grain) {
    const g = boxMinMax(Math.min(a0, a1), Math.min(y0, y1), Math.min(n0, n1), Math.max(a0, a1), Math.max(y0, y1), Math.max(n0, n1), grain);
    return g.applyMatrix4(M);
}
/** a face in wall coordinates at depth n, looking outward (+n) or inward */
function wface(M, n, outward, contour, holes, grain = 'y') {
    const U = new THREE.Vector3(outward ? 1 : -1, 0, 0);
    const V = new THREE.Vector3(0, 1, 0);
    const flip = (p) => (outward ? p : [-p[0], p[1]]);
    const g = planeFace(new THREE.Vector3(0, 0, n), U, V, contour.map(flip), holes.map((h) => h.map(flip)), grain);
    return g.applyMatrix4(M);
}
const rect = (a0, a1, y0, y1) => [
    [a0, y0],
    [a1, y0],
    [a1, y1],
    [a0, y1],
];
function openingRect(f, o) {
    const p = aOf(f, o.c - o.w / 2);
    const q = aOf(f, o.c + o.w / 2);
    return { a0: Math.min(p, q), a1: Math.max(p, q), y0: o.sill, y1: o.head };
}
/* ------------------------------ wall outlines ------------------------------ */
/** outer cladding outline of each wall in wall coordinates (a, y) */
function outerOutline(wall) {
    const f = WALLS[wall];
    const A = (s) => aOf(f, s);
    if (wall === 'south')
        return [rect(A(C.minX), A(C.maxX), CLAD_BOT, C.wallH)];
    if (wall === 'east' || wall === 'west') {
        // gable pentagon up to the roof's underside
        const s0 = C.minZ;
        const s1 = C.maxZ;
        const pts = [
            [A(s0), CLAD_BOT],
            [A(s1), CLAD_BOT],
            [A(s1), cabinUnder(s1)],
            [A(C_MIDZ), C.ridgeH],
            [A(s0), cabinUnder(s0)],
        ];
        return [pts];
    }
    // north: west of the wing full height; over the wing only above its roof
    const wy = (x) => wingTop(x);
    const west = [
        [A(C.minX), CLAD_BOT],
        [A(W.minX), CLAD_BOT],
        [A(W.minX), wy(W.minX)],
        [A(NOTCH.wallX0), C.wallH],
        [A(C.minX), C.wallH],
    ];
    const east = [
        [A(NOTCH.wallX1), C.wallH],
        [A(W.maxX), wy(W.maxX)],
        [A(W.maxX), CLAD_BOT],
        [A(C.maxX), CLAD_BOT],
        [A(C.maxX), C.wallH],
    ];
    return [west, east];
}
/** inner lining outline (inside the cabin, a in wall coordinates of the outer frame) */
function innerOutline(wall) {
    const f = WALLS[wall];
    const A = (s) => aOf(f, s);
    const xi0 = C.minX + WALL_T;
    const xi1 = C.maxX - WALL_T;
    const zi0 = C.minZ + WALL_T;
    const zi1 = C.maxZ - WALL_T;
    if (wall === 'south' || wall === 'north') {
        const zf = wall === 'south' ? zi1 : zi0;
        return rect(Math.min(A(xi0), A(xi1)), Math.max(A(xi0), A(xi1)), 0, cabinUnder(zf) - CEIL_GAP);
    }
    return [
        [A(zi0), 0],
        [A(zi1), 0],
        [A(zi1), cabinUnder(zi1) - CEIL_GAP],
        [A(C_MIDZ), C.ridgeH - CEIL_GAP],
        [A(zi0), cabinUnder(zi0) - CEIL_GAP],
    ];
}
export function buildShell(m) {
    const B = new Batch();
    const rnd = mulberry32(41);
    const windows = [];
    /* ---- plinth: dry-laid fieldstone under the walls ---- */
    {
        const t = 0.34;
        const inset = 0.025;
        const x0 = C.minX + inset;
        const x1 = C.maxX - inset;
        const z0 = C.minZ + inset;
        const z1 = C.maxZ - inset;
        const y1 = -0.02;
        B.add(m.stone, boxMinMax(x0, PLINTH_BOT, z1 - t, x1, y1, z1), { cast: true, role: 'plinth' });
        B.add(m.stone, boxMinMax(x0, PLINTH_BOT, z0, W.minX + inset, y1, z0 + t), { cast: true, role: 'plinth' });
        B.add(m.stone, boxMinMax(W.maxX - inset, PLINTH_BOT, z0, x1, y1, z0 + t), { cast: true, role: 'plinth' });
        B.add(m.stone, boxMinMax(x0, PLINTH_BOT, z0 + t, x0 + t, y1, z1 - t), { cast: true, role: 'plinth' });
        B.add(m.stone, boxMinMax(x1 - t, PLINTH_BOT, z0 + t, x1, y1, z1 - t), { cast: true, role: 'plinth' });
        // entry: a granite landing and a step down to the yard
        const ex = HOUSE.entryX;
        B.add(m.stone, boxMinMax(ex - 0.85, PLINTH_BOT, C.maxZ, ex + 0.85, -0.2, C.maxZ + 0.95), { cast: true, role: 'plinth' });
        B.add(m.stone, boxMinMax(ex - 0.7, PLINTH_BOT, C.maxZ + 0.95, ex + 0.7, -0.42, C.maxZ + 1.4), { cast: true, role: 'plinth' });
    }
    /* ---- walls: cladding outside, panelling inside, openings ---- */
    for (const wall of ['south', 'north', 'east', 'west']) {
        const f = WALLS[wall];
        const M = wallMatrix(f);
        const ops = openingsOn(wall);
        const exterior = ops.filter((o) => !isInterior(o));
        const holesOut = exterior.map((o) => {
            const r = openingRect(f, o);
            return rect(r.a0, r.a1, r.y0, r.y1);
        });
        // cladding: give each hole to the outline that contains it
        for (const outline of outerOutline(wall)) {
            const minA = Math.min(...outline.map((p) => p[0]));
            const maxA = Math.max(...outline.map((p) => p[0]));
            const holes = holesOut.filter((h) => h[0][0] > minA && h[1][0] < maxA);
            B.add(m.clad, wface(M, 0, true, outline, holes), { cast: true, role: 'walls' });
        }
        // panelling
        const holesIn = ops.map((o) => {
            const r = openingRect(f, o);
            return rect(r.a0, r.a1, Math.max(r.y0, 0.001), r.y1);
        });
        B.add(m.wallIn, wface(M, -WALL_T, false, innerOutline(wall), holesIn), { role: 'interior' });
        for (const o of ops) {
            const r = openingRect(f, o);
            const interior = isInterior(o);
            const door = o.kind === 'door' || o.kind === 'glazedDoor';
            const outMat = interior ? m.frame : m.trim;
            const glassD = door ? -0.06 : -GLASS_IN;
            // reveals: painted outside of the glass line, pine inside it
            const rev = (n0, n1, mat) => {
                B.add(mat, wbox(M, r.a0 - 0.012, r.a0, r.y0, r.y1, n0, n1, 'y'), { role: 'windows' });
                B.add(mat, wbox(M, r.a1, r.a1 + 0.012, r.y0, r.y1, n0, n1, 'y'), { role: 'windows' });
                B.add(mat, wbox(M, r.a0, r.a1, r.y1, r.y1 + 0.012, n0, n1, 'x'), { role: 'windows' });
                if (!door)
                    B.add(mat, wbox(M, r.a0, r.a1, r.y0 - 0.012, r.y0, n0, n1, 'x'), { role: 'windows' });
            };
            rev(glassD, 0, outMat);
            rev(-WALL_T, glassD, interior ? m.frame : m.wallIn);
            if (door) {
                // threshold
                B.add(interior ? m.frame : m.timber, wbox(M, r.a0, r.a1, -0.03, 0.018, -WALL_T, interior ? 0 : 0.04, 'x'), { role: 'windows', cast: true });
            }
            // architraves round the opening (white outside, pine for the inner door)
            const trims = (n, mat, dir) => {
                const n0 = n;
                const n1 = n + dir * TRIM_T;
                const yb = door ? 0 : r.y0 - 0.045;
                B.add(mat, wbox(M, r.a0 - TRIM_W, r.a0, yb, r.y1 + TRIM_W, n0, n1, 'y'), { cast: dir > 0, role: 'windows' });
                B.add(mat, wbox(M, r.a1, r.a1 + TRIM_W, yb, r.y1 + TRIM_W, n0, n1, 'y'), { cast: dir > 0, role: 'windows' });
                B.add(mat, wbox(M, r.a0 - TRIM_W, r.a1 + TRIM_W, r.y1, r.y1 + TRIM_W, n0, n1, 'x'), { cast: dir > 0, role: 'windows' });
            };
            if (!interior) {
                trims(0, m.trim, 1);
                // drip cap over the head trim
                B.add(m.trim, wbox(M, r.a0 - TRIM_W - 0.025, r.a1 + TRIM_W + 0.025, r.y1 + TRIM_W, r.y1 + TRIM_W + 0.03, 0, TRIM_T + 0.045, 'x'), { cast: true, role: 'windows' });
                if (!door) {
                    // sloped sill board and its apron
                    const sill = wbox(M, r.a0 - TRIM_W - 0.035, r.a1 + TRIM_W + 0.035, r.y0 - 0.045, r.y0, glassD + 0.02, 0.08, 'x');
                    B.add(m.trim, sill, { cast: true, role: 'windows' });
                    B.add(m.trim, wbox(M, r.a0 - TRIM_W, r.a1 + TRIM_W, r.y0 - 0.045 - 0.1, r.y0 - 0.045, 0, TRIM_T, 'x'), { cast: true, role: 'windows' });
                    // a heap of snow on the sill and a thinner one on the drip cap
                    const sillN = (glassD + 0.02 + 0.08) / 2;
                    const dripN = (TRIM_T + 0.045) / 2;
                    const strip = (a0, a1, y, n, w, h) => {
                        const pa = new THREE.Vector3(a0, y, n).applyMatrix4(M);
                        const pb = new THREE.Vector3(a1, y, n).applyMatrix4(M);
                        B.add(m.snow, snowStrip(pa, pb, w, h, windows.length * 7 + (y > 1.5 ? 3 : 1)), { role: 'snow' });
                    };
                    strip(r.a0 - TRIM_W - 0.03, r.a1 + TRIM_W + 0.03, r.y0, sillN, 0.15, 0.06 + rnd() * 0.03);
                    strip(r.a0 - TRIM_W - 0.02, r.a1 + TRIM_W + 0.02, r.y1 + TRIM_W + 0.03, dripN, 0.08, 0.04 + rnd() * 0.02);
                }
                trims(-WALL_T, door ? m.pine : m.pine, -1);
            }
            else {
                trims(0, m.frame, 1);
                trims(-WALL_T, m.pine, -1);
            }
            if (!door) {
                // inner window board: a deep pine sill
                B.add(m.pine, wbox(M, r.a0 - 0.05, r.a1 + 0.05, r.y0 - 0.032, r.y0, glassD - 0.035, -WALL_T - 0.05, 'x'), { role: 'interior' });
                buildWindow(B, m, M, r, o, glassD);
                if (o.kind === 'window')
                    buildCurtains(B, m, M, r, rnd);
            }
            const ca = (r.a0 + r.a1) / 2;
            const center = new THREE.Vector3(ca, (r.y0 + r.y1) / 2, 0).applyMatrix4(M);
            windows.push({ opening: o, frame: f, center, outward: new THREE.Vector3(f.nx, 0, f.nz) });
        }
        // corner boards: tarred, a touch proud of the battens
        if (wall === 'south' || wall === 'north') {
            for (const s of [C.minX, C.maxX]) {
                const a = aOf(f, s);
                const a0 = a < 0 ? a : a - 0.14;
                B.add(m.clad, wbox(M, a0, a0 + 0.14, CLAD_BOT, C.wallH - 0.02, 0, 0.032, 'y'), { cast: true, role: 'walls' });
            }
        }
    }
    /* ---- interior: floor, vaulted ceiling, ridge and tie beams, partition ---- */
    {
        const xi0 = C.minX + WALL_T;
        const xi1 = C.maxX - WALL_T;
        const zi0 = C.minZ + WALL_T;
        const zi1 = C.maxZ - WALL_T;
        B.add(m.floor, boxMinMax(xi0, -0.06, zi0, xi1, 0, zi1, 'x'), { role: 'interior' });
        // ceiling: pine boards along the ridge, two planes meeting under the ridge beam
        const ceil = (z0, z1) => {
            const g = slab([
                [xi0, z0],
                [xi1, z0],
                [xi1, z1],
                [xi0, z1],
            ], (_x, z) => cabinUnder(z) - CEIL_GAP + 0.001, (_x, z) => cabinUnder(z) - CEIL_GAP, [], 'x');
            g.top.dispose();
            return g.bottom;
        };
        B.add(m.pine, ceil(zi0, C_MIDZ), { role: 'interior' });
        B.add(m.pine, ceil(C_MIDZ, zi1), { role: 'interior' });
        // ridge beam and tie beams
        B.add(m.pine, boxMinMax(xi0, C.ridgeH - 0.32, C_MIDZ - 0.08, xi1, C.ridgeH - 0.01, C_MIDZ + 0.08, 'x'), { role: 'interior' });
        for (const x of [-4.05, 0.85, 3.65]) {
            B.add(m.pine, boxMinMax(x - 0.065, 2.56, zi0, x + 0.065, 2.78, zi1, 'z'), { role: 'interior' });
        }
        // chimney breast of fieldstone, through the ceiling, and a slate hearth in front of it
        const cx0 = CH.x - CH.w / 2;
        const cx1 = CH.x + CH.w / 2;
        const cz0 = CH.z - CH.d / 2;
        const cz1 = CH.z + CH.d / 2;
        B.add(m.stoneIn, applyBoxUV(boxMinMax(cx0, 0, cz0, cx1, C.ridgeH - 0.2, cz1, 'y'), { scale: 1.45 }), { role: 'hearth' });
        B.add(m.slateIn, boxMinMax(cx1 - 0.02, 0, cz0 - 0.25, cx1 + 1.05, 0.025, cz1 + 0.25, 'x'), { role: 'hearth' });
        // the wing's side of the partition (pentagon up to the glass roof) with the door hole
        const wingDoor = OPENINGS.find((o) => isInterior(o));
        const xa = W.minX + 0.2;
        const xb = W.maxX - 0.2;
        const part = [
            [xa, 0],
            [xb, 0],
            [xb, wingUnder(xb) - 0.05],
            [W_CX, W.ridgeH - 0.05],
            [xa, wingUnder(xa) - 0.05],
        ];
        const holes = wingDoor ? [rect(wingDoor.c - wingDoor.w / 2, wingDoor.c + wingDoor.w / 2, 0.001, wingDoor.head)] : [];
        // face at z = C.minZ looking north (-z): U = -x … use a mirrored contour
        const f = planeFace(new THREE.Vector3(0, 0, C.minZ), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), part.map(([a, b]) => [-a, b]), holes.map((h) => h.map(([a, b]) => [-a, b])), 'y');
        B.add(m.wallW, f, { role: 'interior' });
    }
    /* ---- roof ---- */
    const roofTops = [];
    {
        const zS = C_MIDZ + C_EAVE_Z;
        const zN = C_MIDZ - C_EAVE_Z;
        const xr0 = -C_RAKE_X;
        const xr1 = C_RAKE_X;
        const top = (_x, z) => cabinTop(z);
        const bot = (_x, z) => cabinUnder(z);
        const south = slab([
            [xr0, C_MIDZ],
            [xr1, C_MIDZ],
            [xr1, zS],
            [xr0, zS],
        ], top, bot, [1, 2, 3], 'x');
        // north slope, notched where the wing's roof runs in (edges 2 and 3 are the notch)
        const north = slab([
            [xr0, C_MIDZ],
            [xr0, zN],
            [NOTCH.x0, zN],
            [W_CX, NOTCH.apexZ],
            [NOTCH.x1, zN],
            [xr1, zN],
            [xr1, C_MIDZ],
        ], top, bot, [0, 1, 2, 3, 4, 5], 'x');
        for (const s of [south, north]) {
            B.add(m.roof, s.top, { cast: true, role: 'roof' });
            B.add(m.roof, s.bottom, { cast: true, role: 'roof' });
            if (s.sides)
                B.add(m.roof, s.sides, { cast: true, role: 'roof' });
            roofTops.push(s.top);
        }
        // barge boards along the rakes and fascia boards along the eaves (crisp dark edges under the snow)
        const bb = 0.035;
        for (const x of [xr0, xr1]) {
            for (const zEnd of [zS, zN]) {
                const mid = (z) => (cabinUnder(z) + cabinTop(z)) / 2;
                const a = new THREE.Vector3(x, mid(zEnd), zEnd);
                const b = new THREE.Vector3(x, mid(C_MIDZ), C_MIDZ);
                const g = member(a, b, bb, 0.3 + 0.1);
                g.translate(x < 0 ? -bb / 2 : bb / 2, 0, 0);
                B.add(m.clad, g, { cast: true, role: 'roof' });
            }
        }
        const fascia = (x0, x1, z) => {
            const s = z > 0 ? 1 : -1;
            B.add(m.clad, boxMinMax(x0, cabinUnder(z) - 0.06, z, x1, cabinTop(z) + 0.01, z + s * 0.03, 'x'), { cast: true, role: 'roof' });
        };
        fascia(xr0, xr1, zS);
        fascia(xr0, NOTCH.x0, zN);
        fascia(NOTCH.x1, xr1, zN);
    }
    /* ---- chimney stack: fieldstone through the roof, a black steel hat ---- */
    {
        const cx0 = CH.x - CH.w / 2;
        const cx1 = CH.x + CH.w / 2;
        const cz0 = CH.z - CH.d / 2;
        const cz1 = CH.z + CH.d / 2;
        const yb = cabinTop(cz1) - 0.1;
        const yt = CH.topY - 0.3;
        B.add(m.stone, applyBoxUV(boxMinMax(cx0, yb, cz0, cx1, yt, cz1, 'y'), { scale: 1.45 }), { cast: true, role: 'chimney' });
        // corbel course and a slate cap with a flue pot under a steel hat
        B.add(m.stone, boxMinMax(cx0 - 0.05, yt - 0.18, cz0 - 0.05, cx1 + 0.05, yt, cz1 + 0.05, 'x'), { cast: true, role: 'chimney' });
        B.add(m.slate, boxMinMax(cx0 - 0.08, yt, cz0 - 0.08, cx1 + 0.08, yt + 0.05, cz1 + 0.08, 'x'), { cast: true, role: 'chimney' });
        const pot = new THREE.CylinderGeometry(0.12, 0.13, 0.32, 14, 1, true);
        pot.translate(CH.x, yt + 0.05 + 0.16, CH.z);
        B.add(m.steel, pot, { cast: true, role: 'chimney' });
        // the hat: four legs and a low pyramid
        for (const [lx, lz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
        ]) {
            B.add(m.steel, boxMinMax(CH.x + lx * 0.2 - 0.012, yt + 0.05, CH.z + lz * 0.2 - 0.012, CH.x + lx * 0.2 + 0.012, yt + 0.5, CH.z + lz * 0.2 + 0.012, 'y'), { cast: true, role: 'chimney' });
        }
        const hat = new THREE.ConeGeometry(0.42, 0.2, 4, 1);
        hat.rotateY(Math.PI / 4);
        hat.translate(CH.x, yt + 0.6, CH.z);
        B.add(m.steel, hat, { cast: true, role: 'chimney' });
        const plate = boxMinMax(CH.x - 0.3, yt + 0.48, CH.z - 0.3, CH.x + 0.3, yt + 0.5, CH.z + 0.3, 'x');
        B.add(m.steel, plate, { cast: true, role: 'chimney' });
        // snow on the corbel and the hat (two caps: one over both levels would spike down between them)
        for (const [g, t] of [
            [boxMinMax(cx0 - 0.08, yt, cz0 - 0.08, cx1 + 0.08, yt + 0.05, cz1 + 0.08, 'x'), 0.1],
            [hat.clone(), 0.12],
        ]) {
            const cap = snowCap(g, { thickness: t, cell: 0.025, overhang: 0.05, lumps: 0.4, seed: 17 });
            g.dispose();
            if (cap)
                B.add(m.snow, cap, { role: 'snow' });
        }
    }
    return { meshes: B.build('cabin'), windows, roofTops };
}
/* ------------------------------ windows ------------------------------ */
/** frame, sashes, glazing bars and frosted panes of one window (wall coordinates) */
function buildWindow(B, m, M, r, o, nGlass) {
    const fw = 0.05; // outer frame
    const sw = 0.045; // sash stiles and rails
    const bar = 0.024;
    const nf0 = nGlass - 0.04;
    const nf1 = nGlass + 0.025;
    const ns0 = nGlass - 0.025;
    const ns1 = nGlass + 0.018;
    // painted frames: the half facing the room is lit by its lamps, the outer half by the sky
    const add = (g) => {
        g.computeBoundingBox();
        B.add(m.trim, g, { cast: true, role: 'windows' });
    };
    const split = (a0, a1, y0, y1, n0, n1, grain) => {
        if (n1 > nGlass)
            add(wbox(M, a0, a1, y0, y1, Math.max(n0, nGlass), n1, grain));
        if (n0 < nGlass)
            B.add(m.trimIn, wbox(M, a0, a1, y0, y1, n0, Math.min(n1, nGlass), grain), { role: 'windows' });
    };
    // frame
    split(r.a0, r.a0 + fw, r.y0, r.y1, nf0, nf1, 'y');
    split(r.a1 - fw, r.a1, r.y0, r.y1, nf0, nf1, 'y');
    split(r.a0, r.a1, r.y1 - fw, r.y1, nf0, nf1, 'x');
    split(r.a0, r.a1, r.y0, r.y0 + fw, nf0, nf1, 'x');
    const ia0 = r.a0 + fw;
    const ia1 = r.a1 - fw;
    const iy0 = r.y0 + fw;
    const iy1 = r.y1 - fw;
    // sashes: two side by side (attic windows: one) with horizontal glazing bars
    const sashes = o.kind === 'attic' ? [[ia0, ia1]] : [
        [ia0, (ia0 + ia1) / 2],
        [(ia0 + ia1) / 2, ia1],
    ];
    const rows = o.kind === 'attic' ? 2 : 3;
    for (const [s0, s1] of sashes) {
        split(s0, s0 + sw, iy0, iy1, ns0, ns1, 'y');
        split(s1 - sw, s1, iy0, iy1, ns0, ns1, 'y');
        split(s0, s1, iy1 - sw, iy1, ns0, ns1, 'x');
        split(s0, s1, iy0, iy0 + sw * 1.4, ns0, ns1, 'x');
        const g0 = s0 + sw;
        const g1 = s1 - sw;
        const h0 = iy0 + sw * 1.4;
        const h1 = iy1 - sw;
        const cols = o.kind === 'attic' ? 2 : 1;
        const lw = (g1 - g0 - bar * (cols - 1)) / cols;
        const lh = (h1 - h0 - bar * (rows - 1)) / rows;
        for (let k = 1; k < rows; k++) {
            const y = h0 + k * lh + (k - 0.5) * bar;
            split(g0, g1, y - bar / 2, y + bar / 2, ns0 + 0.005, ns1 - 0.004, 'x');
        }
        for (let k = 1; k < cols; k++) {
            const a = g0 + k * lw + (k - 0.5) * bar;
            split(a - bar / 2, a + bar / 2, h0, h1, ns0 + 0.005, ns1 - 0.004, 'y');
        }
        for (let i = 0; i < cols; i++) {
            for (let k = 0; k < rows; k++) {
                const a = g0 + i * (lw + bar);
                const y = h0 + k * (lh + bar);
                const p = glassPane(lw + 0.01, lh + 0.01);
                p.translate(a + lw / 2, y + lh / 2, nGlass);
                p.applyMatrix4(M);
                B.add(m.glass, p, { role: 'windows', receive: false });
            }
        }
    }
}
/** two linen curtains drawn to the sides of a window, hanging in soft folds (wall coordinates) */
function buildCurtains(B, m, M, r, rnd) {
    const n = -WALL_T - 0.07;
    const yTop = r.y1 + 0.16;
    const yBot = Math.max(0.05, r.y0 - 0.12);
    const panel = (a0, a1, seed) => {
        const segA = 14;
        const segY = 3;
        const pos = [];
        const idx = [];
        const folds = 4 + Math.floor(rnd() * 2);
        for (let j = 0; j <= segY; j++) {
            const y = yBot + ((yTop - yBot) * j) / segY;
            for (let i = 0; i <= segA; i++) {
                const t = i / segA;
                const a = a0 + (a1 - a0) * t;
                const depth = 0.028 * Math.sin(t * Math.PI * 2 * folds + seed) * (0.8 + 0.2 * (1 - j / segY));
                pos.push(a, y, n + depth - 0.02);
            }
        }
        for (let j = 0; j < segY; j++) {
            for (let i = 0; i < segA; i++) {
                const k = j * (segA + 1) + i;
                idx.push(k, k + 1, k + segA + 1, k + 1, k + segA + 2, k + segA + 1);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        // uv: metres, grain down the fall
        const uv = [];
        for (let j = 0; j <= segY; j++)
            for (let i = 0; i <= segA; i++)
                uv.push(pos[(j * (segA + 1) + i) * 3 + 1], pos[(j * (segA + 1) + i) * 3]);
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.applyMatrix4(M);
        B.add(m.curtain, g, { role: 'interior' });
    };
    const w = 0.24 + rnd() * 0.06;
    panel(r.a0 - 0.1, r.a0 - 0.1 + w, rnd() * 6);
    panel(r.a1 + 0.1 - w, r.a1 + 0.1, rnd() * 6);
    // a slim iron rod
    B.add(m.steel, wbox(M, r.a0 - 0.16, r.a1 + 0.16, yTop + 0.01, yTop + 0.03, n - 0.02, n, 'x'), { role: 'interior' });
}
/* ----------------------------- snow and ice ----------------------------- */
/** the roof's snow slab with its cornice, from the roof's top faces (and the wing's opaque valley roof) */
export function roofSnow(tops, fancy) {
    const merged = mergeAll(tops.map((g) => g.clone()));
    const cap = snowCap(merged, { thickness: 0.46, cell: fancy ? 0.085 : 0.12, overhang: 0.34, sag: 0.75, lumps: 0.32, minUp: 0.35, seed: 5 });
    merged.dispose();
    return cap;
}
/** icicles along the cabin's eaves and the wing's glass eaves */
export function eaveIcicles() {
    const zS = C_MIDZ + C_EAVE_Z;
    const zN = C_MIDZ - C_EAVE_Z;
    const ys = cabinUnder(zS) - 0.05;
    const edges = [
        [new THREE.Vector3(-C_RAKE_X + 0.1, ys, zS + 0.02), new THREE.Vector3(C_RAKE_X - 0.1, ys, zS + 0.02)],
        [new THREE.Vector3(-C_RAKE_X + 0.1, ys, zN - 0.02), new THREE.Vector3(NOTCH.x0 - 0.3, ys, zN - 0.02)],
        [new THREE.Vector3(NOTCH.x1 + 0.3, ys, zN - 0.02), new THREE.Vector3(C_RAKE_X - 0.1, ys, zN - 0.02)],
    ];
    // the glass roof's eaves (warm glass, more melt)
    const xw0 = W_CX - W_EAVE_DX;
    const xw1 = W_CX + W_EAVE_DX;
    const yw = wingUnder(xw0) - 0.03;
    edges.push([new THREE.Vector3(xw0 - 0.02, yw, W.minZ - 0.1), new THREE.Vector3(xw0 - 0.02, yw, C.minZ - 0.15)]);
    edges.push([new THREE.Vector3(xw1 + 0.02, yw, W.minZ - 0.1), new THREE.Vector3(xw1 + 0.02, yw, C.minZ - 0.15)]);
    return icicles(edges, { spacing: 0.1, maxLength: 0.62, radius: 0.026, density: 0.62, seed: 23, segments: 4 });
}
