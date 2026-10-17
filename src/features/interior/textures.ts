/**
 * Painted textures for the cabin's furnishings, each a small canvas drawn
 * once: a rag rug of torn-cloth weft in faded bands, a wool plaid for the
 * throws, a reindeer hide (dark saddle, grey-brown flanks, pale belly
 * fringe), fire bricks for the stove's firebox, book spines (cloth colours
 * and blind-stamped bands, no lettering), a duvet's faint check and the
 * fleece of a sheepskin rug's outline. All return 8-bit sRGB canvases.
 */
import { mulberry32 } from '../../world/noise';
import { PeriodicFbm } from '../../core/textures';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Rag rug: warp threads along u (the rug's length runs along v), weft of
 * torn cloth strips packed across, in bands of faded colours. Tiles along v
 * every `repeat` of the palette. Alpha 0 outside the woven area makes a
 * fringe at both v ends when `fringe` is set (for a whole-rug UV 0..1).
 */
export function ragRugCanvas(size = 512, seed = 17): HTMLCanvasElement {
  const W = size;
  const H = size;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  const rnd = mulberry32(seed);
  // faded cloth colours: indigo, rust, oat, slate, madder, moss, cream, denim
  const pal = ['#3c4c6e', '#9a4a32', '#cdbf9f', '#5d636b', '#a8443f', '#6c7350', '#e3dccb', '#56708f', '#b98a4c', '#343b48'].map(hex);
  // bands down the rug: each a few weft rows of one colour mix
  const rows = 96; // weft rows per tile (each a torn strip ~1 cm)
  const rowCol: { a: RGB; b: RGB; mix: number }[] = [];
  let r = 0;
  while (r < rows) {
    const len = 2 + Math.floor(rnd() * 9);
    const a = pal[Math.floor(rnd() * pal.length)];
    const b = rnd() < 0.5 ? a : pal[Math.floor(rnd() * pal.length)];
    const mix = rnd();
    for (let k = 0; k < len && r < rows; k++, r++) rowCol.push({ a, b, mix });
  }
  // symmetric-ish: mirror the second half so the rug reads as designed
  for (let i = rows / 2; i < rows; i++) rowCol[i] = rowCol[rows - 1 - i];
  const fbm = new PeriodicFbm(8, 8, 3, seed + 3);
  const warps = 64;
  for (let y = 0; y < H; y++) {
    const fr = (y / H) * rows;
    const row = Math.floor(fr);
    const inRow = fr - row;
    const rc = rowCol[row % rows];
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = fbm.sample(x / W, y / H);
      // the strip twists: lumps along it, a darker gap between strips
      const lump = 0.5 + 0.5 * Math.sin((x / W) * warps * Math.PI * 2 + row * 1.7 + n * 3);
      const gap = Math.pow(Math.sin(inRow * Math.PI), 0.5);
      const pick = (Math.sin(x * 0.37 + row * 3.1) * 0.5 + 0.5 + n) * 0.5 < rc.mix ? rc.a : rc.b;
      const shade = (0.62 + 0.38 * gap) * (0.82 + 0.18 * lump) * (0.9 + n * 0.25);
      // warp threads peek between the strips
      const warp = (x % (W / warps)) < 1.6 && inRow < 0.2 ? 1 : 0;
      d[k] = clamp(warp ? 205 : pick[0] * shade);
      d[k + 1] = clamp(warp ? 196 : pick[1] * shade);
      d[k + 2] = clamp(warp ? 176 : pick[2] * shade);
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Wool plaid (tartan-like, in the cabin's colours): `ground`, stripes of `a` and `b`, a thin `line`. */
export function plaidCanvas(size: number, ground: string, a: string, b: string, line: string, seed = 23): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const G = hex(ground);
  const A = hex(a);
  const B = hex(b);
  const Ln = hex(line);
  // one sett across the tile: [colour, width share]
  const sett: [RGB, number][] = [
    [A, 0.22],
    [G, 0.1],
    [B, 0.05],
    [G, 0.1],
    [Ln, 0.015],
    [G, 0.27],
    [B, 0.05],
    [G, 0.185],
  ];
  const lut: RGB[] = [];
  for (let i = 0; i < size; i++) {
    let t = i / size;
    let col = G;
    for (const [cc, w] of sett) {
      if (t < w) {
        col = cc;
        break;
      }
      t -= w;
    }
    lut.push(col);
  }
  const rnd = mulberry32(seed);
  const fbm = new PeriodicFbm(16, 16, 2, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      // twill: warp shows on one diagonal, weft on the other
      const tw = ((x + y) >> 1) % 2 === 0;
      const cw = lut[x];
      const cf = lut[y];
      const n = 0.92 + 0.12 * fbm.sample(x / size, y / size) + (rnd() - 0.5) * 0.06;
      const m: RGB = tw ? [cw[0] * 0.7 + cf[0] * 0.3, cw[1] * 0.7 + cf[1] * 0.3, cw[2] * 0.7 + cf[2] * 0.3] : [cf[0] * 0.7 + cw[0] * 0.3, cf[1] * 0.7 + cw[1] * 0.3, cf[2] * 0.7 + cw[2] * 0.3];
      d[k] = clamp(m[0] * n);
      d[k + 1] = clamp(m[1] * n);
      d[k + 2] = clamp(m[2] * n);
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Reindeer hide, painted in the hide's own 0..1 UV space (head toward v = 0). */
export function hideCanvas(w = 512, h = 512, seed = 29): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const fbm = new PeriodicFbm(6, 6, 4, seed);
  const fine = new PeriodicFbm(48, 48, 2, seed + 1);
  const rnd = mulberry32(seed);
  const saddle = hex('#1a120d');
  const flank = hex('#7a6855');
  const pale = hex('#ece6da');
  const grey = hex('#b3a898');
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const k = (y * w + x) * 4;
      const n = fbm.sample(u, v);
      const f = fine.sample(u * 1.0, v * 0.6);
      // distance from the spine (u = .5) and the outer edge
      const across = Math.abs(u - 0.5) * 2 + n * 0.18;
      const neck = v < 0.22 ? 1 - v / 0.22 : 0;
      // dark saddle down the back, widening over the shoulders; pale belly fringe at the sides
      const darkK = 1 - smooth(0.14 + 0.12 * (1 - neck), 0.42, across);
      const paleK = smooth(0.62, 0.86, across + (v > 0.85 ? (v - 0.85) * 2 : 0));
      const greyK = neck * 0.7;
      let r = flank[0];
      let gg = flank[1];
      let b = flank[2];
      r = r + (saddle[0] - r) * darkK;
      gg = gg + (saddle[1] - gg) * darkK;
      b = b + (saddle[2] - b) * darkK;
      r = r + (grey[0] - r) * greyK;
      gg = gg + (grey[1] - gg) * greyK;
      b = b + (grey[2] - b) * greyK;
      r = r + (pale[0] - r) * paleK;
      gg = gg + (pale[1] - gg) * paleK;
      b = b + (pale[2] - b) * paleK;
      // hair: fine streaks along the lie of the coat (backward and outward from the spine)
      const streak = 0.9 + 0.16 * f + (rnd() - 0.5) * 0.14;
      d[k] = clamp(r * streak);
      d[k + 1] = clamp(gg * streak);
      d[k + 2] = clamp(b * streak);
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Fire bricks: buff-to-rust bricks in a running bond, sooty mortar (tile = 2 x 4 bricks). */
export function fireBrickCanvas(size = 256, seed = 37): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const rnd = mulberry32(seed);
  const rows = 4;
  const cols = 2;
  const bh = size / rows;
  const bw = size / cols;
  // a tone and a scorch per brick (index by row and column, with the running-bond offset)
  const tone: number[] = [];
  const scorch: number[] = [];
  for (let i = 0; i < rows * (cols + 1); i++) {
    tone.push(rnd());
    scorch.push(0.25 + rnd() * 0.35);
  }
  const fbm = new PeriodicFbm(8, 8, 3, seed);
  const mortar = Math.max(1.5, size / 128);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / bh);
    const fy = y - r * bh;
    const off = r % 2 ? bw / 2 : 0;
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      const xx = (x + off) % size;
      const col = Math.floor(xx / bw);
      const fx = xx - col * bw;
      const n = 0.75 + 0.5 * fbm.sample(x / size, y / size);
      const inBrick = fx > mortar && fx < bw - mortar && fy > mortar && fy < bh - mortar;
      if (!inBrick) {
        d[k] = 42 * n;
        d[k + 1] = 33 * n;
        d[k + 2] = 28 * n;
      } else {
        const i = r * (cols + 1) + col;
        const t = tone[i];
        // scorched toward the top of each brick
        const sc = 1 - scorch[i] * (1 - fy / bh);
        d[k] = clamp((150 + t * 50) * sc * n);
        d[k + 1] = clamp((98 + t * 30) * sc * n);
        d[k + 2] = clamp((62 + t * 18) * sc * n);
      }
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Book spines: an atlas of `n` cloth / leather / paper spines (u across the
 * atlas, one column each), with blind-stamped or gilt bands and panels but
 * never lettering. The bottom 1/8 of every column is the page edge (cream).
 */
export function spineAtlasCanvas(n = 24, seed = 41): HTMLCanvasElement {
  const colW = 24;
  const H = 256;
  const [c, g] = canvas(colW * n, H);
  const rnd = mulberry32(seed);
  const cloths = ['#6b2a24', '#2d3e52', '#3d4a35', '#7a5a2e', '#2b2b2e', '#8a7b62', '#5a2f3e', '#3f5d63', '#a1532f', '#c9b994', '#4a3a2a', '#7b8a8f', '#2e4a3b', '#9c8a4f', '#5e4b6b', '#d6cdb6'];
  const pageY = H * (7 / 8);
  for (let i = 0; i < n; i++) {
    const x0 = i * colW;
    const base = cloths[Math.floor(rnd() * cloths.length)];
    g.fillStyle = base;
    g.fillRect(x0, 0, colW, pageY);
    // cloth grain and wear at the head and tail
    const wear = g.createLinearGradient(0, 0, 0, pageY);
    wear.addColorStop(0, 'rgba(255,240,210,0.18)');
    wear.addColorStop(0.08, 'rgba(255,240,210,0)');
    wear.addColorStop(0.92, 'rgba(0,0,0,0)');
    wear.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = wear;
    g.fillRect(x0, 0, colW, pageY);
    // rounded spine: darker at the edges
    const round = g.createLinearGradient(x0, 0, x0 + colW, 0);
    round.addColorStop(0, 'rgba(0,0,0,0.35)');
    round.addColorStop(0.3, 'rgba(0,0,0,0)');
    round.addColorStop(0.6, 'rgba(255,255,255,0.06)');
    round.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = round;
    g.fillRect(x0, 0, colW, pageY);
    // bands: gilt or blind lines, a label panel (blank) on some
    const style = rnd();
    const gilt = rnd() < 0.45;
    const lineCol = gilt ? 'rgba(214,176,96,0.85)' : 'rgba(0,0,0,0.35)';
    g.fillStyle = lineCol;
    if (style < 0.4) {
      for (const yy of [0.08, 0.1, 0.86, 0.88]) g.fillRect(x0 + 2, yy * pageY, colW - 4, 1.5);
    } else if (style < 0.7) {
      for (let b = 0; b < 4; b++) g.fillRect(x0 + 1, (0.12 + b * 0.22) * pageY, colW - 2, 3);
    } else {
      g.fillStyle = rnd() < 0.5 ? 'rgba(230,220,195,0.85)' : 'rgba(30,24,20,0.6)';
      g.fillRect(x0 + 4, 0.18 * pageY, colW - 8, 0.16 * pageY);
      g.fillStyle = lineCol;
      g.fillRect(x0 + 2, 0.9 * pageY, colW - 4, 1.5);
    }
    // page edge
    g.fillStyle = rnd() < 0.3 ? '#cfc2a2' : '#e4dac1';
    g.fillRect(x0, pageY, colW, H - pageY);
    g.fillStyle = 'rgba(120,100,70,0.25)';
    for (let k = 0; k < 6; k++) g.fillRect(x0, pageY + 2 + k * 5, colW, 1);
  }
  return c;
}

/** A soft white linen with a faint woven check, for the duvet covers. */
export function duvetCanvas(size = 256, base = '#ece7dc', line = '#c9c2b4', seed = 47): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const B = hex(base);
  const Lc = hex(line);
  const fbm = new PeriodicFbm(16, 16, 2, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      const lx = x % 64 < 3 ? 1 : 0;
      const ly = y % 64 < 3 ? 1 : 0;
      const m = Math.max(lx, ly) * 0.55;
      const n = 0.95 + 0.08 * fbm.sample(x / size, y / size) + ((x ^ y) & 1 ? 0.015 : -0.015);
      d[k] = clamp((B[0] + (Lc[0] - B[0]) * m) * n);
      d[k + 1] = clamp((B[1] + (Lc[1] - B[1]) * m) * n);
      d[k + 2] = clamp((B[2] + (Lc[2] - B[2]) * m) * n);
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
