/**
 * Soft-furnishing geometry for the cabin interior: pillowy boxes for
 * cushions, mattresses and seats; cloth draped along a cross-section (throws
 * over a sofa arm, duvets over a bed, a sheepskin over a chair back) with
 * folds where it hangs; flat outlines lifted into a soft relief (hides,
 * rugs); small lathe and tube helpers. Everything is in metres with metre
 * UVs unless noted, ready for the house kit's Batch.
 */
import * as THREE from 'three';
import { applyBoxUV } from '../../core/geometry.js';
import { mulberry32 } from '../../world/noise.js';
/**
 * A soft box (cushion, mattress, seat pad) centred on the origin: a rounded
 * box whose faces dome outward like a stuffed cover, optionally sagging
 * where it was sat on. Smooth normals across the rounded edges.
 */
export function softBox(w, h, d, o = {}) {
    const r = Math.min(o.r ?? Math.min(w, h, d) * 0.3, Math.min(w, h, d) / 2 - 1e-3);
    const dens = o.density ?? 13;
    const sx = Math.max(4, Math.round(w * dens));
    const sy = Math.max(3, Math.round(h * dens * 1.3));
    const sz = Math.max(4, Math.round(d * dens));
    const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const pos = g.getAttribute('position');
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const ex = hw - r;
    const ey = hh - r;
    const ez = hd - r;
    const rnd = mulberry32(o.seed ?? 7);
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        c.set(THREE.MathUtils.clamp(v.x, -ex, ex), THREE.MathUtils.clamp(v.y, -ey, ey), THREE.MathUtils.clamp(v.z, -ez, ez));
        n.subVectors(v, c);
        if (n.lengthSq() < 1e-12)
            n.set(0, Math.sign(v.y) || 1, 0);
        n.normalize();
        v.copy(c).addScaledVector(n, r);
        const fx = Math.max(0, 1 - (v.x / hw) ** 2);
        const fy = Math.max(0, 1 - (v.y / hh) ** 2);
        const fz = Math.max(0, 1 - (v.z / hd) ** 2);
        // stuffed faces dome out
        if (o.bulge)
            v.y += Math.sign(n.y) * o.bulge * fx * fz * Math.abs(n.y) * (n.y > 0 ? 1 : 0.35);
        if (o.side) {
            v.x += n.x * o.side * fy * fz;
            v.z += n.z * o.side * fy * fx;
        }
        if (o.sag && n.y > 0.2) {
            const dx = (v.x - (o.dent?.[0] ?? 0)) / (hw * 0.75);
            const dz = (v.z - (o.dent?.[1] ?? 0)) / (hd * 0.75);
            v.y -= o.sag * Math.exp(-(dx * dx + dz * dz) * 1.6) * n.y;
        }
        if (o.wrinkle) {
            const k = o.wrinkle;
            let wob = Math.sin(v.x * 23 + ph[0]) * Math.sin(v.z * 19 + ph[1]) * 0.5 + Math.sin((v.x + v.z) * 41 + ph[2]) * 0.25 + Math.sin(v.y * 37 + v.x * 13 + ph[3]) * 0.25;
            if (o.channels && n.y > 0.3)
                wob += -Math.abs(Math.cos(((v.x + hw) / w) * Math.PI * o.channels)) * 2.5 + 1.2;
            // creases gather toward the edges of a cover
            const edge = 1 - fx * fz * 0.6;
            v.addScaledVector(n, wob * k * edge);
        }
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    weldNormals(g);
    return applyBoxUV(g);
}
/**
 * Average the normals of vertices that share a position (the seams between a
 * BoxGeometry's faces), so a soft box shades smoothly across its rounded
 * edges. A numeric spatial hash: much cheaper than re-indexing.
 */
