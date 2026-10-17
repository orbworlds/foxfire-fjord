/**
 * Small props for Mirror Lake: an ice fisher's things (a folding stool with
 * a reindeer-skin seat, a short jigging rod, the hand auger stuck in the
 * snow, a pulk sledge), the rink's benches with skates left on them, a snow
 * shovel, a lamp pole, a steel bathing ladder and a firewood stack. Each
 * builder adds metre-UV geometry (world space after `place`) to a Batch.
 */
import * as THREE from 'three';
import { applyBoxUV, snowCap } from '../../core/geometry';
import type { MaterialName } from '../../core/materials';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { Batch } from '../house/kit';

export type PropMat = MaterialName | 'redPaint' | 'orange' | 'cork' | 'lampGlass' | 'line' | 'steel' | 'fleece' | 'birch';

/** Collects prop geometry per material key; turns keys into materials at build time. */
export class PropBatch {
  private parts: { key: PropMat; geo: THREE.BufferGeometry; cast: boolean }[] = [];
  add(key: PropMat, geo: THREE.BufferGeometry | null, cast = true): void {
    if (geo) this.parts.push({ key, geo, cast });
  }
  /** add a list of local parts, transformed by `m` */
  place(parts: [PropMat, THREE.BufferGeometry][], m: THREE.Matrix4, cast = true): void {
    for (const [k, g] of parts) this.add(k, g.applyMatrix4(m), cast);
  }
  build(ctx: FeatureContext, name: string, extra: Partial<Record<PropMat, THREE.Material>> = {}): THREE.Mesh[] {
    const M = ctx.materials;
    const cache = new Map<PropMat, THREE.Material>();
    const mat = (k: PropMat): THREE.Material => {
      let m = extra[k] ?? cache.get(k);
      if (m) return m;
      if (k === 'redPaint') m = new THREE.MeshStandardMaterial({ name: 'redPaint', color: 0x9a2418, roughness: 0.5, metalness: 0.2 });
      else if (k === 'orange') m = new THREE.MeshStandardMaterial({ name: 'pulkOrange', color: 0xc8501c, roughness: 0.42 });
      else if (k === 'cork') m = new THREE.MeshStandardMaterial({ name: 'cork', color: 0x8a6a48, roughness: 0.9 });
      else if (k === 'line') m = new THREE.MeshBasicMaterial({ name: 'fishingLine', color: 0x9aa0a6, transparent: true, opacity: 0.6 });
      else if (k === 'lampGlass') m = new THREE.MeshStandardMaterial({ name: 'lampGlass', color: 0x3a2a1a, roughness: 0.25, emissive: 0xffb866, emissiveIntensity: 0 });
      // plain stand-ins for small props (no texture to generate): galvanised steel, reindeer skin, birch logs
      else if (k === 'steel') m = new THREE.MeshStandardMaterial({ name: 'propSteel', color: 0xb9bdc2, metalness: 1, roughness: 0.38 });
      else if (k === 'fleece') m = new THREE.MeshStandardMaterial({ name: 'propFleece', color: 0xb9a68e, roughness: 1 });
      else if (k === 'birch') m = new THREE.MeshStandardMaterial({ name: 'propBirch', color: 0xd9d4ca, roughness: 0.85 });
      else m = M.get(k);
      cache.set(k, m);
      return m;
    };
    const batch = new Batch();
    for (const p of this.parts) batch.add(mat(p.key), p.geo, { cast: p.cast });
    this.parts = [];
    return batch.build(name);
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, grain?: 'x' | 'y' | 'z') => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return applyBoxUV(g, { grain });
};

