/**
 * Rope helpers: sagging tubes between two points (lantern strings, guy
 * ropes, handrails).
 */
import * as THREE from 'three';
class SagCurve extends THREE.Curve {
    a;
    b;
    sag;
    constructor(a, b, sag) {
        super();
        this.a = a;
        this.b = b;
        this.sag = sag;
    }
    getPoint(t, target = new THREE.Vector3()) {
        target.lerpVectors(this.a, this.b, t);
        target.y -= this.sag * 4 * t * (1 - t);
        return target;
    }
}
/** A tube from a to b sagging by `sag` meters at mid span. */
export function ropeGeometry(a, b, radius, sag = 0, segments = 12, radial = 5) {
    const g = new THREE.TubeGeometry(new SagCurve(a, b, sag), segments, radius, radial, false);
    // meter UVs along the rope so twisted-rope textures repeat at real scale
    const len = a.distanceTo(b);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * len, uv.getY(i) * radius * Math.PI * 2);
    return g;
}