export function weldNormals(g) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const map = new Map();
    const q = 1e4;
    for (let i = 0; i < pos.count; i++) {
        // exact packing of three 17-bit quantised coordinates (|coord| < 6.5 m) into one float64
        const key = ((Math.round(pos.getX(i) * q) + 65536) * 131072 + (Math.round(pos.getY(i) * q) + 65536)) * 131072 + (Math.round(pos.getZ(i) * q) + 65536);
        const list = map.get(key);
        if (list)
            list.push(i);
        else
            map.set(key, [i]);
    }
    for (const list of map.values()) {
        if (list.length < 2)
            continue;
        let x = 0;
        let y = 0;
        let z = 0;
        for (const i of list) {
            x += nor.getX(i);
            y += nor.getY(i);
            z += nor.getZ(i);
        }
        const l = Math.hypot(x, y, z);
        if (l < 1e-6)
            continue;
        for (const i of list)
            nor.setXYZ(i, x / l, y / l, z / l);
    }
    nor.needsUpdate = true;
}
/* ------------------------------------------------------------------ */
/* Cloth along a profile                                               */
/* ------------------------------------------------------------------ */
/** Chaikin corner cutting: rounds a polyline's corners (keeps the end points). */
export function chaikin(pts, iterations = 2, k = 0.25) {
    let p = pts;
    for (let it = 0; it < iterations; it++) {
        const q = [p[0]];
        for (let i = 0; i < p.length - 1; i++) {
            const [ax, ay] = p[i];
            const [bx, by] = p[i + 1];
            q.push([ax + (bx - ax) * k, ay + (by - ay) * k], [ax + (bx - ax) * (1 - k), ay + (by - ay) * (1 - k)]);
        }
        q.push(p[p.length - 1]);
        p = q;
    }
    return p;
}
/** Resample a polyline to points `step` apart (by arc length); returns points and their arc lengths. */
export function resample(pts, step) {
    const seg = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        seg.push(l);
        total += l;
    }
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const p = [];
    const s = [];
    let j = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * total;
        while (j < seg.length - 1 && acc + seg[j] < t)
            acc += seg[j++];
        const f = seg[j] > 0 ? (t - acc) / seg[j] : 0;
        p.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
        s.push(t);
    }
    return { p, s };
}
/**
 * Cloth whose cross-section follows `profile` ([x, y] points across the
 * piece, in order) and which runs `length` metres along z (centred). The
 * profile is the surface it rests on (already offset for the cloth's
 * thickness); hanging parts fall into folds that ripple along z. UVs: u =
 * arc length across (m), v = z (m), so woven patterns run true.
 */
