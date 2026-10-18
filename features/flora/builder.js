/**
 * Low-level mesh building for the island's trees and shrubs. Every vertex carries:
 *   position, normal, uv (atlas; bark uses v >= 10 = "wrap inside the bark band"),
 *   color (rgb: ambient occlusion × tint), aWind (vec4, see material.ts) and
 *   aSnow (vec2): x how much snow the surface holds (0 none … 1 full; 1..2
 *   the needles and twigs themselves are rimed / plastered; 3 a lump of pure
 *   snow), y = 1 when the
 *   painted snow shows from both faces (vertical cards), 0 when only the
 *   card's front face (built to face the sky) carries it.
 */
import * as THREE from 'three';
import { BARK_FLAG } from './atlas.js';
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
export const UP = new THREE.Vector3(0, 1, 0);
export class MeshBuilder {
    pos = [];
    nor = [];
    uv = [];
    col = [];
    wind = [];
    snw = [];
    hz = [];
    idx = [];
    /** aSnow written by vert() until changed */
    snow = [0, 0];
    /** aHaze written by vert(): 1 on fine twig cards (dithered coverage), 0 elsewhere */
    haze = 0;
    get vertexCount() {
        return this.pos.length / 3;
    }
    get triangleCount() {
        return this.idx.length / 3;
    }
    vert(p, n, u, v, c, w) {
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.uv.push(u, v);
        this.col.push(c[0], c[1], c[2]);
        this.wind.push(w[0], w[1], w[2], w[3]);
        this.snw.push(this.snow[0], this.snow[1]);
        this.hz.push(this.haze);
        return this.pos.length / 3 - 1;
    }
    tri(a, b, c) {
        this.idx.push(a, b, c);
    }
    quad(a, b, c, d) {
        this.idx.push(a, b, c, a, c, d);
    }
    /** Append another builder, optionally transformed; `wind` can rewrite each vertex's wind data. */
    append(o, m, wind) {
        const base = this.vertexCount;
        if (m)
            _m3.getNormalMatrix(m);
        const w = [0, 0, 0, 0];
        for (let i = 0; i < o.vertexCount; i++) {
            _v.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]);
            _n.set(o.nor[i * 3], o.nor[i * 3 + 1], o.nor[i * 3 + 2]);
            if (m) {
                _v.applyMatrix4(m);
                _n.applyMatrix3(_m3).normalize();
            }
            this.pos.push(_v.x, _v.y, _v.z);
            this.nor.push(_n.x, _n.y, _n.z);
            this.uv.push(o.uv[i * 2], o.uv[i * 2 + 1]);
            this.col.push(o.col[i * 3], o.col[i * 3 + 1], o.col[i * 3 + 2]);
            w[0] = o.wind[i * 4];
            w[1] = o.wind[i * 4 + 1];
            w[2] = o.wind[i * 4 + 2];
            w[3] = o.wind[i * 4 + 3];
            const ww = wind ? wind(w, _v) : w;
            this.wind.push(ww[0], ww[1], ww[2], ww[3]);
            this.snw.push(o.snw[i * 2], o.snw[i * 2 + 1]);
            this.hz.push(o.hz[i]);
        }
        for (const k of o.idx)
            this.idx.push(k + base);
    }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 4));
        g.setAttribute('aSnow', new THREE.Float32BufferAttribute(this.snw, 2));
        g.setAttribute('aHaze', new THREE.Float32BufferAttribute(this.hz, 1));
        const n = this.vertexCount;
        g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
        g.computeBoundingBox();
        g.computeBoundingSphere();
        return g;
    }
    /**
     * Tapered tube along a polyline (parallel-transport frames). Bark UVs wrap
     * vertically: u spans `uRange` once around, v = BARK_FLAG + arc / vTile + vOff.
     */
    tube(pts, radii, segs, opts) {
        const n = pts.length;
        if (n < 2)
            return;
        const tangents = [];
        for (let i = 0; i < n; i++) {
            const a = pts[Math.max(0, i - 1)];
            const b = pts[Math.min(n - 1, i + 1)];
            tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
        }
        // initial normal perpendicular to the first tangent
        const t0 = tangents[0];
        const normal = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(t0).normalize() : new THREE.Vector3(1, 0, 0).cross(t0).normalize();
        const binormal = new THREE.Vector3().crossVectors(t0, normal).normalize();
        let arc = 0;
        const base = this.vertexCount;
        const [u0, u1] = opts.uRange;
        const ring = segs + 1;
        let total = 0;
        for (let i = 1; i < n; i++)
            total += pts[i].distanceTo(pts[i - 1]);
        for (let i = 0; i < n; i++) {
            if (i > 0) {
                arc += pts[i].distanceTo(pts[i - 1]);
                // parallel transport
                const tPrev = tangents[i - 1];
                const tCur = tangents[i];
                _q.crossVectors(tPrev, tCur);
                const s = _q.length();
                if (s > 1e-6) {
                    _q.divideScalar(s);
                    const ang = Math.acos(THREE.MathUtils.clamp(tPrev.dot(tCur), -1, 1));
                    normal.applyAxisAngle(_q, ang);
                }
                binormal.crossVectors(tCur, normal).normalize();
                normal.crossVectors(binormal, tCur).normalize();
            }
            const w = opts.wind(i);
            for (let j = 0; j <= segs; j++) {
                const a = (j / segs) * Math.PI * 2;
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                const r = radii[i] * (opts.shape ? opts.shape(i, a) : 1);
                _n.copy(normal).multiplyScalar(ca).addScaledVector(binormal, sa).normalize();
                _v.copy(pts[i]).addScaledVector(_n, r);
                const u = u0 + ((u1 - u0) * j) / segs;
                let v;
                if (opts.rect)
                    v = opts.rect.v0 + ((opts.rect.v1 - opts.rect.v0) * arc) / Math.max(1e-4, total);
                else
                    v = BARK_FLAG + arc / opts.vTile + (opts.vOff ?? 0);
                const uu = opts.rect ? opts.rect.u0 + ((opts.rect.u1 - opts.rect.u0) * j) / segs : u;
                this.vert(_v, _n, uu, v, opts.color(i, j), w);
            }
        }
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < segs; j++) {
                const a = base + i * ring + j;
                const b = a + ring;
                this.quad(a, a + 1, b + 1, b);
            }
        }
        if (opts.capEnd) {
            const last = n - 1;
            _t.copy(tangents[last]);
            const c = this.vert(pts[last], _t, (u0 + u1) * 0.5, BARK_FLAG + arc / opts.vTile + (opts.vOff ?? 0), opts.color(last, 0), opts.wind(last));
            for (let j = 0; j < segs; j++) {
                const a = base + last * ring + j;
                this.tri(a, a + 1, c);
            }
        }
    }
    /**
     * Flat card. `right`/`up` are unit vectors in the card plane; `normal(p)`
     * supplies the shading normal per corner (foliage uses crown-spherical normals).
     */
    card(center, right, up, w, h, rect, normal, color, wind, anchorBottom = false, flipU = false) {
        const hw = w * 0.5;
        const yb = anchorBottom ? 0 : -h * 0.5;
        const yt = anchorBottom ? h : h * 0.5;
        const corners = [
            [-hw, yb, flipU ? rect.u1 : rect.u0, rect.v0],
            [hw, yb, flipU ? rect.u0 : rect.u1, rect.v0],
            [hw, yt, flipU ? rect.u0 : rect.u1, rect.v1],
            [-hw, yt, flipU ? rect.u1 : rect.u0, rect.v1],
        ];
        const ids = [];
        corners.forEach(([x, y, u, v], k) => {
            const p = new THREE.Vector3().copy(center).addScaledVector(right, x).addScaledVector(up, y);
            ids.push(this.vert(p, normal(p), u, v, color(p), wind(p, k)));
        });
        this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    /**
     * Foliage ribbon along a curve (spruce boughs). Each station gives the axis
     * point, a side vector and a "down" vector; the two halves fold by `fold`
     * radians (positive = the sides droop). Triangles wind so the front face
     * is the one facing away from `down`.
     */
    ribbon(st, rect, color, wind) {
        const base = this.vertexCount;
        for (let i = 0; i < st.length; i++) {
            const s = st[i];
            const cf = Math.cos(s.fold);
            const sf = Math.sin(s.fold);
            const v = rect.v0 + (rect.v1 - rect.v0) * s.v;
            // left (u0), center, right (u1)
            for (let k = 0; k < 3; k++) {
                const side = k === 0 ? 1 : k === 2 ? -1 : 0;
                _v.copy(s.p);
                if (side !== 0)
                    _v.addScaledVector(s.side, side * s.hw * cf).addScaledVector(s.down, s.hw * sf);
                // normal: blend of the half-plane normal and the frond's up
                if (side !== 0) {
                    _n.copy(s.nUp).multiplyScalar(cf).addScaledVector(s.side, side * sf * 0.85).normalize();
                }
                else
                    _n.copy(s.nUp);
                const u = k === 0 ? rect.u0 : k === 2 ? rect.u1 : (rect.u0 + rect.u1) * 0.5;
                this.vert(_v, _n, u, v, color(i, k), wind(i, k));
            }
        }
        for (let i = 0; i < st.length - 1; i++) {
            const a = base + i * 3;
            const b = a + 3;
            this.quad(a, a + 1, b + 1, b);
            this.quad(a + 1, a + 2, b + 2, b + 1);
        }
    }
    /** Ellipsoid (snow pillows, mounds). `vMax` limits it to the upper part (0..1 of the polar range). */
    ellipsoid(center, radii, segU, segV, rect, color, wind, opts = {}) {
        const base = this.vertexCount;
        const vMax = opts.vMax ?? 1;
        for (let iv = 0; iv <= segV; iv++) {
            const th = (iv / segV) * Math.PI * vMax;
            const st = Math.sin(th);
            const ct = Math.cos(th);
            for (let iu = 0; iu <= segU; iu++) {
                const ph = (iu / segU) * Math.PI * 2;
                _b.set(st * Math.cos(ph), ct, st * Math.sin(ph));
                const k = opts.bump ? opts.bump(_b) : 1;
                _v.set(_b.x * radii.x * k, _b.y * radii.y * k, _b.z * radii.z * k);
                _n.set(_b.x / radii.x, _b.y / radii.y, _b.z / radii.z).normalize();
                if (opts.rot) {
                    _v.applyQuaternion(opts.rot);
                    _n.applyQuaternion(opts.rot);
                }
                _v.add(center);
                const u = rect.u0 + ((rect.u1 - rect.u0) * iu) / segU;
                const v = rect.v1 - ((rect.v1 - rect.v0) * iv) / segV;
                this.vert(_v, _n, u, v, color(_v, _n), wind);
            }
        }
        const row = segU + 1;
        for (let iv = 0; iv < segV; iv++) {
            for (let iu = 0; iu < segU; iu++) {
                const a = base + iv * row + iu;
                const b = a + row;
                this.quad(a, b, b + 1, a + 1);
            }
        }
    }
}
/** Orthonormal basis helper: returns [right, up] spanning the plane with normal n, rotated by `spin`. */
export function planeBasis(n, spin, outR, outU) {
    const ref = Math.abs(n.y) < 0.95 ? UP : _t.set(1, 0, 0);
    outR.crossVectors(ref, n).normalize();
    outU.crossVectors(n, outR).normalize();
    if (spin !== 0) {
        const c = Math.cos(spin);
        const s = Math.sin(spin);
        _b.copy(outR).multiplyScalar(c).addScaledVector(outU, s);
        outU.multiplyScalar(c).addScaledVector(outR, -s);
        outR.copy(_b);
    }
}
/** Random unit vector with an upward bias (bias 0 = uniform sphere, 1 = upper hemisphere only). */
export function randomDir(rnd, out, upBias = 0.3) {
    const y = THREE.MathUtils.lerp(-1 + upBias, 1, rnd());
    const t = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    return out.set(r * Math.cos(t), y, r * Math.sin(t));
}
