/**
 * Geometry helpers shared by all of Foxfire Fjord's features.
 *
 *  - applyBoxUV:      metre-based UVs (box projection) so library textures tile at real scale
 *  - mergeByMaterial: collapse a static subtree into one mesh per material (draw-call budget!)
 *  - roundedBox, lathe helpers, disposal
 *  - snowCap:         rounded, sagging snow slabs with overhangs on the up-facing faces of a mesh
 *  - icicles:         icicles hanging from an eave line
 *  - setPaneCoords / glassPane: pane coordinates for the frosted Fresnel glass
 */
import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
/**
 * Replace UVs with box-projected coordinates in meters (1 UV unit = 1 m).
 * `grain` chooses which local axis maps to U (wood grain direction) on faces
 * where that axis lies in the face plane.
 */
export function applyBoxUV(geometry, opts = {}) {
    const pos = geometry.getAttribute('position');
    if (!geometry.getAttribute('normal'))
        geometry.computeVertexNormals();
    const nor = geometry.getAttribute('normal');
    const scale = opts.scale ?? 1;
    const [ou, ov] = opts.offset ?? [0, 0];
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const ax = Math.abs(nor.getX(i));
        const ay = Math.abs(nor.getY(i));
        const az = Math.abs(nor.getZ(i));
        let u;
        let v;
        if (ax >= ay && ax >= az) {
            // plane (z, y)
            if (opts.grain === 'y') {
                u = y;
                v = z;
            }
            else {
                u = z;
                v = y;
            }
        }
        else if (ay >= ax && ay >= az) {
            // plane (x, z)
            if (opts.grain === 'z') {
                u = z;
                v = x;
            }
            else {
                u = x;
                v = z;
            }
        }
        else {
            // plane (x, y)
            if (opts.grain === 'y') {
                u = y;
                v = x;
            }
            else {
                u = x;
                v = y;
            }
        }
        uv[i * 2] = u * scale + ou;
        uv[i * 2 + 1] = v * scale + ov;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geometry;
}
/** Box with meter UVs. Grain defaults to the longest dimension. */
export function box(w, h, d, grain) {
    const g = new THREE.BoxGeometry(w, h, d);
    const longest = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
    return applyBoxUV(g, { grain: grain ?? longest });
}
/** Rounded box with meter UVs. */
export function roundedBox(w, h, d, radius, segments = 3, grain) {
    const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) / 2 - 1e-4));
    const longest = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
    return applyBoxUV(g, { grain: grain ?? longest });
}
/** Lathe from [radius, height] pairs around Y, with UVs: u = angle × radius (m), v = height (m). */
export function lathe(profile, segments = 32) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
    const g = new THREE.LatheGeometry(pts, segments);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const maxR = Math.max(...profile.map((p) => p[0]), 0.01);
    for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR, pos.getY(i));
    }
    return g;
}
function prepareForMerge(geos) {
    const anyIndexed = geos.some((g) => g.index);
    const anyNonIndexed = geos.some((g) => !g.index);
    let out = geos;
    if (anyIndexed && anyNonIndexed)
        out = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const names = out.map((g) => new Set(Object.keys(g.attributes)));
    const common = [...names[0]].filter((n) => names.every((s) => s.has(n)));
    for (const g of out) {
        for (const n of Object.keys(g.attributes))
            if (!common.includes(n))
                g.deleteAttribute(n);
        const morph = g.morphAttributes;
        for (const n of Object.keys(morph))
            delete morph[n];
    }
    return out;
}
/**
 * Collapse all static meshes under `root` into one mesh per material.
 * Transforms are baked relative to `root`. Returns a new Group (root is left
 * untouched). Skips InstancedMesh, SkinnedMesh, Points, Lines and any object
 * with `userData.noMerge = true` (those are re-parented as-is).
 */
