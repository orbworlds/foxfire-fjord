/**
 * Boardwalks: grey weathered planks on two stringers and short posts, with
 * snow lying along both edges and the middle trodden bare. One merged,
 * vertex-coloured mesh for every boardwalk path.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PATHS } from '../../world/layout.js';
import { hash2 } from '../../world/noise.js';
import { samplePath } from '../../world/paths.js';
import { heightAt } from '../../world/terrain-height.js';
const PLANK = { pitch: 0.21, depth: 0.17, t: 0.035 };
const LIFT = 0.16;
function colored(g, c) {
    const n = g.index ? g.toNonIndexed() : g;
    const pos = n.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++)
        col.set([c.r, c.g, c.b], i * 3);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (n.getAttribute('uv'))
        n.deleteAttribute('uv');
    return n;
}
export function buildBoardwalks() {
    const parts = [];
    const segs = [];
    const wood = new THREE.Color('#8a8580');
    const woodDark = new THREE.Color('#5c5752');
    const snow = new THREE.Color('#eef3f8');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    PATHS.forEach((def, pi) => {
        if (def.kind !== 'boardwalk')
            return;
        const samples = samplePath(def, PLANK.pitch);
        const half = def.width / 2;
        const deckY = (x, z) => heightAt(x, z) + LIFT;
        for (let i = 0; i < samples.length; i++) {
            const p = samples[i];
            const y = deckY(p.x, p.z);
            const yaw = Math.atan2(-p.tz, p.tx);
            q.setFromAxisAngle(up, yaw);
            const shade = wood.clone().lerp(woodDark, hash2(pi, i, 3) * 0.6);
            // plank across the path: trodden middle, snow on both ends
            const plank = colored(new THREE.BoxGeometry(PLANK.depth, PLANK.t, def.width), shade);
            m.compose(new THREE.Vector3(p.x, y - PLANK.t / 2, p.z), q, new THREE.Vector3(1, 1, 1));
            plank.applyMatrix4(m);
            parts.push(plank);
            for (const side of [-1, 1]) {
                const w = 0.18 + 0.12 * hash2(pi, i, side > 0 ? 5 : 6);
                const cap = colored(new THREE.BoxGeometry(PLANK.depth + 0.02, 0.03, w), snow);
                m.compose(new THREE.Vector3(p.x - p.tz * side * (half - w / 2), y + 0.012, p.z + p.tx * side * (half - w / 2)), q, new THREE.Vector3(1, 1, 1));
                cap.applyMatrix4(m);
                parts.push(cap);
            }
            minX = Math.min(minX, p.x - half);
            maxX = Math.max(maxX, p.x + half);
            minZ = Math.min(minZ, p.z - half);
            maxZ = Math.max(maxZ, p.z + half);
        }
        // stringers and posts
        const a = samples[0];
        const b = samples[samples.length - 1];
        for (const side of [-1, 1]) {
            const off = half - 0.12;
            const ax = a.x - a.tz * side * off;
            const az = a.z + a.tx * side * off;
            const bx = b.x - b.tz * side * off;
            const bz = b.z + b.tx * side * off;
            const ya = deckY(ax, az) - PLANK.t - 0.05;
            const yb = deckY(bx, bz) - PLANK.t - 0.05;
            const len = Math.hypot(bx - ax, bz - az, yb - ya);
            const str = colored(new THREE.BoxGeometry(len, 0.1, 0.07), woodDark);
            const dir = new THREE.Vector3(bx - ax, yb - ya, bz - az).normalize();
            q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
            m.compose(new THREE.Vector3((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
            str.applyMatrix4(m);
            parts.push(str);
            const n = Math.max(2, Math.ceil(len / 2) + 1);
            for (let k = 0; k < n; k++) {
                const t = k / (n - 1);
                const x = ax + (bx - ax) * t;
                const z = az + (bz - az) * t;
                const top = ya + (yb - ya) * t;
                const g = heightAt(x, z);
                const post = colored(new THREE.BoxGeometry(0.09, top - g + 0.35, 0.09), woodDark);
                post.translate(x, (top + g - 0.35) / 2, z);
                parts.push(post);
            }
        }
        for (let i = 0; i < samples.length - 1; i++) {
            segs.push({
                ax: samples[i].x,
                az: samples[i].z,
                bx: samples[i + 1].x,
                bz: samples[i + 1].z,
                y0: deckY(samples[i].x, samples[i].z),
                y1: deckY(samples[i + 1].x, samples[i + 1].z),
                half,
            });
        }
    });
    if (!parts.length)
        return { object: null, deckAt: () => null, bounds: null };
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ name: 'boardwalk', vertexColors: true, roughness: 0.85 }));
    mesh.name = 'boardwalks';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const deckAt = (x, z) => {
        for (const s of segs) {
            const dx = s.bx - s.ax;
            const dz = s.bz - s.az;
            const l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
            const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
            if (d <= s.half)
                return s.y0 + (s.y1 - s.y0) * t;
        }
        return null;
    };
    return { object: mesh, deckAt, bounds: { minX, maxX, minZ, maxZ } };
}
