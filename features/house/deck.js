/**
 * Outside the cabin, on the north side: the deck of grey boards on stone
 * footings with steps down to the snow; the wood-fired hot tub (spruce
 * staves, black hoops, a little iron stove with its chimney, steps and a
 * folding lid); firewood stacked under the kitchen window and against the
 * west gable under a plank roof; a string of lantern bulbs over the deck;
 * the fire pit with its stone ring and log benches; and the kick sled by the
 * front door. Static parts merge per material; the lid, water and lights are
 * returned for animation.
 */
import * as THREE from 'three';
import { applyBoxUV, snowCap } from '../../core/geometry.js';
import { HOUSE } from '../../world/layout.js';
import { mulberry32 } from '../../world/noise.js';
import { heightAt } from '../../world/terrain-height.js';
import { boulderGeometry } from '../paths/kit/rocks.js';
import { logGeometry, placeLog } from '../paths/kit/wood.js';
import { ropeGeometry } from '../paths/kit/rope.js';
import { Batch, boxMinMax, member, mergeAll, snowStrip } from './kit.js';
import { C, C_EAVE_Z, C_MIDZ, D, cabinUnder } from './plan.js';
/** local ground height (the terrain under the cabin's pad) */
export const groundAt = (x, z) => heightAt(HOUSE.x + x, HOUSE.z + z) - HOUSE.floorY;
export const TUB = HOUSE.hotTub;
/** tub wall height above the deck, water level, stave thickness */
export const TUB_H = 1.02;
export const TUB_WATER = 0.86;
const STAVE_T = 0.045;
/** the tub's iron stove (outside the staves, toward the north-west) */
export const STOVE_DIR = new THREE.Vector2(-0.92, -0.39).normalize();
export const TUB_STOVE = { x: TUB.x + STOVE_DIR.x * (TUB.r + 0.34), z: TUB.z + STOVE_DIR.y * (TUB.r + 0.34) };
/** the steps up to the tub face the deck door */
export const STEP_DIR = new THREE.Vector2(0.62, 0.78).normalize();
/** deck steps down to the snow on the west edge */
export const DECK_STEPS = { x0: D.minX - 0.72, x1: D.minX, z0: -6.75, z1: -5.25 };
/** fire pit (local) */
export const PIT = HOUSE.firePit;
/** lantern string posts on the deck's north edge */
export const POSTS = [
    [D.minX + 0.12, D.minZ + 0.12],
    [D.maxX - 0.5, D.minZ + 0.12],
];
/** log benches round the fire pit: angle (radians from +x toward +z) */
const BENCH_ANGLES = [Math.PI * 0.5, Math.PI * 0.82, Math.PI * 0.18];
export const BENCH_R = 2.15;
/** the kick sled by the front door */
export const SLED = { x: -1.55, z: C.maxZ + 1.15, rotY: 0.12 };
/** the wall lantern beside the front door (local) */
export const DOOR_LAMP = new THREE.Vector3(HOUSE.entryX - 0.78, 2.02, C.maxZ + 0.2);
/** a split log's cross-section: whole, half or quarter round, as a polygon (radius r) */
function splitSection(kind, r, rnd) {
    const pts = [];
    const bark = [];
    const n = 7;
    const wob = () => 1 + (rnd() - 0.5) * 0.12;
    if (kind === 0) {
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            pts.push(new THREE.Vector2(Math.cos(a) * r * wob(), Math.sin(a) * r * wob()));
            bark.push(true);
        }
    }
    else {
        const span = kind === 1 ? Math.PI : Math.PI / 2;
        const a0 = rnd() * Math.PI * 2;
        pts.push(new THREE.Vector2(0, 0));
        bark.push(false);
        for (let i = 0; i <= n; i++) {
            const a = a0 + (i / n) * span;
            pts.push(new THREE.Vector2(Math.cos(a) * r * wob(), Math.sin(a) * r * wob()));
            bark.push(i < n);
        }
    }
    return { pts, bark };
}
/**
 * A stack of split logs (ends facing ±`axis`), filling the box. Bark faces go
 * to `barkOut`, split faces and end grain to `woodOut`.
 */
