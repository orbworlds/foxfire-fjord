/**
 * Shared build state for Lysvik: one GeoBuilder per material (plus a "near"
 * set that LOD hides from afar), the night lights (sprites, lamp pools on the
 * lanes, light thrown on the snow), chimney smoke emitters and tree spots, and
 * helpers for walls, white-trimmed windows, plinths, snow pillows and banks,
 * and icicles.
 */
import { GeoBuilder, IDENTITY } from './builder.js';
import { GLOW, SCHED, STYLE, warmColor, snapSeed, snapSize } from './materials.js';
/** front (+z), right (+x), back (−z), left (−x) walls of a w×d box centered in F */
export function wallFrames(F, w, d, y = 0) {
    return [
        { f: F.child(-w / 2, y, d / 2, 0), L: w },
        { f: F.child(w / 2, y, d / 2, Math.PI / 2), L: d },
        { f: F.child(w / 2, y, -d / 2, Math.PI), L: w },
        { f: F.child(-w / 2, y, -d / 2, -Math.PI / 2), L: d },
    ];
}
export const WHITE = [0.86, 0.855, 0.83];
/**
 * A memoized terrain height: exact samples on a fine lattice (computed on
 * demand), bilinear in between. Building geometry samples the ground many
 * times around each house; this keeps that cheap.
 */
