/**
 * The flora atlas: one RGBA texture holding every foliage card of the boreal
 * forest (Norway spruce boughs, their hanging branchlet curtains and spire
 * tops, bare mountain-birch twig sprays, rowan berry clusters, beard lichen,
 * dwarf birch and juniper, lyme grass and the dried herbs that stand above the
 * snow) and, in a band along the bottom, eight tileable bark swatches.
 *
 * A second, single-channel texture with the same layout holds the snow that
 * lies on the cards: soft pillows along the top of every spruce bough, caps on
 * the spire whorls, berries and umbels, crumbs in the birch forks. The plant
 * shader lays it over the needles where the card faces the sky (material.ts),
 * and the impostor bake does the same, so the far forest carries its snow too.
 *
 * Bark UVs use v >= BARK_FLAG; the shader wraps fract(v) into the bark band
 * with textureGrad, so trunks tile vertically without seams.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../world/noise';
import { PeriodicFbm } from '../../core/textures';

export const BARK_FLAG = 10;

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const REF = 2048;

/** Region layout at the 2048 px reference size (canvas coordinates, y down). */
const LAYOUT = {
  /** spruce bough seen from above: base at the bottom, tip at the top */
  spruceBough: { x: 0, y: 0, w: 512, h: 1024 },
  /** a shorter, rounder upper-crown bough */
  spruceBough2: { x: 512, y: 0, w: 512, h: 1024 },
  /** branchlets hanging from a bough: attachment line along the top */
  spruceCurtain: { x: 1024, y: 0, w: 512, h: 512 },
  /** side view of a spruce spire (leader and the top whorls) */
  spruceTip: { x: 1024, y: 512, w: 256, h: 512 },
  juniper: { x: 1280, y: 512, w: 256, h: 256 },
  dwarfBirch: { x: 1280, y: 768, w: 256, h: 256 },
  /** bare mountain-birch twig fan: base at the bottom centre */
  birchTwigs: { x: 1536, y: 0, w: 512, h: 512 },
  /** weeping twig spray: base at the top centre, twigs hanging */
  birchWeep: { x: 1536, y: 512, w: 512, h: 512 },
  /** rowan berry cluster hanging from the top centre */
  rowanBerries: { x: 1024, y: 1024, w: 256, h: 256 },
  /** beard lichen strands hanging from the top */
  lichen: { x: 1280, y: 1024, w: 256, h: 256 },
  /** lyme grass tussock (winter straw), bottom anchored */
  lyme: { x: 1536, y: 1024, w: 512, h: 512 },
  /** dried fireweed / angelica / yarrow stalks, bottom anchored */
  stalks: { x: 0, y: 1024, w: 512, h: 768 },
  /** a sparse upright twig spray (young birch, rowan) */
  rowanTwigs: { x: 512, y: 1024, w: 512, h: 512 },
  /** a birch spray furred white with hoar frost (the steam of the hot spring) */
  rimeTwigs: { x: 1024, y: 1280, w: 512, h: 512 },
} satisfies Record<string, PxRect>;

export type Region = keyof typeof LAYOUT;

export const BARK = ['spruce', 'birch', 'birchDark', 'rowan', 'juniper', 'twig', 'deadwood', 'stalk'] as const;
export type BarkKind = (typeof BARK)[number];
const BARK_Y = 1792;
const BARK_TILE = 256;

export interface FloraAtlas {
  /** build timings (ms) */
  ms: Record<string, number>;
  texture: THREE.DataTexture;
  /** snow lying on the cards (R, same layout as `texture`) */
  snow: THREE.DataTexture;
  size: number;
  rect(name: Region, inset?: number): UVRect;
  /** atlas u range of a bark swatch */
  bark(kind: BarkKind): [number, number];
  /** band in v the shader wraps bark into: v = v0 + fract(raw) * vh */
  barkBand: { v0: number; vh: number };
}

type RGB = [number, number, number];
type Rnd = () => number;

const hexCache = new Map<string, RGB>();
function hex(h: string): RGB {
  let c = hexCache.get(h);
  if (!c) {
    const v = parseInt(h.slice(1), 16);
    c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    hexCache.set(h, c);
  }
  return c;
}

