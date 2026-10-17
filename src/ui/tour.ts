/**
 * Guided tour of Foxfire Fjord: ten stops from the cabin to the summit and
 * the fox, each with a few warm lines, easing the clock to the light that
 * suits it (the aurora nights, the blue hour on the lake, the last pink light
 * at the hot spring, the low noon sun on Ice Beach) and staging the cabin
 * (lamps, stove, blinds, tub lid). Esc exits, ←/→ step, Space pauses.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../core/types';
import { HOUSE, VIEWPOINTS } from '../world/layout';
import { heightAt } from '../world/terrain-height';
import { el, button, ICON, fmtTime, clamp, isTouchFirst } from './dom';
import type { TimeDirector } from './time-director';

interface TourStop {
  id: string;
  /** a viewpoint id from layout.VIEWPOINTS … */
  view?: string;
  /** … or wherever the fox is right now */
  fox?: boolean;
  time: number;
  /** short place line above the title */
  kicker: string;
  title: string;
  body: string;
  /** optional staging; every feature call is guarded */
  enter?: (ctx: FeatureContext) => void;
  /** staging that should happen in view, once the camera has arrived */
  arrive?: (ctx: FeatureContext) => void;
}

type AnyApi = Record<string, unknown>;

/**
 * Call the first existing method among `names` on a feature's API (features may
 * not exist yet). A name may be a dotted path into the API, e.g. 'blinds.applyPreset'.
 */
function callFeature(ctx: FeatureContext, id: string, names: string[], ...args: unknown[]): boolean {
  const api = ctx.getFeature<AnyApi>(id)?.api;
  if (!api) return false;
  for (const n of names) {
    const parts = n.split('.');
    let owner: AnyApi | undefined = api;
    for (const p of parts.slice(0, -1)) owner = owner?.[p] as AnyApi | undefined;
    const fn = owner?.[parts[parts.length - 1]];
    if (typeof fn === 'function') {
      try {
        (fn as (...a: unknown[]) => unknown).apply(owner, args);
        return true;
      } catch (err) {
        console.warn(`[tour] ${id}.${n} failed`, err);
      }
    }
  }
  return false;
}

/** Lamps, stove and lantern string on: the cabin glowing amber in the snow. */
function cabinEvening(ctx: FeatureContext, wingLamps = 1) {
  callFeature(ctx, 'house', ['setLamps'], 1, 'living');
  callFeature(ctx, 'house', ['setLamps'], wingLamps, 'glasswing');
  callFeature(ctx, 'house', ['setFire'], 1);
  callFeature(ctx, 'house', ['setLanterns'], true);
}

