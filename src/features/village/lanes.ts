/**
 * Lysvik's lanes: plowed ribbons of compacted snow laid level across their
 * width over the terrain (wheel tracks, grit, a fresh edge), with the plow
 * banks thrown up along both sides, and street lamps on grey poles whose
 * warm light pools on the snow after dark. Where a lane runs out over
 * falling ground (across a terrace edge) a snow fill or a battered dry-stone
 * retaining wall with a snow cap carries it. Shovelled footpaths run from the
 * front doors to the lanes, through gaps cut in the plow banks. The road, the
 * beach path and the quay are carved by the terrain itself; they only get
 * lamps here.
 */
import { Frame, IDENTITY, type Vec3 } from './builder';
import { mulberry32 } from '../../world/noise';
import { STYLE, SCHED } from './materials';
import type { Kit, GlowParams } from './kit';
import { obbContains, type Lane, type OBB, type VillagePlan } from './plan';
import type { DoorPath } from './houses';

export interface LaneSurface {
  id: string;
  hw: number;
  pts: { x: number; z: number; y: number }[];
}

export function buildLanes(k: Kit, plan: VillagePlan, doors: DoorPath[] = []): LaneSurface[] {
  const h = k.h;
  const out: LaneSurface[] = [];
  const P = k.paving;
  P.frame = IDENTITY;
  const own = plan.lanes.filter((l) => l.kind !== 'carved');
  const paths = finishDoorPaths(plan, doors, h);
  // other lanes' points (in a coarse grid), to open the banks at junctions
  const CELL = 8;
  const grid = new Map<number, { x: number; z: number; r: number; lane: Lane }[]>();
  for (const l of plan.lanes) {
    const r = l.width / 2 + 2.2;
    for (const p of l.pts) {
      const key = Math.floor(p.z / CELL) * 100003 + Math.floor(p.x / CELL);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push({ x: p.x, z: p.z, r, lane: l });
    }
  }
  // the footpaths open the plow banks where they meet a lane
  const DOOR: Lane = { id: 'door', kind: 'lane', width: 1, pts: [], lamps: 0 };
  for (const fp of paths) {
    const [x, z] = fp.pts[fp.pts.length - 1];
    const key = Math.floor(z / CELL) * 100003 + Math.floor(x / CELL);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push({ x, z, r: 1.6, lane: DOOR });
  }
  const laneYs = new Map<string, number[]>();
  const near = (x: number, z: number, self: Lane): boolean => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        const list = grid.get(j * 100003 + i);
        if (!list) continue;
        for (const p of list) if (p.lane !== self && (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r) return true;
      }
    }
    return false;
  };
  for (const lane of own) {
    const pts = lane.pts;
    if (pts.length < 2) continue;
    const hw = lane.width / 2;
    const req = pts.map((p) => {
      const nx = -p.tz;
      const nz = p.tx;
      let m = -Infinity;
      for (const o of [-hw - 0.2, -hw * 0.5, 0, hw * 0.5, hw + 0.2]) m = Math.max(m, h(p.x + nx * o, p.z + nz * o));
      return m + 0.05;
    });
    // smooth along the lane, never dipping below the terrain
    let ys = req.slice();
    for (let pass = 0; pass < 4; pass++) {
      const nx = ys.slice();
      for (let i = 1; i < ys.length - 1; i++) nx[i] = Math.max(req[i], (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4);
      ys = nx;
    }
    P.setColor([1, 1, 1]);
    const across = [-1, -0.5, 0, 0.5, 1];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let j = 0; j < across.length - 1; j++) {
        const q: Vec3[] = [];
        const uv: [number, number][] = [];
        const corners: [number, number, number][] = [
          [a.x, a.z, across[j]],
          [b.x, b.z, across[j]],
          [b.x, b.z, across[j + 1]],
          [a.x, a.z, across[j + 1]],
        ];
        const base = P.vertexCount;
        corners.forEach(([x, z, t], c) => {
          const p = c === 0 || c === 3 ? a : b;
          const y = c === 0 || c === 3 ? ys[i] : ys[i + 1];
          const px = x - p.tz * t * hw;
          const pz = z + p.tx * t * hw;
          q.push([px, y, pz]);
          uv.push([px, pz]);
          P.set('aLane', t * hw, p.s, hw, 0);
          P.vertex(px, y, pz, 0, 1, 0, px, pz);
        });
        // flat-ish normal: from the quad
        P.tri(base, base + 2, base + 1);
        P.tri(base, base + 3, base + 2);
      }
    }
    // the plow banks, opened where other lanes join. Where the lane runs out over falling ground
    // (across a terrace edge) the bank stays on the lane's level and a fill slope of snow runs down
    // from under it to the terrain, so the lane never hangs over a void.
    const bankH = 0.55 + (lane.kind === 'street' ? 0.15 : 0);
    for (const side of [-1, 1]) {
      let run: number[] = [];
      const flush = () => {
        if (run.length > 2) {
          const idx = run;
          let hint = 0;
          const level = (x: number, z: number) => {
            // nearest lane point of this run (searched around the last hit: samples come in order)
            let best = hint;
            let bd = Infinity;
            for (let j = Math.max(0, hint - 6); j < Math.min(idx.length, hint + 7); j++) {
              const q = pts[idx[j]];
              const d = (q.x - x) ** 2 + (q.z - z) ** 2;
              if (d < bd) {
                bd = d;
                best = j;
              }
            }
            hint = best;
            return Math.max(h(x, z), ys[idx[best]] - 0.05);
          };
          const bp = idx.map((i): [number, number] => {
            const p = pts[i];
            const off = hw + 0.75;
            return [p.x - p.tz * off * side, p.z + p.tx * off * side];
          });
          k.bank(k.snow, bp, 1.7, bankH, side * 13 + lane.pts.length, level, -side);
          verge(k, idx.map((i) => pts[i]), idx.map((i) => ys[i]), hw, side, side * 31 + lane.pts.length);
        }
        run = [];
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const off = hw + 0.75;
        const x = p.x - p.tz * off * side;
        const z = p.z + p.tx * off * side;
        if (near(x, z, lane) || h(x, z) > ys[i] + 0.9) {
          flush();
          continue;
        }
        run.push(i);
      }
      flush();
    }
    out.push({ id: lane.id, hw, pts: pts.map((p, i) => ({ x: p.x, z: p.z, y: ys[i] })) });
    laneYs.set(lane.id, ys);
  }
  for (const fp of paths) footpath(k, fp, laneYs.get(fp.lane));
  // street lamps
  const r = mulberry32(9090);
  for (const lane of plan.lanes) {
    if (!lane.lamps) continue;
    const surf = out.find((s) => s.id === lane.id);
    let next = lane.lamps * 0.4;
    let side = 1;
    for (let i = 0; i < lane.pts.length; i++) {
      const p = lane.pts[i];
      if (p.s < next) continue;
      next = p.s + lane.lamps * (0.85 + r() * 0.3);
      const off = lane.width / 2 + (lane.kind === 'carved' ? 2.6 : 1.3);
      const x = p.x - p.tz * off * side;
      const z = p.z + p.tx * off * side;
      if (!plan.isFree(x, z, 0.5) && lane.kind !== 'carved') {
        side = -side;
        continue;
      }
      const y = h(x, z);
      const ly = surf ? surf.pts[i].y : h(p.x, p.z);
      // on falling ground the lamp stands on the lane's fill shoulder
      streetLamp(k, x, surf ? Math.min(Math.max(y, ly - 0.25), ly + 0.6) : Math.min(y, ly + 0.6), z, -p.tz * -side, p.tx * -side, r);
      side = -side;
    }
  }
  // lamps along the quay front
  const q = plan.quay;
  for (let x = q.minX + 12; x < q.maxX - 8; x += 28) {
    if (Math.abs(x - plan.plant.x) < plan.plant.w / 2 + 3 || Math.abs(x - plan.warehouse.x) < plan.warehouse.w / 2 + 3) continue;
    streetLamp(k, x, q.y, q.front + 1.6, 0, -1, r);
  }
  return out;
}

