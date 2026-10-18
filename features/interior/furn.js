/**
 * Shared building blocks for the cabin's furniture: a placement frame per
 * piece (house-local position + turn), soft contact shadows under things
 * standing on the floor, rows of books for the shelves, bent boards (skis,
 * snowshoe frames, chair backs) and a few small turned objects (mugs, jars,
 * candle holders).
 */
import * as THREE from 'three';
import { mulberry32 } from '../../world/noise.js';
import { turned, place } from './kit.js';
/**
 * A piece's own frame: geometry built around the origin (front = +z, y up
 * from the floor) is turned by `rotY` and moved to house-local (x, y, z).
 */
export function frame(x, z, rotY = 0, y = 0) {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    return (g) => g.applyMatrix4(m);
}
/** a point in a piece's frame, in house-local coordinates */
export function framePoint(x, z, rotY, p, y = 0) {
    return p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(new THREE.Vector3(x, y, z));
}
/** rotY that turns a piece's front (+z) toward the point (tx, tz) from (x, z) */
export function facing(x, z, tx, tz) {
    return Math.atan2(tx - x, tz - z);
}
/* ------------------------------------------------------------------ */
/* Contact shadows                                                     */
/* ------------------------------------------------------------------ */
/**
 * Soft darkening on the floor under furniture (a multiply decal of rounded
 * rectangles): grounds sofas, beds and chairs where the room's lamps cast
 * no shadows. One mesh for the whole room.
 */
