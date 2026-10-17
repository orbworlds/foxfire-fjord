/**
 * Top-down preview of the Foxfire Fjord height model (no browser needed):
 *   npx tsx tools/terrain-preview.ts [zoom|cabin|lake|village] [out.png]
 * Writes a hill-shaded PNG with 20 m contours, paths, pads and viewpoints and
 * prints heights at the key sites, path grades and timing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { heightAt, coastDistance, WORLD_BOUNDS, slopeAt, lakeSd, beachFactor } from '../src/world/terrain-height';
import { PATHS, SITES, HOUSE, LAKE, SPRING, VILLAGE, BEACH, FOX_PEAK, SAUNA, ICE_HUT, VIEWPOINTS, SKERRIES, VILLAGE_TERRACES } from '../src/world/layout';
import { samplePath } from '../src/world/paths';

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
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
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

const args = process.argv.slice(2);
const mode = args[0] && !args[0].endsWith('.png') ? args[0] : 'full';
const outArg = args.find((a) => a.endsWith('.png'));
const VIEWS: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  full: WORLD_BOUNDS,
  zoom: { minX: -1000, maxX: 900, minZ: -900, maxZ: 950 },
  north: { minX: -1900, maxX: 1900, minZ: -2700, maxZ: -500 },
  cabin: { minX: -120, maxX: 120, minZ: -200, maxZ: 80 },
  lake: { minX: 180, maxX: 700, minZ: -120, maxZ: 300 },
  village: { minX: -1100, maxX: -650, minZ: -320, maxZ: 60 },
  spring: { minX: -520, maxX: -260, minZ: -200, maxZ: 60 },
  summit: { minX: 450, maxX: 850, minZ: 550, maxZ: 950 },
  south: { minX: -1000, maxX: 1000, minZ: -300, maxZ: 1300 },
  beach: { minX: -1650, maxX: -1250, minZ: -100, maxZ: 300 },
};
const B = VIEWS[mode] ?? WORLD_BOUNDS;
const W = mode === 'full' ? 900 : 1000;
const H = Math.round((W * (B.maxZ - B.minZ)) / (B.maxX - B.minX));
const mpp = (B.maxX - B.minX) / W;
const contour = mpp > 3 ? 20 : mpp > 0.8 ? 5 : 1;
const img = new Uint8Array(W * H * 3);
const t0 = performance.now();
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const x = B.minX + ((B.maxX - B.minX) * (i + 0.5)) / W;
    const z = B.minZ + ((B.maxZ - B.minZ) * (j + 0.5)) / H;
    const h = heightAt(x, z);
    const e = Math.max(0.5, mpp);
    const hx = heightAt(x + e, z);
    const hz = heightAt(x, z + e);
    const gx = (hx - h) / e;
    const gz = (hz - h) / e;
    const slope = Math.hypot(gx, gz);
    // light from the north-west
    const shade = Math.max(0.3, Math.min(1.35, 0.95 + (gx * 0.7 + gz * 0.7) * 0.9));
    let r: number, g: number, b: number;
    if (h < 0) {
      const d = Math.min(1, -h / 60);
      r = 30 + 40 * (1 - d);
      g = 60 + 60 * (1 - d);
      b = 110 + 60 * (1 - d);
    } else if (lakeSd(x, z) < 0 && h < LAKE.y + 0.05) {
      r = 40;
      g = 70;
      b = 90;
    } else {
      const bf = beachFactor(x, z);
      if (bf > 0.3 && h < 3.5) {
        r = 45;
        g = 42;
        b = 40;
      } else if (slope > 1.0) {
        r = 85;
        g = 85;
        b = 90;
      } else {
        const t = Math.min(1, h / 900);
        r = 225 + 25 * t;
        g = 232 + 18 * t;
        b = 240 + 10 * t;
        if (h < 180 && slope < 0.5) {
          r -= 30;
          g -= 15;
        }
      }
    }
    if (h > 0 && Math.abs((((h % contour) + contour) % contour) - contour / 2) > contour / 2 - (mpp > 3 ? 1.3 : 0.12 * contour)) {
      r *= 0.75;
      g *= 0.75;
      b *= 0.75;
    }
    if (h > 0 && Math.abs((((h % 100) + 100) % 100) - 50) > 50 - (mpp > 3 ? 2 : 0.5)) {
      r *= 0.55;
      g *= 0.55;
      b *= 0.6;
    }
    const k = (j * W + i) * 3;
    img[k] = Math.min(255, r * shade);
    img[k + 1] = Math.min(255, g * shade);
    img[k + 2] = Math.min(255, b * shade);
  }
}
const t1 = performance.now();
const put = (x: number, z: number, c: [number, number, number], s = 1) => {
  const i = Math.round(((x - B.minX) / (B.maxX - B.minX)) * W);
  const j = Math.round(((z - B.minZ) / (B.maxZ - B.minZ)) * H);
  for (let a = -s; a <= s; a++)
    for (let b2 = -s; b2 <= s; b2++) {
      const ii = i + a;
      const jj = j + b2;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const k = (jj * W + ii) * 3;
      img[k] = c[0];
      img[k + 1] = c[1];
      img[k + 2] = c[2];
    }
};
const COL: Record<string, [number, number, number]> = { packed: [255, 200, 60], plowed: [255, 90, 40], trail: [220, 40, 220], boardwalk: [140, 90, 40] };
for (const p of PATHS) for (const s of samplePath(p, mpp)) put(s.x, s.z, COL[p.kind], 0);
const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, c: [number, number, number]) => {
  for (let x = b.minX; x <= b.maxX; x += mpp) {
    put(x, b.minZ, c, 0);
    put(x, b.maxZ, c, 0);
  }
  for (let z = b.minZ; z <= b.maxZ; z += mpp) {
    put(b.minX, z, c, 0);
    put(b.maxX, z, c, 0);
  }
};
for (const s of Object.values(SITES)) box(s, [255, 60, 60]);
for (const s of VILLAGE_TERRACES) box(s, [200, 60, 60]);
const local = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => ({ minX: HOUSE.x + b.minX, maxX: HOUSE.x + b.maxX, minZ: HOUSE.z + b.minZ, maxZ: HOUSE.z + b.maxZ });
box(local(HOUSE.cabin), [0, 0, 0]);
box(local(HOUSE.wing), [0, 140, 255]);
box(local(HOUSE.deck), [120, 70, 20]);
put(SPRING.x, SPRING.z, [255, 0, 255], 2);
put(FOX_PEAK.x, FOX_PEAK.z, [255, 0, 0], 3);
put(VILLAGE.center.x, VILLAGE.center.z, [0, 0, 0], 3);
put(VILLAGE.harbor.x, VILLAGE.harbor.z, [0, 0, 255], 3);
put(BEACH.center.x, BEACH.center.z, [0, 0, 0], 3);
put(SAUNA.x, SAUNA.z, [160, 60, 20], 2);
put(ICE_HUT.x, ICE_HUT.z, [200, 30, 30], 2);
for (const v of VIEWPOINTS) {
  put(v.pos[0], v.pos[2], [0, 255, 255], 2);
  // view direction tick
  const dx = v.target[0] - v.pos[0];
  const dz = v.target[2] - v.pos[2];
  const l = Math.hypot(dx, dz) || 1;
  for (let s = 0; s < 40 * mpp; s += mpp) put(v.pos[0] + (dx / l) * s, v.pos[2] + (dz / l) * s, [0, 200, 200], 0);
}
mkdirSync('out', { recursive: true });
const out = outArg ?? `out/terrain-${mode}.png`;
writeFileSync(out, png(W, H, img));
console.log('wrote', out, W, H, 'us per sample:', (((t1 - t0) / (W * H * 3)) * 1000).toFixed(2));

const q = (name: string, x: number, z: number) =>
  console.log(name.padEnd(14), `h=${heightAt(x, z).toFixed(2)}`.padEnd(10), `coastD=${coastDistance(x, z).toFixed(0)}`.padEnd(12), `slope=${slopeAt(x, z, 2).toFixed(3)}`);
q('cabin', HOUSE.x, HOUSE.z);
q('deck N edge', -3, -9);
q('knoll N 40', 0, -50);
q('knoll N 90', 0, -100);
q('fjord S shore', 0, -165);
q('fjord mid', 0, -420);
q('lake', LAKE.x, LAKE.z);
q('lake lip', LAKE.x, -20);
q('sauna', SAUNA.x, SAUNA.z);
q('spring', SPRING.x, SPRING.z);
q('village', VILLAGE.center.x, VILLAGE.center.z);
q('quay', -870, -164);
q('harbor', VILLAGE.harbor.x, VILLAGE.harbor.z);
q('beach', BEACH.center.x, BEACH.center.z);
q('fox peak', FOX_PEAK.x, FOX_PEAK.z);
let best = { h: -1, x: 0, z: 0 };
for (let x = -1800; x <= 1800; x += 10) for (let z = -2500; z <= -1000; z += 10) {
  const h = heightAt(x, z);
  if (h > best.h) best = { h, x, z };
}
console.log('teeth max', best.h.toFixed(0), 'at', best.x, best.z);
for (const p of PATHS) {
  const s = samplePath(p, 2);
  let up = 0;
  let down = 0;
  let maxG = 0;
  const grades: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const dh = heightAt(s[i].x, s[i].z) - heightAt(s[i - 1].x, s[i - 1].z);
    const dl = s[i].s - s[i - 1].s;
    if (dh > 0) up += dh;
    else down -= dh;
    const g = Math.abs(dh) / dl;
    grades.push(g);
    maxG = Math.max(maxG, g);
  }
  grades.sort((a, b) => a - b);
  console.log(
    'path',
    p.id.padEnd(10),
    `len=${s[s.length - 1].s.toFixed(0)}m up=${up.toFixed(0)} down=${down.toFixed(0)} p95=${(grades[Math.floor(grades.length * 0.95)] * 100).toFixed(0)}% max=${(maxG * 100).toFixed(0)}%`,
    `start=${heightAt(s[0].x, s[0].z).toFixed(1)} end=${heightAt(s[s.length - 1].x, s[s.length - 1].z).toFixed(1)}`,
  );
}
for (const v of VIEWPOINTS) {
  const g = heightAt(v.pos[0], v.pos[2]);
  const y = v.terrainRelative ? g + v.pos[1] : v.pos[1];
  console.log('vp', v.id.padEnd(10), 'eye', y.toFixed(1), 'ground', g.toFixed(1));
}
for (const s of SKERRIES) console.log('skerry', s.x, s.z, heightAt(s.x, s.z).toFixed(1));