function css(c: RGB, k = 1): string {
  return `rgb(${Math.max(0, Math.min(255, c[0] * k)) | 0},${Math.max(0, Math.min(255, c[1] * k)) | 0},${Math.max(0, Math.min(255, c[2] * k)) | 0})`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function pick<T>(rnd: Rnd, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

/** Colour and snow canvases, both clipped to the region being painted. */
interface Paint {
  c: CanvasRenderingContext2D;
  s: CanvasRenderingContext2D;
}

/**
 * Strokes sorted into shade buckets and stroked once per bucket (dark first):
 * thousands of needles cost a handful of draw calls, and the lighter, younger
 * growth ends up on top.
 */
class Strokes {
  private paths: Path2D[];
  constructor(
    private cols: RGB[],
    private width: number,
  ) {
    this.paths = cols.map(() => new Path2D());
  }
  line(shade: number, x0: number, y0: number, x1: number, y1: number): void {
    const i = Math.max(0, Math.min(this.cols.length - 1, Math.floor(shade * this.cols.length)));
    const p = this.paths[i];
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
  }
  flush(ctx: CanvasRenderingContext2D, alpha = 1): void {
    ctx.save();
    // butt caps: thousands of round caps cost more than the needles themselves
    ctx.lineCap = 'butt';
    ctx.lineWidth = this.width;
    ctx.globalAlpha = alpha;
    this.cols.forEach((c, i) => {
      ctx.strokeStyle = css(c);
      ctx.stroke(this.paths[i]);
    });
    ctx.restore();
  }
}

/** Points of a quadratic curve. */
function quad(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  return out;
}

function polyline(ctx: CanvasRenderingContext2D, pts: [number, number][], w0: number, w1: number, col: RGB): void {
  ctx.strokeStyle = css(col);
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = w0 + (w1 - w0) * (i / Math.max(1, pts.length - 2));
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

/**
 * Needles along a twig: short strokes splayed to both sides, pointing forward
 * along the twig; `shade(t)` 0 dark … 1 light picks the bucket.
 */
function needles(st: Strokes, rnd: Rnd, pts: [number, number][], k: number, len: number, spacing: number, splay: number, shade: (t: number) => number, skip = 0): void {
  let acc = 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    const a = Math.atan2(y1 - y0, x1 - x0);
    while (acc < seg) {
      const f = acc / Math.max(1e-3, seg);
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f;
      const t = (run + acc) / Math.max(1e-3, total);
      if (t >= skip) {
        for (const side of [-1, 1]) {
          const na = a + side * (splay + (rnd() - 0.5) * 0.5);
          const L = len * k * (0.75 + 0.5 * rnd()) * (1 - 0.35 * t * t);
          st.line(Math.min(0.999, Math.max(0, shade(t) + (rnd() - 0.5) * 0.35)), x, y, x + Math.cos(na) * L, y + Math.sin(na) * L);
        }
      }
      acc += spacing * k * (0.7 + 0.6 * rnd());
    }
    acc -= seg;
    run += seg;
  }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
  ctx.fill();
}

/** Lumpy snow blob: a few overlapping ellipses (snow canvas only). */
function snowLump(s: CanvasRenderingContext2D, rnd: Rnd, x: number, y: number, rx: number, ry: number, rot: number, value = 1): void {
  const v = Math.round(255 * value);
  s.fillStyle = `rgb(${v},${v},${v})`;
  ellipse(s, x, y, rx, ry, rot);
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    ellipse(s, x + Math.cos(a) * rx * 0.55, y + Math.sin(a) * ry * 0.55, rx * (0.45 + rnd() * 0.3), ry * (0.45 + rnd() * 0.3), rot + (rnd() - 0.5));
  }
}

/* ------------------------------------------------------------------ */
/* Norway spruce                                                       */
/* ------------------------------------------------------------------ */

const NEEDLE: RGB[] = [hex('#121c15'), hex('#17241b'), hex('#1c2c21'), hex('#223428'), hex('#2a3e2f'), hex('#334a37'), hex('#3f583f')];
const SPRUCE_TWIG = hex('#4a3a2c');
const SPRUCE_TWIG_OLD = hex('#33291f');
const NEEDLE_BASE = hex('#141f17');

function paintSpruceBough(p: Paint, r: PxRect, k: number, seed: number, o: { arms: number; round: number; curl: number }): void {
  const rnd = mulberry32(seed);
  const cx = r.x + r.w / 2;
  const yb = r.y + r.h - 6 * k;
  const yt = r.y + 10 * k;
  const L = yb - yt;
  const W = r.w / 2 - 10 * k;
  // spray outline: widest a little below the middle, a bare-ish base by the trunk, a slim tip
  const env = (t: number) => {
    const s = Math.max(0, Math.sin(Math.PI * Math.min(1, 0.06 + t * (1 - 0.06 * o.round))));
    return W * Math.pow(s, 0.7 - 0.25 * o.round) * (1 - 0.25 * Math.max(0, t - 0.55));
  };
  const axis = (t: number): [number, number] => [cx + o.curl * W * 0.12 * Math.sin(Math.PI * t), yb - t * L];

  // a dense dark under-layer where the snow pillow lies (the shader shows it when the snow does not)
  p.c.fillStyle = css(NEEDLE_BASE);
  const pillow: { x: number; y: number; rx: number; ry: number }[] = [];
  for (let t = 0.1; t < 0.92; t += 0.026) {
    // a lumpy, broken ridge of snow along the axis, gaps where the needles show through
    if (rnd() < 0.18) {
      t += 0.03;
      continue;
    }
    const [x, y] = axis(t);
    const w = env(t);
    pillow.push({ x: x + (rnd() - 0.5) * w * 0.25, y, rx: w * (0.14 + 0.16 * rnd()), ry: w * (0.2 + 0.16 * rnd()) });
  }
  for (const q of pillow) ellipse(p.c, q.x, q.y, q.rx * 0.8, q.ry * 0.8);

  const twigs = new Strokes([SPRUCE_TWIG_OLD, SPRUCE_TWIG], 1.6 * k);
  const st = new Strokes(NEEDLE, 1.25 * k);
  // main axis
  const ax: [number, number][] = [];
  for (let i = 0; i <= 24; i++) ax.push(axis(i / 24));
  needles(st, rnd, ax, k, 10, 2.6, 0.95, (t) => 0.1 + 0.5 * t, 0.06);
  const n = o.arms;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const t = Math.min(0.97, (i + 0.35 + rnd() * 0.5) / n);
      const [x0, y0] = axis(t);
      const off = 0.88 + rnd() * 0.3 + 0.15 * t;
      const ang = -Math.PI / 2 + side * off;
      const len = (env(t) / Math.sin(off)) * (0.78 + 0.3 * rnd());
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      // branchlets bow forward toward the tip
      const bx = (x0 + x1) / 2 + Math.cos(ang - side * 0.5) * len * 0.08;
      const by = (y0 + y1) / 2 - len * 0.1;
      const pts = quad(x0, y0, bx, by, x1, y1, 6);
      const inner = t < 0.14;
      for (let j = 0; j < pts.length - 1; j++) twigs.line(inner ? 0 : 0.6, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
      needles(st, rnd, pts, k, 12, 2.0, 1.0, (u) => (inner ? 0.05 : 0.15 + 0.35 * t + 0.4 * u), inner ? 0.4 : 0.05);
      // sub-branchlets
      const subs = len > 40 * k ? 2 + Math.floor(rnd() * 3) : 1;
      for (let s = 0; s < subs; s++) {
        const u = 0.3 + 0.6 * ((s + rnd() * 0.6) / subs);
        const q = pts[Math.min(pts.length - 1, Math.round(u * (pts.length - 1)))];
        const sd = s % 2 === 0 ? 1 : -1;
        const sa = ang + sd * (0.6 + rnd() * 0.35) - side * 0.15;
        const sl = len * (0.22 + rnd() * 0.18) * (1 - 0.4 * u);
        const sp = quad(q[0], q[1], q[0] + Math.cos(sa) * sl * 0.5, q[1] + Math.sin(sa) * sl * 0.5 - sl * 0.05, q[0] + Math.cos(sa) * sl, q[1] + Math.sin(sa) * sl, 3);
        needles(st, rnd, sp, k, 10, 2.2, 1.0, (v) => 0.3 + 0.3 * t + 0.35 * v);
      }
      // snow lies on the inner half of the branchlets next to the axis
      if (t > 0.08 && t < 0.9 && rnd() < 0.55) {
        const u = 0.2 + rnd() * 0.3;
        const q = pts[Math.round(u * (pts.length - 1))];
        snowLump(p.s, rnd, q[0], q[1], len * (0.1 + rnd() * 0.08), len * (0.07 + rnd() * 0.05), ang, 0.8);
      }
    }
  }
  twigs.flush(p.c);
  // twig axis on top of the under-layer
  polyline(p.c, ax.slice(0, 20), 3.2 * k, 1.2 * k, SPRUCE_TWIG);
  st.flush(p.c);
  // the snow pillow along the axis
  for (const q of pillow) snowLump(p.s, rnd, q.x, q.y, q.rx, q.ry, (rnd() - 0.5) * 0.4);
}

