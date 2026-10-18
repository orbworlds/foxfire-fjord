/**
 * The night light field: one point sprite per window, lantern and lamp, so
 * the village still twinkles when its emissive quads shrink below a pixel.
 */
import * as THREE from 'three';
export function buildLightPoints(lights, mat) {
    const n = lights.length;
    const pos = new Float32Array(n * 3);
    const glow = new Float32Array(n * 4);
    const kind = new Float32Array(n * 4);
    const color = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    lights.forEach((l, i) => {
        pos.set([l.x, l.y, l.z], i * 3);
        glow.set(l.glow, i * 4);
        kind.set([0, l.sched, l.size, l.minPx], i * 4);
        color.set(l.color, i * 3);
        dir.set(l.dir, i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, mat);
    pts.name = 'village-lights';
    pts.renderOrder = 20;
    pts.matrixAutoUpdate = false;
    pts.userData.noPick = true;
    return pts;
}