interface FootPath {
  /** world polyline, every ~0.8 m, from the foot of the steps to just inside the lane */
  pts: [number, number][];
  lane: string;
  /** index of the lane point it meets */
  at: number;
  /** the level it ends at, when not on a lane (the quay) */
  endY?: number;
  seed: number;
}

/**
 * Finish each door's path: on from its last point to the nearest point of its
 * lane (stopping just inside the lane's edge), dropped if it would run into a
 * building or is too long.
 */
export function finishDoorPaths(plan: VillagePlan, doors: DoorPath[], h: (x: number, z: number) => number): FootPath[] {
  const feet: OBB[] = [...plan.houses, ...plan.rorbuer, ...plan.naust, ...plan.stabbur, ...plan.sheds, plan.store, plan.plant, plan.warehouse, plan.churchyard.church, ...(plan.school ? [plan.school] : [])].map((l) => l.foot);
  const out: FootPath[] = [];
  doors.forEach((d, n) => {
    const lane = plan.lanes.find((l) => l.id === d.lane);
    const last = d.pts[d.pts.length - 1];
    const q = plan.quay;
    if (!lane && d.lane.startsWith('quay') && last[1] > q.back - 1 && last[1] - q.back < 14) {
      // the houses along the quay: straight out onto the quay
      const poly = [...d.pts, [last[0], q.back - 0.6] as [number, number]];
      const pts = resamplePath(poly);
      if (!blocked(pts, d)) out.push({ pts, lane: 'quay', at: 0, endY: q.y, seed: n * 7 + 3 });
      return;
    }
    if (!lane || lane.pts.length < 2) return;
    let at = 0;
    let best = Infinity;
    lane.pts.forEach((p, i) => {
      const dd = (p.x - last[0]) ** 2 + (p.z - last[1]) ** 2;
      if (dd < best) {
        best = dd;
        at = i;
      }
    });
    const lp = lane.pts[at];
    const dist = Math.sqrt(best);
    const hw = lane.width / 2;
    if (dist > 24) return;
    if (lane.kind !== 'carved') {
      // the lane sits level at its highest ground across: no path up a retaining wall
      const nx = -lp.tz;
      const nz = lp.tx;
      let top = -Infinity;
      for (const o of [-hw - 0.2, 0, hw + 0.2]) top = Math.max(top, h(lp.x + nx * o, lp.z + nz * o));
      if (top - h(last[0], last[1]) > 1.0) return;
    }
    const poly = d.pts.slice();
    if (dist > hw - 0.3) {
      const t = (hw - 0.3) / dist;
      poly.push([lp.x + (last[0] - lp.x) * t, lp.z + (last[1] - lp.z) * t]);
    } else poly[poly.length - 1] = [lp.x + (last[0] - lp.x) * 0.5, lp.z + (last[1] - lp.z) * 0.5];
    const pts = resamplePath(poly);
    if (!blocked(pts, d)) out.push({ pts, lane: lane.id, at, seed: n * 7 + 3 });
  });
  return out;

  /** never through a building (its own house only matters past the first metre) */
  function blocked(pts: [number, number][], d: DoorPath): boolean {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (const f of feet) {
        if (f === d.lot.foot && s < 1.0) continue;
        if (obbContains(f, pts[i][0], pts[i][1], 0.35)) return true;
      }
    }
    return false;
  }
}

