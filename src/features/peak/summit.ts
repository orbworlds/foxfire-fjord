/**
 * Fox Peak's summit furniture: a big dry-stone cairn (varde) on the knob,
 * built in courses of flat gneiss slabs tapering to a capstone, with a red
 * trail "T" painted on a stone facing the lookout, a snow cap and rime
 * feathers grown into the wind; the summit box with the visitors' book on a
 * post; a plank bench at the north edge, sheltered by a crescent of
 * dry-stone wall with snow drifted in its lee. Geometry is returned per
 * material (world space) for merging; heights follow the exact terrain.
 */
import * as THREE from 'three';
import { applyBoxUV, snowCap } from '../../core/geometry';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { boulderGeometry, flatStoneGeometry, noise3, paintVertices } from '../paths/kit/rocks';
import { driftGeometry } from '../lake/drift';
import { BENCH, BOX, CAIRN, UPWIND, WINDBREAK, type Spot } from './layout';

export interface SummitBuild {
  /** gneiss slabs (vertex colours) */
  stone: THREE.BufferGeometry[];
  /** weathered timber (bench, post) */
  wood: THREE.BufferGeometry[];
  /** painted red steel (the box) */
  red: THREE.BufferGeometry[];
  /** snow (caps, drifts) */
  snow: THREE.BufferGeometry[];
  /** rime feathers */
  rime: THREE.BufferGeometry[];
  circles: { x: number; z: number; r: number; yMax: number }[];
  segments: { ax: number; az: number; bx: number; bz: number; r: number; yMax: number }[];
  heights: { cairn: number; cairnTop: number; box: number; bench: number };
}

/** Local frame of a spot: +z is the facing direction, +x its right-hand side. */
function frame(s: Spot, y: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(s.fz, 0, -s.fx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s.fx, 0, s.fz)).setPosition(s.x, y, s.z);
}

function toWorld(s: Spot, lx: number, lz: number): [number, number] {
  return [s.x + s.fz * lx + s.fx * lz, s.z - s.fx * lx + s.fz * lz];
}

/**
 * Rime feathers: thin white blades growing upwind from points on a surface,
 * longer where the wind hits square. `pts` are [position, outward normal].
 */