function paintSpruceCurtain(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const st = new Strokes(NEEDLE, 1.25 * k);
  const twigs = new Strokes([SPRUCE_TWIG_OLD, SPRUCE_TWIG], 1.4 * k);
  const top = r.y + 10 * k;
  // the bough's edge along the top
  const edge: [number, number][] = [];
  for (let i = 0; i <= 16; i++) edge.push([r.x + 6 * k + (i / 16) * (r.w - 12 * k), top + Math.sin(i * 1.3 + seed) * 3 * k]);
  needles(st, rnd, edge, k, 11, 2.2, 1.35, () => 0.25);
  const strands = 17;
  for (let i = 0; i < strands; i++) {
    const x0 = r.x + ((i + 0.2 + rnd() * 0.6) / strands) * r.w;
    const L = r.h * (0.42 + rnd() * 0.5) * (1 - 0.35 * Math.pow(Math.abs(i / (strands - 1) - 0.5) * 2, 2));
    const sway = (rnd() - 0.5) * 30 * k;
    const pts = quad(x0, top, x0 + sway * 0.3, top + L * 0.5, x0 + sway, top + L, 8);
    for (let j = 0; j < pts.length - 1; j++) twigs.line(j < 3 ? 0 : 0.6, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
    // needles stand out from the hanging twigs, splayed forward (down) and to the sides
    needles(st, rnd, pts, k, 10, 2.3, 1.05, (t) => 0.12 + 0.55 * t);
    const subs = 2 + Math.floor(rnd() * 3);
    for (let s = 0; s < subs; s++) {
      const u = 0.15 + 0.7 * rnd();
      const q = pts[Math.round(u * (pts.length - 1))];
      const sd = rnd() < 0.5 ? -1 : 1;
      const sa = Math.PI / 2 + sd * (0.45 + rnd() * 0.4);
      const sl = (18 + rnd() * 30) * k;
      const sp = quad(q[0], q[1], q[0] + Math.cos(sa) * sl * 0.5, q[1] + Math.sin(sa) * sl * 0.5, q[0] + Math.cos(sa) * sl, q[1] + Math.sin(sa) * sl, 3);
      needles(st, rnd, sp, k, 8.5, 2.5, 1.0, (t) => 0.3 + 0.5 * t);
    }
  }
  twigs.flush(p.c);
  st.flush(p.c);
  // crumbs of snow caught along the top edge
  for (let i = 0; i < 9; i++) {
    const x = r.x + (0.06 + rnd() * 0.88) * r.w;
    snowLump(p.s, rnd, x, top + 2 * k, (12 + rnd() * 18) * k, (5 + rnd() * 5) * k, 0, 0.8);
  }
}

function paintSpruceTip(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const cx = r.x + r.w / 2;
  const yb = r.y + r.h - 4 * k;
  const yt = r.y + 6 * k;
  const H = yb - yt;
  const W = r.w / 2 - 8 * k;
  const half = (t: number) => W * Math.pow(Math.max(0, 1 - t), 0.95) * (0.35 + 0.65 * Math.min(1, t * 6 + 0.2));
  // dense dark cone so the spire never looks hollow
  p.c.fillStyle = css(NEEDLE_BASE);
  p.c.beginPath();
  p.c.moveTo(cx, yt + H * 0.04);
  for (let i = 0; i <= 20; i++) {
    const t = 1 - i / 20;
    p.c.lineTo(cx + half(t) * 0.55, yb - t * H);
  }
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    p.c.lineTo(cx - half(t) * 0.55, yb - t * H);
  }
  p.c.fill();
  const st = new Strokes(NEEDLE, 1.25 * k);
  const leader: [number, number][] = [];
  for (let i = 0; i <= 20; i++) leader.push([cx + Math.sin(i * 0.9 + seed) * 1.2 * k, yb - (i / 20) * H]);
  polyline(p.c, leader.slice(0, 18), 4 * k, 1.2 * k, SPRUCE_TWIG);
  needles(st, rnd, leader, k, 10, 2.4, 0.8, (t) => 0.2 + 0.6 * t);
  // whorls: pairs of side branches, shorter toward the top
  let t = 0.02;
  while (t < 0.86) {
    const y = yb - t * H;
    const w = half(t);
    for (const side of [-1, 1]) {
      const droop = (0.25 - 0.45 * t) + (rnd() - 0.5) * 0.2;
      const x1 = cx + side * w * (0.85 + 0.2 * rnd());
      const y1 = y + droop * w * 0.6;
      const pts = quad(cx, y, (cx + x1) / 2, y + droop * w * 0.45 - w * 0.08, x1, y1 - w * 0.12 * (1 - t), 5);
      polyline(p.c, pts, 2.2 * k, 0.9 * k, SPRUCE_TWIG_OLD);
      needles(st, rnd, pts, k, 11, 2.2, 1.0, (u) => 0.15 + 0.3 * t + 0.4 * u);
      // hanging branchlets under the side branch
      for (let j = 1; j < pts.length; j += 2) {
        const q = pts[j];
        const hang = w * (0.2 + 0.25 * rnd()) * (1 - t);
        needles(st, rnd, [q, [q[0] + (rnd() - 0.5) * 6 * k, q[1] + hang]], k, 8, 2.6, 1.1, () => 0.2 + 0.3 * t);
      }
      // snow on top of the branch
      for (let j = 1; j < pts.length - 1; j++) {
        const q = pts[j];
        const f = j / (pts.length - 1);
        snowLump(p.s, rnd, q[0], q[1] - 4 * k, w * 0.16 * (1 - 0.5 * f) + 3 * k, (5 + 4 * (1 - f)) * k * (1 - t * 0.5), 0, 0.9);
      }
    }
    t += 0.05 + 0.07 * (1 - t) * (0.8 + 0.4 * rnd());
  }
  st.flush(p.c);
  // a snow cap on the very top
  snowLump(p.s, rnd, cx, yt + H * 0.12, 8 * k, 14 * k, 0, 0.9);
}

/* ------------------------------------------------------------------ */
/* Mountain birch, rowan, lichen                                       */
/* ------------------------------------------------------------------ */

const TWIG_COLS: RGB[] = [hex('#33292a'), hex('#413435'), hex('#504141'), hex('#5f4c4a'), hex('#6e5853')];

interface TwigOpts {
  depth: number;
  spread: number;
  shrink: number;
  /** turns twigs downward per level (weeping) */
  gravity: number;
  w0: number;
  catkins: number;
  /** snow crumbs at forks */
  crumbs: number;
}

function twigTree(p: Paint, rnd: Rnd, st: Strokes, k: number, x: number, y: number, ang: number, len: number, w: number, depth: number, o: TwigOpts, level: number, clip: PxRect): void {
  const bend = (rnd() - 0.5) * 0.35 + o.gravity * (Math.PI / 2 - ang) * 0.12 * level;
  const a1 = ang + bend;
  const x1 = x + Math.cos((ang + a1) / 2) * len;
  const y1 = y + Math.sin((ang + a1) / 2) * len;
  const mx = (x + x1) / 2 + Math.cos(ang + Math.PI / 2) * len * (rnd() - 0.5) * 0.15;
  const my = (y + y1) / 2 + Math.sin(ang + Math.PI / 2) * len * (rnd() - 0.5) * 0.15;
  const pts = quad(x, y, mx, my, x1, y1, 3);
  p.c.strokeStyle = css(TWIG_COLS[Math.min(TWIG_COLS.length - 1, level)]);
  p.c.lineWidth = Math.max(0.7 * k, w);
  p.c.beginPath();
  p.c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.c.lineTo(pts[i][0], pts[i][1]);
  p.c.stroke();
  const inside = x1 > clip.x + 4 * k && x1 < clip.x + clip.w - 4 * k && y1 > clip.y + 4 * k && y1 < clip.y + clip.h - 4 * k;
  if (depth <= 0 || !inside) {
    if (inside && rnd() < o.catkins) {
      // male catkins wait at the twig tips all winter
      p.c.fillStyle = css(hex('#6a5038'));
      ellipse(p.c, x1 + Math.cos(a1) * 4 * k, y1 + Math.sin(a1) * 4 * k, 5.5 * k, 1.8 * k, a1);
    }
    // fine terminal shoots
    for (let i = 0; i < 2; i++) {
      const a = a1 + (rnd() - 0.5) * 0.9;
      const l = len * (0.4 + rnd() * 0.3);
      st.line(rnd(), x1, y1, x1 + Math.cos(a) * l, y1 + Math.sin(a) * l);
    }
    return;
  }
  if (rnd() < o.crumbs * (level > 0 ? 1 : 0.3)) {
    // a crumb of snow caught in the fork (texture up = up the twig)
    snowLump(p.s, rnd, x1, y1 - 2 * k, (2.5 + rnd() * 3) * k * (1 + w / (3 * k)), (1.8 + rnd() * 1.5) * k, 0, 0.85);
  }
  const kids = rnd() < 0.3 ? 3 : 2;
  for (let i = 0; i < kids; i++) {
    const f = i / (kids - 1) - 0.5;
    const a = a1 + f * o.spread * 2 + (rnd() - 0.5) * 0.3;
    twigTree(p, rnd, st, k, x1, y1, a, len * (o.shrink + rnd() * 0.12), w * 0.68, depth - 1, o, level + 1, clip);
  }
}

function paintTwigs(p: Paint, r: PxRect, k: number, seed: number, o: TwigOpts & { stems: number; fromTop: boolean; fan: number }): void {
  const rnd = mulberry32(seed);
  const st = new Strokes(TWIG_COLS.slice(2), 0.9 * k);
  const cx = r.x + r.w / 2;
  const y0 = o.fromTop ? r.y + 6 * k : r.y + r.h - 4 * k;
  const len0 = (o.fromTop ? r.h * 0.2 : r.h * 0.26) * (0.9 + rnd() * 0.2);
  for (let i = 0; i < o.stems; i++) {
    const f = o.stems === 1 ? 0 : i / (o.stems - 1) - 0.5;
    // upright fans spread from the base; weeping sprays start out sideways and fall
    const side = f < 0 ? -1 : 1;
    const a0 = o.fromTop
      ? Math.PI / 2 - f * 2.4 * side * side + (rnd() - 0.5) * 0.2
      : -Math.PI / 2 + f * o.fan * 2 + (rnd() - 0.5) * 0.25;
    twigTree(p, rnd, st, k, cx + f * 8 * k, y0, a0, len0 * (0.85 + rnd() * 0.3), o.w0 * k, o.depth, o, 0, r);
  }
  st.flush(p.c);
}

