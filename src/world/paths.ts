/**
 * Path geometry helpers. All features that draw or follow paths must use
 * `samplePath` so that the terrain carving, ground masks, snow poles and
 * signposts agree on the exact curve.
 */
import type { PathDef } from './layout';

export interface PathSample {
  x: number;
  z: number;
  /** arc length from the start of the path (m) */
  s: number;
  /** unit tangent */
  tx: number;
  tz: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const cache = new Map<string, PathSample[]>();

/** Smooth (Catmull-Rom) resampling of a path at roughly `spacing` meters. */
export function samplePath(path: PathDef, spacing = 2): PathSample[] {
  const key = `${path.id}:${spacing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pts = path.points;
  const raw: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / (spacing * 0.5)));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      raw.push([catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  raw.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);

  // re-parameterize by arc length at uniform spacing
  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1];
  const count = Math.max(2, Math.round(total / spacing) + 1);
  const out: PathSample[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (total * k) / (count - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (s - cum[j]) / seg;
    const x = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t;
    const z = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t;
    out.push({ x, z, s, tx: 0, tz: 0 });
  }
  for (let k = 0; k < out.length; k++) {
    const a = out[Math.max(0, k - 1)];
    const b = out[Math.min(out.length - 1, k + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out[k].tx = dx / len;
    out[k].tz = dz / len;
  }
  cache.set(key, out);
  return out;
}
