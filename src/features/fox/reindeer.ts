/**
 * A small herd of reindeer at the edge of the woods between the cabin and
 * Mirror Lake: grey-brown winter coats with pale necks, white beards and
 * rumps, and antlers (the cows keep theirs all winter). They graze by
 * digging craters in the snow with a forehoof for the lichen underneath,
 * lift their heads to look round, and drift slowly about at a walk.
 *
 * Built with the fox's machinery (an SDF body skinned to the same skeleton
 * layout, shell fur), with its own proportions, antlers and gaits.
 */
import * as THREE from 'three';
import { applyBoxUV } from '../../core/geometry';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { heightAt } from '../../world/terrain-height';
import { B, buildBody, cone, ell, mir, type Joints, type Prim, type V3 } from './body';
import { buildBreath } from './breath';
import type { FurMaterials } from './fur';
import { Pose, applyPose, legCycle } from './rig';

const JOINTS: Joints = {
  root: { p: [0, 0, 0], parent: null },
  hips: { p: [0, 0.95, -0.48], parent: 'root' },
  spine: { p: [0, 0.97, -0.05], parent: 'hips' },
  chest: { p: [0, 0.97, 0.36], parent: 'spine' },
  neck: { p: [0, 1.0, 0.5], parent: 'chest' },
  head: { p: [0, 1.3, 0.78], parent: 'neck' },
  earL: { p: [0.07, 1.4, 0.8], parent: 'head' },
  earR: { p: [-0.07, 1.4, 0.8], parent: 'head' },
  tail1: { p: [0, 0.98, -0.72], parent: 'hips' },
  tail2: { p: [0, 0.95, -0.77], parent: 'tail1' },
  tail3: { p: [0, 0.92, -0.8], parent: 'tail2' },
  tail4: { p: [0, 0.9, -0.82], parent: 'tail3' },
  tail5: { p: [0, 0.88, -0.84], parent: 'tail4' },
  shoulderL: { p: [0.15, 0.82, 0.42], parent: 'chest' },
  elbowL: { p: [0.15, 0.58, 0.38], parent: 'shoulderL' },
  wristL: { p: [0.15, 0.27, 0.42], parent: 'elbowL' },
  shoulderR: { p: [-0.15, 0.82, 0.42], parent: 'chest' },
  elbowR: { p: [-0.15, 0.58, 0.38], parent: 'shoulderR' },
  wristR: { p: [-0.15, 0.27, 0.42], parent: 'elbowR' },
  hipL: { p: [0.15, 0.84, -0.55], parent: 'hips' },
  kneeL: { p: [0.15, 0.56, -0.42], parent: 'hipL' },
  hockL: { p: [0.15, 0.42, -0.68], parent: 'kneeL' },
  hipR: { p: [-0.15, 0.84, -0.55], parent: 'hips' },
  kneeR: { p: [-0.15, 0.56, -0.42], parent: 'hipR' },
  hockR: { p: [-0.15, 0.42, -0.68], parent: 'kneeR' },
};

const COAT: V3 = [0.18, 0.15, 0.125];
const DARK: V3 = [0.11, 0.09, 0.075];
const PALE: V3 = [0.68, 0.66, 0.6];
const FACE: V3 = [0.2, 0.17, 0.14];
const HOOF: V3 = [0.07, 0.065, 0.06];
const NOSE: V3 = [0.12, 0.1, 0.1];

