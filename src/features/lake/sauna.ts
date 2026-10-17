/**
 * The lakeside sauna on Mirror Lake's west shore: a silvered timber sauna
 * with a fieldstone chimney (wood smoke when it is fired), warm windows, a
 * deck in front of the door and firewood under the eaves; a jetty runs from
 * the deck out over the ice to the avanto, a hole kept open in the ice, with
 * a steel ladder down into the black water. Steam rises off the hole.
 */
import * as THREE from 'three';
import { applyBoxUV, snowCap } from '../../core/geometry';
import type { FeatureContext } from '../../core/types';
import { LAKE, SAUNA } from '../../world/layout';
import { mulberry32 } from '../../world/noise';
import { heightAt } from '../../world/terrain-height';
import { flatStoneGeometry } from '../paths/kit/rocks';
import { driftGeometry } from './drift';
import { buildHut, type HutBuild } from './hut';
import { ladder, placeAt, plankBench, benchSnow, woodStack, type PropBatch } from './props';

export interface SaunaBuild {
  hut: HutBuild;
  /** the open water of the ice hole (its own material) */
  hole: THREE.Mesh;
  holeMat: THREE.MeshStandardMaterial;
  /** walkable deck + jetty */
  deckAt(x: number, z: number): number | null;
  deckBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  circles: { x: number; z: number; r: number; yMax?: number }[];
  /** where the jetty ends over the hole (ladder top) */
  ladderTop: THREE.Vector3;
  /** the storm lantern on the wall by the door (its glass centre) */
  doorLamp: THREE.Vector3;
}

export const SAUNA_HUT = { w: 4.0, d: 3.2, wallH: 2.15, pitch: 0.75 };

