import * as THREE from 'three';

/**
 * Minimal geometry accumulator for large merged meshes. Every primitive is
 * pushed in the coordinates of the current `Frame` (a rotation about Y plus a
 * translation), with flat normals, meter UVs, a vertex color and any number of
 * custom per-vertex attributes held as "current state".
 */
export class Frame {
  constructor(
    public ox = 0,
    public oy = 0,
    public oz = 0,
    /** world direction of local +x (unit, xz) */
    public exx = 1,
    public exz = 0,
  ) {}

  /** local +z in world: ez = (-ex.z, ex.x) keeps the frame right-handed with +y up */
  get ezx(): number {
    return -this.exz;
  }
  get ezz(): number {
    return this.exx;
  }

  static fromAngle(ox: number, oy: number, oz: number, angle: number): Frame {
    return new Frame(ox, oy, oz, Math.cos(angle), -Math.sin(angle));
  }

  /** frame whose local +z points along (dx, dz) */
  static facing(ox: number, oy: number, oz: number, dx: number, dz: number): Frame {
    const l = Math.hypot(dx, dz) || 1;
    const zx = dx / l;
    const zz = dz / l;
    return new Frame(ox, oy, oz, zz, -zx);
  }

  child(lx: number, ly: number, lz: number, angle = 0): Frame {
    const c = Math.cos(angle);
    const s = -Math.sin(angle);
    const exx = this.exx * c + this.ezx * s;
    const exz = this.exz * c + this.ezz * s;
    return new Frame(this.wx(lx, lz), this.oy + ly, this.wz(lx, lz), exx, exz);
  }

  wx(lx: number, lz: number): number {
    return this.ox + lx * this.exx + lz * this.ezx;
  }
  wz(lx: number, lz: number): number {
    return this.oz + lx * this.exz + lz * this.ezz;
  }
}

export const IDENTITY = new Frame();

type Vec3 = [number, number, number];

/** a growable Float32Array */
class Buf {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(cap);
  }
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}

export class GeoBuilder {
  private pos = new Buf(3 * 1024);
  private nor = new Buf(3 * 1024);
  private uvs = new Buf(2 * 1024);
  private col = new Buf(3 * 1024);
  private idx = new Uint32Array(4096);
  private nIdx = 0;
  private extras: { name: string; size: number; data: Buf; cur: number[] }[] = [];
  private extraMap = new Map<string, { name: string; size: number; data: Buf; cur: number[] }>();
  frame: Frame = IDENTITY;
  color: Vec3 = [1, 1, 1];

  constructor(extra: Record<string, number> = {}) {
    for (const [name, size] of Object.entries(extra)) {
      const e = { name, size, data: new Buf(size * 1024), cur: new Array(size).fill(0) };
      this.extras.push(e);
      this.extraMap.set(name, e);
    }
  }

  get vertexCount(): number {
    return this.pos.n / 3;
  }

  setColor(c: THREE.Color | Vec3): this {
    if (Array.isArray(c)) this.color = [c[0], c[1], c[2]];
    else this.color = [c.r, c.g, c.b];
    return this;
  }

  set(name: string, ...values: number[]): this {
    const e = this.extraMap.get(name);
    if (!e) throw new Error(`unknown attribute ${name}`);
    for (let i = 0; i < e.size; i++) e.cur[i] = values[i] ?? 0;
    return this;
  }