/** a breakup a few seconds after arrival (the aurora clock jumps to the end of a growth phase) */
function wakeAurora(ctx: FeatureContext) {
  const a = ctx.sky.aurora;
  if (ctx.sky.sunDir.y > -0.12) return;
  try {
    a.seek(74);
  } catch (err) {
    console.warn('[tour] aurora seek failed', err);
  }
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'cabin',
    view: 'cabin',
    time: 21.75,
    kicker: 'Aurora Cabin',
    title: 'A cabin turned to the north',
    body: 'A long, low cabin of black-tarred board and batten under a steep, snow-loaded roof, a fieldstone chimney smoking. Its glass gable wing points north across the frozen fjord to the Teeth — the whole house faces the aurora.',
    enter: (ctx) => cabinEvening(ctx),
  },
  {
    id: 'stove',
    view: 'living',
    time: 20.5,
    kicker: 'In the cabin',
    title: 'By the stove',
    body: 'A cast-iron stove in front of the chimney breast keeps the room near 21 °C while it is −14 °C outside. Sheepskins, wool throws, a rag rug, the kettle ticking on the plate. Open the stove door and the whole room glows orange.',
    enter: (ctx) => cabinEvening(ctx),
    arrive: (ctx) => callFeature(ctx, 'interior', ['setStoveDoor'], true),
  },
  {
    id: 'glasswing',
    view: 'glasswing',
    time: 23,
    kicker: 'In the cabin',
    title: 'The glass wing',
    body: 'An A-frame of glass on the cabin’s north side: two low beds under the glazed roof, reindeer hides, lanterns in the corners, frost creeping in from the pane edges. Fold the wool blinds away, lie back, and the aurora fills the roof.',
    enter: (ctx) => {
      cabinEvening(ctx, 0.35);
      callFeature(ctx, 'house', ['setBlinds'], 'aurora');
    },
  },
  {
    id: 'tub',
    view: 'deck',
    time: 22.5,
    kicker: 'The deck',
    title: 'A hot tub at −14 °C',
    body: 'A wood-fired tub on the north deck, its little iron stove ticking. Lift the lid and the steam rolls off into the frost, lit green from above; the fjord and the Teeth are right there, and the lantern string sways over the snow.',
    enter: (ctx) => {
      cabinEvening(ctx);
      callFeature(ctx, 'house', ['setTubLid'], true);
    },
  },
  {
    id: 'lake',
    view: 'sauna',
    time: 16.6,
    kicker: 'Mirror Lake',
    title: 'Black ice and a lake sauna',
    body: 'A frozen lake in the hanging valley above the cabin: wind-swept black ice, a cleared rink and an ice-fishing hut. The sauna on the west shore has a jetty out to a hole cut in the ice. On cold nights the ice sings — long falling chirps under your feet.',
  },
  {
    id: 'spring',
    view: 'spring',
    time: 15.35,
    kicker: 'Hot spring',
    title: 'Steam in the last light',
    body: 'A natural rock pool on a shelf above the fjord, 39 °C all winter. Steam drifts over rime-crusted rocks; the melt ring around it is the only green on the island. Best at the end of the short day, when the steam catches the last pink light.',
  },
  {
    id: 'village',
    view: 'village',
    time: 16.8,
    kicker: 'Lysvik',
    title: 'The fishing village',
    body: 'Red and ochre houses step up from the quay at the fjord mouth: boats in the half-frozen harbour, stockfish drying on the racks, a white church on the top terrace. The windows come on one by one in the blue hour.',
  },
  {
    id: 'beach',
    view: 'beach',
    time: 11.4,
    kicker: 'Ice Beach',
    title: 'Glass on black sand',
    body: 'Out on the open coast the swell strands blocks of sea ice on black sand, among snowed-over driftwood. At noon the sun barely clears the southern horizon — ten degrees, no more — and shines straight through them.',
  },
  {
    id: 'summit',
    view: 'summit',
    time: 23.25,
    kicker: 'Fox Peak · 567 m',
    title: 'The best seat for the lights',
    body: 'A switchback trail from the lake climbs to a cairn on the wind-scoured summit, with a bench behind a stone windbreak. The fjord lies below, the Teeth across it — and every few minutes a substorm breaks the aurora up overhead.',
    arrive: (ctx) => wakeAurora(ctx),
  },
  {
    id: 'fox',
    fox: true,
    time: 22.1,
    kicker: 'The arctic fox',
    title: 'Revontulet',
    body: 'An arctic fox trots its rounds of the island, leaving a line of prints in the snow. The Finns call the northern lights revontulet, fox fires: a fox running over the fells, sweeping sparks into the sky with its tail. Watch the tail.',
  },
];

type FoxApi = { position?: () => THREE.Vector3 };

function foxPosition(ctx: FeatureContext): THREE.Vector3 | null {
  try {
    return ctx.getFeature<FoxApi>('fox')?.api?.position?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Camera framing for the fox: a few metres from her (swung toward the south,
 * so the aurora rises behind her), low, clear of the slope. `lead` is added to
 * her position (where she will be when the camera gets there).
 */
function foxShot(ctx: FeatureContext, from?: THREE.Vector3, lead?: THREE.Vector3): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
  const p = foxPosition(ctx);
  if (!p) return null;
  if (lead) p.add(lead);
  const target = new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.35, p.z);
  const dir = new THREE.Vector3(0, 0, 1);
  if (from) {
    dir.set(from.x - p.x, 0, from.z - p.z);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    dir.lerp(new THREE.Vector3(0, 0, 1), 0.55).normalize();
  }
  const pos = target.clone().addScaledVector(dir, 3.5);
  pos.y = Math.max(target.y + 0.6, heightAt(pos.x, pos.z) + 0.8);
  // look a little above her back so the sky (and the aurora) fills the frame
  target.y += 0.25;
  return { pos, target };
}

