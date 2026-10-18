/**
 * The polar day for the clock UI: sun and moon altitude by hour, the phase of
 * the light, the colour of the light band, the aurora curve, the air
 * temperature and the time presets. Everything derives from core/celestial.ts
 * (69.3°N, 21 February), the same module the sky renders from, so the time
 * bar can never disagree with the sky.
 */
import { sunAltitude as celestialSunAltitude, moonAltitude as celestialMoonAltitude, SUNRISE as CELESTIAL_SUNRISE, SUNSET as CELESTIAL_SUNSET, CIVIL_DAWN, CIVIL_DUSK, ASTRO_DAWN, ASTRO_DUSK, NOON_ALTITUDE_DEG, } from '../core/celestial.js';
import { auroraActivityAt as auroraAt } from '../core/aurora.js';
/** Sun altitude in radians. */
export function sunAltitude(hours) {
    return celestialSunAltitude(hours);
}
/** Moon altitude in radians. */
export function moonAltitude(hours) {
    return celestialMoonAltitude(hours);
}
/** expected aurora activity 0..1 at a clock time (the hourly curve gated by darkness; substorms not included) */
export function auroraActivityAt(hours) {
    return auroraAt(hours, Math.sin(sunAltitude(hours)));
}
export const SUNRISE = CELESTIAL_SUNRISE;
export const SUNSET = CELESTIAL_SUNSET;
export { CIVIL_DAWN, CIVIL_DUSK, ASTRO_DAWN, ASTRO_DUSK, NOON_ALTITUDE_DEG };
const DEG = Math.PI / 180;
export function phaseOf(hours) {
    const alt = sunAltitude(hours);
    const morning = ((hours % 24) + 24) % 24 < 12;
    if (alt < -12 * DEG)
        return { key: 'night', short: 'Night', en: 'Polar night' };
    if (alt < -8 * DEG)
        return { key: 'twilight', short: 'Twilight', en: 'Deep twilight' };
    if (alt < -3.5 * DEG)
        return { key: 'blue', short: 'Blue hour', en: 'Blue hour' };
    if (alt < 1 * DEG)
        return { key: 'pink', short: 'Pink light', en: morning ? 'Pink dawn' : 'Pink dusk' };
    return { key: 'lowsun', short: 'Low sun', en: alt > 8 * DEG ? 'Low noon sun' : morning ? 'Low morning sun' : 'Golden light' };
}
/** The colour of the light at a sun altitude (degrees): the light band's gradient. */
const LIGHT_STOPS = [
    [-32, [6, 11, 23]],
    [-18, [11, 21, 47]],
    [-12, [20, 38, 88]],
    [-8, [36, 66, 138]],
    [-4.5, [74, 104, 176]],
    [-2, [150, 128, 178]],
    [0, [226, 146, 150]],
    [2, [243, 168, 136]],
    [5, [247, 196, 142]],
    [10, [252, 224, 176]],
];
export function lightColor(altDeg) {
    const s = LIGHT_STOPS;
    if (altDeg <= s[0][0])
        return s[0][1];
    for (let i = 1; i < s.length; i++) {
        if (altDeg <= s[i][0]) {
            const [a, ca] = s[i - 1];
            const [b, cb] = s[i];
            const t = (altDeg - a) / (b - a);
            return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
        }
    }
    return s[s.length - 1][1];
}
/** Air temperature at sea level by clock hour: −16 °C before dawn, −9 °C in the short afternoon. */
const AIR_BY_HOUR = [
    [0, -14.6],
    [4, -16],
    [8, -15.2],
    [11, -11.6],
    [13.5, -9],
    [16, -10.4],
    [19, -12.6],
    [24, -14.6],
];
export function airTemperature(hours, altitude, weather) {
    const h = ((hours % 24) + 24) % 24;
    let t = AIR_BY_HOUR[0][1];
    for (let i = 1; i < AIR_BY_HOUR.length; i++) {
        const [h1, t1] = AIR_BY_HOUR[i];
        if (h <= h1) {
            const [h0, t0] = AIR_BY_HOUR[i - 1];
            t = t0 + ((t1 - t0) * (h - h0)) / (h1 - h0);
            break;
        }
    }
    // lapse rate on the fells; clouds and snowfall hold the night's warmth
    t -= (0.62 * Math.max(0, altitude)) / 100;
    if (weather === 'snow')
        t += 3;
    else if (weather === 'bank')
        t += 0.8;
    return t;
}
/** A few words for what the aurora is doing right now. */
export function auroraWords(phase, visible, sunAltRad) {
    if (visible < 0.04)
        return sunAltRad > -4 * DEG ? 'Hidden by daylight' : 'Quiet';
    if (phase === 'breakup')
        return 'Breaking up!';
    if (phase === 'expansion')
        return visible > 0.45 ? 'Corona overhead' : 'Spreading out';
    if (phase === 'growth')
        return 'Brightening';
    if (phase === 'recovery')
        return 'Pulsing, fading';
    return visible > 0.45 ? 'Steady arcs' : 'A faint arc';
}
/** in story order (morning to night); the band places them by hour */
export const TIME_PRESETS = [
    { id: 'dawn', hours: 8, short: 'Dawn', en: 'Dawn', icon: 'sunrise' },
    { id: 'noon', hours: 12, short: 'Noon', en: 'Low noon sun', icon: 'sun' },
    { id: 'golden', hours: 14.75, short: 'Golden', en: 'Golden light', icon: 'lowsun' },
    { id: 'blue', hours: 16.5, short: 'Blue hour', en: 'Blue hour', icon: 'bluehour' },
    { id: 'aurora', hours: 22, short: 'Aurora', en: 'Aurora', icon: 'aurora' },
    { id: 'late', hours: 2, short: 'Late night', en: 'Late night', icon: 'moon' },
];
