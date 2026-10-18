/**
 * Where and when Foxfire Fjord is: a fjord at 69.3°N on the 21st of February.
 *
 * One source of truth for the sky geometry, shared by the renderer (core/sky.ts)
 * and the clock UI (ui/sun-model.ts): the sun's and the moon's equatorial
 * coordinates, hour angles from the local solar clock, directions in world space,
 * the sidereal frame that turns the star field, and a winter star catalogue.
 *
 * The day loops: every hour of the clock is the same 21 February, so the sun and
 * the moon keep fixed equatorial coordinates and only turn with the sky. That keeps
 * a time-lapse continuous through midnight.
 *
 * World axes: +x east, +y up, -z north.
 */
const DEG = Math.PI / 180;
const OBLIQUITY = 23.44 * DEG;
export const LATITUDE_DEG = 69.3;
export const LATITUDE = LATITUDE_DEG * DEG;
/** 21 February */
export const DAY_OF_YEAR = 52;
function eclipticToEquatorial(lon, lat) {
    const sinDec = Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lon);
    const ra = Math.atan2(Math.sin(lon) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lon));
    return { ra: (ra + Math.PI * 2) % (Math.PI * 2), dec: Math.asin(sinDec) };
}
/** the sun's ecliptic longitude on 21 February (just past the Aquarius/Pisces boundary) */
const SUN_LON = 332.3 * DEG;
const SUN_EQ = eclipticToEquatorial(SUN_LON, 0);
/** right ascension of the sun (radians, ~22h17m) */
export const SUN_RA = SUN_EQ.ra;
/** declination of the sun (radians, ~-10.8°): the noon sun stands ~10° above the southern horizon */
export const SUN_DEC = SUN_EQ.dec;
/**
 * A waxing gibbous moon 115° east of the sun in Taurus/Gemini: it culminates ~40° high in the
 * south around half past seven in the evening, is still high through the aurora hours and only
 * grazes the northern horizon before dawn.
 */
export const MOON_ELONGATION = 115 * DEG;
const MOON_EQ = eclipticToEquatorial(SUN_LON + MOON_ELONGATION, -4 * DEG);
export const MOON_RA = MOON_EQ.ra;
export const MOON_DEC = MOON_EQ.dec;
/** illuminated fraction of the moon's disc */
export const MOON_ILLUMINATION = (1 - Math.cos(MOON_ELONGATION)) / 2;
/** hour angle of the sun (radians) at a local solar clock time */
export function sunHourAngle(hours) {
    return ((hours - 12) / 24) * Math.PI * 2;
}
/** local sidereal time (radians) at a local solar clock time */
export function siderealTime(hours) {
    return SUN_RA + sunHourAngle(hours);
}
/** hour angle of the moon (radians) */
export function moonHourAngle(hours) {
    return siderealTime(hours) - MOON_RA;
}
/** Unit vector toward a body with hour angle H and declination dec, written as (east, up, -north). */
export function celestialDir(H, dec, out) {
    const east = -Math.cos(dec) * Math.sin(H);
    const north = Math.sin(dec) * Math.cos(LATITUDE) - Math.cos(dec) * Math.cos(H) * Math.sin(LATITUDE);
    const up = Math.sin(dec) * Math.sin(LATITUDE) + Math.cos(dec) * Math.cos(H) * Math.cos(LATITUDE);
    const l = Math.hypot(east, north, up) || 1;
    out.set(east / l, up / l, -north / l);
    return out;
}
export function sunDirection(hours, out) {
    return celestialDir(sunHourAngle(hours), SUN_DEC, out);
}
export function moonDirection(hours, out) {
    return celestialDir(moonHourAngle(hours), MOON_DEC, out);
}
function altitudeOf(H, dec) {
    const s = Math.sin(dec) * Math.sin(LATITUDE) + Math.cos(dec) * Math.cos(H) * Math.cos(LATITUDE);
    return Math.asin(Math.max(-1, Math.min(1, s)));
}
/** Sun altitude in radians. */
export function sunAltitude(hours) {
    return altitudeOf(sunHourAngle(hours), SUN_DEC);
}
/** Moon altitude in radians. */
export function moonAltitude(hours) {
    return altitudeOf(moonHourAngle(hours), MOON_DEC);
}
/**
 * Row-major 3×3 rotation from world directions to the equatorial frame (x toward RA 0h,
 * z toward the celestial pole) at the given clock time; the pole maps to (0, sin φ, −cos φ).
 */
