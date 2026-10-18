/**
 * Small timber buildings for the outdoor sites: the hot spring's changing
 * hut, the ice-fishing hut on Mirror Lake and the lakeside sauna. A box of
 * board-and-batten walls (vertical boards, openings cut out) under a steep
 * gable roof with a fat snow load curling over the eaves and icicles hanging
 * from them, white corner boards and window frames, a plank door, warm
 * windows that light up after dark, and optionally a stove pipe, a fieldstone
 * chimney, runners (to drag a hut over the ice) or corner stones.
 *
 * Built in a local frame (origin on the floor at the centre, ridge along +x,
 * the front wall facing +z) and turned into the world by `rotY`: local +z
 * points along (sin rotY, cos rotY). Everything is merged per material.
 */
import * as THREE from 'three';
import { applyBoxUV, hitBox, icicles, snowCap } from '../../core/geometry.js';
import { SNOW_WIND } from '../../world/layout.js';
import { Batch } from '../house/kit.js';
import { driftGeometry } from './drift.js';
import { flatStoneGeometry, noise3, paintVertices } from '../paths/kit/rocks.js';
/** Warm window glass for the huts: dark by day, glowing after dark (drive `emissiveIntensity`). */
export function hutGlowMaterial(name = 'hutWindow') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    // a lamp low inside the room: brightest low in the middle, falling off up and to the sides
    const grd = g.createRadialGradient(32, 46, 2, 32, 40, 46);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.45, '#c9c9c9');
    grd.addColorStop(1, '#555555');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({
        name,
        color: 0x14161a,
        roughness: 0.12,
        metalness: 0,
        emissive: 0xffa95c,
        emissiveMap: tex,
        emissiveIntensity: 0,
    });
    m.userData.snow = 0;
    return m;
}
/** Box with metre UVs from min/max corners. */
function bx(x0, y0, z0, x1, y1, z1, grain) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return applyBoxUV(g, { grain });
}
/**
 * A wall panel in the plane of one side: `outline` (s, y) with rectangular
 * holes, extruded `t` inward from the outer face. Returns local geometry.
 */
