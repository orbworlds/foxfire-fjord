/**
 * URL parameters of Foxfire Fjord (all optional):
 *   ?solo=cabin,lake       only load these features (core systems always load)
 *   ?skip=trees,village    load everything except these
 *   ?view=cabin            start at a viewpoint id (see VIEWPOINTS) — skips the intro
 *   ?cam=x,y,z,tx,ty,tz    start with an explicit camera position + target (world)
 *   ?time=21.75            time of day in hours (0-24); the default is 21:45, aurora on
 *   ?speed=0               time speed in in-game minutes per real second (0 = paused)
 *   ?quality=low|medium|high|ultra
 *   ?ui=0                  hide the HUD
 *   ?debug                 show render stats
 *   ?shot                  screenshot mode: no intro, no HUD, time and aurora frozen
 *   ?fov=50                camera vertical field of view
 *   ?mode=walk             start in walk mode
 *   ?tm=aces|agx|neutral   stock tone mapping instead of the winter grade
 *   ?ev=0.5                exposure bias in stops
 *   ?aurora=0.7            force the aurora activity (0..1) instead of following the clock
 *   ?auroraT=120           aurora clock in seconds (substorm phase, ray positions) — deterministic shots
 *   ?weather=clear|bank|snow   start with this weather
 */
import type { QualityName } from './quality';

const sp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function list(name: string): string[] | null {
  const v = sp.get(name);
  if (!v) return null;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name: string): number | null {
  const v = sp.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nums(name: string): number[] | null {
  const v = sp.get(name);
  if (!v) return null;
  const arr = v.split(',').map(Number);
  return arr.every(Number.isFinite) ? arr : null;
}

const shot = sp.has('shot');

export type WeatherName = 'clear' | 'bank' | 'snow';
const weather = sp.get('weather');

export const params = {
  solo: list('solo'),
  skip: list('skip'),
  view: sp.get('view'),
  cam: nums('cam'),
  time: num('time'),
  speed: num('speed') ?? (shot ? 0 : null),
  quality: (sp.get('quality') as QualityName | null) ?? null,
  ui: sp.get('ui') === '1' || (sp.get('ui') !== '0' && !shot),
  debug: sp.has('debug'),
  shot,
  intro: !(shot || sp.has('nointro') || sp.has('view') || sp.has('cam')),
  fov: num('fov'),
  mode: sp.get('mode'),
  /** tone mapping operator override: neutral | aces | agx (default: the winter grade) */
  toneMapping: sp.get('tm'),
  /** exposure bias in stops */
  ev: num('ev') ?? 0,
  /** forced aurora activity 0..1 (null = follow the clock) */
  aurora: num('aurora'),
  /** aurora clock in seconds (null = start fresh) */
  auroraT: num('auroraT'),
  /** initial weather */
  weather: (weather === 'clear' || weather === 'bank' || weather === 'snow' ? weather : null) as WeatherName | null,
};
