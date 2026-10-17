/**
 * Canvas lettering for signs and boards. Uses the page's Fraunces web font when
 * it is available (the glyphs are requested explicitly before drawing, with a
 * bounded wait) and falls back to the system serif.
 */
export const SERIF = '"Fraunces Variable", "Fraunces", Georgia, "Times New Roman", serif';

const loaded = new Set<string>();

/** Make sure the font subsets covering `text` are loaded (bounded wait). */
export async function ensureGlyphs(text: string, weight = 600): Promise<void> {
  const key = `${weight}:${text}`;
  if (loaded.has(key) || typeof document === 'undefined' || !document.fonts) return;
  loaded.add(key);
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`${weight} 64px "Fraunces Variable"`, text), document.fonts.load(`400 64px "Fraunces Variable"`, text)]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    // fall back to whatever serif is available
  }
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Subtle wood-grain background for painted signs (keeps the sign readable). */
export function woodGrainFill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, seed = 1): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < h * 0.9; i++) {
    const yy = y + rnd() * h;
    g.strokeStyle = rnd() > 0.5 ? `rgba(60,40,20,${0.04 + rnd() * 0.08})` : `rgba(255,240,220,${0.03 + rnd() * 0.05})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, yy);
    const amp = 1 + rnd() * 3;
    for (let xx = 0; xx <= w; xx += w / 8) g.lineTo(x + xx, yy + Math.sin(xx * 0.01 + i) * amp);
    g.stroke();
  }
  g.restore();
}