/**
 * A mountain-birch twig spray: a whip-like main twig with long thin side twigs
 * branching up from it, slim and plume-shaped, drooping a little at the ends.
 */
const RIME_COLS: RGB[] = [hex('#9aa3ab'), hex('#b6bec6'), hex('#cfd6dd'), hex('#e3e8ed'), hex('#f2f5f8')];

function paintBirchSpray(p: Paint, r: PxRect, k: number, seed: number, sprays: number, rime = false): void {
  const rnd = mulberry32(seed);
  const cols = rime ? RIME_COLS : TWIG_COLS;
  const wk = rime ? 1.7 : 1;
  const st = new Strokes(cols.slice(1), 1.0 * k * wk);
  const fine = new Strokes(cols.slice(2), 0.75 * k * wk);
  // hoar-frost feathers: short crystals standing off the twigs
  const fur = rime ? new Strokes(RIME_COLS.slice(2), 0.8 * k) : null;
  const cx = r.x + r.w / 2;
  const yb = r.y + r.h - 4 * k;
  for (let q = 0; q < sprays; q++) {
    const f = sprays === 1 ? 0 : q / (sprays - 1) - 0.5;
    const L = r.h * (0.82 + 0.14 * rnd()) * (1 - Math.abs(f) * 0.35);
    let a = -Math.PI / 2 + f * 0.7 + (rnd() - 0.5) * 0.12;
    let x = cx + f * 14 * k;
    let y = yb;
    const steps = 22;
    const axis: [number, number][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      // the whip arches over and droops toward its tip
      a += (rnd() - 0.5) * 0.08 + f * 0.02 + 0.012 * Math.sign(f || 0.3) * t * t * 4;
      x += Math.cos(a) * (L / steps);
      y += Math.sin(a) * (L / steps);
      axis.push([x, y]);
    }
    polyline(p.c, axis, 3.0 * k * wk, 0.9 * k * wk, cols[1]);
    let side = rnd() < 0.5 ? -1 : 1;
    for (let i = 2; i < steps - 1; i++) {
      if (rnd() < 0.1) continue;
      const t = i / steps;
      const [sx, sy] = axis[i];
      const ta = Math.atan2(axis[i + 1][1] - sy, axis[i + 1][0] - sx);
      side = -side;
      const sa = ta + side * (0.45 + 0.3 * rnd());
      const env = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95));
      const sl = L * (0.18 + 0.2 * rnd()) * env;
      const pts = quad(sx, sy, sx + Math.cos(sa) * sl * 0.5, sy + Math.sin(sa) * sl * 0.5, sx + Math.cos(sa + side * 0.15) * sl, sy + Math.sin(sa + side * 0.15) * sl + sl * 0.08, 3);
      for (let j = 0; j < pts.length - 1; j++) st.line(t, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
      if (fur) {
        for (let j = 0; j < 14; j++) {
          const u = rnd();
          const b0 = pts[Math.min(pts.length - 1, Math.floor(u * pts.length))];
          const fa = sa + (rnd() < 0.5 ? -1 : 1) * (1.0 + rnd() * 0.6);
          const fl = (3 + rnd() * 4) * k;
          fur.line(rnd(), b0[0], b0[1], b0[0] + Math.cos(fa) * fl, b0[1] + Math.sin(fa) * fl);
        }
      }
      // sub-twigs
      const subs = 2 + Math.floor(rnd() * 3);
      for (let s2 = 0; s2 < subs; s2++) {
        const u = 0.25 + 0.6 * rnd();
        const b = pts[Math.round(u * (pts.length - 1))];
        const ba = sa + (rnd() < 0.5 ? -1 : 1) * (0.4 + 0.3 * rnd());
        const bl = sl * (0.25 + 0.25 * rnd());
        fine.line(rnd(), b[0], b[1], b[0] + Math.cos(ba) * bl, b[1] + Math.sin(ba) * bl);
      }
      const tip = pts[pts.length - 1];
      if (rnd() < 0.18) {
        p.c.fillStyle = css(hex('#6a5038'));
        ellipse(p.c, tip[0] + Math.cos(sa) * 4 * k, tip[1] + Math.sin(sa) * 4 * k, 5 * k, 1.7 * k, sa);
      }
      if (rnd() < 0.3) snowLump(p.s, rnd, sx + Math.cos(sa) * 3 * k, sy - 2 * k, (2.5 + rnd() * 2.5) * k, (1.5 + rnd()) * k, 0, 0.85);
    }
  }
  st.flush(p.c);
  fine.flush(p.c);
  fur?.flush(p.c);
}

function paintRowanBerries(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const cx = r.x + r.w / 2;
  const top = r.y + 8 * k;
  const stalk = hex('#5a4434');
  // the corymb: a stalk, then pedicels spreading into a loose dome hanging below
  const hub: [number, number] = [cx + (rnd() - 0.5) * 10 * k, top + r.h * 0.2];
  polyline(p.c, [[cx, top], hub], 3 * k, 2.4 * k, stalk);
  const berries: { x: number; y: number; r: number }[] = [];
  const arms = 9;
  for (let i = 0; i < arms; i++) {
    const a = Math.PI / 2 + ((i + 0.5) / arms - 0.5) * 2.6 + (rnd() - 0.5) * 0.2;
    const L = r.w * (0.16 + rnd() * 0.12);
    const ex = hub[0] + Math.cos(a) * L;
    const ey = hub[1] + Math.sin(a) * L * 0.8 + L * 0.2;
    polyline(p.c, quad(hub[0], hub[1], (hub[0] + ex) / 2, hub[1] + 2 * k, ex, ey, 3), 1.8 * k, 1.2 * k, stalk);
    const m = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < m; j++) {
      const b = rnd() * Math.PI * 2;
      const d = (8 + rnd() * 14) * k;
      berries.push({ x: ex + Math.cos(b) * d, y: ey + Math.sin(b) * d * 0.8 + 6 * k, r: (8 + rnd() * 3) * k });
    }
  }
  berries.sort((a, b) => a.y - b.y);
  for (const b of berries) {
    p.c.fillStyle = css(hex('#6e1a10'));
    ellipse(p.c, b.x, b.y, b.r, b.r);
    p.c.fillStyle = css(mix(hex('#b02a17'), hex('#cf4a22'), rnd()));
    ellipse(p.c, b.x - b.r * 0.12, b.y - b.r * 0.12, b.r * 0.82, b.r * 0.82);
    p.c.fillStyle = css(hex('#ee8a5e'));
    ellipse(p.c, b.x - b.r * 0.35, b.y - b.r * 0.38, b.r * 0.22, b.r * 0.18);
    // the dark calyx dot at the tip
    p.c.fillStyle = css(hex('#3a1a12'));
    ellipse(p.c, b.x + b.r * 0.1, b.y + b.r * 0.55, b.r * 0.14, b.r * 0.12);
  }
  // snow sits on the top of the cluster
  for (const b of berries) if (b.y < hub[1] + r.h * 0.22 && rnd() < 0.7) snowLump(p.s, rnd, b.x, b.y - b.r * 0.55, b.r * 0.9, b.r * 0.5, 0, 0.9);
}

