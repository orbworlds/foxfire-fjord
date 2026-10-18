/**
 * The cast-iron wood stove in front of the fieldstone chimney breast: a
 * squat box on short legs with a spruce in relief on each side, a glass door
 * on a hinge (coil-spring handle that stays cool), an ash-pan door with a
 * round air spinner, the flue rising off the top plate and turning into the
 * breast through a black rosette, a copper kettle steaming on the plate, and
 * inside the firebox three split logs burning on a bed of coals.
 *
 * Built in the stove's own frame (front = +z, y from the floor of the hearth)
 * and placed at HOUSE.stove on the hearth slab. Next to it: a woven basket of
 * birch logs, and the poker, shovel and brush on their stand.
 */
import * as THREE from 'three';
import { HOUSE } from '../../world/layout.js';
import { Batch, boxMinMax } from '../house/kit.js';
import { roundedBox } from '../../core/geometry.js';
import { vapour } from '../house/fx.js';
import { brickMaterial, coalMaterial, fireState, flameVolume, logMaterial, sparkPoints, stoveGlassMaterial } from './fire.js';
import { logGeometry, place, rod, tube, turned } from './kit.js';
/** the hearth slab's top (house-local y) */
export const HEARTH_Y = 0.025;
/* stove frame dimensions */
const SW = 0.5; // width (x)
const SD = 0.42; // depth (z)
const LEG = 0.13;
const ASH_TOP = 0.25;
const BODY_TOP = 0.8;
const PLATE_T = 0.035;
const TOP = BODY_TOP + PLATE_T;
const FRONT = SD / 2;
/** the door leaf: hinge at x = DOOR_X0 (viewer's left), y range */
const DOOR_X0 = -0.19;
const DOOR_X1 = 0.19;
const DOOR_Y0 = 0.29;
const DOOR_Y1 = 0.77;
const DOOR_T = 0.022;
/** the window in the door (door-local x from the hinge) */
const WIN = { x0: 0.05, x1: 0.33, y0: 0.37, y1: 0.69, r: 0.035 };
/** firebox inner box */
const BOX_MIN = new THREE.Vector3(-0.205, 0.27, -0.18);
const BOX_MAX = new THREE.Vector3(0.205, 0.765, 0.185);
/** the flue's collar on the top plate (z toward the breast) */
const FLUE = { x: 0, z: -0.09, r: 0.064, bendY: 1.24 };
export function buildStove(ctx, m) {
    const fancy = ctx.quality.fancy;
    const F = fireState(ctx);
    const root = new THREE.Group();
    root.name = 'stove';
    root.position.set(HOUSE.stove.x, HEARTH_Y, HOUSE.stove.z);
    root.rotation.y = HOUSE.stove.rotY;
    const iron = m.iron;
    const B = new Batch();
    const role = (r) => ({ role: r, cast: true });
    /* ---- legs, ash section, body panels, top plate ---- */
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            // short cast legs, splayed a little, with a pad foot
            const g = turned([
                [0.0, 0],
                [0.028, 0],
                [0.03, 0.012],
                [0.02, 0.03],
                [0.017, 0.08],
                [0.022, 0.115],
                [0.03, LEG],
                [0.0, LEG],
            ], 10);
            B.add(iron, place(g, sx * (SW / 2 - 0.045), 0, sz * (SD / 2 - 0.05)), role('stove'));
        }
    }
    B.add(iron, place(roundedBox(SW, ASH_TOP - LEG, SD, 0.012, 2), 0, (LEG + ASH_TOP) / 2, 0), role('stove'));
    // a cast plinth moulding between the ash section and the firebox
    B.add(iron, place(roundedBox(SW + 0.016, 0.018, SD + 0.016, 0.006, 2), 0, ASH_TOP, 0), role('stove'));
    // side panels, back, front frame round the door opening
    const pw = 0.03;
    B.add(iron, boxMinMax(-SW / 2, ASH_TOP, -SD / 2, -SW / 2 + pw, BODY_TOP, SD / 2, 'y'), role('stove'));
    B.add(iron, boxMinMax(SW / 2 - pw, ASH_TOP, -SD / 2, SW / 2, BODY_TOP, SD / 2, 'y'), role('stove'));
    B.add(iron, boxMinMax(-SW / 2 + pw, ASH_TOP, -SD / 2, SW / 2 - pw, BODY_TOP, -SD / 2 + pw, 'y'), role('stove'));
    B.add(iron, boxMinMax(-SW / 2 + pw, ASH_TOP, FRONT - 0.03, DOOR_X0 - 0.002, BODY_TOP, FRONT, 'y'), role('stove'));
    B.add(iron, boxMinMax(DOOR_X1 + 0.002, ASH_TOP, FRONT - 0.03, SW / 2 - pw, BODY_TOP, FRONT, 'y'), role('stove'));
    B.add(iron, boxMinMax(DOOR_X0, ASH_TOP, FRONT - 0.03, DOOR_X1, DOOR_Y0 - 0.002, FRONT, 'x'), role('stove'));
    B.add(iron, boxMinMax(DOOR_X0, DOOR_Y1 + 0.002, FRONT - 0.03, DOOR_X1, BODY_TOP, FRONT, 'x'), role('stove'));
    // firebox floor (the grate under the coals) and the baffle under the top
    B.add(iron, boxMinMax(BOX_MIN.x, ASH_TOP, BOX_MIN.z, BOX_MAX.x, BOX_MIN.y, BOX_MAX.z, 'x'), role('stove'));
    B.add(iron, boxMinMax(BOX_MIN.x, BOX_MAX.y, BOX_MIN.z, BOX_MAX.x, BODY_TOP, BOX_MAX.z, 'x'), role('stove'));
    // top plate, slightly overhanging, with a raised rim
    B.add(iron, place(roundedBox(SW + 0.03, PLATE_T, SD + 0.03, 0.008, 2), 0, BODY_TOP + PLATE_T / 2, 0), role('stove'));
    for (const sz of [-1, 1])
        B.add(iron, boxMinMax(-SW / 2 - 0.012, TOP, sz * (SD / 2 + 0.012) - (sz > 0 ? 0.012 : 0), SW / 2 + 0.012, TOP + 0.01, sz * (SD / 2 + 0.012) + (sz < 0 ? 0.012 : 0), 'x'), role('stove'));
    // raised frames and a spruce in relief on the side panels
    const tree = spruceRelief();
    for (const sx of [-1, 1]) {
        const x = sx * (SW / 2);
        const fr = 0.012;
        const z0 = -SD / 2 + 0.05;
        const z1 = SD / 2 - 0.05;
        const y0 = ASH_TOP + 0.05;
        const y1 = BODY_TOP - 0.05;
        const xo = sx > 0 ? x : x - 0.005;
        B.add(iron, boxMinMax(xo, y0, z0, xo + 0.005, y0 + fr, z1, 'z'), role('stove'));
        B.add(iron, boxMinMax(xo, y1 - fr, z0, xo + 0.005, y1, z1, 'z'), role('stove'));
        B.add(iron, boxMinMax(xo, y0, z0, xo + 0.005, y1, z0 + fr, 'y'), role('stove'));
        B.add(iron, boxMinMax(xo, y0, z1 - fr, xo + 0.005, y1, z1, 'y'), role('stove'));
        const t = tree.clone();
        t.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        t.translate(x, (y0 + y1) / 2 - 0.2, 0);
        B.add(iron, t, role('stove'));
    }
    // ash-pan door with a round air spinner
    B.add(iron, boxMinMax(-0.17, LEG + 0.025, FRONT, 0.17, ASH_TOP - 0.02, FRONT + 0.012, 'x'), role('stove'));
    {
        const sp = new THREE.CylinderGeometry(0.038, 0.038, 0.008, 18);
        sp.rotateX(Math.PI / 2);
        B.add(iron, place(sp, 0, (LEG + ASH_TOP) / 2, FRONT + 0.016), role('stove'));
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const fin = new THREE.BoxGeometry(0.03, 0.006, 0.005);
            fin.rotateZ(a);
            B.add(m.black, place(fin, Math.cos(a) * 0.015, (LEG + ASH_TOP) / 2 + Math.sin(a) * 0.015, FRONT + 0.021), role('stove'));
        }
        const knob = new THREE.SphereGeometry(0.008, 8, 6);
        B.add(m.brass, place(knob, 0, (LEG + ASH_TOP) / 2, FRONT + 0.024), role('stove'));
    }
    // hinge knuckles on the left of the door
    for (const y of [DOOR_Y0 + 0.06, DOOR_Y1 - 0.06]) {
        const k = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 10);
        B.add(iron, place(k, DOOR_X0 - 0.01, y, FRONT + 0.012), role('stove'));
    }
    /* ---- flue: collar, pipe, elbow into the breast, rosette ---- */
    {
        const r = FLUE.r;
        const breastZ = -(HOUSE.stove.x - (HOUSE.chimney.x + HOUSE.chimney.w / 2)) - 0.005;
        B.add(iron, place(turned([[0, 0], [r + 0.018, 0], [r + 0.012, 0.035], [r + 0.004, 0.04], [0, 0.04]], 20), FLUE.x, TOP, FLUE.z), role('flue'));
        const bendR = 0.13;
        const pts = [];
        pts.push(new THREE.Vector3(FLUE.x, TOP + 0.03, FLUE.z));
        pts.push(new THREE.Vector3(FLUE.x, FLUE.bendY - bendR, FLUE.z));
        for (let k = 1; k <= 6; k++) {
            const a = (k / 6) * (Math.PI / 2);
            pts.push(new THREE.Vector3(FLUE.x, FLUE.bendY - bendR + Math.sin(a) * bendR, FLUE.z - (1 - Math.cos(a)) * bendR));
        }
        pts.push(new THREE.Vector3(FLUE.x, FLUE.bendY, breastZ + 0.02));
        const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 40, r, 20, false);
        B.add(m.steel, pipe, role('flue'));
        // a damper handle on the riser and the joint rings
        B.add(m.steel, place(new THREE.TorusGeometry(r + 0.004, 0.005, 6, 24), FLUE.x, TOP + 0.24, FLUE.z, 0, Math.PI / 2), role('flue'));
        B.add(m.brass, rod(new THREE.Vector3(FLUE.x - r - 0.05, TOP + 0.33, FLUE.z), new THREE.Vector3(FLUE.x + r + 0.05, TOP + 0.33, FLUE.z), 0.004, 6), role('flue'));
        const ros = new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.012, 28);
        ros.rotateX(Math.PI / 2);
        B.add(m.steel, place(ros, FLUE.x, FLUE.bendY, breastZ), role('flue'));
    }
    /* ---- copper kettle on the top plate ---- */
    const kettle = new THREE.Group();
    kettle.name = 'stove-kettle';
    const KX = 0.075;
    const KZ = 0.07;
    {
        const K = new Batch();
        const body = turned([
            [0, 0],
            [0.07, 0],
            [0.088, 0.008],
            [0.1, 0.035],
            [0.098, 0.065],
            [0.083, 0.098],
            [0.058, 0.118],
            [0.046, 0.124],
            [0.046, 0.13],
            [0.0, 0.13],
        ], 28);
        K.add(m.copper, body, { cast: true, role: 'kettle' });
        const lid = turned([[0, 0.13], [0.05, 0.13], [0.05, 0.136], [0.03, 0.142], [0.012, 0.146], [0.012, 0.16], [0.02, 0.166], [0.0, 0.17]], 20);
        K.add(m.copper, lid, { role: 'kettle' });
        // spout: a swan neck rising out of the shoulder toward the room
        const sp = [new THREE.Vector3(0.0, 0.05, 0.085), new THREE.Vector3(0.0, 0.085, 0.135), new THREE.Vector3(0.0, 0.13, 0.16), new THREE.Vector3(0.0, 0.152, 0.185)];
        K.add(m.copper, tube(sp, 0.012, 16, 8), { role: 'kettle' });
        // a bail handle of brass with a wooden grip
        const hp = [new THREE.Vector3(-0.07, 0.11, 0), new THREE.Vector3(-0.055, 0.2, 0), new THREE.Vector3(0, 0.235, 0), new THREE.Vector3(0.055, 0.2, 0), new THREE.Vector3(0.07, 0.11, 0)];
        K.add(m.brass, tube(hp, 0.004, 24, 6), { role: 'kettle' });
        K.add(m.darkWood, rod(new THREE.Vector3(-0.03, 0.232, 0), new THREE.Vector3(0.03, 0.232, 0), 0.009, 10), { role: 'kettle' });
        for (const mesh of K.build('stove-kettle'))
            kettle.add(mesh);
        kettle.position.set(KX, TOP + 0.01, KZ);
        kettle.rotation.y = 0.5;
    }
    root.add(kettle);
    /* ---- firebox: bricks, coals, logs, flames, sparks ---- */
    const fireC = new THREE.Vector3(0, BOX_MIN.y + 0.1, -0.01);
    const box = new THREE.Group();
    box.name = 'firebox';
    const bricks = brickMaterial(F, m.brickMap, ctx.shared.uLampFill, fireC);
    {
        const bx = new Batch();
        const yb0 = BOX_MIN.y - 0.005;
        const yb1 = BOX_MAX.y + 0.005;
        // back, sides (faces turned inward) and the baffle's underside
        const face = (w, h, x, y, z, ry, rx = 0) => {
            const g = new THREE.PlaneGeometry(w, h);
            const uv = g.getAttribute('uv');
            for (let i = 0; i < uv.count; i++)
                uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
            return place(g, x, y, z, ry, rx);
        };
        bx.add(bricks, face(BOX_MAX.x - BOX_MIN.x + 0.01, yb1 - yb0, 0, (yb0 + yb1) / 2, BOX_MIN.z + 0.001, 0));
        bx.add(bricks, face(BOX_MAX.z - BOX_MIN.z + 0.02, yb1 - yb0, BOX_MIN.x + 0.001, (yb0 + yb1) / 2, (BOX_MIN.z + BOX_MAX.z) / 2, Math.PI / 2));
        bx.add(bricks, face(BOX_MAX.z - BOX_MIN.z + 0.02, yb1 - yb0, BOX_MAX.x - 0.001, (yb0 + yb1) / 2, (BOX_MIN.z + BOX_MAX.z) / 2, -Math.PI / 2));
        bx.add(bricks, face(BOX_MAX.x - BOX_MIN.x + 0.01, BOX_MAX.z - BOX_MIN.z + 0.02, 0, BOX_MAX.y - 0.001, (BOX_MIN.z + BOX_MAX.z) / 2, 0, Math.PI / 2));
        for (const mesh of bx.build('firebox')) {
            mesh.castShadow = false;
            mesh.raycast = () => { };
            box.add(mesh);
        }
        // a mound of coals: a few soft lumps (displaced grid)
        const cg = new THREE.PlaneGeometry(BOX_MAX.x - BOX_MIN.x - 0.004, BOX_MAX.z - BOX_MIN.z - 0.004, 14, 12);
        cg.rotateX(-Math.PI / 2);
        const cp = cg.getAttribute('position');
        for (let i = 0; i < cp.count; i++) {
            const x = cp.getX(i);
            const z = cp.getZ(i);
            const mound = 0.03 * Math.exp(-(x * x) / 0.02 - (z * z) / 0.015) + 0.006 * Math.sin(x * 61) * Math.sin(z * 47);
            cp.setY(i, mound);
        }
        cg.computeVertexNormals();
        const coals = new THREE.Mesh(place(cg, 0, BOX_MIN.y + 0.004, (BOX_MIN.z + BOX_MAX.z) / 2), coalMaterial(F));
        coals.name = 'stove-coals';
        coals.raycast = () => { };
        box.add(coals);
    }
    // three split logs: two side by side, one across them
    const logs = [
        { a: new THREE.Vector3(-0.165, BOX_MIN.y + 0.045, -0.085), b: new THREE.Vector3(0.155, BOX_MIN.y + 0.04, -0.06), r: 0.043, hf: 0.2 },
        { a: new THREE.Vector3(-0.15, BOX_MIN.y + 0.04, 0.06), b: new THREE.Vector3(0.16, BOX_MIN.y + 0.044, 0.035), r: 0.039, hf: 0.17 },
        { a: new THREE.Vector3(-0.1, BOX_MIN.y + 0.112, 0.07), b: new THREE.Vector3(0.12, BOX_MIN.y + 0.1, -0.075), r: 0.034, hf: 0.24 },
    ];
    {
        const lm = logMaterial(F, fireC);
        const lb = new Batch();
        logs.forEach((l, i) => {
            const len = l.a.distanceTo(l.b);
            const g = logGeometry(len, l.r, 31 + i, 9);
            const dir = l.b.clone().sub(l.a).normalize();
            g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir));
            const c = l.a.clone().add(l.b).multiplyScalar(0.5);
            g.translate(c.x, c.y, c.z);
            lb.add(lm, g);
        });
        for (const mesh of lb.build('stove-logs')) {
            mesh.castShadow = false;
            mesh.raycast = () => { };
            box.add(mesh);
        }
    }
    const flames = flameVolume(F, BOX_MIN.clone().add(new THREE.Vector3(0.004, 0.004, 0.004)), BOX_MAX.clone().sub(new THREE.Vector3(0.004, 0.004, 0.004)), logs, fancy ? 40 : 28);
    box.add(flames.mesh);
    const sparks = sparkPoints(F, fancy ? 48 : 24, BOX_MIN, BOX_MAX, 7);
    box.add(sparks);
    root.add(box);
    /* ---- the door: leaf with its window, glass, handle ---- */
    const door = new THREE.Group();
    door.name = 'stove-door';
    door.position.set(DOOR_X0, 0, FRONT);
    {
        const D = new Batch();
        const w = DOOR_X1 - DOOR_X0;
        const shape = new THREE.Shape();
        shape.moveTo(0, DOOR_Y0);
        shape.lineTo(w, DOOR_Y0);
        shape.lineTo(w, DOOR_Y1);
        shape.lineTo(0, DOOR_Y1);
        shape.closePath();
        shape.holes.push(roundRectPath(WIN.x0, WIN.y0, WIN.x1, WIN.y1, WIN.r));
        const leaf = new THREE.ExtrudeGeometry(shape, { depth: DOOR_T, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
        boxUV(leaf);
        D.add(iron, leaf, { cast: true, role: 'door' });
        // a raised moulding round the window
        const rimShape = roundRectPath(WIN.x0 - 0.022, WIN.y0 - 0.022, WIN.x1 + 0.022, WIN.y1 + 0.022, WIN.r + 0.02);
        const rim = new THREE.Shape(rimShape.getPoints(6));
        rim.holes.push(roundRectPath(WIN.x0, WIN.y0, WIN.x1, WIN.y1, WIN.r));
        const rimG = new THREE.ExtrudeGeometry(rim, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
        rimG.translate(0, 0, DOOR_T + 0.002);
        boxUV(rimG);
        D.add(iron, rimG, { role: 'door' });
        // the coil-spring handle near the free edge
        const hx = w - 0.03;
        const hy = (DOOR_Y0 + DOOR_Y1) / 2;
        const coil = [];
        const turns = 7;
        for (let k = 0; k <= turns * 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            coil.push(new THREE.Vector3(hx + Math.cos(a) * 0.009, hy + Math.sin(a) * 0.009, DOOR_T + 0.006 + (k / (turns * 10)) * 0.06));
        }
        D.add(m.steel, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), turns * 16, 0.0022, 5, false), { role: 'door' });
        D.add(m.darkWood, place(turned([[0, 0], [0.012, 0], [0.016, 0.012], [0.014, 0.03], [0, 0.034]], 12), hx, hy, DOOR_T + 0.064, 0, Math.PI / 2), { role: 'door' });
        // latch cam inside the frame
        D.add(iron, boxMinMax(hx - 0.01, hy - 0.01, -0.012, hx + 0.03, hy + 0.01, 0, 'x'), { role: 'door' });
        for (const mesh of D.build('stove-door'))
            door.add(mesh);
        // ceramic glass in the window
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0 + 0.012, WIN.y1 - WIN.y0 + 0.012), stoveGlassMaterial(F, ctx.shared.uLampFill));
        glass.position.set((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, DOOR_T * 0.5);
        glass.name = 'stove-glass';
        glass.renderOrder = 7;
        door.add(glass);
    }
    root.add(door);
    const bodyMeshes = B.build('stove');
    const body = new THREE.Group();
    body.name = 'stove-body';
    for (const mesh of bodyMeshes)
        body.add(mesh);
    root.add(body);
    /* ---- light on the hearth in front of the door ---- */
    const pool = hearthGlow(F);
    pool.position.set(0, 0.002, FRONT);
    root.add(pool);
    /* ---- basket of birch logs and the fire tools (house-local, set by the caller's root) ---- */
    const basket = new THREE.Group();
    basket.name = 'log-basket';
    {
        const Bk = new Batch();
        // a round woven basket (rope coils) with two leather handles
        const bh = 0.36;
        const prof = [];
        for (let k = 0; k <= 12; k++) {
            const t = k / 12;
            prof.push([0.24 + 0.035 * Math.sin(t * Math.PI) - 0.02 * (1 - t), t * bh]);
        }
        const outer = turned([[0, 0.012], ...prof, [prof[prof.length - 1][0] - 0.018, bh], [0.2, bh - 0.02], [0.2, 0.03], [0, 0.03]], 26);
        Bk.add(m.rope, outer, { cast: true, role: 'basket' });
        // rim: a fat coil
        Bk.add(m.rope, place(new THREE.TorusGeometry(0.235, 0.016, 8, 32), 0, bh, 0, 0, Math.PI / 2), { role: 'basket' });
        for (const s of [-1, 1]) {
            const hp = [new THREE.Vector3(s * 0.25, bh - 0.04, -0.06), new THREE.Vector3(s * 0.28, bh + 0.06, -0.03), new THREE.Vector3(s * 0.28, bh + 0.06, 0.03), new THREE.Vector3(s * 0.25, bh - 0.04, 0.06)];
            Bk.add(m.leather, tube(hp, 0.012, 12, 6), { role: 'basket' });
        }
        // split birch logs standing and lying in it
        let seed = 71;
        const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
        // split birch logs lying in layers, the top ones heaped above the rim
        for (let k = 0; k < 11; k++) {
            const layer = Math.floor(k / 3);
            const len = 0.4 + rnd() * 0.08;
            const r = 0.032 + rnd() * 0.02;
            const parts = birchLog(len, r, 100 + k);
            const tilt = (rnd() - 0.5) * (layer > 2 ? 0.5 : 0.2);
            const yaw = (rnd() - 0.5) * 0.5 + (layer % 2) * 0.3;
            const z = ((k % 3) - 1) * 0.1 + (rnd() - 0.5) * 0.03;
            const y = 0.09 + layer * 0.085 + r;
            const dx = (rnd() - 0.5) * 0.02;
            for (const [g, mat] of [
                [parts.bark, m.birch],
                [parts.ends, m.pine],
            ]) {
                g.rotateZ(tilt);
                g.rotateY(yaw);
                g.translate(dx, y, z);
                Bk.add(mat, g, { cast: true, role: 'basket' });
            }
        }
        for (const mesh of Bk.build('basket'))
            basket.add(mesh);
    }
    const tools = new THREE.Group();
    tools.name = 'fire-tools';
    {
        const T = new Batch();
        // a stand: base disc, upright, a ring of hooks at the top
        T.add(m.steel, turned([[0, 0], [0.09, 0], [0.09, 0.012], [0.02, 0.02], [0, 0.02]], 18), { cast: true, role: 'tools' });
        T.add(m.steel, rod(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.66, 0), 0.007, 8), { cast: true, role: 'tools' });
        T.add(m.brass, place(new THREE.SphereGeometry(0.018, 10, 8), 0, 0.68, 0), { role: 'tools' });
        T.add(m.steel, place(new THREE.TorusGeometry(0.035, 0.004, 6, 18), 0, 0.6, 0, 0, Math.PI / 2), { role: 'tools' });
        // poker, shovel, brush hanging from it
        const hang = (a, kind) => {
            const x = Math.cos(a) * 0.04;
            const z = Math.sin(a) * 0.04;
            const top = new THREE.Vector3(x, 0.6, z);
            const bot = new THREE.Vector3(x * 1.8, 0.05, z * 1.8);
            T.add(m.steel, rod(top, bot, 0.005, 6), { cast: true, role: 'tools' });
            T.add(m.brass, place(new THREE.SphereGeometry(0.012, 8, 6), x, 0.63, z), { role: 'tools' });
            if (kind === 'shovel')
                T.add(m.steel, place(new THREE.BoxGeometry(0.08, 0.1, 0.004), bot.x, 0.07, bot.z, a + Math.PI / 2), { role: 'tools' });
            if (kind === 'brush')
                T.add(m.darkWood, place(roundedBox(0.07, 0.07, 0.03, 0.01, 2), bot.x, 0.07, bot.z, a + Math.PI / 2), { role: 'tools' });
            if (kind === 'poker')
                T.add(m.steel, rod(bot, bot.clone().add(new THREE.Vector3(Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.04)), 0.005, 6), { role: 'tools' });
        };
        hang(0.4, 'poker');
        hang(2.5, 'shovel');
        hang(4.4, 'brush');
        for (const mesh of T.build('tools'))
            tools.add(mesh);
    }
    /* ---- kettle steam (world space) ---- */
    root.updateMatrixWorld(true);
    let steam = null;
    const steamGlow = new THREE.Color();
    {
        const parent = new THREE.Object3D();
        root.add(parent);
        const tip = kettle.localToWorld(new THREE.Vector3(0, 0.155, 0.19));
        // the house-local root is placed by the caller: offset by the house origin
        tip.add(new THREE.Vector3(HOUSE.x, HOUSE.floorY, HOUSE.z));
        root.remove(parent);
        steam = vapour(ctx, {
            count: fancy ? 18 : 10,
            emitters: [{ x: tip.x, y: tip.y, z: tip.z, rx: 0.006, rz: 0.006 }],
            size: [0.015, 0.16],
            rise: [0.1, 0.2],
            life: [1.2, 2.6],
            drift: 0.02,
            opacity: 0.1,
            wander: 0.05,
            seed: 91,
            tint: 0xfff3e6,
        }, 
        // lit by the room: the lamps' warm fill, set each frame
        { color: steamGlow, y: tip.y, fade: 1.5 });
        steam.mesh.name = 'kettle-steam';
    }
    /* ---- light position: in front of the door, at the window's height (house-local) ---- */
    const lightPos = new THREE.Vector3(0, 0.5, FRONT + 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOUSE.stove.rotY).add(new THREE.Vector3(HOUSE.stove.x, HEARTH_Y, HOUSE.stove.z));
    let doorAngle = 0;
    const stove = {
        object: root,
        body,
        door,
        basket,
        tools,
        kettle,
        lightPos,
        fire: F,
        steam,
        update(dt, s) {
            // the door swings on its hinge (opens toward the viewer's left)
            const target = s.door * 1.85;
            doorAngle = s.shot ? target : doorAngle + (target - doorAngle) * Math.min(1, dt * 4);
            door.rotation.y = -doorAngle;
            const lvl = s.fire * (1 + 0.35 * s.door + 0.45 * s.stoke);
            F.uFire.value.set(lvl, Math.min(1.25, 0.2 + s.fire * (0.85 + 0.25 * s.door + 0.2 * s.stoke)), s.flicker, s.door);
            flames.mesh.visible = s.fire > 0.01;
            sparks.visible = s.fire > 0.05;
            if (steam) {
                steam.visibility = 0.25 + 0.75 * Math.min(1, s.fire);
                steamGlow.copy(ctx.shared.uLampFill.value).multiplyScalar(0.5);
            }
        },
    };
    return stove;
}
/** A soft warm glow thrown through the door's window onto the hearth (stove frame, additive). */
function hearthGlow(F) {
    const g = new THREE.PlaneGeometry(1.3, 1.0, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 0.45);
    const mat = new THREE.ShaderMaterial({
        name: 'hearthGlow',
        uniforms: { uFire: F.uFire, uTime: F.uTime, uNoise: F.uNoise },
        vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
      uniform vec4 uFire; uniform float uTime; uniform sampler2D uNoise;
      varying vec3 vP;
      void main() {
        // the window's light: a widening trapezoid out from the door, falling off with distance
        float z = max(vP.z, 0.0);
        float halfW = 0.12 + z * 0.6;
        float across = 1.0 - smoothstep(halfW * 0.25, halfW * 1.1, abs(vP.x));
        float near = smoothstep(0.0, 0.08, z) * (1.0 - smoothstep(0.05, 0.72, z));
        float dance = 0.8 + 0.4 * texture2D(uNoise, vec2(vP.x * 1.7, uTime * 0.6)).r;
        // with the door open the whole hearth glows
        float k = across * near * (1.0 + uFire.w) + uFire.w * (1.0 - smoothstep(0.05, 0.6, length((vP.xz - vec2(0.0, 0.12)) * vec2(1.0, 0.85)))) * 0.45;
        vec3 col = vec3(1.0, 0.45, 0.14) * k * dance * uFire.x * uFire.z * 0.11;
        gl_FragColor = vec4(col, 1.0);
      }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'hearth-glow';
    mesh.renderOrder = 3;
    mesh.raycast = () => { };
    return mesh;
}
/** a rounded rectangle as a closed path (for holes) */
function roundRectPath(x0, y0, x1, y1, r) {
    const p = new THREE.Path();
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r);
    p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1);
    p.quadraticCurveTo(x0, y1, x0, y1 - r);
    p.lineTo(x0, y0 + r);
    p.quadraticCurveTo(x0, y0, x0 + r, y0);
    return p;
}
/** metre box-UVs for extrusions (their own UVs are in shape units already, but sides are not) */
function boxUV(g) {
    g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const ax = Math.abs(nor.getX(i));
        const ay = Math.abs(nor.getY(i));
        const az = Math.abs(nor.getZ(i));
        const [u, v] = az >= ax && az >= ay ? [pos.getX(i), pos.getY(i)] : ax >= ay ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getZ(i)];
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** A stylised spruce in low relief (extruded, ~0.4 m tall), facing +z, base at y = 0. */
function spruceRelief() {
    const s = new THREE.Shape();
    const tiers = [
        [0.15, 0.06],
        [0.12, 0.13],
        [0.095, 0.2],
        [0.07, 0.26],
        [0.045, 0.31],
    ];
    s.moveTo(-0.012, 0.02);
    s.lineTo(-0.012, 0.06);
    for (const [hw, y] of tiers) {
        s.lineTo(-hw / 2, y);
        s.lineTo(-hw * 0.18, y + 0.012);
    }
    s.lineTo(0, 0.37);
    for (let i = tiers.length - 1; i >= 0; i--) {
        const [hw, y] = tiers[i];
        s.lineTo(hw * 0.18, y + 0.012);
        s.lineTo(hw / 2, y);
    }
    s.lineTo(0.012, 0.06);
    s.lineTo(0.012, 0.02);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    boxUV(g);
    return g;
}
/** A split birch log in two parts: the bark round its side and the pale end grain (lying along x, centred). */
function birchLog(len, r, seed) {
    const bark = logGeometry(len, r, seed, 9);
    // pale end grain as separate discs just proud of the bark's own caps
    const ends = new THREE.BufferGeometry();
    const capA = new THREE.CircleGeometry(r * 0.97, 9);
    capA.rotateY(Math.PI / 2);
    capA.translate(len / 2 + 0.001, 0, 0);
    const capB = new THREE.CircleGeometry(r * 0.97, 9);
    capB.rotateY(-Math.PI / 2);
    capB.translate(-len / 2 - 0.001, 0, 0);
    const pos = [];
    const nor = [];
    const uv = [];
    for (const c of [capA, capB]) {
        const nc = c.toNonIndexed();
        const p = nc.getAttribute('position');
        const n = nc.getAttribute('normal');
        for (let i = 0; i < p.count; i++) {
            pos.push(p.getX(i), p.getY(i), p.getZ(i));
            nor.push(n.getX(i), n.getY(i), n.getZ(i));
            uv.push(p.getZ(i) * 3, p.getY(i) * 3);
        }
        nc.dispose();
        c.dispose();
    }
    ends.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ends.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    ends.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return { bark: bark.index ? bark.toNonIndexed() : bark, ends };
}
