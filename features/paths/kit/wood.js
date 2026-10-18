/**
 * Logs: driftwood, log steps, split-log benches. A tapered, gently bent,
 * knobbly tube with capped ends and meter UVs (grain along U).
 */
import * as THREE from 'three';
import { mulberry32 } from '../../../world/noise.js';
import { noise3 } from './rocks.js';
/** Log along +x from (0,0,0) to (length,0,0); y up. */
export function logGeometry(seed, o) {
    const rnd = mulberry32(seed);
    const radial = o.radial ?? 9;
    const segs = o.segments ?? Math.max(4, Math.round(o.length / 0.35));
    const knobs = o.knobs ?? 0.12;
    const flare = o.flare ?? 0;
    const checks = o.checks ?? 0;
    const nChecks = 4 + Math.floor(rnd() * 3);
    const twist = (rnd() - 0.5) * 0.6;
    const ns = rnd() * 50;
    const pos = [];
    const uv = [];
    const idx = [];
    /** per-vertex check depth 0..1, index-aligned, for darkening the cracks */
    const checkOf = [];
    const rAvg = (o.r0 + o.r1) / 2;
    const ring = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const cx = t * o.length;
        const bell = 4 * t * (1 - t);
        const cz = (o.bend ?? 0) * bell;
        const cy = (o.bow ?? 0) * bell;
        let r = o.r0 + (o.r1 - o.r0) * t;
        r *= 1 + flare * Math.exp((-t * o.length) / Math.max(0.15, o.r0 * 1.6));
        const row = [];
        for (let k = 0; k <= radial; k++) {
            const th = (k / radial) * Math.PI * 2;
            const c = Math.cos(th);
            const s = Math.sin(th);
            let kn = 1 + knobs * noise3(cx * 2.1 + ns, c * 1.3, s * 1.3) + knobs * 0.5 * noise3(cx * 6 + ns, c * 2.6, s * 2.6);
            let ck = 0;
            if (checks > 0) {
                const ph = th * nChecks + cx * twist + 1.2 * noise3(cx * 0.7 + ns, c * 0.8, s * 0.8);
                ck = Math.pow(0.5 + 0.5 * Math.cos(ph), 10) * (0.6 + 0.4 * noise3(cx * 1.7 + ns, c, s));
                kn *= 1 - checks * Math.max(0, ck);
            }
            checkOf.push(Math.max(0, ck));
            let oy = c * r * kn;
            let oz = s * r * kn;
            if (o.flatTop != null && oy > r * o.flatTop)
                oy = r * o.flatTop;
            if (o.flatBottom != null && oy < -r * o.flatBottom)
                oy = -r * o.flatBottom;
            row.push(new THREE.Vector3(cx, cy + oy, cz + oz));
            pos.push(cx, cy + oy, cz + oz);
            uv.push(cx, th * rAvg);
        }
        ring.push(row);
    }
    for (let i = 0; i < segs; i++) {
        for (let k = 0; k < radial; k++) {
            const a = i * (radial + 1) + k;
            const b = a + radial + 1;
            idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    // end caps (own vertices so the rim stays crisp)
    for (const end of [0, segs]) {
        const row = ring[end];
        const base = pos.length / 3;
        const c = row.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / row.length);
        const rEnd = end === 0 ? o.r0 : o.r1;
        const tip = (o.splinter ?? 0) * rEnd * (0.5 + rnd());
        pos.push(c.x + (end === 0 ? -tip : tip), c.y + (rnd() - 0.5) * tip * 0.6, c.z + (rnd() - 0.5) * tip * 0.6);
        uv.push(0, 0);
        checkOf.push(tip > 0 ? 0.5 : 0);
        for (let k = 0; k <= radial; k++) {
            pos.push(row[k].x, row[k].y, row[k].z);
            uv.push((row[k].z - c.z) * 1.0, (row[k].y - c.y) * 1.0);
            checkOf.push(0);
        }
        for (let k = 0; k < radial; k++) {
            if (end === 0)
                idx.push(base, base + 1 + k, base + 2 + k);
            else
                idx.push(base, base + 2 + k, base + 1 + k);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.checks = new Float32Array(checkOf);
    return g;
}
/** Orient a +x log geometry (built with length |b − a|) from a toward b, rolled by `roll` radians about its axis. */
export function placeLog(g, a, b, roll = 0) {
    const X = b.clone().sub(a).normalize();
    const Y = new THREE.Vector3(0, 1, 0).addScaledVector(X, -X.y);
    if (Y.lengthSq() < 1e-6)
        Y.set(1, 0, 0);
    Y.normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(roll));
    g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a));
    return g;
}
