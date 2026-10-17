/**
 * Quick CPU perspective render of the height model, to judge silhouettes and
 * compositions without a browser:
 *   npx tsx tools/terrain-pano.ts <view>... [--fov 55] [--w 960] [--grid 4]
 * A view is a viewpoint id or x,y,z,tx,ty,tz (terrain-relative when prefixed
 * with ~). Bakes heightAt once on a grid, ray-marches every view, shades
 * snow / rock / water / ice with a low southern sun and writes
 * shots/land/pano-<view>.png. Not the real shader: shapes only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { heightAt, WORLD_BOUNDS, lakeSd } from '../src/world/terrain-height';
import { VIEWPOINTS, LAKE } from '../src/world/layout';

function crc32(buf: Uint8Array) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w: number, h: number, rgb: Uint8Array) {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

const argv = process.argv.slice(2);
const opt = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const views: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) i++;
  else views.push(argv[i]);
}
if (!views.length) views.push('overview');
const fov = opt('fov', 55);
const W = opt('w', 960);
const H = Math.round((W * 9) / 16);
const dir = process.env.OUT_DIR ?? 'out/shots';
mkdirSync(dir, { recursive: true });

// bake a grid
const S = opt('grid', 4);
const B = WORLD_BOUNDS;
const NX = Math.floor((B.maxX - B.minX) / S) + 1;
const NZ = Math.floor((B.maxZ - B.minZ) / S) + 1;
const G = new Float32Array(NX * NZ);
const t0 = performance.now();
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) G[j * NX + i] = heightAt(B.minX + i * S, B.minZ + j * S);
const t1 = performance.now();
console.log('grid bake', ((t1 - t0) / 1000).toFixed(1), 's,', (((t1 - t0) / (NX * NZ)) * 1000).toFixed(2), 'us/sample');
const hAt = (x: number, z: number) => {
  const fx = (x - B.minX) / S;
  const fz = (z - B.minZ) / S;
  if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return -90;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const k = j * NX + i;
  return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + NX] * (1 - u) + G[k + NX + 1] * u) * v;
};

const norm = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

for (const view of views) {
  let pos: number[];
  let tgt: number[];
  const vp = VIEWPOINTS.find((v) => v.id === view);
  if (vp) {
    pos = [...vp.pos];
    tgt = [...vp.target];
    if (vp.terrainRelative) {
      pos[1] += heightAt(pos[0], pos[2]);
      if (!vp.targetAbsolute) tgt[1] += heightAt(tgt[0], tgt[2]);
    }
  } else {
    const rel = view.startsWith('~');
    const v = view.replace('~', '').split(',').map(Number);
    pos = v.slice(0, 3);
    tgt = v.slice(3, 6);
    if (rel) {
      pos[1] += heightAt(pos[0], pos[2]);
      tgt[1] += heightAt(tgt[0], tgt[2]);
    }
  }
  const out = `${dir}/pano-${view.replace(/[^a-z0-9]/gi, '_')}.png`;
  const f = norm([tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]]);
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const tanH = Math.tan(((fov / 2) * Math.PI) / 180);
  // low sun in the south-south-west
  const sun = norm([-0.35, 0.2, 0.92]);
  const img = new Uint8Array(W * H * 3);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const sx = ((px + 0.5) / W - 0.5) * 2 * tanH * (W / H);
      const sy = (0.5 - (py + 0.5) / H) * 2 * tanH;
      const d = norm([f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy]);
      let t = 0.5;
      let hit = false;
      let prevT = t;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let s = 0; s < 900 && t < 12000; s++) {
        x = pos[0] + d[0] * t;
        y = pos[1] + d[1] * t;
        z = pos[2] + d[2] * t;
        const h = Math.max(hAt(x, z), 0);
        if (y < h) {
          let a = prevT;
          let b = t;
          for (let k = 0; k < 10; k++) {
            const m = (a + b) / 2;
            const yy = pos[1] + d[1] * m;
            if (yy < Math.max(hAt(pos[0] + d[0] * m, pos[2] + d[2] * m), 0)) b = m;
            else a = m;
          }
          t = b;
          x = pos[0] + d[0] * t;
          y = pos[1] + d[1] * t;
          z = pos[2] + d[2] * t;
          hit = true;
          break;
        }
        prevT = t;
        t += Math.max(0.3, (y - h) * 0.4, t * 0.0015);
      }
      let col: number[];
      if (!hit) {
        const e = Math.max(0, d[1]);
        col = [0.55 - 0.35 * e, 0.66 - 0.3 * e, 0.85 - 0.15 * e];
      } else {
        const th = hAt(x, z);
        const e = Math.max(1, S * 0.5);
        const nx = hAt(x - e, z) - hAt(x + e, z);
        const nz = hAt(x, z - e) - hAt(x, z + e);
        const n = norm([nx, 2 * e, nz]);
        const slope = Math.hypot(n[0], n[2]) / n[1];
        // terrain self-shadow toward the sun (coarse march)
        let lit = 1;
        if (th > 0.05) {
          for (let k = 1; k < 48; k++) {
            const tt = k * k * 2.5;
            const qx = x + sun[0] * tt;
            const qy = th + 0.5 + sun[1] * tt;
            const qz = z + sun[2] * tt;
            if (qy > 1000) break;
            if (hAt(qx, qz) > qy) {
              lit = 0;
              break;
            }
          }
        }
        const lam = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) * lit;
        let alb: number[];
        const rockT = Math.min(1, Math.max(0, (slope - 0.95 + (hash(Math.floor(x / 6), Math.floor(z / 6)) - 0.5) * 0.35) / 0.2));
        if (th <= 0.05) alb = [0.03, 0.05, 0.07];
        else if (lakeSd(x, z) < 0 && th < LAKE.y + 0.05) alb = [0.06, 0.1, 0.13];
        else alb = [0.88 - 0.76 * rockT, 0.9 - 0.77 * rockT, 0.93 - 0.79 * rockT];
        const amb = [0.3, 0.38, 0.55];
        col = [0, 1, 2].map((i) => alb[i] * (lam * [1.15, 1.0, 0.85][i] + amb[i] * (0.5 + 0.5 * n[1])));
        const fog = 1 - Math.exp(-t / 6500);
        col = col.map((c, i) => c * (1 - fog) + [0.6, 0.68, 0.82][i] * fog);
      }
      const k = (py * W + px) * 3;
      for (let i = 0; i < 3; i++) img[k + i] = Math.max(0, Math.min(255, Math.pow(col[i], 1 / 2.2) * 255));
    }
  }
  writeFileSync(out, png(W, H, img));
  console.log('wrote', out, 'eye', pos.map((v) => v.toFixed(0)).join(','));
}
