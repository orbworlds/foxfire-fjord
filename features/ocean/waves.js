/** Foxfire Fjord's swell: Gerstner components driven by the wind direction. */
import * as THREE from 'three';
const G = 9.81;
/**
 * A long, low winter swell from the open sea (~0.2–0.4 m) plus short wind
 * waves, travelling roughly downwind; the shader damps them to almost nothing
 * on the sheltered fjord and under the ice. Sorted by size so the
 * low-quality set keeps the big ones.
 */
export const WAVES = [
    { lambda: 132, amp: 0.13, angle: 0.0, steep: 0.35, phase: 0.0 },
    { lambda: 81, amp: 0.09, angle: 0.47, steep: 0.4, phase: 1.7 },
    { lambda: 46, amp: 0.055, angle: -0.6, steep: 0.45, phase: 4.1 },
    { lambda: 29, amp: 0.035, angle: 0.21, steep: 0.5, phase: 2.6 },
    { lambda: 19.5, amp: 0.024, angle: -0.95, steep: 0.55, phase: 5.3 },
    { lambda: 13.2, amp: 0.018, angle: 1.07, steep: 0.55, phase: 0.9 },
    { lambda: 9.7, amp: 0.013, angle: -0.33, steep: 0.6, phase: 3.4 },
    { lambda: 7.6, amp: 0.009, angle: 0.71, steep: 0.6, phase: 6.0 },
];
export function makeWaveUniforms(waves) {
    return {
        a: waves.map(() => new THREE.Vector4()),
        b: waves.map(() => new THREE.Vector4()),
    };
}
/** Writes wave directions from the wind direction (waves travel downwind). */
export function updateWaveUniforms(waves, wind, out) {
    const base = Math.atan2(wind.y, wind.x);
    waves.forEach((w, i) => {
        const k = (2 * Math.PI) / w.lambda;
        const ang = base + w.angle;
        out.a[i].set(Math.cos(ang), Math.sin(ang), k, w.amp);
        out.b[i].set(Math.sqrt(G * k), w.steep, w.phase, w.lambda);
    });
}
/** CPU estimate of the open-sea surface height (m) at (x, z) and time t (ignores shoaling). */
export function surfaceHeight(u, x, z, t) {
    let y = 0;
    for (let i = 0; i < u.a.length; i++) {
        const a = u.a[i];
        const b = u.b[i];
        y += a.w * Math.sin(a.z * (a.x * x + a.y * z) - b.x * t + b.z);
    }
    return y;
}
