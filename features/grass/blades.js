/**
 * Template geometries. `position` only carries parameters — the vertex
 * shader shapes, bends and colors the blade:
 *   x = side (-1 left edge, 0 tip, +1 right edge), y = t along the blade,
 *   z = blade index within a clump (near) or card index (far tufts).
 */
import * as THREE from 'three';
/** Clump of tapered blades: per blade a vertex pair per level plus a tip. */
export function bladeGeometry(levels, blades) {
    const pos = [];
    const idx = [];
    const per = levels.length * 2 + 1;
    for (let b = 0; b < blades; b++) {
        const o = b * per;
        for (const t of levels)
            pos.push(-1, t, b, 1, t, b);
        pos.push(0, 1, b);
        for (let i = 0; i < levels.length - 1; i++) {
            const a = o + i * 2;
            idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
        const last = o + (levels.length - 1) * 2;
        idx.push(last, last + 1, o + levels.length * 2);
    }
    return finish(pos, idx);
}
/** Far-range tuft: crossed tapered cards sharing a root (3 vertices, 1 triangle each). */
export function tuftGeometry(cards) {
    const pos = [];
    const idx = [];
    for (let c = 0; c < cards; c++) {
        const b = c * 3;
        pos.push(-1, 0, c, 1, 0, c, 0, 1, c);
        idx.push(b, b + 1, b + 2);
    }
    return finish(pos, idx);
}
function finish(pos, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const n = new Float32Array(pos.length);
    for (let i = 2; i < n.length; i += 3)
        n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setIndex(idx);
    return g;
}
/** 7 vertices / 5 triangles per blade, levels denser toward the tip where it bends. */
export const BLADE_LOD0_LEVELS = [0, 0.4, 0.74];
/** 5 vertices / 3 triangles per blade. */
export const BLADE_LOD1_LEVELS = [0, 0.56];
/** blades per near instance */
export const CLUMP_BLADES = 5;