function rimeFeathers(pts: [THREE.Vector3, THREE.Vector3][], rnd: () => number, maxLen: number): THREE.BufferGeometry | null {
  const up = new THREE.Vector3(UPWIND.x, 0, UPWIND.z).normalize();
  const pos: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3();
  const tipP = new THREE.Vector3();
  for (const [p, n] of pts) {
    const face = n.x * up.x + n.z * up.z;
    if (face < 0.15) continue;
    const L = maxLen * (0.3 + 0.7 * face) * (0.5 + rnd() * 0.7);
    // feathers point into the wind, a little up, fanning slightly
    const d = up.clone().multiplyScalar(0.85).addScaledVector(n, 0.25);
    d.y += 0.12 + (rnd() - 0.5) * 0.15;
    d.x += (rnd() - 0.5) * 0.3;
    d.z += (rnd() - 0.5) * 0.3;
    d.normalize();
    side.set(-d.z, 0, d.x).normalize();
    const w = L * (0.35 + rnd() * 0.25);
    const th = 0.006 + rnd() * 0.006;
    tipP.copy(p).addScaledVector(d, L);
    const b = pos.length / 3;
    // a flat blade: root edge (wide, vertical), tip; plus a thickness offset to give it two faces
    const r0 = p.clone().addScaledVector(side, -w * 0.15).add(new THREE.Vector3(0, -w * 0.5, 0));
    const r1 = p.clone().addScaledVector(side, w * 0.15).add(new THREE.Vector3(0, w * 0.5, 0));
    const mid = p.clone().addScaledVector(d, L * 0.45).add(new THREE.Vector3(0, w * 0.05, 0));
    pos.push(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, tipP.x, tipP.y, tipP.z);
    pos.push(r0.x + side.x * th, r0.y, r0.z + side.z * th, r1.x + side.x * th, r1.y, r1.z + side.z * th, mid.x, mid.y + w * 0.32, mid.z);
    idx.push(b, b + 1, b + 2, b + 3, b + 5, b + 4, b + 1, b + 4, b + 5, b, b + 2, b + 3);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return applyBoxUV(g);
}

const SNOW_PAINT = new THREE.Color(1.15, 1.18, 1.22);

/**
 * Break a flat stone's neat puck shape: the thickness rises and falls round
 * the rim and the upper edge is knocked in where it thins, so a course of
 * slabs reads as split gneiss rather than stacked discs. In place, before the
 * stone is turned and placed (local y from 0 up to `thickness`).
 */
function roughSlab(g: THREE.BufferGeometry, seed: number, thickness: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const th = Math.atan2(z, x);
    const w = noise3(Math.cos(th) * 1.4 + seed * 0.37, Math.sin(th) * 1.4, seed * 0.11);
    const w2 = noise3(Math.cos(th) * 4 + seed, Math.sin(th) * 4, 2.3);
    const ty = Math.min(1, Math.max(0, y / thickness));
    y *= 1 + 0.25 * w + 0.08 * w2;
    const k = 1 - (0.09 * Math.max(0, -w) + 0.03 * Math.max(0, w2)) * ty - 0.03 * (1 - ty);
    x *= k;
    z *= k;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildSummit(ctx: FeatureContext): SummitBuild {
  const H = (x: number, z: number) => ctx.world.heightAt(x, z);
  const rnd = mulberry32(5811);
  const stone: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [];
  const snow: THREE.BufferGeometry[] = [];
  const rime: THREE.BufferGeometry[] = [];
  const circles: SummitBuild['circles'] = [];
  const segments: SummitBuild['segments'] = [];
  const rimePts: [THREE.Vector3, THREE.Vector3][] = [];
  const upwind = new THREE.Vector2(UPWIND.x, UPWIND.z);

  /** cool grey gneiss tones (one rusty) with grey-green lichen on the tops and a painted mark where asked */
  const tones: [number, number, number][] = [
    [0.7, 0.73, 0.78],
    [0.8, 0.81, 0.83],
    [0.6, 0.63, 0.68],
    [0.82, 0.76, 0.68],
    [0.66, 0.66, 0.68],
  ];
  const rock = (g: THREE.BufferGeometry, base: [number, number, number], seed: number, mark?: (p: THREE.Vector3, n: THREE.Vector3) => number) =>
    paintVertices(g, (p, n, c) => {
      const m = 0.8 + 0.32 * noise3(p.x * 4 + seed, p.y * 4, p.z * 4);
      c.setRGB(base[0] * m, base[1] * m, base[2] * m);
      const up = Math.max(0, n.y);
      const lichen = up * Math.max(0, noise3(p.x * 9 + seed, p.y * 9, p.z * 9) - 0.15) * 1.5;
      c.lerp(new THREE.Color(0.62, 0.68, 0.55), Math.min(0.45, lichen));
      if (mark) c.lerp(new THREE.Color(0.62, 0.05, 0.03), mark(p, n));
      // snow lodged on every ledge: the slabs' upper faces white, patchy where the wind scours them
      const lodge = THREE.MathUtils.smoothstep(n.y, 0.45, 0.8) * THREE.MathUtils.smoothstep(noise3(p.x * 6 + seed, p.y * 6, p.z * 6), -0.45, 0.1);
      c.lerp(SNOW_PAINT, lodge * 0.92);
    });

  /* ---------- the cairn ---------- */
  const gCairn = Math.min(H(CAIRN.x, CAIRN.z), H(CAIRN.x + 0.6, CAIRN.z), H(CAIRN.x - 0.6, CAIRN.z), H(CAIRN.x, CAIRN.z + 0.6), H(CAIRN.x, CAIRN.z - 0.6));
  // the side facing the lookout (west) carries the red T
  const tDir = new THREE.Vector2(-0.5, 0.86).normalize();
  let y = gCairn - 0.12;
  const layers = 15;
  const markLayer = 10;
  for (let k = 0; k < layers; k++) {
    const t = k / (layers - 1);
    // a slender tower: steep walls, rounding in toward the top, a little lumpy
    const R = CAIRN.r * (1 - 0.48 * Math.pow(t, 1.5)) * (k === 0 ? 1.12 : 1) * (0.96 + rnd() * 0.08);
    const th = 0.15 - 0.04 * t + rnd() * 0.04;
    const n = Math.max(4, Math.round((2 * Math.PI * R) / (0.46 - 0.14 * t)));
    const off = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + ((i + (rnd() - 0.5) * 0.35) / n) * Math.PI * 2;
      const len = ((2 * Math.PI * R) / n) * (0.55 + rnd() * 0.25);
      const depth = Math.min(R * 0.75, 0.2 + rnd() * 0.16);
      const sth = th * (0.65 + rnd() * 0.6);
      const g = roughSlab(flatStoneGeometry(900 + k * 37 + i, depth, sth, len, 0.85, 16), 900 + k * 37 + i, sth);
      // long axis along the ring (tangent), short axis radial; slabs tilt and stick out unevenly
      g.rotateZ((rnd() - 0.5) * 0.22);
      g.rotateX((rnd() - 0.5) * 0.16);
      g.rotateY(-a + (rnd() - 0.5) * 0.3);
      const rr = R - depth * (0.7 + rnd() * 0.3);
      const cx = CAIRN.x + Math.cos(a) * rr;
      const cz = CAIRN.z + Math.sin(a) * rr;
      g.translate(cx, y + (rnd() - 0.5) * 0.05, cz);
      const facing = Math.cos(a) * tDir.x + Math.sin(a) * tDir.y;
      let mark: ((p: THREE.Vector3, nn: THREE.Vector3) => number) | undefined;
      if ((k === markLayer || k === markLayer - 1 || k === markLayer - 2) && facing > 0.7) {
        // a painted T facing the lookout: the bar on the top course, the stem on the two below
        mark = (p, nn) => {
          if (nn.x * tDir.x + nn.z * tDir.y < 0.45) return 0;
          const s = -(p.x - CAIRN.x) * tDir.y + (p.z - CAIRN.z) * tDir.x;
          const bar = k === markLayer ? Math.abs(s) < 0.22 : Math.abs(s) < 0.07;
          return bar ? 0.92 : 0;
        };
      }
      stone.push(rock(g, tones[Math.floor(rnd() * tones.length)], k * 13 + i, mark));
      // rime on the windward stones: sample points on the outer face
      const face = Math.cos(a) * upwind.x + Math.sin(a) * upwind.y;
      if (face > 0.2 && k > 0) {
        for (let s = 0; s < 3; s++) {
          const da = (rnd() - 0.5) * 0.25;
          const pr = R + 0.01;
          const p = new THREE.Vector3(CAIRN.x + Math.cos(a + da) * pr, y + th * (0.2 + rnd() * 0.7), CAIRN.z + Math.sin(a + da) * pr);
          rimePts.push([p, new THREE.Vector3(Math.cos(a + da), 0, Math.sin(a + da))]);
        }
      }
    }
    // hearting: a slab filling the middle of the course
    if (R > 0.3) {
      const g = flatStoneGeometry(950 + k, R * 0.7, th * 0.9, R * 0.62, 0.5, 14);
      g.rotateY(rnd() * 6);
      g.translate(CAIRN.x, y, CAIRN.z);
      stone.push(rock(g, tones[k % tones.length], 70 + k));
    }
    y += th * 0.9;
  }
  // capstone: a pointed stone standing on the top course
  {
    const g = boulderGeometry(990, { sx: 0.14, sy: 0.26, sz: 0.11, detail: 2, lumps: 0.2, grain: 0.05, facets: 7, facetDepth: 1, flatBottom: 0.7, crease: 0.08 });
    g.rotateY(0.6);
    g.rotateZ(0.08);
    g.translate(CAIRN.x, y + 0.16, CAIRN.z);
    stone.push(rock(g, [0.8, 0.79, 0.78], 99));
    for (let s = 0; s < 6; s++) {
      const p = new THREE.Vector3(CAIRN.x + UPWIND.x * 0.1, y + 0.05 + rnd() * 0.35, CAIRN.z + UPWIND.z * 0.1);
      rimePts.push([p, new THREE.Vector3(UPWIND.x, 0.2, UPWIND.z).normalize()]);
    }
  }
  const cairnTop = y + 0.42;
  // snow on the top course and on the ledges (the slabs' tops), drifted in the lee
  {
    const top = flatStoneGeometry(991, CAIRN.r * 0.56, 0.06, CAIRN.r * 0.52, 0.4, 16);
    top.translate(CAIRN.x, y - 0.05, CAIRN.z);
    const cap = snowCap(top, { thickness: 0.2, cell: 0.03, overhang: 0.08, lumps: 0.55, seed: 31 });
    if (cap) snow.push(cap);
    top.dispose();
  }
  // a lee drift tailing away from the cairn's foot
  {
    const lee = new THREE.Vector2(-UPWIND.x, -UPWIND.z);
    const dx = CAIRN.x + lee.x * (CAIRN.r + 1.2);
    const dz = CAIRN.z + lee.y * (CAIRN.r + 1.2);
    snow.push(driftGeometry(dx, dz, 2.0, 1.0, 0.42, H, { rot: Math.atan2(lee.y, lee.x), skew: 0.5, seg: 16 }));
  }
  circles.push({ x: CAIRN.x, z: CAIRN.z, r: CAIRN.r + 0.1, yMax: cairnTop });

  /* ---------- summit box on a post ---------- */
  const gBox = H(BOX.x, BOX.z);
  {
    const m = frame(BOX, gBox);
    const post = new THREE.BoxGeometry(0.1, 1.45, 0.1);
    post.translate(0, 0.62, 0);
    applyBoxUV(post, { grain: 'y' });
    wood.push(post.applyMatrix4(m));
    // the box: a red steel case with a sloping lid
    const body = new THREE.BoxGeometry(0.38, 0.26, 0.22);
    body.translate(0, 1.3, 0.12);
    applyBoxUV(body);
    red.push(body.applyMatrix4(m));
    const lid = new THREE.BoxGeometry(0.42, 0.03, 0.27);
    lid.rotateX(0.12);
    lid.translate(0, 1.45, 0.12);
    applyBoxUV(lid);
    red.push(lid.applyMatrix4(m.clone()));
    const lidCap = new THREE.BoxGeometry(0.42, 0.03, 0.27);
    lidCap.rotateX(0.12);
    lidCap.translate(0, 1.45, 0.12);
    const cap = snowCap(lidCap.applyMatrix4(m.clone()), { thickness: 0.09, cell: 0.02, overhang: 0.04, lumps: 0.4, seed: 12 });
    if (cap) snow.push(cap);
    for (let s = 0; s < 14; s++) {
      const [px, pz] = toWorld(BOX, (rnd() - 0.5) * 0.36, 0.12 + (rnd() - 0.5) * 0.2);
      const p = new THREE.Vector3(px + UPWIND.x * 0.12, gBox + 1.2 + rnd() * 0.25, pz + UPWIND.z * 0.12);
      rimePts.push([p, new THREE.Vector3(UPWIND.x, 0, UPWIND.z)]);
    }
    for (let s = 0; s < 10; s++) {
      const p = new THREE.Vector3(BOX.x + UPWIND.x * 0.05, gBox + 0.2 + rnd() * 0.9, BOX.z + UPWIND.z * 0.05);
      rimePts.push([p, new THREE.Vector3(UPWIND.x, 0, UPWIND.z)]);
    }
    circles.push({ x: BOX.x, z: BOX.z, r: 0.12, yMax: gBox + 1.5 });
  }

  /* ---------- bench ---------- */
  const gBench = H(BENCH.x, BENCH.z);
  {
    const len = 1.6;
    const seatY = 0.44;
    const parts: THREE.BufferGeometry[] = [];
    const seat: THREE.BufferGeometry[] = [];
    for (const dz of [-0.08, 0.08]) {
      const g = new THREE.BoxGeometry(len, 0.055, 0.15);
      g.translate(0, seatY - 0.0275, dz);
      applyBoxUV(g, { grain: 'x' });
      parts.push(g);
      seat.push(g.clone());
    }
    for (const sx of [-1, 1]) {
      const x = sx * (len / 2 - 0.22);
      const g = new THREE.BoxGeometry(0.08, 0.07, 0.36);
      g.translate(x, seatY - 0.09, 0);
      applyBoxUV(g, { grain: 'z' });
      parts.push(g);
      for (const sz of [-1, 1]) {
        const [wx, wz] = toWorld(BENCH, x, sz * 0.13);
        const legBottom = H(wx, wz) - gBench - 0.12;
        const legH = seatY - 0.125 - legBottom;
        const leg = new THREE.BoxGeometry(0.08, legH, 0.08);
        leg.translate(x, legBottom + legH / 2, sz * 0.13);
        applyBoxUV(leg, { grain: 'y' });
        parts.push(leg);
      }
    }
    const m = frame(BENCH, gBench);
    for (const g of parts) wood.push(g.applyMatrix4(m));
    const seatW = seat.map((g) => g.applyMatrix4(m));
    for (const g of seatW) {
      const cap = snowCap(g, { thickness: 0.07, cell: 0.02, overhang: 0.035, lumps: 0.45, align: 'auto', seed: 41 });
      if (cap) snow.push(cap);
      g.dispose();
    }
    const [ax, az] = toWorld(BENCH, -len / 2, 0);
    const [bx, bz] = toWorld(BENCH, len / 2, 0);
    segments.push({ ax, az, bx, bz, r: 0.22, yMax: gBench + seatY });
    // rime on the bench's windward end
    for (let s = 0; s < 10; s++) {
      const [px, pz] = toWorld(BENCH, -len / 2 * 0.95 + rnd() * 0.3, (rnd() - 0.5) * 0.25);
      rimePts.push([new THREE.Vector3(px, gBench + seatY - 0.06 + rnd() * 0.05, pz), new THREE.Vector3(UPWIND.x, 0, UPWIND.z)]);
    }
  }

  /* ---------- dry-stone windbreak with snow drifted in its lee ---------- */
  {
    const W = WINDBREAK;
    const arc = (W.a1 - W.a0) * W.r;
    const courses = 5;
    for (let k = 0; k < courses; k++) {
      const t = k / (courses - 1);
      const n = Math.round(arc / (0.4 - 0.06 * t));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + (k % 2) * 0.5 + (rnd() - 0.5) * 0.3) / n;
        if (u > 1 || u < 0) continue;
        // the ends of the crescent are lower, the top course has gaps
        const endDrop = Math.min(1, Math.min(u, 1 - u) * 5);
        if (k >= Math.round((courses - 1) * (0.45 + 0.55 * endDrop)) + 1) continue;
        if (k === courses - 1 && rnd() < 0.3) continue;
        const a = W.a0 + (W.a1 - W.a0) * u;
        // the wall leans in a little and thins toward the top
        const rr = W.r - t * 0.06 + (rnd() - 0.5) * 0.08;
        const x = W.x + Math.cos(a) * rr;
        const z = W.z + Math.sin(a) * rr;
        const len = (arc / n) * (0.6 + rnd() * 0.3);
        const depth = (0.22 - 0.05 * t) * (0.8 + rnd() * 0.4);
        const th = (W.h / courses) * (0.75 + rnd() * 0.5) + 0.02;
        const g = roughSlab(flatStoneGeometry(1200 + k * 50 + i, depth, th, len, 0.9, 14), 1200 + k * 50 + i, th);
        g.rotateZ((rnd() - 0.5) * 0.18);
        g.rotateX((rnd() - 0.5) * 0.12);
        g.rotateY(-a + (rnd() - 0.5) * 0.35);
        const y0 = H(x, z) - 0.12 + (k * W.h) / courses + (rnd() - 0.5) * 0.04;
        g.translate(x, y0, z);
        stone.push(rock(g, tones[Math.floor(rnd() * tones.length)], 300 + k * 17 + i));
        if (k >= courses - 2) {
          const face = Math.cos(a) * upwind.x + Math.sin(a) * upwind.y;
          if (face > 0.2) {
            for (let s2 = 0; s2 < 2; s2++) rimePts.push([new THREE.Vector3(x + Math.cos(a) * 0.12, y0 + th * 0.6, z + Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)).normalize()]);
          }
        }
      }
    }
    for (let i = 0; i <= 8; i++) {
      const a = W.a0 + ((W.a1 - W.a0) * i) / 8;
      const ax = W.x + Math.cos(a) * W.r;
      const az = W.z + Math.sin(a) * W.r;
      const a2 = W.a0 + ((W.a1 - W.a0) * Math.min(8, i + 1)) / 8;
      if (i < 8) segments.push({ ax, az, bx: W.x + Math.cos(a2) * W.r, bz: W.z + Math.sin(a2) * W.r, r: 0.2, yMax: H(ax, az) + W.h });
    }
    // drift tucked in against the inside (lee) of the wall
    for (let i = 0; i < 4; i++) {
      const a = W.a0 + (W.a1 - W.a0) * (0.15 + 0.23 * i);
      const rr = W.r - 0.6;
      const x = W.x + Math.cos(a) * rr;
      const z = W.z + Math.sin(a) * rr;
      snow.push(driftGeometry(x, z, 0.75 + rnd() * 0.2, 0.55, 0.32 + rnd() * 0.1, H, { rot: a + Math.PI / 2, skew: 0, seg: 10 }));
    }
  }

  const feathers = rimeFeathers(rimePts, rnd, 0.13);
  if (feathers) rime.push(feathers);

  return {
    stone,
    wood,
    red,
    snow,
    rime,
    circles,
    segments,
    heights: { cairn: gCairn, cairnTop, box: gBox, bench: gBench },
  };
}
