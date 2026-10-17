/**
 * Small DOM helpers shared by Foxfire Fjord's interface: element builders,
 * time formatting, a forgiving key-value store (localStorage with an
 * in-memory fallback for sandboxed frames), touch detection, the brand mark
 * and a set of thin-stroke icons.
 */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function button(cls: string, html: string, title?: string, onClick?: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, html);
  b.type = 'button';
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  if (onClick) {
    b.addEventListener('click', (e) => {
      onClick(e);
      // pointer clicks should not leave focus on the button (Space / Enter would re-trigger it)
      if (e.detail > 0) b.blur();
    });
  }
  return b;
}

export function fmtTime(h: number): string {
  const t = ((h % 24) + 24) % 24;
  let hh = Math.floor(t);
  let mm = Math.round((t - hh) * 60);
  if (mm === 60) {
    mm = 0;
    hh = (hh + 1) % 24;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function smoothstep(x: number, a: number, b: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Signed shortest difference b - a on a 24 h clock. */
export function hourDelta(a: number, b: number): number {
  let d = (((b - a) % 24) + 24) % 24;
  if (d > 12) d -= 24;
  return d;
}

/** Signed temperature with a real minus sign: −14 °C. */
export function fmtTemp(c: number): string {
  const r = Math.round(c);
  return `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.abs(r)} °C`;
}

const memory = new Map<string, string>();

/** Remembered preferences; survives without localStorage (opaque-origin frames) for the session. */
export const store = {
  get(key: string): string | null {
    try {
      const v = localStorage.getItem(`foxfire:${key}`);
      if (v !== null) return v;
    } catch {
      /* storage blocked */
    }
    return memory.get(key) ?? null;
  },
  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      localStorage.setItem(`foxfire:${key}`, value);
    } catch {
      /* private mode */
    }
  },
};

/** Keyboard events that should be left to form fields. Range sliders only keep their arrow keys. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    if (type === 'range') return e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown';
    if (type === 'checkbox' || type === 'radio' || type === 'button') return e.key === ' ';
    return true;
  }
  return false;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Touch-first device (phones / tablets); hybrid laptops are detected per pointer event instead. */
export function isTouchFirst(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** Phone-sized layout (matches the CSS breakpoint). */
export function isCompact(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches;
}

let brandSeq = 0;

/**
 * The Foxfire mark: an arctic fox's tail sweeping over the snow, its sparks
 * rising as aurora rays (green at the foot, violet at the tips).
 */
export function brandMark(cls = 'brand-mark'): string {
  const id = `fxr${brandSeq++}`;
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="2.5">
        <stop offset="0" stop-color="#6ef2b0"/>
        <stop offset="0.55" stop-color="#58d9c6" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#b495ff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g fill="none" stroke="url(#${id})" stroke-linecap="round">
      <path d="M10.4 18.9c-.7-3.2.6-5.7 0-9.6" stroke-width="2"/>
      <path d="M15 17.8c-.9-4.4.9-8.4-.2-13.6" stroke-width="2.5"/>
      <path d="M19.6 17.1c-.6-3.4.8-6 .1-9.8" stroke-width="2"/>
      <path d="M23.8 16.3c-.4-1.9.4-3.4 0-5.6" stroke-width="1.6"/>
    </g>
    <path d="M3.4 27.2C8.8 22.6 15.4 21.7 21.4 20.7c4.2-.7 7-3.6 6.8-8.1-1 3-3.6 4.7-7.2 5C14.6 18.1 8 20.5 3.4 27.2z" fill="#f4f7fb"/>
    <circle cx="26.6" cy="8.6" r="0.9" fill="#ffb866"/>
  </svg>`;
}

/** Thin-stroke inline icons (20×20 grid, currentColor). */
const P = (d: string, extra = '') => `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" ${extra}>${d}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICON: Record<string, string> = {
  play: P('<path d="M7 4.8v10.4L15.2 10z" fill="currentColor"/>'),
  pause: P('<rect x="5.6" y="4.8" width="2.8" height="10.4" rx="0.8" fill="currentColor"/><rect x="11.6" y="4.8" width="2.8" height="10.4" rx="0.8" fill="currentColor"/>'),
  close: P(`<path ${S} d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>`),
  prev: P(`<path ${S} d="M12.5 4.5L7 10l5.5 5.5"/>`),
  next: P(`<path ${S} d="M7.5 4.5L13 10l-5.5 5.5"/>`),
  restart: P(`<path ${S} d="M4.6 10a5.4 5.4 0 1 0 1.6-3.8M4.4 3.8v3h3"/>`),
  chevronDown: P(`<path ${S} d="M5.5 8l4.5 4.5L14.5 8"/>`),
  expand: P(`<path ${S} d="M11.5 4.5h4v4M8.5 15.5h-4v-4M15.5 4.5l-4.5 4.5M4.5 15.5L9 11"/>`),
  fullscreen: P(`<path ${S} d="M4.5 8V4.5H8M12 4.5h3.5V8M15.5 12v3.5H12M8 15.5H4.5V12"/>`),
  gear: P(
    `<circle ${S} cx="10" cy="10" r="2.4"/><path ${S} d="M10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.2 5.2l1.1 1.1M13.7 13.7l1.1 1.1M5.2 14.8l1.1-1.1M13.7 6.3l1.1-1.1"/>`,
  ),
  help: P(`<path ${S} d="M7.6 7.7a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.6"/><circle cx="10" cy="14.6" r="0.95" fill="currentColor"/>`),
  eye: P(`<path ${S} d="M2.8 10s2.6-4.7 7.2-4.7 7.2 4.7 7.2 4.7-2.6 4.7-7.2 4.7S2.8 10 2.8 10z"/><circle ${S} cx="10" cy="10" r="2.1"/>`),
  walk: P(
    `<circle cx="11.2" cy="4.2" r="1.5" fill="currentColor"/><path ${S} d="M9.2 17l1.6-4.6-2-2 .9-3.4 2.6 2 2.2.6M8.4 8.5L6.2 10l-.4 2.4M10.8 12.4l2 1.6.8 3"/>`,
  ),
  footprints: P(
    '<path d="M6.3 3.2c1.3 0 2 1.5 1.9 3.3-.1 1.6-.7 2.8-1.9 2.8S4.3 8.1 4.3 6.5c0-1.9.8-3.3 2-3.3zM5.1 10.6l2.5.3-.2 1.6c-.1.8-.7 1.2-1.3 1.1-.7-.1-1.1-.7-1-1.4zM13.7 6.7c1.2 0 1.9 1.4 1.9 3.2 0 1.7-.7 2.8-1.9 2.8s-1.9-1.2-1.9-2.8c0-1.8.7-3.2 1.9-3.2zM12.4 14l2.5-.2.1 1.6c0 .8-.5 1.3-1.2 1.3s-1.2-.5-1.2-1.2z" fill="currentColor"/>',
  ),
  target: P(`<circle ${S} cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/>`),
  plus: P(`<path ${S} d="M10 4.5v11M4.5 10h11"/>`),
  minus: P(`<path ${S} d="M4.5 10h11"/>`),
  compass: P(`<circle ${S} cx="10" cy="10" r="7"/><path d="M12.9 7.1l-1.6 4.2-4.2 1.6 1.6-4.2z" fill="currentColor"/>`),
  map: P(`<path ${S} d="M3.5 5.6l4.2-1.8 4.6 1.8 4.2-1.8v10.6l-4.2 1.8-4.6-1.8-4.2 1.8zM7.7 3.8v10.6M12.3 5.6v10.6"/>`),
  pin: P(`<path ${S} d="M10 17.2s-5-4.8-5-8.7a5 5 0 0 1 10 0c0 3.9-5 8.7-5 8.7z"/><circle ${S} cx="10" cy="8.5" r="1.8"/>`),
  sound: P(`<path ${S} d="M3.8 8h2.6l3.8-3.2v10.4L6.4 12H3.8zM13.2 7.4a3.7 3.7 0 0 1 0 5.2M15.3 5.3a6.7 6.7 0 0 1 0 9.4"/>`),
  mute: P(`<path ${S} d="M3.8 8h2.6l3.8-3.2v10.4L6.4 12H3.8zM13.3 8l4 4M17.3 8l-4 4"/>`),
  sun: P(`<circle ${S} cx="10" cy="10" r="3.2"/><path ${S} d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.2 1.2M14 14l1.2 1.2M4.8 15.2L6 14M14 6l1.2-1.2"/>`),
  sunrise: P(`<path ${S} d="M5.4 13.4a4.6 4.6 0 0 1 9.2 0M2.8 13.4h14.4M4.6 16.4h10.8M10 3.4v3.2M7.8 5.2L10 3l2.2 2.2M3.8 8.6l1.3 1.1M16.2 8.6l-1.3 1.1"/>`),
  lowsun: P(`<path ${S} d="M5.6 12.6a4.4 4.4 0 0 1 8.8 0M2.8 12.6h14.4M5 15.6h10M10 5.2v1.7M4.3 7.4l1.1 1.2M15.7 7.4l-1.1 1.2"/>`),
  bluehour: P(`<path ${S} d="M13.4 3.6a6.4 6.4 0 1 0 3 7.8 5 5 0 0 1-3-7.8z"/><path ${S} d="M2.8 16.4h14.4"/>`),
  moon: P(`<path ${S} d="M13.6 3.4a6.8 6.8 0 1 0 3 9.2 5.4 5.4 0 0 1-3-9.2z"/>`),
  aurora: P(`<path ${S} d="M3.2 15.6c1-4 .2-7.2 1.4-10.8M7.6 14.8c.7-3.8-.4-6.2.6-10.4M12 15.2c.6-3.2-.3-5.6.5-8.8M16.6 15.8c.4-2.4-.2-4 .3-6.4"/><path ${S} d="M2.6 17.2c4.8-1.6 10-1.6 14.8 0" opacity="0.6"/>`),
  snow: P(`<path ${S} d="M10 2.8v14.4M3.8 6.4l12.4 7.2M3.8 13.6l12.4-7.2M8.2 3.8L10 5.4l1.8-1.6M8.2 16.2L10 14.6l1.8 1.6M3.4 8.6l2.4-.5-.8-2.3M16.6 11.4l-2.4.5.8 2.3M3.4 11.4l2.4.5-.8 2.3M16.6 8.6l-2.4-.5.8-2.3"/>`),
  cloud: P(`<path ${S} d="M6.2 15.2h8.2a3.2 3.2 0 0 0 .4-6.4 4.6 4.6 0 0 0-8.8-1.1A3.8 3.8 0 0 0 6.2 15.2z"/>`),
  clear: P(`<path ${S} d="M10 3.2l1.2 4.1 4.1 1.2-4.1 1.2L10 13.8l-1.2-4.1-4.1-1.2 4.1-1.2z"/><circle cx="15.6" cy="14.6" r="0.9" fill="currentColor"/><circle cx="4.6" cy="15.2" r="0.7" fill="currentColor"/>`),
  star: P(`<path d="M10 3.4l1.6 4.9 5 .1-4 3 1.5 4.9L10 13.4l-4.1 2.9 1.5-4.9-4-3 5-.1z" fill="currentColor"/>`),
  flame: P(`<path ${S} d="M10 17.2c-3 0-5-2-5-4.8 0-3.5 3.3-4.6 3.6-8.6 2.6 1.7 3.4 4 3 6 1-.4 1.6-1.4 1.8-2.4 1.1 1.2 1.6 2.9 1.6 4.8 0 3-2 5-5 5z"/><path ${S} d="M10 17.2c-1.2 0-2-.9-2-2.1 0-1.6 1.4-2 2-3.6 1.1 1 2 2 2 3.6 0 1.2-.8 2.1-2 2.1z"/>`),
  lamp: P(`<path ${S} d="M6.4 3.4h7.2l2 5.8H4.4zM10 9.2v6.4M6.8 16.6h6.4"/><path d="M7.4 11.2c.8.6 1.7.9 2.6.9s1.8-.3 2.6-.9" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>`),
  blinds: P(`<path ${S} d="M3.8 3.6h12.4M5 3.6v3.2h10V3.6M5 6.8l10 1.6M5 8.4l10 1.6M5 10l10 1.6"/><path ${S} d="M10 11.6v3.4"/><circle ${S} cx="10" cy="16" r="1"/>`),
  stars: P(`<path d="M7 3.6l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM14.2 9.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="currentColor"/><path ${S} d="M3.4 16.6h13.2"/>`),
  privacy: P(`<rect ${S} x="4" y="3.6" width="12" height="12.8" rx="1"/><path ${S} d="M4 7.2h12M4 10.4h12M4 13.6h12"/>`),
  warm: P(`<path ${S} d="M10 3.4l6.4 5.4M10 3.4L3.6 8.8M5.2 7.6v8.8h9.6V7.6"/><path ${S} d="M10 15.2c-1.3 0-2.1-.8-2.1-2 0-1.5 1.5-1.9 1.7-3.6 1.4.9 2.5 2 2.5 3.6 0 1.2-.8 2-2.1 2z"/>`),
  tub: P(`<path ${S} d="M3.8 10.4h12.4l-1.1 5.6H4.9zM5.6 10.4V8.8M14.4 10.4V8.8"/><path ${S} d="M7.6 7.6c-.8-1 .8-1.8 0-3M10.4 7.6c-.8-1 .8-1.8 0-3M13.2 7.6c-.8-1 .8-1.8 0-3"/>`),
  firepit: P(`<path ${S} d="M3.6 16.2l12.8-3M3.6 13.2l12.8 3"/><path ${S} d="M10 12.2c-1.8 0-3-1.1-3-2.8 0-2 1.9-2.6 2.1-5 1.6 1 2.2 2.5 2 3.6.6-.2 1-.8 1.1-1.4.6.7.9 1.7.9 2.8 0 1.7-1.3 2.8-3.1 2.8z"/>`),
  lantern: P(`<path ${S} d="M8.2 3.4h3.6M10 2.2v1.2M6.6 5.6h6.8l-.6 9.4H7.2zM6.2 16.6h7.6M6.6 5.6l1-2.2M13.4 5.6l-1-2.2"/><path d="M10 8.2c.9.9 1.2 1.6 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.8.3-1.5 1.2-2.4z" fill="currentColor"/>`),
  door: P(`<path ${S} d="M5.4 17V3.4h9.2V17M3.6 17h12.8"/><circle cx="12.2" cy="10.4" r="0.9" fill="currentColor"/>`),
  cabin: P(`<path ${S} d="M2.8 9.6L10 3.8l7.2 5.8M4.6 8.2v8.2h10.8V8.2M8.4 16.4v-4h3.2v4M13.4 5.6V3.6h1.6v3.3"/>`),
  bed: P(`<path ${S} d="M3 15.6V5.2M3 12.2h14v3.4M17 12.2v-1.6a2 2 0 0 0-2-2H8.8v3.6M3.2 9.8h3.6a1.6 1.6 0 0 1 0 2.4H3.2"/>`),
  deck: P(`<path ${S} d="M2.8 12.2h14.4M4.2 12.2v4.2M15.8 12.2v4.2M2.8 14.4h14.4M6 12.2V6.8h8v5.4M6 9.4h8"/>`),
  lake: P(`<path ${S} d="M2.8 9.4c1.8 1.4 3.6 1.4 5.4 0s3.6-1.4 5.4 0 3.6 1.4 3.6 0M2.8 13.4c1.8 1.4 3.6 1.4 5.4 0s3.6-1.4 5.4 0 3.6 1.4 3.6 0"/><path ${S} d="M6.6 5.8l1.8-1.6M11.2 6l2.6-2"/>`),
  sauna: P(`<path ${S} d="M3.4 10.2L10 4.8l6.6 5.4M5 9v7.4h10V9M8.6 16.4v-3.6h2.8v3.6"/><path ${S} d="M13.4 3.4c-.5-.7.5-1.2 0-2M15.6 4c-.5-.7.5-1.2 0-2"/>`),
  spring: P(`<path ${S} d="M3 14.2c2.3 1.9 11.7 1.9 14 0M5 14.6c1.6-1.4 8.4-1.4 10 0"/><path ${S} d="M7 10.6c-1.1-1.4 1.1-2.4 0-4.2M10 10c-1.1-1.4 1.1-2.4 0-4.6M13 10.6c-1.1-1.4 1.1-2.4 0-4.2"/>`),
  village: P(`<path ${S} d="M2.6 16.6h14.8M3.8 16.6v-5l3-2.6 3 2.6v5M9.8 16.6V8.8L13.2 4l3 4.8v7.8M12.2 16.6v-2.8h2v2.8"/><path ${S} d="M5.8 13.2h2"/>`),
  harbor: P(`<path ${S} d="M10 4.2v11.4M7.2 6.6h5.6M4 11.2c.4 3 3 4.8 6 4.8s5.6-1.8 6-4.8M4 11.2l1.6 1M16 11.2l-1.6 1"/><circle ${S} cx="10" cy="3.4" r="1.1"/>`),
  beach: P(`<path ${S} d="M2.6 15.6c2.4-1.2 4.4-1.2 6.4 0s4 1.2 6.4 0M5.2 12.4l2-3.6 2.6.4 1.4 3.2zM12.4 12.8l1.4-2.4 1.8.4.6 2"/>`),
  peak: P(`<path ${S} d="M2.6 16.4L8.2 6.6l2.6 4.2 1.8-2.6 4.8 8.2zM8.2 6.6V3.2l3 1.2-3 1.2"/>`),
  fox: P(
    `<path ${S} d="M4.6 4.4l2 4.2M15.4 4.4l-2 4.2M4.6 4.4C3.6 7.6 4 10.4 6.4 12.8L10 16l3.6-3.2c2.4-2.4 2.8-5.2 1.8-8.4M6.6 8.6c2.2-1 4.6-1 6.8 0"/><circle cx="7.9" cy="10.6" r="0.8" fill="currentColor"/><circle cx="12.1" cy="10.6" r="0.8" fill="currentColor"/><path d="M9.2 13.7h1.6L10 14.6z" fill="currentColor"/>`,
  ),
  mountain: P(`<path ${S} d="M2.4 16.4l5.2-8.6 3 4.6 2.2-3.2 4.8 7.2zM6 10.4l1.6-.8 1.4 1"/>`),
  thermometer: P(`<path ${S} d="M8.6 11.6V4.6a1.4 1.4 0 0 1 2.8 0v7a3 3 0 1 1-2.8 0z"/><circle cx="10" cy="14.2" r="1.3" fill="currentColor"/>`),
  layers: P(`<path ${S} d="M10 3.4l7 3.6-7 3.6-7-3.6zM3 10.4l7 3.6 7-3.6M3 13.6l7 3.6 7-3.6"/>`),
  keyboard: P(`<rect ${S} x="2.6" y="5.4" width="14.8" height="9.2" rx="1.4"/><path ${S} d="M5.6 8.4h.1M8.6 8.4h.1M11.6 8.4h.1M14.4 8.4h.1M6.4 11.6h7.2"/>`),
  hide: P(`<path ${S} d="M3.2 3.2l13.6 13.6M8.2 5.5A7.6 7.6 0 0 1 10 5.3c4.6 0 7.2 4.7 7.2 4.7a12 12 0 0 1-2.4 2.9M12 14.4a6.6 6.6 0 0 1-2 .3c-4.6 0-7.2-4.7-7.2-4.7a12.6 12.6 0 0 1 2.7-3.2"/>`),
};

/** Icon for a dock control by id, when the control does not name one. */
export function iconFor(id: string, fallback = 'star'): string {
  const k = id.toLowerCase();
  const table: [RegExp, string][] = [
    [/lamp|light/, 'lamp'],
    [/stove|fire(?!pit)/, 'flame'],
    [/pit|campfire|firepit/, 'firepit'],
    [/blind.*aurora|aurora/, 'stars'],
    [/privacy/, 'privacy'],
    [/warm/, 'warm'],
    [/blind|curtain/, 'blinds'],
    [/tub|lid/, 'tub'],
    [/lantern/, 'lantern'],
    [/door/, 'door'],
    [/sauna/, 'sauna'],
  ];
  for (const [re, icon] of table) if (re.test(k)) return ICON[icon] ?? ICON[fallback];
  return ICON[fallback];
}