export function cachedHeight(h, cell = 1) {
    const m = new Map();
    const g = (i, j) => {
        const key = (j + 30000) * 60000 + (i + 30000);
        let v = m.get(key);
        if (v === undefined) {
            v = h(i * cell, j * cell);
            m.set(key, v);
        }
        return v;
    };
    return (x, z) => {
        const fx = x / cell;
        const fz = z / cell;
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        const tx = fx - ix;
        const tz = fz - iz;
        const a = g(ix, iz);
        const b = g(ix + 1, iz);
        const c = g(ix, iz + 1);
        const d = g(ix + 1, iz + 1);
        return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    };
}
/** small deterministic hash noise in [-1, 1] */
function hn(x, z) {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
}
/** smooth value noise in [-1, 1] */
export function vnoise(x, z) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = hn(xi, zi);
    const b = hn(xi + 1, zi);
    const c = hn(xi, zi + 1);
    const d = hn(xi + 1, zi + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
export class Kit {
    h;
    fancy;
    facade = new GeoBuilder({ aStyle: 4 });
    snow = new GeoBuilder();
    stone = new GeoBuilder();
    paving = new GeoBuilder({ aLane: 4 });
    glow = new GeoBuilder({ aGlow: 4, aKind: 4 });
    boat = new GeoBuilder({ aBob: 4 });
    /** lights on the boats: glow attributes plus the boat's bob */
    boatGlow = new GeoBuilder({ aGlow: 4, aKind: 4, aBob: 4 });
    foliage = new GeoBuilder();
    cards = new GeoBuilder();
    /** small props, hidden beyond the LOD distance */
    nearFacade = new GeoBuilder({ aStyle: 4 });
    nearSnow = new GeoBuilder();
    nearStone = new GeoBuilder();
    nearGlow = new GeoBuilder({ aGlow: 4, aKind: 4 });
    nearCards = new GeoBuilder();
    ice = new GeoBuilder();
    lights = [];
    pools = [];
    /** street lamps that light the lanes below them: x, y, z, strength */
    lamps = [];
    trees = [];
    /** chimney tops that smoke: x, y, z, weight */
    smoke = [];
    /** retaining walls for the colliders: ax, az, bx, bz, yMin, yMax */
    walls = [];
    /** round obstacles (cars): x, z, radius, ground y */
    solids = [];
    constructor(h, 
    /** quality: 0 low (phones), 1 medium+, for decorative density */
    fancy) {
        this.h = h;
        this.fancy = fancy;
    }
    style(b, st, variant = 0, extra = 0, seed = 0) {
        // folded and snapped to a 1/256 grid so the shader can recover it exactly (see facadeColor)
        b.set('aStyle', st, variant, extra, Math.round((((seed % 64) + 64) % 64) * 256) / 256);
    }
    /** Wall quad in a wall frame from local height y0 to y0 + H; UV v is the local height. */
    wall(wf, y0, H, st, variant, tint, seed, b = this.facade, x0 = 0, x1 = wf.L) {
        b.frame = wf.f;
        this.style(b, st, variant, 0, seed);
        b.setColor(tint);
        b.poly([
            [x0, y0, 0],
            [x1, y0, 0],
            [x1, y0 + H, 0],
            [x0, y0 + H, 0],
        ], [
            [x0, y0],
            [x1, y0],
            [x1, y0 + H],
            [x0, y0 + H],
        ]);
    }
    /**
     * A window or glazed door on a wall: the glass quad (emissive at night) and
     * a sprite for the light field; with `trim`, the white frame around it
     * (jambs, a head with a drip cap, a sill) and snow on the cap and the sill;
     * with `pool`, a fan of warm light on the snow below.
     */
    opening(wf, x0, y0, W, H, kind, frameTint, g, opts = {}) {
        const G = this.glow;
        const sched = g.sched ?? SCHED.home;
        G.frame = wf.f;
        G.setColor(frameTint);
        G.set('aGlow', g.threshold, g.warmth, g.intensity, snapSeed(g.seed));
        G.set('aKind', kind, sched, snapSize(W), snapSize(H));
        const z = opts.recess ?? 0.015;
        G.poly([
            [x0, y0, z],
            [x0 + W, y0, z],
            [x0 + W, y0 + H, z],
            [x0, y0 + H, z],
        ], [
            [0, 0],
            [W, 0],
            [W, H],
            [0, H],
        ]);
        if (opts.trim)
            this.trimFrame(wf, x0, y0, W, H, opts.trim, g.seed, opts.sill !== false);
        if (opts.light !== false && g.threshold < 1.05) {
            const f = wf.f;
            const lx = x0 + W / 2;
            const ly = y0 + H / 2;
            this.light(f.wx(lx, 0.12), f.oy + ly, f.wz(lx, 0.12), g, Math.sqrt(W * H) * 0.85, opts.minPx ?? 2.0, opts.gain ?? 2.0, [f.ezx, 0, f.ezz]);
            if (opts.pool && opts.pool > 0) {
                const len = 2.2 + y0 * 0.6;
                const px = f.wx(lx, len * 0.5);
                const pz = f.wz(lx, len * 0.5);
                const c = warmColor(g.warmth, sched);
                const k = g.intensity * opts.pool;
                this.pools.push({ x: px, z: pz, shape: 1, rx: W * 0.9 + 0.4, rz: len * 0.5, dx: f.ezx, dz: f.ezz, glow: [g.threshold, g.warmth, g.intensity, g.seed], sched, color: [c[0] * k, c[1] * k, c[2] * k], y: opts.ground });
            }
        }
    }
    /** White window frame: jambs, a head with a small drip cap, a projecting sill; snow on the cap and the sill. */
    trimFrame(wf, x0, y0, W, H, tint, seed, sill = true) {
        const F = this.facade;
        F.frame = wf.f;
        this.style(F, STYLE.paint, 0, 0, seed);
        F.setColor(tint);
        const t = 0.085;
        const d = 0.05;
        F.box(x0 - t / 2, y0 + H / 2, d / 2, t, H + 0.02, d, 'zyY');
        F.box(x0 + W + t / 2, y0 + H / 2, d / 2, t, H + 0.02, d, 'zyY');
        // head: a board and a drip cap
        F.box(x0 + W / 2, y0 + H + 0.06, d / 2, W + t * 2 + 0.04, 0.12, d, 'zyY');
        F.box(x0 + W / 2, y0 + H + 0.135, 0.06, W + t * 2 + 0.12, 0.03, 0.12, 'z');
        if (sill)
            F.box(x0 + W / 2, y0 - 0.035, 0.05, W + t * 2 + 0.06, 0.07, 0.1, 'z');
        else
            F.box(x0 + W / 2, y0 - 0.02, d / 2, W + t * 2, 0.04, d, 'zy');
        const S = this.nearSnow;
        S.frame = wf.f;
        this.pillow(S, x0 + W / 2, y0 + H + 0.15, 0.065, W + t * 2 + 0.1, 0.11, 0.045, seed * 13, 3, 1);
        if (sill && this.fancy)
            this.pillow(S, x0 + W / 2, y0 + 0.0, 0.06, W + t * 2, 0.09, 0.035, seed * 7, 3, 1);
    }
    light(x, y, z, g, size, minPx, gain, dir = [0, 0, 0]) {
        const sched = g.sched ?? SCHED.home;
        const c = warmColor(g.warmth, sched);
        const k = g.intensity * gain;
        this.lights.push({ x, y, z, glow: [g.threshold, g.warmth, g.intensity, g.seed], sched, size, minPx, color: [c[0] * k, c[1] * k, c[2] * k], dir: [dir[0], dir[1], dir[2]] });
    }
    /** a round pool of warm light on the ground under a lamp */
    groundPool(x, z, r, g, strength, y) {
        const sched = g.sched ?? SCHED.street;
        const c = warmColor(g.warmth, sched);
        const k = strength;
        this.pools.push({ x, z, shape: 0, rx: r, rz: r, dx: 0, dz: 1, glow: [g.threshold, g.warmth, g.intensity, g.seed], sched, color: [c[0] * k, c[1] * k, c[2] * k], y });
    }
    /** a small glowing lamp box (lantern glass) plus its sprite */
    lampGlass(b, F, x, y, z, sx, sy, sz, g, sprite, omit = '') {
        b.frame = F;
        b.setColor([1, 0.95, 0.85]);
        b.set('aGlow', g.threshold, g.warmth, g.intensity, snapSeed(g.seed));
        b.set('aKind', GLOW.lamp, g.sched ?? SCHED.street, 1, 1);
        b.box(x, y, z, sx, sy, sz, omit);
        this.light(F.wx(x, z), F.oy + y, F.wz(x, z), g, sprite.size, sprite.minPx, sprite.gain);
    }
    /**
     * Plinth / foundation under a building: a rendered concrete (or stone)
     * box from below the lowest ground up to the floor, in frame F.
     */
    plinth(F, w, d, yTop, yGround, seed, stone = false) {
        const H = yTop - yGround + 0.6;
        if (H <= 0.05)
            return;
        if (stone) {
            const S = this.stone;
            S.frame = F;
            S.setColor([0.9, 0.9, 0.88]);
            S.box(0, yTop - H / 2, 0, w, H, d, 'y', yGround - 0.6);
        }
        else {
            const P = this.facade;
            P.frame = F;
            this.style(P, STYLE.concrete, 0, 0, seed);
            P.setColor([0.56, 0.56, 0.54]);
            P.box(0, yTop - H / 2, 0, w, H, d, 'y', 0);
        }
    }
    /**
     * A soft snow pillow on a flat top (local frame of `b`), centered at
     * (cx, cy, cz), sx × sz, thickness t: rounded edges, a little lumpy.
     */
    pillow(b, cx, cy, cz, sx, sz, t, seed, nx = 5, nz = 5, droop = 0) {
        const base = b.vertexCount;
        const P = [];
        for (let j = 0; j <= nz; j++) {
            for (let i = 0; i <= nx; i++) {
                const a = i / nx;
                const c = j / nz;
                const ex = Math.min(a, 1 - a) * 2;
                const ez = Math.min(c, 1 - c) * 2;
                const e = Math.min(ex * sx, ez * sz) / Math.max(0.04, Math.min(sx, sz) * 0.5);
                const prof = Math.sqrt(Math.max(0, Math.min(1, e * 1.6)));
                const lump = 1 + 0.18 * vnoise(cx * 3 + a * 3 + seed, cz * 3 + c * 3);
                const edge = i === 0 || i === nx || j === 0 || j === nz;
                const x = cx + (a - 0.5) * sx * (edge ? 1.04 : 1);
                const z = cz + (c - 0.5) * sz * (edge ? 1.04 : 1);
                const y = cy + (edge ? -droop - 0.006 : t * prof * lump);
                P.push([x, y, z]);
            }
        }
        this.gridMesh(b, P, nx + 1, nz + 1, base, true);
    }
    /** push a (cols × rows) vertex grid with smooth normals; `up` = triangles face +y for a top surface */
    gridMesh(b, P, cols, rows, base, up) {
        const at = (i, j) => P[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))];
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const p = at(i, j);
                const dx = sub(at(i + 1, j), at(i - 1, j));
                const dz = sub(at(i, j + 1), at(i, j - 1));
                let n = cross(dz, dx);
                const l = Math.hypot(n[0], n[1], n[2]) || 1;
                n = [n[0] / l, n[1] / l, n[2] / l];
                if (!up)
                    n = [-n[0], -n[1], -n[2]];
                b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], p[0], p[2]);
            }
        }
        for (let j = 0; j < rows - 1; j++) {
            for (let i = 0; i < cols - 1; i++) {
                const a = base + j * cols + i;
                const c = a + cols;
                if (up) {
                    b.tri(a, c, a + 1);
                    b.tri(a + 1, c, c + 1);
                }
                else {
                    b.tri(a, a + 1, c);
                    b.tri(a + 1, c + 1, c);
                }
            }
        }
    }
    /**
     * A bank of snow along a world polyline (plow banks, the heap that slides off
     * a roof): a rounded ridge `height` high and `width` wide on the ground.
     */
    /**
     * A bank of snow along pts. `inner` = which side (+1/-1 in the bank's own
     * across axis) faces a plowed lane: that face is cut steep by the blade, the
     * other runs out long, and plow clods lie at the foot of the cut and on top.
     */
    bank(b, pts, width, height, seed, yAt, inner = 0) {
        if (pts.length < 2)
            return;
        b.frame = IDENTITY;
        const ground = yAt ?? this.h;
        const across = inner ? [-1, -0.86, -0.66, -0.38, -0.1, 0.18, 0.46, 0.72, 0.9, 1] : [-1, -0.7, -0.35, 0, 0.35, 0.7, 1];
        // the crest sits toward the cut; the blade face is steep, the far side runs out long
        const crest = inner * 0.32;
        const prof = (a) => {
            if (!inner)
                return Math.pow(Math.max(0, 1 - a * a), 0.75);
            const toCut = (a - crest) * inner;
            const s = toCut > 0 ? toCut / (1 - crest * inner) : -toCut / (1 + crest * inner);
            return toCut > 0 ? Math.pow(Math.max(0, 1 - Math.pow(s, 3.2)), 0.55) : Math.pow(Math.max(0, 1 - s * s), 1.25);
        };
        const P = [];
        const n = pts.length;
        const clods = [];
        const h01 = (x, z) => hn(x, z) * 0.5 + 0.5;
        let run = 0;
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            const q0 = pts[Math.max(0, i - 1)];
            const q1 = pts[Math.min(n - 1, i + 1)];
            let tx = q1[0] - q0[0];
            let tz = q1[1] - q0[1];
            const l = Math.hypot(tx, tz) || 1;
            tx /= l;
            tz /= l;
            if (i > 0)
                run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
            const end = Math.min(i, n - 1 - i);
            const taper = Math.min(1, (end + 0.3) / 2.2);
            // heaped unevenly: long swells where the plow pushed more, short lumps
            const swell = vnoise(p[0] * 0.21 + seed, p[1] * 0.21 - seed);
            const hh = height * taper * (1 + 0.32 * swell + 0.12 * vnoise(p[0] * 1.1 - seed, p[1] * 1.1));
            const ww = (width / 2) * (0.9 + 0.1 * taper) * (1 + 0.16 * vnoise(p[0] * 0.33 + 7 + seed, p[1] * 0.33));
            for (const a of across) {
                const w = ww * a;
                const x = p[0] - tz * w;
                const z = p[1] + tx * w;
                P.push([x, ground(x, z) - 0.06 + hh * prof(a), z]);
            }
            // clods thrown off the blade, every metre or two
            if (inner && taper > 0.8 && h01(Math.floor(run * 0.7) + seed * 13, 5) < 0.55 && (clods.length === 0 || run - clods[clods.length - 1][3] > 1.1)) {
                const onTop = h01(i, seed) < 0.35;
                const a = onTop ? crest + (h01(i, seed + 3) - 0.5) * 0.5 : inner * (0.95 + 0.25 * h01(i, seed + 5));
                const w = ww * a;
                const x = p[0] - tz * w + tx * (h01(i, seed + 9) - 0.5);
                const z = p[1] + tx * w + tz * (h01(i, seed + 9) - 0.5);
                const y = (onTop ? ground(x, z) - 0.06 + hh * prof(Math.min(1, Math.abs(a)) * Math.sign(a || 1)) : ground(x, z)) - 0.02;
                clods.push([x, y, z, run]);
            }
        }
        // rows along the path, columns across: write as (cols = across, rows = n)
        this.gridMesh(b, P, across.length, n, b.vertexCount, false);
        if (clods.length) {
            const N = this.nearSnow;
            N.frame = IDENTITY;
            N.setColor([1, 1, 1]);
            clods.forEach(([x, y, z], i) => {
                const r = 0.11 + 0.17 * h01(i, seed + 11);
                N.blob(x, y + r * 0.35, z, r * 1.25, r * 0.75, r, 0.25, i + seed * 31, 0);
            });
        }
    }
    /** a row of icicles hanging from a → b (local frame of the ice builder) */
    icicles(F, a, bb, density, maxLen, seed) {
        if (!this.fancy)
            density *= 0.4;
        const I = this.ice;
        I.frame = F;
        const L = Math.hypot(bb[0] - a[0], bb[2] - a[2]);
        const n = Math.floor(L / 0.22);
        let s = seed * 9301 + 49297;
        const rnd = () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
        for (let i = 0; i < n; i++) {
            if (rnd() > density)
                continue;
            const t = (i + 0.5 + (rnd() - 0.5) * 0.6) / n;
            const cluster = 0.5 + 0.5 * Math.sin(t * L * 1.7 + seed) * Math.sin(t * L * 0.6 + seed * 1.3);
            const len = maxLen * (0.1 + 0.9 * Math.pow(rnd(), 2.0) * (0.3 + 0.7 * cluster));
            if (len < 0.05)
                continue;
            const r = 0.012 + 0.03 * Math.sqrt(len / Math.max(maxLen, 0.01));
            const x = a[0] + (bb[0] - a[0]) * t;
            const y = a[1] + (bb[1] - a[1]) * t;
            const z = a[2] + (bb[2] - a[2]) * t;
            const base = I.vertexCount;
            for (let k = 0; k < 3; k++) {
                const ang = (k / 3) * Math.PI * 2 + rnd();
                const nx = Math.cos(ang);
                const nz = Math.sin(ang);
                I.vertex(x + nx * r, y, z + nz * r, nx, 0.2, nz, k / 3, 0);
            }
            I.vertex(x, y - len, z, 0, -1, 0, 0.5, 1);
            for (let k = 0; k < 3; k++)
                I.tri(base + k, base + 3, base + ((k + 1) % 3));
        }
    }
}
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** small deterministic helpers */
export function pick(r, items) {
    return items[Math.min(items.length - 1, Math.floor(r() * items.length))];
}
export function jitter(c, r, amount) {
    const k = 1 + (r() - 0.5) * 2 * amount;
    return [c[0] * k, c[1] * k, c[2] * k];
}
export function scale3(a, k) {
    return [a[0] * k, a[1] * k, a[2] * k];
}
