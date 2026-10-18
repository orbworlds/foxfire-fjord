/**
 * Small geometry builders shared by the outdoor sites (paths, hot spring,
 * village, beach, summit). Everything gets meter UVs so library materials tile right.
 */
import * as THREE from 'three';
import { box } from '../../../core/geometry.js';
export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
/** Box from a to b (length axis) whose height axis stays in the vertical plane through a–b. */
export function beam(a, b, w, h) {
    const len = a.distanceTo(b);
    const g = box(len, h, w, 'x');
    const X = b.clone().sub(a).normalize();
    const Y = v3(0, 1, 0).addScaledVector(X, -X.y);
    if (Y.lengthSq() < 1e-6)
        Y.set(1, 0, 0);
    Y.normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    return g;
}
/** Two-triangle quad with explicit UVs (p0..p3 counter-clockwise seen from the front). */
export function quad(p, uv) {
    const g = new THREE.BufferGeometry();
    const idx = [0, 1, 2, 0, 2, 3];
    const pos = [];
    const uvs = [];
    for (const i of idx) {
        pos.push(p[i].x, p[i].y, p[i].z);
        uvs.push(uv[i][0], uv[i][1]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
}
export function tri(p, uv) {
    const g = new THREE.BufferGeometry();
    const pos = [];
    const uvs = [];
    for (let i = 0; i < 3; i++) {
        pos.push(p[i].x, p[i].y, p[i].z);
        uvs.push(uv[i][0], uv[i][1]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
}
/** Add a constant (or per-vertex) RGB `color` attribute so vertex-colored materials can merge. */
export function tint(g, r, gr, b) {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        c[i * 3] = r;
        c[i * 3 + 1] = gr;
        c[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
}
/** Add a mesh with the given geometry/material to a parent; returns the mesh. */
export function put(parent, g, m, cast = true) {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}
