/**
 * Boreal tree and shrub templates (instanced near the camera, baked into
 * impostors far away) and the builders the hand-placed hero trees reuse.
 *
 *   Norway spruce   a narrow cone with a full skirt down to the snow: whorls
 *                   of boughs that sweep down and turn up at the tips, each a
 *                   folded spray card carrying a pillow of snow on its top
 *                   face, with a curtain of hanging branchlets beneath, and a
 *                   spire card on top. Shading normals blend the card with the
 *                   crown, so the cone reads as one soft, layered volume.
 *   mountain birch  several crooked white stems from one base, thin dark
 *                   limbs and fans of bare twigs (a purple-brown haze from afar)
 *   rowan           a grey-barked small tree with red berry clusters
 *   dwarf shrubs    juniper mounds and dwarf birch tufts poking out of the snow
 *   herbs, grass    dried fireweed / angelica stalks and lyme-grass tussocks
 *
 * Every vertex says how much snow it holds (MeshBuilder.snow): bough tops and
 * caps from the atlas' snow layer, bark from its world-up normal (material.ts).
 */
import * as THREE from 'three';
import { MeshBuilder, UP, planeBasis, randomDir } from './builder.js';
import { mulberry32 } from '../../world/noise.js';
const DEG = Math.PI / 180;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
/** Integrate a limb: direction drifts by `wobble`, bends up by `upCurve` (per unit length, + = up). */
export function growLimb(start, dir, length, r0, r1, steps, rnd, upCurve, wobble) {
    const pts = [start.clone()];
    const radii = [r0];
    const p = start.clone();
    const d = dir.clone().normalize();
    const ds = length / steps;
    for (let i = 1; i <= steps; i++) {
        const s = i / steps;
        d.addScaledVector(UP, upCurve(s) * ds);
        d.x += (rnd() - 0.5) * wobble;
        d.y += (rnd() - 0.5) * wobble * 0.5;
        d.z += (rnd() - 0.5) * wobble;
        d.normalize();
        p.addScaledVector(d, ds);
        pts.push(p.clone());
        radii.push(lerp(r0, r1, s));
    }
    return { pts, radii, tip: p.clone(), dir: d.clone() };
}
/** Point and direction at fraction t along a polyline. */
function along(pts, t, out, dir) {
    const f = clamp(t, 0, 1) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    out.lerpVectors(pts[i], pts[i + 1], f - i);
    if (dir)
        dir.subVectors(pts[i + 1], pts[i]).normalize();
}
function barkTube(b, atlas, kind, limb, sides, vTile, rnd, color, wind, snow, shape) {
    b.snow = [snow, 0];
    b.haze = 0;
    b.tube(limb.pts, limb.radii, sides, {
        uRange: atlas.bark(kind),
        vTile,
        vOff: rnd(),
        color: (i) => color(limb.pts[i], i),
        wind: (i) => wind(limb.pts[i]),
        shape,
    });
}
function crownAO(cr, p, deep = 0.45) {
    _d.subVectors(p, cr.c);
    const q = Math.sqrt((_d.x / cr.r.x) ** 2 + (_d.y / cr.r.y) ** 2 + (_d.z / cr.r.z) ** 2);
    const depth = clamp(1 - q, 0, 1);
    const vert = smooth(p.y, cr.c.y - cr.r.y, cr.c.y + cr.r.y * 0.8);
    return (1 - deep * Math.pow(depth, 0.8)) * (0.72 + 0.28 * vert);
}
function crownBend(cr, p) {
    const h = Math.max(0, p.y) / cr.height;
    const rad = Math.hypot(p.x, p.z) / Math.max(1, cr.r.x);
    return cr.amp * h * h * (1 + 0.5 * rad);
}
/** Outward direction from a vertical crown axis (spruce, columnar crowns). */
function radialOut(p, axisY, out) {
    out.set(p.x, (p.y - axisY) * 0.35, p.z);
    if (out.lengthSq() < 1e-6)
        out.set(0, 1, 0);
    return out.normalize();
}
/**
 * A card whose front face points along `n` (so the snow on it shows from above),
 * `anchor` 'center' | 'bottom' | 'top' says where `pos` sits on the card.
 */