export function starRotation(hours) {
    const lst = siderealTime(hours);
    const cl = Math.cos(lst);
    const sl = Math.sin(lst);
    const cp = Math.cos(LATITUDE);
    const sp = Math.sin(LATITUDE);
    return [-sl, cp * cl, sp * cl, cl, cp * sl, sp * sl, 0, sp, -cp];
}
/** clock time (hours) when the sun crosses `altitude` (radians) on the way up (rising) or down */
function sunCrossing(altitude, rising) {
    let lo = rising ? 0 : 12;
    let hi = rising ? 12 : 24;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const above = sunAltitude(mid) > altitude;
        if (above === rising)
            hi = mid;
        else
            lo = mid;
    }
    return (lo + hi) / 2;
}
/** ~08:00 in the south-east */
export const SUNRISE = sunCrossing(0, true);
/** ~16:00 in the south-west */
export const SUNSET = sunCrossing(0, false);
/** end of the evening civil twilight (sun 6° below) */
export const CIVIL_DUSK = sunCrossing(-6 * DEG, false);
export const CIVIL_DAWN = sunCrossing(-6 * DEG, true);
/** full dark (sun 18° below) */
export const ASTRO_DUSK = sunCrossing(-18 * DEG, false);
export const ASTRO_DAWN = sunCrossing(-18 * DEG, true);
/** the sun at noon, degrees */
export const NOON_ALTITUDE_DEG = sunAltitude(12) / DEG;
/**
 * Naked-eye anchors of the late-winter sky at 69°N: [RA (h), Dec (deg), V mag, B−V].
 * Orion, Taurus and the Pleiades, Gemini and Auriga in the evening south; the Plough high in
 * the north-east; Cassiopeia, Perseus, Cygnus and Vega circumpolar; Polaris 69° up. Stars that
 * never rise this far north are left out; the rest of the field is procedural.
 */
