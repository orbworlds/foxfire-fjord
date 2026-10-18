/**
 * The cabin's three doors: the front door (south, a pine plank door with a
 * small frosted light), the half-glazed deck door (north) and the plank door
 * through the partition into the glass wing. Ledged pine boards on black iron
 * strap hinges; the outer doors open outward, the Nordic way. Each swings on
 * its hinge, carries a collider while closed, opens itself in walk mode when
 * you step up to it and closes again behind you.
 */
import * as THREE from 'three';
import { glassPane } from '../../core/geometry.js';
import { HOUSE } from '../../world/layout.js';
import { approach, boxMinMax, mergeAll, smooth01 } from './kit.js';
import { OPENINGS_BY_ID, WALLS, WALL_T } from './plan.js';
import { aOf, wallMatrix } from './shell.js';
const SPECS = [
    { id: 'entry', label: 'Front door', n: -0.06, hinge: 'a0', window: 'small' },
    { id: 'deck', label: 'Deck door', n: -0.06, hinge: 'a1', window: 'half' },
    { id: 'wing', label: 'Door to the glass wing', n: -0.02, hinge: 'a0', window: 'none' },
];
const LEAF_T = 0.05;
const OPEN_ANGLE = (100 * Math.PI) / 180;
export function buildDoors(ctx, m) {
    const object = new THREE.Group();
    object.name = 'house-doors';
    object.userData.snow = 0;
    const outside = ctx.materials.get('knottyPine');
    const doors = [];
    // the outer face looks out of the cabin (into the wing for the partition door), the inner face into the living room
    const inMat = (_id) => m.pine;
    const outMat = (id) => (id === 'wing' ? m.pineW : outside);
    for (const spec of SPECS) {
        const o = OPENINGS_BY_ID[spec.id];
        const f = WALLS[o.wall];
        const M = wallMatrix(f);
        const p = aOf(f, o.c - o.w / 2);
        const q = aOf(f, o.c + o.w / 2);
        const a0 = Math.min(p, q) + 0.006;
        const a1 = Math.max(p, q) - 0.006;
        const w = a1 - a0;
        const h = o.head - 0.012;
        const y0 = 0.02;
        // leaf built with its hinge edge at x = 0, spanning x 0..w (or -w..0), outer face at z = 0
        const dir = spec.hinge === 'a0' ? 1 : -1;
        const hx = spec.hinge === 'a0' ? a0 : a1;
        const parts = [];
        const slab = (x0, x1, ya, yb) => {
            const lx0 = Math.min(x0 * dir, x1 * dir);
            const lx1 = Math.max(x0 * dir, x1 * dir);
            parts.push({ g: boxMinMax(lx0, ya, -LEAF_T / 2, lx1, yb, 0, 'y'), mat: outMat(spec.id) });
            parts.push({ g: boxMinMax(lx0, ya, -LEAF_T, lx1, yb, -LEAF_T / 2, 'y'), mat: inMat(spec.id) });
        };
        const panes = [];
        if (spec.window === 'none') {
            slab(0, w, y0, h);
        }
        else {
            const wy0 = spec.window === 'small' ? h - 0.55 : h * 0.47;
            const wy1 = h - 0.12;
            const st = spec.window === 'small' ? 0.27 : 0.11;
            slab(0, w, y0, wy0);
            slab(0, w, wy1, h);
            slab(0, st, wy0, wy1);
            slab(w - st, w, wy0, wy1);
            const cols = spec.window === 'small' ? 1 : 2;
            const rows = spec.window === 'small' ? 2 : 3;
            const gw = (w - 2 * st - 0.02 * (cols - 1)) / cols;
            const gh = (wy1 - wy0 - 0.02 * (rows - 1)) / rows;
            for (let i = 0; i < cols; i++) {
                for (let k = 0; k < rows; k++) {
                    const gx = st + i * (gw + 0.02);
                    const gy = wy0 + k * (gh + 0.02);
                    const pg = glassPane(gw + 0.01, gh + 0.01);
                    pg.translate((gx + gw / 2) * dir, gy + gh / 2, -LEAF_T / 2);
                    panes.push(pg);
                    if (k > 0)
                        parts.push({ g: boxMinMax(Math.min(gx * dir, (gx + gw) * dir), gy - 0.02, -LEAF_T * 0.7, Math.max(gx * dir, (gx + gw) * dir), gy, -LEAF_T * 0.3, 'x'), mat: m.trim });
                }
                if (i > 0) {
                    const bx = st + i * (gw + 0.02) - 0.02;
                    parts.push({ g: boxMinMax(Math.min(bx * dir, (bx + 0.02) * dir), wy0, -LEAF_T * 0.7, Math.max(bx * dir, (bx + 0.02) * dir), wy1, -LEAF_T * 0.3, 'y'), mat: m.trim });
                }
            }
        }
        // ledges and a brace on the inside, strap hinges and a ring latch outside
        if (spec.window !== 'half') {
            for (const y of [0.32, h - 0.32])
                parts.push({ g: boxMinMax(Math.min(0.06 * dir, (w - 0.06) * dir), y - 0.07, -LEAF_T - 0.022, Math.max(0.06 * dir, (w - 0.06) * dir), y + 0.07, -LEAF_T, 'x'), mat: inMat(spec.id) });
        }
        for (const y of [0.3, h - 0.3]) {
            parts.push({ g: boxMinMax(Math.min(-0.02 * dir, w * 0.62 * dir), y - 0.022, 0, Math.max(-0.02 * dir, w * 0.62 * dir), y + 0.022, 0.006, 'x'), mat: m.iron });
        }
        const ring = new THREE.TorusGeometry(0.045, 0.007, 6, 14);
        ring.translate((w - 0.12) * dir, 1.02, 0.02);
        parts.push({ g: ring, mat: m.iron });
        parts.push({ g: boxMinMax(Math.min((w - 0.15) * dir, (w - 0.09) * dir), 1.06, 0, Math.max((w - 0.15) * dir, (w - 0.09) * dir), 1.1, 0.012, 'x'), mat: m.iron });
        const pivot = new THREE.Group();
        pivot.name = `door-${spec.id}`;
        const byMat = new Map();
        for (const pt of parts) {
            let l = byMat.get(pt.mat);
            if (!l)
                byMat.set(pt.mat, (l = []));
            l.push(pt.g);
        }
        for (const [mat, geos] of byMat) {
            const mesh = new THREE.Mesh(mergeAll(geos), mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.door = spec.id;
            pivot.add(mesh);
        }
        if (panes.length) {
            const glass = new THREE.Mesh(mergeAll(panes), spec.id === 'wing' ? m.glassW : m.glass);
            glass.userData.door = spec.id;
            pivot.add(glass);
        }
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.copy(M).multiply(new THREE.Matrix4().makeTranslation(hx, 0, spec.n));
        group.add(pivot);
        object.add(group);
        // collider across the opening while closed (world, along the wall's centre line)
        const s0 = o.c - o.w / 2;
        const s1 = o.c + o.w / 2;
        const mid = f.face - (f.axis === 'x' ? f.nz : f.nx) * (WALL_T / 2);
        const [ax, az, bx, bz] = f.axis === 'x' ? [s0, mid, s1, mid] : [mid, s0, mid, s1];
        const collider = ctx.colliders.addSegment(HOUSE.x + ax, HOUSE.z + az, HOUSE.x + bx, HOUSE.z + bz, 0.08, { tag: 'house-door' });
        const c = new THREE.Vector3((a0 + a1) / 2, 1, 0).applyMatrix4(M);
        doors.push({ spec, group, pivot, open: false, cur: 0, auto: false, collider, center: new THREE.Vector3(HOUSE.x + c.x, HOUSE.floorY + 1, HOUSE.z + c.z) });
    }
    const apply = (d) => {
        // swing out of the wall (+n): negative rotation about y for a hinge on a0, positive on a1
        const k = smooth01(d.cur);
        d.pivot.rotation.y = (d.spec.hinge === 'a0' ? -1 : 1) * OPEN_ANGLE * k;
        ctx.colliders.setEnabled(d.collider, k < 0.5);
    };
    doors.forEach(apply);
    return {
        object,
        doors,
        doorOf(hit) {
            const id = hit?.object.userData.door;
            return id ? (doors.find((d) => d.spec.id === id) ?? null) : null;
        },
        set(id, open) {
            const d = doors.find((x) => x.spec.id === id);
            if (d) {
                d.open = open;
                d.auto = false;
            }
        },
        update(dt, shot) {
            const cam = ctx.camera.position;
            const walking = ctx.state.mode === 'walk';
            for (const d of doors) {
                if (walking) {
                    const dist = Math.hypot(cam.x - d.center.x, cam.z - d.center.z);
                    if (!d.open && dist < 1.5) {
                        d.open = true;
                        d.auto = true;
                    }
                    else if (d.open && d.auto && dist > 2.6) {
                        d.open = false;
                        d.auto = false;
                    }
                }
                const target = d.open ? 1 : 0;
                if (d.cur === target)
                    continue;
                d.cur = approach(d.cur, target, 1 / 0.9, shot ? 1e3 : dt);
                apply(d);
            }
        },
    };
}
