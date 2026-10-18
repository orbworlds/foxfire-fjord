/**
 * Small geometry kit for Aurora Cabin: metre-UV boxes in house-local space,
 * flat faces with holes mapped onto any plane (wall cladding round windows),
 * slabs lifted from a plan polygon onto height functions (roof planes, the
 * deck's snow), and a Batch that merges everything sharing a material into a
 * single mesh while remembering which triangles belong to which part (so one
 * mesh can still answer "what did I click?").
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyBoxUV } from '../../core/geometry.js';
/**
 * Axis-aligned box from min/max corners (house-local). UVs are box-projected
 * in metres after placement, plus an optional offset so neighbouring members
 * do not share identical grain.
 */
export function boxMinMax(x0, y0, z0, x1, y1, z1, grain, uvOffset = [0, 0]) {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const longest = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
    return applyBoxUV(g, { grain: grain ?? longest, offset: uvOffset });
}
/**
 * A box spanning from a to b along its length, with width `w` (horizontal,
 * square to a-b) and depth `h` (in the vertical plane through a-b). Grain runs
 * along the length. Used for rafters, purlins, braces and battens.
 */
export function member(a, b, w, h, up = new THREE.Vector3(0, 1, 0)) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(len, h, w);
    applyBoxUV(g, { grain: 'x' });
    const X = b.clone().sub(a).normalize();
    const Y = up.clone().addScaledVector(X, -up.dot(X));
    if (Y.lengthSq() < 1e-8)
        Y.set(1, 0, 0).addScaledVector(X, -X.x);
    Y.normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a.clone().add(b).multiplyScalar(0.5)));
    return g;
}
/**
 * A flat face on the plane O + U·a + V·b (U, V orthonormal; the face looks
 * along U × V), from a 2D contour with optional holes, in (a, b) coordinates.
 * UVs: box-projected metres with the chosen grain.
 */
export function planeFace(O, U, V, contour, holes = [], grain = 'y') {
    const shape = new THREE.Shape(contour.map(([a, b]) => new THREE.Vector2(a, b)));
    for (const h of holes)
        shape.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
    const g = new THREE.ShapeGeometry(shape);
    const N = new THREE.Vector3().crossVectors(U, V).normalize();
    g.applyMatrix4(new THREE.Matrix4().makeBasis(U, V, N).setPosition(O));
    g.deleteAttribute('uv');
    return applyBoxUV(g, { grain });
}
/** A quad a-b-c-d (counter-clockwise seen from the front), metre UVs. */
export function quad(a, b, c, d, grain = 'y') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return applyBoxUV(g, { grain });
}
/**
 * A slab lifted from a plan polygon (x, z; any winding): the top face at
 * `top(x, z)`, the bottom face at `bot(x, z)` (both must be planar over the
 * polygon for flat faces), and the side faces for the edges whose index is in
 * `sides` (edge i runs from point i to point i + 1). Returns separate
 * geometries so they can take different materials.
 */
export function slab(plan, top, bot, sides = 'all', grain = 'x') {
    // counter-clockwise in (x, -z) = seen from above with +x right and -z up
    let pts = plan.slice();
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[(i + 1) % pts.length];
        area += x0 * -z1 - x1 * -z0;
    }
    let edgeMap = pts.map((_, i) => i);
    if (area < 0) {
        pts = pts.slice().reverse();
        const n = pts.length;
        // reversed polygon: new edge j runs from old point n-1-j to n-2-j, i.e. old edge n-2-j
        edgeMap = pts.map((_, j) => (n - 2 - j + n) % n);
    }
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, -z)), []);
    const mk = (h, flip) => {
        const pos = [];
        for (const [x, z] of pts)
            pos.push(x, h(x, z), z);
        const idx = [];
        for (const t of tris) {
            // the 2D triangulation is CCW in (x, -z): seen from +y that is CCW too
            if (flip)
                idx.push(t[0], t[2], t[1]);
            else
                idx.push(t[0], t[1], t[2]);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return applyBoxUV(g, { grain });
    };
    const topG = mk(top, false);
    const botG = mk(bot, true);
    const sideGeos = [];
    const want = sides === 'all' ? null : new Set(sides);
    for (let j = 0; j < pts.length; j++) {
        if (want && !want.has(edgeMap[j]))
            continue;
        const [x0, z0] = pts[j];
        const [x1, z1] = pts[(j + 1) % pts.length];
        // outward for a CCW (seen from above) polygon: the edge's right-hand side
        const a = new THREE.Vector3(x0, bot(x0, z0), z0);
        const b = new THREE.Vector3(x1, bot(x1, z1), z1);
        const c = new THREE.Vector3(x1, top(x1, z1), z1);
        const d = new THREE.Vector3(x0, top(x0, z0), z0);
        sideGeos.push(quad(a, b, c, d, 'x'));
    }
    return { top: topG, bottom: botG, sides: sideGeos.length ? mergeAll(sideGeos) : null };
}
/**
 * Normalize a list of geometries so mergeGeometries accepts them: keep the
 * attributes every piece has (position, normal, uv, plus e.g. the glass's
 * pane coordinates), and make them all indexed or all not.
 */
function prepare(geos) {
    for (const g of geos) {
        if (!g.getAttribute('normal'))
            g.computeVertexNormals();
        if (!g.getAttribute('uv'))
            applyBoxUV(g);
    }
    const shared = Object.keys(geos[0]?.attributes ?? {}).filter((n) => geos.every((g) => !!g.getAttribute(n) && g.getAttribute(n).itemSize === geos[0].getAttribute(n).itemSize));
    let out = geos.map((g) => {
        for (const name of Object.keys(g.attributes))
            if (!shared.includes(name))
                g.deleteAttribute(name);
        g.morphAttributes = {};
        return g;
    });
    if (out.some((g) => g.index) && out.some((g) => !g.index))
        out = out.map((g) => (g.index ? g.toNonIndexed() : g));
    return out;
}
export function mergeAll(geos) {
    const merged = mergeGeometries(prepare(geos), false);
    if (!merged)
        throw new Error('cabin: merge failed');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
}
/**
 * Collects geometry per material and builds one mesh per material. Each piece
 * may carry a role; the merged mesh keeps the triangle range of every role in
 * `userData.roles` so a raycast hit can be traced back to it (`roleAt`).
 */