export const STAR_CATALOGUE = [
    // Orion
    [5.919, 7.41, 0.5, 1.85], // Betelgeuse
    [5.242, -8.2, 0.13, -0.03], // Rigel
    [5.419, 6.35, 1.64, -0.22], // Bellatrix
    [5.679, -1.94, 1.74, -0.21], // Alnitak
    [5.604, -1.2, 1.69, -0.18], // Alnilam
    [5.533, -0.3, 2.25, -0.22], // Mintaka
    [5.796, -9.67, 2.07, -0.17], // Saiph
    [5.585, 9.93, 3.39, -0.18], // Meissa
    // the dog stars, low in the south
    [6.753, -16.72, -1.46, 0.0], // Sirius
    [7.655, 5.23, 0.34, 0.42], // Procyon
    // Gemini
    [7.577, 31.89, 1.58, 0.03], // Castor
    [7.755, 28.03, 1.14, 1.0], // Pollux
    [6.629, 16.4, 1.93, 0.0], // Alhena
    // Taurus, the Hyades and the Pleiades
    [4.5987, 16.509, 0.87, 1.54], // Aldebaran
    [5.438, 28.61, 1.65, -0.13], // Elnath
    [4.478, 15.87, 3.4, 0.18], // θ2 Tau
    [4.477, 19.18, 3.53, 1.01], // ε Tau
    [3.7914, 24.105, 2.87, -0.09], // Alcyone
    [3.8193, 24.053, 3.62, -0.07], // Atlas
    [3.7479, 24.113, 3.7, -0.11], // Electra
    [3.7636, 24.368, 3.87, -0.07], // Maia
    [3.7722, 23.948, 4.18, -0.06], // Merope
    [3.7535, 24.467, 4.3, -0.11], // Taygeta
    // Auriga
    [5.2782, 45.998, 0.08, 0.8], // Capella
    [5.992, 44.95, 1.9, 0.03], // Menkalinan
    [4.95, 33.17, 2.69, 1.53], // Hassaleh
    // Perseus, Aries, Cetus
    [3.4054, 49.861, 1.79, 0.48], // Mirfak
    [3.1361, 40.956, 2.12, -0.05], // Algol
    [2.1195, 23.462, 2.0, 1.15], // Hamal
    [3.038, 4.09, 2.54, 1.64], // Menkar
    // Andromeda and Pegasus, setting in the north-west
    [0.1398, 29.091, 2.06, -0.11], // Alpheratz
    [1.1622, 35.621, 2.05, 1.58], // Mirach
    [2.065, 42.33, 2.1, 1.37], // Almach
    [23.0794, 15.205, 2.48, -0.04], // Markab
    [23.0629, 28.083, 2.42, 1.67], // Scheat
    [0.2206, 15.184, 2.83, -0.23], // Algenib
    [21.7364, 9.875, 2.38, 1.53], // Enif
    // Cassiopeia
    [0.6751, 56.537, 2.24, 1.17], // Schedar
    [0.153, 59.15, 2.28, 0.34], // Caph
    [0.9451, 60.717, 2.47, -0.15], // γ Cas
    [1.4302, 60.235, 2.68, 0.13], // Ruchbah
    [1.9066, 63.67, 3.37, -0.15], // Segin
    // the Plough
    [11.0621, 61.751, 1.79, 1.07], // Dubhe
    [11.0307, 56.382, 2.37, -0.02], // Merak
    [11.8972, 53.695, 2.44, 0.04], // Phecda
    [12.2571, 57.033, 3.31, 0.08], // Megrez
    [12.9005, 55.96, 1.77, -0.02], // Alioth
    [13.3988, 54.925, 2.23, 0.02], // Mizar
    [13.7923, 49.313, 1.86, -0.19], // Alkaid
    [12.934, 38.32, 2.9, -0.12], // Cor Caroli
    // the pole
    [2.5303, 89.264, 1.98, 0.6], // Polaris
    [14.8451, 74.156, 2.08, 1.47], // Kochab
    // Leo, rising in the east
    [10.14, 11.97, 1.35, -0.11], // Regulus
    [10.333, 19.84, 2.08, 1.13], // Algieba
    [11.818, 14.57, 2.14, 0.09], // Denebola
    [11.235, 20.52, 2.56, 0.12], // Zosma
    [9.46, -8.66, 1.98, 1.44], // Alphard
    // Boötes and the spring stars, late at night
    [14.2612, 19.182, -0.05, 1.23], // Arcturus
    [14.75, 27.07, 2.37, 0.97], // Izar
    [13.42, -11.16, 0.98, -0.23], // Spica
    [15.5781, 26.715, 2.23, 0.03], // Alphecca
    // the summer triangle and Draco, circumpolar in the north
    [18.6156, 38.784, 0.03, 0.0], // Vega
    [20.6905, 45.28, 1.25, 0.09], // Deneb
    [19.8464, 8.868, 0.77, 0.22], // Altair
    [20.3705, 40.257, 2.23, 0.67], // Sadr
    [20.7702, 33.97, 2.48, 1.03], // Gienah
    [19.7495, 45.131, 2.87, -0.03], // δ Cyg
    [17.9434, 51.489, 2.23, 1.52], // Eltanin
    [21.3096, 62.586, 2.45, 0.26], // Alderamin
];