export function mergeByMaterial(root, opts = {}) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map();
    const keep = [];
    root.traverse((o) => {
        if (o === root)
            return;
        const mesh = o;
        if (o.userData.noMerge) {
            keep.push(o);
            return;
        }
        if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh)
            return;
        if (Array.isArray(mesh.material)) {
            keep.push(o);
            return;
        }
        const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
        const g = mesh.geometry.clone().applyMatrix4(m);
        let b = buckets.get(mesh.material);
        if (!b)
            buckets.set(mesh.material, (b = { geos: [], cast: false, receive: false }));
        b.geos.push(g);
        b.cast ||= mesh.castShadow;
        b.receive ||= mesh.receiveShadow;
    });
    const out = new THREE.Group();
    out.name = `${root.name || 'group'}-merged`;
    for (const [mat, b] of buckets) {
        const merged = mergeGeometries(prepareForMerge(b.geos), false);
        if (!merged)
            continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = opts.castShadow ?? b.cast;
        mesh.receiveShadow = opts.receiveShadow ?? b.receive;
        mesh.name = `${out.name}:${mat.name || 'mat'}`;
        out.add(mesh);
        b.geos.forEach((g) => g.dispose());
    }
    for (const k of keep) {
        const m = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
        k.removeFromParent();
        m.decompose(k.position, k.quaternion, k.scale);
        out.add(k);
    }
    return out;
}
/** Invisible-but-raycastable proxy box, for interaction hit areas. */
export function hitBox(w, h, d) {
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.name = 'hitbox';
    m.userData.noMerge = true;
    return m;
}
/** Heading (rad about +Y) of the long axis of a geometry's xz footprint (0 when it has none). */
function principalHeadingXZ(geometry) {
    const pos = geometry.getAttribute('position');
    const n = pos.count;
    if (n < 3)
        return 0;
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
        mx += pos.getX(i);
        mz += pos.getZ(i);
    }
    mx /= n;
    mz /= n;
    let cxx = 0;
    let czz = 0;
    let cxz = 0;
    for (let i = 0; i < n; i++) {
        const x = pos.getX(i) - mx;
        const z = pos.getZ(i) - mz;
        cxx += x * x;
        czz += z * z;
        cxz += x * z;
    }
    // no clear long axis (round or square footprints): keep the grid as it is
    const tr = cxx + czz;
    const det = cxx * czz - cxz * cxz;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    if (l1 < 1e-9 || l1 < l2 * 2.5)
        return 0;
    return 0.5 * Math.atan2(2 * cxz, cxx - czz);
}
/** 2-pass chamfer distance (in cells) from cells where seed[i] is true. */
function chamferCells(seed, w, h, nearest) {
    const d = new Float32Array(w * h);
    const INF = 1e9;
    for (let i = 0; i < d.length; i++) {
        d[i] = seed[i] ? 0 : INF;
        if (nearest)
            nearest[i] = seed[i] ? i : -1;
    }
    const a = 1;
    const b = Math.SQRT2;
    const relax = (k, n, c) => {
        if (d[n] + c < d[k]) {
            d[k] = d[n] + c;
            if (nearest)
                nearest[k] = nearest[n];
        }
    };
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const k = j * w + i;
            if (i > 0)
                relax(k, k - 1, a);
            if (j > 0) {
                relax(k, k - w, a);
                if (i > 0)
                    relax(k, k - w - 1, b);
                if (i < w - 1)
                    relax(k, k - w + 1, b);
            }
        }
    }
    for (let j = h - 1; j >= 0; j--) {
        for (let i = w - 1; i >= 0; i--) {
            const k = j * w + i;
            if (i < w - 1)
                relax(k, k + 1, a);
            if (j < h - 1) {
                relax(k, k + w, a);
                if (i < w - 1)
                    relax(k, k + w + 1, b);
                if (i > 0)
                    relax(k, k + w - 1, b);
            }
        }
    }
    return d;
}
/** cheap 2D value noise for lumps (not tileable, deterministic) */
function lumpNoise(seed) {
    const r = mulberry32(seed);
    const P = 64;
    const g = new Float32Array(P * P);
    for (let i = 0; i < g.length; i++)
        g[i] = r();
    const at = (i, j) => g[(((j % P) + P) % P) * P + (((i % P) + P) % P)];
    const n = (x, z) => {
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        let fx = x - xi;
        let fz = z - zi;
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        const a = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * fx;
        const b = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * fx;
        return a + (b - a) * fz;
    };
    return (x, z) => n(x, z) * 0.6 + n(x * 2.3 + 17, z * 2.3 + 5) * 0.4;
}
/**
 * Grows snow on the up-facing faces of `geometry` (in its own space, +Y up):
 * a soft heightfield slab that is thickest on flat tops, thins on slopes,
 * rounds over at the edges and curls out over them in a drooping lip, with
 * wind lumps. Anything with a face above it stays bare (shelves under a roof).
 * Works for roofs, rails, ledges, logs, posts, benches and boulders. Returns
 * null when nothing holds snow. Use with `materials.get('snowPack')`.
 *
 * Cost: one rasterisation of the up-facing triangles into a grid of
 * (bbox / cell)² cells; keep `cell` coarse for large roofs (8–12 cm) and fine
 * for rails (1.5–3 cm).
 */
