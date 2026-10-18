/**
 * Snow poles along the paths. Trails and packed footpaths get slim poles with
 * red tips standing in the drift beside the track; the plowed road gets tall
 * birch plow poles on both edges, the way roads are staked before the first
 * snow so the plow driver can find them. All poles are instances of two unit
 * geometries (vertex coloured), streamed around the camera by InstanceField.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PATHS } from '../../world/layout.js';
import { hash2 } from '../../world/noise.js';
import { samplePath } from '../../world/paths.js';
import { heightAt } from '../../world/terrain-height.js';
import { InstanceBatch } from './field.js';
import { POLE_KEEPOUT, POLE_RULES } from './layout.js';
/** Paint a geometry's vertices with a colour by height band (unit height, y 0..1). */
function bands(g, pick) {
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++)
        col.set(pick(pos.getY(i)), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
}
const lin = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
};
/** Trail pole: unit radius, unit height, red top fifth, a little snow cap. */
function trailPole(radial) {
    const pole = new THREE.CylinderGeometry(1, 1, 1, radial, 3, false);
    pole.translate(0, 0.5, 0);
    // split heights so the red band has a crisp lower edge
    const pos = pole.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 0.3 && y < 0.4)
            pos.setY(i, 0.79);
        else if (y > 0.6 && y < 0.7)
            pos.setY(i, 0.81);
    }
    const white = lin('#e9e7e1');
    const red = lin('#c81f1a');
    bands(pole, (y) => (y > 0.8 ? red : white));
    const cap = new THREE.SphereGeometry(1.25, radial, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.9, 1);
    cap.translate(0, 1, 0);
    bands(cap, () => lin('#f4f7fb'));
    return mergeGeometries([pole.toNonIndexed(), cap.toNonIndexed()]);
}
/** Plow pole: a tapering birch stick with an orange reflective top. */
function plowPole(radial) {
    const stick = new THREE.CylinderGeometry(0.62, 1, 1, radial, 4, false);
    stick.translate(0, 0.5, 0);
    const birch = lin('#d8d3c8');
    const dark = lin('#5a5048');
    const orange = lin('#e0581b');
    const pos = stick.getAttribute('position');
    bands(stick, (y) => (y > 0.88 ? orange : y < 0.2 ? dark : birch));
    // darker knots and lenticels on the birch: per-vertex speckle
    const col = stick.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0.88)
            continue;
        const k = 0.75 + 0.25 * hash2(Math.round(pos.getX(i) * 50), Math.round(pos.getY(i) * 40), 7);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    return stick.toNonIndexed();
}
export function poleLevels() {
    return [
        { geometry: trailPole(8), maxDistance: 40 },
        { geometry: trailPole(4), maxDistance: Infinity },
    ];
}
export function plowPoleLevels() {
    return [
        { geometry: plowPole(6), maxDistance: 50 },
        { geometry: plowPole(3), maxDistance: Infinity },
    ];
}
export function poleMaterial() {
    return new THREE.MeshStandardMaterial({ name: 'snowPole', vertexColors: true, roughness: 0.55 });
}
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
/** Place poles along every path kind that has rules; returns the batches and the spots. */
export function buildPoles() {
    const trail = new InstanceBatch();
    const plow = new InstanceBatch();
    const spots = [];
    PATHS.forEach((def, pi) => {
        const rule = POLE_RULES[def.kind];
        if (!rule)
            return;
        const samples = samplePath(def, 1);
        const L = samples[samples.length - 1].s;
        const isPlow = def.kind === 'plowed';
        let k = 0;
        for (let s = rule.spacing * 0.5; s < L - 4; s += rule.spacing, k++) {
            const i = Math.min(samples.length - 1, Math.round(s));
            const p = samples[i];
            const sides = rule.both ? [k % 2 === 0 ? 1 : -1] : [hash2(pi, k, 31) < 0.5 ? 1 : -1];
            for (const side of sides) {
                const jitter = (hash2(pi, k, 32) - 0.5) * 0.5;
                const off = def.width * 0.5 + rule.offset + jitter;
                const x = p.x - p.tz * off * side;
                const z = p.z + p.tx * off * side;
                if (POLE_KEEPOUT.some((o) => Math.hypot(x - o.x, z - o.z) < o.r))
                    continue;
                const ground = heightAt(x, z);
                if (ground < 0.5)
                    continue;
                const bury = 0.35;
                const height = rule.height * (0.92 + 0.16 * hash2(pi, k, 33));
                const radius = isPlow ? 0.022 : 0.019;
                _e.set((hash2(pi, k, 34) - 0.5) * 0.08, hash2(pi, k, 35) * Math.PI * 2, (hash2(pi, k, 36) - 0.5) * 0.08);
                _q.setFromEuler(_e);
                _p.set(x, ground - bury, z);
                _s.set(radius, height + bury, radius);
                _m.compose(_p, _q, _s);
                const tint = 0.9 + 0.1 * hash2(pi, k, 37);
                (isPlow ? plow : trail).add(_m, tint, tint, tint, [], isPlow ? 260 : 170);
                spots.push({ x, z, y: ground, height, plow: isPlow });
            }
        }
    });
    return { trail, plow, spots };
}