export function buildSauna(ctx: FeatureContext, props: PropBatch, glow: THREE.MeshStandardMaterial): SaunaBuild {
  const rnd = mulberry32(2611);
  const floorY = SAUNA.y + 0.22;
  const hut = buildHut(
    ctx,
    {
      name: 'lake-sauna',
      x: SAUNA.x,
      z: SAUNA.z,
      y: floorY,
      rotY: SAUNA.rotY,
      w: SAUNA_HUT.w,
      d: SAUNA_HUT.d,
      wallH: SAUNA_HUT.wallH,
      pitch: SAUNA_HUT.pitch,
      eave: 0.45,
      rake: 0.3,
      wall: 'weatheredTimber',
      trim: 'tarredWood',
      doors: [{ side: 'front', s: -0.95, y: 0, w: 0.75, h: 1.85 }],
      windows: [
        { side: 'front', s: 0.75, y: 1.05, w: 0.7, h: 0.5 },
        { side: 'right', s: 0.3, y: 1.1, w: 0.5, h: 0.42 },
      ],
      chimney: { x: 1.2, z: -0.55, size: 0.5, h: 0.65 },
      base: 'stones',
      baseH: 0.22,
      snow: 0.34,
      icicles: 0.42,
      seed: 21,
    },
    glow,
  );
  const circles: SaunaBuild['circles'] = [];

  /* ---------- deck in front of the door, steps and the jetty ---------- */
  // world frame: the front faces +x (east); along the front is z
  const front = SAUNA.x + SAUNA_HUT.d / 2;
  const deck = { minX: front, maxX: front + 2.1, minZ: SAUNA.z - 2.1, maxZ: SAUNA.z + 2.0 };
  const deckTop = floorY - 0.04;
  const boards = (x0: number, x1: number, z0: number, z1: number, top: number, alongX: boolean) => {
    const bw = 0.14;
    const gap = 0.012;
    const span = alongX ? z1 - z0 : x1 - x0;
    const n = Math.floor(span / (bw + gap));
    for (let i = 0; i < n; i++) {
      const c = (alongX ? z0 : x0) + (i + 0.5) * (span / n);
      const g = alongX ? new THREE.BoxGeometry(x1 - x0, 0.035, bw) : new THREE.BoxGeometry(bw, 0.035, z1 - z0);
      applyBoxUV(g, { grain: alongX ? 'x' : 'z', offset: [rnd() * 5, rnd() * 5] });
      g.translate(alongX ? (x0 + x1) / 2 : c, top - 0.0175 + (rnd() - 0.5) * 0.006, alongX ? c : (z0 + z1) / 2);
      props.add('weatheredTimber', g);
    }
  };
  boards(deck.minX, deck.maxX, deck.minZ, deck.maxZ, deckTop, false);
  // frame under the deck and posts on stones
  for (const z of [deck.minZ + 0.1, deck.maxZ - 0.1]) {
    const g = new THREE.BoxGeometry(deck.maxX - deck.minX, 0.14, 0.08);
    g.translate((deck.minX + deck.maxX) / 2, deckTop - 0.11, z);
    props.add('weatheredTimber', applyBoxUV(g, { grain: 'x' }));
  }
  for (const [x, z] of [
    [deck.maxX - 0.1, deck.minZ + 0.1],
    [deck.maxX - 0.1, deck.maxZ - 0.1],
  ]) {
    const gy = heightAt(x, z);
    const g = new THREE.BoxGeometry(0.1, deckTop - gy, 0.1);
    g.translate(x, (deckTop + gy) / 2 - 0.05, z);
    props.add('weatheredTimber', applyBoxUV(g, { grain: 'y' }));
  }

  // the jetty: from the deck's south-east corner out over the ice to the hole
  const hole = SAUNA.iceHole;
  const j0 = new THREE.Vector3(deck.maxX, deckTop, SAUNA.z + 1.3);
  const j1 = new THREE.Vector3(hole.x - hole.r * 0.6, LAKE.y + 0.62, hole.z);
  const jDir = j1.clone().sub(j0).setY(0);
  const jLen = jDir.length();
  jDir.normalize();
  const jSide = new THREE.Vector3(-jDir.z, 0, jDir.x);
  const jW = 1.15;
  const jYaw = Math.atan2(-jDir.z, jDir.x);
  // deck height along the jetty: steps down the bank (following the ground, 0.2 m above it) to the
  // jetty's level over the ice
  const STEP = 0.2;
  let stepEnd = 0;
  const levels: number[] = [];
  for (let s = 0; s <= jLen + 0.5; s += 0.1) {
    const p = j0.clone().addScaledVector(jDir, s);
    const want = Math.min(deckTop, Math.max(j1.y, heightAt(p.x, p.z) + 0.22));
    // quantise into steps measured down from the deck
    const k = Math.ceil((deckTop - want) / STEP - 1e-3);
    const y = Math.max(j1.y, deckTop - k * STEP);
    levels.push(y);
    if (y > j1.y + 1e-3) stepEnd = s;
  }
  // never step back up
  for (let i = 1; i < levels.length; i++) levels[i] = Math.min(levels[i], levels[i - 1]);
  const jy = (s: number) => levels[Math.max(0, Math.min(levels.length - 1, Math.round(s / 0.1)))];
  const plankPitch = 0.19;
  for (let s = 0.1; s < jLen + 0.3; s += plankPitch) {
    const p = j0.clone().addScaledVector(jDir, s);
    const g = new THREE.BoxGeometry(0.165, 0.04, jW);
    g.rotateY(jYaw);
    g.translate(p.x, jy(s) - 0.02 + (rnd() - 0.5) * 0.008, p.z);
    props.add('weatheredTimber', applyBoxUV(g, { grain: 'z', offset: [rnd() * 5, rnd() * 5] }));
  }
  // stringers and posts frozen into the ice
  for (const sd of [-1, 1]) {
    const a = j0.clone().addScaledVector(jSide, sd * (jW / 2 - 0.12));
    const b = j0.clone().addScaledVector(jDir, jLen + 0.3).addScaledVector(jSide, sd * (jW / 2 - 0.12));
    const g = new THREE.BoxGeometry(a.distanceTo(b), 0.16, 0.07);
    g.rotateY(jYaw);
    g.translate((a.x + b.x) / 2, j1.y - 0.12, (a.z + b.z) / 2);
    props.add('weatheredTimber', applyBoxUV(g, { grain: 'x' }));
    for (let s = 1.2; s < jLen + 0.3; s += 1.9) {
      const p = j0.clone().addScaledVector(jDir, s).addScaledVector(jSide, sd * (jW / 2 - 0.1));
      const gy = heightAt(p.x, p.z);
      const top = jy(s) - 0.05;
      const post = new THREE.CylinderGeometry(0.075, 0.08, top - gy + 0.3, 8);
      post.translate(p.x, (top + gy - 0.3) / 2, p.z);
      props.add('weatheredTimber', applyBoxUV(post, { grain: 'y' }));
      circles.push({ x: p.x, z: p.z, r: 0.09, yMax: top });
    }
  }
  // snow lying along both edges of the jetty, trodden bare in the middle
  for (const sd of [-1, 1]) {
    const a = j0.clone().addScaledVector(jDir, stepEnd).addScaledVector(jSide, sd * (jW / 2 - 0.12));
    const b = j0.clone().addScaledVector(jDir, jLen + 0.2).addScaledVector(jSide, sd * (jW / 2 - 0.12));
    const g = new THREE.BoxGeometry(a.distanceTo(b), 0.03, 0.2);
    g.rotateY(jYaw);
    g.translate((a.x + b.x) / 2, j1.y + 0.0, (a.z + b.z) / 2);
    const cap = snowCap(g, { thickness: 0.07, cell: 0.03, overhang: 0.06, lumps: 0.6, align: 'auto', seed: 7 + sd });
    if (cap) props.add('snowPack', cap, false);
    g.dispose();
  }
  // the ladder down into the hole
  const ladderTop = j0.clone().addScaledVector(jDir, jLen + 0.18).setY(j1.y);
  props.place(ladder(0, -(j1.y - LAKE.y) - 0.9), placeAt(ladderTop.x, ladderTop.y, ladderTop.z, Math.atan2(jDir.x, jDir.z) + Math.PI), false);

  /* ---------- the avanto: open water, a raised rim of slushy ice, shovelled snow round it ---------- */
  const holeMat = new THREE.MeshStandardMaterial({
    name: 'avantoWater',
    color: 0x050809,
    roughness: 0.04,
    metalness: 0,
    envMapIntensity: 1.2,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  holeMat.userData.snow = 0;
  const holeGeo = new THREE.CircleGeometry(hole.r, 40);
  holeGeo.rotateX(-Math.PI / 2);
  // a slightly ragged edge
  {
    const pos = holeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 1; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.05 * Math.sin(a * 3 + 1.2) + 0.04 * Math.sin(a * 7 + 0.4);
      pos.setXYZ(i, x * k, 0, z * k);
    }
  }
  holeGeo.translate(hole.x, LAKE.y + 0.012, hole.z);
  const holeMesh = new THREE.Mesh(holeGeo, holeMat);
  holeMesh.name = 'avanto';
  holeMesh.userData.snow = 0;
  holeMesh.receiveShadow = true;
  // rim: a ring of slush and broken ice slabs, thick ice showing at the edge
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
    const r = hole.r * (1.04 + rnd() * 0.18);
    const big = rnd();
    const g = flatStoneGeometry(3100 + i, 0.1 + big * 0.14, 0.04 + rnd() * 0.05, 0.07 + rnd() * 0.08, 0.9, 10);
    g.rotateY(-a + (rnd() - 0.5) * 0.8);
    g.rotateZ((rnd() - 0.5) * 0.4);
    g.rotateX((rnd() - 0.5) * 0.3);
    g.translate(hole.x + Math.cos(a) * r, LAKE.y - 0.035, hole.z + Math.sin(a) * r);
    // broken slabs of clear ice, some crusted with snow and slush
    props.add(rnd() < 0.55 ? 'ice' : 'snowPack', g, false);
  }
  // shovelled snow banked in a broken ring round the cleared ice
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.3;
    // leave the side under the jetty open
    const toJ = Math.cos(a) * -jDir.x + Math.sin(a) * -jDir.z;
    if (toJ > 0.7) continue;
    const r = 2.4 + rnd() * 0.5;
    const x = hole.x + Math.cos(a) * r;
    const z = hole.z + Math.sin(a) * r;
    props.add('snowPack', driftGeometry(x, z, 0.75 + rnd() * 0.35, 0.36 + rnd() * 0.1, 0.1 + rnd() * 0.08, () => LAKE.y, { rot: a + Math.PI / 2, skew: 0, seg: 8, sink: 0.02 }));
  }

  /* ---------- by the sauna: firewood, a bench, a stone step ---------- */
  // firewood stacked against the south gable (local -x -> world +z with rotY pi/2)
  {
    const gable = hut.toWorld(-SAUNA_HUT.w / 2, 0, 0);
    const m = placeAt(gable.x - 0.1, heightAt(gable.x, gable.z + 0.2) - 0.02, gable.z + 0.05, 0);
    props.place(woodStack(2.2, 1.15, 33), m);
  }
  // bench against the front wall beside the window, on the deck
  {
    const len = 1.3;
    const m = placeAt(front + 0.3, deckTop, SAUNA.z - 0.85, -Math.PI / 2);
    props.place(plankBench(len), m);
    props.add('snowPack', benchSnow(len, m, 17), false);
  }

  /* ---------- a storm lantern on the wall by the door ---------- */
  const doorLamp = hut.toWorld(-0.35, 1.72, SAUNA_HUT.d / 2 + 0.13);
  {
    const yaw = SAUNA.rotY;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(doorLamp);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return applyBoxUV(g).applyMatrix4(m);
    };
    props.add('blackSteel', box(0.04, 0.04, 0.16, 0, 0.2, -0.07));
    props.add('blackSteel', box(0.15, 0.02, 0.15, 0, -0.12, 0));
    props.add('blackSteel', box(0.17, 0.03, 0.17, 0, 0.13, 0));
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      props.add('blackSteel', box(0.012, 0.25, 0.012, cx * 0.065, 0, cz * 0.065));
    props.add('lampGlass', box(0.11, 0.2, 0.11, 0, 0, 0), false);
  }

  /* ---------- walking surfaces ---------- */
  const deckBounds = {
    minX: deck.minX,
    maxX: Math.max(deck.maxX, j1.x + 0.6),
    minZ: Math.min(deck.minZ, j0.z - jW, j1.z - jW),
    maxZ: Math.max(deck.maxZ, j0.z + jW, j1.z + jW),
  };
  const deckAt = (x: number, z: number): number | null => {
    if (x >= deck.minX && x <= deck.maxX && z >= deck.minZ && z <= deck.maxZ) return deckTop;
    const dx = x - j0.x;
    const dz = z - j0.z;
    const s = dx * jDir.x + dz * jDir.z;
    const t = dx * jSide.x + dz * jSide.z;
    if (s >= 0 && s <= jLen + 0.3 && Math.abs(t) <= jW / 2) return jy(s);
    return null;
  };
  for (const [x, z] of hut.corners) circles.push({ x, z, r: 0.2 });

  return { hut, hole: holeMesh, holeMat, deckAt, deckBounds, circles, ladderTop, doorLamp };
}