/**
 * After a long flight toward the fox: she kept trotting, so re-frame on where
 * she will be after a short settling flight (her velocity over the long one),
 * then follow her. Resolves false if she vanished.
 */
function settleOnFox(ctx: FeatureContext, start: THREE.Vector3, startT: number): Promise<boolean> {
  const now = foxPosition(ctx);
  if (!now) return Promise.resolve(false);
  const dt = Math.max(0.2, ctx.engine.elapsed - startT);
  const v = now.clone().sub(start).divideScalar(dt);
  v.y = 0;
  if (v.length() > 6) v.setLength(6);
  const shot = foxShot(ctx, ctx.camera.position, v.multiplyScalar(0.9));
  if (!shot) return Promise.resolve(false);
  return ctx.controls.flyTo(shot.pos, shot.target, { duration: 0.9 }).then(() => {
    callFeature(ctx, 'fox', ['follow'], true);
    return true;
  });
}

/**
 * Fly to the fox and follow it. Returns false when the fox is not on the island
 * (feature missing).
 */
export function findFox(ctx: FeatureContext, then?: () => void): boolean {
  const shot = foxShot(ctx, ctx.camera.position);
  const start = foxPosition(ctx);
  if (!shot || !start) return false;
  const t0 = ctx.engine.elapsed;
  if (ctx.state.mode === 'walk') ctx.controls.setMode('orbit');
  callFeature(ctx, 'fox', ['follow'], false);
  void ctx.controls.flyTo(shot.pos, shot.target).then(() =>
    settleOnFox(ctx, start, t0).then((ok) => {
      if (ok) then?.();
    }),
  );
  return true;
}

export class Tour {
  readonly root: HTMLElement;
  private card: HTMLElement;
  private metaCount: HTMLElement;
  private metaTime: HTMLElement;
  private kickerEl: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private bar: HTMLElement;
  private playBtn: HTMLButtonElement;
  private dots: HTMLButtonElement[] = [];
  private index = -1;
  private active = false;
  private paused = false;
  private dwelling = false;
  private elapsed = 0;
  private dwell = 10;
  private token = 0;
  private finale = false;
  private autoAdvance = true;
  private swapTimer = 0;
  onActiveChange: (active: boolean) => void = () => {};