export class ContactShadows {
    quads = [];
    /** a footprint w × d (m) centred at (x, z), turned by rot; `soft` blur (m), `k` darkness 0..1 */
    add(x, z, w, d, rot = 0, soft = 0.12, k = 0.55, y = 0.013) {
        this.quads.push({ x, y, z, w, d, rot, soft, k });
    }
    build(name) {
        if (!this.quads.length)
            return null;
        const pos = [];
        const uv = [];
        const data = [];
        const idx = [];
        for (const q of this.quads) {
            const hw = q.w / 2 + q.soft;
            const hd = q.d / 2 + q.soft;
            const c = Math.cos(q.rot);
            const s = Math.sin(q.rot);
            const base = pos.length / 3;
            for (const [u, v] of [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
            ]) {
                const lx = u * hw;
                const lz = v * hd;
                pos.push(q.x + lx * c + lz * s, q.y, q.z - lx * s + lz * c);
                uv.push(u * hw, v * hd);
                data.push(q.w / 2, q.d / 2, q.soft, q.k);
            }
            idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('aShadow', new THREE.Float32BufferAttribute(data, 4));
        g.setIndex(idx);
        const mat = new THREE.ShaderMaterial({
            name: 'contactShadow',
            vertexShader: /* glsl */ `
        attribute vec4 aShadow;
        varying vec2 vUv;
        varying vec4 vS;
        void main() { vUv = uv; vS = aShadow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec4 vS;
        void main() {
          // rounded-rectangle distance, blurred by the softness
          vec2 q = abs(vUv) - vS.xy + vS.z * 0.5;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vS.z * 0.5;
          float k = 1.0 - smoothstep(-vS.z, vS.z, d);
          gl_FragColor = vec4(vec3(1.0 - vS.w * k), 1.0);
        }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.ZeroFactor,
            blendDst: THREE.SrcColorFactor,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = name;
        mesh.renderOrder = 1;
        mesh.raycast = () => { };
        return mesh;
    }
}
/* ------------------------------------------------------------------ */
/* Books                                                               */
/* ------------------------------------------------------------------ */
const ATLAS_COLS = 24;
/**
 * One book standing upright on a shelf (house-local frame of the shelf: x
 * along it, spine facing +z): thickness t, height h, depth d, atlas column.
 */
export function book(t, h, d, col) {
    const g = new THREE.BoxGeometry(t, h, d);
    const uv = g.getAttribute('uv');
    const u0 = col / ATLAS_COLS + 0.002;
    const u1 = (col + 1) / ATLAS_COLS - 0.002;
    const page = (i) => {
        // face i: 4 vertices; map into the page-edge band of the column
        for (let k = 0; k < 4; k++) {
            const a = uv.getX(i * 4 + k);
            const b = uv.getY(i * 4 + k);
            uv.setXY(i * 4 + k, u0 + (u1 - u0) * a, 0.015 + b * 0.09);
        }
    };
    const cloth = (i, full) => {
        for (let k = 0; k < 4; k++) {
            const a = uv.getX(i * 4 + k);
            const b = uv.getY(i * 4 + k);
            if (full)
                uv.setXY(i * 4 + k, u0 + (u1 - u0) * a, 0.13 + b * 0.86);
            else
                uv.setXY(i * 4 + k, u0 + (u1 - u0) * (0.4 + 0.2 * a), 0.5 + 0.05 * b);
        }
    };
    // BoxGeometry faces: +x, -x, +y, -y, +z (spine), -z (fore-edge)
    cloth(0, false);
    cloth(1, false);
    page(2);
    page(3);
    cloth(4, true);
    page(5);
    return g;
}
/**
 * Fill a shelf run with books: from x0 to x1 (shelf frame), standing on y,
 * spines flush at zFront, leaving `gaps` (x ranges) free for objects. Some
 * lean, a few lie in a stack.
 */
export function shelfOfBooks(x0, x1, y, zFront, maxH, seed, gaps = []) {
    const rnd = mulberry32(seed);
    const out = [];
    let x = x0 + 0.01;
    let lean = 0;
    while (x < x1 - 0.02) {
        const gap = gaps.find(([a, b]) => x >= a - 0.01 && x < b);
        if (gap) {
            x = gap[1] + 0.005;
            continue;
        }
        const r = rnd();
        if (r < 0.08 && x1 - x > 0.3) {
            // a stack lying flat
            const n = 2 + Math.floor(rnd() * 3);
            let yy = y;
            const w = 0.2 + rnd() * 0.06;
            for (let k = 0; k < n; k++) {
                const t = 0.025 + rnd() * 0.02;
                const g = book(t, w, 0.15 + rnd() * 0.05, Math.floor(rnd() * ATLAS_COLS));
                g.rotateZ(Math.PI / 2);
                g.rotateY((rnd() - 0.5) * 0.15);
                g.translate(x + w / 2 + (rnd() - 0.5) * 0.01, yy + t / 2, zFront - 0.09);
                out.push(g);
                yy += t;
            }
            x += w + 0.02;
            lean = 0;
            continue;
        }
        if (r < 0.14) {
            x += 0.03 + rnd() * 0.06;
            lean = rnd() < 0.5 ? 0.25 + rnd() * 0.15 : 0;
            continue;
        }
        const t = 0.018 + rnd() * 0.035;
        const h = Math.min(maxH - 0.02, 0.17 + rnd() * 0.12);
        const d = Math.min(0.24, 0.13 + rnd() * 0.08);
        const g = book(t, h, d, Math.floor(rnd() * ATLAS_COLS));
        if (lean > 0) {
            // the first book after a gap leans on its neighbour
            g.translate(0, h / 2, 0);
            g.rotateZ(lean);
            g.translate(x + Math.sin(lean) * h * 0.5 + t * 0.5, y, zFront - d / 2);
            x += Math.sin(lean) * h + t;
            lean = 0;
        }
        else {
            g.translate(x + t / 2, y + h / 2, zFront - d / 2 - rnd() * 0.012);
            x += t + 0.0015;
        }
        out.push(g);
    }
    return out;
}
/* ------------------------------------------------------------------ */
/* Bent boards                                                         */
/* ------------------------------------------------------------------ */
/**
 * A board of width w and thickness t following a path (pts, in order) with
 * its broad face square to `up` (skis: the running surface; chair slats).
 * UVs: u along the path (m), v across.
 */
export function bentBoard(pts, w, t, up = new THREE.Vector3(0, 1, 0), segments = 24, taper) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const pos = [];
    const uv = [];
    const idx = [];
    const ring = 4;
    for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const p = curve.getPointAt(u);
        const T = curve.getTangentAt(u);
        const side = new THREE.Vector3().crossVectors(T, up).normalize();
        const N = new THREE.Vector3().crossVectors(side, T).normalize();
        const k = taper ? taper(u) : 1;
        const hw = (w / 2) * k;
        const ht = t / 2;
        const corners = [
            [-hw, ht],
            [hw, ht],
            [hw, -ht],
            [-hw, -ht],
        ];
        for (const [a, b] of corners) {
            const q = p.clone().addScaledVector(side, a).addScaledVector(N, b);
            pos.push(q.x, q.y, q.z);
            uv.push(u * len, a);
        }
    }
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < ring; j++) {
            const a = i * ring + j;
            const b = i * ring + ((j + 1) % ring);
            const c = a + ring;
            const d = b + ring;
            idx.push(a, c, b, b, c, d);
        }
    }
    // end caps
    const last = segments * ring;
    idx.push(0, 1, 2, 0, 2, 3, last + 0, last + 2, last + 1, last + 0, last + 3, last + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const ni = g.toNonIndexed();
    g.dispose();
    ni.computeVertexNormals();
    return ni;
}
/* ------------------------------------------------------------------ */
/* Small turned things                                                 */
/* ------------------------------------------------------------------ */
/** a mug (body + handle) standing at the origin, handle toward +x */
export function mug(r = 0.04, h = 0.09) {
    const body = turned([
        [0, 0.002],
        [r * 0.85, 0],
        [r, 0.008],
        [r * 1.02, h * 0.6],
        [r * 1.05, h],
        [r * 0.93, h],
        [r * 0.9, h * 0.6],
        [r * 0.82, 0.012],
        [0, 0.012],
    ], 18);
    const handle = new THREE.TorusGeometry(h * 0.26, 0.007, 6, 12, Math.PI * 1.1);
    handle.rotateZ(-Math.PI * 0.55);
    handle.translate(r * 1.02, h * 0.52, 0);
    return [body, handle];
}
/** a straight-sided glass or tin jar with a lid knob */
export function jar(r, h) {
    return turned([
        [0, 0],
        [r, 0],
        [r, h * 0.92],
        [r * 0.8, h],
        [r * 0.85, h + 0.012],
        [r * 0.3, h + 0.016],
        [r * 0.25, h + 0.03],
        [0, h + 0.032],
    ], 18);
}
/** a brass candlestick: base disc, stem, a cup for the candle; returns the cup's top height */
export function candlestick(h = 0.12) {
    const g = turned([
        [0, 0],
        [0.045, 0],
        [0.046, 0.006],
        [0.03, 0.012],
        [0.012, 0.025],
        [0.009, h * 0.5],
        [0.014, h * 0.55],
        [0.009, h * 0.62],
        [0.009, h - 0.02],
        [0.022, h - 0.01],
        [0.022, h],
        [0.0, h],
    ], 16);
    return { geo: g, top: h };
}
/** a round wooden bowl */
export function bowl(r, h) {
    return turned([
        [0, 0],
        [r * 0.45, 0],
        [r * 0.8, h * 0.35],
        [r, h],
        [r * 0.93, h],
        [r * 0.72, h * 0.4],
        [r * 0.4, h * 0.15],
        [0, h * 0.15],
    ], 20);
}
/** a turned leg (tapering round) of height h */
export function leg(h, r0 = 0.022, r1 = 0.016) {
    return turned([
        [0, 0],
        [r1, 0],
        [r1 * 1.05, h * 0.3],
        [r0, h * 0.85],
        [r0, h],
        [0, h],
    ], 10);
}
export { place };
