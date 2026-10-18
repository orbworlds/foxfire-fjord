import * as THREE from 'three';
import { LAKE, SNOW_WIND } from '../../world/layout.js';
import { beachFactor } from '../../world/terrain-height.js';
/** Depth the sea floor fades to outside the baked world bounds. */
export const DEEP_FLOOR = -90;
export const OUTSIDE_FADE = 400;
function smooth(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}
/**
 * Winstral-style wind shelter on a half-resolution grid: march upwind and take
 * the steepest upward angle to the terrain there. Positive where upwind ground
 * rises above the point (the lee, where snow drifts in), negative on exposed
 * crests and windward slopes (scoured).
 */
function bakeShelter(H, nx, nz, stepX, stepZ) {
    const sx = Math.ceil(nx / 2);
    const sz = Math.ceil(nz / 2);
    const low = new Float32Array(sx * sz);
    const ux = -SNOW_WIND.x;
    const uz = -SNOW_WIND.z;
    const dists = [8, 16, 28, 45, 70, 105, 150, 210];
    const at = (gx, gz) => {
        const cx = Math.min(nx - 1.001, Math.max(0, gx));
        const cz = Math.min(nz - 1.001, Math.max(0, gz));
        const i = Math.floor(cx);
        const j = Math.floor(cz);
        const fx = cx - i;
        const fz = cz - j;
        const k = j * nx + i;
        return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fz) + (H[k + nx] * (1 - fx) + H[k + nx + 1] * fx) * fz;
    };
    for (let j = 0; j < sz; j++) {
        for (let i = 0; i < sx; i++) {
            const gi = i * 2;
            const gj = j * 2;
            const h = H[Math.min(nz - 1, gj) * nx + Math.min(nx - 1, gi)];
            let best = -1;
            for (const d of dists) {
                const hu = at(gi + (ux * d) / stepX, gj + (uz * d) / stepZ);
                const a = (hu - h) / d;
                if (a > best)
                    best = a;
            }
            // tan of the shelter angle, squashed to -1..1 (about ±30°)
            low[j * sx + i] = Math.max(-1, Math.min(1, Math.atan(best) / 0.52));
        }
    }
    const out = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        const lj = Math.min(sz - 1, j >> 1);
        for (let i = 0; i < nx; i++)
            out[j * nx + i] = low[lj * sx + Math.min(sx - 1, i >> 1)];
    }
    return out;
}
function boxBlur(src, nx, nz, r) {
    const tmp = new Float32Array(nx * nz);
    const out = new Float32Array(nx * nz);
    const inv = 1 / (2 * r + 1);
    for (let j = 0; j < nz; j++) {
        const row = j * nx;
        let acc = 0;
        for (let k = -r; k <= r; k++)
            acc += src[row + Math.min(nx - 1, Math.max(0, k))];
        for (let i = 0; i < nx; i++) {
            tmp[row + i] = acc * inv;
            acc += src[row + Math.min(nx - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
        }
    }
    for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let k = -r; k <= r; k++)
            acc += tmp[Math.min(nz - 1, Math.max(0, k)) * nx + i];
        for (let j = 0; j < nz; j++) {
            out[j * nx + i] = acc * inv;
            acc += tmp[Math.min(nz - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
        }
    }
    return out;
}
/**
 * Height pyramid for the shadow march (CPU mips: half-float render targets are
 * not guaranteed, so no generateMipmap). Texel centers line up with the world
 * bounds the same way as the world height texture (u = x, v = z).
 */
function makeShadowTexture(H, nx, nz, step) {
    const f = step < 2.5 ? 2 : 1;
    let w = Math.ceil(nx / f);
    let h = Math.ceil(nz / f);
    let cur = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            let s = 0;
            let n = 0;
            for (let dj = 0; dj < f; dj++) {
                const z = Math.min(nz - 1, j * f + dj);
                for (let di = 0; di < f; di++) {
                    s += H[z * nx + Math.min(nx - 1, i * f + di)];
                    n++;
                }
            }
            cur[j * w + i] = s / n;
        }
    }
    const half = (src) => {
        const out = new Uint16Array(src.length);
        for (let i = 0; i < src.length; i++)
            out[i] = THREE.DataUtils.toHalfFloat(src[i]);
        return out;
    };
    const mipmaps = [{ data: half(cur), width: w, height: h }];
    while (w > 1 || h > 1) {
        const w2 = Math.max(1, w >> 1);
        const h2 = Math.max(1, h >> 1);
        const next = new Float32Array(w2 * h2);
        for (let j = 0; j < h2; j++) {
            const j0 = Math.min(h - 1, j * 2);
            const j1 = Math.min(h - 1, j * 2 + 1);
            for (let i = 0; i < w2; i++) {
                const i0 = Math.min(w - 1, i * 2);
                const i1 = Math.min(w - 1, i * 2 + 1);
                // keep ridges: bias toward the max so distant occluders do not erode away
                const a = cur[j0 * w + i0];
                const b = cur[j0 * w + i1];
                const c = cur[j1 * w + i0];
                const d = cur[j1 * w + i1];
                next[j * w2 + i] = (a + b + c + d) * 0.125 + Math.max(a, b, c, d) * 0.5;
            }
        }
        cur = next;
        w = w2;
        h = h2;
        mipmaps.push({ data: half(cur), width: w, height: h });
    }
    const base = mipmaps[0];
    const tex = new THREE.DataTexture(base.data, base.width, base.height, THREE.RedFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}
export function bakeTerrain(world, cfg, renderer) {
    const b = world.bounds;
    const nx = world.gridNX;
    const nz = world.gridNZ;
    const H = world.heightGrid;
    const stepX = (b.maxX - b.minX) / (nx - 1);
    const stepZ = (b.maxZ - b.minZ) / (nz - 1);
    const count = nx * nz;
    const coarseTex = new THREE.DataTexture(H, nx, nz, THREE.RedFormat, THREE.FloatType);
    coarseTex.magFilter = THREE.NearestFilter;
    coarseTex.minFilter = THREE.NearestFilter;
    coarseTex.generateMipmaps = false;
    coarseTex.wrapS = coarseTex.wrapT = THREE.ClampToEdgeWrapping;
    coarseTex.needsUpdate = true;
    const slope = new Float32Array(count);
    const cavity = new Float32Array(count);
    const calm = new Float32Array(count);
    const data = new Uint8Array(count * 4);
    const r1 = Math.max(1, Math.round(9 / stepX));
    const r2 = Math.max(2, Math.round(30 / stepX));
    const blur1 = boxBlur(H, nx, nz, r1);
    const blur2 = boxBlur(H, nx, nz, r2);
    const shelter = boxBlur(bakeShelter(H, nx, nz, stepX, stepZ), nx, nz, Math.max(1, Math.round(6 / stepX)));
    for (let j = 0; j < nz; j++) {
        const jm = Math.max(0, j - 1) * nx;
        const jp = Math.min(nz - 1, j + 1) * nx;
        const z = b.minZ + j * stepZ;
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            const im = Math.max(0, i - 1);
            const ip = Math.min(nx - 1, i + 1);
            const row = j * nx;
            const dx = (H[row + ip] - H[row + im]) / ((ip - im) * stepX);
            const dz = (H[jp + i] - H[jm + i]) / (((jp - jm) / nx) * stepZ);
            const len = Math.sqrt(dx * dx + 1 + dz * dz);
            const h = H[k];
            slope[k] = Math.sqrt(dx * dx + dz * dz);
            const cav = (blur1[k] - h) * 0.6 + (blur2[k] - h) * 0.25;
            cavity[k] = cav;
            calm[k] = h > -12 && h < 12 ? beachFactor(b.minX + i * stepX, z) * smooth(9, 3, h) : 0;
            const o = k * 4;
            data[o] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
            data[o + 1] = Math.round(((-dz / len) * 0.5 + 0.5) * 255);
            data[o + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + cav / 8)) * 255);
            data[o + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + shelter[k] * 0.5)) * 255);
        }
    }
    const dataTex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    dataTex.magFilter = THREE.LinearFilter;
    dataTex.minFilter = THREE.LinearMipmapLinearFilter;
    dataTex.generateMipmaps = true;
    dataTex.wrapS = dataTex.wrapT = THREE.ClampToEdgeWrapping;
    dataTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    dataTex.needsUpdate = true;
    const coarseHeight = (x, z) => {
        const gx = (x - b.minX) / stepX;
        const gz = (z - b.minZ) / stepZ;
        const cx = Math.min(nx - 1, Math.max(0, gx));
        const cz = Math.min(nz - 1, Math.max(0, gz));
        const i0 = Math.min(nx - 2, Math.floor(cx));
        const j0 = Math.min(nz - 2, Math.floor(cz));
        const fx = cx - i0;
        const fz = cz - j0;
        const a = H[j0 * nx + i0];
        const c = H[j0 * nx + i0 + 1];
        const d = H[(j0 + 1) * nx + i0];
        const e = H[(j0 + 1) * nx + i0 + 1];
        const h = (a + (c - a) * fx) * (1 - fz) + (d + (e - d) * fx) * fz;
        const out = Math.hypot((gx - cx) * stepX, (gz - cz) * stepZ);
        return out > 0 ? h + (DEEP_FLOOR - h) * smooth(0, OUTSIDE_FADE, out) : h;
    };
    const sample = (arr, x, z) => {
        const gx = Math.min(nx - 1, Math.max(0, (x - b.minX) / stepX));
        const gz = Math.min(nz - 1, Math.max(0, (z - b.minZ) / stepZ));
        const i0 = Math.min(nx - 2, Math.floor(gx));
        const j0 = Math.min(nz - 2, Math.floor(gz));
        const fx = gx - i0;
        const fz = gz - j0;
        const a = arr[j0 * nx + i0];
        const c = arr[j0 * nx + i0 + 1];
        const d = arr[(j0 + 1) * nx + i0];
        const e = arr[(j0 + 1) * nx + i0 + 1];
        return (a + (c - a) * fx) * (1 - fz) + (d + (e - d) * fx) * fz;
    };
    // min / max pyramid over the quadtree (level 0 = finest nodes)
    const n0 = cfg.rootSize / cfg.nodeSize0;
    const minH = [];
    const maxH = [];
    const mn0 = new Float32Array(n0 * n0);
    const mx0 = new Float32Array(n0 * n0);
    const S = cfg.nodeSize0;
    for (let j = 0; j < n0; j++) {
        for (let i = 0; i < n0; i++) {
            const x0 = cfg.rootX + i * S;
            const z0 = cfg.rootZ + j * S;
            const x1 = x0 + S;
            const z1 = z0 + S;
            const k = j * n0 + i;
            const outside = Math.max(b.minX - x1, x0 - b.maxX, b.minZ - z1, z0 - b.maxZ, 0);
            if (outside > OUTSIDE_FADE + 8) {
                mn0[k] = DEEP_FLOOR;
                mx0[k] = DEEP_FLOOR;
                continue;
            }
            const gi0 = Math.max(0, Math.min(nx - 1, Math.floor((x0 - b.minX) / stepX) - 1));
            const gi1 = Math.max(0, Math.min(nx - 1, Math.ceil((x1 - b.minX) / stepX) + 1));
            const gj0 = Math.max(0, Math.min(nz - 1, Math.floor((z0 - b.minZ) / stepZ) - 1));
            const gj1 = Math.max(0, Math.min(nz - 1, Math.ceil((z1 - b.minZ) / stepZ) + 1));
            let lo = Infinity;
            let hi = -Infinity;
            for (let gj = gj0; gj <= gj1; gj++) {
                const row = gj * nx;
                for (let gi = gi0; gi <= gi1; gi++) {
                    const h = H[row + gi];
                    if (h < lo)
                        lo = h;
                    if (h > hi)
                        hi = h;
                }
            }
            const partlyOutside = x0 < b.minX || x1 > b.maxX || z0 < b.minZ || z1 > b.maxZ;
            if (partlyOutside) {
                lo = Math.min(lo, DEEP_FLOOR);
                hi = Math.max(hi, DEEP_FLOOR);
            }
            mn0[k] = lo;
            mx0[k] = hi;
        }
    }
    minH.push(mn0);
    maxH.push(mx0);
    for (let L = 1; L < cfg.levels; L++) {
        const nPrev = n0 >> (L - 1);
        const n = n0 >> L;
        const pm = minH[L - 1];
        const px = maxH[L - 1];
        const mn = new Float32Array(n * n);
        const mx = new Float32Array(n * n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const c0 = 2 * j * nPrev + 2 * i;
                const c1 = c0 + nPrev;
                mn[j * n + i] = Math.min(pm[c0], pm[c0 + 1], pm[c1], pm[c1 + 1]);
                mx[j * n + i] = Math.max(px[c0], px[c0 + 1], px[c1], px[c1 + 1]);
            }
        }
        minH.push(mn);
        maxH.push(mx);
    }
    return {
        coarseTex,
        dataTex,
        shadowTex: makeShadowTexture(H, nx, nz, stepX),
        nx,
        nz,
        stepX,
        stepZ,
        minX: b.minX,
        minZ: b.minZ,
        maxX: b.maxX,
        maxZ: b.maxZ,
        heights: H,
        slope,
        cavity,
        shelter,
        calm,
        minH,
        maxH,
        coarseHeight,
        sample,
    };
}
/**
 * The skyline Mirror Lake reflects: for 512 azimuths (u = 0.5 + atan(x, -z) / 2π, north at 0.5)
 * the tangent of the highest terrain elevation seen from the middle of the ice. The ice shader
 * mirrors the Teeth's silhouette (and the valley walls) under the reflected sky with it.
 */
export function bakeLakeSkyline(bake) {
    const n = 512;
    const out = new Float32Array(n);
    const y0 = LAKE.y + 1.5;
    for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n - 0.5) * Math.PI * 2;
        const dx = Math.sin(a);
        const dz = -Math.cos(a);
        let best = 0;
        for (let d = 60; d < 4200; d *= 1.025) {
            const t = (bake.coarseHeight(LAKE.x + dx * d, LAKE.z + dz * d) - y0) / d;
            if (t > best)
                best = t;
        }
        out[i] = best;
    }
    const tex = new THREE.DataTexture(out, n, 1, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}