export class Batch {
    buckets = new Map();
    add(mat, geo, opts = {}) {
        if (!geo)
            return;
        let b = this.buckets.get(mat);
        if (!b)
            this.buckets.set(mat, (b = { mat, geos: [], cast: false, receive: true }));
        b.geos.push({ geo, role: opts.role ?? '' });
        if (opts.cast)
            b.cast = true;
        if (opts.receive === false)
            b.receive = false;
    }
    build(name) {
        const out = [];
        for (const b of this.buckets.values()) {
            if (!b.geos.length)
                continue;
            const order = [...new Set(b.geos.map((g) => g.role))];
            const sorted = order.flatMap((r) => b.geos.filter((g) => g.role === r));
            const prepped = prepare(sorted.map((g) => g.geo));
            const roles = [];
            let tri = 0;
            prepped.forEach((geo, i) => {
                const role = sorted[i].role;
                const n = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
                const last = roles[roles.length - 1];
                if (last && last.role === role)
                    last.end += n;
                else
                    roles.push({ role, start: tri, end: tri + n });
                tri += n;
            });
            const geo = mergeAll(prepped);
            const mesh = new THREE.Mesh(geo, b.mat);
            mesh.name = `${name}:${b.mat.name || 'mat'}`;
            mesh.castShadow = b.cast;
            mesh.receiveShadow = b.receive;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            mesh.userData.roles = roles;
            out.push(mesh);
            prepped.forEach((g) => g.dispose());
        }
        this.buckets.clear();
        return out;
    }
}
/** Role of the triangle `faceIndex` of a mesh built by Batch. */
export function roleAt(obj, faceIndex) {
    const roles = obj.userData.roles;
    if (!roles || faceIndex === null || faceIndex === undefined)
        return null;
    for (const r of roles)
        if (faceIndex >= r.start && faceIndex < r.end)
            return r.role || null;
    return null;
}
/** Invisible, double-sided, raycastable material for pick proxies. */
export function proxyMaterial() {
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
    m.visible = false;
    return m;
}
export function smooth01(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}
/** Ease toward a target at a fixed rate (units per second). Returns the new value. */
export function approach(cur, target, rate, dt) {
    if (cur < target)
        return Math.min(target, cur + rate * dt);
    if (cur > target)
        return Math.max(target, cur - rate * dt);
    return cur;
}
/** Translate a geometry and return it (chaining helper). */
export function at(g, x, y, z) {
    g.translate(x, y, z);
    return g;
}
/**
 * A strip of snow lying along a ledge from a to b (a rail, a sill, a rafter's
 * cap, a log): a rounded mound `width` wide and up to `height` high, its
 * thickness wandering along the length, tapering at the ends and drooping a
 * little over the sides. Much lighter than a full snow cap for long, thin
 * supports. `up` is the ledge's up direction (default +Y).
 */
export function snowStrip(a, b, width, height, seed = 1, up = new THREE.Vector3(0, 1, 0)) {
    const len = a.distanceTo(b);
    const X = b.clone().sub(a).normalize();
    const Y = up.clone().addScaledVector(X, -up.dot(X)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const segs = Math.max(3, Math.round(len / 0.14));
    const prof = 7;
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const k1 = rnd() * 6.28;
    const k2 = rnd() * 6.28;
    const pos = [];
    const idx = [];
    const P = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const end = Math.min(1, Math.min(t, 1 - t) * len / Math.max(0.05, width * 0.8));
        const taper = Math.sqrt(Math.max(0, end));
        const h = height * taper * (0.75 + 0.18 * Math.sin(t * len * 2.3 + k1) + 0.1 * Math.sin(t * len * 6.1 + k2));
        const w = width * (0.5 + 0.06 * Math.sin(t * len * 3.7 + k2)) * (0.85 + 0.15 * taper);
        for (let j = 0; j <= prof; j++) {
            const u = j / prof; // across, 0..1
            const x = (u - 0.5) * 2; // -1..1
            // a soft mound with a little lip drooping over each side
            const yy = h * Math.pow(Math.max(0, 1 - x * x), 0.55) - (Math.abs(x) > 0.92 ? (Math.abs(x) - 0.92) * height * 0.9 : 0);
            P.copy(a).addScaledVector(X, t * len).addScaledVector(Z, x * w * 1.06).addScaledVector(Y, yy);
            pos.push(P.x, P.y, P.z);
        }
    }
    for (let i = 0; i < segs; i++) {
        for (let j = 0; j < prof; j++) {
            const k = i * (prof + 1) + j;
            idx.push(k, k + prof + 1, k + 1, k + 1, k + prof + 1, k + prof + 2);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the mound must face up: flip the winding if it came out facing down
    const n = g.getAttribute('normal');
    let sum = 0;
    for (let i = 0; i < n.count; i++)
        sum += n.getX(i) * Y.x + n.getY(i) * Y.y + n.getZ(i) * Y.z;
    if (sum < 0) {
        for (let i = 0; i < idx.length; i += 3) {
            const t = idx[i + 1];
            idx[i + 1] = idx[i + 2];
            idx[i + 2] = t;
        }
        g.setIndex(idx);
        g.computeVertexNormals();
    }
    return applyBoxUV(g);
}
