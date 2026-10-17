/**
 * Snowdrifts as soft mounds that grow out of the ground: a grid over an
 * ellipse whose height is the ground plus a smooth, slightly lopsided bump
 * (steeper on the windward side, a long tail in the lee), its rim sunk a
 * little below the surface so it blends into the terrain without a seam.
 * Use with `materials.get('snowPack')`.
 */
import * as THREE from 'three';
import { applyBoxUV } from '../../core/geometry';

export interface DriftOptions {
  /** rotation of the long axis (rx) from +x toward +z (rad) */
  rot?: number;
  /** grid resolution across each axis */
  seg?: number;
  /** how far the rim sinks below the ground (m) */
  sink?: number;
  /** lopsidedness along the long axis: > 0 piles the crest toward -x (local) with a long tail toward +x */
  skew?: number;
}

export function driftGeometry(cx: number, cz: number, rx: number, rz: number, h: number, ground: (x: number, z: number) => number, o: DriftOptions = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 14;
  const sink = o.sink ?? 0.04;
  const skew = o.skew ?? 0.35;
  const c = Math.cos(o.rot ?? 0);
  const s = Math.sin(o.rot ?? 0);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * 2 - 1;
      const v = (j / seg) * 2 - 1;
      // squash the grid toward a disc so the corners do not stick out
      const m = Math.max(Math.abs(u), Math.abs(v));
      const l = Math.hypot(u, v) || 1;
      const du = (u / l) * m;
      const dv = (v / l) * m;
      const lx = du * rx;
      const lz = dv * rz;
      const x = cx + lx * c - lz * s;
      const z = cz + lx * s + lz * c;
      // lopsided profile: the crest sits windward of the middle
      const uu = du < -skew * 0.5 ? (du + skew * 0.5) / (1 - skew * 0.5) : (du + skew * 0.5) / (1 + skew * 0.5);
      const r2 = uu * uu + dv * dv;
      const f = Math.exp(-2.6 * r2) * (1 - THREE.MathUtils.smoothstep(Math.sqrt(r2), 0.82, 1.0));
      pos.push(x, ground(x, z) + h * f - sink * (1 - f), z);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1;
      const d = a + seg + 1;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face up
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  if (n.getY(Math.floor(n.count / 2)) < 0) {
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return applyBoxUV(g);
}
