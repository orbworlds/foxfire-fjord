/**
 * Procedural, tileable textures for Foxfire Fjord's material library,
 * generated on the CPU (no image assets). Every generator returns canvases
 * (colour map, optional bump and roughness); `materials.ts` turns them into
 * metre-scaled textures. The generators run in the texture workers
 * (core/texture-pool.ts, on OffscreenCanvas) and on the main thread only as a
 * fallback, so they must stay pure: pixels from their arguments, nothing else.
 *
 * Timber grain always runs along U (texture x). Boards are stacked along V.
 * The Nordic palette lives in the recipes; the generators only know shapes:
 * knotty pine, painted and tarred board-and-batten, silvered timber, birch
 * bark, foliated gneiss and fieldstone, wool knit, sheepskin, rope, felt.
 */
import { mulberry32 } from '../world/noise.js';
/** Tileable value noise with independent periods along u and v. */
export class PeriodicNoise {
    pu;
    pv;
    lattice;
    constructor(pu, pv, seed) {
        this.pu = pu;
        this.pv = pv;
        const r = mulberry32(seed);
        this.lattice = new Float32Array(pu * pv);
        for (let i = 0; i < this.lattice.length; i++)
            this.lattice[i] = r() * 2 - 1;
    }
    /** u, v in [0, 1) texture space (wraps) */
    sample(u, v) {
        const x = u * this.pu;
        const y = v * this.pv;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        let xf = x - xi;
        let yf = y - yi;
        xf = xf * xf * (3 - 2 * xf);
        yf = yf * yf * (3 - 2 * yf);
        const pu = this.pu;
        const pv = this.pv;
        const x0 = ((xi % pu) + pu) % pu;
        const y0 = ((yi % pv) + pv) % pv;
        const x1 = (x0 + 1) % pu;
        const y1 = (y0 + 1) % pv;
        const L = this.lattice;
        const a = L[y0 * pu + x0];
        const b = L[y0 * pu + x1];
        const c = L[y1 * pu + x0];
        const d = L[y1 * pu + x1];
        return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
    }
}
/** Tileable fBm built from PeriodicNoise octaves; result roughly in [-1, 1]. */
export class PeriodicFbm {
    octaves = [];
    constructor(pu, pv, count, seed) {
        for (let o = 0; o < count; o++)
            this.octaves.push(new PeriodicNoise(pu << o, pv << o, seed + o * 101));
    }
    sample(u, v) {
        let sum = 0;
        let amp = 1;
        let norm = 0;
        for (const n of this.octaves) {
            sum += n.sample(u, v) * amp;
            norm += amp;
            amp *= 0.5;
        }
        return sum / norm;
    }
}
export function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function canvas(size, h = size) {
    // in the texture workers (core/texture-pool.ts) there is no document: an OffscreenCanvas does the same job
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, h);
    c.width = size;
    c.height = h;
    const ctx = c.getContext('2d');
    return [c, ctx, ctx.createImageData(size, h)];
}
function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}
/** wrapped difference in [-0.5, 0.5) */
function wrap(d) {
    return d - Math.round(d);
}
/** Writes RGB + opaque alpha. */
function put(d, k, r, g, b) {
    d[k] = r;
    d[k + 1] = g;
    d[k + 2] = b;
    d[k + 3] = 255;
}
function putGrey(d, k, v01) {
    const v = 255 * clamp01(v01);
    d[k] = d[k + 1] = d[k + 2] = v;
    d[k + 3] = 255;
}
function makeKnots(count, seed, rMin, rMax) {
    const rnd = mulberry32(seed * 7 + 3);
    const out = [];
    for (let i = 0; i < count; i++)
        out.push({ u: rnd(), v: rnd(), r: rMin + (rMax - rMin) * rnd(), ax: 1.2 + rnd() * 1.1, dead: rnd() < 0.35 });
    return out;
}
/**
 * Knot field at (u, v): the grain deflection (added to v before the rings),
 * the knot body weight (0..1) and a ring coordinate inside the knot.
 */
function knotAt(knots, u, v, out) {
    out.defl = 0;
    out.body = 0;
    out.ring = 0;
    out.rim = 0;
    out.halo = 0;
    out.dead = false;
    for (const k of knots) {
        const du = wrap(u - k.u) / k.ax;
        const dv = wrap(v - k.v);
        const d2 = du * du + dv * dv;
        const r2 = k.r * k.r;
        if (d2 > r2 * 40)
            continue;
        // grain flows around the knot like water around a stone
        out.defl -= dv * 0.85 * (r2 * 2.5) / (d2 + r2 * 2.5);
        const d = Math.sqrt(d2) / k.r;
        const body = 1 - smooth(0.82, 1.02, d);
        if (body > out.body) {
            out.body = body;
            out.ring = d;
            out.rim = Math.exp(-Math.pow((d - 0.92) / 0.09, 2));
            out.dead = k.dead;
        }
        out.halo = Math.max(out.halo, Math.exp(-Math.max(0, d - 1) * 1.6) * (1 - body));
    }
}
/* ------------------------------------------------------------------ */
/* Timber                                                              */
/* ------------------------------------------------------------------ */
/**
 * Straight-grained timber. Grain runs along U (texture x).
 * `knots` scatters that many knots per tile (knotty pine), with the grain
 * flowing around them; `checks` adds weathering cracks along the grain.
 */
