/**
 * Wooden trail signposts: a square pine post with a small pyramid cap and
 * arrow-ended boards lettered on both faces (place name and walking time),
 * with snow lying on the cap and along the top edge of every board.
 * All boards share one canvas atlas; each site is merged into two meshes
 * (painted wood, snow).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FeatureContext } from '../../core/types';
import { heightAt } from '../../world/terrain-height';
import { SIGNS, type SignArm, type SignDef } from './layout';
import { SERIF, makeCanvas, woodGrainFill } from './kit/text';
import { quad, tri, v3 } from './kit/shapes';

const ROWS = 8;
const ROW_PX = 128;
const W_PX = 512;
const WOOD_ROW = ROWS - 1;
const BOARD = { L: 0.62, h: 0.15, t: 0.026, tip: 0.07 };
const POST = { w: 0.095, h: 2.05, bury: 0.4 };
const ARM_Y = 1.82;
const ARM_STEP = 0.2;

export const SIGN_GLYPHS = SIGNS.flatMap((s) => s.arms.map((a) => a.en + a.time)).join('');

function drawBoard(g: CanvasRenderingContext2D, row: number, arm: SignArm, seed: number): void {
  const y0 = row * ROW_PX;
  woodGrainFill(g, 0, y0, W_PX, ROW_PX, '#8d5a3b', seed);
  g.strokeStyle = 'rgba(40,22,12,0.45)';
  g.lineWidth = 5;
  g.strokeRect(3, y0 + 3, W_PX - 6, ROW_PX - 6);
  let en = 50;
  let tm = 30;
  const measure = () => {
    g.font = `600 ${en}px ${SERIF}`;
    const a = g.measureText(arm.en).width;
    g.font = `500 ${tm}px ${SERIF}`;
    const b = g.measureText(arm.time).width;
    return a + 26 + b;
  };
  while (measure() > 400 && en > 26) {
    en -= 2;
    tm -= 1;
  }
  const w = measure();
  const x0 = W_PX / 2 - 30 - w / 2;
  g.fillStyle = '#f3ead8';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `600 ${en}px ${SERIF}`;
  g.fillText(arm.en, x0, y0 + 66);
  const a = g.measureText(arm.en).width;
  g.font = `500 ${tm}px ${SERIF}`;
  g.fillStyle = '#e8dcc4';
  g.fillText(arm.time, x0 + a + 26, y0 + 70);
}

function atlas(ctx: FeatureContext): { material: THREE.MeshStandardMaterial; rowOf: Map<SignArm, number> } {
  const [c, g] = makeCanvas(W_PX, ROWS * ROW_PX);
  const rowOf = new Map<SignArm, number>();
  let row = 0;
  for (const s of SIGNS) {
    for (const a of s.arms) {
      if (row >= WOOD_ROW) break;
      drawBoard(g, row, a, 31 + row * 13);
      rowOf.set(a, row++);
    }
  }
  woodGrainFill(g, 0, WOOD_ROW * ROW_PX, W_PX, ROW_PX, '#7a5238', 97);
  const tex = ctx.materials.canvasTexture(c, 1, true);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { material: new THREE.MeshStandardMaterial({ name: 'signBoards', map: tex, roughness: 0.84 }), rowOf };
}

/** atlas v for a row-local v (0 bottom .. 1 top) */
const rowV = (row: number, v: number) => 1 - (row + 1) / ROWS + v / ROWS;

function woodUV(g: THREE.BufferGeometry, alongFirst: boolean): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, alongFirst ? v : u, rowV(WOOD_ROW, alongFirst ? u : v));
  }
  return g;
}