function prims(): Prim[] {
  const P: Prim[] = [
    ell([0, 0.93, -0.06], [0.24, 0.29, 0.56], 'spine', 0.03, COAT, 0.08),
    ell([0, 0.92, -0.46], [0.22, 0.26, 0.24], 'hips', 0.03, COAT, 0.06),
    // the pale rump patch round the short tail
    ell([0, 0.94, -0.66], [0.16, 0.18, 0.08], 'hips', 0.035, PALE, 0.05),
    ell([0, 0.94, -0.76], [0.06, 0.09, 0.05], 'tail1', 0.03, PALE, 0.03),
    ell([0, 0.9, 0.33], [0.21, 0.29, 0.24], 'chest', 0.03, COAT, 0.06),
    // pale belly line
    ell([0, 0.72, 0.0], [0.17, 0.08, 0.45], 'spine', 0.025, PALE, 0.08),
    // neck with the winter mane and the white beard hanging under it
    cone([0, 0.98, 0.42], [0, 1.27, 0.76], 0.17, 0.1, 'neck', 0.055, PALE, 0.07),
    ell([0, 0.98, 0.6], [0.1, 0.17, 0.12], 'neck', 0.075, [0.9, 0.88, 0.84], 0.06),
    // head
    ell([0, 1.33, 0.86], [0.09, 0.1, 0.14], 'head', 0.012, FACE, 0.04),
    cone([0, 1.29, 0.94], [0, 1.2, 1.12], 0.075, 0.055, 'head', 0.01, FACE, 0.035),
    ell([0, 1.19, 1.13], [0.055, 0.045, 0.04], 'head', 0, NOSE, 0.02),
    cone([0.07, 1.4, 0.8], [0.15, 1.45, 0.77], 0.03, 0.018, 'earL', 0.01, FACE, 0.015),
    cone(mir([0.07, 1.4, 0.8]), mir([0.15, 1.45, 0.77]), 0.03, 0.018, 'earR', 0.01, FACE, 0.015),
  ];
  for (const side of ['L', 'R'] as const) {
    const m = side === 'L' ? (p: V3) => p : mir;
    const b = (n: string) => `${n}${side}` as 'shoulderL';
    P.push(ell(m([0.13, 0.82, 0.38]), [0.09, 0.17, 0.13], b('shoulder'), 0.03, COAT, 0.06));
    P.push(cone(m([0.15, 0.82, 0.42]), m([0.15, 0.58, 0.38]), 0.08, 0.05, b('shoulder'), 0.025, COAT));
    P.push(cone(m([0.15, 0.58, 0.38]), m([0.15, 0.27, 0.42]), 0.056, 0.04, b('elbow'), 0.018, DARK));
    P.push(cone(m([0.15, 0.27, 0.42]), m([0.15, 0.06, 0.45]), 0.037, 0.044, b('wrist'), 0.03, PALE, 0.02));
    P.push(ell(m([0.15, 0.04, 0.47]), [0.072, 0.045, 0.088], b('wrist'), 0, HOOF, 0.015));
    P.push(ell(m([0.13, 0.82, -0.52]), [0.1, 0.2, 0.17], b('hip'), 0.03, COAT, 0.06));
    P.push(cone(m([0.15, 0.84, -0.55]), m([0.15, 0.56, -0.42]), 0.09, 0.05, b('hip'), 0.025, COAT));
    P.push(cone(m([0.15, 0.56, -0.42]), m([0.15, 0.42, -0.68]), 0.062, 0.044, b('knee'), 0.018, DARK));
    P.push(cone(m([0.15, 0.42, -0.68]), m([0.15, 0.06, -0.62]), 0.042, 0.044, b('hock'), 0.026, DARK, 0.02));
    P.push(ell(m([0.15, 0.04, -0.6]), [0.072, 0.045, 0.088], b('hock'), 0, HOOF, 0.015));
  }
  return P;
}