export function woodTextures(size, light, dark, opts = {}) {
    const rings = opts.rings ?? 9;
    const contrast = opts.contrast ?? 0.55;
    const seed = opts.seed ?? 1;
    const L = hexToRgb(light);
    const D = hexToRgb(dark);
    const KNOT = mix(D, [70, 38, 20], 0.55);
    const warp = new PeriodicFbm(2, 3, 3, seed);
    const fibers = new PeriodicFbm(3, 96, 2, seed + 7);
    const tone = new PeriodicFbm(1, 2, 2, seed + 13);
    const checkN = new PeriodicFbm(2, 40, 2, seed + 17);
    const knots = opts.knots ? makeKnots(opts.knots, seed, 0.022, 0.05) : [];
    const kf = { defl: 0, body: 0, ring: 0, rim: 0, halo: 0, dead: false };
    const checks = opts.checks ?? 0;
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const w = warp.sample(u, v);
            if (knots.length)
                knotAt(knots, u, v, kf);
            const r = (v + w * 0.07 + kf.defl) * rings;
            const f = r - Math.floor(r);
            // latewood band: sharp rise, slow decay
            const late = Math.pow(Math.max(0, 1 - Math.abs(f - 0.82) / 0.2), 2.2);
            const fib = fibers.sample(u, v) * 0.5 + 0.5;
            let t = clamp01(late * contrast + fib * 0.22 + tone.sample(u, v) * 0.12 + kf.halo * 0.25);
            let col = mix(L, D, t);
            let h = 0.55 - late * 0.35 - fib * 0.2;
            if (kf.body > 0) {
                // the knot: concentric growth rings, a dark rim on dead knots, a resinous live core
                const kr = Math.pow(Math.max(0, 1 - Math.abs(((kf.ring * 4.5) % 1) - 0.5) * 2), 3);
                const kc = mix(KNOT, D, 0.3 + 0.4 * kr);
                const rim = kf.dead ? kf.rim : kf.rim * 0.35;
                col = mix(col, mix(kc, [26, 16, 10], rim * 0.85), kf.body);
                h = h * (1 - kf.body) + kf.body * (0.62 - rim * 0.45 - kr * 0.06);
            }
            if (checks > 0) {
                const ck = clamp01((Math.abs(checkN.sample(u, v)) - (0.035 * checks)) * -40);
                col = mix(col, [D[0] * 0.35, D[1] * 0.35, D[2] * 0.35], ck * 0.8);
                h -= ck * 0.45;
            }
            const k = (y * size + x) * 4;
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, h);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/**
 * Floor boards: planks run along U, `planks` boards across the tile,
 * staggered butt joints; optional knots per tile.
 */
export function plankTextures(size, light, dark, planks = 12, seed = 3, knotCount = 0) {
    const L = hexToRgb(light);
    const D = hexToRgb(dark);
    const KNOT = mix(D, [70, 38, 20], 0.55);
    const warp = new PeriodicFbm(2, 4, 3, seed);
    const fibers = new PeriodicFbm(4, 160, 2, seed + 5);
    const wearN = new PeriodicFbm(3, 3, 4, seed + 9);
    const rnd = mulberry32(seed);
    const plankTone = [];
    const plankOffset = [];
    const plankRings = [];
    for (let i = 0; i < planks; i++) {
        plankTone.push(rnd() * 0.3 - 0.15);
        plankOffset.push(rnd());
        plankRings.push(5 + Math.floor(rnd() * 6));
    }
    const knots = knotCount ? makeKnots(knotCount, seed + 1, 0.12 / planks, 0.28 / planks) : [];
    const kf = { defl: 0, body: 0, ring: 0, rim: 0, halo: 0, dead: false };
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const [rc, rctx, rimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    const rd = rimg.data;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        const pi = Math.floor(v * planks);
        const pv = v * planks - pi;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            // two boards per tile length, staggered per row
            const bu = (u * 2 + plankOffset[pi]) % 1;
            const w = warp.sample(u, v);
            if (knots.length)
                knotAt(knots, u, v, kf);
            const r = (pv + w * 0.25 + u * 0.15 + kf.defl * planks) * plankRings[pi];
            const f = r - Math.floor(r);
            const late = Math.pow(Math.max(0, 1 - Math.abs(f - 0.8) / 0.22), 2);
            const fib = fibers.sample(u, v) * 0.5 + 0.5;
            let t = clamp01(0.32 + plankTone[pi] + late * 0.42 + fib * 0.18 + kf.halo * 0.2);
            const seamV = Math.min(pv, 1 - pv) * (size / planks);
            const seamU = Math.min(bu, 1 - bu) * size * 0.5;
            const seam = Math.min(seamV, seamU);
            let hgt = 0.6 - late * 0.2 - fib * 0.15;
            // foot traffic: a soft polish down the middle of the boards
            const wear = clamp01(wearN.sample(u, v) * 0.8 + 0.4);
            let rough = 0.82 - wear * 0.22 + late * 0.06;
            let col = mix(L, D, t);
            if (kf.body > 0) {
                const kr = Math.pow(Math.max(0, 1 - Math.abs(((kf.ring * 4.5) % 1) - 0.5) * 2), 3);
                const kc = mix(KNOT, D, 0.3 + 0.4 * kr);
                col = mix(col, mix(kc, [26, 16, 10], (kf.dead ? 1 : 0.35) * kf.rim * 0.85), kf.body);
                hgt = hgt * (1 - kf.body) + kf.body * 0.58;
            }
            if (seam < 1.2) {
                t = Math.min(1, t + 0.45);
                col = mix(col, D, 0.55);
                col = [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6];
                hgt = 0.05;
                rough = 0.95;
            }
            const k = (y * size + x) * 4;
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, hgt);
            putGrey(rd, k, rough);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    return { map: c, bump: bc, rough: rc };
}
/**
 * Knotty pine panelling: tongue-and-groove boards stacked along V with
 * V-jointed seams, grain along U. Each board is cut from its own log:
 * flat-sawn boards show nested "cathedral" arches, quarter-sawn ones straight
 * lines; tones vary board to board. Knots are small (1-4 cm), live ones
 * sound and reddish with a soft halo, dead ones ringed dark, the grain
 * flowing round them. Returns colour, bump (seams, latewood) and roughness
 * (an oiled finish).
 */