/** a polyline resampled every ~0.8 m */
function resamplePath(poly: [number, number][]): [number, number][] {
  const pts: [number, number][] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const [ax, az] = poly[i - 1];
    const [bx, bz] = poly[i];
    const L = Math.hypot(bx - ax, bz - az);
    const m = Math.max(1, Math.ceil(L / 0.8));
    for (let j = 1; j <= m; j++) pts.push([ax + ((bx - ax) * j) / m, az + ((bz - az) * j) / m]);
  }
  return pts;
}

/** a shovelled footpath: packed snow half a metre either side of its line, low banks thrown up along it */
function footpath(k: Kit, fp: FootPath, laneYs?: number[]): void {
  const h = k.h;
  const P = k.paving;
  P.frame = IDENTITY;
  P.setColor([0.97, 0.97, 0.98]);
  const pts = fp.pts;
  const n = pts.length;
  const hw = 0.5;
  const end = pts[n - 1];
  const endY = fp.endY ?? (laneYs ? laneYs[fp.at] : h(end[0], end[1]));
  const tan = (i: number): [number, number] => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // the path rises to the lane's level over its last metres (the lane may sit on a fill)
  const yAt = (x: number, z: number) => {
    const toEnd = Math.hypot(x - end[0], z - end[1]);
    return Math.max(h(x, z) + 0.035, endY - 0.03 - toEnd * 0.45);
  };
  let s = 0;
  const across = [-1, 0, 1];
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [tx, tz] = tan(i);
    for (const a of across) {
      const x = pts[i][0] - tz * a * hw;
      const z = pts[i][1] + tx * a * hw;
      P.set('aLane', a * hw, s, hw, 1);
      P.vertex(x, yAt(x, z), z, 0, 1, 0, x, z);
    }
  }
  const base = P.vertexCount - n * 3;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < 2; j++) {
      const a = base + i * 3 + j;
      P.tri(a, a + 1, a + 3);
      P.tri(a + 1, a + 4, a + 3);
    }
  }
  // the banks: from a metre out of the door to a metre short of the lane
  let run = 0;
  const lens: number[] = [0];
  for (let i = 1; i < n; i++) lens.push((run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
  const total = run;
  if (total < 3) return;
  for (const side of [-1, 1]) {
    const bp: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (lens[i] < 0.9 || lens[i] > total - 1.4) continue;
      const [tx, tz] = tan(i);
      const off = hw + 0.28;
      bp.push([pts[i][0] - tz * off * side, pts[i][1] + tx * off * side]);
    }
    if (bp.length > 2) k.bank(k.nearSnow, bp, 0.6, 0.2, fp.seed + side * 5, yAt, -side);
  }
}