/** Antlers: a curved main beam each side with a few tines and a brow tine (head-bone space). */
function antlerGeometry(scale: number, seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const head = new THREE.Vector3(...JOINTS.head.p);
  const tube = (pts: THREE.Vector3[], r0: number, r1: number) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 10, r0, 6, false);
    // taper toward the tip
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      curve.getPointAt(Math.min(1, u), c);
      p.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - (1 - r1 / r0) * u).add(c);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();
    parts.push(g);
  };
  for (const sx of [1, -1]) {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(sx * x * scale, y * scale, z * scale).add(new THREE.Vector3(0, 1.4, 0.8)).sub(head);
    const j = (rnd() - 0.5) * 0.04;
    const beam = [v(0.05, 0, 0), v(0.16, 0.2, -0.12), v(0.26, 0.42, -0.2 + j), v(0.3, 0.62, -0.1), v(0.26, 0.8, 0.08 + j), v(0.18, 0.9, 0.2)];
    tube(beam, 0.022 * scale, 0.008 * scale);
    // brow tine forward over the face (a shovel on one side)
    tube([v(0.08, 0.06, 0.0), v(0.08, 0.13, 0.12), v(0.05, 0.16, 0.22)], 0.013 * scale, 0.006 * scale);
    // back tine and a couple of tines off the top
    tube([v(0.26, 0.42, -0.2 + j), v(0.36, 0.52, -0.3), v(0.4, 0.62, -0.34)], 0.011 * scale, 0.005 * scale);
    tube([v(0.3, 0.62, -0.1), v(0.4, 0.74, -0.06), v(0.44, 0.84, 0.0)], 0.01 * scale, 0.004 * scale);
    tube([v(0.26, 0.8, 0.08 + j), v(0.3, 0.92, 0.16), v(0.3, 0.98, 0.26)], 0.009 * scale, 0.004 * scale);
  }
  const n = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const idx: number[] = [];
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
    for (const i of g.index!.array) idx.push(i + o);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return applyBoxUV(g);
}

type DeerState = 'graze' | 'dig' | 'look' | 'walk';

interface Deer {
  group: THREE.Group;
  bones: THREE.Bone[];
  x: number;
  z: number;
  heading: number;
  state: DeerState;
  timer: number;
  dur: number;
  tx: number;
  tz: number;
  phase: number;
  speed: number;
  pose: Pose;
  w: Record<DeerState, number>;
  seed: number;
}

/** grazing: muzzle down in the crater */
function poseGraze(p: Pose, t: number, seed: number, dig: number): Pose {
  p.clear();
  p.set(B.neck, 1.28 + 0.04 * Math.sin(t * 0.7 + seed));
  p.set(B.head, 0.45 + 0.06 * Math.sin(t * 2.3 + seed) * Math.sin(t * 0.4));
  p.set(B.chest, 0.1);
  p.lift = -0.03;
  // front legs braced a little apart; the digging leg paws at the snow
  const paw = dig * Math.max(0, Math.sin(t * 5.5 + seed));
  p.set(B.shoulderL, -0.22 - 0.35 * paw, 0, 0.06);
  p.set(B.elbowL, 0.12 + 0.9 * paw);
  p.set(B.wristL, 0.1 + 0.6 * paw);
  p.set(B.shoulderR, -0.24, 0, -0.06);
  p.set(B.elbowR, 0.12);
  p.set(B.wristR, 0.1);
  p.set(B.tail1, 0.2 + 0.15 * Math.sin(t * 3 + seed));
  p.set(B.earL, 0, 0, 0.3 + 0.2 * Math.sin(t * 0.5 + seed));
  p.set(B.earR, 0, 0, -0.3 - 0.2 * Math.sin(t * 0.6 + seed));
  return p;
}

/** head up, looking round */
function poseLook(p: Pose, t: number, seed: number): Pose {
  p.clear();
  p.set(B.neck, -0.12, Math.sin(t * 0.35 + seed) * 0.35);
  p.set(B.head, 0.15, Math.sin(t * 0.35 + seed) * 0.35);
  p.set(B.earL, -0.2, 0, 0.15);
  p.set(B.earR, -0.2, 0, -0.15);
  p.set(B.tail1, 0.1);
  return p;
}

