/**
 * The fine window: a toroidal texture of exact `heightAt` heights (plus
 * normals and path masks) streamed around the camera tile by tile, so the
 * snow, the trail trenches and their snowbanks are crisp underfoot while the
 * coarse grid covers the rest of the island. Tiles come from module workers
 * (started through spawn-worker.ts, so they run in opaque-origin frames too)
 * with a main-thread fallback.
 */
import * as THREE from 'three';
import { computeFineTile } from './fine-tile.js';
import { reportWorkerLoadFailure, spawnModuleWorker, workersViaBootstrap } from '../../world/spawn-worker.js';
const KEY_BIAS = 32768;
const tileKey = (tx, tz) => (tx + KEY_BIAS) * 65536 + (tz + KEY_BIAS);
const imod = (a, n) => ((a % n) + n) % n;
/**
 * Exact-height window around the camera, stored toroidally in GPU textures and
 * streamed in B × B texel tiles computed by web workers (nearest tiles first).
 * A tiny tile table tells the shader which world tile each slot currently holds,
 * so partially streamed windows fall back to the coarse grid per tile.
 */
export class FineWindow {
    renderer;
    N;
    B;
    T;
    s;
    /** texel offset (multiple of N) that keeps shader texel indices positive */
    off;
    heightTex;
    normalTex;
    tileTex;
    tileData;
    slotTX;
    slotTZ;
    slotOK;
    workers = [];
    idle = [];
    sync = false;
    inflight = new Map();
    /** tiles still to stream, nearest first: entries [qi, qn) */
    qTX;
    qTZ;
    qD;
    qi = 0;
    qn = 0;
    results = [];
    camTX = Number.NaN;
    camTZ = Number.NaN;
    nextId = 1;
    stageH;
    stageN;
    dst = new THREE.Vector2();
    tilesDirty = false;
    frame = 0;
    wanted = false;
    disposed = false;
    priming = false;
    lastCam = new THREE.Vector3();
    /** slots whose validity weight is still ramping up (smooth fade-in instead of popping) */
    fading = [];
    constructor(renderer, cfg) {
        this.renderer = renderer;
        this.N = cfg.fineN;
        this.B = cfg.fineTile;
        this.T = this.N / this.B;
        this.s = cfg.fineSpacing;
        this.off = this.N * 64;
        const N = this.N;
        const T = this.T;
        this.heightTex = new THREE.DataTexture(new Float32Array(N * N), N, N, THREE.RedFormat, THREE.FloatType);
        this.heightTex.magFilter = this.heightTex.minFilter = THREE.NearestFilter;
        this.heightTex.generateMipmaps = false;
        this.heightTex.needsUpdate = true;
        const nrm = new Uint8Array(N * N * 4);
        for (let i = 0; i < N * N; i++) {
            nrm[i * 4] = 128;
            nrm[i * 4 + 1] = 128;
        }
        this.normalTex = new THREE.DataTexture(nrm, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
        this.normalTex.magFilter = this.normalTex.minFilter = THREE.LinearFilter;
        this.normalTex.wrapS = this.normalTex.wrapT = THREE.RepeatWrapping;
        this.normalTex.generateMipmaps = false;
        this.normalTex.needsUpdate = true;
        this.tileData = new Float32Array(T * T * 4);
        this.tileTex = new THREE.DataTexture(this.tileData, T, T, THREE.RGBAFormat, THREE.FloatType);
        this.tileTex.magFilter = this.tileTex.minFilter = THREE.NearestFilter;
        this.tileTex.generateMipmaps = false;
        this.tileTex.needsUpdate = true;
        this.slotTX = new Int32Array(T * T);
        this.slotTZ = new Int32Array(T * T);
        this.slotOK = new Uint8Array(T * T);
        this.qTX = new Int32Array(T * T);
        this.qTZ = new Int32Array(T * T);
        this.qD = new Float64Array(T * T);
        // staging textures are never rendered, so copyTextureToTexture uploads straight from their arrays
        this.stageH = new THREE.DataTexture(new Float32Array(this.B * this.B), this.B, this.B, THREE.RedFormat, THREE.FloatType);
        this.stageN = new THREE.DataTexture(new Uint8Array(this.B * this.B * 4), this.B, this.B, THREE.RGBAFormat, THREE.UnsignedByteType);
        renderer.initTexture(this.heightTex);
        renderer.initTexture(this.normalTex);
        this.startWorkers();
    }
    startWorkers() {
        const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
        const count = Math.max(1, Math.min(4, hc - 2));
        const viaBootstrap = workersViaBootstrap();
        let answered = false;
        try {
            for (let i = 0; i < count; i++) {
                const w = spawnModuleWorker(new URL('./fine-worker.js', import.meta.url));
                w.onmessage = (e) => {
                    answered = true;
                    if (this.disposed)
                        return;
                    this.results.push(e.data);
                    this.idle.push(w);
                    this.dispatch();
                };
                w.onerror = (err) => {
                    if (this.disposed || this.sync)
                        return;
                    // a direct worker that never loaded (opaque origin): retry once through the data: bootstrap
                    if (!answered && !viaBootstrap && this.workers.includes(w) && reportWorkerLoadFailure()) {
                        for (const o of this.workers)
                            o.terminate();
                        this.workers = [];
                        this.idle = [];
                        this.inflight.clear();
                        this.camTX = Number.NaN;
                        this.startWorkers();
                        return;
                    }
                    console.warn('[terrain] fine-window worker failed, computing tiles on the main thread', err);
                    this.fallbackToSync();
                };
                this.workers.push(w);
                this.idle.push(w);
            }
        }
        catch (err) {
            console.warn('[terrain] workers unavailable, computing tiles on the main thread', err);
            this.fallbackToSync();
        }
    }
    fallbackToSync() {
        if (this.sync)
            return;
        this.sync = true;
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.idle = [];
        this.inflight.clear();
        this.camTX = Number.NaN;
    }
    inWindow(tx, tz) {
        const h = this.T / 2;
        return tx > this.camTX - h && tx <= this.camTX + h && tz > this.camTZ - h && tz <= this.camTZ + h;
    }
    resident(tx, tz) {
        const s = imod(tz, this.T) * this.T + imod(tx, this.T);
        return this.slotOK[s] === 1 && this.slotTX[s] === tx && this.slotTZ[s] === tz;
    }
    rebuildQueue(cam) {
        const h = this.T / 2;
        const tileM = this.B * this.s;
        const { qTX, qTZ, qD } = this;
        let n = 0;
        for (let tz = this.camTZ - h + 1; tz <= this.camTZ + h; tz++) {
            for (let tx = this.camTX - h + 1; tx <= this.camTX + h; tx++) {
                if (this.resident(tx, tz) || this.inflight.has(tileKey(tx, tz)))
                    continue;
                const cx = (tx + 0.5) * tileM - cam.x;
                const cz = (tz + 0.5) * tileM - cam.z;
                const d = cx * cx + cz * cz;
                // insertion sort in place: this runs every few frames while streaming
                let j = n++;
                for (; j > 0 && qD[j - 1] > d; j--) {
                    qTX[j] = qTX[j - 1];
                    qTZ[j] = qTZ[j - 1];
                    qD[j] = qD[j - 1];
                }
                qTX[j] = tx;
                qTZ[j] = tz;
                qD[j] = d;
            }
        }
        this.qi = 0;
        this.qn = n;
    }
    dispatch() {
        if (!this.wanted || this.sync)
            return;
        while (this.idle.length && this.qi < this.qn) {
            const tx = this.qTX[this.qi];
            const tz = this.qTZ[this.qi++];
            const k = tileKey(tx, tz);
            if (!this.inWindow(tx, tz) || this.resident(tx, tz) || this.inflight.has(k))
                continue;
            const job = { id: this.nextId++, tx, tz, B: this.B, s: this.s };
            this.inflight.set(k, job);
            this.idle.pop().postMessage(job);
        }
    }
    apply(r) {
        this.inflight.delete(tileKey(r.tx, r.tz));
        if (!this.inWindow(r.tx, r.tz))
            return;
        const T = this.T;
        const sx = imod(r.tx, T);
        const sz = imod(r.tz, T);
        const slot = sz * T + sx;
        this.stageH.image.data.set(r.h);
        this.stageN.image.data.set(r.n);
        this.dst.set(sx * this.B, sz * this.B);
        this.renderer.copyTextureToTexture(this.stageH, this.heightTex, null, this.dst);
        this.renderer.copyTextureToTexture(this.stageN, this.normalTex, null, this.dst);
        this.slotTX[slot] = r.tx;
        this.slotTZ[slot] = r.tz;
        this.slotOK[slot] = 1;
        const tb = this.off / this.B;
        this.tileData[slot * 4] = r.tx + tb;
        this.tileData[slot * 4 + 1] = r.tz + tb;
        if (this.priming)
            this.tileData[slot * 4 + 2] = 1;
        else {
            this.tileData[slot * 4 + 2] = 0.001;
            if (!this.fading.includes(slot))
                this.fading.push(slot);
        }
        this.tilesDirty = true;
    }
    /**
     * Per frame: apply finished tiles, re-target the window when the camera moves
     * to another tile, and keep workers busy. `want` = the camera is close enough
     * to the ground for the fine window to matter.
     */
    update(cam, want, dt, budgetMs = 1.5) {
        if (this.disposed)
            return;
        this.frame++;
        // at least two tiles per frame, more while the upload budget lasts
        const t0 = performance.now();
        let applied = 0;
        while (this.results.length && budgetMs > 0 && (applied < 2 || performance.now() - t0 < budgetMs)) {
            this.apply(this.results.shift());
            applied++;
        }
        for (let i = this.fading.length - 1; i >= 0; i--) {
            const k = this.fading[i] * 4 + 2;
            const v = Math.min(1, this.tileData[k] + dt * 2.5);
            this.tileData[k] = v;
            if (v >= 1)
                this.fading.splice(i, 1);
            this.tilesDirty = true;
        }
        this.wanted = want;
        if (want) {
            const tileM = this.B * this.s;
            const tx = Math.floor(cam.x / tileM);
            const tz = Math.floor(cam.z / tileM);
            const moved = cam.distanceToSquared(this.lastCam) > tileM * tileM * 0.04;
            if (tx !== this.camTX || tz !== this.camTZ || moved || this.frame % 30 === 0) {
                this.camTX = tx;
                this.camTZ = tz;
                this.lastCam.copy(cam);
                this.rebuildQueue(cam);
            }
            if (this.sync) {
                if (this.qi < this.qn) {
                    const tx = this.qTX[this.qi];
                    const tz = this.qTZ[this.qi++];
                    if (this.inWindow(tx, tz) && !this.resident(tx, tz))
                        this.apply(computeFineTile({ id: 0, tx, tz, B: this.B, s: this.s }));
                }
            }
            else
                this.dispatch();
        }
        if (this.tilesDirty) {
            this.tileTex.needsUpdate = true;
            this.tilesDirty = false;
        }
    }
    /** Stream the tiles within `radius` of the camera before the first frame. */
    async prime(cam, radius, timeoutMs = 5000) {
        this.update(cam, true, 0, 0);
        this.priming = true;
        const tileM = this.B * this.s;
        const need = [];
        const h = this.T / 2;
        for (let tz = this.camTZ - h + 1; tz <= this.camTZ + h; tz++) {
            for (let tx = this.camTX - h + 1; tx <= this.camTX + h; tx++) {
                const dx = Math.max(Math.abs((tx + 0.5) * tileM - cam.x) - tileM / 2, 0);
                const dz = Math.max(Math.abs((tz + 0.5) * tileM - cam.z) - tileM / 2, 0);
                if (dx * dx + dz * dz <= radius * radius)
                    need.push([tx, tz]);
            }
        }
        const t0 = performance.now();
        for (;;) {
            while (this.results.length)
                this.apply(this.results.shift());
            if (need.every(([tx, tz]) => this.resident(tx, tz)))
                break;
            if (performance.now() - t0 > timeoutMs) {
                console.warn('[terrain] fine window prime timed out');
                break;
            }
            if (this.sync) {
                const missing = need.find(([tx, tz]) => !this.resident(tx, tz));
                this.apply(computeFineTile({ id: 0, tx: missing[0], tz: missing[1], B: this.B, s: this.s }));
                continue;
            }
            await new Promise((r) => setTimeout(r, 4));
            this.dispatch();
        }
        this.priming = false;
        this.tileTex.needsUpdate = true;
        this.tilesDirty = false;
    }
    stats() {
        let resident = 0;
        for (let i = 0; i < this.slotOK.length; i++)
            if (this.slotOK[i] && this.inWindow(this.slotTX[i], this.slotTZ[i]))
                resident++;
        return { resident, inflight: this.inflight.size, queued: this.qn - this.qi, sync: this.sync };
    }
    dispose() {
        this.disposed = true;
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.heightTex.dispose();
        this.normalTex.dispose();
        this.tileTex.dispose();
    }
}
