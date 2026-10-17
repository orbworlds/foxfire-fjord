/**
 * The icefall below the hot spring: the pool's overflow leaves through the
 * stones on the cliff side and runs down the crag's north face, freezing as
 * it goes into a curtain of milky blue ice - bulging columns, a fringe of
 * icicles on every ledge - seventy metres down to the scree. Seen from the road
 * to Lysvik under the crag and from the fjord.
 *
 * The curtain hangs a hand off the face the terrain mesh actually draws (the
 * level-0 triangle grid), found by marching outward from the brink at each
 * height, so it never floats or sinks into the rock.
 */
import * as THREE from 'three';
import { applyBoxUV, icicles } from '../../core/geometry';
import type { FeatureContext } from '../../core/types';
import { createSimplex2D } from '../../world/noise';
import { drawnSurface } from '../fox/prints';
import { terrainConfig } from '../terrain/config';
import { driftGeometry } from '../lake/drift';
import { GROUND_Y } from './layout';

/** where the overflow goes over the brink (world xz) and which way the face falls (unit xz, outward) */
const LIP = { x: -380.6, z: -33.6 };
const OUT = { x: 0, z: -1 };

export function buildIcefall(ctx: FeatureContext): THREE.Group {
  const surf = drawnSurface(terrainConfig(ctx.quality).fineSpacing);
  const n2 = createSimplex2D(4711);
  const group = new THREE.Group();
  group.name = 'spring-icefall';
  // the face's distance outward from the lip at a given height, along OUT, at lateral offset u
  const side = { x: -OUT.z, z: OUT.x };
  const faceAt = (u: number, y: number): number => {
    let d = 0;
    for (; d < 40; d += 0.08) {
      const x = LIP.x + side.x * u + OUT.x * d;
      const z = LIP.z + side.z * u + OUT.z * d;
      if (surf(x, z) < y) break;
    }
    return d;
  };
  const top = GROUND_Y - 0.05;
  // down the cliff and the steep apron below it to where the scree flattens out (~47 m)
  const drop = top - 47.6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const deep = new THREE.Color(0.3, 0.46, 0.58);
  const milky = new THREE.Color(0.9, 0.93, 0.96);
  const c = new THREE.Color();
  /**
   * One curtain of ice: from t0 to t1 of the drop, centred u0 metres along the
   * face (drifting with the flow), half width half(t), seeded noise.
   */
  const addCurtain = (o: { u0: number; t0: number; t1: number; half: (t: number) => number; seed: number; rows: number; cols: number; thick: number }) => {
    const base = pos.length / 3;
    for (let j = 0; j <= o.rows; j++) {
      const t = o.t0 + (o.t1 - o.t0) * (j / o.rows);
      const tl = (t - o.t0) / (o.t1 - o.t0);
      const half = o.half(t) * (1 + 0.28 * n2(t * 16 + o.seed, 2.1 + o.seed) + 0.15 * n2(t * 37 + o.seed, 5.3));
      for (let i = 0; i <= o.cols; i++) {
        const v = (i / o.cols) * 2 - 1;
        // a ragged foot: the middle columns reach furthest down, the edges stop short
        const rag = (3.5 * v * v + 1.5 * (0.5 + 0.5 * n2(v * 3.1 + o.seed, 9.2))) * Math.pow(tl, 6) * (o.t1 - o.t0);
        // and a ragged top where a side strand leaves a ledge
        const capT = o.t0 > 0 ? (1 - Math.min(1, tl * 12)) * (0.8 * v * v) : 0;
        const y = top - drop * Math.pow(t, 1.15) + rag - capT;
        const u = o.u0 + v * half + 0.6 * n2(t * 3 + o.seed, 7.1) * t;
        const d = faceAt(u, y);
        // columns: ridges of thicker ice running down, bulging where it piled up on ledges
        const ridge = 0.5 + 0.5 * Math.sin(v * 7.5 + n2(t * 4 + o.seed, v * 2) * 2.0);
        const bulge = 0.5 + 0.5 * n2(t * 9 + 3 + o.seed, v * 1.5);
        const edge = Math.pow(Math.max(0, 1 - v * v), 0.6);
        const thick = o.thick * (0.08 + 0.42 * ridge * bulge) * edge * (0.4 + 0.6 * Math.min(1, tl * 8)) * (1 + 0.8 * THREE.MathUtils.smoothstep(t, 0.85, 1));
        const out = d + thick - 0.04;
        pos.push(LIP.x + side.x * u + OUT.x * out, y, LIP.z + side.z * u + OUT.z * out);
        // thick ice is milky with trapped air, thin ice over the rock dark and blue; long vertical streaks
        const streak = 0.5 + 0.5 * n2(v * 9.0 + o.seed, t * 0.8);
        const thin = 1 - edge;
        c.copy(deep).lerp(milky, THREE.MathUtils.clamp(0.1 + 0.85 * ridge * bulge * edge + 0.35 * (streak - 0.5) - 0.3 * thin, 0, 1));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < o.rows; j++) {
      for (let i = 0; i < o.cols; i++) {
        const a = base + j * (o.cols + 1) + i;
        const b = a + 1;
        const cc = a + o.cols + 1;
        const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
  };
  const halfAt = (t: number) => 0.7 + 1.9 * Math.sqrt(t) + 0.4 * n2(t * 6, 1.3) + 0.9 * t * n2(t * 4.5, 3.7) + 1.4 * THREE.MathUtils.smoothstep(t, 0.75, 1);
  // the main fall
  addCurtain({ u0: 0, t0: 0, t1: 1, half: (t) => halfAt(t) * 1.2, seed: 0, rows: 96, cols: 18, thick: 1 });
  // a thinner strand that spilled over a ledge to the west and freezes short of the scree
  addCurtain({ u0: -5.6, t0: 0.2, t1: 0.52, half: (t) => 0.5 + 1.1 * Math.sqrt(t - 0.2), seed: 11, rows: 36, cols: 10, thick: 0.6 });
  // and a short, fat one to the east, hanging from the first big ledge in a fringe
  addCurtain({ u0: 5.2, t0: 0.34, t1: 0.6, half: (t) => 0.65 + 1.3 * Math.sqrt(t - 0.34), seed: 23, rows: 30, cols: 10, thick: 0.8 });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face outward (north)
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const mid = Math.floor(nrm.count / 2);
  if (nrm.getX(mid) * OUT.x + nrm.getZ(mid) * OUT.z < 0) {
    for (let k = 0; k < idx.length; k += 3) {
      const tmp = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = tmp;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  applyBoxUV(g);
  g.computeBoundingSphere();
  // milky, bubbly ice: pale blue-white, glassy where it is thin
  const mat = ctx.materials.get('ice').clone();
  mat.name = 'icefall';
  mat.color.set(0x98aebb);
  mat.vertexColors = true;
  mat.roughness = 0.22;
  mat.userData = { ...mat.userData, snow: 0.25, iceGround: [0.35, 0.38, 0.42] };
  const curtain = new THREE.Mesh(g, mat);
  curtain.castShadow = true;
  curtain.receiveShadow = true;
  group.add(curtain);

  // icicle fringes along a few ledges where the flow broke
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  // (only on the sheer upper cliff: below it the ice lies on the apron)
  for (const t of [0.0, 0.12, 0.25, 0.38, 0.5]) {
    const y = top - drop * Math.pow(t, 1.15) - 0.05;
    const half = halfAt(t) * 0.8 - 0.2;
    const a = new THREE.Vector3(LIP.x - side.x * half, y, LIP.z - side.z * half);
    const b = new THREE.Vector3(LIP.x + side.x * half, y, LIP.z + side.z * half);
    for (const p of [a, b]) {
      const u = (p.x - LIP.x) * side.x + (p.z - LIP.z) * side.z;
      const d = faceAt(u, y) + 0.3;
      p.x += OUT.x * d;
      p.z += OUT.z * d;
    }
    edges.push([a, b]);
  }
  // fringes where the side strands leave their ledges
  for (const [u0, t, hw] of [
    [-5.6, 0.2, 0.6],
    [5.2, 0.34, 0.85],
  ]) {
    const y = top - drop * Math.pow(t, 1.15) - 0.05;
    const ends = [u0 - hw, u0 + hw].map((u) => {
      const d = faceAt(u, y) + 0.25;
      return new THREE.Vector3(LIP.x + side.x * u + OUT.x * d, y, LIP.z + side.z * u + OUT.z * d);
    });
    edges.push([ends[0], ends[1]]);
  }
  // the spill cone at the foot: ice that splashed and froze on the scree
  {
    const yEnd = top - drop;
    const d = faceAt(0, yEnd);
    const cx = LIP.x + OUT.x * (d + 1.2);
    const cz = LIP.z + OUT.z * (d + 1.2);
    const cone = driftGeometry(cx, cz, 3.2, 2.2, 1.3, surf, { rot: Math.atan2(side.z, side.x), seg: 12, skew: 0, sink: 0.15 });
    const cc = new Float32Array((cone.getAttribute('position') as THREE.BufferAttribute).count * 3);
    for (let k = 0; k < cc.length; k += 3) cc.set([0.88, 0.93, 0.97], k);
    cone.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const m = new THREE.Mesh(cone, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  const ic = icicles(edges, { spacing: 0.12, maxLength: 1.4, radius: 0.05, density: 0.75, seed: 91 });
  if (ic) {
    const icMat = mat.clone();
    icMat.vertexColors = false;
    icMat.color.set(0x8ea8b6);
    const m = new THREE.Mesh(ic, icMat);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}