function card(b, pos, right, up, w, h, rect, anchor, normal, color, wind, flipU = false) {
    const c = pos.clone();
    if (anchor === 'top')
        c.addScaledVector(up, -h);
    b.card(c, right, up, w, h, rect, normal, color, (p) => wind(p), anchor !== 'center', flipU);
}
/** Crossed vertical cards standing on the ground (herbs, grass, dwarf shrubs). */
function crossed(b, rect, n, w, h, rnd, flex, ao) {
    for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI + (rnd() - 0.5) * 0.35;
        const hh = h * (0.82 + rnd() * 0.3);
        const radial = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const nrm = new THREE.Vector3(-radial.z, 0, radial.x);
        const tilt = (rnd() - 0.5) * 0.2;
        const up = UP.clone().addScaledVector(nrm, tilt).normalize();
        const c = radial.clone().multiplyScalar((rnd() - 0.5) * 0.15).add(new THREE.Vector3(0, -0.1, 0));
        const seedC = rnd();
        b.card(c, radial, up, w * (0.85 + rnd() * 0.3), hh, rect, (p) => new THREE.Vector3(p.x * 0.4, 1, p.z * 0.4).addScaledVector(nrm, 0.25 * Math.sign(p.x * nrm.x + p.z * nrm.z + 1e-3)).normalize(), (p) => {
            const t = clamp((p.y + 0.1) / hh, 0, 1);
            const a = lerp(ao[0], ao[1], t);
            return [a, a, a];
        }, (p) => {
            const t = clamp((p.y + 0.1) / hh, 0, 1);
            return [flex * t * t, flex * 0.35 * t, 0, seedC + rnd() * 0.1];
        }, true, rnd() < 0.5);
    }
}
/**
 * One spruce bough: a folded spray ribbon (front face up, so its snow shows
 * from above) and a curtain of hanging branchlets under its outer part.
 */
