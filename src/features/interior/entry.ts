/**
 * The way in from the snow, round the entry door on the south wall: two
 * pairs of wooden touring skis and their poles leaning on the panelling,
 * a pair of ash-framed snowshoes on a peg, felt-lined boots drying on a
 * slatted tray, a peg rail with a knitted hat, a scarf and mittens, a pine
 * bench with a sheepskin, and a rag mat inside the door.
 */
import * as THREE from 'three';
import { boxMinMax } from '../house/kit';
import { roundedBox } from '../../core/geometry';
import { HOUSE } from '../../world/layout';
import type { InteriorMats } from './mats';
import { drape, place, rod, softBox, tube, turned, type V2 } from './kit';
import { bentBoard, type Kit } from './furn';

/** inner face of the south wall (house-local z) */
const ZW = 3.26;

export function buildEntry(k: Kit, m: InteriorMats, fancy: boolean): void {
  const { B, shadows } = k;
  const ex = HOUSE.entryX;

  /* ------------------------------ rag mat ------------------------------ */
  {
    const g = new THREE.BoxGeometry(1.1, 0.008, 0.62);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getZ(i) + 0.31) / 1.5 + 0.4, (p.getX(i) + 0.55) / 1.5 + 0.55);
    B.add(m.rug, place(g, ex, 0.004, ZW - 0.42), { role: 'mat' });
  }

  /* ------------------- skis and poles against the wall ------------------- */
  {
    // two pairs of old touring skis: pine, tips bent up, standing on their tails
    const skis = (x: number, lean: number, red: boolean, seed: number) => {
      for (const dx of [0, 0.075]) {
        const foot = new THREE.Vector3(x + dx, 0.0, ZW - 0.32 - dx * 0.2);
        const top = new THREE.Vector3(x + dx + 0.02, 1.92, ZW - 0.035);
        const dir = top.clone().sub(foot).normalize();
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const p = foot.clone().lerp(top, t);
          // the bent tip at the top curls away from the wall (the running surface faces it)
          if (t > 0.8) p.z -= 0.11 * Math.pow((t - 0.8) / 0.2, 2);
          pts.push(p);
        }
        // running surface toward the wall: the board's broad face is square to the wall normal
        const g = bentBoard(pts, 0.07, 0.02, new THREE.Vector3(0, 0, 1), 24, (u) => (u > 0.9 ? Math.sqrt(Math.max(0.04, 1 - ((u - 0.9) / 0.1) ** 2)) : u < 0.03 ? 0.85 + u * 5 : 1));
        B.add(red ? m.paintedRed : m.darkWood, g, { role: 'skis', cast: true });
        // a leather binding strap round the middle
        const c = foot.clone().lerp(top, 0.47);
        B.add(m.leather, place(new THREE.BoxGeometry(0.085, 0.07, 0.04), c.x, c.y, c.z + 0.002, 0, -Math.atan2(dir.z, dir.y)), { role: 'skis' });
        void seed;
        void lean;
      }
    };
    skis(-2.55, 0.1, false, 1);
    skis(-2.32, 0.12, true, 2);
    // poles: bamboo shafts, leather straps, cane baskets
    for (const [x, z0] of [
      [-2.06, 0.3],
      [-2.0, 0.27],
      [-1.94, 0.33],
      [-1.88, 0.29],
    ] as const) {
      const foot = new THREE.Vector3(x, 0.0, ZW - z0);
      const top = new THREE.Vector3(x - 0.04, 1.42, ZW - 0.03);
      B.add(m.pine, rod(foot, top, 0.009, 6), { role: 'poles', cast: true });
      const bp = foot.clone().lerp(top, 0.09);
      B.add(m.leather, place(new THREE.TorusGeometry(0.055, 0.005, 5, 18), bp.x, bp.y, bp.z, 0, Math.PI / 2 - 0.2), { role: 'poles' });
      for (let s = 0; s < 3; s++) {
        const a = (s / 3) * Math.PI;
        B.add(m.leather, rod(bp.clone().add(new THREE.Vector3(Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055)), bp.clone().add(new THREE.Vector3(-Math.cos(a) * 0.055, 0, -Math.sin(a) * 0.055)), 0.0025, 4), { role: 'poles' });
      }
      const st = foot.clone().lerp(top, 0.94);
      B.add(m.leather, tube([st, st.clone().add(new THREE.Vector3(0.025, -0.07, 0.02)), st.clone().add(new THREE.Vector3(0.0, -0.12, 0.03)), st.clone().add(new THREE.Vector3(-0.02, -0.06, 0.012))], 0.006, 10, 4), { role: 'poles' });
    }
    shadows.add(-2.2, ZW - 0.18, 0.75, 0.36, 0, 0.1, 0.35);
  }

  /* ------------------------ snowshoes on a peg ------------------------ */
  {
    // ash frames bent into a teardrop with a tail, rawhide lacing, hung on a peg
    const peg = new THREE.Vector3(-1.48, 1.86, ZW - 0.02);
    B.add(m.darkWood, rod(new THREE.Vector3(peg.x, peg.y, ZW), new THREE.Vector3(peg.x, peg.y + 0.02, ZW - 0.1), 0.012, 8), { role: 'snowshoes' });
    for (const [dx, dz, tilt] of [
      [-0.03, 0.03, 0.06],
      [0.04, 0.055, -0.08],
    ] as const) {
      const cx = peg.x + dx;
      const top = peg.y - 0.02;
      const len = 1.0;
      const w = 0.3;
      const pts: THREE.Vector3[] = [];
      const N = 40;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        // teardrop: round toe at the top, narrowing to a tail
        const t = (1 - Math.cos(a)) / 2;
        const half = (w / 2) * Math.sin(a) * (t < 0.6 ? 1 : 1 - (t - 0.6) * 1.9);
        pts.push(new THREE.Vector3(cx + half * Math.cos(tilt), top - t * len - half * Math.sin(tilt) * 0.3, ZW - dz));
      }
      B.add(m.pine, tube(pts, 0.012, 64, 6, true), { role: 'snowshoes', cast: true });
      // crossbars and the rawhide web
      for (const t of [0.24, 0.62]) {
        const y = top - t * len;
        const half = (w / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.4) / 0.62) ** 2)) * 0.95;
        B.add(m.pine, rod(new THREE.Vector3(cx - half, y, ZW - dz), new THREE.Vector3(cx + half, y, ZW - dz), 0.008, 5), { role: 'snowshoes' });
      }
      // the rawhide web: a coarse lattice of thongs strung across the frame
      const halfAt = (t: number) => (w / 2) * Math.sin(Math.acos(1 - 2 * t)) * (t < 0.6 ? 1 : 1 - (t - 0.6) * 1.9) * 0.9;
      for (let k = 0; k < 13; k++) {
        const t = 0.08 + k * 0.065;
        const y = top - t * len;
        const h = halfAt(t);
        if (h < 0.02) continue;
        B.add(m.rope, rod(new THREE.Vector3(cx - h, y, ZW - dz - 0.003), new THREE.Vector3(cx + h, y, ZW - dz - 0.003), 0.0025, 3), { role: 'snowshoes' });
      }
      for (const f of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const ts = 0.1;
        const te = f === 0 ? 0.95 : 0.85 - Math.abs(f) * 0.3;
        B.add(m.rope, rod(new THREE.Vector3(cx + f * halfAt(ts + 0.08), top - ts * len, ZW - dz - 0.004), new THREE.Vector3(cx + f * halfAt(te) * 0.9, top - te * len, ZW - dz - 0.004), 0.0025, 3), { role: 'snowshoes' });
      }
      // binding
      B.add(m.leather, place(new THREE.BoxGeometry(0.12, 0.1, 0.012), cx, top - len * 0.42, ZW - dz - 0.012), { role: 'snowshoes' });
    }
  }

  /* --------------------------- boots on a tray --------------------------- */
  {
    const tx = -1.75;
    const tz = ZW - 0.2;
    // a slatted pine tray
    for (let i = 0; i < 6; i++) B.add(m.pine, boxMinMax(tx - 0.42, 0.015, tz - 0.17 + i * 0.065, tx + 0.42, 0.03, tz - 0.17 + i * 0.065 + 0.05, 'x'), { role: 'boots' });
    B.add(m.pine, boxMinMax(tx - 0.42, 0, tz - 0.18, tx - 0.39, 0.015, tz + 0.2, 'z'), { role: 'boots' });
    B.add(m.pine, boxMinMax(tx + 0.39, 0, tz - 0.18, tx + 0.42, 0.015, tz + 0.2, 'z'), { role: 'boots' });
    const boot = (x: number, z: number, rot: number, tall: number, fallen = false) => {
      const g: [THREE.BufferGeometry, THREE.Material][] = [];
      // rubber sole and toe, a felt-lined leather shaft with a fur cuff
      g.push([softBox(0.11, 0.05, 0.29, { r: 0.022, bulge: 0.004, seed: 7 }).translate(0, 0.025, 0.02), m.black]);
      g.push([softBox(0.105, 0.09, 0.2, { r: 0.04, bulge: 0.01, side: 0.006, seed: 8 }).translate(0, 0.09, 0.05), m.leather]);
      g.push([turned([[0.0, 0], [0.055, 0], [0.058, tall * 0.5], [0.062, tall], [0.0, tall]], 14).translate(0, 0.04, -0.05), m.leather]);
      g.push([new THREE.TorusGeometry(0.06, 0.016, 6, 16).rotateX(Math.PI / 2).translate(0, 0.04 + tall, -0.05), m.sheepskin]);
      for (const [geo, mat] of g) {
        if (fallen) {
          geo.translate(0, 0, 0);
          geo.rotateZ(Math.PI / 2 - 0.15);
          geo.translate(0.03, 0.06, 0);
        }
        B.add(mat, place(geo, x, 0.03, z, rot), { role: 'boots', cast: !fallen });
      }
    };
    boot(tx - 0.26, tz + 0.02, 0.1, 0.24);
    boot(tx - 0.12, tz - 0.01, -0.05, 0.24);
    boot(tx + 0.1, tz + 0.03, 0.3, 0.2);
    boot(tx + 0.28, tz - 0.03, 0.55, 0.2);
    shadows.add(tx, tz, 0.84, 0.38, 0, 0.08, 0.4);
  }

  /* --------------- peg rail: a hat, a scarf, mittens, a lantern --------------- */
  {
    const y = 1.62;
    const x0 = ex - 1.25;
    const x1 = ex - 0.62;
    B.add(m.pine, boxMinMax(x0, y - 0.05, ZW - 0.022, x1, y + 0.05, ZW, 'x'), { role: 'pegs', cast: true });
    const pegs = [x0 + 0.08, x0 + 0.24, x0 + 0.4, x0 + 0.56];
    for (const px of pegs) B.add(m.darkWood, rod(new THREE.Vector3(px, y, ZW - 0.02), new THREE.Vector3(px, y + 0.03, ZW - 0.11), 0.011, 8), { role: 'pegs' });
    // a knitted hat with a bobble on the first peg
    {
      const hat = turned([[0.0, 0.0], [0.095, 0.0], [0.1, 0.05], [0.095, 0.11], [0.07, 0.17], [0.035, 0.2], [0.0, 0.205]], 16);
      hat.rotateX(Math.PI / 2 - 0.4);
      B.add(m.plaidRed, place(hat, pegs[0], y - 0.11, ZW - 0.13), { role: 'pegs' });
      B.add(m.woolOat, place(new THREE.SphereGeometry(0.035, 10, 8), pegs[0], y + 0.02, ZW - 0.24), { role: 'pegs' });
    }
    // a long wool scarf hanging over the second peg
    {
      const prof: V2[] = [
        [-0.06, y - 0.62],
        [-0.065, y - 0.3],
        [-0.04, y + 0.0],
        [0.0, y + 0.04],
        [0.04, y + 0.0],
        [0.065, y - 0.25],
        [0.06, y - 0.5],
      ];
      const g = drape(prof, 0.17, { folds: 0.008, freq: 5, thick: 0.01, seed: 81, density: fancy ? 30 : 20 });
      // profile across the peg (z), length along x
      g.rotateY(Math.PI / 2);
      B.add(m.plaidGrey, place(g, pegs[1], 0, ZW - 0.08), { role: 'pegs' });
    }
    // mittens on the third peg, a canvas bag on the fourth
    for (const [dx, rz] of [
      [-0.03, 0.2],
      [0.035, -0.15],
    ] as const) {
      const mit = softBox(0.1, 0.2, 0.035, { r: 0.016, bulge: 0.0, side: 0.01, seed: 83 });
      mit.translate(0, -0.1, 0);
      mit.rotateZ(rz);
      B.add(m.woolOat, place(mit, pegs[2] + dx, y + 0.02, ZW - 0.07), { role: 'pegs' });
    }
    const bag = softBox(0.3, 0.38, 0.1, { r: 0.04, bulge: 0.0, side: 0.03, wrinkle: 0.004, seed: 85 });
    B.add(m.felt, place(bag, pegs[3], y - 0.28, ZW - 0.08), { role: 'pegs', cast: true });
    B.add(m.leather, tube([new THREE.Vector3(pegs[3] - 0.1, y - 0.1, ZW - 0.08), new THREE.Vector3(pegs[3], y + 0.03, ZW - 0.08), new THREE.Vector3(pegs[3] + 0.1, y - 0.1, ZW - 0.08)], 0.008, 12, 5), { role: 'pegs' });
  }

  /* --------------------- bench west of the door --------------------- */
  {
    const bx = ex - 1.0;
    const bz = ZW - 0.2;
    const w = 0.9;
    B.add(m.pine, place(roundedBox(w, 0.04, 0.34, 0.008, 2, 'x'), bx, 0.44, bz), { role: 'bench', cast: true });
    for (const s of [-1, 1]) B.add(m.pine, boxMinMax(bx + s * (w / 2 - 0.06) - 0.02, 0, bz - 0.15, bx + s * (w / 2 - 0.06) + 0.02, 0.42, bz + 0.15, 'y'), { role: 'bench', cast: true });
    B.add(m.pine, boxMinMax(bx - w / 2 + 0.06, 0.12, bz - 0.02, bx + w / 2 - 0.06, 0.16, bz + 0.02, 'x'), { role: 'bench' });
    // a sheepskin on it, felt slippers under it
    const prof: V2[] = [
      [-0.21, 0.4],
      [-0.17, 0.465],
      [0.0, 0.468],
      [0.17, 0.465],
      [0.21, 0.36],
    ];
    const g = drape(prof, 0.62, {
      folds: 0.008,
      freq: 3,
      puff: 0.006,
      thick: 0.012,
      fleece: 0.025,
      seed: 87,
      density: fancy ? 24 : 16,
      shape: (u) => {
        const e = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.4;
        const w2 = 0.4 + 0.1 * e;
        return [-w2, w2];
      },
    });
    B.add(m.sheepskin, place(g, bx + 0.05, 0.0, bz, Math.PI / 2), { role: 'bench' });
    for (const dx of [-0.08, 0.06]) B.add(m.felt, place(softBox(0.1, 0.06, 0.26, { r: 0.025, bulge: 0.006, seed: 89 }), bx + 0.12 + dx, 0.03, bz + 0.02, dx * 2), { role: 'bench' });
    shadows.add(bx, bz, w, 0.34, 0, 0.1, 0.4);
  }
}