/** a four-beat walk, head carried low and nodding */
function poseWalk(p: Pose, phase: number, t: number): Pose {
  p.clear();
  // lateral sequence: left hind, left fore, right hind, right fore
  const legs: [number, number, number, number, boolean][] = [
    [B.hipL, B.kneeL, B.hockL, 0.0, false],
    [B.shoulderL, B.elbowL, B.wristL, 0.25, true],
    [B.hipR, B.kneeR, B.hockR, 0.5, false],
    [B.shoulderR, B.elbowR, B.wristR, 0.75, true],
  ];
  for (const [b0, b1, b2, off, fore] of legs) {
    const [sw, lift] = legCycle(phase + off, 0.68);
    if (fore) {
      p.set(b0, sw * 0.3);
      p.set(b1, lift * 0.7);
      p.set(b2, lift * 1.0);
    } else {
      p.set(b0, sw * 0.3 - lift * 0.15);
      p.set(b1, lift * 0.45);
      p.set(b2, -lift * 0.6);
    }
  }
  const nod = Math.sin(phase * Math.PI * 4);
  p.set(B.neck, 0.35 + nod * 0.04);
  p.set(B.head, 0.25);
  p.lift = nod * 0.01;
  p.set(B.tail1, 0.15);
  void t;
  return p;
}