function paintLichen(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const st = new Strokes([hex('#6f7563'), hex('#858b77'), hex('#9ba28c'), hex('#b0b6a0')], 1.2 * k);
  for (let i = 0; i < 70; i++) {
    const x = r.x + (0.15 + 0.7 * rnd()) * r.w;
    const L = r.h * (0.3 + 0.62 * rnd()) * (1 - 0.6 * Math.abs(x - (r.x + r.w / 2)) / r.w);
    const sw = (rnd() - 0.5) * 24 * k;
    const pts = quad(x, r.y + 4 * k, x + sw * 0.3, r.y + L * 0.5, x + sw, r.y + L, 6);
    const shade = rnd();
    for (let j = 0; j < pts.length - 1; j++) st.line(shade, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
    // fine side filaments
    for (let j = 1; j < pts.length - 1; j++) {
      if (rnd() < 0.5) continue;
      const a = Math.PI / 2 + (rnd() - 0.5) * 1.6;
      const l = (6 + rnd() * 10) * k;
      st.line(shade, pts[j][0], pts[j][1], pts[j][0] + Math.cos(a) * l, pts[j][1] + Math.sin(a) * l);
    }
  }
  st.flush(p.c);
}

/* ------------------------------------------------------------------ */
/* Dwarf shrubs, grasses, dried herbs                                  */
/* ------------------------------------------------------------------ */

/** Irregular blob from overlapping circles; returns signed inside-ness (> 0 inside). */
function blobShape(rnd: Rnd, cx: number, cy: number, R: number, lobes: number): (x: number, y: number) => number {
  const cs: { x: number; y: number; r: number }[] = [{ x: cx, y: cy, r: R * 0.55 }];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rnd() * 0.8;
    const d = R * (0.35 + rnd() * 0.18);
    cs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: R * (0.36 + rnd() * 0.14) });
  }
  return (x, y) => {
    let best = -1e9;
    for (const c of cs) best = Math.max(best, c.r - Math.hypot(x - c.x, y - c.y));
    return best;
  };
}

function paintJuniper(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R = r.w * 0.46;
  const inside = blobShape(rnd, cx, cy, R, 6);
  const st = new Strokes([hex('#1f2b25'), hex('#27352e'), hex('#304037'), hex('#3a4b40'), hex('#475a4c'), hex('#566a5b')], 1.4 * k);
  // sprigs radiating from the centre: scale-like prickly needles in whorls of three
  for (let i = 0, guard = 0; i < 190 && guard < 2000; guard++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * R;
    const x0 = cx + Math.cos(a) * d * 0.4;
    const y0 = cy + Math.sin(a) * d * 0.4;
    const x1 = cx + Math.cos(a) * d;
    const y1 = cy + Math.sin(a) * d;
    if (inside(x1, y1) < 4 * k) continue;
    i++;
    const pts = quad(x0, y0, (x0 + x1) / 2 + (rnd() - 0.5) * 10 * k, (y0 + y1) / 2 + (rnd() - 0.5) * 10 * k, x1, y1, 4);
    needles(st, rnd, pts, k, 7, 2.2, 0.75, (t) => 0.15 + 0.6 * (d / R) * t);
  }
  st.flush(p.c);
  // a few dusty blue berries
  for (let i = 0; i < 9; i++) {
    const x = cx + (rnd() - 0.5) * R * 1.2;
    const y = cy + (rnd() - 0.5) * R * 1.2;
    if (inside(x, y) < 6 * k) continue;
    p.c.fillStyle = css(mix(hex('#4f5f78'), hex('#7b8aa0'), rnd()));
    ellipse(p.c, x, y, 3.2 * k, 3.2 * k);
  }
  // snow over the middle of the mound
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * R * 0.45;
    snowLump(p.s, rnd, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.22 + rnd() * 0.15), R * (0.2 + rnd() * 0.12), rnd() * 3, 0.9);
  }
}

function paintDwarfBirch(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const cx = r.x + r.w / 2;
  const yb = r.y + r.h - 3 * k;
  const st = new Strokes([hex('#3e231c'), hex('#4f2c22'), hex('#62362a'), hex('#744434'), hex('#86533d')], 1.1 * k);
  const stems = 11;
  for (let i = 0; i < stems; i++) {
    const f = i / (stems - 1) - 0.5;
    let x = cx + f * r.w * 0.3 + (rnd() - 0.5) * 10 * k;
    let y = yb;
    let a = -Math.PI / 2 + f * 1.3 + (rnd() - 0.5) * 0.3;
    const L = r.h * (0.5 + rnd() * 0.42);
    const steps = 7;
    for (let s = 0; s < steps; s++) {
      const l = L / steps;
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      p.c.strokeStyle = css(mix(hex('#3a2019'), hex('#5e3427'), s / steps));
      p.c.lineWidth = (3.2 - 2.2 * (s / steps)) * k;
      p.c.beginPath();
      p.c.moveTo(x, y);
      p.c.lineTo(nx, ny);
      p.c.stroke();
      // zig-zag shoots with short side spurs
      if (s > 1) {
        for (const sd of [-1, 1]) {
          if (rnd() < 0.35) continue;
          const sa = a + sd * (0.6 + rnd() * 0.5);
          const sl = (10 + rnd() * 18) * k * (1 - s / steps * 0.5);
          st.line(rnd(), nx, ny, nx + Math.cos(sa) * sl, ny + Math.sin(sa) * sl);
          // a few withered round leaves still hanging on
          if (rnd() < 0.18) {
            p.c.fillStyle = css(mix(hex('#6b3a22'), hex('#9a5a30'), rnd()));
            ellipse(p.c, nx + Math.cos(sa) * sl, ny + Math.sin(sa) * sl, 3.2 * k, 2.8 * k);
          }
        }
      }
      x = nx;
      y = ny;
      a += (rnd() - 0.5) * 0.5;
      if (s === steps - 1) snowLump(p.s, rnd, x, y - 2 * k, 4 * k, 2.5 * k, 0, 0.8);
    }
  }
  st.flush(p.c);
}

/** Tapered blade along a quadratic curve. */
function bladePath(ctx: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number): void {
  let dx = cx - x0;
  let dy = cy - y0;
  let l = Math.hypot(dx, dy) || 1;
  const nx0 = -dy / l;
  const ny0 = dx / l;
  dx = x1 - cx;
  dy = y1 - cy;
  l = Math.hypot(dx, dy) || 1;
  const nxc = -dy / l;
  const nyc = dx / l;
  const h = w0 * 0.5;
  ctx.beginPath();
  ctx.moveTo(x0 + nx0 * h, y0 + ny0 * h);
  ctx.quadraticCurveTo(cx + nxc * h * 0.7, cy + nyc * h * 0.7, x1, y1);
  ctx.quadraticCurveTo(cx - nxc * h * 0.7, cy - nyc * h * 0.7, x0 - nx0 * h, y0 - ny0 * h);
  ctx.closePath();
}

