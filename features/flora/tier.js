/**
 * Near tier: the forest instances closest to the camera drawn as real
 * geometry (one InstancedMesh per template, refilled when the camera moves).
 *
 * The refill gathers instances inside a radius and inside a widened camera
 * frustum, nearest first, until a triangle budget is spent. The same sphere
 * test (radius, frustum planes) is uploaded to the impostor shader, which
 * collapses exactly those billboards — the CPU test is 0.5 m more inclusive,
 * so the hand-off never leaves a gap. Trees behind the camera stay
 * impostors and keep casting (billboard) shadows.
 *
 * Slots are filled nearest first, so in the shadow pass each mesh draws only
 * the prefix of slots up to the last instance that touches the shadow box.
 */
import * as THREE from 'three';
const CELL = 32;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** spatial hash extent: the island's vegetation area (terrain/veg.ts) */
const GRID = { minX: -1800, maxX: 1760, minZ: -2140, maxZ: 1560 };
export class NearTier {
    forest;
    templates;
    imp;
    group = new THREE.Group();
    meshes = [];
    radius;
    triBudget;
    stats = { instances: 0, triangles: 0, radius: 0, refills: 0, shadowTriangles: 0 };
    m4 = new THREE.Matrix4();
    q4 = new THREE.Quaternion();
    qy = new THREE.Quaternion();
    e4 = new THREE.Euler();
    p4 = new THREE.Vector3();
    s4 = new THREE.Vector3();
    /** forest index of every filled slot, per template */
    slots = [];
    cy;
    rad;
    gnx;
    gnz;
    start;
    items;
    active = 0;
    caps;
    keys = new Float64Array(16384);
    cand = new Uint32Array(16384);
    counts;
    lastPos = new THREE.Vector3(1e9, 0, 0);
    lastQuat = new THREE.Quaternion();
    lastProj = new THREE.Vector3();
    dirty = true;
    proj = new THREE.Matrix4();
    pv = new THREE.Matrix4();
    frustum = new THREE.Frustum();
    camPos = new THREE.Vector3();
    constructor(forest, templates, material, depth, imp, opts) {
        this.forest = forest;
        this.templates = templates;
        this.imp = imp;
        this.radius = opts.radius;
        this.triBudget = opts.triBudget;
        this.group.name = 'flora-near';
        const n = forest.count;
        this.cy = new Float32Array(n);
        this.rad = new Float32Array(n);
        const perTemplate = new Array(templates.length).fill(0);
        for (let i = 0; i < n; i++) {
            const t = forest.template[i];
            const sc = forest.scale[i];
            this.cy[i] = forest.y[i] + templates[t].centerY * sc;
            this.rad[i] = templates[t].radius * sc;
            perTemplate[t]++;
        }
        this.counts = new Array(templates.length).fill(0);
        this.caps = perTemplate.map((c, t) => Math.min(c, opts.caps?.[t] ?? 3000));
        templates.forEach((tpl, t) => {
            const cap = Math.max(1, this.caps[t]);
            const mesh = new THREE.InstancedMesh(tpl.geometry, material, cap);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.customDepthMaterial = depth;
            mesh.matrixAutoUpdate = false;
            mesh.name = `flora-near-${t}`;
            const slots = new Uint32Array(cap);
            mesh.onBeforeShadow = (_r, _s, _c, shadowCamera) => {
                const full = this.counts[t];
                mesh.count = this.shadowCount(slots, full, shadowCamera);
                this.stats.shadowTriangles += mesh.count * tpl.triangles;
            };
            mesh.onAfterShadow = () => {
                mesh.count = this.counts[t];
            };
            this.slots.push(slots);
            this.meshes.push(mesh);
            this.group.add(mesh);
        });
        this.gnx = Math.ceil((GRID.maxX - GRID.minX) / CELL);
        this.gnz = Math.ceil((GRID.maxZ - GRID.minZ) / CELL);
        this.start = new Uint32Array(this.gnx * this.gnz + 1);
        this.items = new Uint32Array(n);
    }
    /** templates whose instances should not cast shadows (tiny plants) */
    setShadowless(t) {
        this.meshes[t].castShadow = false;
    }
    /** Use the first `count` instances (they are sorted by quality key). */
    setActive(count) {
        const f = this.forest;
        this.active = Math.min(count, f.count);
        const ncell = this.gnx * this.gnz;
        const start = this.start;
        start.fill(0);
        const cellOf = (i) => {
            const cx = Math.min(this.gnx - 1, Math.max(0, Math.floor((f.x[i] - GRID.minX) / CELL)));
            const cz = Math.min(this.gnz - 1, Math.max(0, Math.floor((f.z[i] - GRID.minZ) / CELL)));
            return cz * this.gnx + cx;
        };
        for (let i = 0; i < this.active; i++)
            start[cellOf(i) + 1]++;
        for (let c = 0; c < ncell; c++)
            start[c + 1] += start[c];
        const fill = start.slice(0, ncell);
        for (let i = 0; i < this.active; i++)
            this.items[fill[cellOf(i)]++] = i;
        this.dirty = true;
    }
    invalidate() {
        this.dirty = true;
    }
    /** Refill if the camera moved enough. Returns true when the tier changed. */
    update(camera) {
        this.stats.shadowTriangles = 0;
        camera.updateMatrixWorld();
        const pos = this.camPos.setFromMatrixPosition(camera.matrixWorld);
        const fovEff = (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) / camera.zoom) * 180) / Math.PI;
        const projChanged = this.lastProj.x !== fovEff || this.lastProj.y !== camera.aspect;
        const moved = pos.distanceToSquared(this.lastPos) > 2.5 * 2.5;
        const rotated = Math.abs(camera.quaternion.dot(this.lastQuat)) < 0.99966; // ~3°
        if (!this.dirty && !projChanged && !moved && !rotated)
            return false;
        this.dirty = false;
        this.lastPos.copy(pos);
        this.lastQuat.copy(camera.quaternion);
        this.lastProj.set(fovEff, camera.aspect, 0);
        this.refill(camera, fovEff);
        return true;
    }
    refill(camera, fovEff) {
        const f = this.forest;
        const R = this.radius;
        const pos = this.camPos;
        // widened frustum
        const fovE = THREE.MathUtils.degToRad(Math.min(165, fovEff * 1.3 + 8));
        const near = 0.1;
        const top = near * Math.tan(fovE / 2);
        const right = top * camera.aspect * 1.1;
        this.proj.makePerspective(-right, right, top, -top, near, R + 60);
        this.pv.multiplyMatrices(this.proj, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.pv);
        const planes = this.frustum.planes;
        // gather candidates
        const reach = R + 30;
        const c0 = Math.max(0, Math.floor((pos.x - reach - GRID.minX) / CELL));
        const c1 = Math.min(this.gnx - 1, Math.floor((pos.x + reach - GRID.minX) / CELL));
        const r0 = Math.max(0, Math.floor((pos.z - reach - GRID.minZ) / CELL));
        const r1 = Math.min(this.gnz - 1, Math.floor((pos.z + reach - GRID.minZ) / CELL));
        let nc = 0;
        const Rin = R + 0.5;
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const cell = r * this.gnx + c;
                for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
                    const i = this.items[k];
                    const dx = f.x[i] - pos.x;
                    const dy = this.cy[i] - pos.y;
                    const dz = f.z[i] - pos.z;
                    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (d >= Rin)
                        continue;
                    const rr = -(this.rad[i] + 0.5);
                    let inside = true;
                    for (let p = 0; p < 6; p++) {
                        const pl = planes[p];
                        if (pl.normal.x * f.x[i] + pl.normal.y * this.cy[i] + pl.normal.z * f.z[i] + pl.constant < rr) {
                            inside = false;
                            break;
                        }
                    }
                    if (!inside)
                        continue;
                    if (nc >= this.keys.length)
                        this.grow();
                    this.cand[nc] = i;
                    this.keys[nc] = Math.floor(d * 100) * 1048576 + nc;
                    nc++;
                }
            }
        }
        const keys = this.keys.subarray(0, nc);
        keys.sort();
        // fill nearest first within the triangle budget and per-template capacity
        const counts = this.counts;
        counts.fill(0);
        let tris = 0;
        let rEff = R;
        let added = 0;
        for (let k = 0; k < nc; k++) {
            const key = keys[k];
            const i = this.cand[key % 1048576];
            const t = f.template[i];
            const tt = this.templates[t].triangles;
            if (tris + tt > this.triBudget || counts[t] >= this.caps[t]) {
                rEff = Math.max(0, Math.floor(key / 1048576) / 100 - 0.5);
                break;
            }
            tris += tt;
            const mesh = this.meshes[t];
            const slot = counts[t]++;
            this.slots[t][slot] = i;
            this.composeInto(i, mesh.instanceMatrix.array, slot * 16);
            const tint = f.tint[i];
            const col = mesh.instanceColor.array;
            col[slot * 3] = tint;
            col[slot * 3 + 1] = tint;
            col[slot * 3 + 2] = tint;
            added++;
        }
        this.meshes.forEach((mesh, t) => {
            const c = counts[t];
            mesh.count = c;
            mesh.visible = c > 0;
            if (c > 0) {
                mesh.instanceMatrix.clearUpdateRanges();
                mesh.instanceMatrix.addUpdateRange(0, c * 16);
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor.clearUpdateRanges();
                mesh.instanceColor.addUpdateRange(0, c * 3);
                mesh.instanceColor.needsUpdate = true;
            }
        });
        // hand the same test to the impostor shader
        this.imp.uNearCenter.value.copy(pos);
        this.imp.uNearR.value = nc > 0 ? rEff : 0;
        for (let p = 0; p < 6; p++) {
            const pl = planes[p];
            this.imp.uNearPlanes.value[p].set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant);
        }
        this.stats.instances = added;
        this.stats.triangles = tris;
        this.stats.radius = nc > 0 ? rEff : 0;
        this.stats.refills++;
    }
    /** The instance matrix of forest instance i (tilt, then yaw, uniform scale), written at `o`. */
    composeInto(i, out, o) {
        const f = this.forest;
        this.e4.set(f.tiltX[i], 0, f.tiltZ[i]);
        this.q4.setFromEuler(this.e4);
        this.qy.setFromAxisAngle(UP_AXIS, f.yaw[i]);
        this.q4.multiply(this.qy);
        const sc = f.scale[i];
        this.m4.compose(this.p4.set(f.x[i], f.y[i], f.z[i]), this.q4, this.s4.set(sc, sc, sc));
        this.m4.toArray(out, o);
    }
    /** Slots [0, n) that can reach the orthographic shadow box (bounding-sphere test in light space). */
    shadowCount(slots, full, cam) {
        if (!cam.isOrthographicCamera)
            return full;
        const f = this.forest;
        const e = cam.matrixWorldInverse.elements;
        const z = cam.zoom || 1;
        const cx = (cam.right + cam.left) / 2;
        const cyy = (cam.top + cam.bottom) / 2;
        const hx = (cam.right - cam.left) / (2 * z);
        const hy = (cam.top - cam.bottom) / (2 * z);
        for (let k = full - 1; k >= 0; k--) {
            const i = slots[k];
            const px = f.x[i];
            const py = this.cy[i];
            const pz = f.z[i];
            const r = this.rad[i];
            const vx = e[0] * px + e[4] * py + e[8] * pz + e[12] - cx;
            const vy = e[1] * px + e[5] * py + e[9] * pz + e[13] - cyy;
            const vz = -(e[2] * px + e[6] * py + e[10] * pz + e[14]);
            if (Math.abs(vx) < hx + r && Math.abs(vy) < hy + r && vz > cam.near - r && vz < cam.far + r)
                return k + 1;
        }
        return 0;
    }
    grow() {
        const k = new Float64Array(this.keys.length * 2);
        k.set(this.keys);
        this.keys = k;
        const c = new Uint32Array(this.cand.length * 2);
        c.set(this.cand);
        this.cand = c;
    }
    dispose() {
        for (const m of this.meshes)
            m.dispose();
    }
}