function wallPanel(side, spec, outline, holes, t) {
    const shape = new THREE.Shape(outline.map(([s, y]) => new THREE.Vector2(s, y)));
    for (const o of holes) {
        const p = new THREE.Path();
        p.moveTo(o.s - o.w / 2, o.y);
        p.lineTo(o.s + o.w / 2, o.y);
        p.lineTo(o.s + o.w / 2, o.y + o.h);
        p.lineTo(o.s - o.w / 2, o.y + o.h);
        p.closePath();
        shape.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    // extruded along +z from 0..t: outer face at z = t; move so the outer face lies on the wall plane
    g.translate(0, 0, -t);
    const m = new THREE.Matrix4();
    const hw = spec.w / 2;
    const hd = spec.d / 2;
    if (side === 'front')
        m.makeTranslation(0, 0, hd);
    else if (side === 'back')
        m.makeRotationY(Math.PI).setPosition(0, 0, -hd);
    else if (side === 'left')
        m.makeRotationY(-Math.PI / 2).setPosition(-hw, 0, 0);
    else
        m.makeRotationY(Math.PI / 2).setPosition(hw, 0, 0);
    g.applyMatrix4(m);
    g.deleteAttribute('uv');
    return applyBoxUV(g.index ? g.toNonIndexed() : g, { grain: 'y' });
}
/** Map a point in a side's wall coordinates (s along the wall, y up, out = distance outside the face) to local. */
function sidePoint(side, spec, s, y, out) {
    const hw = spec.w / 2;
    const hd = spec.d / 2;
    if (side === 'front')
        return new THREE.Vector3(s, y, hd + out);
    if (side === 'back')
        return new THREE.Vector3(-s, y, -hd - out);
    if (side === 'left')
        return new THREE.Vector3(-hw - out, y, s);
    return new THREE.Vector3(hw + out, y, -s);
}
function sideNormal(side) {
    if (side === 'front')
        return new THREE.Vector3(0, 0, 1);
    if (side === 'back')
        return new THREE.Vector3(0, 0, -1);
    if (side === 'left')
        return new THREE.Vector3(-1, 0, 0);
    return new THREE.Vector3(1, 0, 0);
}
/** A box in a side's wall coordinates: centre (s, y), size (ws, hy), from `out0` to `out1` outside the face. */
function sideBox(side, spec, s, y, ws, hy, out0, out1, grain = 'y') {
    const a = sidePoint(side, spec, s - ws / 2, y - hy / 2, out0);
    const b = sidePoint(side, spec, s + ws / 2, y + hy / 2, out1);
    // along-wall grain: x for front/back, z for the gables
    const g2 = grain === 'x' && (side === 'left' || side === 'right') ? 'z' : grain;
    return bx(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z), g2);
}
export function buildHut(ctx, spec, glow) {
    const M = ctx.materials;
    const wallMat = M.get(spec.wall);
    const trimMat = spec.trim === null ? wallMat : M.get(spec.trim ?? 'whiteTrim');
    const roofMat = M.get('tarredWood');
    const timber = M.get('weatheredTimber');
    const steel = M.get('blackSteel');
    const iron = M.get('castIron');
    const snowMat = M.get('snowPack');
    const iceMat = M.get('ice');
    const stoneMat = M.get('fieldstone');
    const batch = new Batch();
    const hw = spec.w / 2;
    const hd = spec.d / 2;
    const H = spec.wallH;
    const ridgeY = H + hd * spec.pitch;
    const T = 0.07;
    const doors = spec.doors ?? [];
    const windows = spec.windows ?? [];
    const openings = [...doors, ...windows];
    const holesOn = (side) => openings.filter((o) => o.side === side);
    /* ---------- walls ---------- */
    batch.add(wallMat, wallPanel('front', spec, [[-hw, 0], [hw, 0], [hw, H], [-hw, H]], holesOn('front'), T), { cast: true });
    batch.add(wallMat, wallPanel('back', spec, [[-hw, 0], [hw, 0], [hw, H], [-hw, H]], holesOn('back'), T), { cast: true });
    const gable = [[-hd, 0], [hd, 0], [hd, H], [0, ridgeY], [-hd, H]];
    batch.add(wallMat, wallPanel('left', spec, gable, holesOn('left'), T), { cast: true });
    batch.add(wallMat, wallPanel('right', spec, gable, holesOn('right'), T), { cast: true });
    // a dark floor and inner lining so the shell never looks hollow through a gap
    batch.add(roofMat, bx(-hw + T, -0.02, -hd + T, hw - T, 0.02, hd - T), {});
    /* ---------- trim: corner boards, frames, barge boards ---------- */
    const TW = 0.1;
    const TT = 0.025;
    if (spec.trim !== null) {
        for (const [sx, sz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ]) {
            const xa = sx * (hw - TW + TT);
            const xb = sx * (hw + TT);
            const za = sz * hd;
            const zb = sz * (hd + TT);
            batch.add(trimMat, bx(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), H, Math.max(za, zb), 'y'), { cast: true });
            const xc = sx * hw;
            const xd = sx * (hw + TT);
            const zc = sz * (hd - TW + TT);
            const zd = sz * (hd + TT);
            batch.add(trimMat, bx(Math.min(xc, xd), 0, Math.min(zc, zd), Math.max(xc, xd), H, Math.max(zc, zd), 'y'), { cast: true });
        }
    }
    for (const o of openings) {
        const isDoor = doors.includes(o);
        const fw = 0.075;
        // frame boards round the opening
        batch.add(trimMat, sideBox(o.side, spec, o.s - o.w / 2 - fw / 2, o.y + o.h / 2, fw, o.h + (isDoor ? 0 : fw * 2), 0, TT), { cast: true });
        batch.add(trimMat, sideBox(o.side, spec, o.s + o.w / 2 + fw / 2, o.y + o.h / 2, fw, o.h + (isDoor ? 0 : fw * 2), 0, TT), { cast: true });
        batch.add(trimMat, sideBox(o.side, spec, o.s, o.y + o.h + fw / 2 + 0.01, o.w + fw * 2 + 0.06, fw + 0.02, 0, TT + 0.005, 'x'), { cast: true });
        // reveal (the wall thickness inside the opening)
        batch.add(trimMat, sideBox(o.side, spec, o.s - o.w / 2 + 0.01, o.y + o.h / 2, 0.02, o.h, -T, 0, 'y'), {});
        batch.add(trimMat, sideBox(o.side, spec, o.s + o.w / 2 - 0.01, o.y + o.h / 2, 0.02, o.h, -T, 0, 'y'), {});
        batch.add(trimMat, sideBox(o.side, spec, o.s, o.y + o.h - 0.01, o.w, 0.02, -T, 0, 'x'), {});
        if (isDoor) {
            // plank door, set back in the opening, with a black ring handle and a threshold board
            batch.add(timber, sideBox(o.side, spec, o.s, o.y + o.h / 2, o.w - 0.02, o.h - 0.01, -0.05, -0.015, 'y'), { cast: true });
            for (const yy of [0.25, o.h - 0.3])
                batch.add(timber, sideBox(o.side, spec, o.s, o.y + yy, o.w - 0.1, 0.1, -0.015, 0.005, 'x'), {});
            batch.add(iron, sideBox(o.side, spec, o.s + o.w / 2 - 0.13, o.y + 1.0, 0.035, 0.12, -0.015, 0.03), {});
            batch.add(timber, sideBox(o.side, spec, o.s, o.y - 0.025, o.w + 0.2, 0.05, -T, 0.18, 'x'), { cast: true });
        }
        else {
            // sill (snow settles on it), glass, a cross of glazing bars
            batch.add(trimMat, sideBox(o.side, spec, o.s, o.y - 0.03, o.w + 0.22, 0.045, -0.02, 0.07, 'x'), { cast: true });
            batch.add(glow, sideBox(o.side, spec, o.s, o.y + o.h / 2, o.w, o.h, -0.045, -0.035), {});
            batch.add(trimMat, sideBox(o.side, spec, o.s, o.y + o.h / 2, 0.035, o.h, -0.035, -0.01, 'y'), {});
            batch.add(trimMat, sideBox(o.side, spec, o.s, o.y + o.h * 0.55, o.w, 0.035, -0.035, -0.01, 'x'), {});
        }
    }
    /* ---------- roof ---------- */
    const roofT = 0.09;
    const run = hd + spec.eave;
    const slopeLen = Math.hypot(run, run * spec.pitch);
    const ang = Math.atan(spec.pitch);
    const cosA = Math.cos(ang);
    // the roof's underside meets the wall's outer top edge
    const yAtWall = H;
    const yRidgeUnder = yAtWall + hd * spec.pitch;
    const roofLen = spec.w + spec.rake * 2;
    const roofGeos = [];
    for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(roofLen, roofT, slopeLen + roofT * 0.6);
        applyBoxUV(g, { grain: 'x' });
        // centre of the slab: halfway down the slope from the ridge, lifted by half its thickness
        const cz = (side * run) / 2;
        const cy = yRidgeUnder - (run / 2) * spec.pitch + (roofT / 2) / cosA;
        g.rotateX(side * ang);
        g.translate(0, cy, cz);
        roofGeos.push(g);
        batch.add(roofMat, g, { cast: true });
    }
    // barge boards along the rakes and fascia boards along the eaves
    if (spec.trim !== null) {
        for (const sx of [-1, 1]) {
            for (const side of [-1, 1]) {
                const a = new THREE.Vector3(sx * (hw + spec.rake + 0.01), yRidgeUnder + roofT * 0.5, 0);
                const b = new THREE.Vector3(sx * (hw + spec.rake + 0.01), yRidgeUnder - run * spec.pitch + roofT * 0.5, side * run);
                const len = a.distanceTo(b);
                const g = new THREE.BoxGeometry(0.03, 0.16, len);
                applyBoxUV(g, { grain: 'z' });
                g.rotateX(side * ang);
                g.translate((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.02, (a.z + b.z) / 2);
                batch.add(trimMat, g, { cast: true });
            }
        }
        for (const side of [-1, 1]) {
            const y = yRidgeUnder - run * spec.pitch;
            batch.add(trimMat, bx(-roofLen / 2, y - 0.08, side * run - 0.015, roofLen / 2, y + 0.06, side * run + 0.015, 'x'), { cast: true });
        }
    }
    /* ---------- snow load and icicles ---------- */
    const snowT = spec.snow ?? 0.28;
    if (snowT > 0) {
        const merged = new THREE.BufferGeometry();
        {
            const parts = roofGeos.map((g) => (g.index ? g.toNonIndexed() : g.clone()));
            const n = parts.reduce((s, p) => s + p.getAttribute('position').count, 0);
            const pos = new Float32Array(n * 3);
            let o = 0;
            for (const p of parts) {
                pos.set(p.getAttribute('position').array, o);
                o += p.getAttribute('position').count * 3;
            }
            merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        }
        const cap = snowCap(merged, { thickness: snowT, cell: ctx.quality.fancy ? 0.045 : 0.07, overhang: snowT * 0.55, sag: 0.8, lumps: 0.5, minUp: 0.3, seed: spec.seed ?? 3 });
        if (cap)
            batch.add(snowMat, cap, { cast: true });
    }
    const iceLen = spec.icicles ?? 0.3;
    if (iceLen > 0) {
        const y = yRidgeUnder - run * spec.pitch - 0.07;
        const edges = [];
        for (const side of [-1, 1])
            edges.push([new THREE.Vector3(-roofLen / 2 + 0.08, y, side * (run + 0.01)), new THREE.Vector3(roofLen / 2 - 0.08, y, side * (run + 0.01))]);
        const ic = icicles(edges, { spacing: 0.1, maxLength: iceLen, radius: 0.02, density: 0.55, seed: (spec.seed ?? 3) + 7 });
        if (ic)
            batch.add(iceMat, ic, {});
    }
    /* ---------- stove pipe / chimney ---------- */
    let flueLocal = null;
    const roofTopAt = (z) => yRidgeUnder + roofT / cosA - Math.abs(z) * spec.pitch;
    if (spec.pipe) {
        const p = spec.pipe;
        const top = ridgeY + p.h;
        const base = roofTopAt(p.z) - 0.1;
        const pg = new THREE.CylinderGeometry(p.r, p.r, top - base, 14);
        pg.translate(p.x, (top + base) / 2, p.z);
        batch.add(steel, applyBoxUV(pg, { grain: 'y' }), { cast: true });
        // flashing collar and a rain hat
        const collar = new THREE.CylinderGeometry(p.r * 1.9, p.r * 2.3, 0.1, 14);
        collar.translate(p.x, roofTopAt(p.z) + snowT * 0.6, p.z);
        batch.add(steel, applyBoxUV(collar), {});
        const hat = new THREE.ConeGeometry(p.r * 2.4, p.r * 1.4, 14);
        hat.translate(p.x, top + p.r * 1.5, p.z);
        batch.add(steel, applyBoxUV(hat), { cast: true });
        for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            const leg = new THREE.CylinderGeometry(0.006, 0.006, p.r * 1.2, 4);
            leg.translate(p.x + Math.cos(a) * p.r * 0.9, top + p.r * 0.6, p.z + Math.sin(a) * p.r * 0.9);
            batch.add(steel, applyBoxUV(leg), {});
        }
        flueLocal = new THREE.Vector3(p.x, top + p.r * 0.9, p.z);
    }
    if (spec.chimney) {
        const c = spec.chimney;
        const top = ridgeY + c.h;
        const base = Math.min(roofTopAt(c.z + c.size / 2), roofTopAt(c.z - c.size / 2)) - 0.3;
        const g = bx(c.x - c.size / 2, base, c.z - c.size / 2, c.x + c.size / 2, top, c.z + c.size / 2);
        batch.add(stoneMat, g, { cast: true });
        batch.add(steel, bx(c.x - c.size / 2 - 0.04, top, c.z - c.size / 2 - 0.04, c.x + c.size / 2 + 0.04, top + 0.06, c.z + c.size / 2 + 0.04), { cast: true });
        const cap = snowCap(bx(c.x - c.size / 2 - 0.04, top, c.z - c.size / 2 - 0.04, c.x + c.size / 2 + 0.04, top + 0.06, c.z + c.size / 2 + 0.04), { thickness: 0.07, cell: 0.03, overhang: 0.03, seed: 5 });
        // a ring of snow, the hot flue keeps the middle bare
        if (cap) {
            const pos = cap.getAttribute('position');
            for (let i = 0; i < pos.count; i++) {
                const d = Math.max(Math.abs(pos.getX(i) - c.x), Math.abs(pos.getZ(i) - c.z));
                if (d < c.size * 0.3)
                    pos.setY(i, Math.min(pos.getY(i), top + 0.05));
            }
            cap.computeVertexNormals();
            batch.add(snowMat, cap, {});
        }
        flueLocal = new THREE.Vector3(c.x, top + 0.1, c.z);
    }
    /* ---------- base ---------- */
    const baseH = spec.baseH ?? 0.15;
    if (spec.base === 'skids') {
        for (const sz of [-1, 1]) {
            const z = sz * (hd - 0.25);
            const g = bx(-hw - 0.25, -baseH, z - 0.07, hw + 0.25, -0.02, z + 0.07, 'x');
            // turn the runner ends up like a sledge's
            const pos = g.getAttribute('position');
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const e = Math.max(0, Math.abs(x) - hw);
                if (pos.getY(i) < -baseH + 0.01)
                    pos.setY(i, -baseH + e * 0.55);
            }
            g.computeVertexNormals();
            batch.add(timber, g, { cast: true });
        }
        for (const sx of [-1, 0, 1])
            batch.add(timber, bx(sx * (hw - 0.15) - 0.05, -0.09, -hd + 0.05, sx * (hw - 0.15) + 0.05, -0.02, hd - 0.05, 'z'), {});
    }
    else if (spec.base === 'plinth') {
        const g = bx(-hw - 0.04, -baseH - 0.15, -hd - 0.04, hw + 0.04, 0.0, hd + 0.04);
        batch.add(stoneMat, g, { cast: true });
    }
    else {
        const rnd = (i) => Math.abs(Math.sin(i * 12.9898 + (spec.seed ?? 1) * 78.233) * 43758.5453) % 1;
        let k = 0;
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const g = flatStoneGeometry((spec.seed ?? 1) * 10 + k, 0.24 + rnd(k) * 0.06, baseH + 0.18, 0.22 + rnd(k + 9) * 0.06, 0.3, 14);
                g.translate(sx * (hw - 0.12), -baseH - 0.16, sz * (hd - 0.12));
                paintVertices(g, (p, _n, c) => c.setRGB(0.62, 0.62, 0.64).multiplyScalar(0.85 + 0.25 * noise3(p.x * 3, p.y * 3, p.z * 3)));
                k++;
                batch.add(stoneMat, g, { cast: true });
            }
        }
        // a skirt board hides the gap under the floor
        batch.add(roofMat, bx(-hw + 0.02, -baseH, -hd + 0.02, hw - 0.02, 0.0, hd - 0.02), {});
    }
    /* ---------- drifts against the walls ---------- */
    if (spec.drifts) {
        // the storm wind (world) in hut-local axes: drifts pile on the lee side
        const lw = new THREE.Vector3(SNOW_WIND.x, 0, SNOW_WIND.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -spec.rotY);
        const floor = -(spec.baseH ?? 0.15);
        const sides = [
            ['front', 0, hd],
            ['back', 0, -hd],
            ['left', -hw, 0],
            ['right', hw, 0],
        ];
        for (const [side, cx, cz] of sides) {
            const n = sideNormal(side);
            const lee = Math.max(0, n.x * lw.x + n.z * lw.z);
            const len = side === 'front' || side === 'back' ? spec.w : spec.d;
            // skip in front of doors
            if (doors.some((o) => o.side === side) && lee < 0.5)
                continue;
            const depth = 0.1 + 0.3 * lee;
            const across = 0.35 + 0.7 * lee;
            const rot = side === 'front' || side === 'back' ? 0 : Math.PI / 2;
            const ox = cx + n.x * (across * 0.55);
            const oz = cz + n.z * (across * 0.55);
            batch.add(snowMat, driftGeometry(ox, oz, len * 0.62, across, depth, () => floor - 0.02, { rot, skew: 0, seg: 10, sink: 0.06 }), {});
        }
    }
    /* ---------- assemble in the world ---------- */
    const group = new THREE.Group();
    group.name = spec.name;
    const meshes = batch.build(spec.name);
    const world = new THREE.Matrix4().makeRotationY(spec.rotY).setPosition(spec.x, spec.y, spec.z);
    for (const m of meshes) {
        m.geometry.applyMatrix4(world);
        m.geometry.computeBoundingSphere();
        // vertex colours (stones) are only in some pieces: strip them where the material has none
        if (!m.material.vertexColors && m.geometry.getAttribute('color'))
            m.geometry.deleteAttribute('color');
        group.add(m);
    }
    const toWorld = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(world);
    const corners = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
    ].map(([x, z]) => {
        const p = toWorld(x, 0, z);
        return [p.x, p.z];
    });
    const rot = new THREE.Matrix4().makeRotationY(spec.rotY);
    const windowLights = windows.map((o) => {
        const p = toWorld(sidePoint(o.side, spec, o.s, o.y, 0).x, o.y, sidePoint(o.side, spec, o.s, o.y, 0).z);
        const n = sideNormal(o.side).applyMatrix4(rot);
        return { x: p.x, z: p.z, y: p.y, nx: n.x, nz: n.z, w: o.w };
    });
    const doorSteps = doors.map((o) => {
        const lp = sidePoint(o.side, spec, o.s, 0, 0.45);
        return toWorld(lp.x, 0, lp.z);
    });
    const pick = hitBox(spec.w + 0.4, ridgeY + 0.3, spec.d + 0.4);
    pick.position.copy(toWorld(0, (ridgeY + 0.3) / 2, 0));
    pick.rotation.y = spec.rotY;
    return {
        object: group,
        flue: flueLocal ? toWorld(flueLocal.x, flueLocal.y, flueLocal.z) : null,
        pick,
        corners,
        windowLights,
        doorSteps,
        toWorld,
    };
}