function paintLyme(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const bx = r.x + r.w / 2;
  const by = r.y + r.h - 3 * k;
  // winter lyme grass: bleached straw with a few blades still glaucous blue-grey
  const straw = [hex('#b9a77f'), hex('#a7936b'), hex('#c8b890'), hex('#9a8662'), hex('#d1c4a0')];
  const blue = [hex('#8f9a96'), hex('#a3aca5'), hex('#7f8a86')];
  const blades: { x0: number; cx: number; cy: number; x1: number; y1: number; w: number; c: RGB }[] = [];
  for (let i = 0; i < 46; i++) {
    const x0 = bx + (rnd() - 0.5) * 60 * k;
    const lean = (rnd() - 0.5) * 1.9;
    const L = r.h * (0.42 + rnd() * 0.45);
    const out = Math.sign(lean) || 1;
    // stiff blades arching out, the longer ones folding over
    const x1 = x0 + Math.sin(lean) * L * 0.9 + out * L * 0.15 * Math.abs(lean);
    const y1 = by - Math.cos(lean * 0.8) * L * 0.85 + L * 0.2 * Math.abs(lean) * Math.abs(lean);
    const c = rnd() < 0.2 ? pick(rnd, blue) : pick(rnd, straw);
    blades.push({ x0, cx: x0 + Math.sin(lean) * L * 0.35, cy: by - L * 0.7, x1: Math.max(r.x + 3, Math.min(r.x + r.w - 3, x1)), y1: Math.max(r.y + 3, y1), w: (6 + rnd() * 5) * k, c });
  }
  blades.sort(() => rnd() - 0.5);
  for (const b of blades) {
    p.c.fillStyle = css(b.c, 0.85 + rnd() * 0.25);
    bladePath(p.c, b.x0, by, b.cx, b.cy, b.x1, b.y1, b.w);
    p.c.fill();
    // a darker rolled edge
    p.c.strokeStyle = css(mix(b.c, hex('#5d4f38'), 0.45));
    p.c.lineWidth = 0.9 * k;
    p.c.beginPath();
    p.c.moveTo(b.x0, by);
    p.c.quadraticCurveTo(b.cx, b.cy, b.x1, b.y1);
    p.c.stroke();
  }
  // dried seed spikes, straight and stiff
  for (let i = 0; i < 6; i++) {
    const x0 = bx + (rnd() - 0.5) * 40 * k;
    const lean = (rnd() - 0.5) * 0.35;
    const top = r.y + r.h * (0.05 + rnd() * 0.18);
    const x1 = x0 + Math.sin(lean) * (by - top);
    polyline(p.c, [[x0, by], [x1, top + 60 * k]], 2.2 * k, 1.6 * k, hex('#a08d66'));
    const sc = hex('#8f7c58');
    for (let j = 0; j < 14; j++) {
      const t = j / 13;
      const y = top + 60 * k - t * 60 * k;
      const x = x1 + Math.sin(lean) * -t * 60 * k;
      p.c.fillStyle = css(mix(sc, hex('#b5a37c'), rnd()));
      ellipse(p.c, x - 1.8 * k, y, 1.8 * k, 4.5 * k, -0.35);
      ellipse(p.c, x + 1.8 * k, y - 2 * k, 1.8 * k, 4.5 * k, 0.35);
    }
  }
  // a little snow trapped low in the tussock
  for (let i = 0; i < 6; i++) snowLump(p.s, rnd, bx + (rnd() - 0.5) * 70 * k, by - (10 + rnd() * 50) * k, (8 + rnd() * 12) * k, (4 + rnd() * 5) * k, 0, 0.6);
}

function paintStalks(p: Paint, r: PxRect, k: number, seed: number): void {
  const rnd = mulberry32(seed);
  const by = r.y + r.h - 3 * k;
  const stems: { x0: number; x1: number; top: number }[] = [];
  const kinds = ['fire', 'fire', 'umbel', 'fire', 'yarrow', 'umbel', 'fire', 'yarrow'];
  kinds.forEach((kind, i) => {
    const x0 = r.x + r.w * (0.32 + 0.36 * (i / (kinds.length - 1))) + (rnd() - 0.5) * 18 * k;
    const tall = kind === 'fire' ? 0.6 + rnd() * 0.32 : kind === 'umbel' ? 0.55 + rnd() * 0.3 : 0.32 + rnd() * 0.22;
    const top = by - r.h * tall;
    const lean = (rnd() - 0.5) * 0.25 + (x0 - (r.x + r.w / 2)) / r.w * 0.5;
    const x1 = x0 + lean * (by - top);
    stems.push({ x0, x1, top });
    const stalkC = kind === 'fire' ? hex('#5e3b30') : kind === 'umbel' ? hex('#6f5c45') : hex('#6a5a48');
    polyline(p.c, quad(x0, by, (x0 + x1) / 2 + (rnd() - 0.5) * 6 * k, (by + top) / 2, x1, top, 6), (kind === 'umbel' ? 4.5 : 3) * k, 1.6 * k, stalkC);
    if (kind === 'fire') {
      // fireweed: long thin split pods angled up along the top third, wisps of white seed fluff
      for (let j = 0; j < 16; j++) {
        const t = j / 15;
        const y = top + (by - top) * 0.38 * t;
        const x = x1 + (x0 - x1) * 0.38 * t;
        const side = j % 2 ? 1 : -1;
        const a = -Math.PI / 2 + side * (0.45 + rnd() * 0.25);
        const l = (26 + rnd() * 16) * k * (1 - 0.4 * (1 - t));
        p.c.strokeStyle = css(mix(hex('#4e2e26'), hex('#7a5244'), rnd()));
        p.c.lineWidth = 1.6 * k;
        p.c.beginPath();
        p.c.moveTo(x, y);
        p.c.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5, x + Math.cos(a + side * 0.3) * l, y + Math.sin(a + side * 0.3) * l);
        p.c.stroke();
        if (rnd() < 0.3) {
          p.c.strokeStyle = 'rgba(232,228,220,0.9)';
          p.c.lineWidth = 0.9 * k;
          for (let h = 0; h < 5; h++) {
            const ha = a + (rnd() - 0.5) * 1.8;
            const hx = x + Math.cos(a) * l;
            const hy = y + Math.sin(a) * l;
            p.c.beginPath();
            p.c.moveTo(hx, hy);
            p.c.lineTo(hx + Math.cos(ha) * 9 * k, hy + Math.sin(ha) * 9 * k);
            p.c.stroke();
          }
        }
      }
    } else if (kind === 'umbel') {
      // angelica: spokes radiating up into a dome, dark seed clusters at their ends, a cap of snow
      const R = (34 + rnd() * 20) * k;
      const spokes = 12;
      for (let j = 0; j < spokes; j++) {
        const a = -Math.PI / 2 + ((j + 0.5) / spokes - 0.5) * 2.4;
        const ex = x1 + Math.cos(a) * R;
        const ey = top + Math.sin(a) * R * 0.55;
        polyline(p.c, [[x1, top], [ex, ey]], 1.6 * k, 1.1 * k, hex('#6a5640'));
        for (let s = 0; s < 5; s++) {
          const sa = a + (rnd() - 0.5) * 1.2;
          const sl = (5 + rnd() * 6) * k;
          p.c.strokeStyle = css(hex('#5a4532'));
          p.c.lineWidth = 0.9 * k;
          p.c.beginPath();
          p.c.moveTo(ex, ey);
          p.c.lineTo(ex + Math.cos(sa) * sl, ey + Math.sin(sa) * sl);
          p.c.stroke();
          p.c.fillStyle = css(hex('#3d2f22'));
          ellipse(p.c, ex + Math.cos(sa) * sl, ey + Math.sin(sa) * sl, 1.8 * k, 1.8 * k);
        }
      }
      snowLump(p.s, rnd, x1, top - R * 0.42, R * 0.85, R * 0.22, 0, 0.95);
    } else {
      // yarrow: a flat dried corymb of brown heads
      const R = (16 + rnd() * 8) * k;
      for (let j = 0; j < 22; j++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * R;
        p.c.fillStyle = css(mix(hex('#5b4a38'), hex('#8a7556'), rnd()));
        ellipse(p.c, x1 + Math.cos(a) * d, top + Math.sin(a) * d * 0.3, 2.6 * k, 2.6 * k);
      }
      snowLump(p.s, rnd, x1, top - 4 * k, R * 1.0, R * 0.32, 0, 0.9);
    }
  });
  // withered leaves and grass at the foot
  const st = new Strokes([hex('#6b5a44'), hex('#857256'), hex('#9c8a6a')], 2.2 * k);
  for (const s of stems) {
    for (let j = 0; j < 4; j++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      const l = (20 + rnd() * 40) * k;
      st.line(rnd(), s.x0, by, s.x0 + Math.cos(a) * l, by + Math.sin(a) * l * 0.8);
    }
  }
  st.flush(p.c);
}