let craterTex: THREE.Texture | null = null;
/** a feeding crater: trampled blue-grey snow round a hole dug down to brown lichen and moss */
function craterTexture(): THREE.Texture {
  if (craterTex) return craterTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const rnd = mulberry32(5);
  const bumps = Array.from({ length: 9 }, () => [rnd() * 6.28, 0.7 + rnd() * 0.5]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const a = Math.atan2(v, u);
      let wob = 0;
      for (const [p, k] of bumps) wob += Math.sin(a * 3 + p) * 0.03 * k;
      const r = Math.hypot(u, v) * 2 + wob;
      // trampled ring (blue-grey), a dark hole with lichen in the middle
      const ring = Math.max(0, 1 - Math.abs(r - 0.62) / 0.3);
      const hole = 1 - Math.min(1, Math.max(0, (r - 0.22) / 0.2));
      const o = (y * S + x) * 4;
      const n = rnd() * 0.15;
      img.data[o] = Math.round(255 - ring * 45 - hole * (150 + n * 200));
      img.data[o + 1] = Math.round(255 - ring * 35 - hole * (155 + n * 150));
      img.data[o + 2] = Math.round(255 - ring * 20 - hole * (175 + n * 100));
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  craterTex = new THREE.CanvasTexture(c);
  craterTex.colorSpace = THREE.SRGBColorSpace;
  return craterTex;
}

/** Feeding craters scattered over the herd's range, lying on the ground (multiply decals). */
function feedingCraters(cx: number, cz: number, radius: number, open: (x: number, z: number) => boolean, ground: (x: number, z: number) => number): THREE.Mesh {
  const rnd = mulberry32(919);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let n = 0; n < 34; n++) {
    const a = rnd() * Math.PI * 2;
    const rr = radius * Math.sqrt(rnd());
    const x0 = cx + Math.cos(a) * rr;
    const z0 = cz + Math.sin(a) * rr;
    if (!open(x0, z0)) continue;
    const size = 0.5 + rnd() * 0.45;
    const rot = rnd() * 6.28;
    const seg = 4;
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const u = i / seg - 0.5;
        const v = j / seg - 0.5;
        const x = x0 + (u * Math.cos(rot) - v * Math.sin(rot)) * size * 2;
        const z = z0 + (u * Math.sin(rot) + v * Math.cos(rot)) * size * 2;
        pos.push(x, ground(x, z) + 0.02, z);
        uv.push(i / seg, j / seg);
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const k = base + j * (seg + 1) + i;
        idx.push(k, k + seg + 1, k + 1, k + 1, k + seg + 1, k + seg + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({
    name: 'feedingCraters',
    map: craterTexture(),
    blending: THREE.MultiplyBlending,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    fog: false,
  });
  m.userData.snow = 0;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'feeding-craters';
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  return mesh;
}

export interface Herd {
  object: THREE.Group;
  update(dt: number, t: number): void;
  /** world positions of the animals (for the fox to keep its distance, picks) */
  members: { x: number; z: number }[];
  pick: THREE.Group;
}

/** Build the herd round (cx, cz): `n` animals, wandering within `radius`. */
export function buildHerd(
  ctx: FeatureContext,
  fur: FurMaterials,
  shellsOf: (g: THREE.BufferGeometry) => THREE.BufferGeometry,
  cx: number,
  cz: number,
  radius: number,
  n: number,
  open: (x: number, z: number) => boolean,
  ground: (x: number, z: number) => number = heightAt,
): Herd {
  const rnd = mulberry32(8811);
  const body = buildBody({ joints: JOINTS, prims: prims(), eyes: { l: [0.075, 1.37, 0.93], r: [-0.075, 1.37, 0.93], radius: 0.016 }, nose: [0, 1.19, 1.15], blend: 0.03 }, 0.034);
  const shellGeo = shellsOf(body.geometry);
  const antlerMat = new THREE.MeshStandardMaterial({ name: 'antler', color: 0x6e604f, roughness: 0.75 });
  antlerMat.userData.snow = 0;
  const eyeMat = new THREE.MeshStandardMaterial({ name: 'deerEye', color: 0x0c0806, roughness: 0.1 });
  const group = new THREE.Group();
  group.name = 'reindeer';
  group.userData.snow = 0;
  group.userData.shelter = false;
  const pick = new THREE.Group();
  const herd: Deer[] = [];
  const hipsRest = new THREE.Vector3(...JOINTS.hips.p);
  const headRest = new THREE.Vector3(...JOINTS.head.p);
  for (let i = 0; i < n; i++) {
    const b2 = buildBodyBones(body.bones);
    const mesh = new THREE.SkinnedMesh(body.geometry, fur.base);
    const shells = new THREE.SkinnedMesh(shellGeo, fur.shell);
    const skel = new THREE.Skeleton(b2);
    mesh.add(b2[0]);
    mesh.bind(skel);
    shells.bind(skel, mesh.bindMatrix);
    for (const m of [mesh, shells]) {
      m.frustumCulled = false;
      m.castShadow = m === mesh;
      m.receiveShadow = true;
      m.raycast = () => {};
    }
    shells.renderOrder = 3;
    const calf = i === n - 1;
    const g = new THREE.Group();
    g.add(mesh, shells);
    const s = calf ? 0.72 : 0.92 + rnd() * 0.15;
    g.scale.setScalar(s);
    if (!calf) {
      const ant = new THREE.Mesh(antlerGeometry(0.85 + rnd() * 0.35, 77 + i), antlerMat);
      ant.raycast = () => {};
      b2[B.head].add(ant);
    }
    for (const e of [body.eyes.l, body.eyes.r]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(body.eyes.radius, 10, 6), eyeMat);
      eye.position.copy(e).sub(headRest);
      b2[B.head].add(eye);
    }
    b2[B.head].add(buildBreath(ctx, new THREE.Vector3(0, -0.12, 0.38), new THREE.Vector3(0, -0.3, 1), 0.11, 3.2 + rnd() * 0.8).mesh);
    group.add(g);
    // spread out round the centre on open ground
    let x = cx;
    let z = cz;
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2;
      const r = radius * Math.sqrt(rnd()) * 0.7;
      x = cx + Math.cos(a) * r;
      z = cz + Math.sin(a) * r;
      if (open(x, z)) break;
    }
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 2.0), new THREE.MeshBasicMaterial({ visible: false }));
    hb.position.set(0, 0.9, 0);
    hb.userData.noMerge = true;
    g.add(hb);
    pick.add(hb);
    herd.push({
      group: g,
      bones: b2,
      x,
      z,
      heading: rnd() * Math.PI * 2,
      state: 'graze',
      timer: rnd() * 10,
      dur: 8 + rnd() * 12,
      tx: x,
      tz: z,
      phase: rnd(),
      speed: 0,
      pose: new Pose(),
      w: { graze: 1, dig: 0, look: 0, walk: 0 },
      seed: rnd() * 10,
    });
  }
  group.add(feedingCraters(cx, cz, radius, open, ground));
  const tmp = new Pose();
  const mix = new Pose();
  const members = herd.map((d) => ({ x: d.x, z: d.z }));

  const update = (dt: number, t: number) => {
    dt = Math.min(dt, 0.1);
    herd.forEach((d, i) => {
      d.timer += dt;
      if (d.state === 'walk') {
        const dx = d.tx - d.x;
        const dz = d.tz - d.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        let dh = want - d.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        d.heading += THREE.MathUtils.clamp(dh, -0.8 * dt, 0.8 * dt);
        d.speed += (0.55 - d.speed) * Math.min(1, dt * 1.5);
        if (dist < 0.4 || d.timer > 25) {
          d.state = 'graze';
          d.timer = 0;
          d.dur = 10 + rnd() * 18;
        }
      } else {
        d.speed += (0 - d.speed) * Math.min(1, dt * 2);
        if (d.timer > d.dur) {
          d.timer = 0;
          const r = rnd();
          if (r < 0.35) {
            // wander to a new spot nearby, inside the herd's range
            for (let k = 0; k < 10; k++) {
              const a = rnd() * Math.PI * 2;
              const rr = 2 + rnd() * 6;
              const tx = d.x + Math.cos(a) * rr;
              const tz = d.z + Math.sin(a) * rr;
              if (Math.hypot(tx - cx, tz - cz) < radius && open(tx, tz)) {
                d.tx = tx;
                d.tz = tz;
                d.state = 'walk';
                break;
              }
            }
            if (d.state !== 'walk') d.state = 'look';
            d.dur = 30;
          } else if (r < 0.6) {
            d.state = 'look';
            d.dur = 3 + rnd() * 5;
          } else if (r < 0.8) {
            d.state = 'dig';
            d.dur = 2.5 + rnd() * 3;
          } else {
            d.state = 'graze';
            d.dur = 8 + rnd() * 14;
          }
        }
      }
      d.x += Math.sin(d.heading) * d.speed * dt;
      d.z += Math.cos(d.heading) * d.speed * dt;
      members[i].x = d.x;
      members[i].z = d.z;
      d.phase += (dt * d.speed) / 1.1;
      // blend the poses
      for (const k of Object.keys(d.w) as DeerState[]) d.w[k] += ((k === d.state ? 1 : 0) - d.w[k]) * Math.min(1, dt * 1.6);
      mix.clear();
      let ws = 0;
      if (d.w.graze + d.w.dig > 0.002) {
        poseGraze(tmp, t, d.seed, d.w.dig / Math.max(1e-3, d.w.graze + d.w.dig));
        mix.accumulate(tmp, d.w.graze + d.w.dig);
        ws += d.w.graze + d.w.dig;
      }
      if (d.w.look > 0.002) {
        poseLook(tmp, t, d.seed);
        mix.accumulate(tmp, d.w.look);
        ws += d.w.look;
      }
      if (d.w.walk > 0.002) {
        poseWalk(tmp, d.phase, t);
        mix.accumulate(tmp, d.w.walk);
        ws += d.w.walk;
      }
      if (ws > 0) {
        for (let k = 0; k < mix.a.length; k++) mix.a[k] /= ws;
        mix.lift /= ws;
      }
      applyPose(d.bones, mix, hipsRest);
      const gy = heightAt(d.x, d.z);
      d.group.position.set(d.x, gy - 0.03, d.z);
      const fx = Math.sin(d.heading);
      const fz = Math.cos(d.heading);
      const pitch = Math.atan2(heightAt(d.x + fx * 0.6, d.z + fz * 0.6) - heightAt(d.x - fx * 0.6, d.z - fz * 0.6), 1.2);
      d.group.rotation.set(0, 0, 0);
      d.group.rotateY(d.heading);
      d.group.rotateX(-pitch * 0.8);
    });
  };
  update(0.016, 0);
  return { object: group, update, members, pick };
}

/** A fresh copy of a bone hierarchy (same names and rest offsets). */
function buildBodyBones(src: THREE.Bone[]): THREE.Bone[] {
  const out: THREE.Bone[] = src.map((b) => {
    const n = new THREE.Bone();
    n.name = b.name;
    n.position.copy(b.position);
    return n;
  });
  src.forEach((b, i) => {
    const pi = src.indexOf(b.parent as THREE.Bone);
    if (pi >= 0) out[pi].add(out[i]);
  });
  return out;
}
