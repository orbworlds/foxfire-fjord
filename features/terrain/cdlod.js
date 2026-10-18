/**
 * CDLOD for Foxfire Fjord's terrain: one shared patch grid (with skirts) drawn
 * instanced per selected quadtree node, and the selector that walks the
 * quadtree by distance and frustum, morphing each node toward its parent's
 * resolution before it switches. The margins leave room for the sharp alpine
 * relief of the Teeth above the baked min/max heights.
 */
import * as THREE from 'three';
/** Extra vertical room around the baked min/max (fine heights, skirts). */
const MARGIN_LO = 8;
const MARGIN_HI = 8;
/**
 * Grid patch shared by every node: `n × n` quads in grid units plus outward
 * facing skirts. position = (gx, skirt flag, gz); the vertex shader places,
 * morphs and displaces it. A dummy normal keeps three's smooth-shading path.
 */
export function createPatchGeometry(n, maxNodes) {
    const rowLen = n + 1;
    const mainCount = rowLen * rowLen;
    const vCount = mainCount + 4 * rowLen;
    const pos = new Float32Array(vCount * 3);
    for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
            const k = (j * rowLen + i) * 3;
            pos[k] = i;
            pos[k + 2] = j;
        }
    }
    // skirt rings: north (gz = 0), south (gz = n), west (gx = 0), east (gx = n)
    const skirtBase = [mainCount, mainCount + rowLen, mainCount + 2 * rowLen, mainCount + 3 * rowLen];
    for (let t = 0; t <= n; t++) {
        const set = (v, x, z) => {
            pos[v * 3] = x;
            pos[v * 3 + 1] = 1;
            pos[v * 3 + 2] = z;
        };
        set(skirtBase[0] + t, t, 0);
        set(skirtBase[1] + t, t, n);
        set(skirtBase[2] + t, 0, t);
        set(skirtBase[3] + t, n, t);
    }
    const nrm = new Float32Array(vCount * 3);
    for (let v = 0; v < vCount; v++)
        nrm[v * 3 + 1] = 1;
    const idx = [];
    const vid = (i, j) => j * rowLen + i;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            // constant b–c diagonal: collapsed odd vertices reproduce the coarser level's triangles
            const a = vid(i, j);
            const b = vid(i + 1, j);
            const c = vid(i, j + 1);
            const d = vid(i + 1, j + 1);
            idx.push(a, c, b, b, c, d);
        }
    }
    for (let t = 0; t < n; t++) {
        // north: outward −z
        let ta = vid(t, 0);
        let tb = vid(t + 1, 0);
        let ba = skirtBase[0] + t;
        let bb = ba + 1;
        idx.push(ta, tb, ba, tb, bb, ba);
        // south: outward +z
        ta = vid(t, n);
        tb = vid(t + 1, n);
        ba = skirtBase[1] + t;
        bb = ba + 1;
        idx.push(ta, ba, tb, tb, ba, bb);
        // west: outward −x
        ta = vid(0, t);
        tb = vid(0, t + 1);
        ba = skirtBase[2] + t;
        bb = ba + 1;
        idx.push(ta, ba, tb, tb, ba, bb);
        // east: outward +x
        ta = vid(n, t);
        tb = vid(n, t + 1);
        ba = skirtBase[3] + t;
        bb = ba + 1;
        idx.push(ta, tb, ba, tb, bb, ba);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(vCount < 65536 ? new THREE.BufferAttribute(new Uint16Array(idx), 1) : new THREE.BufferAttribute(new Uint32Array(idx), 1));
    const node = new THREE.InstancedBufferAttribute(new Float32Array(maxNodes * 4), 4);
    node.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aNode', node);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1e7, -1e7, -1e7), new THREE.Vector3(1e7, 1e7, 1e7));
    return geo;
}
/**
 * CDLOD quadtree selection. Nodes whose box reaches into range[L-1] subdivide;
 * children outside their own range are drawn as level-L "quarters" with the
 * half-resolution patch. Output: (x0, z0, size, level) per instance, near → far.
 */