/**
 * The ground under a lane's outer edge where the terrain falls away: a snow
 * fill slope from under the plow bank (at the lane's level) out and down to
 * the terrain where the drop is small, and a battered dry-stone retaining
 * wall with a low parapet and a cap of snow where it is a metre or more.
 * Where the ground does not fall away the fill stays buried.
 */
function verge(k: Kit, pts: { x: number; z: number; tx: number; tz: number }[], ys: number[], hw: number, side: number, seed: number): void {
  const h = k.h;
  const n = pts.length;
  const o0 = hw + 0.8;
  const oW = hw + 1.5;
  const nrm = (i: number): [number, number] => [-pts[i].tz * side, pts[i].tx * side];
  let drop = pts.map((p, i) => {
    const [nx, nz] = nrm(i);
    return ys[i] - 0.1 - Math.min(h(p.x + nx * (o0 + 1), p.z + nz * (o0 + 1)), h(p.x + nx * (oW + 0.6), p.z + nz * (oW + 0.6)));
  });
  if (Math.max(...drop) < 0.3) return;
  for (let pass = 0; pass < 2; pass++) drop = drop.map((d, i) => (drop[Math.max(0, i - 1)] + d * 2 + drop[Math.min(n - 1, i + 1)]) / 4);
  const wall = drop.map((d) => d > 1.0);
  // drop single-point walls / gaps
  for (let i = 1; i < n - 1; i++) if (wall[i - 1] === wall[i + 1] && wall[i] !== wall[i - 1]) wall[i] = wall[i - 1];

  /* the fill slope: about 1 : 1.4, collapsed to a short shoulder behind a wall */
  let D = drop.map((d, i) => (wall[i] ? 0 : Math.min(9, Math.max(0.8, d * 1.4 + 0.8))));
  for (let pass = 0; pass < 3; pass++) D = D.map((d, i) => (wall[i] ? 0 : Math.max(d, (D[Math.max(0, i - 1)] + d * 2 + D[Math.min(n - 1, i + 1)]) / 4)));
  const T = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1, 1.15];
  const cols = side > 0 ? T : T.slice().reverse();
  const P: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const [nx, nz] = nrm(i);
    const top = ys[i] - 0.1;
    for (const t of cols) {
      const o = o0 + t * (D[i] + 0.6);
      const x = p.x + nx * o;
      const z = p.z + nz * o;
      const g = h(x, z);
      const e = Math.min(1, t);
      // a convex shoulder, a straight face, a concave toe
      const sm = e * e * (3 - 2 * e);
      const y = t >= 1 ? g - 0.12 : Math.max(g - 0.1, top + (g - top) * sm);
      P.push([x, y, z]);
    }
  }
  k.snow.frame = IDENTITY;
  k.gridMesh(k.snow, P, cols.length, n, k.snow.vertexCount, false);

  /* retaining walls */
  const S = k.stone;
  S.frame = IDENTITY;
  S.setColor([1.12, 1.12, 1.16]);
  let i0 = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && wall[i];
    if (on && i0 < 0) i0 = i;
    if (!on && i0 >= 0) {
      // one point beyond each end, where the drop is small, so the wall dies into the fill
      retainingWall(k, pts, ys, Math.max(0, i0 - 1), Math.min(n - 1, i), side, oW, seed + i0);
      i0 = -1;
    }
  }
}