const cyl = (r0: number, r1: number, _h: number, seg: number, a: THREE.Vector3, b: THREE.Vector3) => {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  applyBoxUV(g, { grain: 'y' });
  return g;
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Frame at (x, y, z) turned by yaw (local +z faces (sin yaw, cos yaw)). */
export function placeAt(x: number, y: number, z: number, yaw: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
}

/** A three-legged folding stool with a reindeer-skin seat (seat ~0.42 m). */
export function fishingStool(): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  const seatY = 0.4;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    out.push(['blackSteel', cyl(0.012, 0.012, 0, 6, V(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2), V(-Math.cos(a) * 0.06, seatY, -Math.sin(a) * 0.06))]);
  }
  const seat = new THREE.CylinderGeometry(0.17, 0.16, 0.05, 16);
  seat.translate(0, seatY + 0.02, 0);
  out.push(['fleece', applyBoxUV(seat)]);
  return out;
}

/** A short jigging rod lying across its holder, its line running down into the hole at (hx, hz) local. */
export function jigRod(hx: number, hz: number): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  // a little forked stick holder
  out.push(['birch', cyl(0.01, 0.008, 0, 5, V(0, -0.05, 0), V(0, 0.28, 0))]);
  const butt = V(-0.18, 0.2, 0.05);
  const tip = V(hx, 0.3, hz);
  const d = tip.clone().sub(butt).normalize();
  const mid = butt.clone().addScaledVector(d, 0.16);
  out.push(['cork', cyl(0.016, 0.014, 0, 8, butt, mid)]);
  out.push(['blackSteel', cyl(0.007, 0.002, 0, 5, mid, tip)]);
  // the reel
  const reel = new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10);
  reel.rotateZ(Math.PI / 2);
  reel.translate(mid.x, mid.y - 0.03, mid.z);
  out.push(['steel', applyBoxUV(reel)]);
  out.push(['line', cyl(0.0012, 0.0012, 0, 3, tip, V(hx, -0.15, hz))]);
  return out;
}

/** The hand auger: T-handle, crank, shaft and a spiral blade, stuck upright in the snow. */
export function auger(): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  out.push(['steel', cyl(0.014, 0.014, 0, 8, V(0, -0.3, 0), V(0, 1.15, 0))]);
  out.push(['blackSteel', cyl(0.012, 0.012, 0, 6, V(-0.22, 1.15, 0), V(0.22, 1.15, 0))]);
  out.push(['redPaint', cyl(0.02, 0.02, 0, 8, V(-0.22, 1.15, 0), V(-0.12, 1.15, 0))]);
  out.push(['redPaint', cyl(0.02, 0.02, 0, 8, V(0.12, 1.15, 0), V(0.22, 1.15, 0))]);
  // crank offset in the middle of the shaft
  out.push(['blackSteel', cyl(0.01, 0.01, 0, 6, V(0, 0.75, 0), V(0.14, 0.75, 0))]);
  out.push(['blackSteel', cyl(0.01, 0.01, 0, 6, V(0.14, 0.75, 0), V(0.14, 0.62, 0))]);
  out.push(['blackSteel', cyl(0.01, 0.01, 0, 6, V(0.14, 0.62, 0), V(0, 0.62, 0))]);
  out.push(['redPaint', cyl(0.018, 0.018, 0, 8, V(0.14, 0.69, 0), V(0.14, 0.6, 0.0))]);
  // the flight: a twisted strip above the snow line
  const n = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -0.05 + t * 0.32;
    const a = t * Math.PI * 4;
    for (const r of [0.014, 0.065]) pos.push(Math.cos(a) * r, y + (r > 0.02 ? 0.01 : 0), Math.sin(a) * r);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  out.push(['steel', applyBoxUV(g)]);
  return out;
}