function woodStack(box, axis, seed, barkOut, woodOut) {
    const rnd = mulberry32(seed);
    const len = axis === 'x' ? box.x1 - box.x0 : box.z1 - box.z0;
    const w0 = axis === 'x' ? box.z0 : box.x0;
    const w1 = axis === 'x' ? box.z1 : box.x1;
    const rowH = 0.115;
    const rows = Math.floor((box.y1 - box.y0) / rowH);
    const bp = [];
    const wp = [];
    for (let j = 0; j < rows; j++) {
        let w = w0 + (j % 2) * 0.05;
        while (w < w1 - 0.05) {
            const r = 0.055 + rnd() * 0.035;
            const kind = rnd() < 0.18 ? 0 : rnd() < 0.55 ? 1 : 2;
            const sec = splitSection(kind, r, rnd);
            const cy = box.y0 + j * rowH + rowH * 0.5 + (rnd() - 0.5) * 0.02;
            const cw = w + r;
            const l0 = (rnd() - 0.5) * 0.06;
            const l1 = len + (rnd() - 0.5) * 0.06;
            const tilt = (rnd() - 0.5) * 0.3;
            const pts = sec.pts.map((p) => {
                const c = Math.cos(tilt);
                const s = Math.sin(tilt);
                return new THREE.Vector2(p.x * c - p.y * s, p.x * s + p.y * c);
            });
            const P = (p, l) => axis === 'x' ? new THREE.Vector3(box.x0 + l, cy + p.y, cw + p.x) : new THREE.Vector3(cw + p.x, cy + p.y, box.z0 + l);
            // centroid of the section: side faces must look away from it, end caps along the axis
            const cen = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
            const tri = (out, a, b, c, hint) => {
                const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
                if (n.dot(hint) < 0)
                    out.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
                else
                    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            };
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                const out = sec.bark[i] ? bp : wp;
                const mid = a.clone().add(b).multiplyScalar(0.5).sub(cen);
                const hint = P(mid, 0).sub(P(new THREE.Vector2(), 0));
                const A0 = P(a, l0);
                const B0 = P(b, l0);
                const A1 = P(a, l1);
                const B1 = P(b, l1);
                tri(out, A0, A1, B1, hint);
                tri(out, A0, B1, B0, hint);
            }
            const ax = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
            for (const [l, sgn] of [
                [l0, -1],
                [l1, 1],
            ]) {
                for (let i = 1; i < pts.length - 1; i++)
                    tri(wp, P(pts[0], l), P(pts[i], l), P(pts[i + 1], l), ax.clone().multiplyScalar(sgn));
            }
            w += r * 2 * (kind === 0 ? 1 : 0.85) + 0.004;
        }
    }
    const mk = (arr) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return applyBoxUV(g, { grain: axis });
    };
    if (bp.length)
        barkOut.push(mk(bp));
    if (wp.length)
        woodOut.push(mk(wp));
}
export function buildDeck(m, mats, fancy) {
    const B = new Batch();
    const rnd = mulberry32(77);
    const top = D.topY;
    const boardT = 0.032;
    /* ---- deck frame on stone footings ---- */
    {
        const yb = top - boardT;
        const rimH = 0.22;
        // rim joists all round (the cabin side sits on a ledger)
        B.add(m.clad, boxMinMax(D.minX, yb - rimH, D.minZ, D.maxX, yb, D.minZ + 0.05, 'x'), { cast: true, role: 'deck' });
        B.add(m.clad, boxMinMax(D.minX, yb - rimH, D.minZ, D.minX + 0.05, yb, D.maxZ, 'z'), { cast: true, role: 'deck' });
        B.add(m.clad, boxMinMax(D.maxX - 0.05, yb - rimH, D.minZ, D.maxX, yb, D.maxZ, 'z'), { cast: true, role: 'deck' });
        // where the deck runs past the cabin's west gable its south edge needs a rim too
        B.add(m.clad, boxMinMax(D.minX, yb - rimH, D.maxZ - 0.05, C.minX + 0.02, yb, D.maxZ, 'x'), { cast: true, role: 'deck' });
        // posts and footing stones
        for (const x of [D.minX + 0.1, (D.minX + D.maxX) / 2, D.maxX - 0.1]) {
            for (const z of [D.minZ + 0.1, (D.minZ + D.maxZ) / 2]) {
                const g = groundAt(x, z);
                B.add(m.clad, boxMinMax(x - 0.06, g - 0.1, z - 0.06, x + 0.06, yb - rimH + 0.02, z + 0.06, 'y'), { cast: true, role: 'deck' });
                const st = boulderGeometry(Math.floor(rnd() * 1e4), { sx: 0.2, sy: 0.12, sz: 0.18, detail: 1, flatBottom: 0.3 });
                st.translate(x, g + 0.02, z);
                B.add(m.stone, st, { cast: true, role: 'deck' });
            }
        }
        // boards along z, leading the eye north to the fjord
        const pitch = 0.146;
        const n = Math.floor((D.maxX - D.minX) / pitch);
        for (let i = 0; i < n; i++) {
            const x0 = D.minX + i * pitch + 0.004;
            const x1 = x0 + pitch - 0.008;
            const g = boxMinMax(x0, top - boardT, D.minZ - 0.03, x1, top, D.maxZ - 0.01, 'z', [rnd() * 3, rnd() * 3]);
            B.add(m.deck, g, { cast: true, role: 'deck' });
        }
        // steps down to the snow on the west side
        const s = DECK_STEPS;
        const gs = groundAt(s.x0 - 0.3, (s.z0 + s.z1) / 2);
        const rise = (top - gs) / 3;
        for (let k = 1; k <= 2; k++) {
            const y = top - rise * k;
            const xa = D.minX - 0.34 * k;
            B.add(m.deck, boxMinMax(xa, y - boardT, s.z0, xa + 0.36, y, s.z1, 'z'), { cast: true, role: 'deck' });
            B.add(m.clad, boxMinMax(xa + 0.02, gs - 0.05, s.z0 + 0.04, xa + 0.06, y - boardT, s.z1 - 0.04, 'z'), { cast: true, role: 'deck' });
        }
        B.add(m.clad, boxMinMax(s.x0, gs - 0.05, s.z0 - 0.04, D.minX, top - boardT, s.z0, 'x'), { cast: true, role: 'deck' });
        B.add(m.clad, boxMinMax(s.x0, gs - 0.05, s.z1, D.minX, top - boardT, s.z1 + 0.04, 'x'), { cast: true, role: 'deck' });
    }
    /* ---- hot tub ---- */
    {
        const cx = TUB.x;
        const cz = TUB.z;
        const staves = fancy ? 44 : 34;
        for (let i = 0; i < staves; i++) {
            const a0 = (i / staves) * Math.PI * 2;
            const a1 = ((i + 1) / staves) * Math.PI * 2 - 0.004;
            const ro = TUB.r;
            const ri = TUB.r - STAVE_T;
            const h = TUB_H + (rnd() - 0.5) * 0.012;
            const shape = new THREE.Shape([
                new THREE.Vector2(Math.cos(a0) * ri, Math.sin(a0) * ri),
                new THREE.Vector2(Math.cos(a0) * ro, Math.sin(a0) * ro),
                new THREE.Vector2(Math.cos(a1) * ro, Math.sin(a1) * ro),
                new THREE.Vector2(Math.cos(a1) * ri, Math.sin(a1) * ri),
            ]);
            const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
            g.rotateX(-Math.PI / 2);
            g.translate(cx, top, cz);
            applyBoxUV(g, { grain: 'y', offset: [rnd() * 4, rnd() * 4] });
            B.add(mats.staves, g, { cast: true, role: 'tub' });
        }
        // floor of the tub (dark under the water)
        const fl = new THREE.CylinderGeometry(TUB.r - STAVE_T, TUB.r - STAVE_T, 0.04, 32);
        fl.translate(cx, top + 0.05, cz);
        B.add(mats.staves, fl, { role: 'tub' });
        // black steel hoops
        for (const y of [0.14, 0.52, 0.9]) {
            const hoop = new THREE.CylinderGeometry(TUB.r + 0.008, TUB.r + 0.008, 0.055, 48, 1, true);
            hoop.translate(cx, top + y, cz);
            B.add(m.steel, hoop, { cast: true, role: 'tub' });
        }
        // a bench round the inside, just under the water
        const bench = new THREE.CylinderGeometry(TUB.r - STAVE_T, TUB.r - STAVE_T, 0.05, 40, 1, true);
        bench.translate(cx, top + 0.45, cz);
        B.add(mats.staves, bench, { role: 'tub' });
        // steps up to the rim, facing the door
        const sd = STEP_DIR;
        for (let k = 0; k < 2; k++) {
            const d = TUB.r + 0.2 + (1 - k) * 0.28;
            const y = top + 0.36 * (k + 1);
            const sx = cx + sd.x * d;
            const sz = cz + sd.y * d;
            const yaw = Math.atan2(sd.x, sd.y);
            const tread = new THREE.BoxGeometry(0.7, 0.04, 0.3);
            applyBoxUV(tread, { grain: 'x' });
            tread.rotateY(yaw);
            tread.translate(sx, y - 0.02, sz);
            B.add(m.deck, tread, { cast: true, role: 'tub' });
            for (const side of [-1, 1]) {
                const leg = new THREE.BoxGeometry(0.04, y - top - 0.04, 0.28);
                applyBoxUV(leg, { grain: 'y' });
                leg.translate(side * 0.31, 0, 0);
                leg.rotateY(yaw);
                leg.translate(sx, top + (y - top - 0.04) / 2, sz);
                B.add(m.deck, leg, { cast: true, role: 'tub' });
            }
        }
        // the iron stove: a squat box on legs, two pipes into the tub, a flue with a spark cap
        const st = TUB_STOVE;
        const yaw = Math.atan2(STOVE_DIR.x, STOVE_DIR.y);
        const sb = new THREE.BoxGeometry(0.46, 0.5, 0.56);
        applyBoxUV(sb);
        sb.rotateY(yaw);
        sb.translate(st.x, top + 0.35, st.z);
        B.add(m.iron, sb, { cast: true, role: 'tubStove' });
        for (const [lx, lz] of [
            [-0.18, -0.22],
            [0.18, -0.22],
            [-0.18, 0.22],
            [0.18, 0.22],
        ]) {
            const leg = new THREE.BoxGeometry(0.04, 0.12, 0.04);
            leg.translate(lx, 0, lz);
            leg.rotateY(yaw);
            leg.translate(st.x, top + 0.06, st.z);
            B.add(m.iron, leg, { cast: true, role: 'tubStove' });
        }
        for (const y of [0.25, 0.48]) {
            const a = new THREE.Vector3(st.x - STOVE_DIR.x * 0.2, top + y, st.z - STOVE_DIR.y * 0.2);
            const b = new THREE.Vector3(TUB.x + STOVE_DIR.x * (TUB.r - 0.01), top + y, TUB.z + STOVE_DIR.y * (TUB.r - 0.01));
            const pipe = new THREE.CylinderGeometry(0.045, 0.045, a.distanceTo(b), 10);
            pipe.rotateZ(Math.PI / 2);
            pipe.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
            pipe.translate((a.x + b.x) / 2, top + y, (a.z + b.z) / 2);
            B.add(m.iron, pipe, { cast: true, role: 'tubStove' });
        }
        const flue = new THREE.CylinderGeometry(0.06, 0.06, 1.75, 12, 1, true);
        flue.translate(st.x + STOVE_DIR.x * 0.08, top + 0.6 + 0.875, st.z + STOVE_DIR.y * 0.08);
        B.add(m.steel, flue, { cast: true, role: 'tubStove' });
        const capC = new THREE.ConeGeometry(0.15, 0.12, 12);
        capC.translate(st.x + STOVE_DIR.x * 0.08, top + 2.45, st.z + STOVE_DIR.y * 0.08);
        B.add(m.steel, capC, { cast: true, role: 'tubStove' });
        const mesh = new THREE.CylinderGeometry(0.075, 0.075, 0.1, 12, 1, true);
        mesh.translate(st.x + STOVE_DIR.x * 0.08, top + 2.36, st.z + STOVE_DIR.y * 0.08);
        B.add(m.steel, mesh, { cast: true, role: 'tubStove' });
        // snow on the stove top (capped square to the grid, then turned: no stair-stepped rims)
        const sg = new THREE.BoxGeometry(0.46, 0.5, 0.56);
        sg.translate(0, top + 0.35, 0);
        const cap = snowCap(sg, { thickness: 0.06, cell: 0.015, overhang: 0.03, seed: 9 });
        sg.dispose();
        if (cap) {
            cap.rotateY(yaw);
            cap.translate(st.x, 0, st.z);
            B.add(m.snow, cap, { role: 'snow' });
        }
    }
    /* ---- firewood: under the kitchen window on the deck, and against the west gable ---- */
    {
        const bark = [];
        const wood = [];
        // on the deck under the north eave
        woodStack({ x0: C.minX + 0.15, x1: -3.25, y0: top, y1: top + 0.98, z0: C.minZ - 0.44, z1: C.minZ - 0.04 }, 'z', 11, bark, wood);
        // against the west gable, on two sleepers, under its own plank roof
        const gx0 = C.minX - 0.5;
        const gx1 = C.minX - 0.06;
        const gz0 = C.minZ + 0.25;
        const gz1 = -0.35;
        const gy = groundAt(gx0, (gz0 + gz1) / 2) + 0.1;
        woodStack({ x0: gx0, x1: gx1, y0: gy, y1: gy + 1.32, z0: gz0, z1: gz1 }, 'x', 13, bark, wood);
        for (const x of [gx0 + 0.08, gx1 - 0.08])
            B.add(m.timber, boxMinMax(x - 0.05, gy - 0.12, gz0 - 0.1, x + 0.05, gy, gz1 + 0.1, 'z'), { cast: true, role: 'firewood' });
        // plank roof, sloping away from the wall
        const ry0 = gy + 1.5;
        const roofG = [];
        const plank = boxMinMax(gx0 - 0.18, ry0 - 0.03, gz0 - 0.2, gx1 + 0.04, ry0, gz1 + 0.2, 'z');
        plank.translate(-(gx0 + gx1) / 2, -ry0, 0);
        plank.rotateZ(0.22);
        plank.translate((gx0 + gx1) / 2, ry0, 0);
        roofG.push(plank);
        B.add(m.clad, plank.clone(), { cast: true, role: 'firewood' });
        for (const z of [gz0 - 0.1, gz1 + 0.1])
            B.add(m.timber, boxMinMax(gx0 - 0.05, gy, z - 0.035, gx0 + 0.02, ry0 - 0.05, z + 0.035, 'y'), { cast: true, role: 'firewood' });
        const roofSnow = snowCap(mergeAll(roofG), { thickness: 0.2, cell: 0.05, overhang: 0.12, sag: 0.8, seed: 21 });
        if (roofSnow)
            B.add(m.snow, roofSnow, { role: 'snow', cast: true });
        for (const g of bark)
            B.add(mats.bark, g, { cast: true, role: 'firewood' });
        for (const g of wood)
            B.add(mats.endGrain, g, { cast: true, role: 'firewood' });
        // a chopping block and a few loose logs by the steps
        const blk = new THREE.CylinderGeometry(0.22, 0.24, 0.42, 14);
        applyBoxUV(blk, { grain: 'y' });
        const bx = DECK_STEPS.x0 - 0.9;
        const bz = DECK_STEPS.z1 + 0.9;
        blk.translate(bx, groundAt(bx, bz) + 0.2, bz);
        B.add(mats.bark, blk, { cast: true, role: 'firewood' });
        const blkTop = new THREE.CircleGeometry(0.22, 14);
        blkTop.rotateX(-Math.PI / 2);
        blkTop.translate(bx, groundAt(bx, bz) + 0.411, bz);
        applyBoxUV(blkTop);
        B.add(mats.endGrain, blkTop, { role: 'firewood' });
    }
    /* ---- lantern string over the deck ---- */
    const bulbPts = [];
    let bulbs;
    const bulbMat = new THREE.MeshStandardMaterial({ name: 'bulb', color: 0xfff1d6, emissive: 0xffb466, emissiveIntensity: 0, roughness: 0.3 });
    bulbMat.userData.snow = 0;
    {
        const postH = 2.55;
        for (const [px, pz] of POSTS) {
            B.add(m.clad, boxMinMax(px - 0.05, top - 0.25, pz - 0.05, px + 0.05, top + postH, pz + 0.05, 'y'), { cast: true, role: 'lights' });
            const cap = snowCap(boxMinMax(px - 0.05, top + postH - 0.01, pz - 0.05, px + 0.05, top + postH, pz + 0.05), { thickness: 0.08, cell: 0.012, overhang: 0.03, seed: 4 });
            if (cap)
                B.add(m.snow, cap, { role: 'snow' });
        }
        const eaveY = cabinUnder(C_MIDZ - C_EAVE_Z) - 0.05;
        const ez = C_MIDZ - C_EAVE_Z + 0.03;
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        const nw = P(POSTS[0][0], top + postH - 0.08, POSTS[0][1]);
        const ne = P(POSTS[1][0], top + postH - 0.08, POSTS[1][1]);
        const spans = [
            [P(C.minX + 0.3, eaveY, ez), nw, 0.3],
            [nw, P(-3.6, eaveY, ez), 0.42],
            [P(-3.6, eaveY, ez), ne, 0.42],
            [ne, P(-0.9, eaveY, ez), 0.22],
        ];
        const wire = [];
        const bulbGeo = [];
        const caps = [];
        for (const [a, b, sag] of spans) {
            wire.push(ropeGeometry(a, b, 0.006, sag, 14, 4));
            const len = a.distanceTo(b);
            const n = Math.floor(len / 0.48);
            for (let i = 1; i < n; i++) {
                const t = i / n;
                const p = a.clone().lerp(b, t);
                p.y -= sag * 4 * t * (1 - t);
                bulbPts.push(p.clone());
                const s = new THREE.SphereGeometry(0.026, 8, 6);
                s.scale(1, 1.25, 1);
                s.translate(p.x, p.y - 0.07, p.z);
                bulbGeo.push(s);
                const c = new THREE.CylinderGeometry(0.014, 0.016, 0.04, 6);
                c.translate(p.x, p.y - 0.03, p.z);
                caps.push(c);
            }
        }
        for (const g of wire)
            B.add(m.steel, g, { role: 'lights' });
        for (const g of caps)
            B.add(m.steel, g, { role: 'lights' });
        bulbs = new THREE.Mesh(mergeAll(bulbGeo), bulbMat);
        bulbs.name = 'house-bulbs';
        bulbs.userData.roles = [{ role: 'lights', start: 0, end: 1e9 }];
    }
    /* ---- fire pit: a ring of shore stones, a tipi of logs, three log benches ---- */
    {
        const px = PIT.x;
        const pz = PIT.z;
        const g0 = groundAt(px, pz);
        const nStones = 11;
        for (let i = 0; i < nStones; i++) {
            const a = (i / nStones) * Math.PI * 2 + rnd() * 0.2;
            const r = 0.62 + rnd() * 0.05;
            const st = boulderGeometry(500 + i, { sx: 0.16 + rnd() * 0.05, sy: 0.12 + rnd() * 0.05, sz: 0.13 + rnd() * 0.04, detail: 2, flatBottom: 0.35, facets: 4 });
            st.rotateY(rnd() * 6.28);
            const x = px + Math.cos(a) * r;
            const z = pz + Math.sin(a) * r;
            st.translate(x, groundAt(x, z) + 0.03, z);
            B.add(mats.ring, st, { cast: true, role: 'firepit' });
        }
        // charred logs in a tipi over the embers
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
            // a low, half-burnt tipi: the flames rise well above it
            const foot = new THREE.Vector3(px + Math.cos(a) * 0.42, g0 + 0.04, pz + Math.sin(a) * 0.42);
            const tip = new THREE.Vector3(px + Math.cos(a) * 0.1, g0 + 0.3 + rnd() * 0.1, pz + Math.sin(a) * 0.1);
            const lg = logGeometry(600 + i, { length: foot.distanceTo(tip) + 0.05, r0: 0.05, r1: 0.035, knobs: 0.15, radial: 6, segments: 4 });
            placeLog(lg, foot, tip, rnd() * 3);
            applyBoxUV(lg);
            B.add(mats.char, lg, { cast: true, role: 'firepit' });
        }
        for (let i = 0; i < BENCH_ANGLES.length; i++) {
            const a = BENCH_ANGLES[i];
            const cx = px + Math.cos(a) * BENCH_R;
            const cz = pz + Math.sin(a) * BENCH_R;
            // tangent to the circle
            const tx = -Math.sin(a);
            const tz = Math.cos(a);
            const L = 1.7;
            const gy = groundAt(cx, cz);
            const seatY = gy + 0.42;
            const p0 = new THREE.Vector3(cx - (tx * L) / 2, seatY, cz - (tz * L) / 2);
            const p1 = new THREE.Vector3(cx + (tx * L) / 2, seatY, cz + (tz * L) / 2);
            const lg = logGeometry(700 + i, { length: L, r0: 0.17, r1: 0.15, knobs: 0.06, flatTop: 0.25, radial: 12, segments: 6, checks: 0.5 });
            placeLog(lg, p0, p1, 0);
            lg.translate(0, -0.03, 0);
            applyBoxUV(lg);
            B.add(mats.benchWood, lg, { cast: true, role: 'firepit' });
            for (const s of [-0.55, 0.55]) {
                const stump = new THREE.CylinderGeometry(0.15, 0.17, 0.32, 10);
                applyBoxUV(stump, { grain: 'y' });
                stump.translate(cx + tx * s, gy + 0.13, cz + tz * s);
                B.add(mats.bark, stump, { cast: true, role: 'firepit' });
            }
            // snow on the bench: brushed off where someone sat
            // a strip of snow along the seat, brushed off where someone sat on the south bench
            const top = seatY + 0.17 * 0.25 - 0.03;
            const strips = i === 0 ? [[-L / 2 + 0.02, -0.2], [0.22, L / 2 - 0.02]] : [[-L / 2 + 0.02, L / 2 - 0.02]];
            for (const [s0, s1] of strips) {
                const a = new THREE.Vector3(cx + tx * s0, top, cz + tz * s0);
                const b = new THREE.Vector3(cx + tx * s1, top, cz + tz * s1);
                B.add(m.snow, snowStrip(a, b, 0.24, 0.075, 40 + i * 3 + (s0 > 0 ? 1 : 0)), { role: 'snow' });
            }
        }
    }
    /* ---- kick sled by the front door ---- */
    {
        const parts = [];
        const runL = 2.05;
        const gw = 0.42;
        for (const s of [-1, 1]) {
            // flat steel runner with a curl at the front
            const pts = [];
            for (let i = 0; i <= 12; i++) {
                const t = i / 12;
                const x = -runL / 2 + t * runL;
                const curl = t > 0.88 ? Math.pow((t - 0.88) / 0.12, 2) * 0.16 : 0;
                pts.push(new THREE.Vector3(x - curl * 0.3, 0.012 + curl, s * gw * (1 - 0.18 * Math.max(0, t - 0.6))));
            }
            for (let i = 0; i < pts.length - 1; i++)
                parts.push({ g: member(pts[i], pts[i + 1], 0.012, 0.02), mat: m.steel });
            // uprights from the runner to the seat and the handlebar
            parts.push({ g: member(new THREE.Vector3(0.62, 0.02, s * gw * 0.95), new THREE.Vector3(0.6, 0.56, s * 0.2), 0.03, 0.03), mat: mats.red });
            parts.push({ g: member(new THREE.Vector3(0.2, 0.02, s * gw), new THREE.Vector3(0.22, 0.56, s * 0.2), 0.03, 0.03), mat: mats.red });
            parts.push({ g: member(new THREE.Vector3(0.18, 0.56, s * 0.2), new THREE.Vector3(-0.02, 1.08, s * 0.2), 0.032, 0.032), mat: mats.red });
        }
        // seat slats and the bent handlebar
        for (let k = 0; k < 4; k++)
            parts.push({ g: boxMinMax(0.18 + k * 0.12, 0.555, -0.24, 0.28 + k * 0.12, 0.585, 0.24, 'z'), mat: mats.red });
        parts.push({ g: boxMinMax(-0.05, 1.06, -0.26, 0.02, 1.1, 0.26, 'z'), mat: mats.red });
        parts.push({ g: boxMinMax(0.15, 0.62, -0.22, 0.19, 0.86, 0.22, 'z'), mat: mats.red });
        const yaw = SLED.rotY;
        const gy = groundAt(SLED.x, SLED.z);
        for (const p of parts) {
            p.g.rotateY(yaw);
            p.g.translate(SLED.x, gy, SLED.z);
            B.add(p.mat, p.g, { cast: true, role: 'sled' });
        }
        const seat = boxMinMax(0.18, 0.555, -0.24, 0.66, 0.585, 0.24, 'z');
        const cap = snowCap(seat, { thickness: 0.06, cell: 0.015, overhang: 0.03, lumps: 0.5, seed: 61 });
        if (cap) {
            cap.rotateY(yaw);
            cap.translate(SLED.x, gy, SLED.z);
            B.add(m.snow, cap, { role: 'snow' });
        }
    }
    /* ---- the tub's lid (two halves, the front one folds over the back) and its water ---- */
    const lidR = TUB.r + 0.03;
    const lidT = 0.06;
    const lidGeo = (half) => {
        // a half disc of boards on two battens; built round the hinge line (local x axis)
        const shape = new THREE.Shape();
        const n = 20;
        shape.moveTo(-lidR, 0);
        for (let i = 0; i <= n; i++) {
            const a = Math.PI - (i / n) * Math.PI;
            shape.lineTo(Math.cos(a) * lidR, Math.sin(a) * lidR * half);
        }
        shape.lineTo(-lidR, 0);
        const g = new THREE.ExtrudeGeometry(shape, { depth: lidT, bevelEnabled: false });
        g.rotateX(Math.PI / 2);
        g.translate(0, lidT, 0);
        applyBoxUV(g, { grain: 'x' });
        return g;
    };
    // the hinge line runs across the tub, square to the steps' direction
    const hingeYaw = Math.atan2(STEP_DIR.x, STEP_DIR.y);
    const lidBack = new THREE.Mesh(lidGeo(-1), m.deck);
    lidBack.name = 'tub-lid-back';
    lidBack.castShadow = true;
    lidBack.receiveShadow = true;
    lidBack.rotation.y = hingeYaw;
    lidBack.position.set(TUB.x, top + TUB_H, TUB.z);
    lidBack.userData.roles = [{ role: 'lid', start: 0, end: 1e9 }];
    const lid = new THREE.Group();
    lid.name = 'tub-lid';
    lid.position.set(TUB.x, top + TUB_H + lidT, TUB.z);
    lid.rotation.y = hingeYaw;
    const lidFront = new THREE.Mesh(lidGeo(1), m.deck);
    lidFront.castShadow = true;
    lidFront.receiveShadow = true;
    lidFront.position.y = -lidT;
    lidFront.userData.roles = [{ role: 'lid', start: 0, end: 1e9 }];
    // the folding half pivots on the hinge (the group's x axis) at the top of the lid
    const pivot = new THREE.Group();
    pivot.name = 'tub-lid-hinge';
    pivot.add(lidFront);
    lid.add(pivot);
    const water = new THREE.Mesh(new THREE.CircleGeometry(TUB.r - STAVE_T - 0.002, 40).rotateX(-Math.PI / 2), m.snow);
    water.name = 'tub-water';
    water.position.set(TUB.x, top + TUB_WATER, TUB.z);
    water.userData.roles = [{ role: 'tub', start: 0, end: 1e9 }];
    const stoveGlow = new THREE.MeshStandardMaterial({ name: 'tubStoveGlow', color: 0x100804, emissive: 0xff7a2a, emissiveIntensity: 0, roughness: 0.4 });
    stoveGlow.userData.snow = 0;
    {
        const st = TUB_STOVE;
        const yaw = Math.atan2(STOVE_DIR.x, STOVE_DIR.y);
        const win = new THREE.PlaneGeometry(0.2, 0.13);
        // the fire door faces away from the tub
        win.translate(0, 0, 0.282);
        win.rotateY(yaw);
        win.translate(st.x, top + 0.36, st.z);
        B.add(stoveGlow, win, { role: 'tubStove' });
    }
    /* ---- a snow shovel stuck in the bank beside the deck path ---- */
    {
        const foot = new THREE.Vector3(-1.95, top + 0.02, -4.75);
        const head = new THREE.Vector3(-1.82, top + 1.32, -4.42);
        const dir = head.clone().sub(foot).normalize();
        // blade: a shallow scoop half buried in the snow, then the handle and its grip
        const blade = new THREE.BoxGeometry(0.42, 0.36, 0.012);
        blade.translate(0, 0.1, 0);
        const bq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        blade.applyQuaternion(bq);
        blade.translate(foot.x, foot.y, foot.z);
        applyBoxUV(blade);
        B.add(mats.red, blade, { cast: true, role: 'deck' });
        B.add(mats.staves, member(foot.clone().addScaledVector(dir, 0.26), head, 0.032, 0.032), { cast: true, role: 'deck' });
        const grip = member(head.clone().add(new THREE.Vector3(-0.07, 0, 0)), head.clone().add(new THREE.Vector3(0.07, 0, 0)), 0.03, 0.03);
        B.add(m.steel, grip, { cast: true, role: 'deck' });
    }
    /* ---- by the front door: skis and poles against the wall, an iron wall lantern ---- */
    const doorLamp = new THREE.MeshStandardMaterial({ name: 'doorLampGlass', color: 0x3a2a1a, roughness: 0.25, emissive: 0xffb866, emissiveIntensity: 0 });
    doorLamp.userData.snow = 0;
    {
        const wallZ = C.maxZ;
        const g0 = groundAt(-2.05, wallZ + 0.45) + 0.02;
        // two wooden skis, tails in the snow, tips against the wall under the eave
        for (const [x, lean] of [
            [-2.12, 0.0],
            [-1.98, 0.03],
        ]) {
            const foot = new THREE.Vector3(x, g0 - 0.05, wallZ + 0.5);
            const head = new THREE.Vector3(x + lean, g0 + 1.92, wallZ + 0.06);
            const dir = head.clone().sub(foot).normalize();
            // body, then a short upturned tip bending away from the wall
            const tipStart = foot.clone().addScaledVector(dir, foot.distanceTo(head) - 0.18);
            const ski = member(foot, tipStart, 0.07, 0.022, new THREE.Vector3(0, 0, 1));
            const tip = member(tipStart, tipStart.clone().addScaledVector(dir, 0.16).add(new THREE.Vector3(0, 0, 0.07)), 0.065, 0.02, new THREE.Vector3(0, 0, 1));
            B.add(mats.staves, ski, { cast: true, role: 'sled' });
            B.add(mats.staves, tip, { cast: true, role: 'sled' });
            // binding
            const bind = foot.clone().addScaledVector(dir, 0.95);
            B.add(m.steel, boxMinMax(bind.x - 0.04, bind.y - 0.04, bind.z + 0.005, bind.x + 0.04, bind.y + 0.08, bind.z + 0.045, 'y'), { cast: true, role: 'sled' });
        }
        // poles with leather baskets
        for (const x of [-1.72, -1.64]) {
            const foot = new THREE.Vector3(x, g0 - 0.05, wallZ + 0.36);
            const head = new THREE.Vector3(x + 0.02, g0 + 1.35, wallZ + 0.05);
            B.add(m.steel, member(foot, head, 0.016, 0.016), { cast: true, role: 'sled' });
            const basket = new THREE.TorusGeometry(0.055, 0.008, 4, 12);
            basket.rotateX(Math.PI / 2);
            basket.translate(foot.x, foot.y + 0.12, foot.z - 0.03);
            B.add(mats.red, basket, { cast: true, role: 'sled' });
        }
        // the wall lantern: a bracket and a little iron house with glass sides and a snowy roof
        const L = DOOR_LAMP;
        B.add(m.steel, boxMinMax(L.x - 0.015, L.y + 0.12, wallZ, L.x + 0.015, L.y + 0.15, L.z + 0.02, 'z'), { cast: true, role: 'lights' });
        B.add(m.steel, boxMinMax(L.x - 0.04, L.y - 0.02, wallZ, L.x + 0.04, L.y + 0.16, wallZ + 0.02, 'y'), { cast: true, role: 'lights' });
        for (const [cx, cz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
        ]) {
            B.add(m.steel, boxMinMax(L.x + cx * 0.07 - 0.008, L.y - 0.14, L.z + cz * 0.07 - 0.008, L.x + cx * 0.07 + 0.008, L.y + 0.08, L.z + cz * 0.07 + 0.008, 'y'), { cast: true, role: 'lights' });
        }
        B.add(m.steel, boxMinMax(L.x - 0.085, L.y - 0.16, L.z - 0.085, L.x + 0.085, L.y - 0.135, L.z + 0.085, 'x'), { cast: true, role: 'lights' });
        const roof = new THREE.ConeGeometry(0.13, 0.1, 4);
        roof.rotateY(Math.PI / 4);
        roof.translate(L.x, L.y + 0.13, L.z);
        B.add(m.steel, roof, { cast: true, role: 'lights' });
        const cap = snowStrip(new THREE.Vector3(L.x - 0.07, L.y + 0.16, L.z), new THREE.Vector3(L.x + 0.07, L.y + 0.16, L.z), 0.12, 0.05, 77);
        B.add(m.snow, cap, { role: 'snow' });
        const glass = new THREE.BoxGeometry(0.13, 0.2, 0.13);
        glass.translate(L.x, L.y - 0.03, L.z);
        B.add(doorLamp, glass, { role: 'lights' });
    }
    return { meshes: B.build('deck'), lid, lidBack, water, bulbs, bulbMat, stoveGlow, bulbPts, fireLitMats: [mats.staves, mats.benchWood, mats.ring, mats.bark, mats.char], doorLamp, doorLampPos: DOOR_LAMP };
}