export function drape(profile, length, o = {}) {
    const dens = o.density ?? 22;
    const prof = resample(chaikin(profile, o.round ?? 2), 1 / dens);
    const P = prof.p;
    const S = prof.s;
    const L = S[S.length - 1];
    const nz = Math.max(3, Math.round(length * dens));
    const rnd = mulberry32(o.seed ?? 3);
    const ph = Array.from({ length: 6 }, () => rnd() * 6.283);
    const freq = o.freq ?? 6;
    const folds = o.folds ?? 0.02;
    // profile normals (pointing "up/out" = left of the direction of travel)
    const N = P.map((_, i) => {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(P.length - 1, i + 1)];
        const tx = b[0] - a[0];
        const ty = b[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        // left normal of the travel direction; flipped so it points up on flat parts
        let nx = -ty / l;
        let ny = tx / l;
        if (ny < 0 || (Math.abs(ny) < 1e-3 && nx * (P[i][0] - P[0][0]) < 0)) {
            nx = -nx;
            ny = -ny;
        }
        return [nx, ny];
    });
    const layers = o.thick ? 2 : 1;
    const pos = [];
    const uv = [];
    const idx = [];
    const cols = P.length;
    for (let layer = 0; layer < layers; layer++) {
        const base = pos.length / 3;
        for (let k = 0; k <= nz; k++) {
            const t = k / nz;
            for (let i = 0; i < cols; i++) {
                const [f0, f1] = o.shape ? o.shape(S[i] / L) : [-0.5, 0.5];
                const z = (f0 + (f1 - f0) * t) * length;
                const [px, py] = P[i];
                const [nx, ny] = N[i];
                const s = S[i];
                // hanging-ness: 1 where the cloth falls vertically, 0 on flat tops
                const hang = 1 - Math.abs(ny);
                // distance down the hang from where it left the support (folds grow toward the hem)
                const endW = Math.min(s, L - s);
                const grow = THREE.MathUtils.smoothstep(endW, 0.0, 0.5) * 0.5 + 0.5;
                const fold = Math.sin(z * freq * 6.283 * 0.5 + ph[0] + s * 1.3) * 0.6 +
                    Math.sin(z * freq * 6.283 * 0.93 + ph[1] - s * 2.1) * 0.3 +
                    Math.sin(z * freq * 6.283 * 1.9 + ph[2]) * 0.1;
                let off = fold * folds * (0.25 + 0.75 * hang) * (2 - grow);
                // puff over flat tops, rounding off toward the ends
                if (o.puff)
                    off += o.puff * (1 - hang) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 6)) * Math.min(1, endW / 0.12);
                if (o.quilt)
                    off -= o.quilt * (1 - hang) * Math.pow(Math.abs(Math.cos(z * (o.quiltFreq ?? 4) * Math.PI)), 6);
                // the hem at each end of the profile wanders
                const hem = (o.hem ?? 0) * Math.exp(-endW / 0.08) * Math.sin(z * 9 + ph[3] + (s < L / 2 ? 0 : 2));
                if (o.fleece && layer === 0) {
                    // distance (m) to the piece's outline, across and along
                    const zA = (z - f0 * length);
                    const zB = (f1 * length - z);
                    const edge = Math.min(endW, zA, zB);
                    const roll = THREE.MathUtils.smoothstep(edge, 0.0, 0.07);
                    // locks: lumps of fleece a few centimetres across, clumping into bigger tufts
                    const l1 = Math.sin(s * 83 + ph[0]) * Math.sin(z * 79 + ph[1]);
                    const l2 = Math.sin((s - z) * 37 + ph[5]) * Math.sin((s + z) * 41 + ph[2]);
                    const locks = 0.6 + 0.28 * l1 * l1 * Math.sign(l1) + 0.22 * l2;
                    off += o.fleece * (0.25 + 0.75 * roll) * locks;
                }
                let x = px + nx * off + hem * (s < L / 2 ? -1 : 1) * Math.abs(ny) * 0.3;
                let y = py + ny * off - Math.abs(hem) * hang * 0.6;
                // the ends along z sag a little where they hang
                const zEnd = Math.min(t, 1 - t);
                y -= hang * 0.015 * Math.exp(-zEnd * length / 0.05);
                if (layer === 1) {
                    x -= nx * (o.thick ?? 0);
                    y -= ny * (o.thick ?? 0);
                }
                pos.push(x, y, z + Math.sin(s * 5 + ph[4]) * 0.004 * hang);
                if (o.unitUV)
                    uv.push(s / L, z / length + 0.5);
                else
                    uv.push(s, z);
            }
        }
        for (let k = 0; k < nz; k++) {
            for (let i = 0; i < cols - 1; i++) {
                const a = base + k * cols + i;
                const b = a + cols;
                if (layer === 0)
                    idx.push(a, b, a + 1, a + 1, b, b + 1);
                else
                    idx.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    }
    if (layers === 2) {
        // close the edges along the length so the thickness shows at the hems
        const top = 0;
        const bot = (nz + 1) * cols;
        for (const i of [0, cols - 1]) {
            for (let k = 0; k < nz; k++) {
                const a = top + k * cols + i;
                const b = top + (k + 1) * cols + i;
                const c2 = bot + k * cols + i;
                const d = bot + (k + 1) * cols + i;
                if (i === 0)
                    idx.push(a, c2, b, b, c2, d);
                else
                    idx.push(a, b, c2, b, d, c2);
            }
        }
        for (const k of [0, nz]) {
            for (let i = 0; i < cols - 1; i++) {
                const a = top + k * cols + i;
                const b = a + 1;
                const c2 = bot + k * cols + i;
                const d = c2 + 1;
                if (k === 0)
                    idx.push(a, b, c2, b, d, c2);
                else
                    idx.push(a, c2, b, b, c2, d);
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}
/* ------------------------------------------------------------------ */
/* Flat outlines with relief                                           */
/* ------------------------------------------------------------------ */
/**
 * A flat piece (hide, sheepskin, rug) from an outline polygon in the xz
 * plane: triangulated on a fine grid inside the outline, lifted to `height`
 * in the middle and rolling down to ~0 at the edge over `edge` metres.
 * UVs: the outline's bounding box mapped to 0..1 (for a painted map), and
 * `uv1` in metres. `lump` adds soft unevenness (fur tufts).
 */
export function reliefPiece(outline, o) {
    // rings: the outline scaled toward its centroid (fine for the near star-shaped outlines of hides and fleeces)
    const step = o.step ?? 0.03;
    let cx = 0;
    let cz = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of outline) {
        cx += x / outline.length;
        cz += z / outline.length;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    // resample the outline to about `step` spacing
    const closed = [...outline, outline[0]];
    const ring = resample(closed, step).p.slice(0, -1);
    const N = ring.length;
    const maxR = Math.max(...ring.map(([x, z]) => Math.hypot(x - cx, z - cz)));
    const K = Math.max(3, Math.ceil(maxR / step));
    const rnd = mulberry32(o.seed ?? 5);
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const pos = [];
    const uv = [];
    const idx = [];
    // centre vertex, then rings k = 1..K (k = K is the outline)
    const hAt = (x, z, e) => {
        const ek = THREE.MathUtils.smoothstep(e, 0, o.edge);
        const lump = (o.lump ?? 0) * (Math.sin(x * 31 + ph[0]) * Math.sin(z * 27 + ph[1]) + 0.5 * Math.sin((x - z) * 53 + ph[2]));
        return o.height * (0.15 + 0.85 * Math.sqrt(ek)) + lump * ek;
    };
    pos.push(cx, hAt(cx, cz, maxR), cz);
    uv.push((cx - minX) / (maxX - minX), 1 - (cz - minZ) / (maxZ - minZ));
    for (let k = 1; k <= K; k++) {
        const f = k / K;
        for (let i = 0; i < N; i++) {
            const [ox, oz] = ring[i];
            const x = cx + (ox - cx) * f;
            const z = cz + (oz - cz) * f;
            const e = (1 - f) * Math.hypot(ox - cx, oz - cz);
            pos.push(x, hAt(x, z, e), z);
            uv.push((x - minX) / (maxX - minX), 1 - (z - minZ) / (maxZ - minZ));
        }
    }
    for (let i = 0; i < N; i++)
        idx.push(0, 1 + i, 1 + ((i + 1) % N));
    for (let k = 1; k < K; k++) {
        const a0 = 1 + (k - 1) * N;
        const b0 = 1 + k * N;
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            idx.push(a0 + i, b0 + i, b0 + j, a0 + i, b0 + j, a0 + j);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure it faces up
    const n = g.getAttribute('normal');
    let sum = 0;
    for (let i = 0; i < n.count; i++)
        sum += n.getY(i);
    if (sum < 0) {
        for (let i = 0; i < idx.length; i += 3) {
            const t = idx[i + 1];
            idx[i + 1] = idx[i + 2];
            idx[i + 2] = t;
        }
        g.setIndex(idx);
        g.computeVertexNormals();
    }
    return g;
}
/* ------------------------------------------------------------------ */
/* Small solids                                                        */
/* ------------------------------------------------------------------ */
/** A lathe from [radius, y] pairs with metre UVs (u round the rim, v up), smooth normals. */
export function turned(profile, segments = 24) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
    const g = new THREE.LatheGeometry(pts, segments);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const maxR = Math.max(...profile.map((p) => p[0]), 0.01);
    for (let i = 0; i < pos.count; i++)
        uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR, pos.getY(i));
    // three's lathe leaves the last ring's normals unnormalised (scaled by the last segment's length)
    const nor = g.getAttribute('normal');
    const v = new THREE.Vector3();
    for (let i = 0; i < nor.count; i++) {
        v.fromBufferAttribute(nor, i);
        const l = v.length();
        if (l > 1e-8)
            nor.setXYZ(i, v.x / l, v.y / l, v.z / l);
        else
            nor.setXYZ(i, 0, Math.sign(pos.getY(i)) || 1, 0);
    }
    return g;
}
/** A round rod from a to b (radius r), metre UVs along it. */
export function rod(a, b, r, segments = 8, r1 = r) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1, r, len, segments, 1, false);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * len);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
}
/** A tube along a smooth curve through `pts` (radius r): handles, flues, ski pole straps. */
export function tube(pts, r, segments = 24, radial = 6, closed = false) {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.3);
    const g = new THREE.TubeGeometry(curve, segments, r, radial, closed);
    const uv = g.getAttribute('uv');
    const len = curve.getLength();
    for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * len, uv.getY(i) * Math.PI * 2 * r);
    return g;
}
/** Apply a transform (position, Y rotation, optional uniform scale) to a geometry and return it. */
export function place(g, x, y, z, rotY = 0, rotX = 0, rotZ = 0) {
    if (rotX)
        g.rotateX(rotX);
    if (rotZ)
        g.rotateZ(rotZ);
    if (rotY)
        g.rotateY(rotY);
    g.translate(x, y, z);
    return g;
}
/** A log (cylinder with slightly irregular section and end checks) lying along x, centred. */
export function logGeometry(len, r, seed = 1, radial = 9) {
    const g = new THREE.CylinderGeometry(r, r, len, radial, 4, false);
    g.rotateZ(Math.PI / 2);
    const pos = g.getAttribute('position');
    const rnd = mulberry32(seed);
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const a = Math.atan2(v.z, v.y);
        const k = 1 + 0.08 * Math.sin(a * 2 + ph[0]) + 0.05 * Math.sin(a * 3 + ph[1] + v.x * 4) + 0.03 * Math.sin(v.x * 9 + ph[2]);
        v.y *= k;
        v.z *= k;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return applyBoxUV(g, { grain: 'x' });
}