/** A pulk: a small orange towing sledge with a lidded box. */
export function pulk(): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  // the tub: a rounded box with an upturned nose (along +z)
  const tub = new THREE.BoxGeometry(0.55, 0.22, 1.3, 4, 2, 10);
  const pos = tub.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const nose = Math.max(0, z - 0.35);
    if (y < 0) {
      y += nose * nose * 0.9;
      pos.setX(i, x * (1 - nose * 0.25));
    }
    pos.setY(i, y + 0.11);
  }
  tub.computeVertexNormals();
  out.push(['orange', applyBoxUV(tub)]);
  out.push(['enamelWhite', box(0.4, 0.22, 0.45, 0, 0.32, -0.25)]);
  // towing poles
  for (const sx of [-1, 1]) out.push(['blackSteel', cyl(0.012, 0.012, 0, 6, V(sx * 0.2, 0.2, 0.6), V(sx * 0.3, 0.25, 1.9))]);
  return out;
}

/** A plank bench, seat height 0.45 m, along local x. */
export function plankBench(len: number): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  for (const dz of [-0.075, 0.075]) out.push(['weatheredTimber', box(len, 0.05, 0.14, 0, 0.425, dz, 'x')]);
  for (const sx of [-1, 1]) {
    out.push(['weatheredTimber', box(0.07, 0.07, 0.36, sx * (len / 2 - 0.2), 0.37, 0, 'z')]);
    for (const sz of [-1, 1]) out.push(['weatheredTimber', box(0.07, 0.42, 0.07, sx * (len / 2 - 0.2), 0.12, sz * 0.13, 'y')]);
  }
  return out;
}

/** Snow on a bench's seat (pass the bench parts after placing them). */
export function benchSnow(len: number, m: THREE.Matrix4, seed: number): THREE.BufferGeometry | null {
  const g = box(len, 0.05, 0.3, 0, 0.425, 0, 'x');
  g.applyMatrix4(m);
  const cap = snowCap(g, { thickness: 0.06, cell: 0.02, overhang: 0.03, lumps: 0.5, align: 'auto', seed });
  g.dispose();
  return cap;
}

/** A pair of figure skates (white boots, steel blades) as left on a bench; local origin at the seat top. */
export function skates(seed: number): [PropMat, THREE.BufferGeometry][] {
  const rnd = mulberry32(seed);
  const out: [PropMat, THREE.BufferGeometry][] = [];
  for (let k = 0; k < 2; k++) {
    const ox = k * 0.16 + (rnd() - 0.5) * 0.03;
    const yaw = (rnd() - 0.5) * 0.4;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(ox, 0, (rnd() - 0.5) * 0.05);
    const parts: [PropMat, THREE.BufferGeometry][] = [];
    // lying on its side: the boot along z, the blade sideways
    const boot = new THREE.CapsuleGeometry(0.045, 0.16, 4, 8);
    boot.rotateX(Math.PI / 2);
    boot.scale(1.0, 0.95, 1.1);
    boot.translate(0, 0.05, 0);
    parts.push(['matteWhite', applyBoxUV(boot)]);
    const shaft = new THREE.CylinderGeometry(0.045, 0.05, 0.16, 10);
    shaft.rotateZ(Math.PI / 2 - 0.2);
    shaft.translate(-0.06, 0.06, -0.08);
    parts.push(['matteWhite', applyBoxUV(shaft)]);
    parts.push(['steel', box(0.012, 0.03, 0.29, 0.065, 0.03, 0.0, 'z')]);
    for (const [k2, g] of parts) out.push([k2, g.applyMatrix4(m)]);
  }
  return out;
}

/** A snow shovel stuck blade-down in a snowbank, leaning. */
export function shovel(): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  const lean = new THREE.Matrix4().makeRotationX(0.25);
  const parts: [PropMat, THREE.BufferGeometry][] = [
    ['birch', cyl(0.016, 0.016, 0, 6, V(0, 0.15, 0), V(0, 1.25, 0))],
    ['blackSteel', box(0.18, 0.03, 0.03, 0, 1.25, 0, 'x')],
    ['redPaint', box(0.42, 0.38, 0.02, 0, 0.0, 0.02, 'x')],
  ];
  for (const [k, g] of parts) out.push([k, g.applyMatrix4(lean)]);
  return out;
}