export class LodSelector {
    cfg;
    bake;
    full;
    quarter;
    nFull = 0;
    nQuarter = 0;
    overflow = false;
    ranges = [];
    ranges2 = [];
    frustum = new THREE.Frustum();
    m = new THREE.Matrix4();
    box = new THREE.Box3();
    cx = 0;
    cy = 0;
    cz = 0;
    /** per-level child ordering scratch (recursion uses one level at a time) */
    scratch = [];
    constructor(cfg, bake) {
        this.cfg = cfg;
        this.bake = bake;
        this.full = new Float32Array(cfg.maxNodes * 4);
        this.quarter = new Float32Array(cfg.maxNodes * 4);
        for (let L = 0; L < cfg.levels; L++) {
            const r = cfg.range0 * 2 ** L;
            this.ranges.push(r);
            this.ranges2.push(r * r);
            this.scratch.push({ o: new Int8Array(4), d: new Float64Array(4) });
        }
    }
    get range0() {
        return this.ranges[0];
    }
    select(camera, lod) {
        this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.m);
        this.cx = lod.x;
        this.cy = lod.y;
        this.cz = lod.z;
        this.nFull = 0;
        this.nQuarter = 0;
        this.overflow = false;
        this.node(this.cfg.levels - 1, 0, 0);
    }
    dist2(x0, z0, s, lo, hi) {
        const dx = Math.max(x0 - this.cx, 0, this.cx - (x0 + s));
        const dy = Math.max(lo - this.cy, 0, this.cy - hi);
        const dz = Math.max(z0 - this.cz, 0, this.cz - (z0 + s));
        return dx * dx + dy * dy + dz * dz;
    }
    visible(x0, z0, s, lo, hi) {
        this.box.min.set(x0, lo, z0);
        this.box.max.set(x0 + s, hi, z0 + s);
        return this.frustum.intersectsBox(this.box);
    }
    emit(arr, n, x0, z0, s, L) {
        if (n >= this.cfg.maxNodes) {
            this.overflow = true;
            return false;
        }
        const k = n * 4;
        arr[k] = x0;
        arr[k + 1] = z0;
        arr[k + 2] = s;
        arr[k + 3] = L;
        return true;
    }
    node(L, i, j) {
        const cfg = this.cfg;
        const s = cfg.nodeSize0 * 2 ** L;
        const x0 = cfg.rootX + i * s;
        const z0 = cfg.rootZ + j * s;
        const nRow = (cfg.rootSize / cfg.nodeSize0) >> L;
        const lo = this.bake.minH[L][j * nRow + i] - MARGIN_LO;
        const hi = this.bake.maxH[L][j * nRow + i] + MARGIN_HI;
        const d2 = this.dist2(x0, z0, s, lo, hi);
        if (d2 > this.ranges2[L])
            return false;
        if (!this.visible(x0, z0, s, lo, hi))
            return true;
        if (L === 0 || d2 > this.ranges2[L - 1]) {
            if (this.emit(this.full, this.nFull, x0, z0, s, L))
                this.nFull++;
            return true;
        }
        // children near → far (front-to-back drawing)
        const { o, d } = this.scratch[L];
        const hs = s * 0.5;
        for (let c = 0; c < 4; c++) {
            const ccx = x0 + (c & 1) * hs + hs * 0.5 - this.cx;
            const ccz = z0 + (c >> 1) * hs + hs * 0.5 - this.cz;
            o[c] = c;
            d[c] = ccx * ccx + ccz * ccz;
        }
        for (let a = 1; a < 4; a++) {
            const oc = o[a];
            const dc = d[a];
            let b = a - 1;
            while (b >= 0 && d[b] > dc) {
                o[b + 1] = o[b];
                d[b + 1] = d[b];
                b--;
            }
            o[b + 1] = oc;
            d[b + 1] = dc;
        }
        const nRowC = (cfg.rootSize / cfg.nodeSize0) >> (L - 1);
        for (let q = 0; q < 4; q++) {
            const c = o[q];
            const ci = 2 * i + (c & 1);
            const cj = 2 * j + (c >> 1);
            if (this.node(L - 1, ci, cj))
                continue;
            const qx = x0 + (c & 1) * hs;
            const qz = z0 + (c >> 1) * hs;
            const qlo = this.bake.minH[L - 1][cj * nRowC + ci] - MARGIN_LO;
            const qhi = this.bake.maxH[L - 1][cj * nRowC + ci] + MARGIN_HI;
            if (!this.visible(qx, qz, hs, qlo, qhi))
                continue;
            if (this.emit(this.quarter, this.nQuarter, qx, qz, hs, L))
                this.nQuarter++;
        }
        return true;
    }
}
