/**
 * Thousands of small path elements (stones, logs, rope spans) drawn as one
 * InstancedMesh per detail level. Instances are packed into spatial chunks and,
 * whenever the camera has moved a few metres, the ones within reach are copied
 * into the meshes: near ones into the detailed geometry, the rest into the
 * coarse one. Nothing is drawn past an instance's own reach.
 */
import * as THREE from 'three';
/** Collects instances before they are packed. */
export class InstanceBatch {
    attrs;
    mats = [];
    cols = [];
    extra = [];
    reach = [];
    stride;
    constructor(attrs = []) {
        this.attrs = attrs;
        this.stride = attrs.reduce((a, b) => a + b.size, 0);
    }
    get count() {
        return this.reach.length;
    }
    add(m, r, g, b, extra, reach) {
        for (let i = 0; i < 16; i++)
            this.mats.push(m.elements[i]);
        this.cols.push(r, g, b);
        for (let i = 0; i < this.stride; i++)
            this.extra.push(extra[i] ?? 0);
        this.reach.push(reach);
    }
}
export class InstanceField {
    levels;
    material;
    opts;
    group = new THREE.Group();
    meshes = [];
    chunks = [];
    M = new Float32Array(0);
    C = new Float32Array(0);
    E = new Float32Array(0);
    R = new Float32Array(0);
    stride = 0;
    attrs = [];
    last = new THREE.Vector3(Infinity, Infinity, Infinity);
    counts = [];
    constructor(name, levels, material, opts = {}) {
        this.levels = levels;
        this.material = material;
        this.opts = opts;
        this.group.name = name;
    }
    /** Replace all instances (first build, or a re-fit after a quality change). */
    setBatch(batch) {
        const n = batch.count;
        this.stride = batch.stride;
        this.attrs = batch.attrs;
        const cell = this.opts.cell ?? 32;
        const order = [];
        const keys = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const x = batch.mats[i * 16 + 12];
            const z = batch.mats[i * 16 + 14];
            keys[i] = (Math.floor(z / cell) + 4096) * 8192 + (Math.floor(x / cell) + 4096);
            order.push(i);
        }
        order.sort((a, b) => keys[a] - keys[b]);
        this.M = new Float32Array(n * 16);
        this.C = new Float32Array(n * 3);
        this.E = new Float32Array(n * this.stride);
        this.R = new Float32Array(n);
        this.chunks = [];
        let chunk = null;
        for (let k = 0; k < n; k++) {
            const i = order[k];
            for (let j = 0; j < 16; j++)
                this.M[k * 16 + j] = batch.mats[i * 16 + j];
            for (let j = 0; j < 3; j++)
                this.C[k * 3 + j] = batch.cols[i * 3 + j];
            for (let j = 0; j < this.stride; j++)
                this.E[k * this.stride + j] = batch.extra[i * this.stride + j];
            this.R[k] = batch.reach[i];
            if (!chunk || keys[i] !== keys[order[chunk.start]]) {
                chunk = { x: 0, y: 0, z: 0, r: 0, reach: 0, start: k, end: k };
                this.chunks.push(chunk);
            }
            chunk.end = k + 1;
        }
        for (const c of this.chunks) {
            let x = 0;
            let y = 0;
            let z = 0;
            for (let k = c.start; k < c.end; k++) {
                x += this.M[k * 16 + 12];
                y += this.M[k * 16 + 13];
                z += this.M[k * 16 + 14];
                c.reach = Math.max(c.reach, this.R[k]);
            }
            const m = c.end - c.start;
            c.x = x / m;
            c.y = y / m;
            c.z = z / m;
            for (let k = c.start; k < c.end; k++) {
                c.r = Math.max(c.r, Math.hypot(this.M[k * 16 + 12] - c.x, this.M[k * 16 + 13] - c.y, this.M[k * 16 + 14] - c.z) + 2);
            }
        }
        this.allocate(n);
        this.last.set(Infinity, Infinity, Infinity);
    }
    allocate(n) {
        const cap = Math.max(1, n);
        if (this.meshes.length && this.meshes[0].instanceMatrix.count >= cap)
            return;
        for (const m of this.meshes) {
            this.group.remove(m);
            m.geometry.dispose();
            m.dispose();
        }
        this.meshes = this.levels.map((lv, li) => {
            const geo = lv.geometry.clone();
            for (const a of this.attrs) {
                const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * a.size), a.size);
                attr.setUsage(THREE.DynamicDrawUsage);
                geo.setAttribute(a.name, attr);
            }
            const mesh = new THREE.InstancedMesh(geo, this.material, cap);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.castShadow = this.opts.castShadow ?? false;
            mesh.receiveShadow = this.opts.receiveShadow ?? true;
            mesh.name = `${this.group.name}:${li}`;
            this.group.add(mesh);
            return mesh;
        });
        this.counts = this.meshes.map(() => 0);
    }
    /** Refill the meshes if the camera moved more than `move` metres (or when forced). */
    update(cam, force = false) {
        if (!force && cam.distanceToSquared(this.last) < (this.opts.move ?? 3) ** 2)
            return;
        this.last.copy(cam);
        const L = this.meshes.length;
        for (let l = 0; l < L; l++)
            this.counts[l] = 0;
        const st = this.stride;
        for (const c of this.chunks) {
            const dc = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
            if (dc - c.r > c.reach)
                continue;
            for (let k = c.start; k < c.end; k++) {
                const d = Math.hypot(this.M[k * 16 + 12] - cam.x, this.M[k * 16 + 13] - cam.y, this.M[k * 16 + 14] - cam.z);
                if (d > this.R[k])
                    continue;
                let l = 0;
                while (l < L - 1 && d >= this.levels[l].maxDistance)
                    l++;
                const mesh = this.meshes[l];
                const o = this.counts[l]++;
                mesh.instanceMatrix.array.set(this.M.subarray(k * 16, k * 16 + 16), o * 16);
                mesh.instanceColor.array.set(this.C.subarray(k * 3, k * 3 + 3), o * 3);
                let off = 0;
                for (const a of this.attrs) {
                    const arr = mesh.geometry.getAttribute(a.name).array;
                    for (let j = 0; j < a.size; j++)
                        arr[o * a.size + j] = this.E[k * st + off + j];
                    off += a.size;
                }
            }
        }
        for (let l = 0; l < L; l++) {
            const mesh = this.meshes[l];
            const n = this.counts[l];
            mesh.count = n;
            mesh.visible = n > 0;
            if (n === 0)
                continue;
            const flag = (attr, size) => {
                attr.clearUpdateRanges();
                attr.addUpdateRange(0, n * size);
                attr.needsUpdate = true;
            };
            flag(mesh.instanceMatrix, 16);
            flag(mesh.instanceColor, 3);
            for (const a of this.attrs)
                flag(mesh.geometry.getAttribute(a.name), a.size);
        }
    }
    /** Instances currently drawn, per level. */
    get drawn() {
        return [...this.counts];
    }
}