/** A wooden lamp pole with an arm and a lantern hanging from it (lantern glass at local (0.42, h - 0.42, 0)). */
export function lampPole(h: number): { parts: [PropMat, THREE.BufferGeometry][]; lamp: THREE.Vector3 } {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  out.push(['tarredWood', box(0.11, h + 0.3, 0.11, 0, (h - 0.3) / 2, 0, 'y')]);
  out.push(['tarredWood', box(0.55, 0.07, 0.07, 0.24, h - 0.12, 0, 'x')]);
  out.push(['tarredWood', cyl(0.025, 0.025, 0, 5, V(0.05, h - 0.45, 0), V(0.3, h - 0.14, 0))]);
  const lx = 0.44;
  const ly = h - 0.46;
  out.push(['blackSteel', cyl(0.006, 0.006, 0, 4, V(lx, h - 0.16, 0), V(lx, ly + 0.15, 0))]);
  out.push(['blackSteel', box(0.19, 0.025, 0.19, lx, ly - 0.13, 0)]);
  const roof = new THREE.ConeGeometry(0.15, 0.11, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(lx, ly + 0.18, 0);
  out.push(['blackSteel', applyBoxUV(roof)]);
  for (const [cx, cz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    out.push(['blackSteel', box(0.015, 0.25, 0.015, lx + cx * 0.085, ly, cz * 0.085, 'y')]);
  out.push(['lampGlass', box(0.15, 0.23, 0.15, lx, ly, 0)]);
  return { parts: out, lamp: V(lx, ly, 0) };
}

/** A steel bathing ladder: two rails and rungs from `top` down to `bottom` (local y), along local z. */
export function ladder(top: number, bottom: number): [PropMat, THREE.BufferGeometry][] {
  const out: [PropMat, THREE.BufferGeometry][] = [];
  for (const sx of [-1, 1]) {
    // rails curve over the jetty edge as handles
    out.push(['steel', cyl(0.02, 0.02, 0, 8, V(sx * 0.22, bottom, 0.05), V(sx * 0.22, top + 0.1, 0.05))]);
    out.push(['steel', cyl(0.02, 0.02, 0, 8, V(sx * 0.22, top + 0.1, 0.05), V(sx * 0.22, top + 0.62, -0.18))]);
    out.push(['steel', cyl(0.02, 0.02, 0, 8, V(sx * 0.22, top + 0.62, -0.18), V(sx * 0.22, top + 0.02, -0.42))]);
  }
  for (let y = bottom + 0.15; y < top - 0.05; y += 0.28) out.push(['steel', box(0.44, 0.03, 0.06, 0, y, 0.05, 'x')]);
  return out;
}

/** A firewood stack along local x against a wall (back at local z = 0), with a little roof of boards. */
export function woodStack(len: number, h: number, seed: number): [PropMat, THREE.BufferGeometry][] {
  const rnd = mulberry32(seed);
  const out: [PropMat, THREE.BufferGeometry][] = [];
  const depth = 0.42;
  const r = 0.065;
  for (let y = r; y < h; y += r * 1.75) {
    const off = (Math.round(y / (r * 1.75)) % 2) * r;
    for (let x = -len / 2 + r + off; x < len / 2 - r; x += r * 2.05) {
      const rr = r * (0.75 + rnd() * 0.35);
      const g = new THREE.CylinderGeometry(rr, rr, depth * (0.92 + rnd() * 0.1), 6);
      g.rotateX(Math.PI / 2);
      g.rotateZ(rnd() * 3);
      g.translate(x + (rnd() - 0.5) * 0.02, y + (rnd() - 0.5) * 0.02, depth / 2 + 0.02);
      out.push([rnd() > 0.35 ? 'birch' : 'weatheredTimber', applyBoxUV(g, { grain: 'z' })]);
    }
  }
  out.push(['tarredWood', box(len + 0.2, 0.03, depth + 0.2, 0, h + 0.06, depth / 2 + 0.05, 'x')]);
  return out;
}