function bough(b, o, rnd) {
    const M = o.stations;
    const ca = Math.cos(o.az);
    const sa = Math.sin(o.az);
    // side vector so that T x S points up (the front face is the top)
    const S = new THREE.Vector3(sa, 0, -ca);
    const pts = [];
    const tans = [];
    const p = o.base.clone();
    const sub = 12;
    for (let i = 0; i <= sub; i++) {
        const s = i / sub;
        const el = o.el - o.droop * Math.pow(s, 1.25) + o.upturn * smooth(s, 0.55, 1);
        const d = new THREE.Vector3(Math.cos(el) * ca, Math.sin(el), Math.cos(el) * sa);
        pts.push(p.clone());
        tans.push(d);
        p.addScaledVector(d, o.length / sub);
    }
    const at = (s, out, tan) => {
        const f = clamp(s, 0, 1) * sub;
        const i = Math.min(sub - 1, Math.floor(f));
        out.lerpVectors(pts[i], pts[i + 1], f - i);
        tan.lerpVectors(tans[i], tans[i + 1], f - i).normalize();
    };
    const hw = o.length * 0.3;
    const seed = rnd();
    const base = b.vertexCount;
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const D = new THREE.Vector3();
    const F = new THREE.Vector3();
    const Nrad = new THREE.Vector3();
    const v = new THREE.Vector3();
    const plast = o.plaster > 0 ? 1 + o.plaster : 0;
    for (let i = 0; i <= M; i++) {
        const s = i / M;
        at(s, P, T);
        D.crossVectors(S, T).normalize();
        // sides droop more toward the tip; the inner spray lies flatter
        const fold = o.fold * (0.55 + 0.45 * s);
        const cf = Math.cos(fold);
        const sf = Math.sin(fold);
        const vv = o.rect.v0 + (o.rect.v1 - o.rect.v0) * s;
        for (let k = 0; k < 3; k++) {
            const side = k === 0 ? 1 : k === 2 ? -1 : 0;
            v.copy(P);
            if (side !== 0)
                v.addScaledVector(S, side * hw * cf).addScaledVector(D, hw * sf);
            // face normal of this half (up side), then blended with the crown for soft volume
            F.copy(D).negate();
            if (side !== 0)
                F.multiplyScalar(cf).addScaledVector(S, side * sf).normalize();
            radialOut(v, o.axisY, Nrad);
            _n.copy(F).multiplyScalar(0.5).addScaledVector(Nrad, 0.42).addScaledVector(UP, 0.12).normalize();
            const cap = clamp((F.y - 0.15) / 0.6, 0, 1) * o.snow;
            b.snow = [plast > 0 ? Math.max(plast, cap) : cap, 0];
            const ao = crownAO(o.cr, v, 0.5) * o.ao * (side === 0 ? 1 : 0.92);
            const u = k === 0 ? o.rect.u0 : k === 2 ? o.rect.u1 : (o.rect.u0 + o.rect.u1) * 0.5;
            b.vert(v, _n, u, vv, [ao, ao, ao * 0.98], [crownBend(o.cr, v), 0.006 * s, 0, seed]);
        }
    }
    for (let i = 0; i < M; i++) {
        const a = base + i * 3;
        const c = a + 3;
        b.quad(a, a + 1, c + 1, c);
        b.quad(a + 1, a + 2, c + 2, c + 1);
    }
    if (!o.curtain || o.hang <= 0)
        return;
    // hanging branchlets under the outer part of the bough
    const rc = o.curtain;
    const cb = b.vertexCount;
    const stations = [0.28, 0.62, 0.97];
    const out = new THREE.Vector3(ca, 0, sa);
    stations.forEach((s, j) => {
        at(s, P, T);
        const depth = o.hang * o.length * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, s * 1.2))) * (0.85 + 0.3 * rnd());
        const top = P.clone().addScaledVector(UP, -0.03 * o.length);
        const bot = top.clone().addScaledVector(UP, -depth).addScaledVector(out, depth * 0.12);
        const u = rc.u0 + (rc.u1 - rc.u0) * (j / (stations.length - 1));
        radialOut(top, o.axisY, Nrad);
        _n.copy(Nrad).addScaledVector(UP, 0.15).normalize();
        const plastC = plast > 0 ? plast * 0.8 : 0;
        b.snow = [Math.max(plastC, 0.7 * o.snow), 1];
        const ao = crownAO(o.cr, top, 0.5) * o.ao * 0.9;
        b.vert(top, _n, u, rc.v1, [ao, ao, ao], [crownBend(o.cr, top), 0.004, 0, seed]);
        radialOut(bot, o.axisY, Nrad);
        _n.copy(Nrad).addScaledVector(UP, -0.05).normalize();
        const ao2 = ao * 0.72;
        b.vert(bot, _n, u, rc.v0, [ao2, ao2, ao2], [crownBend(o.cr, bot), 0.012, 0, seed]);
    });
    for (let j = 0; j < stations.length - 1; j++) {
        const a = cb + j * 2;
        b.quad(a, a + 2, a + 3, a + 1);
    }
}
export function spruceTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    const H = o.height;
    const R0 = o.spread * H;
    const flag = o.flag ?? 0;
    const plaster = o.plaster ?? 0;
    const lean = o.lean ?? 0;
    const cr = { c: new THREE.Vector3(0, H * 0.4, 0), r: new THREE.Vector3(R0 * 1.05, H * 0.55, R0 * 1.05), amp: 0.012 * H, height: H };
    const boughA = atlas.rect('spruceBough');
    const boughB = atlas.rect('spruceBough2');
    const curtain = atlas.rect('spruceCurtain');
    const lichen = atlas.rect('lichen');
    const wind = (q) => [crownBend(cr, q), 0, 0, 0];
    const leanAt = (y) => Math.sin(lean) * y * (1 - 0.3 * (y / H));
    // trunk
    const n = 8;
    const trunk = [];
    const radii = [];
    const r0 = 0.07 + 0.013 * H;
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const y = -0.4 + t * (H * 0.96 + 0.4);
        trunk.push(new THREE.Vector3(leanAt(y) + (rnd() - 0.5) * 0.03 * H * t * (1 - t), y, (rnd() - 0.5) * 0.02 * H * t * (1 - t)));
        radii.push(r0 * (1 - 0.85 * t) + r0 * 0.35 * Math.exp(-t * 14) + 0.012);
    }
    // the trunk stands in the crown's shade
    const bark = (q) => {
        const k = 0.32 + 0.22 * smooth(q.y, 0, H * 0.5);
        return [k, k * 0.97, k * 0.95];
    };
    barkTube(b, atlas, plaster > 0 ? 'deadwood' : 'spruce', { pts: trunk, radii }, H > 6 ? 6 : 5, 1.6, rnd, bark, wind, 0.25 + plaster * 0.5);
    // a dark core of crossed cards so the cone never looks hollow between the whorls
    const core = atlas.rect('spruceTip');
    for (let k = 0; k < 3; k++) {
        const az = (k / 3) * Math.PI + rnd() * 0.4;
        b.snow = [plaster > 0 ? 1 + plaster * 0.6 : 0.55, 1];
        card(b, new THREE.Vector3(0, H * 0.02, 0), new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), UP.clone(), R0 * 1.25, H * 0.9, core, 'bottom', (p) => radialOut(p, H * 0.45, new THREE.Vector3()).multiplyScalar(0.6).addScaledVector(UP, 0.35).normalize(), (p) => {
            const a = 0.42 + 0.3 * smooth(p.y, 0, H);
            return [a, a, a];
        }, (p) => [crownBend(cr, p), 0, 0, 0], k === 1);
    }
    // whorls of boughs
    const top = H * 0.86;
    const count = Math.max(4, Math.round((top - 0.2) / o.whorl));
    let rot = rnd() * Math.PI * 2;
    const stations = H > 9 ? 4 : 3;
    const lichenSpots = [];
    for (let w = 0; w < count; w++) {
        const f = w / (count - 1);
        const y = lerp(0.12, top, Math.pow(f, 0.97)) + (rnd() - 0.5) * o.whorl * 0.3;
        const fy = y / H;
        const rad = R0 * Math.pow(Math.max(0, 1 - fy), o.profile) * (0.9 + 0.2 * rnd()) + 0.08;
        const nb = Math.max(3, Math.round(o.boughs * (0.55 + 0.45 * (1 - fy))));
        rot += 2.39996;
        for (let j = 0; j < nb; j++) {
            // the odd bough lost to an old snow break leaves a gap in the tier
            if (fy > 0.15 && rnd() < 0.08)
                continue;
            let az = rot + (j / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
            let len = rad * (0.78 + 0.44 * rnd());
            if (flag > 0) {
                // the windward side is stunted, the lee side carries the crown (+x is the lee)
                const lee = Math.cos(az);
                len *= lerp(1, 0.35 + 0.65 * (0.5 + 0.5 * lee) * 1.3, flag);
                az = Math.atan2(Math.sin(az), Math.cos(az) + 0.6 * flag);
            }
            const el = (lerp(-14, 26, fy) - 10 * o.load) * DEG + (rnd() - 0.5) * 0.15;
            const droop = lerp(46, 16, fy) * (0.6 + 0.6 * o.load) * DEG;
            const upturn = lerp(26, 8, fy) * DEG;
            // the arc's horizontal reach ≈ length · cos(mean elevation)
            const meanEl = el - droop * 0.45 + upturn * 0.15;
            const L = (len / Math.max(0.5, Math.cos(meanEl))) * (0.9 + 0.2 * rnd()) + 0.1;
            const start = new THREE.Vector3(leanAt(y), y, 0).add(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(0.05));
            bough(b, {
                base: start,
                az,
                el,
                droop,
                upturn,
                length: L,
                fold: (24 + 18 * o.load) * DEG,
                rect: fy > 0.55 || rnd() < 0.3 ? boughB : boughA,
                curtain: L > 0.3 ? curtain : null,
                hang: lerp(0.55, 0.32, fy),
                snow: 0.72 + 0.28 * rnd(),
                plaster,
                stations,
                ao: 0.95 + rnd() * 0.1,
                axisY: H * 0.45,
                cr,
            }, rnd);
            if ((o.lichen ?? 0) > 0 && fy < 0.45 && fy > 0.08 && rnd() < (o.lichen ?? 0))
                lichenSpots.push({ p: start, az, L });
        }
        // short inter-whorl boughs keep the cone dense
        if (w < count - 1 && rad > 0.5) {
            const ni = rad > 1.4 ? 3 : 2;
            for (let j = 0; j < ni; j++) {
                const az = rot + 1.2 + (j / ni) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
                const yy = y + o.whorl * (0.4 + 0.2 * rnd());
                const L = rad * 0.62 + 0.1;
                bough(b, {
                    base: new THREE.Vector3(leanAt(yy), yy, 0),
                    az,
                    el: (lerp(-2, 34, fy) - 8 * o.load) * DEG,
                    droop: lerp(30, 12, fy) * DEG,
                    upturn: 10 * DEG,
                    length: L,
                    fold: 30 * DEG,
                    rect: boughB,
                    curtain: null,
                    hang: 0,
                    snow: 1,
                    plaster,
                    stations: 3,
                    ao: 0.8,
                    axisY: H * 0.45,
                    cr,
                }, rnd);
            }
        }
    }
    // beard lichen hanging under some of the lower boughs, close to the trunk
    for (const l of lichenSpots) {
        const dir = new THREE.Vector3(Math.cos(l.az), 0, Math.sin(l.az));
        const pos = l.p.clone().addScaledVector(dir, l.L * (0.15 + rnd() * 0.25)).addScaledVector(UP, -0.05);
        const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
        planeBasis(nrm, 0, _r, _u);
        b.snow = [0, 1];
        const sz = 0.35 + rnd() * 0.3;
        card(b, pos, _r.clone(), UP.clone(), sz, sz * 1.1, lichen, 'top', () => dir.clone().addScaledVector(UP, 0.3).normalize(), () => [0.7, 0.7, 0.7], (p) => [crownBend(cr, p), 0.02, 0, rnd()]);
    }
    // a snow ghost: lumps of rime and wind-packed snow clinging along the boughs, more to the lee
    if (plaster > 0) {
        const lumps = Math.round(count * 3.2);
        for (let i = 0; i < lumps; i++) {
            const f = (i + rnd()) / lumps;
            const y = lerp(0.35, top + 0.04 * H, Math.pow(f, 0.85));
            const fy = y / H;
            const rad = R0 * Math.pow(Math.max(0, 1 - fy), o.profile) + 0.12;
            let az = rnd() * Math.PI * 2;
            az = Math.atan2(Math.sin(az), Math.cos(az) + 0.7 * flag);
            const reach = rad * (0.45 + 0.55 * rnd()) * (0.7 + 0.4 * Math.max(0, Math.cos(az)));
            const c = new THREE.Vector3(leanAt(y) + Math.cos(az) * reach, y - reach * 0.15, Math.sin(az) * reach);
            const sz = (0.1 + 0.14 * rnd()) * Math.max(0.6, rad) + 0.1;
            b.snow = [3, 1];
            b.haze = 0;
            b.ellipsoid(c, new THREE.Vector3(sz * 1.5, sz * 0.62, sz * 1.0), 6, 3, atlas.rect('spruceBough', 60), (p) => {
                const a = crownAO(cr, p, 0.4);
                return [a, a, a];
            }, [crownBend(cr, c), 0, 0, 0], { rot: new THREE.Quaternion().setFromAxisAngle(UP, -az), vMax: 0.75, bump: (dd) => 1 + 0.16 * Math.sin(dd.x * 5 + i) * Math.sin(dd.z * 6 + i * 0.7) });
        }
    }
    // the spire: crossed side-view cards over the leader
    const tip = atlas.rect('spruceTip');
    const ty = top - 0.03 * H;
    const th = H - ty + 0.05;
    const tw = th * 0.5 * (0.9 + 0.2 * rnd());
    for (let k = 0; k < 2; k++) {
        const az = rot + k * (Math.PI / 2) + (rnd() - 0.5) * 0.3;
        const right = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        b.snow = [plaster > 0 ? 1 + plaster : 1, 1];
        card(b, new THREE.Vector3(leanAt(ty), ty, 0), right, UP.clone(), tw, th, tip, 'bottom', (p) => radialOut(p, H * 0.6, new THREE.Vector3()).multiplyScalar(0.7).addScaledVector(UP, 0.5).normalize(), (p) => {
            const a = 0.82 + 0.18 * smooth(p.y, ty, H);
            return [a, a, a];
        }, (p) => [crownBend(cr, p), 0.004, 0, 0.5], k === 1);
    }
    return b;
}
export function birchTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    const H = o.height;
    const cr = { c: new THREE.Vector3(0, H * 0.62, 0), r: new THREE.Vector3(H * 0.38, H * 0.38, H * 0.38), amp: 0.02 * H, height: H };
    const wind = (q) => [crownBend(cr, q), 0, 0, 0];
    const twigRect = atlas.rect(o.twigs);
    const weepRect = atlas.rect('birchWeep');
    const rime = o.rime ?? 0;
    const bark = (q) => {
        // the base darkens where old birch bark cracks
        const k = 0.62 + 0.38 * smooth(q.y, 0, 1.2);
        return [k, k, k];
    };
    const twigCard = (pos, dir, size, weep) => {
        const seedT = rnd();
        b.haze = 1;
        if (weep) {
            // a weeping spray hanging from the limb end
            const out = new THREE.Vector3(dir.x, 0, dir.z).normalize();
            const right = new THREE.Vector3(-out.z, 0, out.x).applyAxisAngle(UP, (rnd() - 0.5) * 1.2);
            b.snow = [rime > 0 ? 1 + rime : 1, 1];
            card(b, pos, right, UP.clone(), size, size, weepRect, 'top', (p) => _n.subVectors(p, cr.c).normalize().addScaledVector(UP, 0.3).normalize().clone(), (p) => {
                const a = crownAO(cr, p, 0.3);
                return [a, a, a];
            }, (p) => [crownBend(cr, p), 0.03, 0, seedT]);
            return;
        }
        const up = dir.clone().addScaledVector(UP, 0.35).normalize();
        const spin = rnd() * Math.PI;
        const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin))).normalize();
        if (right.lengthSq() < 0.1)
            right.set(1, 0, 0);
        b.snow = [rime > 0 ? 1 + rime : 1, 1];
        card(b, pos.clone().addScaledVector(up, -0.05), right, up, size * (0.85 + rnd() * 0.3), size, twigRect, 'bottom', (p) => new THREE.Vector3().subVectors(p, cr.c).normalize().multiplyScalar(0.7).addScaledVector(UP, 0.35).normalize(), (p) => {
            const a = crownAO(cr, p, 0.35);
            return [a, a * 0.98, a * 0.97];
        }, (p) => [crownBend(cr, p), 0.025, 0, seedT], rnd() < 0.5);
    };
    const base = new THREE.Vector3(0, -0.35, 0);
    for (let s = 0; s < o.stems; s++) {
        const main = s === 0;
        const az = (s / o.stems) * Math.PI * 2 + rnd() * 0.9;
        const tilt = main ? o.lean * 0.3 * rnd() : o.lean * (0.6 + 0.6 * rnd());
        const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
        const L = H * (main ? 0.98 : 0.68 + 0.26 * rnd());
        const sr = (0.05 + 0.012 * H) * (main ? 1.1 : 0.85) * (o.stems > 2 ? 0.85 : 1);
        const start = base.clone().add(new THREE.Vector3(Math.cos(az) * 0.08 * s, 0, Math.sin(az) * 0.08 * s));
        // stems leave the base leaning and turn up toward the light, crooked from old snow breaks
        const stem = growLimb(start, dir, L, sr, sr * 0.2, 9, rnd, (t) => (t < 0.5 ? 0.08 * tilt * 6 : 0.02) / Math.max(1, H * 0.15), o.crook * 0.32);
        barkTube(b, atlas, o.bark, stem, 6, 1.4, rnd, bark, wind, 0.55, (i, a) => 1 + (i === 0 ? 0.15 * Math.sin(3 * a + s) : 0.04 * Math.sin(2 * a + i)));
        // limbs in the upper part of each stem
        const nl = Math.max(2, Math.round(o.limbs * (main ? 1 : 0.75)));
        for (let k = 0; k < nl; k++) {
            const t = 0.38 + 0.58 * ((k + rnd() * 0.7) / nl);
            const at = new THREE.Vector3();
            const sd = new THREE.Vector3();
            along(stem.pts, t, at, sd);
            const laz = az + k * 2.4 + (rnd() - 0.5) * 0.8;
            const out = new THREE.Vector3(Math.cos(laz), 0, Math.sin(laz));
            const ldir = sd.clone().multiplyScalar(0.55).addScaledVector(out, 0.75 + 0.2 * rnd()).normalize();
            const ll = H * (0.2 + 0.18 * rnd()) * (1.15 - 0.5 * t);
            const rb = sr * (1 - 0.75 * t) * 0.55 + 0.012;
            const limb = growLimb(at, ldir, ll, rb, 0.012, 4, rnd, (u) => (u < 0.6 ? 0.06 : -0.02 * (o.weep ?? 0) * 6), o.crook * 0.3);
            barkTube(b, atlas, rb > 0.035 ? o.bark : 'twig', limb, 4, 1.0, rnd, bark, wind, 1);
            const tsz = (0.8 + 0.6 * (ll / H) * 3) * o.twigScale;
            twigCard(limb.tip, limb.dir, tsz, (o.weep ?? 0) > rnd());
            // sprays along the limb too, so the crown has body between the limb ends
            for (const u of [0.45, 0.72]) {
                const ap = new THREE.Vector3();
                const ad = new THREE.Vector3();
                along(limb.pts, u, ap, ad);
                const sideDir = ad.clone().applyAxisAngle(UP, (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.6 * rnd())).addScaledVector(UP, 0.3).normalize();
                twigCard(ap, sideDir, tsz * (0.6 + 0.2 * rnd()), (o.weep ?? 0) * 0.5 > rnd());
            }
            // side twigs: thin sub-limbs, each ending in a spray
            const subs = 1 + Math.floor(rnd() * 2.5);
            for (let j = 0; j < subs; j++) {
                const sp = new THREE.Vector3();
                const sdir = new THREE.Vector3();
                along(limb.pts, 0.35 + 0.5 * rnd(), sp, sdir);
                const side = (j % 2 ? 1 : -1) * (0.5 + 0.5 * rnd());
                const d2 = sdir.clone().applyAxisAngle(UP, side).addScaledVector(UP, 0.35).normalize();
                const sl = ll * (0.35 + 0.25 * rnd());
                const sub = growLimb(sp, d2, sl, rb * 0.45 + 0.006, 0.006, 2, rnd, () => 0.05, 0.2);
                barkTube(b, atlas, 'twig', sub, 3, 0.8, rnd, bark, wind, 1);
                twigCard(sub.tip, sub.dir, tsz * (0.7 + 0.2 * rnd()), (o.weep ?? 0) * 0.6 > rnd());
            }
        }
        // the stem's own leader ends in a twig fan
        twigCard(stem.tip, stem.dir, (0.9 + 0.3 * rnd()) * o.twigScale, false);
    }
    // a few fans filling the crown between the limbs
    const dir = new THREE.Vector3();
    for (let i = 0; i < Math.round(H * 2); i++) {
        randomDir(rnd, dir, 0.5);
        const p = cr.c.clone().add(new THREE.Vector3(dir.x * cr.r.x * 0.75, dir.y * cr.r.y * 0.55, dir.z * cr.r.z * 0.75));
        twigCard(p, dir.clone().addScaledVector(UP, 0.4).normalize(), (0.9 + 0.4 * rnd()) * o.twigScale, false);
    }
    return b;
}
/** Rowan in winter: a grey-barked small tree, ascending limbs, red berry clusters under caps of snow. */
export function rowanTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    const H = o.height;
    const cr = { c: new THREE.Vector3(0, H * 0.66, 0), r: new THREE.Vector3(H * 0.36, H * 0.32, H * 0.36), amp: 0.018 * H, height: H };
    const wind = (q) => [crownBend(cr, q), 0, 0, 0];
    const twigRect = atlas.rect('rowanTwigs');
    const berryRect = atlas.rect('rowanBerries');
    const bark = (q) => {
        const k = 0.72 + 0.28 * smooth(q.y, 0, 1.5);
        return [k, k, k];
    };
    const tips = [];
    for (let s = 0; s < o.stems; s++) {
        const az = (s / o.stems) * Math.PI * 2 + rnd();
        const tilt = s === 0 ? 0.06 : 0.25 + 0.15 * rnd();
        const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
        const sr = 0.07 + 0.012 * H;
        const stem = growLimb(new THREE.Vector3(Math.cos(az) * 0.06 * s, -0.35, Math.sin(az) * 0.06 * s), dir, H * (s === 0 ? 0.62 : 0.5), sr, sr * 0.45, 5, rnd, () => 0.02, 0.06);
        barkTube(b, atlas, 'rowan', stem, 7, 1.3, rnd, bark, wind, 0.6);
        const nl = 5;
        for (let k = 0; k < nl; k++) {
            const at = new THREE.Vector3();
            along(stem.pts, 0.55 + 0.45 * (k / nl), at);
            const laz = az + k * 2.4 + rnd() * 0.5;
            const ldir = new THREE.Vector3(Math.cos(laz) * 0.62, 0.78, Math.sin(laz) * 0.62).normalize();
            const ll = H * (0.32 + 0.12 * rnd());
            const limb = growLimb(at, ldir, ll, sr * 0.42, 0.018, 4, rnd, () => 0.04, 0.12);
            barkTube(b, atlas, 'rowan', limb, 5, 1.0, rnd, bark, wind, 1);
            tips.push({ p: limb.tip, d: limb.dir });
            for (let j = 0; j < 2; j++) {
                const sp = new THREE.Vector3();
                const sd = new THREE.Vector3();
                along(limb.pts, 0.45 + 0.4 * rnd(), sp, sd);
                const d2 = sd.clone().applyAxisAngle(UP, (j ? 1 : -1) * (0.6 + 0.4 * rnd())).addScaledVector(UP, 0.2).normalize();
                const sub = growLimb(sp, d2, ll * (0.4 + 0.2 * rnd()), sr * 0.18, 0.01, 2, rnd, () => 0.04, 0.15);
                barkTube(b, atlas, 'twig', sub, 3, 0.8, rnd, bark, wind, 1);
                tips.push({ p: sub.tip, d: sub.dir });
            }
        }
    }
    for (const t of tips) {
        const up = t.d.clone().addScaledVector(UP, 0.4).normalize();
        const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(Math.cos(rnd() * 6.3), 0, Math.sin(rnd() * 6.3))).normalize();
        b.snow = [0.8, 1];
        b.haze = 1;
        const sz = (1.1 + 0.4 * rnd()) * (H / 7);
        card(b, t.p, right, up, sz, sz, twigRect, 'bottom', (p) => new THREE.Vector3().subVectors(p, cr.c).normalize().addScaledVector(UP, 0.4).normalize(), (p) => {
            const a = crownAO(cr, p, 0.3);
            return [a, a, a];
        }, (p) => [crownBend(cr, p), 0.02, 0, rnd()]);
    }
    // berry clusters hanging from the twig ends all through the crown
    for (let i = 0; i < o.berries; i++) {
        const t = tips[Math.floor(rnd() * tips.length)];
        const pos = t.p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.9, -0.1 - rnd() * 0.5, (rnd() - 0.5) * 0.9));
        const az = rnd() * Math.PI * 2;
        const right = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const sz = 0.4 + 0.16 * rnd();
        b.snow = [1, 1];
        b.haze = 0;
        for (let k = 0; k < 2; k++) {
            const r = k === 0 ? right : new THREE.Vector3(-right.z, 0, right.x);
            card(b, pos, r, UP.clone(), sz, sz, berryRect, 'top', (p) => new THREE.Vector3().subVectors(p, cr.c).normalize().addScaledVector(UP, 0.3).normalize(), () => [1, 1, 1], (p) => [crownBend(cr, p), 0.015, 0, 0.3]);
        }
    }
    return b;
}
/* ------------------------------------------------------------------ */
/* Dwarf shrubs, herbs, grass                                          */
/* ------------------------------------------------------------------ */
/**
 * A juniper mound under the snow: a snow-covered dome with dark sprigs poking
 * out round its foot and through its sides.
 */