export function snowCap(geometry, opts = {}) {
    if (opts.align !== undefined) {
        const heading = opts.align === 'auto' ? principalHeadingXZ(geometry) : opts.align;
        if (Math.abs(heading) < 1e-4)
            return snowCap(geometry, { ...opts, align: undefined });
        // grow it in a frame where the long axis runs along +X, then turn it back
        const turned = geometry.clone();
        turned.rotateY(heading);
        const out = snowCap(turned, { ...opts, align: undefined });
        turned.dispose();
        if (out) {
            out.rotateY(-heading);
            out.computeBoundingSphere();
        }
        return out;
    }
    const T = opts.thickness ?? 0.2;
    let cell = opts.cell ?? Math.max(0.015, T / 3);
    const ov = opts.overhang ?? T * 0.7;
    const sagK = opts.sag ?? 0.6;
    const minUp = opts.minUp ?? 0.42;
    const lumps = opts.lumps ?? 0.35;
    const maxCells = opts.maxCells ?? 400000;
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute('position');
    const triCount = Math.floor(pos.count / 3);
    if (!triCount)
        return null;
    // bounds of everything (anything above an up-facing face blocks it)
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (z < minZ)
            minZ = z;
        if (z > maxZ)
            maxZ = z;
    }
    const pad = ov + cell * 3;
    minX -= pad;
    minZ -= pad;
    maxX += pad;
    maxZ += pad;
    while (((maxX - minX) / cell) * ((maxZ - minZ) / cell) > maxCells)
        cell *= 1.25;
    const W = Math.ceil((maxX - minX) / cell) + 1;
    const H = Math.ceil((maxZ - minZ) / cell) + 1;
    const N = W * H;
    const topUp = new Float32Array(N).fill(-Infinity);
    const topAll = new Float32Array(N).fill(-Infinity);
    const upN = new Float32Array(N);
    // rasterise every triangle's xz projection at cell centres, keeping the highest surface
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
        a.fromBufferAttribute(pos, t * 3);
        b.fromBufferAttribute(pos, t * 3 + 1);
        c.fromBufferAttribute(pos, t * 3 + 2);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const len = n.length();
        if (len < 1e-12)
            continue;
        n.multiplyScalar(1 / len);
        const ny = n.y;
        // denominator of the xz barycentrics
        const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(den) < 1e-12)
            continue;
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / cell));
        const i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - minZ) / cell));
        const j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z, c.z) - minZ) / cell));
        const holds = ny > minUp;
        for (let j = j0; j <= j1; j++) {
            const z = minZ + j * cell;
            for (let i = i0; i <= i1; i++) {
                const x = minX + i * cell;
                const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
                const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
                const l3 = 1 - l1 - l2;
                if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4)
                    continue;
                const y = l1 * a.y + l2 * b.y + l3 * c.y;
                const k = j * W + i;
                if (y > topAll[k])
                    topAll[k] = y;
                if (holds && y > topUp[k]) {
                    topUp[k] = y;
                    upN[k] = ny;
                }
            }
        }
    }
    if (g !== geometry)
        g.dispose();
    // supported cells: the highest surface there is an up-facing one
    const sup = new Uint8Array(N);
    let any = false;
    for (let k = 0; k < N; k++) {
        if (topUp[k] > -Infinity && topUp[k] >= topAll[k] - 0.01) {
            sup[k] = 1;
            any = true;
        }
    }
    if (!any)
        return null;
    const notSup = new Uint8Array(N);
    for (let k = 0; k < N; k++)
        notSup[k] = sup[k] ? 0 : 1;
    const din = chamferCells(notSup, W, H); // inside: distance to the edge (cells)
    const nearest = new Int32Array(N);
    const dout = chamferCells(sup, W, H, nearest); // outside: distance to the support (cells)
    // slope of the support surface (for the overhang to continue it downhill)
    const gx = new Float32Array(N);
    const gz = new Float32Array(N);
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const k = j * W + i;
            if (!sup[k])
                continue;
            const l = i > 0 && sup[k - 1] ? topUp[k - 1] : topUp[k];
            const r = i < W - 1 && sup[k + 1] ? topUp[k + 1] : topUp[k];
            const d = j > 0 && sup[k - W] ? topUp[k - W] : topUp[k];
            const u = j < H - 1 && sup[k + W] ? topUp[k + W] : topUp[k];
            const sx = (i > 0 && sup[k - 1] ? 1 : 0) + (i < W - 1 && sup[k + 1] ? 1 : 0);
            const sz = (j > 0 && sup[k - W] ? 1 : 0) + (j < H - 1 && sup[k + W] ? 1 : 0);
            gx[k] = sx ? (r - l) / (sx * cell) : 0;
            gz[k] = sz ? (u - d) / (sz * cell) : 0;
        }
    }
    // the lip continues the slope it curls off, but faceted round supports (logs, rails, boulders)
    // give every edge cell a different facet's slope: smooth it, and keep it from plunging down the
    // side of a curved support (it would hang in a fringe of curtains instead of curling over)
    const sgx = new Float32Array(N);
    const sgz = new Float32Array(N);
    const GMAX = 1.2;
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const k = j * W + i;
            if (!sup[k])
                continue;
            let ax = 0;
            let az = 0;
            let cnt = 0;
            for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                    const ii = i + di;
                    const jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= W || jj >= H)
                        continue;
                    const m = jj * W + ii;
                    if (!sup[m])
                        continue;
                    ax += gx[m];
                    az += gz[m];
                    cnt++;
                }
            }
            ax /= cnt;
            az /= cnt;
            const gl = Math.hypot(ax, az);
            const kk = gl > GMAX ? GMAX / gl : 1;
            sgx[k] = ax * kk;
            sgz[k] = az * kk;
        }
    }
    gx.set(sgx);
    gz.set(sgz);
    const lump = lumpNoise(opts.seed ?? 7);
    const R = Math.max(T * 1.2, cell * 2); // rounding radius at the edges
    const ovC = ov / cell;
    const edgeFrac = 0.45;
    // per vertex: base (support or extrapolated) and thickness; region = has snow
    const base = new Float32Array(N);
    const thick = new Float32Array(N);
    const region = new Uint8Array(N);
    const hang = new Uint8Array(N);
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const k = j * W + i;
            const x = minX + i * cell;
            const z = minZ + j * cell;
            const ln = 1 + lumps * (lump(x / (T * 4 + 0.15), z / (T * 4 + 0.15)) - 0.5) * 1.2;
            if (sup[k]) {
                const slope = THREE.MathUtils.clamp((upN[k] - minUp) / (0.92 - minUp), 0, 1);
                const sf = Math.sqrt(slope);
                const round = edgeFrac + (1 - edgeFrac) * Math.sqrt(Math.min(1, (din[k] * cell) / R));
                base[k] = topUp[k];
                thick[k] = (T * sf * round * ln) / Math.max(upN[k], 0.35);
                region[k] = thick[k] > 1e-4 ? 1 : 0;
            }
            else if (dout[k] <= ovC + 1e-3 && nearest[k] >= 0) {
                const m = nearest[k];
                const s = dout[k] / Math.max(ovC, 1e-3); // 0 at the edge … 1 at the tip
                const mi = m % W;
                const mj = Math.floor(m / W);
                const dx = (i - mi) * cell;
                const dz = (j - mj) * cell;
                const slope = THREE.MathUtils.clamp((upN[m] - minUp) / (0.92 - minUp), 0, 1);
                const tEdge = (T * Math.sqrt(slope) * edgeFrac * ln) / Math.max(upN[m], 0.35);
                base[k] = topUp[m] + gx[m] * dx + gz[m] * dz - T * sagK * s * s;
                thick[k] = tEdge * Math.sqrt(Math.max(0, 1 - s * s));
                if (thick[k] > 1e-4) {
                    region[k] = 1;
                    hang[k] = 1;
                }
            }
        }
    }
    // vertices: top surface over region cells and a one-cell rim (thickness 0); bottom under the overhang
    const vTop = new Int32Array(N).fill(-1);
    const vBot = new Int32Array(N).fill(-1);
    const P = [];
    const idx = [];
    const near = (k) => {
        const i = k % W;
        const j = (k - i) / W;
        for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii >= 0 && jj >= 0 && ii < W && jj < H && region[jj * W + ii])
                    return jj * W + ii;
            }
        return -1;
    };
    // rim cells take the lowest base of their snowy neighbours so the slab closes onto the support
    // (the lowest: a lip cell and a slab cell side by side would otherwise close at different
    // heights and the edge would show a row of teeth)
    const rimBase = new Float32Array(N);
    const isRim = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
        if (region[k] || near(k) < 0)
            continue;
        const i = k % W;
        const j = (k - i) / W;
        let lo = Infinity;
        let hi = -Infinity;
        for (let pass = 0; pass < 2; pass++)
            for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                    const ii = i + di;
                    const jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= W || jj >= H)
                        continue;
                    const m = jj * W + ii;
                    if (!region[m])
                        continue;
                    const b = base[m] - (hang[m] ? thick[m] * 0.1 : 0);
                    if (pass === 0)
                        hi = Math.max(hi, b);
                    // (a slab on another level next to it is not this edge)
                    else if (b > hi - (T * 1.5 + ov * 1.2))
                        lo = Math.min(lo, b);
                }
        isRim[k] = 1;
        rimBase[k] = lo;
    }
    const topVertex = (k) => {
        if (vTop[k] >= 0)
            return vTop[k];
        const i = k % W;
        const j = (k - i) / W;
        const y = region[k] ? base[k] + thick[k] : rimBase[k];
        vTop[k] = P.length / 3;
        P.push(minX + i * cell, y, minZ + j * cell);
        return vTop[k];
    };
    const botVertex = (k) => {
        if (vBot[k] >= 0)
            return vBot[k];
        const i = k % W;
        const j = (k - i) / W;
        const y = region[k] ? base[k] : rimBase[k];
        vBot[k] = P.length / 3;
        P.push(minX + i * cell, y, minZ + j * cell);
        return vBot[k];
    };
    for (let j = 0; j < H - 1; j++) {
        for (let i = 0; i < W - 1; i++) {
            const k00 = j * W + i;
            const k10 = k00 + 1;
            const k01 = k00 + W;
            const k11 = k01 + 1;
            const ks = [k00, k10, k01, k11];
            if (!ks.some((k) => region[k]))
                continue;
            if (!ks.every((k) => region[k] || isRim[k]))
                continue;
            const a0 = topVertex(k00);
            const a1 = topVertex(k10);
            const a2 = topVertex(k01);
            const a3 = topVertex(k11);
            // +y facing: (x, z) grid → counter-clockwise seen from above is (00, 01, 10)
            idx.push(a0, a2, a1, a1, a2, a3);
            if (ks.some((k) => hang[k]) && ks.every((k) => hang[k] || isRim[k] || !sup[k])) {
                const b0 = botVertex(k00);
                const b1 = botVertex(k10);
                const b2 = botVertex(k01);
                const b3 = botVertex(k11);
                idx.push(b0, b1, b2, b1, b3, b2);
            }
        }
    }
    if (!idx.length)
        return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    out.computeVertexNormals();
    applyBoxUV(out);
    out.computeBoundingSphere();
    return out;
}
/**
 * Icicles hanging from an eave or a rail: `edges` is a list of [start, end]
 * segments (in the geometry's space; icicles hang toward -Y). Lengths follow
 * a long-tailed distribution with clusters where meltwater runs; each icicle
 * is a slightly wavy, ringed taper ending in a fine point.
 * Use with `materials.get('ice')`.
 */