  constructor(
    private ctx: FeatureContext,
    private time: TimeDirector,
  ) {
    this.root = el('section', 'tour');
    this.root.setAttribute('aria-label', 'Guided tour');
    this.root.setAttribute('aria-live', 'polite');
    this.card = el('div', 'tour__card');
    const meta = el('div', 'tour__meta');
    const label = el('span', 'tour__label', `${ICON.compass}<span>Guided tour</span>`);
    this.metaCount = el('span', 'tour__count', '');
    this.metaTime = el('span', 'tour__time', '');
    meta.append(label, this.metaCount, this.metaTime);
    this.kickerEl = el('div', 'tour__kicker');
    this.titleEl = el('h3', 'tour__title');
    this.bodyEl = el('p', 'tour__body');
    const barWrap = el('div', 'tour__bar');
    this.bar = el('span');
    barWrap.appendChild(this.bar);
    const controls = el('div', 'tour__controls');
    const prev = button('icon-btn', ICON.prev, 'Previous stop (←)', () => this.prev());
    this.playBtn = button('icon-btn tour__play', ICON.pause, 'Pause tour (Space)', () => this.togglePause());
    const next = button('icon-btn', ICON.next, 'Next stop (→)', () => this.next());
    const exit = button('tour__exit', 'End <kbd>Esc</kbd>', 'End the tour (Esc)', () => this.stop());
    const dots = el('div', 'tour__dots');
    TOUR_STOPS.forEach((s, i) => {
      const d = button('tour__dot', '', `${i + 1}. ${s.title}`, () => this.go(i));
      this.dots.push(d);
      dots.appendChild(d);
    });
    controls.append(prev, this.playBtn, next, dots, exit);
    this.card.append(meta, this.kickerEl, this.titleEl, this.bodyEl, barWrap, controls);
    this.root.appendChild(this.card);

    // the visitor taking the camera pauses the tour
    ctx.renderer.domElement.addEventListener('pointerdown', () => {
      if (this.active && !this.paused && !this.finale) this.setPaused(true);
    });
    ctx.renderer.domElement.addEventListener('wheel', () => {
      if (this.active && !this.paused && !this.finale) this.setPaused(true);
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  get stopIndex(): number {
    return this.index;
  }

  start(index = 0, opts: { instant?: boolean; autoAdvance?: boolean } = {}): void {
    if (!this.active) {
      this.active = true;
      this.root.classList.add('is-on');
      if (this.ctx.state.mode === 'walk') this.ctx.controls.setMode('orbit');
      this.onActiveChange(true);
      this.ctx.events.emit('tour:start', {});
    }
    this.autoAdvance = opts.autoAdvance ?? true;
    this.setPaused(false);
    this.go(clamp(index, 0, TOUR_STOPS.length - 1), opts.instant);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.token++;
    this.dwelling = false;
    this.finale = false;
    this.ctx.controls.orbit.autoRotate = false;
    this.root.classList.remove('is-on', 'is-finale');
    this.onActiveChange(false);
    this.ctx.events.emit('tour:end', {});
  }

  next(): void {
    if (!this.active) return;
    if (this.finale) {
      this.stop();
      return;
    }
    if (this.index >= TOUR_STOPS.length - 1) this.showFinale();
    else this.go(this.index + 1);
  }

  prev(): void {
    if (!this.active) return;
    if (this.finale) {
      this.go(TOUR_STOPS.length - 1);
      return;
    }
    this.go(Math.max(0, this.index - 1));
  }

  togglePause(): void {
    if (this.finale) {
      this.go(0);
      return;
    }
    this.setPaused(!this.paused);
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.root.classList.toggle('is-paused', p);
    this.playBtn.innerHTML = p ? ICON.play : ICON.pause;
    const t = p ? 'Continue the tour (Space)' : 'Pause tour (Space)';
    this.playBtn.title = t;
    this.playBtn.setAttribute('aria-label', t);
    if (p) this.ctx.controls.orbit.autoRotate = false;
    else if (this.dwelling) this.startDrift();
  }

  private stopCamera(stop: TourStop): { pos: THREE.Vector3; target: THREE.Vector3; interior: boolean } | null {
    if (stop.fox) {
      const s = foxShot(this.ctx, new THREE.Vector3(HOUSE.x, 0, HOUSE.z + 40));
      return s ? { ...s, interior: false } : null;
    }
    const vp = VIEWPOINTS.find((v) => v.id === stop.view) ?? VIEWPOINTS[0];
    const { pos, target } = this.ctx.controls.resolveViewpoint(vp);
    return { pos, target, interior: !!vp.interior };
  }

  private setCaption(i: number) {
    const s = TOUR_STOPS[i];
    this.metaCount.textContent = `${i + 1} of ${TOUR_STOPS.length}`;
    this.metaTime.textContent = fmtTime(s.time);
    this.kickerEl.textContent = s.kicker;
    this.titleEl.textContent = s.title;
    this.bodyEl.textContent = s.body;
    this.dots.forEach((d, k) => {
      d.classList.toggle('is-current', k === i);
      d.classList.toggle('is-done', k < i);
    });
  }

  go(i: number, instant = false): void {
    if (!this.active) return;
    const stop = TOUR_STOPS[i];
    if (!stop) return;
    const cam = this.stopCamera(stop);
    if (!cam) {
      // the fox is not on the island: skip its stop
      if (i < TOUR_STOPS.length - 1) this.go(i + 1, instant);
      else this.showFinale();
      return;
    }
    const token = ++this.token;
    const wasFinale = this.finale;
    this.index = i;
    this.finale = false;
    this.root.classList.remove('is-finale');
    this.dwelling = false;
    if (wasFinale) this.setPaused(false);
    this.elapsed = 0;
    this.bar.style.transform = 'scaleX(0)';
    this.ctx.controls.orbit.autoRotate = false;
    callFeature(this.ctx, 'fox', ['follow'], false);
    this.ctx.ui.hideCard();
    // swap the caption with a short fade
    this.card.classList.add('is-swapping');
    clearTimeout(this.swapTimer);
    this.swapTimer = window.setTimeout(
      () => {
        this.setCaption(i);
        this.card.classList.remove('is-swapping');
      },
      instant ? 0 : 220,
    );
    if (instant) this.setCaption(i);
    this.dwell = clamp(5 + stop.body.length / 24, 10, 17);
    const { pos, target } = cam;
    this.ctx.events.emit('tour:stop', { index: i, id: stop.id });
    try {
      stop.enter?.(this.ctx);
    } catch (err) {
      console.warn('[tour] staging failed', err);
    }
    if (instant) {
      this.ctx.controls.teleport(pos, target);
      this.time.set(stop.time);
      this.beginDwell(token);
      return;
    }
    const dist = this.ctx.camera.position.distanceTo(pos);
    const duration = clamp(2.4 + dist / 300, 2.4, 6.5);
    this.time.goTo(stop.time, { duration: duration * 0.9 });
    const foxStart = stop.fox ? foxPosition(this.ctx) : null;
    const t0 = this.ctx.engine.elapsed;
    this.ctx.controls.flyTo(pos, target, { duration }).then(() => {
      if (token !== this.token || !this.active) return;
      if (stop.fox && foxStart) {
        // she moved during the flight: settle on where she is going, then follow her
        settleOnFox(this.ctx, foxStart, t0).then(() => {
          if (token === this.token && this.active) this.beginDwell(token);
        });
        return;
      }
      this.beginDwell(token);
    });
  }

  private beginDwell(token: number) {
    if (token !== this.token) return;
    this.dwelling = true;
    this.elapsed = 0;
    try {
      TOUR_STOPS[this.index]?.arrive?.(this.ctx);
    } catch (err) {
      console.warn('[tour] staging failed', err);
    }
    if (!this.paused) this.startDrift();
  }

  private startDrift() {
    const stop = TOUR_STOPS[this.index];
    if (!stop || this.finale || stop.fox) return;
    const interior = !!VIEWPOINTS.find((v) => v.id === stop.view)?.interior;
    const orbit = this.ctx.controls.orbit;
    orbit.autoRotateSpeed = (this.index % 2 === 0 ? 1 : -1) * (interior ? 0.08 : 0.2);
    orbit.autoRotate = true;
  }

  private showFinale() {
    this.token++;
    this.finale = true;
    this.dwelling = false;
    this.ctx.controls.orbit.autoRotate = false;
    this.root.classList.add('is-finale');
    this.card.classList.add('is-swapping');
    clearTimeout(this.swapTimer);
    this.swapTimer = window.setTimeout(() => {
      const touch = isTouchFirst();
      this.metaCount.textContent = '';
      this.metaTime.textContent = '';
      this.kickerEl.textContent = 'End of the tour';
      this.titleEl.textContent = 'Good night';
      this.bodyEl.textContent = touch
        ? 'The island is yours: drag to look around, tap Walk to go out on the snow, open the clock to scrub through the short polar day, and tap anything that catches your eye.'
        : 'The island is yours: drag to look around, press F to walk out on the snow, scrub the light band through the short polar day, and click anything that catches your eye.';
      this.playBtn.innerHTML = ICON.restart;
      this.playBtn.title = 'Restart the tour';
      this.playBtn.setAttribute('aria-label', 'Restart the tour');
      this.dots.forEach((d) => {
        d.classList.remove('is-current');
        d.classList.add('is-done');
      });
      this.card.classList.remove('is-swapping');
    }, 220);
  }

  update(dt: number): void {
    if (!this.active || !this.dwelling || this.paused || this.finale) return;
    this.elapsed += dt;
    const f = Math.min(1, this.elapsed / this.dwell);
    this.bar.style.transform = `scaleX(${f.toFixed(4)})`;
    if (f >= 1 && this.autoAdvance) this.next();
  }
}