export function panelTextures(size, light, dark, opts = {}) {
    const boards = opts.boards ?? 16;
    const seed = opts.seed ?? 5;
    const L = hexToRgb(light);
    const D = hexToRgb(dark);
    const KNOT_LIVE = mix(D, [122, 58, 28], 0.6);
    const KNOT_DEAD = [52, 32, 18];
    const warp = new PeriodicFbm(2, 6, 3, seed);
    const fibers = new PeriodicFbm(3, 200, 2, seed + 5);
    const tone = new PeriodicFbm(2, 3, 2, seed + 9);
    const rnd = mulberry32(seed * 13 + 1);
    const bTone = [];
    const bWarm = [];
    const bRings = [];
    const bArch = [];
    const bPhase = [];
    const bCentre = [];
    for (let i = 0; i < boards; i++) {
        bTone.push((rnd() - 0.5) * 0.24);
        bWarm.push((rnd() - 0.5) * 0.12);
        bRings.push(3 + rnd() * 5);
        // flat-sawn (arched) or quarter-sawn (straight)
        bArch.push(rnd() < 0.7 ? 0.35 + rnd() * 0.6 : 0.04);
        bPhase.push(rnd());
        bCentre.push(rnd());
    }
    const knots = makeKnots(opts.knots ?? 5, seed + 3, 0.004, 0.013);
    const kf = { defl: 0, body: 0, ring: 0, rim: 0, halo: 0, dead: false };
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const [rc, rctx, rimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    const rd = rimg.data;
    const groove = 1.2 / size;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        const bi = Math.floor(v * boards);
        const pv = v * boards - bi;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            knotAt(knots, u, v, kf);
            const w = warp.sample(u, v);
            // cathedral arches: level sets of (distance across the board) + a periodic bow along it
            const arch = bArch[bi] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (u + bPhase[bi])));
            const r = (Math.abs(pv - bCentre[bi]) * 1.4 + arch + w * 0.18 + kf.defl * boards) * bRings[bi];
            const f = r - Math.floor(r);
            const late = Math.pow(Math.max(0, 1 - Math.abs(f - 0.85) / 0.16), 2.4);
            const fib = fibers.sample(u, v) * 0.5 + 0.5;
            const t = clamp01(0.3 + bTone[bi] + late * 0.36 + fib * 0.14 + tone.sample(u, v) * 0.08 + kf.halo * 0.3);
            let col = mix(L, D, t);
            col = [col[0] * (1 + bWarm[bi]), col[1], col[2] * (1 - bWarm[bi])];
            let hgt = 0.6 - late * 0.12 - fib * 0.06;
            let rough = 0.62 + late * 0.08 + fib * 0.06;
            if (kf.body > 0) {
                const kr = Math.pow(Math.max(0, 1 - Math.abs(((kf.ring * 3.5) % 1) - 0.5) * 2), 3);
                const kc = kf.dead ? mix(KNOT_DEAD, D, 0.25 + 0.3 * kr) : mix(KNOT_LIVE, D, 0.15 + 0.35 * kr);
                col = mix(col, kf.dead ? mix(kc, [24, 14, 8], kf.rim * 0.9) : kc, kf.body);
                hgt = hgt * (1 - kf.body) + kf.body * (kf.dead ? 0.5 - kf.rim * 0.3 : 0.62);
            }
            // V-joint where the boards meet: a thin shadowed groove between two narrow bevels
            const sv = Math.min(pv, 1 - pv) / boards;
            if (sv < groove * 2.5) {
                const g = 1 - clamp01((sv - groove * 0.35) / (groove * 2.15));
                const core = 1 - clamp01((sv - groove * 0.2) / (groove * 0.6));
                col = mix(col, [col[0] * 0.78, col[1] * 0.74, col[2] * 0.7], g * 0.6);
                col = mix(col, [col[0] * 0.5, col[1] * 0.46, col[2] * 0.42], core * 0.7);
                hgt = hgt * (1 - g) + (0.6 - 0.45 * g) * g;
                rough = rough * (1 - g) + 0.85 * g;
            }
            const k = (y * size + x) * 4;
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, hgt);
            putGrey(rd, k, rough);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    return { map: c, bump: bc, rough: rc };
}
/**
 * Cladding boards (grain along U, boards stacked along V), painted, tarred
 * or bare, optionally board-and-batten. Returns colour, bump and roughness.
 * Paint: matte linseed/iron-oxide paint with brush streaks and the grain
 * telegraphing through, chipped at the edges where the weather hits.
 */