/* ------------------------------------------------------------------ */
/* Bark                                                                */
/* ------------------------------------------------------------------ */

/** Periodic Worley F1/F2 on a jittered grid (one feature point per cell, 3x3 search). */
class GridWorley {
  private jit: Float32Array;
  constructor(
    private gx: number,
    private gy: number,
    rnd: Rnd,
  ) {
    this.jit = new Float32Array(gx * gy * 3);
    for (let i = 0; i < this.jit.length; i++) this.jit[i] = rnd();
  }
  /** [f1, f2, id] in units of the larger cell size; sy stretches distances along v */
  sample(u: number, v: number, sy: number): [number, number, number] {
    const { gx, gy, jit } = this;
    const fx = u * gx;
    const fy = v * gy;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const wx = ((cx % gx) + gx) % gx;
        const wy = ((cy % gy) + gy) % gy;
        const c = (wy * gx + wx) * 3;
        const px = cx + 0.1 + 0.8 * jit[c];
        const py = cy + 0.1 + 0.8 * jit[c + 1];
        const d = Math.hypot(fx - px, (fy - py) * sy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = c;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2, jit[id + 2]];
  }
}

function paintBark(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number, kind: BarkKind, seed: number): void {
  // the noise base is computed at half resolution and scaled up; crisp marks are drawn on top
  const n = Math.max(16, size >> 1);
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = n;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  const img = tctx.createImageData(n, n);
  const d = img.data;
  const f1 = new PeriodicFbm(4, 4, 3, seed);
  const f2 = new PeriodicFbm(24, 3, 2, seed + 3);
  const f3 = new PeriodicFbm(2, 8, 2, seed + 7);
  const f4 = new PeriodicFbm(6, 24, 2, seed + 13);
  const rnd = mulberry32(seed + 11);
  const scales = kind === 'spruce' ? new GridWorley(26, 34, rnd) : null;
  for (let py = 0; py < n; py++) {
    // v runs up the trunk: canvas top = top of the tile
    const v = 1 - (py + 0.5) / n;
    for (let px = 0; px < n; px++) {
      const u = (px + 0.5) / n;
      let c: RGB;
      const n1 = f1.sample(u, v);
      const n2 = f2.sample(u, v);
      switch (kind) {
        case 'spruce': {
          // thin rounded scales, reddish to grey brown, dark seams, a few lichen spots
          const [w1, w2, tone] = scales!.sample(u, v, 0.8);
          const e = w2 - w1;
          const plate = mix(hex('#4f433a'), hex('#6e6257'), tone * 0.7 + 0.3 * (0.5 + 0.5 * n1));
          const kk = (1 + 0.12 * n2 + 0.08 * n1) * (1.06 - 0.18 * Math.min(1, w1));
          c = [plate[0] * kk, plate[1] * kk, plate[2] * kk];
          const lip = Math.max(0, 1 - Math.abs(e - 0.22) / 0.12);
          c = mix(c, hex('#9a8a78'), lip * 0.2);
          if (e < 0.12) c = mix(hex('#2a201a'), c, e / 0.12);
          const lich = f3.sample(u, v) * 0.7 + n2 * 0.3;
          if (lich > 0.5) c = mix(c, hex('#8d917f'), Math.min(0.6, (lich - 0.5) * 3));
          break;
        }
        case 'birch':
        case 'birchDark': {
          const dark = kind === 'birchDark';
          // chalky white with cream and pinkish peel bands across the stem
          c = mix(dark ? hex('#a8a39b') : hex('#e6e3dc'), dark ? hex('#c9c5bd') : hex('#f2efe9'), 0.5 + 0.5 * n1);
          const band = f4.sample(u, v);
          if (band > 0.25) c = mix(c, dark ? hex('#8e8780') : hex('#e8d9cc'), Math.min(1, (band - 0.25) * 3) * 0.6);
          if (band < -0.35) c = mix(c, hex('#c8c3bb'), Math.min(1, (-0.35 - band) * 3) * 0.7);
          if (dark) {
            // old trunks: rough dark patches breaking through the white
            const rough = f1.sample(u * 2, v) * 0.6 + f3.sample(u, v) * 0.4;
            c = mix(c, hex('#2d2926'), Math.min(0.92, Math.max(0, (rough - 0.05) * 3.5)));
          }
          break;
        }
        case 'rowan': {
          c = mix(hex('#6c6861'), hex('#86817a'), 0.5 + 0.5 * n1);
          const kk = 1 + 0.05 * n2;
          c = [c[0] * kk, c[1] * kk, c[2] * kk];
          const lich = f3.sample(u, v) + n1 * 0.5;
          if (lich > 0.6) c = mix(c, hex('#8e977c'), Math.min(0.7, (lich - 0.6) * 3));
          break;
        }
        case 'juniper': {
          // shreddy strips along the stem
          const sn = Math.sin(Math.PI * 2 * (u * 11 + 0.5 * f3.sample(u, v)));
          c = mix(hex('#4c3427'), hex('#7a5a44'), 0.5 + 0.5 * sn);
          c = mix(c, hex('#857a70'), Math.max(0, n2) * 0.5);
          break;
        }
        case 'twig': {
          c = mix(hex('#3e2b28'), hex('#56392f'), 0.5 + 0.5 * n1);
          break;
        }
        case 'deadwood': {
          // wind-silvered dead wood with long checks
          c = mix(hex('#86817a'), hex('#a39f97'), 0.5 + 0.5 * n1);
          const chk = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * (u * 9 + 0.25 * f3.sample(u, v)))), 14);
          c = mix(c, hex('#4b4642'), chk);
          break;
        }
        default: {
          const sn = Math.sin(Math.PI * 2 * u * 6);
          c = mix(hex('#5d4a38'), hex('#7d6a52'), 0.5 + 0.35 * sn + 0.15 * n1);
          break;
        }
      }
      const i = (py * n + px) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, x0, y0, size, size);
  // crisp marks, wrapped across the tile edges
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x0 + ox, y0 + oy);
  };
  const lenticels = (count: number, col: string, lmin: number, lmax: number, hmin: number, hmax: number) => {
    ctx.fillStyle = col;
    for (let i = 0; i < count; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const l = (lmin + rnd() * (lmax - lmin)) * size;
      const h = Math.max(0.8, (hmin + rnd() * (hmax - hmin)) * size);
      wrap((ox, oy) => {
        ctx.beginPath();
        ctx.ellipse(ox + x, oy + y, l / 2, h / 2, (rnd() - 0.5) * 0.06, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };
  if (kind === 'birch' || kind === 'birchDark') {
    lenticels(kind === 'birch' ? 90 : 40, 'rgba(40,36,34,0.9)', 0.02, 0.14, 0.004, 0.011);
    // dark chevrons ("eyebrows") where twigs were shed
    ctx.fillStyle = 'rgba(34,30,28,0.92)';
    for (let i = 0; i < 3; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const w = (0.03 + rnd() * 0.04) * size;
      wrap((ox, oy) => {
        ctx.beginPath();
        ctx.moveTo(ox + x - w, oy + y - w * 0.35);
        ctx.quadraticCurveTo(ox + x, oy + y + w * 0.25, ox + x + w, oy + y - w * 0.35);
        ctx.quadraticCurveTo(ox + x, oy + y + w * 0.05, ox + x - w, oy + y - w * 0.35);
        ctx.fill();
      });
    }
  } else if (kind === 'rowan') lenticels(70, 'rgba(165,160,150,0.8)', 0.015, 0.045, 0.004, 0.008);
  else if (kind === 'twig') lenticels(40, 'rgba(150,135,120,0.6)', 0.01, 0.03, 0.004, 0.007);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Post-processing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Fill RGB of transparent pixels with the average color of nearby opaque
 * pixels (block averages), so mipmaps of alpha-tested cards keep their hue.
 */
function dilateTransparent(data: Uint8ClampedArray, S: number): void {
  const B = 16;
  const nb = Math.ceil(S / B);
  const sum = new Float32Array(nb * nb * 4);
  for (let y = 0; y < S; y++) {
    const by = (y / B) | 0;
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const a = data[i + 3];
      if (a < 128) continue;
      const k = (by * nb + ((x / B) | 0)) * 4;
      sum[k] += data[i];
      sum[k + 1] += data[i + 1];
      sum[k + 2] += data[i + 2];
      sum[k + 3] += 1;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = sum.slice();
    for (let by = 0; by < nb; by++) {
      for (let bx = 0; bx < nb; bx++) {
        const k = (by * nb + bx) * 4;
        if (sum[k + 3] > 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = bx + dx;
            const yy = by + dy;
            if (xx < 0 || yy < 0 || xx >= nb || yy >= nb) continue;
            const q = (yy * nb + xx) * 4;
            if (sum[q + 3] <= 0) continue;
            r += sum[q] / sum[q + 3];
            g += sum[q + 1] / sum[q + 3];
            b += sum[q + 2] / sum[q + 3];
            n++;
          }
        }
        if (n) {
          next[k] = r / n;
          next[k + 1] = g / n;
          next[k + 2] = b / n;
          next[k + 3] = 1;
        }
      }
    }
    sum.set(next);
  }
  for (let y = 0; y < S; y++) {
    const by = (y / B) | 0;
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (data[i + 3] >= 250) continue;
      const k = (by * nb + ((x / B) | 0)) * 4;
      const n = sum[k + 3];
      if (n <= 0) continue;
      const a = data[i + 3] / 255;
      data[i] = data[i] * a + (sum[k] / n) * (1 - a);
      data[i + 1] = data[i + 1] * a + (sum[k + 1] / n) * (1 - a);
      data[i + 2] = data[i + 2] * a + (sum[k + 2] / n) * (1 - a);
    }
  }
}

/** Paint the atlas, yielding to the browser between regions (each region's raster work is flushed before the yield). */
export async function buildAtlas(size: number, anisotropy: number): Promise<FloraAtlas> {
  const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));
  const S = size;
  const k = S / REF;
  const mk = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };
  const c = mk();
  const s = mk();
  c.clearRect(0, 0, S, S);
  s.fillStyle = '#000';
  s.fillRect(0, 0, S, S);
  const px = (r: PxRect): PxRect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  const ms: Record<string, number> = {};
  let tm = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    ms[name] = (ms[name] ?? 0) + Math.round(now - tm);
    tm = now;
  };
  const paint = (name: Region, fn: (p: Paint, r: PxRect) => void) => {
    const r = px(LAYOUT[name]);
    for (const ctx of [c, s]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.clip();
    }
    fn({ c, s }, r);
    c.restore();
    s.restore();
    lap(name);
  };
  // flush the queued canvas work (reading a pixel forces the raster) and let a frame through
  const breath = async () => {
    c.getImageData(0, 0, 1, 1);
    s.getImageData(0, 0, 1, 1);
    lap('raster');
    await yieldFrame();
    tm = performance.now();
  };
  paint('spruceBough', (p, r) => paintSpruceBough(p, r, k, 101, { arms: 40, round: 0, curl: 1 }));
  paint('spruceBough2', (p, r) => paintSpruceBough(p, r, k, 202, { arms: 32, round: 1, curl: -1 }));
  await breath();
  paint('spruceCurtain', (p, r) => paintSpruceCurtain(p, r, k, 303));
  paint('spruceTip', (p, r) => paintSpruceTip(p, r, k, 404));
  paint('juniper', (p, r) => paintJuniper(p, r, k, 505));
  paint('dwarfBirch', (p, r) => paintDwarfBirch(p, r, k, 606));
  await breath();
  paint('birchTwigs', (p, r) => paintBirchSpray(p, r, k, 707, 4));
  paint('rimeTwigs', (p, r) => paintBirchSpray(p, r, k, 717, 4, true));
  paint('birchWeep', (p, r) =>
    paintTwigs(p, r, k, 808, { stems: 5, fan: 0.6, fromTop: true, depth: 6, spread: 0.26, shrink: 0.74, gravity: 1, w0: 3, catkins: 0.2, crumbs: 0.25 }),
  );
  paint('rowanTwigs', (p, r) =>
    paintTwigs(p, r, k, 909, { stems: 4, fan: 0.5, fromTop: false, depth: 4, spread: 0.36, shrink: 0.72, gravity: 0, w0: 4.6, catkins: 0, crumbs: 0.5 }),
  );
  await breath();
  paint('rowanBerries', (p, r) => paintRowanBerries(p, r, k, 1010));
  paint('lichen', (p, r) => paintLichen(p, r, k, 1111));
  paint('lyme', (p, r) => paintLyme(p, r, k, 1212));
  paint('stalks', (p, r) => paintStalks(p, r, k, 1313));
  await breath();
  const tile = Math.round(BARK_TILE * k);
  for (let i = 0; i < BARK.length; i++) {
    paintBark(c, Math.round(i * tile), Math.round(BARK_Y * k), tile, BARK[i], 2000 + i * 31);
    if (i === 3) await breath();
  }
  lap('bark');

  const img = c.getImageData(0, 0, S, S);
  lap('read');
  await yieldFrame();
  tm = performance.now();
  dilateTransparent(img.data, S);
  lap('dilate');
  // the snow layer is soft: keep it at half resolution (the downsample is its blur)
  const SH = S >> 1;
  const half = document.createElement('canvas');
  half.width = half.height = SH;
  const hctx = half.getContext('2d', { willReadFrequently: true })!;
  hctx.imageSmoothingEnabled = true;
  hctx.imageSmoothingQuality = 'high';
  hctx.drawImage(s.canvas, 0, 0, SH, SH);
  const simg = hctx.getImageData(0, 0, SH, SH);
  lap('snow');
  // flip rows so v = 1 - y/S (image orientation)
  const data = new Uint8Array(S * S * 4);
  const row = S * 4;
  for (let y = 0; y < S; y++) data.set(img.data.subarray((S - 1 - y) * row, (S - y) * row), y * row);
  const sdata = new Uint8Array(SH * SH);
  for (let y = 0; y < SH; y++) {
    const src = (SH - 1 - y) * SH * 4;
    for (let x = 0; x < SH; x++) sdata[y * SH + x] = simg.data[src + x * 4];
  }

  const texture = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.name = 'flora-atlas';
  texture.needsUpdate = true;

  const snow = new THREE.DataTexture(sdata, SH, SH, THREE.RedFormat, THREE.UnsignedByteType);
  snow.wrapS = snow.wrapT = THREE.ClampToEdgeWrapping;
  snow.magFilter = THREE.LinearFilter;
  snow.minFilter = THREE.LinearMipmapLinearFilter;
  snow.generateMipmaps = true;
  snow.unpackAlignment = 1;
  snow.name = 'flora-snow';
  snow.needsUpdate = true;

  const rect = (name: Region, inset = 1.5): UVRect => {
    const r = LAYOUT[name];
    const x0 = r.x * k + inset;
    const x1 = (r.x + r.w) * k - inset;
    const y0 = r.y * k + inset;
    const y1 = (r.y + r.h) * k - inset;
    return { u0: x0 / S, u1: x1 / S, v0: 1 - y1 / S, v1: 1 - y0 / S };
  };
  lap('upload');
  return {
    ms,
    texture,
    snow,
    size: S,
    rect,
    bark: (kind) => {
      const i = BARK.indexOf(kind);
      return [(i * tile + 1) / S, ((i + 1) * tile - 1) / S];
    },
    barkBand: { v0: 0.5 / S, vh: (tile - 1) / S },
  };
}