  /** push one vertex given in local frame coordinates, returns its index */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const f = this.frame;
    const P = this.pos;
    if (P.n + 3 > P.a.length) P.reserve(3);
    let i = P.n;
    P.a[i] = f.wx(x, z);
    P.a[i + 1] = f.oy + y;
    P.a[i + 2] = f.wz(x, z);
    P.n = i + 3;
    const N = this.nor;
    if (N.n + 3 > N.a.length) N.reserve(3);
    i = N.n;
    N.a[i] = nx * f.exx + nz * f.ezx;
    N.a[i + 1] = ny;
    N.a[i + 2] = nx * f.exz + nz * f.ezz;
    N.n = i + 3;
    const U = this.uvs;
    if (U.n + 2 > U.a.length) U.reserve(2);
    U.a[U.n] = u;
    U.a[U.n + 1] = v;
    U.n += 2;
    const C = this.col;
    if (C.n + 3 > C.a.length) C.reserve(3);
    C.a[C.n] = this.color[0];
    C.a[C.n + 1] = this.color[1];
    C.a[C.n + 2] = this.color[2];
    C.n += 3;
    for (let e = 0; e < this.extras.length; e++) {
      const ex = this.extras[e];
      if (ex.data.n + ex.size > ex.data.a.length) ex.data.reserve(ex.size);
      for (let k = 0; k < ex.size; k++) ex.data.a[ex.data.n + k] = ex.cur[k];
      ex.data.n += ex.size;
    }
    return P.n / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    if (this.nIdx + 3 > this.idx.length) {
      const n = new Uint32Array(this.idx.length * 2);
      n.set(this.idx);
      this.idx = n;
    }
    this.idx[this.nIdx++] = a;
    this.idx[this.nIdx++] = b;
    this.idx[this.nIdx++] = c;
  }

  /**
   * Planar polygon (convex, counter-clockwise seen from the front) with flat normal.
   * `uv` gives one [u, v] pair per point.
   */
  poly(pts: Vec3[], uv: [number, number][]): void {
    const n = computeNormal(pts);
    const base = this.vertexCount;
    for (let i = 0; i < pts.length; i++) this.vertex(pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1]);
    for (let i = 1; i < pts.length - 1; i++) this.tri(base, base + i, base + i + 1);
  }

  /** quad p0..p3 counter-clockwise seen from the front */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, uv?: [number, number][]): void {
    this.poly([p0, p1, p2, p3], uv ?? planarUV([p0, p1, p2, p3]));
  }

  /** polygon whose winding is flipped if needed so the normal agrees with `hint` */
  polyN(pts: Vec3[], uv: [number, number][] | null, hint: Vec3): void {
    const n = computeNormal(pts);
    const uvs = uv ?? planarUV(pts);
    if (dot(n, hint) < 0) this.poly(pts.slice().reverse(), uvs.slice().reverse());
    else this.poly(pts, uvs);
  }

  /** round tube (smooth sides) between two local points */
  tube(a: Vec3, b: Vec3, r0: number, r1: number, seg = 6, caps = false): void {
    const d = normalize(sub(b, a));
    const L = len(sub(b, a));
    let s: Vec3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : normalize([-d[2], 0, d[0]]);
    const up = cross(s, d);
    s = cross(d, up);
    const base = this.vertexCount;
    const circ = Math.PI * 2 * Math.max(r0, r1);
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const c = Math.cos(ang);
      const si = Math.sin(ang);
      const n: Vec3 = [s[0] * c + up[0] * si, s[1] * c + up[1] * si, s[2] * c + up[2] * si];
      this.vertex(a[0] + n[0] * r0, a[1] + n[1] * r0, a[2] + n[2] * r0, n[0], n[1], n[2], (i / seg) * circ, 0);
      this.vertex(b[0] + n[0] * r1, b[1] + n[1] * r1, b[2] + n[2] * r1, n[0], n[1], n[2], (i / seg) * circ, L);
    }
    for (let i = 0; i < seg; i++) {
      const k = base + i * 2;
      this.tri(k, k + 3, k + 2);
      this.tri(k, k + 1, k + 3);
    }
    if (caps) {
      const ring = (p: Vec3, r: number): Vec3[] => {
        const out: Vec3[] = [];
        for (let i = 0; i < seg; i++) {
          const ang = (i / seg) * Math.PI * 2;
          const c = Math.cos(ang);
          const si = Math.sin(ang);
          out.push([p[0] + (s[0] * c + up[0] * si) * r, p[1] + (s[1] * c + up[1] * si) * r, p[2] + (s[2] * c + up[2] * si) * r]);
        }
        return out;
      };
      if (r1 > 1e-4) this.polyN(ring(b, r1), null, d);
      if (r0 > 1e-4) this.polyN(ring(a, r0), null, [-d[0], -d[1], -d[2]]);
    }
  }

  /**
   * Axis-aligned box in the local frame. `faces` skips sides: string of
   * letters from 'xXyYzZ' (lower = negative side) to OMIT.
   * UVs: u runs horizontally along each side face starting at that face's
   * left corner, v = y - (cy - sy/2) + vOffset (height from the box base).
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, omit = '', vOffset = 0): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const vo = vOffset;
    // a quad with a known normal (no allocation): corners a,b,c,d counter-clockwise from outside
    const q = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx2: number, cy2: number, cz2: number, dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number, u0: number, v0: number, u1: number, v1: number,
    ) => {
      const base = this.vertexCount;
      this.vertex(ax, ay, az, nx, ny, nz, u0, v0);
      this.vertex(bx, by, bz, nx, ny, nz, u1, v0);
      this.vertex(cx2, cy2, cz2, nx, ny, nz, u1, v1);
      this.vertex(dx, dy, dz, nx, ny, nz, u0, v1);
      this.tri(base, base + 1, base + 2);
      this.tri(base, base + 2, base + 3);
    };
    if (!omit.includes('Z')) q(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, 0, vo, sx, vo + sy);
    if (!omit.includes('z')) q(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, 0, vo, sx, vo + sy);
    if (!omit.includes('X')) q(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, 0, vo, sz, vo + sy);
    if (!omit.includes('x')) q(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, 0, vo, sz, vo + sy);
    if (!omit.includes('Y')) {
      const base = this.vertexCount;
      this.vertex(x0, y1, z1, 0, 1, 0, x0, z1);
      this.vertex(x1, y1, z1, 0, 1, 0, x1, z1);
      this.vertex(x1, y1, z0, 0, 1, 0, x1, z0);
      this.vertex(x0, y1, z0, 0, 1, 0, x0, z0);
      this.tri(base, base + 1, base + 2);
      this.tri(base, base + 2, base + 3);
    }
    if (!omit.includes('y')) {
      const base = this.vertexCount;
      this.vertex(x0, y0, z0, 0, -1, 0, x0, z0);
      this.vertex(x1, y0, z0, 0, -1, 0, x1, z0);
      this.vertex(x1, y0, z1, 0, -1, 0, x1, z1);
      this.vertex(x0, y0, z1, 0, -1, 0, x0, z1);
      this.tri(base, base + 1, base + 2);
      this.tri(base, base + 2, base + 3);
    }
  }

  /** box between two local points (a thick segment), square cross-section `w`×`h` */
  beam(a: Vec3, b: Vec3, w: number, h: number): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const d: Vec3 = [dx / L, dy / L, dz / L];
    // side vector: horizontal perpendicular (or x if vertical)
    let s: Vec3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : normalize([-d[2], 0, d[0]]);
    const up = cross(s, d);
    s = cross(d, up);
    const hw = w / 2;
    const hh = h / 2;
    const corner = (p: Vec3, a1: number, a2: number): Vec3 => [p[0] + s[0] * a1 + up[0] * a2, p[1] + s[1] * a1 + up[1] * a2, p[2] + s[2] * a1 + up[2] * a2];
    const A = [corner(a, -hw, -hh), corner(a, hw, -hh), corner(a, hw, hh), corner(a, -hw, hh)];
    const B = [corner(b, -hw, -hh), corner(b, hw, -hh), corner(b, hw, hh), corner(b, -hw, hh)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const sideLen = i % 2 === 0 ? w : h;
      this.poly([A[j], A[i], B[i], B[j]], [
        [0, 0],
        [sideLen, 0],
        [sideLen, L],
        [0, L],
      ]);
    }
    this.poly([A[0], A[1], A[2], A[3]], [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]);
    this.poly([B[3], B[2], B[1], B[0]], [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]);
  }

  /** vertical cylinder / cone frustum (local), `seg` sides, optional caps */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg = 8, caps = true): void {
    const base = this.vertexCount;
    const slope = (r0 - r1) / h;
    const ny = slope / Math.hypot(1, slope);
    const nr = 1 / Math.hypot(1, slope);
    const circ = Math.PI * 2 * Math.max(r0, r1);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.vertex(cx + c * r0, y0, cz + s * r0, c * nr, ny, s * nr, (i / seg) * circ, 0);
      this.vertex(cx + c * r1, y0 + h, cz + s * r1, c * nr, ny, s * nr, (i / seg) * circ, h);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.tri(a, a + 1, a + 3);
      this.tri(a, a + 3, a + 2);
    }
    if (caps) {
      if (r1 > 1e-4) {
        const top: Vec3[] = [];
        const tuv: [number, number][] = [];
        for (let i = seg - 1; i >= 0; i--) {
          const a = (i / seg) * Math.PI * 2;
          top.push([cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1]);
          tuv.push([Math.cos(a) * r1, Math.sin(a) * r1]);
        }
        this.poly(top, tuv);
      }
      if (r0 > 1e-4) {
        const bot: Vec3[] = [];
        const buv: [number, number][] = [];
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          bot.push([cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0]);
          buv.push([Math.cos(a) * r0, Math.sin(a) * r0]);
        }
        this.poly(bot, buv);
      }
    }
  }

  /** low-poly blob (icosahedron, detail 1) with smooth normals, jittered by `jitter` */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, jitter = 0.15, seed = 1, detail = 1): void {
    const ico = getIco(detail);
    const base = this.vertexCount;
    const p = ico.getAttribute('position') as THREE.BufferAttribute;
    let s = seed * 9301 + 49297;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + (rnd() - 0.5) * 2 * jitter;
      const nx = x / rx;
      const ny = y / ry;
      const nz = z / rz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      this.vertex(cx + x * rx * k, cy + y * ry * k, cz + z * rz * k, nx / nl, ny / nl, nz / nl, x * rx, y * ry);
    }
    const index = ico.index!;
    for (let i = 0; i < index.count; i += 3) this.tri(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.a.slice(0, this.nor.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs.a.slice(0, this.uvs.n), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.a.slice(0, this.col.n), 3));
    for (const e of this.extras) g.setAttribute(e.name, new THREE.BufferAttribute(e.data.a.slice(0, e.data.n), e.size));
    const n = this.pos.n / 3;
    const ix = this.idx.subarray(0, this.nIdx);
    g.setIndex(n > 65535 ? new THREE.BufferAttribute(ix.slice(), 1) : new THREE.BufferAttribute(Uint16Array.from(ix), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get triangleCount(): number {
    return this.nIdx / 3;
  }
}

const icoCache = new Map<number, THREE.BufferGeometry>();
function getIco(detail: number): THREE.BufferGeometry {
  let g = icoCache.get(detail);
  if (!g) {
    const raw = new THREE.IcosahedronGeometry(1, detail);
    // weld duplicated vertices so the blob gets smooth normals
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    g = weld(raw);
    icoCache.set(detail, g);
  }
  return g;
}

function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length / 3;
      map.set(key, k);
      verts.push(x, y, z);
    }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  return out;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function normalize(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** planar meter UVs: u along p0→p1, v perpendicular in the polygon plane */
function planarUV(pts: Vec3[]): [number, number][] {
  const p0 = pts[0];
  const ux = sub(pts[1], p0);
  const lu = len(ux) || 1;
  const ue: Vec3 = [ux[0] / lu, ux[1] / lu, ux[2] / lu];
  const ve = cross(computeNormal(pts), ue);
  return pts.map((p) => {
    const d = sub(p, p0);
    return [dot(d, ue), dot(d, ve)] as [number, number];
  });
}

function computeNormal(pts: Vec3[]): Vec3 {
  // Newell's method (robust for any planar polygon)
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([nx, ny, nz]);
}

export type { Vec3 };