export function boardTextures(size, opts = {}) {
    const boards = opts.boards ?? 5;
    const seed = opts.seed ?? 71;
    const wearAmt = opts.wear ?? 0;
    const tar = !!opts.tar;
    const P = opts.paint ? hexToRgb(opts.paint) : null;
    // the wood under it: silver-grey weathered pine, or tar-soaked near-black
    const WL = tar ? [52, 40, 31] : [168, 158, 142];
    const WD = tar ? [17, 13, 11] : [104, 96, 86];
    const warp = new PeriodicFbm(2, 4, 3, seed);
    const fibers = new PeriodicFbm(3, 128, 2, seed + 5);
    const brush = new PeriodicFbm(2, 96, 3, seed + 11);
    const patch = new PeriodicFbm(3, 3, 5, seed + 19);
    const tone = new PeriodicFbm(2, 2, 3, seed + 23);
    const rnd = mulberry32(seed);
    const bTone = [];
    const bRings = [];
    const bOff = [];
    for (let i = 0; i < boards; i++) {
        bTone.push(rnd() * 2 - 1);
        bRings.push(4 + Math.floor(rnd() * 5));
        bOff.push(rnd());
    }
    // batten half-width in board units (~6 cm battens on ~24 cm boards)
    const bw = 0.13;
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const [rc, rctx, rimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    const rd = rimg.data;
    const px = size / boards;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        const bi = Math.floor(v * boards);
        const fv = v * boards - bi;
        // distance to the nearest seam in board units (seams at fv = 0 / 1)
        const toSeam = Math.min(fv, 1 - fv);
        const onBatten = opts.batten && toSeam < bw;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const w = warp.sample(u, v);
            const fib = fibers.sample(u, v) * 0.5 + 0.5;
            let late;
            let hgt;
            let edge;
            if (onBatten) {
                // batten: its own straight grain, a raised strip with eased edges and a shadow line beside it
                const bv = (toSeam / bw) * (fv < 0.5 ? 1 : -1);
                const r = (bv * 0.5 + w * 0.12 + bOff[bi] * 3) * 3;
                late = Math.pow(Math.max(0, 1 - Math.abs(r - Math.floor(r) - 0.8) / 0.22), 2);
                const e = (bw - toSeam) * px;
                edge = clamp01(e / 1.6);
                hgt = 0.62 + 0.3 * smooth(0, 2.2, e) - late * 0.08 - fib * 0.06;
            }
            else {
                const r = (fv + w * 0.2 + u * 0.08 + bOff[bi]) * bRings[bi];
                late = Math.pow(Math.max(0, 1 - Math.abs(r - Math.floor(r) - 0.82) / 0.2), 2.2);
                const e = (opts.batten ? toSeam - bw : toSeam) * px;
                edge = clamp01(e / 1.2);
                // shadow line where a board meets the batten / the next board
                hgt = 0.38 * smooth(0, 2.5, e) + 0.12 - late * 0.1 - fib * 0.08;
            }
            const t = clamp01(late * (tar ? 0.75 : 0.55) + fib * 0.25 + tone.sample(u, v) * 0.15 + bTone[bi] * 0.08);
            let col = mix(WL, WD, t);
            let rough = tar ? 0.5 + late * 0.18 + fib * 0.12 : 0.88;
            if (P) {
                const br = brush.sample(u, v);
                // paint: per-board tone, brush streaks, grain telegraphing, darker in the grooves
                const s = 1 + bTone[bi] * 0.035 + br * 0.05 - late * 0.07 - (1 - edge) * 0.12;
                let paint = [P[0] * s, P[1] * s, P[2] * s];
                // weathering: chalky bleach on the most exposed boards
                const bleach = clamp01(tone.sample(u * 0.5, v) * 0.6 + 0.2) * 0.12;
                paint = mix(paint, [P[0] * 0.92 + 30, P[1] * 0.92 + 30, P[2] * 0.92 + 30], bleach);
                // chips: patches and near the seams/edges
                const pn = patch.sample(u, v) * 0.5 + 0.5;
                const edgeWear = (1 - smooth(0.04, 0.16, onBatten ? (bw - toSeam) : opts.batten ? toSeam - bw : toSeam)) * 0.35;
                const chip = smooth(0.0, 0.04, (pn + edgeWear + br * 0.08) - (1 - wearAmt * 0.45));
                col = mix(paint, col, chip);
                rough = 0.82 + br * 0.05 + chip * 0.08 - late * 0.03;
                hgt += (1 - chip) * 0.05 - chip * 0.04;
            }
            else if (tar) {
                // tar pools in the latewood and the grooves; a warmer brown where it thinned in the sun
                col = mix(col, [64, 47, 32], clamp01(tone.sample(u * 2, v) * 0.5) * 0.35 * (1 - late));
            }
            const ao = 0.72 + 0.28 * edge;
            col = [col[0] * ao, col[1] * ao, col[2] * ao];
            const k = (y * size + x) * 4;
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, hgt);
            putGrey(rd, k, rough);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    return { map: c, bump: bc, rough: rc };
}
/**
 * Birch bark. U runs around the trunk, V along it. Chalky white with
 * horizontal dark lenticels, grey-pink mottling, papery peels curling back
 * to the tan inner bark, and a few black diamond-shaped branch scars.
 */