export function icicles(edges, opts = {}) {
    const spacing = opts.spacing ?? 0.09;
    const maxLen = opts.maxLength ?? 0.45;
    const rad = opts.radius ?? 0.022;
    const density = opts.density ?? 0.7;
    const seg = opts.segments ?? 5;
    const rnd = mulberry32(opts.seed ?? 11);
    const P = [];
    const idx = [];
    const rings = 7;
    for (const [s, e] of edges) {
        const len = s.distanceTo(e);
        const count = Math.max(1, Math.floor(len / spacing));
        // meltwater clusters along the edge
        const phase = rnd() * 10;
        for (let n = 0; n < count; n++) {
            if (rnd() > density)
                continue;
            const t = (n + 0.5 + (rnd() - 0.5) * 0.7) / count;
            const cluster = 0.5 + 0.5 * Math.sin(t * len * 2.1 + phase) * Math.sin(t * len * 0.7 + phase * 1.7);
            const L = maxLen * (0.08 + 0.92 * Math.pow(rnd(), 2.2) * (0.35 + 0.65 * cluster));
            if (L < 0.03)
                continue;
            const r0 = rad * (0.35 + 0.65 * Math.sqrt(L / maxLen)) * (0.8 + rnd() * 0.4);
            const ox = s.x + (e.x - s.x) * t;
            const oy = s.y + (e.y - s.y) * t;
            const oz = s.z + (e.z - s.z) * t;
            const lean = (rnd() - 0.5) * 0.04;
            const wob = rnd() * 6.28;
            const base0 = P.length / 3;
            for (let r = 0; r <= rings; r++) {
                const v = r / rings;
                // a fat root, a long taper, ripples of refrozen melt
                const prof = Math.pow(1 - v, 1.35) * (1 + 0.12 * Math.sin(v * 21 + wob) * (1 - v));
                const rr = r0 * prof;
                const y = oy - L * v;
                const cx = ox + lean * L * v * v;
                for (let k = 0; k < seg; k++) {
                    const a = (k / seg) * Math.PI * 2 + wob;
                    P.push(cx + Math.cos(a) * rr, y, oz + Math.sin(a) * rr);
                }
            }
            const tip = P.length / 3;
            P.push(ox + lean * L, oy - L * 1.04, oz);
            for (let r = 0; r < rings; r++) {
                for (let k = 0; k < seg; k++) {
                    const a0 = base0 + r * seg + k;
                    const a1 = base0 + r * seg + ((k + 1) % seg);
                    const b0 = a0 + seg;
                    const b1 = a1 + seg;
                    idx.push(a0, a1, b0, a1, b1, b0);
                }
            }
            const last = base0 + rings * seg;
            for (let k = 0; k < seg; k++)
                idx.push(last + k, last + ((k + 1) % seg), tip);
        }
    }
    if (!idx.length)
        return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals();
    applyBoxUV(g);
    g.computeBoundingSphere();
    return g;
}
/* ------------------------------------------------------------------ */
/* Glass panes                                                         */
/* ------------------------------------------------------------------ */
/**
 * Pane coordinates for the frosted Fresnel glass (`materials.glass({ frost })`):
 * adds `aPane` = (x, y within the pane in metres from its lower-left corner,
 * pane width, pane height), derived from a geometry whose `uv` runs 0..1
 * across each pane (PlaneGeometry, or any per-pane 0..1 UVs). v = 0 must be
 * the bottom of the pane (frost and condensation gather there).
 */
export function setPaneCoords(geometry, width, height) {
    const uv = geometry.getAttribute('uv');
    const count = geometry.getAttribute('position').count;
    const a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const u = uv ? uv.getX(i) : 0;
        const v = uv ? uv.getY(i) : 0;
        a[i * 4] = u * width;
        a[i * 4 + 1] = v * height;
        a[i * 4 + 2] = width;
        a[i * 4 + 3] = height;
    }
    geometry.setAttribute('aPane', new THREE.BufferAttribute(a, 4));
    return geometry;
}
/** A glass pane (PlaneGeometry in XY, facing +Z) with pane coordinates for frost. */
export function glassPane(width, height) {
    return setPaneCoords(new THREE.PlaneGeometry(width, height), width, height);
}
