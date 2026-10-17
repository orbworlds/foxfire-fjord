/**
 * Walkable surfaces for walk mode in Lysvik: the plowed lanes, the
 * churchyard and its stair, the breakwater crests, looked up through a
 * coarse grid. Returns null where the terrain itself is the ground.
 */
import type { Box2 } from '../../world/layout';
import type { Frame } from './builder';
import { obbContains, type OBB } from './plan';

type Surf =
  | { kind: 'obb'; o: OBB; y: number }
  | { kind: 'seg'; ax: number; az: number; ay: number; bx: number; bz: number; by: number; hw: number }
  | { kind: 'ramp'; o: OBB; f: Frame; zA: number; yA: number; zB: number; yB: number; hw: number };

const CELL = 16;

export class WalkGround {
  readonly bounds: Box2 = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  private surfs: Surf[] = [];
  private grid = new Map<number, number[]>();
  /** extra flat surface (the quay apron), tested last */
  extra: ((x: number, z: number) => number | null) | null = null;

  addObb(o: OBB, y: number): void {
    this.push({ kind: 'obb', o, y }, obbBox(o, 0));
  }

  addSegment(a: { x: number; z: number; y: number }, b: { x: number; z: number; y: number }, hw: number): void {
    const box: Box2 = {
      minX: Math.min(a.x, b.x) - hw,
      maxX: Math.max(a.x, b.x) + hw,
      minZ: Math.min(a.z, b.z) - hw,
      maxZ: Math.max(a.z, b.z) + hw,
    };
    this.push({ kind: 'seg', ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw }, box);
  }

  /** linear ramp in frame `f` from local z = zA (height yA) to zB (yB), |local x| ≤ hw */
  addRamp(o: OBB, f: Frame, zA: number, yA: number, zB: number, yB: number, hw: number): void {
    this.push({ kind: 'ramp', o, f, zA, yA, zB, yB, hw }, obbBox(o, 0.2));
  }

  expand(b: Box2): void {
    this.bounds.minX = Math.min(this.bounds.minX, b.minX);
    this.bounds.maxX = Math.max(this.bounds.maxX, b.maxX);
    this.bounds.minZ = Math.min(this.bounds.minZ, b.minZ);
    this.bounds.maxZ = Math.max(this.bounds.maxZ, b.maxZ);
  }

  private push(s: Surf, b: Box2): void {
    const i = this.surfs.length;
    this.surfs.push(s);
    this.expand(b);
    for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
      for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) {
        const key = cz * 100003 + cx;
        let l = this.grid.get(key);
        if (!l) this.grid.set(key, (l = []));
        l.push(i);
      }
    }
  }

  height(x: number, z: number): number | null {
    let best: number | null = null;
    const l = this.grid.get(Math.floor(z / CELL) * 100003 + Math.floor(x / CELL));
    if (l) {
      for (const i of l) {
        const y = sample(this.surfs[i], x, z);
        if (y !== null && (best === null || y > best)) best = y;
      }
    }
    if (best === null && this.extra) best = this.extra(x, z);
    return best;
  }
}

function sample(s: Surf, x: number, z: number): number | null {
  if (s.kind === 'obb') return obbContains(s.o, x, z) ? s.y : null;
  if (s.kind === 'seg') {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
    const px = s.ax + dx * t - x;
    const pz = s.az + dz * t - z;
    if (px * px + pz * pz > s.hw * s.hw) return null;
    return s.ay + (s.by - s.ay) * t;
  }
  const f = s.f;
  const rx = x - f.ox;
  const rz = z - f.oz;
  const lx = rx * f.exx + rz * f.exz;
  const lz = rx * f.ezx + rz * f.ezz;
  if (Math.abs(lx) > s.hw) return null;
  const lo = Math.min(s.zA, s.zB);
  const hi = Math.max(s.zA, s.zB);
  if (lz < lo || lz > hi) return null;
  const t = (lz - s.zA) / (s.zB - s.zA || 1);
  return s.yA + (s.yB - s.yA) * t;
}

function obbBox(o: OBB, pad: number): Box2 {
  const ex = Math.abs(o.ux) * o.hx + Math.abs(o.uz) * o.hz + pad;
  const ez = Math.abs(o.uz) * o.hx + Math.abs(o.ux) * o.hz + pad;
  return { minX: o.cx - ex, maxX: o.cx + ex, minZ: o.cz - ez, maxZ: o.cz + ez };
}