export function birchBarkTextures(size, seed = 81) {
    const rnd = mulberry32(seed);
    const cloud = new PeriodicFbm(3, 3, 5, seed);
    const streak = new PeriodicFbm(2, 24, 3, seed + 3);
    const peelN = new PeriodicFbm(3, 6, 4, seed + 7);
    const WHITE = [232, 229, 220];
    const GREY = [176, 172, 168];
    const PINK = [214, 190, 176];
    const INNER = [196, 146, 104];
    const BLACK = [34, 30, 30];
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const cl = cloud.sample(u, v);
            const st = streak.sample(u, v);
            let col = mix(WHITE, GREY, clamp01(cl * 0.9 + 0.25 + st * 0.3));
            col = mix(col, PINK, clamp01(-cl * 1.2 - 0.15) * 0.6);
            let h = 0.55 + cl * 0.1;
            // peels: papery strips where the outer bark lifted, the inner bark showing with a bright curled lip
            const pn = peelN.sample(u, v);
            const peel = smooth(0.42, 0.47, pn);
            const lip = Math.exp(-Math.pow((pn - 0.42) / 0.012, 2));
            col = mix(col, INNER, peel * 0.85);
            col = mix(col, [246, 243, 236], lip * 0.8);
            h += lip * 0.35 - peel * 0.12;
            const k = (y * size + x) * 4;
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, h);
        }
    }
    // lenticels: short dark horizontal dashes (along U), wrapped for tiling
    const lent = Math.round(size * 0.9);
    for (let i = 0; i < lent; i++) {
        const x0 = rnd() * size;
        const y0 = rnd() * size;
        const len = (0.015 + Math.pow(rnd(), 2) * 0.09) * size;
        const th = Math.max(1, (0.002 + rnd() * 0.004) * size);
        const dark = 0.35 + rnd() * 0.5;
        for (let yy = -Math.ceil(th); yy <= Math.ceil(th); yy++) {
            const fy = 1 - Math.abs(yy) / (th + 0.5);
            if (fy <= 0)
                continue;
            for (let xx = 0; xx < len; xx++) {
                const taper = Math.sin((xx / len) * Math.PI);
                const a = fy * taper * dark;
                if (a <= 0.02)
                    continue;
                const px = ((Math.floor(x0 + xx) % size) + size) % size;
                const py = ((Math.floor(y0 + yy) % size) + size) % size;
                const k = (py * size + px) * 4;
                d[k] += (BLACK[0] - d[k]) * a;
                d[k + 1] += (BLACK[1] - d[k + 1]) * a;
                d[k + 2] += (BLACK[2] - d[k + 2]) * a;
                bd[k] = Math.max(0, bd[k] - 90 * a);
                bd[k + 1] = bd[k];
                bd[k + 2] = bd[k];
            }
        }
    }
    // branch scars: black, rough, chevron-shaped
    const scars = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < scars; i++) {
        const cx = rnd() * size;
        const cy = rnd() * size;
        const w = (0.06 + rnd() * 0.06) * size;
        const hgt = w * (0.55 + rnd() * 0.3);
        for (let yy = -hgt; yy <= hgt; yy++) {
            for (let xx = -w; xx <= w; xx++) {
                // chevron: |x|/w + (y/h) shaped into a downward V
                const q = Math.abs(xx) / w;
                const chev = Math.abs(yy / hgt + q * 0.9 - 0.35);
                const a = clamp01((0.32 - chev) * 6) * clamp01((1 - q) * 4);
                if (a <= 0.02)
                    continue;
                const px = ((Math.floor(cx + xx) % size) + size) % size;
                const py = ((Math.floor(cy + yy) % size) + size) % size;
                const k = (py * size + px) * 4;
                d[k] += (BLACK[0] - d[k]) * a;
                d[k + 1] += (BLACK[1] - d[k + 1]) * a;
                d[k + 2] += (BLACK[2] - d[k + 2]) * a;
                bd[k] = bd[k + 1] = bd[k + 2] = bd[k] * (1 - a) + 40 * a + ((xx * 7 + yy * 13) & 31) * a;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/* ------------------------------------------------------------------ */
/* Stone                                                               */
/* ------------------------------------------------------------------ */
/**
 * Speckled stone (granite), fine-grained stone (slate) or foliated gneiss:
 * `veins` sets the number of light/dark foliation bands per tile (along U,
 * gently folded).
 */
export function stoneTextures(size, base, opts = {}) {
    const B = hexToRgb(base);
    const seed = opts.seed ?? 11;
    const speckle = opts.speckle ?? 0.5;
    const veins = opts.veins ?? 0;
    const cloud = new PeriodicFbm(3, 3, 5, seed);
    const grain = new PeriodicNoise(Math.round(size / 3), Math.round(size / 3), seed + 4);
    const fold = new PeriodicFbm(2, 2, 3, seed + 6);
    const band = new PeriodicFbm(4, 1, 3, seed + 8);
    const rnd = mulberry32(seed + 2);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const cl = cloud.sample(u, v);
            const g = grain.sample(u, v);
            let s = 1 + cl * 0.12 + g * 0.08 * speckle;
            let warm = 0;
            let hb = 0;
            if (veins > 0) {
                // foliation: pale quartz-feldspar layers and dark biotite seams, folded and pinching out
                const q = (v + fold.sample(u, v) * 0.18 + band.sample(u, v) * 0.03) * veins;
                const f = q - Math.floor(q);
                const pale = Math.pow(Math.max(0, 1 - Math.abs(f - 0.3) / 0.14), 1.5);
                const seam = Math.pow(Math.max(0, 1 - Math.abs(f - 0.72) / 0.06), 2);
                const thick = clamp01(band.sample(u * 2, v) * 1.5 + 0.6);
                s *= 1 + pale * 0.42 * thick - seam * 0.35;
                warm = pale * thick * 0.5;
                hb = pale * 0.1 - seam * 0.15;
            }
            const roll = rnd();
            if (roll < 0.035 * speckle)
                s *= 0.45;
            else if (roll < 0.06 * speckle)
                s *= 1.35;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s + warm * 10, B[1] * s + warm * 4, B[2] * s - warm * 2);
            putGrey(bd, k, 0.5 + cl * 0.3 + g * 0.2 + hb);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/**
 * Fieldstone masonry (the cabin's chimney, plinths, the sauna's stove wall):
 * rounded glacial stones laid in rough courses, mixed grey, brown and rusty
 * tones, set in pale lime mortar that is recessed between them. Each stone is
 * a lumpy superellipse with a domed bump.
 */
export function fieldstoneTextures(size, seed = 91) {
    const rnd = mulberry32(seed);
    const PAL = [
        [124, 122, 117],
        [96, 94, 92],
        [142, 136, 126],
        [110, 97, 84],
        [134, 110, 88],
        [82, 84, 88],
        [156, 150, 140],
        [104, 100, 92],
    ];
    const stones = [];
    // courses of varying height; stones of varying length along each course
    let y = 0;
    while (y < 0.999) {
        let h = 0.1 + rnd() * 0.12;
        if (1 - (y + h) < 0.08)
            h = 1 - y;
        let x = rnd() * 0.2;
        const x0 = x;
        while (x < x0 + 1 - 0.04) {
            let w = h * (1.1 + rnd() * 1.4);
            if (x0 + 1 - (x + w) < h * 0.6)
                w = x0 + 1 - x;
            const tone = mix(PAL[Math.floor(rnd() * PAL.length)], PAL[Math.floor(rnd() * PAL.length)], rnd() * 0.5);
            stones.push({
                cx: x + w / 2,
                cy: y + h / 2 + (rnd() - 0.5) * h * 0.15,
                rx: w / 2 - 0.003 - rnd() * 0.006,
                ry: h / 2 - 0.003 - rnd() * 0.006,
                rot: (rnd() - 0.5) * 0.18,
                p: 2.6 + rnd() * 2.2,
                tone,
                seed: rnd() * 100,
            });
            x += w;
        }
        y += h;
    }
    const cloud = new PeriodicFbm(4, 4, 4, seed + 3);
    const edgeN = new PeriodicFbm(12, 12, 3, seed + 4);
    const fine = new PeriodicNoise(Math.round(size / 4), Math.round(size / 4), seed + 5);
    const MORTAR = [118, 115, 108];
    // grid acceleration
    const GR = 16;
    const cells = Array.from({ length: GR * GR }, () => []);
    stones.forEach((s, i) => {
        const r = Math.max(s.rx, s.ry) + 0.02;
        for (let gy = 0; gy < GR; gy++) {
            for (let gx = 0; gx < GR; gx++) {
                const cx = (gx + 0.5) / GR;
                const cy = (gy + 0.5) / GR;
                if (Math.abs(wrap(cx - s.cx)) < r + 0.5 / GR && Math.abs(wrap(cy - s.cy)) < r + 0.5 / GR)
                    cells[gy * GR + gx].push(i);
            }
        }
    });
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let py = 0; py < size; py++) {
        const v = py / size;
        for (let px = 0; px < size; px++) {
            const u = px / size;
            const en = edgeN.sample(u, v) * 0.12;
            let best = -1;
            let inside = 0;
            for (const i of cells[Math.min(GR - 1, Math.floor(v * GR)) * GR + Math.min(GR - 1, Math.floor(u * GR))]) {
                const s = stones[i];
                const dx = wrap(u - s.cx);
                const dy = wrap(v - s.cy);
                const cr = Math.cos(s.rot);
                const sr = Math.sin(s.rot);
                const qx = Math.abs((dx * cr + dy * sr) / s.rx);
                const qy = Math.abs((-dx * sr + dy * cr) / s.ry);
                // superellipse "radius": < 1 inside; lumpy outline from noise
                const q = Math.pow(Math.pow(qx, s.p) + Math.pow(qy, s.p), 1 / s.p) + en;
                const ins = 1 - q;
                if (ins > inside) {
                    inside = ins;
                    best = i;
                }
            }
            const cl = cloud.sample(u, v);
            const f = fine.sample(u, v);
            const k = (py * size + px) * 4;
            if (best < 0) {
                const m = 0.9 + f * 0.1 + cl * 0.05;
                put(d, k, MORTAR[0] * m, MORTAR[1] * m, MORTAR[2] * m);
                putGrey(bd, k, 0.08 + f * 0.04);
                continue;
            }
            const s = stones[best];
            const edge = smooth(0.0, 0.06, inside);
            const dome = Math.sqrt(clamp01(inside / 0.45));
            const shade = 1 + cl * 0.16 + f * 0.09 + (dome - 0.6) * 0.12;
            let col = [s.tone[0] * shade, s.tone[1] * shade, s.tone[2] * shade];
            // a dark crevice where stone meets mortar
            col = mix([col[0] * 0.55, col[1] * 0.55, col[2] * 0.55], col, edge);
            col = mix(MORTAR, col, smooth(-0.02, 0.01, inside));
            put(d, k, col[0], col[1], col[2]);
            putGrey(bd, k, 0.1 + edge * (0.3 + 0.55 * dome) + f * 0.04);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/* ------------------------------------------------------------------ */
/* Textiles                                                            */
/* ------------------------------------------------------------------ */
/** Linen / cotton weave. */
export function linenTextures(size, base, seed = 31) {
    const B = hexToRgb(base);
    const slub = new PeriodicFbm(2, 64, 2, seed);
    const slub2 = new PeriodicFbm(64, 2, 2, seed + 1);
    const threads = Math.round(size / 3);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const wx = Math.sin(u * threads * Math.PI * 2);
            const wy = Math.sin(v * threads * Math.PI * 2);
            const over = ((Math.floor(u * threads) + Math.floor(v * threads)) & 1) === 0;
            const h = over ? 0.5 + 0.5 * Math.abs(wy) : 0.5 + 0.5 * Math.abs(wx);
            const s = 0.9 + h * 0.12 + slub.sample(u, v) * 0.05 + slub2.sample(u, v) * 0.05;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s, B[1] * s, B[2] * s);
            putGrey(bd, k, h);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/**
 * Chunky hand knit (stockinette): columns of V stitches, each leg a plump
 * twisted loop, with a soft halo of wool fibres. `cols` stitches per tile
 * along U, rows along V (stitches are a little wider than tall).
 */
export function knitTextures(size, base, seed = 101, cols = 12) {
    const B = hexToRgb(base);
    const rows = Math.round(cols * 1.25);
    const fuzz = new PeriodicFbm(48, 48, 2, seed);
    const yarn = new PeriodicFbm(4, 4, 3, seed + 1);
    const ply = new PeriodicNoise(cols * 6, rows * 3, seed + 2);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        const rv = v * rows;
        const fv = rv - Math.floor(rv);
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const cu = u * cols;
            const fu = cu - Math.floor(cu);
            // two legs of the V: left leans right-down, right leans left-down
            const l = Math.abs((fu - 0.27) - (fv - 0.5) * 0.36) / 0.21;
            const r = Math.abs((fu - 0.73) + (fv - 0.5) * 0.36) / 0.21;
            const leg = Math.min(l, r);
            const prof = Math.sqrt(clamp01(1 - leg * leg));
            // each loop is pinched where it passes behind the next row
            const pinch = 0.65 + 0.35 * Math.sin(fv * Math.PI);
            const twist = ply.sample(u, v) * 0.5 + 0.5;
            const h = prof * pinch * (0.85 + 0.15 * twist);
            const fz = fuzz.sample(u, v);
            const s = 0.55 + 0.5 * h + fz * 0.06 + yarn.sample(u, v) * 0.05;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s, B[1] * s, B[2] * s);
            putGrey(bd, k, h * 0.9 + fz * 0.08);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/**
 * Sheepskin / reindeer hide fleece: dense curly locks, lighter tips, deep
 * shadows between the locks. Bump-heavy; pair with a sheen material.
 */
export function fleeceTextures(size, base, seed = 111) {
    // a sheepskin's long pile: soft domed locks (2-4 cm on a 0.3 m tile) of fine fibres combed each
    // their own way, creamy tips, grey-beige gaps deep between them
    const B = hexToRgb(base);
    const rnd = mulberry32(seed);
    const locks = 260;
    const lx = [];
    const ly = [];
    const lr = [];
    const la = [];
    const lt = [];
    for (let i = 0; i < locks; i++) {
        lx.push(rnd());
        ly.push(rnd());
        lr.push(0.05 + rnd() * 0.05);
        la.push(rnd() * Math.PI);
        lt.push(rnd() * 0.12 - 0.06);
    }
    const tone = new PeriodicFbm(3, 3, 3, seed + 5);
    const fuzz = new PeriodicFbm(32, 32, 2, seed + 7);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    const G = 12;
    const cells = Array.from({ length: G * G }, () => []);
    for (let i = 0; i < locks; i++) {
        for (let gy = 0; gy < G; gy++) {
            for (let gx = 0; gx < G; gx++) {
                const cx = (gx + 0.5) / G;
                const cy = (gy + 0.5) / G;
                if (Math.abs(wrap(cx - lx[i])) < lr[i] + 0.5 / G + 0.01 && Math.abs(wrap(cy - ly[i])) < lr[i] + 0.5 / G + 0.01)
                    cells[gy * G + gx].push(i);
            }
        }
    }
    const tip = [Math.min(255, B[0] * 1.04), Math.min(255, B[1] * 1.0), B[2] * 0.9];
    const deep = [B[0] * 0.66, B[1] * 0.62, B[2] * 0.57];
    for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const cell = cells[Math.min(G - 1, Math.floor(v * G)) * G + Math.min(G - 1, Math.floor(u * G))];
            let h = 0;
            let fib = 0.5;
            let lt0 = 0;
            for (const i of cell) {
                const dx = wrap(u - lx[i]);
                const dy = wrap(v - ly[i]);
                const q = 1 - (dx * dx + dy * dy) / (lr[i] * lr[i]);
                if (q <= 0)
                    continue;
                const dome = Math.pow(q, 0.3);
                if (dome > h) {
                    h = dome;
                    // fibres combed along the lock's direction: fine stripes across it
                    const across = (-Math.sin(la[i]) * dx + Math.cos(la[i]) * dy) / lr[i];
                    fib = 0.5 + 0.5 * Math.sin(across * 26 + Math.sin(across * 7 + i) * 1.5);
                    lt0 = lt[i];
                }
            }
            const fz = fuzz.sample(u, v) * 0.5 + 0.5;
            const hh = clamp01((0.25 + 0.75 * h) * (0.72 + 0.28 * fib) * (0.85 + 0.3 * fz));
            let col = mix(deep, B, smooth(0.0, 0.55, hh));
            col = mix(col, tip, smooth(0.6, 1.0, hh) * 0.8);
            const s2 = 1 + lt0 + tone.sample(u, v) * 0.05;
            const k = (y * size + x) * 4;
            put(d, k, col[0] * s2, col[1] * s2, col[2] * s2);
            putGrey(bd, k, hh);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/** Felt: matted fibres, faint mottling. */
export function feltTextures(size, base, seed = 121) {
    const B = hexToRgb(base);
    const fib = new PeriodicFbm(64, 64, 2, seed);
    const mottle = new PeriodicFbm(4, 4, 4, seed + 1);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const f = fib.sample(u, v);
            const m = mottle.sample(u, v);
            const s = 1 + f * 0.08 + m * 0.06;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s, B[1] * s, B[2] * s);
            putGrey(bd, k, 0.5 + f * 0.4);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/** Three-strand laid rope: strands spiral along U (`strands` turns per tile). */
export function ropeTextures(size, base, seed = 131, turns = 6) {
    const B = hexToRgb(base);
    const fib = new PeriodicFbm(64, 8, 2, seed);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
            const u = x / size;
            // strands cross the rope diagonally; three per turn
            const s0 = (u * turns + v * 3) % 1;
            const prof = Math.sin(s0 * Math.PI);
            const f = fib.sample(u, v);
            const h = Math.sqrt(clamp01(prof)) * (0.85 + 0.15 * f);
            const s = 0.55 + 0.5 * h + f * 0.08;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s, B[1] * s, B[2] * s);
            putGrey(bd, k, h);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    return { map: c, bump: bc };
}
/* ------------------------------------------------------------------ */
/* Metal and glaze                                                     */
/* ------------------------------------------------------------------ */
/** Brushed-metal roughness streaks along U. */
export function brushedTextures(size, seed = 41) {
    const streak = new PeriodicFbm(1, 256, 2, seed);
    const blot = new PeriodicFbm(3, 3, 3, seed + 1);
    const [c, ctx, img] = canvas(size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const r = clamp01(0.55 + streak.sample(u, v) * 0.35 + blot.sample(u, v) * 0.1);
            putGrey(d, (y * size + x) * 4, r);
        }
    }
    ctx.putImageData(img, 0, 0);
    return { map: c };
}
/** Cast iron: sand-cast pitting as bump, rust bloom and scale in the colour, roughness variation. */
export function castTextures(size, base, seed = 141) {
    const B = hexToRgb(base);
    const pit = new PeriodicNoise(Math.round(size / 3), Math.round(size / 3), seed);
    const cloud = new PeriodicFbm(3, 3, 4, seed + 1);
    const [c, ctx, img] = canvas(size);
    const [bc, bctx, bimg] = canvas(size);
    const [rc, rctx, rimg] = canvas(size);
    const d = img.data;
    const bd = bimg.data;
    const rd = rimg.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const p = pit.sample(u, v);
            const cl = cloud.sample(u, v);
            const s = 1 + cl * 0.15 + p * 0.06;
            const rust = clamp01((cl - 0.25) * 3) * 0.35;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s + rust * 40, B[1] * s + rust * 14, B[2] * s);
            putGrey(bd, k, 0.5 + p * 0.3 + cl * 0.1);
            putGrey(rd, k, 0.8 + cl * 0.15 - p * 0.05 + rust * 0.2);
        }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    return { map: c, bump: bc, rough: rc };
}
/** Speckled stoneware glaze: iron spots breaking through a pooled glaze. */
export function glazeTextures(size, base, seed = 151) {
    const B = hexToRgb(base);
    const rnd = mulberry32(seed);
    const pool = new PeriodicFbm(3, 3, 4, seed + 1);
    const [c, ctx, img] = canvas(size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const pl = pool.sample(u, v);
            let s = 1 + pl * 0.12;
            const roll = rnd();
            let spot = 0;
            if (roll < 0.012)
                spot = 0.55 + rnd() * 0.3;
            s *= 1 - spot * 0.6;
            const k = (y * size + x) * 4;
            put(d, k, B[0] * s + spot * 18, B[1] * s + spot * 6, B[2] * s - spot * 8);
        }
    }
    ctx.putImageData(img, 0, 0);
    return { map: c };
}
/** Generic tileable RGBA noise (4 independent fBm channels), for shaders. */
export function noiseRGBA(size, seed = 61) {
    const chans = [new PeriodicFbm(4, 4, 5, seed), new PeriodicFbm(8, 8, 4, seed + 1), new PeriodicFbm(16, 16, 3, seed + 2), new PeriodicFbm(32, 32, 2, seed + 3)];
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const k = (y * size + x) * 4;
            for (let ch = 0; ch < 4; ch++)
                out[k + ch] = 255 * clamp01(0.5 + chans[ch].sample(x / size, y / size) * 0.9);
        }
    }
    return out;
}
