import * as THREE from 'three';

export interface OceanGridOptions {
  /** inner lattice cell size (m); the caller snaps the mesh to this step */
  cell: number;
  /** inner lattice half size, in cells */
  inner: number;
  /** half size of the outermost ring (m) */
  outer: number;
  /** ring growth factor near the camera (radius multiplier per ring) */
  growth: number;
  /** growth factor reached far away (rings get coarse where the sea is flat) */
  farGrowth: number;
  /** radius (m) where growth starts ramping toward farGrowth, and where it arrives */
  rampFrom: number;
  rampTo: number;
}

/** Point on the unit square's perimeter, p ∈ [0, 4n), counter-clockwise from (-1, -1). */
function perimeter(p: number, n: number): [number, number] {
  const side = Math.floor(p / n);
  const t = (p - side * n) / n;
  switch (side) {
    case 0:
      return [-1 + 2 * t, -1];
    case 1:
      return [1, -1 + 2 * t];
    case 2:
      return [1 - 2 * t, 1];
    default:
      return [-1, 1 - 2 * t];
  }
}

/**
 * Camera-centred ocean grid as a single geometry: a regular lattice around the
 * origin (the caller snaps it to the lattice step in world space, so it never
 * swims) wrapped in square rings whose radius grows geometrically out to the
 * horizon. Every ring has as many segments per side as the lattice edge, so
 * there are no T-junctions anywhere. `aCell` is the local vertex spacing,
 * which the vertex shader uses to drop waves the mesh cannot resolve.
 */
export function buildOceanGrid(o: OceanGridOptions): THREE.BufferGeometry {
  const n = o.inner * 2;
  const pos: number[] = [];
  const cells: number[] = [];
  const idx: number[] = [];

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos.push((i - o.inner) * o.cell, 0, (j - o.inner) * o.cell);
      cells.push(o.cell);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  // lattice boundary in perimeter order
  let prev: number[] = [];
  for (let p = 0; p < 4 * n; p++) {
    const [ux, uz] = perimeter(p, n);
    const i = Math.round((ux + 1) * o.inner);
    const j = Math.round((uz + 1) * o.inner);
    prev.push(j * (n + 1) + i);
  }

  let r = o.inner * o.cell;
  while (r < o.outer) {
    const ramp = THREE.MathUtils.smoothstep(r, o.rampFrom, o.rampTo);
    const q = o.growth + (o.farGrowth - o.growth) * ramp;
    const rNext = Math.min(o.outer, r * q > o.outer * 0.92 ? o.outer : r * q);
    const spacing = Math.max((2 * rNext) / n, rNext - r);
    const cur: number[] = [];
    for (let p = 0; p < 4 * n; p++) {
      const [ux, uz] = perimeter(p, n);
      cur.push(pos.length / 3);
      pos.push(ux * rNext, 0, uz * rNext);
      cells.push(spacing);
    }
    for (let p = 0; p < 4 * n; p++) {
      const p1 = (p + 1) % (4 * n);
      const a = prev[p];
      const b = prev[p1];
      const c = cur[p];
      const d = cur[p1];
      // keep every triangle facing +y
      const ax = pos[a * 3];
      const az = pos[a * 3 + 2];
      const cross = (pos[c * 3 + 2] - az) * (pos[b * 3] - ax) - (pos[c * 3] - ax) * (pos[b * 3 + 2] - az);
      if (cross > 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
    prev = cur;
    r = rNext;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cells, 1));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.outer * Math.SQRT2);
  return geo;
}