/** Pentagon board along +x from the post, front face +z; lettering on both faces. */
function board(row: number): THREE.BufferGeometry {
  const { L, h, t, tip } = BOARD;
  const P = [
    [0, -h / 2],
    [L - tip, -h / 2],
    [L, 0],
    [L - tip, h / 2],
    [0, h / 2],
  ];
  const parts: THREE.BufferGeometry[] = [];
  const fuv = (p: number[]): [number, number] => [p[0] / L, rowV(row, (p[1] + h / 2) / h)];
  const buv = (p: number[]): [number, number] => [1 - p[0] / L, rowV(row, (p[1] + h / 2) / h)];
  const F = (p: number[]) => v3(p[0], p[1], t / 2);
  const B = (p: number[]) => v3(p[0], p[1], -t / 2);
  for (const [i, j] of [
    [1, 2],
    [2, 3],
    [3, 4],
  ]) {
    parts.push(tri([F(P[0]), F(P[i]), F(P[j])], [fuv(P[0]), fuv(P[i]), fuv(P[j])]));
    parts.push(tri([B(P[0]), B(P[j]), B(P[i])], [buv(P[0]), buv(P[j]), buv(P[i])]));
  }
  for (let i = 0; i < 5; i++) {
    const a = P[i];
    const b = P[(i + 1) % 5];
    const e = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v0 = rowV(WOOD_ROW, 0.3);
    const v1 = rowV(WOOD_ROW, 0.36);
    parts.push(
      quad(
        [B(a), B(b), F(b), F(a)],
        [
          [0, v0],
          [e, v0],
          [e, v1],
          [0, v1],
        ],
      ),
    );
  }
  return mergeGeometries(parts);
}

export interface SignSite {
  object: THREE.Object3D;
  center: THREE.Vector3;
  signs: { def: SignDef; ground: number }[];
}

export function buildSigns(ctx: FeatureContext): SignSite[] {
  const { material, rowOf } = atlas(ctx);
  const snowMat = new THREE.MeshStandardMaterial({ name: 'signSnow', color: 0xf2f6fb, roughness: 0.85 });
  const groups = new Map<string, SignDef[]>();
  for (const s of SIGNS) {
    const key = s.id.startsWith('cabin') ? 'cabin' : s.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const sites: SignSite[] = [];
  for (const [key, defs] of groups) {
    const parts: THREE.BufferGeometry[] = [];
    const snow: THREE.BufferGeometry[] = [];
    const signs: SignSite['signs'] = [];
    const center = new THREE.Vector3();
    for (const s of defs) {
      const ground = heightAt(s.x, s.z);
      signs.push({ def: s, ground });
      center.add(v3(s.x, ground + 1, s.z));
      const post = new THREE.BoxGeometry(POST.w, POST.h + POST.bury, POST.w).toNonIndexed();
      // side faces: grain up the post
      const uv = post.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 6);
        const side = face !== 2 && face !== 3;
        const u = uv.getX(i);
        const v = uv.getY(i);
        uv.setXY(i, side ? v * 1.4 : u * 0.2, rowV(WOOD_ROW, side ? u * 0.5 : v * 0.5));
      }
      post.translate(s.x, ground + (POST.h - POST.bury) / 2, s.z);
      parts.push(post);
      const cap = woodUV(new THREE.ConeGeometry(0.085, 0.075, 4, 1).toNonIndexed(), false);
      cap.rotateY(Math.PI / 4);
      cap.translate(s.x, ground + POST.h + 0.0375, s.z);
      parts.push(cap);
      const cone = new THREE.ConeGeometry(0.075, 0.07, 6, 1);
      cone.scale(1, 1, 1.15);
      cone.translate(s.x, ground + POST.h + 0.09, s.z);
      snow.push(cone.toNonIndexed());
      s.arms.forEach((a, i) => {
        const row = rowOf.get(a);
        if (row === undefined) return;
        const yaw = Math.atan2(-(a.toward[1] - s.z), a.toward[0] - s.x);
        const b = board(row);
        b.translate(-0.03, 0, 0);
        b.rotateY(yaw);
        b.translate(s.x, ground + ARM_Y - i * ARM_STEP, s.z);
        parts.push(b);
        // a ridge of snow along the board's top edge
        const ridge = new THREE.BoxGeometry(BOARD.L - BOARD.tip * 0.6, 0.028, BOARD.t + 0.012).toNonIndexed();
        ridge.translate((BOARD.L - BOARD.tip * 0.6) / 2 - 0.03, BOARD.h / 2 + 0.012, 0);
        ridge.rotateY(yaw);
        ridge.translate(s.x, ground + ARM_Y - i * ARM_STEP, s.z);
        snow.push(ridge);
      });
    }
    center.multiplyScalar(1 / defs.length);
    const geo = mergeGeometries(parts);
    geo.computeBoundingSphere();
    const group = new THREE.Group();
    group.name = `signs-${key}`;
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const snowMesh = new THREE.Mesh(mergeGeometries(snow.map((g) => (g.index ? g.toNonIndexed() : g))), snowMat);
    snowMesh.receiveShadow = true;
    group.add(mesh, snowMesh);
    sites.push({ object: group, center, signs });
  }
  return sites;
}