function retainingWall(k: Kit, pts: { x: number; z: number; tx: number; tz: number }[], ys: number[], a: number, b: number, side: number, oW: number, seed: number): void {
  if (b - a < 1) return;
  const h = k.h;
  const S = k.stone;
  const thick = 0.5;
  const para = 0.32;
  type Sec = { ot: Vec3; ob: Vec3; it: Vec3; ib: Vec3; s: number };
  const secs: Sec[] = [];
  let s = 0;
  for (let i = a; i <= b; i++) {
    const p = pts[i];
    if (i > a) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const nx = -p.tz * side;
    const nz = p.tx * side;
    const top = ys[i] + para;
    const g = h(p.x + nx * oW, p.z + nz * oW);
    const H = top - g;
    // battered: the face leans back into the bank, its foot a little further out
    const batter = Math.max(0, H) * 0.12;
    const ob: Vec3 = [p.x + nx * (oW + batter), Math.min(g, top - 0.2) - 0.45, p.z + nz * (oW + batter)];
    secs.push({
      ot: [p.x + nx * oW, top, p.z + nz * oW],
      ob,
      it: [p.x + nx * (oW - thick), top, p.z + nz * (oW - thick)],
      ib: [p.x + nx * (oW - thick), ys[i] - 0.35, p.z + nz * (oW - thick)],
      s,
    });
  }
  for (let j = 0; j < secs.length - 1; j++) {
    const A = secs[j];
    const B = secs[j + 1];
    const nx = -pts[a + j].tz * side;
    const nz = pts[a + j].tx * side;
    // blocks walkers below it; from the lane one can step over the low parapet
    k.walls.push([(A.ot[0] + A.it[0]) / 2, (A.ot[2] + A.it[2]) / 2, (B.ot[0] + B.it[0]) / 2, (B.ot[2] + B.it[2]) / 2, Math.min(A.ob[1], B.ob[1]) - 1, Math.min(A.ot[1], B.ot[1]) - 0.45]);
    // outer face (u along the wall, v height), top, inner face
    S.polyN([A.ob, B.ob, B.ot, A.ot], [[A.s, A.ob[1]], [B.s, B.ob[1]], [B.s, B.ot[1]], [A.s, A.ot[1]]], [nx, 0, nz]);
    S.polyN([A.ot, B.ot, B.it, A.it], [[A.s, 0], [B.s, 0], [B.s, thick], [A.s, thick]], [0, 1, 0]);
    S.polyN([A.it, B.it, B.ib, A.ib], [[A.s, A.it[1]], [B.s, B.it[1]], [B.s, B.ib[1]], [A.s, A.ib[1]]], [-nx, 0, -nz]);
  }
  // end faces
  for (const [E, dir] of [
    [secs[0], -1],
    [secs[secs.length - 1], 1],
  ] as const) {
    const p = pts[dir < 0 ? a : b];
    S.polyN([E.ib, E.ob, E.ot, E.it], [[0, E.ib[1]], [thick, E.ob[1]], [thick, E.ot[1]], [0, E.it[1]]], [p.tx * dir, 0, p.tz * dir]);
  }
  // a drift banked against the foot of the wall, highest where the wall is tallest
  const foot: [number, number][] = [];
  let tall = 0;
  for (let i = a; i <= b; i++) {
    const p = pts[i];
    const off = oW + 0.35;
    foot.push([p.x - p.tz * side * off, p.z + p.tx * side * off]);
    tall = Math.max(tall, secs[i - a].ot[1] - secs[i - a].ob[1]);
  }
  k.bank(k.snow, foot, 2.4, Math.min(0.9, 0.25 + tall * 0.18), seed + 7, undefined, -side);
  // a cap of snow along the top, a little overhanging on the drop side
  const cap: [number, number][] = secs.map((c) => [c.ot[0] * 0.75 + c.it[0] * 0.25, c.ot[2] * 0.75 + c.it[2] * 0.25]);
  let hint = 0;
  const level = (x: number, z: number) => {
    let best = hint;
    let bd = Infinity;
    for (let j = Math.max(0, hint - 4); j < Math.min(cap.length, hint + 5); j++) {
      const d = (cap[j][0] - x) ** 2 + (cap[j][1] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    hint = best;
    return secs[best].ot[1] + 0.02;
  };
  k.bank(k.snow, cap, thick + 0.42, 0.38, seed, level);
}

/**
 * A street lamp: a slender grey pole with a curved arm and a lantern head,
 * the light switched on at dusk; the lanes below get a pool of light and the
 * snow around a soft warm patch.
 */
export function streetLamp(k: Kit, x: number, y: number, z: number, ax: number, az: number, r: () => number): void {
  const F = Frame.facing(x, y, z, ax, az);
  const Fa = k.facade;
  Fa.frame = F;
  k.style(Fa, STYLE.paint, 0, 0, x);
  Fa.setColor([0.32, 0.33, 0.34]);
  const H = 5.6;
  Fa.cylinder(0, -0.3, 0, 0.09, 0.055, H + 0.3, 6, false);
  Fa.beam([0, H - 0.05, 0], [0, H + 0.2, 0.35], 0.05, 0.05);
  Fa.beam([0, H + 0.2, 0.35], [0, H + 0.15, 0.95], 0.05, 0.05);
  Fa.setColor([0.12, 0.12, 0.13]);
  Fa.cylinder(0, H - 0.05, 0.95, 0.3, 0.08, 0.22, 8, true);
  const g: GlowParams = { threshold: 0.04 + r() * 0.08, warmth: 0.48 + r() * 0.1, intensity: 2.6, seed: r(), sched: SCHED.street };
  k.lampGlass(k.glow, F, 0, H - 0.1, 0.95, 0.3, 0.06, 0.3, g, { size: 0.5, minPx: 2.6, gain: 2.0 }, 'Y');
  k.nearSnow.frame = F;
  k.pillow(k.nearSnow, 0, H + 0.17, 0.95, 0.46, 0.46, 0.06, x, 2, 2);
  const lx = F.wx(0, 0.95);
  const lz = F.wz(0, 0.95);
  k.lamps.push([lx, y + H - 0.15, lz, 7]);
  k.groundPool(lx, lz, 5.5, g, 0.3);
}
