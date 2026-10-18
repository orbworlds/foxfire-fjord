/**
 * Lantern posts round the cabin: a tarred post with an arm, a black iron
 * lantern hanging from it with snow on its roof, and a warm candle glow after
 * dark. Each lantern also throws a soft pool of light on the snow below (a
 * terrain-conforming additive decal, far cheaper than a real light). All posts
 * merge into three meshes: iron and wood, glass, light pools.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from '../../world/terrain-height.js';
import { LANTERNS } from './layout.js';
const lin = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
};
function colored(g, c) {
    const n = g.index ? g.toNonIndexed() : g;
    const pos = n.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++)
        col.set(c, i * 3);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (n.getAttribute('uv'))
        n.deleteAttribute('uv');
    return n;
}
const POST_H = 1.85;
const ARM_Y = 1.72;
const ARM_L = 0.42;
const LANTERN_Y = 1.38;
function lightPoolTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    // inverse-square-ish falloff from a lamp ~1.4 m up, faded to zero at the rim
    const img = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
            const r = Math.hypot(x - 63.5, y - 63.5) / 64;
            const d = r * 4.2;
            const e = Math.pow(1.4 / Math.hypot(1.4, d), 3) * Math.max(0, 1 - r * r) ** 2;
            const v = Math.round(255 * Math.min(1, e));
            const k = (y * 128 + x) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
            img.data[k + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
}
/** A disc lying on the terrain (radius r), uv centred on the lantern. */
function poolGeometry(x, z, r) {
    const rings = 6;
    const seg = 18;
    const pos = [];
    const uv = [];
    const idx = [];
    pos.push(x, heightAt(x, z) + 0.04, z);
    uv.push(0.5, 0.5);
    for (let i = 1; i <= rings; i++) {
        const rr = (r * i) / rings;
        for (let j = 0; j < seg; j++) {
            const a = (j / seg) * Math.PI * 2;
            const px = x + Math.cos(a) * rr;
            const pz = z + Math.sin(a) * rr;
            pos.push(px, heightAt(px, pz) + 0.04, pz);
            uv.push(0.5 + (Math.cos(a) * i) / rings / 2, 0.5 + (Math.sin(a) * i) / rings / 2);
        }
    }
    for (let j = 0; j < seg; j++)
        idx.push(0, 1 + ((j + 1) % seg), 1 + j);
    for (let i = 1; i < rings; i++) {
        const a0 = 1 + (i - 1) * seg;
        const b0 = 1 + i * seg;
        for (let j = 0; j < seg; j++) {
            const j1 = (j + 1) % seg;
            idx.push(a0 + j, a0 + j1, b0 + j1, a0 + j, b0 + j1, b0 + j);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}
export function buildLanterns() {
    const wood = lin('#2b2420');
    const iron = lin('#1c1c1e');
    const snow = lin('#f2f5fa');
    const body = [];
    const glass = [];
    const pools = [];
    const posts = [];
    for (const l of LANTERNS) {
        const ground = heightAt(l.x, l.z);
        posts.push({ x: l.x, z: l.z, ground });
        const yaw = Math.atan2(-l.face[1], l.face[0]);
        const parts = [];
        const add = (g, c, x, y, z) => {
            g.translate(x, y, z);
            parts.push(colored(g, c));
        };
        add(new THREE.BoxGeometry(0.1, POST_H + 0.4, 0.1), wood, 0, (POST_H - 0.4) / 2, 0);
        add(new THREE.ConeGeometry(0.085, 0.07, 4).rotateY(Math.PI / 4), wood, 0, POST_H + 0.035, 0);
        add(new THREE.SphereGeometry(0.075, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), snow, 0, POST_H + 0.055, 0);
        add(new THREE.BoxGeometry(ARM_L, 0.05, 0.05), wood, ARM_L / 2, ARM_Y, 0);
        add(new THREE.BoxGeometry(ARM_L - 0.06, 0.025, 0.055), snow, ARM_L / 2 - 0.03, ARM_Y + 0.036, 0);
        const lx = ARM_L - 0.06;
        add(new THREE.CylinderGeometry(0.006, 0.006, ARM_Y - LANTERN_Y - 0.16, 4), iron, lx, (ARM_Y + LANTERN_Y + 0.16) / 2, 0);
        add(new THREE.BoxGeometry(0.17, 0.025, 0.17), iron, lx, LANTERN_Y - 0.12, 0);
        for (const [cx, cz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
        ])
            add(new THREE.BoxGeometry(0.014, 0.24, 0.014), iron, lx + cx * 0.075, LANTERN_Y, cz * 0.075);
        add(new THREE.ConeGeometry(0.13, 0.1, 4).rotateY(Math.PI / 4), iron, lx, LANTERN_Y + 0.17, 0);
        add(new THREE.ConeGeometry(0.105, 0.06, 4).rotateY(Math.PI / 4), snow, lx, LANTERN_Y + 0.205, 0);
        const merged = mergeGeometries(parts);
        merged.rotateY(yaw);
        merged.translate(l.x, ground, l.z);
        body.push(merged);
        const gl = new THREE.BoxGeometry(0.13, 0.21, 0.13);
        gl.translate(lx, LANTERN_Y, 0);
        gl.rotateY(yaw);
        gl.translate(l.x, ground, l.z);
        glass.push(gl.toNonIndexed());
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        pools.push(poolGeometry(l.x + c * lx, l.z - s * lx, 4.2));
    }
    const group = new THREE.Group();
    group.name = 'lanterns';
    const bodyMesh = new THREE.Mesh(mergeGeometries(body), new THREE.MeshStandardMaterial({ name: 'lanternIron', vertexColors: true, roughness: 0.7, metalness: 0.2 }));
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    const glassMat = new THREE.MeshStandardMaterial({ name: 'lanternGlass', color: 0x3a2a1a, roughness: 0.25, emissive: new THREE.Color('#ffb866'), emissiveIntensity: 0 });
    const glassMesh = new THREE.Mesh(mergeGeometries(glass), glassMat);
    const poolMat = new THREE.MeshBasicMaterial({
        name: 'lanternPool',
        map: lightPoolTexture(),
        color: new THREE.Color(1, 0.66, 0.36),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true,
    });
    const poolMesh = new THREE.Mesh(mergeGeometries(pools), poolMat);
    poolMesh.renderOrder = 2;
    poolMesh.visible = false;
    group.add(bodyMesh, glassMesh, poolMesh);
    return {
        object: group,
        posts,
        update(night, time) {
            const flicker = 0.92 + 0.05 * Math.sin(time * 11.3) + 0.03 * Math.sin(time * 23.7 + 1.3);
            const on = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
            glassMat.emissiveIntensity = on * 2.6 * flicker;
            poolMat.opacity = on * 0.05 * flicker;
            poolMesh.visible = on > 0.01;
        },
        dispose() {
            bodyMesh.geometry.dispose();
            glassMesh.geometry.dispose();
            poolMesh.geometry.dispose();
            bodyMesh.material.dispose();
            glassMat.dispose();
            poolMat.map?.dispose();
            poolMat.dispose();
        },
    };
}
