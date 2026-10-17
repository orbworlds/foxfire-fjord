/**
 * The fox's round: a closed loop from the cabin's north brink east along the
 * edge of the woods, down to Mirror Lake's north shore, out across the ice
 * past the fishing hut (it knows the fisher drops things), back over the ice
 * past the rink to the west shore and home through the trees along the lake
 * path. Places on the way where it sits, sniffs or pounces on voles under
 * the snow. About a kilometre: a quarter of an hour at a fox's trot.
 */
import type { TreeHit } from '../flora';

export type FoxEventKind = 'sit' | 'sniff' | 'pounce' | 'look';

export interface FoxEvent {
  /** index of the control point it happens at */
  at: number;
  kind: FoxEventKind;
  /** seconds (sits at night under the aurora last longer) */
  dur: number;
  /** heading to face while sitting (rad, 0 = +z south, PI = north) */
  face?: number;
}

/** control points (world xz), the loop closes back to the first */
export const ROUTE: [number, number][] = [
  [-10, -17.5],
  [6, -19],
  [20, -16],
  [38, -12],
  [75, -15],
  [120, -10],
  [165, 15],
  [205, 45],
  [245, 66],
  [275, 48],
  [300, 30],
  [360, 16],
  [420, 30],
  [452, 92],
  [446, 140],
  [436, 171],
  [405, 160],
  [360, 140],
  [300, 135],
  [262, 146],
  [245, 118],
  [225, 96],
  [190, 72],
  [150, 54],
  [110, 40],
  [70, 26],
  [40, 22],
  [13, 24],
  [11, 4],
  [12, -12],
];

export const EVENTS: FoxEvent[] = [
  // the cabin's brink: a seat above the fjord facing the Teeth and the lights
  { at: 0, kind: 'sit', dur: 30, face: Math.PI },
  { at: 4, kind: 'sniff', dur: 5 },
  { at: 6, kind: 'pounce', dur: 4.2 },
  { at: 11, kind: 'sit', dur: 22, face: Math.PI - 0.2 },
  { at: 15, kind: 'sniff', dur: 7 },
  { at: 18, kind: 'look', dur: 4 },
  { at: 24, kind: 'pounce', dur: 4.2 },
  { at: 26, kind: 'sniff', dur: 4 },
];

export interface RoutePath {
  x: Float32Array;
  z: Float32Array;
  /** cumulative distance at each sample */
  s: Float32Array;
  length: number;
  /** distance along the path of each control point */
  at: number[];
}

/** Closed Catmull-Rom through the control points, sampled every ~`step` m, pushed clear of tree trunks. */
export function buildPath(step: number, treesNear?: (x: number, z: number, r: number) => TreeHit[]): RoutePath {
  const P = ROUTE;
  const n = P.length;
  const xs: number[] = [];
  const zs: number[] = [];
  const atIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(2, Math.ceil(len / step));
    atIdx.push(xs.length);
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(cr(p0[0], p1[0], p2[0], p3[0]));
      zs.push(cr(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const N = xs.length;
  // keep clear of trunks: push away, then smooth, a few times
  if (treesNear) {
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < N; i++) {
        for (const t of treesNear(xs[i], zs[i], 2.2)) {
          const clear = t.kind === 2 ? 0.7 : 1.3 + Math.min(1.2, t.r * 0.25);
          const dx = xs[i] - t.x;
          const dz = zs[i] - t.z;
          const d = Math.hypot(dx, dz) || 1e-3;
          if (d < clear) {
            const k = (clear - d) / d;
            xs[i] += dx * k;
            zs[i] += dz * k;
          }
        }
      }
      const sx = xs.slice();
      const sz = zs.slice();
      for (let i = 0; i < N; i++) {
        const a = (i - 1 + N) % N;
        const b = (i + 1) % N;
        xs[i] = (sx[a] + sx[i] * 2 + sx[b]) / 4;
        zs[i] = (sz[a] + sz[i] * 2 + sz[b]) / 4;
      }
    }
  }
  const s = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) s[i] = s[i - 1] + Math.hypot(xs[i % N] - xs[i - 1], zs[i % N] - zs[i - 1]);
  return {
    x: Float32Array.from([...xs, xs[0]]),
    z: Float32Array.from([...zs, zs[0]]),
    s,
    length: s[N],
    at: atIdx.map((i) => s[i]),
  };
}

/** Point and unit tangent at distance `d` along the (closed) path. */
export function pathAt(p: RoutePath, d: number, out: { x: number; z: number; tx: number; tz: number }): typeof out {
  const L = p.length;
  let s = d % L;
  if (s < 0) s += L;
  // binary search the segment
  let lo = 0;
  let hi = p.s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = p.s[hi] - p.s[lo] || 1e-6;
  const t = (s - p.s[lo]) / seg;
  out.x = p.x[lo] + (p.x[hi] - p.x[lo]) * t;
  out.z = p.z[lo] + (p.z[hi] - p.z[lo]) * t;
  const tx = p.x[hi] - p.x[lo];
  const tz = p.z[hi] - p.z[lo];
  const l = Math.hypot(tx, tz) || 1;
  out.tx = tx / l;
  out.tz = tz / l;
  return out;
}