export function juniperTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    const rect = atlas.rect('juniper');
    const H = o.height;
    const R = o.width * 0.5;
    // the snow dome (fully plastered; a few needles show at its rim through the shader's rime mix)
    const inner = atlas.rect('juniper', 40);
    b.snow = [3, 1];
    b.haze = 0;
    b.ellipsoid(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(R * 0.82, H * 0.82, R * 0.72), 9, 3, inner, (p) => {
        const a = 0.82 + 0.18 * clamp(p.y / H, 0, 1);
        return [a, a, a];
    }, [0, 0, 0, 0], { vMax: 0.5, rot: new THREE.Quaternion().setFromAxisAngle(UP, rnd() * Math.PI), bump: (d) => 1 + 0.08 * Math.sin(d.x * 5 + seed) * Math.sin(d.z * 4 + seed * 0.7) });
    const shade = (q) => {
        const a = 0.5 + 0.5 * smooth(q.y, -0.1, H);
        return [a, a, a];
    };
    const nrm = (q) => new THREE.Vector3(q.x, (q.y - H * 0.2) * 1.4, q.z).normalize().addScaledVector(UP, 0.35).normalize();
    // sprigs leaning out of the drift all round
    const ring = 9;
    for (let i = 0; i < ring; i++) {
        const az = (i / ring) * Math.PI * 2 + rnd() * 0.5;
        const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const n = out.clone().addScaledVector(UP, 0.7).normalize();
        planeBasis(n, (rnd() - 0.5) * 0.8, _r, _u);
        b.snow = [0.6, 0];
        const sz = o.width * (0.42 + 0.14 * rnd());
        const rr = R * (0.7 + 0.25 * rnd());
        b.card(out.clone().multiplyScalar(rr).add(new THREE.Vector3(0, H * (0.15 + 0.25 * rnd()), 0)), _r.clone(), _u.clone(), sz, sz * 0.8, rect, nrm, shade, () => [0.01, 0.004, 0, rnd()], false, rnd() < 0.5);
    }
    return b;
}
export function dwarfBirchTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    b.snow = [0.8, 1];
    b.haze = 1;
    crossed(b, atlas.rect('dwarfBirch'), 3, o.height * 1.15, o.height, rnd, 0.05, [0.6, 1]);
    return b;
}
export function stalksTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    b.snow = [0.9, 1];
    crossed(b, atlas.rect('stalks'), 3, o.height * 0.72, o.height, rnd, 0.12, [0.65, 1]);
    return b;
}
export function lymeTemplate(atlas, seed, o) {
    const rnd = mulberry32(seed);
    const b = new MeshBuilder();
    b.snow = [0.5, 1];
    crossed(b, atlas.rect('lyme'), 4, o.height * 1.15, o.height, rnd, 0.16, [0.55, 1]);
    return b;
}
