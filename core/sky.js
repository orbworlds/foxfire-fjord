/**
 * The polar sky of Foxfire Fjord: time of day at 69.3°N in late February, a
 * physically based atmosphere, the northern lights, image-based lighting from
 * the sky, the sun/moon key light with a camera-following shadow frustum, the
 * weather, fog and exposure.
 *
 * The atmosphere is precomputed (after Hillaire 2020): transmittance and
 * multiple-scattering LUTs describe the clean, dry polar air over snow, and two
 * small sky-view LUTs (sun and moon) are re-rendered only when those move. The
 * ozone layer and the earth's shadow give the long blue hours for free. The
 * aurora (core/aurora.ts), stars, the Milky Way, the moon, ice-crystal halos and
 * the cloud layers are drawn on top in the dome shader, in that order, so clouds
 * hide the aurora.
 *
 * The sun only skims ~10° above the southern horizon at noon, so every light
 * curve here is keyed on a low sun: a short pink-gold day inside long blue
 * hours, then a long moonlit night lit green by the aurora.
 *
 * The dome draws after all opaque geometry (renderOrder 1000, depth at the far
 * plane) so the aurora raymarch only runs where sky is actually visible. Opaque
 * meshes with depthWrite: false must be transparent or draw after it.
 */
import * as THREE from 'three';
import { shared } from './shared.js';
import { events } from './events.js';
import { state } from './state.js';
import { params } from './params.js';
import { moonDirection, starRotation, STAR_CATALOGUE, sunDirection } from './celestial.js';
import { AURORA_GLSL, AuroraSystem, sampleCurve } from './aurora.js';
const TRANS_W = 256;
const TRANS_H = 64;
const MULTI_N = 32;
const VIEW_W = 192;
const VIEW_H = 108;
/** observer altitude of the sky LUTs (km); the world is flat, so the sky horizon stays at elevation 0 */
const VIEW_ALT = 0.03;
/** sea-level scattering / extinction (1/km) */
const RAYLEIGH_SCAT = new THREE.Vector3(5.802e-3, 13.558e-3, 33.1e-3);
const MIE_SCAT = 3.996e-3;
const MIE_EXT = 4.44e-3;
/**
 * Ozone (Chappuis band). Its green/red ratio is eased from the sRGB-primary textbook values (0.65, 1.88)
 * toward a broad-spectrum eye: the long twilight then reads deep blue instead of magenta.
 */
const OZONE_ABS = new THREE.Vector3(0.85e-3, 1.45e-3, 0.085e-3);
/** key light illuminance of a zenith sun; the sky and the light are white balanced to that sun */
const SUN_KEY = 3.3;
/** sky radiance gain over the physical value (snow bounce already lifts the fill, so less than a green island needs) */
const SKY_GAIN = 1.25;
/**
 * exposure keyed by sun elevation (sin; the polar noon sun peaks at ~0.17): eyes adapt from the low
 * sun on snow to moonlight. Lower than for a dark landscape, because snow reflects ~90%.
 */
const EXPOSURE_CURVE = [
    [-0.5, 3.7],
    [-0.24, 3.7],
    [-0.16, 3.55],
    [-0.1, 3.25],
    [-0.05, 2.8],
    [0.0, 2.15],
    [0.05, 1.7],
    [0.1, 1.55],
    [0.2, 1.45],
    [1.0, 1.3],
];
const WEATHER = {
    clear: { cumulus: -0.3, cirrus: 0.1, bank: 0, density: 0.5, ice: 0.75, overcast: 0, snowfall: 0, haze: 0 },
    bank: { cumulus: -0.3, cirrus: 0.18, bank: 1, density: 0.6, ice: 0.6, overcast: 0, snowfall: 0, haze: 0.15 },
    snow: { cumulus: 1.7, cirrus: 0, bank: 0, density: 0.9, ice: 0, overcast: 1, snowfall: 1, haze: 7 },
};
const WEATHER_KEYS = ['cumulus', 'cirrus', 'bank', 'density', 'ice', 'overcast', 'snowfall', 'haze'];
/** sky cube faces read back for the fog: +x, -x, +z, -z at the horizon, then +y (zenith) */
const HORIZON_FACES = [0, 1, 4, 5, 2];
/** naked-eye anchors of the winter sky (core/celestial.ts); the rest of the field is procedural */
const BRIGHT_STARS = STAR_CATALOGUE;
/** equatorial unit vector + (colour index * 16 + magnitude + 1) packed in w */
function packBrightStars() {
    return BRIGHT_STARS.map(([ra, dec, mag, bv]) => {
        const a = ra * (Math.PI / 12);
        const d = dec * (Math.PI / 180);
        const idx = THREE.MathUtils.clamp(Math.round((bv + 0.3) * 4), 0, 9);
        return new THREE.Vector4(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), idx * 16 + mag + 1);
    });
}
const ATMO_COMMON = /* glsl */ `
#define A_PI 3.14159265359
const float RG = 6360.0;
const float RT = 6460.0;
const vec2 TRANS_RES = vec2(${TRANS_W}.0, ${TRANS_H}.0);
const float MULTI_RES = ${MULTI_N}.0;
const vec2 VIEW_RES = vec2(${VIEW_W}.0, ${VIEW_H}.0);
uniform vec3 uRayScat;
uniform float uMieScat;
uniform float uMieExt;
uniform vec3 uOzoneAbs;
uniform float uMieG;
uniform sampler2D uTransLUT;

void atmoMedium(float h, out vec3 scatR, out float scatM, out vec3 ext) {
  h = max(h, 0.0);
  float md = exp(-h / 1.2);
  scatR = uRayScat * exp(-h / 8.0);
  scatM = uMieScat * md;
  ext = scatR + uMieExt * md + uOzoneAbs * max(0.0, 1.0 - abs(h - 25.0) / 15.0);
}

float distToTop(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + RT * RT;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

float distToGround(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + RG * RG;
  return (mu < 0.0 && disc >= 0.0) ? max(0.0, -r * mu - sqrt(disc)) : -1.0;
}

// the sun disc sinking below the horizon of a point at radius r
float earthShadow(float r, float muS) {
  float muH = -sqrt(max(0.0, (r - RG) * (r + RG))) / r;
  return smoothstep(muH - 0.005, muH + 0.005, muS);
}

vec3 atmoTransmittance(float r, float mu) {
  float H = sqrt(RT * RT - RG * RG);
  float rho = sqrt(max(0.0, (r - RG) * (r + RG)));
  float dMin = RT - r;
  float dMax = rho + H;
  vec2 uv = clamp(vec2((distToTop(r, mu) - dMin) / max(dMax - dMin, 1e-3), rho / H), 0.0, 1.0);
  return texture2D(uTransLUT, uv * (1.0 - 1.0 / TRANS_RES) + 0.5 / TRANS_RES).rgb;
}

float phaseRayleigh(float c) {
  return 0.0596831 * (1.0 + c * c);
}

// Cornette-Shanks
float phaseMie(float c, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
`;
const QUAD_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
/** transmittance to the top of the atmosphere, Bruneton's (r, mu) parametrisation */
const TRANS_FRAG = /* glsl */ `
${ATMO_COMMON}
void main() {
  vec2 unit = (gl_FragCoord.xy - 0.5) / (TRANS_RES - 1.0);
  float H = sqrt(RT * RT - RG * RG);
  float rho = H * unit.y;
  float r = sqrt(rho * rho + RG * RG);
  float dMin = RT - r;
  float dMax = rho + H;
  float d = dMin + unit.x * (dMax - dMin);
  float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 depth = vec3(0.0);
  const int N = 48;
  float dt = d / float(N);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * dt;
    // ri^2 - RG^2 without cancellation
    float q = rho * rho + t * t + 2.0 * r * mu * t;
    float ri = sqrt(max(q, 0.0) + RG * RG);
    vec3 sR; float sM; vec3 ext;
    atmoMedium(q / (ri + RG), sR, sM, ext);
    depth += ext * dt;
  }
  gl_FragColor = vec4(exp(-depth), 1.0);
}
`;
/** second-order luminance and its geometric series (Hillaire 2020, eq. 5–10) */
const MULTI_FRAG = /* glsl */ `
${ATMO_COMMON}
uniform vec3 uGroundAlbedo;
void main() {
  vec2 unit = (gl_FragCoord.xy - 0.5) / (MULTI_RES - 1.0);
  float muS = unit.x * 2.0 - 1.0;
  float r0 = RG + clamp(unit.y, 0.002, 0.998) * (RT - RG);
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  vec3 P0 = vec3(0.0, r0, 0.0);
  vec3 L2 = vec3(0.0);
  vec3 fms = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      float theta = 2.0 * A_PI * (float(i) + 0.5) / 8.0;
      float cp = 1.0 - 2.0 * (float(j) + 0.5) / 8.0;
      float sp = sqrt(max(0.0, 1.0 - cp * cp));
      vec3 w = vec3(cos(theta) * sp, cp, sin(theta) * sp);
      float tG = distToGround(r0, cp);
      float tMax = tG >= 0.0 ? tG : distToTop(r0, cp);
      float dt = tMax / 20.0;
      vec3 thr = vec3(1.0);
      for (int s = 0; s < 20; s++) {
        vec3 P = P0 + w * ((float(s) + 0.5) * dt);
        float r = length(P);
        float mu = dot(P, sunDir) / r;
        vec3 sR; float sM; vec3 ext;
        atmoMedium(r - RG, sR, sM, ext);
        vec3 scat = sR + sM;
        vec3 sT = exp(-ext * dt);
        vec3 k = thr * (1.0 - sT) / max(ext, vec3(1e-6));
        L2 += k * scat * atmoTransmittance(r, mu) * earthShadow(r, mu) * (0.25 / A_PI);
        fms += k * scat;
        thr *= sT;
      }
      if (tG >= 0.0) {
        vec3 P = P0 + w * tG;
        float r = length(P);
        float mu = dot(P, sunDir) / r;
        L2 += thr * atmoTransmittance(r, mu) * max(mu, 0.0) * uGroundAlbedo / A_PI;
      }
    }
  }
  L2 /= 64.0;
  fms /= 64.0;
  gl_FragColor = vec4(L2 / max(1.0 - fms, vec3(1e-3)), 1.0);
}
`;
/**
 * Sky luminance for unit illuminance from a light at azimuth 0, over the upper
 * hemisphere. v packs the view zenith angle with extra resolution at the horizon,
 * u the azimuth relative to the light with extra resolution toward it.
 */
const VIEW_FRAG = /* glsl */ `
${ATMO_COMMON}
uniform sampler2D uMultiLUT;
uniform vec3 uLight;
uniform float uViewAlt;
vec3 atmoMulti(float r, float muS) {
  vec2 uv = clamp(vec2(muS * 0.5 + 0.5, (r - RG) / (RT - RG)), 0.0, 1.0);
  return texture2D(uMultiLUT, uv * (1.0 - 1.0 / MULTI_RES) + 0.5 / MULTI_RES).rgb;
}
void main() {
  vec2 unit = (gl_FragCoord.xy - 0.5) / (VIEW_RES - 1.0);
  float a = 1.0 - unit.y;
  float zen = 0.5 * A_PI * (1.0 - a * a);
  float cphi = 1.0 - 2.0 * unit.x * unit.x;
  vec3 w = vec3(sin(zen) * cphi, cos(zen), sin(zen) * sqrt(max(0.0, 1.0 - cphi * cphi)));
  float muL = clamp(uLight.y, -1.0, 1.0);
  vec3 L = vec3(sqrt(max(0.0, 1.0 - muL * muL)), muL, 0.0);
  float r0 = RG + uViewAlt;
  float tMax = distToTop(r0, w.y);
  float c = dot(w, L);
  float pR = phaseRayleigh(c);
  float pM = phaseMie(c, uMieG);
  vec3 lum = vec3(0.0);
  vec3 thr = vec3(1.0);
  float t0 = 0.0;
  const int N = 40;
  for (int s = 0; s < N; s++) {
    float f = (float(s) + 1.0) / float(N);
    float t1 = tMax * f * f;
    float dt = t1 - t0;
    vec3 P = vec3(0.0, r0, 0.0) + w * (t0 + 0.3 * dt);
    t0 = t1;
    float r = length(P);
    float muS = dot(P, L) / r;
    vec3 sR; float sM; vec3 ext;
    atmoMedium(r - RG, sR, sM, ext);
    vec3 Ts = atmoTransmittance(r, muS) * earthShadow(r, muS);
    vec3 ms = atmoMulti(r, muS);
    vec3 S = sR * (pR * Ts + ms) + sM * (pM * Ts + ms);
    vec3 sT = exp(-ext * dt);
    lum += thr * S * (1.0 - sT) / max(ext, vec3(1e-6));
    thr *= sT;
  }
  gl_FragColor = vec4(lum, 1.0);
}
`;
const QUAD_GROUND_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;
}
`;
/** sky radiance from the sun and moon sky-view LUTs plus airglow (upper hemisphere directions) */
const SKY_LOOKUP = /* glsl */ `
uniform vec3 sunPosition;
uniform vec3 uMoonDir;
uniform sampler2D uSkyLUT;
uniform sampler2D uMoonLUT;
uniform vec3 uSunE;
uniform float uMoonE;
uniform vec3 uMoonTint;
uniform float uNight;
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec3 uAirglow;

vec2 skyViewUv(vec3 d, vec3 L) {
  float zen = acos(clamp(d.y, 0.0, 1.0));
  float v = 1.0 - sqrt(max(0.0, 1.0 - zen / (0.5 * A_PI)));
  float den = dot(d.xz, d.xz) * dot(L.xz, L.xz);
  float cphi = den > 1e-10 ? dot(d.xz, L.xz) * inversesqrt(den) : 1.0;
  float u = sqrt(clamp(0.5 - 0.5 * cphi, 0.0, 1.0));
  return vec2(u, v) * (1.0 - 1.0 / VIEW_RES) + 0.5 / VIEW_RES;
}

vec3 skyRadiance(vec3 d, vec3 sunDir) {
  vec3 c = uSunE * texture2D(uSkyLUT, skyViewUv(d, sunDir)).rgb;
  c += uMoonE * uMoonTint * texture2D(uMoonLUT, skyViewUv(d, uMoonDir)).rgb;
  c += mix(uNightHorizon, uNightZenith, pow(d.y, 0.45)) * uNight;
  // the faint green 557.7 nm airglow layer, brightest ~10° above the horizon where its path is longest
  c += uAirglow * exp(-pow((d.y - 0.17) / 0.11, 2.0)) * uNight;
  return c;
}
`;
/** ground hemisphere of the environment map: snow (and dark water) under the key light, the sky dome and the aurora */
const GROUND_FRAG = /* glsl */ `
${ATMO_COMMON}
${SKY_LOOKUP}
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uAlbedo;
uniform vec3 uAurFill;
void main() {
  vec3 sunDir = normalize(sunPosition);
  vec3 lo = vec3(0.0);
  vec3 hi = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0471976;
    lo += skyRadiance(vec3(cos(a) * 0.906, 0.423, sin(a) * 0.906), sunDir);
    hi += skyRadiance(vec3(cos(a + 0.52) * 0.5, 0.866, sin(a + 0.52) * 0.5), sunDir);
  }
  // two-ring quadrature of the cosine-weighted hemisphere (rings 0–40° and 40–90°, weights sum to pi)
  vec3 E = (lo * 1.298 + hi * 1.844) / 6.0 + uKeyColor * max(uKeyDir.y, 0.0) + uAurFill;
  gl_FragColor = vec4(uAlbedo * E / A_PI, 1.0);
}
`;
const SKY_FRAG = /* glsl */ `
${ATMO_COMMON}
${SKY_LOOKUP}
varying vec3 vDir;
uniform float uViewAlt;
uniform float showSunDisc;
uniform vec3 uSunDiscE;
uniform float uShowMoon;
uniform float time;
uniform vec3 uMoonColor;
uniform mat3 uStarRot;
uniform float uStarIntensity;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform float cirrusCoverage;
uniform vec2 uCloudOffset;
uniform vec2 uCirrusOffset;
uniform vec2 uCirrusDir;
uniform float uMilkyWay;
uniform vec3 uGalN;
uniform vec3 uGalC;
uniform float uMoonHalo;
#define N_BRIGHT ${BRIGHT_STARS.length}
uniform vec4 uBright[N_BRIGHT];
/** ice crystals in the air (22° halos, sun dogs) */
uniform float uIce;
/** stratocumulus bank over the open sea: strength and horizontal direction */
uniform float uBank;
uniform vec2 uBankDir;
/** aurora light on the cloud tops */
uniform vec3 uAurFill;
${AURORA_GLSL}

const float SUN_R = 0.0055;
const float MOON_R = 0.0115;

vec2 gradient(vec2 i) {
  vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}

float h13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 h33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h13(i), h13(i + vec3(1.0, 0.0, 0.0)), u.x), mix(h13(i + vec3(0.0, 1.0, 0.0)), h13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(h13(i + vec3(0.0, 0.0, 1.0)), h13(i + vec3(1.0, 0.0, 1.0)), u.x), mix(h13(i + vec3(0.0, 1.0, 1.0)), h13(i + vec3(1.0)), u.x), u.y),
    u.z);
}
float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise3(p);
    p = p * 2.03 + 1.7;
    a *= 0.5;
  }
  return s;
}

// scintillation grows with the air mass
float twinkle(float seed, vec3 dir) {
  float amp = 0.08 + 0.4 * (1.0 - smoothstep(0.05, 0.6, dir.y));
  return 1.0 + amp * sin(time * (4.0 + 6.0 * seed) + seed * 71.0) * sin(time * (2.3 + 3.0 * seed) + seed * 13.0);
}

vec3 starTint(float bv) {
  vec3 c = bv < 0.6
    ? mix(vec3(0.66, 0.76, 1.0), vec3(1.0, 0.95, 0.88), clamp((bv + 0.3) / 0.9, 0.0, 1.0))
    : mix(vec3(1.0, 0.95, 0.88), vec3(1.0, 0.7, 0.48), clamp((bv - 0.6) / 1.2, 0.0, 1.0));
  return c / dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// one star per cell of a cube-face grid over the celestial sphere; power-law flux, so most are faint
vec3 starGrid(vec3 e, vec3 dir, float n, float density, float f0, float fmax, float px, float skyL, float seed) {
  vec3 a = abs(e);
  vec2 uv;
  vec3 axis;
  if (a.x >= a.y && a.x >= a.z) { uv = e.yz / a.x; axis = vec3(sign(e.x), 0.0, 0.0); }
  else if (a.y >= a.z) { uv = e.xz / a.y; axis = vec3(0.0, sign(e.y), 0.0); }
  else { uv = e.xy / a.z; axis = vec3(0.0, 0.0, sign(e.z)); }
  vec2 cell = floor((uv * 0.5 + 0.5) * n);
  vec3 h = h33(vec3(cell, dot(axis, vec3(1.0, 2.0, 3.0)) * 19.0 + seed));
  if (h.z > density) return vec3(0.0);
  // kept off the cell border so a single-cell lookup never clips the PSF
  vec2 sp = (cell + 0.2 + 0.6 * h.xy) / n * 2.0 - 1.0;
  vec3 sd = axis.x != 0.0 ? vec3(axis.x, sp) : axis.y != 0.0 ? vec3(sp.x, axis.y, sp.y) : vec3(sp, axis.z);
  vec3 cr = cross(e, normalize(sd));
  float d2 = dot(cr, cr) / (px * px);
  float u = h13(vec3(cell.yx * 1.37, seed + 7.0));
  float flux = min(f0 * pow(max(u, 1e-4), -0.9), fmax);
  float vis = smoothstep(skyL * 0.25, skyL * 1.1, flux);
  float bv = h13(vec3(cell, seed + 3.0));
  // colour is only seen in the brighter stars
  vec3 tint = mix(vec3(1.0), starTint(bv * bv * 1.9 - 0.25), smoothstep(0.006, 0.03, flux));
  return tint * flux * vis * exp(-d2 * 1.4) * twinkle(u, dir);
}

vec3 brightStars(vec3 e, vec3 dir, float px, float skyL) {
  vec3 c = vec3(0.0);
  float lim = px * px * 60.0;
  for (int i = 0; i < N_BRIGHT; i++) {
    vec4 s = uBright[i];
    vec3 cr = cross(e, s.xyz);
    float d2 = dot(cr, cr);
    if (d2 < lim && dot(e, s.xyz) > 0.0) {
      float idx = floor(s.w / 16.0);
      float mag = s.w - idx * 16.0 - 1.0;
      float flux = 0.32 * exp2(-mag);
      float r2 = d2 / (px * px);
      float psf = exp(-r2 * 1.4 / (1.0 + 0.35 * max(0.0, 2.2 - mag))) + 0.025 * max(0.0, 1.6 - mag) * exp(-sqrt(r2) * 0.45);
      c += starTint(idx * 0.25 - 0.3) * flux * psf * smoothstep(skyL * 0.25, skyL * 1.1, flux) * twinkle(fract(float(i) * 0.618), dir);
    }
  }
  return c;
}

// galactic frame: disc thickening toward the centre, Cygnus and Sagittarius star clouds, dust lanes and the Great Rift
vec3 milkyWay(vec3 e, out float density) {
  vec3 gB = cross(uGalN, uGalC);
  float b = asin(clamp(dot(e, uGalN), -1.0, 1.0));
  float l = atan(dot(e, gB), dot(e, uGalC));
  float cl = 0.5 + 0.5 * cos(l);
  float width = mix(0.075, 0.19, cl * cl);
  float disc = exp(-b * b / (width * width));
  float along = 0.28 + 0.72 * pow(cl, 1.6) + 0.35 * exp(-pow((l - 1.25) / 0.45, 2.0));
  float bulge = exp(-(l * l + 4.0 * b * b) / 0.09);
  float clouds = fbm3(e * 7.0);
  float fine = fbm3(e * 23.0 + 4.0);
  float lum = (disc * along * (0.3 + 1.4 * clouds * clouds) + 1.2 * bulge) * (0.7 + 0.6 * fine);
  float rift = smoothstep(-0.5, -0.05, l) * (1.0 - smoothstep(1.35, 1.7, l));
  float lane = exp(-pow((b - 0.012) / 0.045, 2.0));
  float dust = smoothstep(0.38, 0.62, fbm3(e * 11.0 + 9.0));
  lum *= 1.0 - 0.85 * lane * mix(0.35, 1.0, rift) * dust;
  density = disc * along;
  return mix(vec3(0.84, 0.9, 1.0), vec3(1.0, 0.9, 0.76), clamp(bulge + 0.3 * cl, 0.0, 1.0)) * lum;
}

float maria(vec2 p) {
  float m = smoothstep(0.27, 0.12, length((p - vec2(-0.3, 0.45)) * vec2(1.0, 1.15)));
  m += smoothstep(0.36, 0.14, length((p - vec2(-0.56, 0.02)) * vec2(1.25, 0.8)));
  m += smoothstep(0.16, 0.06, length(p - vec2(0.18, 0.4)));
  m += smoothstep(0.2, 0.07, length(p - vec2(0.34, 0.12)));
  m += smoothstep(0.11, 0.04, length(p - vec2(0.7, 0.28)));
  m += smoothstep(0.14, 0.05, length(p - vec2(0.55, -0.12)));
  m += smoothstep(0.1, 0.03, length(p - vec2(0.38, -0.28)));
  m += smoothstep(0.18, 0.06, length(p - vec2(-0.17, -0.38)));
  m += smoothstep(0.1, 0.03, length(p - vec2(-0.5, -0.4)));
  m += smoothstep(0.1, 0.03, length((p - vec2(0.0, 0.7)) * vec2(0.35, 1.0)));
  return clamp(m, 0.0, 1.0);
}

// 22° halo profile per channel: a sharp red inner edge, nothing inside, bluish white fading outward
vec3 haloRing(float a, float px) {
  vec3 x = a - vec3(0.3822, 0.3846, 0.3874);
  float w = 0.0035 + px;
  return smoothstep(-w, w * 0.4, x) * (exp(-max(x, 0.0) / 0.03) + 0.25 * exp(-max(x, 0.0) / 0.12));
}

// ice-crystal optics of a low light source L (sun or moon): the 22° halo, the parhelia (sun dogs) on either side
// at the light's own elevation, and a faint parhelic circle
vec3 iceOptics(vec3 dir, vec3 L, float px, float dogs) {
  float a = acos(clamp(dot(dir, L), -1.0, 1.0));
  vec3 c = haloRing(a, px) * 0.5;
  if (dogs > 0.0) {
    float eL = asin(clamp(L.y, -1.0, 1.0));
    float eD = asin(clamp(dir.y, -1.0, 1.0));
    float ce = cos(eL);
    float den = length(dir.xz) * length(L.xz);
    float daz = acos(clamp(dot(dir.xz, L.xz) / max(den, 1e-5), -1.0, 1.0));
    // plate crystals: the parhelion sits a little beyond 22° and moves out as the light climbs
    float th = 0.3840 + 0.35 * eL * eL;
    float caz = (cos(th) - L.y * L.y) / max(ce * ce, 1e-3);
    float az0 = acos(clamp(caz, -1.0, 1.0));
    vec3 x = (daz - az0) * cos(eD) - vec3(0.0, 0.0025, 0.0055);
    float y = eD - eL;
    float core = exp(-y * y / (0.0105 * 0.0105 + px * px));
    vec3 spot = smoothstep(-0.0045 - px, 0.0015, x) * (exp(-max(x, 0.0) / 0.009) + 0.12 * exp(-max(x, 0.0) / 0.09));
    c += spot * core * 2.6 * dogs;
    // the parhelic circle: a thin white band through the light at its elevation, away from the light
    c += vec3(exp(-y * y / (0.0028 * 0.0028 + px * px))) * smoothstep(0.2, 0.5, daz) * 0.05 * dogs;
  }
  return c;
}

// waxing gibbous moon: Lommel-Seeliger regolith, maria, earthshine and a haze aureole
vec3 moonDisc(vec3 dir, vec3 sunDir, float px) {
  float sinA = length(cross(dir, uMoonDir));
  float cosA = dot(dir, uMoonDir);
  vec3 col = vec3(0.0);
  if (cosA > 0.0 && sinA < MOON_R + 3.0 * px) {
    vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, uMoonDir);
    vec2 uv = vec2(dot(dir, right), dot(dir, up)) / MOON_R;
    float z = sqrt(max(0.0, 1.0 - dot(uv, uv)));
    vec3 n = right * uv.x + up * uv.y - uMoonDir * z;
    float mu0 = max(dot(n, sunDir), 0.0);
    float lit = 2.0 * mu0 / (mu0 + z + 1e-3) * smoothstep(-0.03, 0.08, dot(n, sunDir));
    float albedo = mix(1.0, 0.58, maria(uv)) * (0.9 + 0.2 * vnoise3(vec3(uv * 9.0, 1.0)));
    albedo += 0.5 * smoothstep(0.08, 0.0, length(uv - vec2(-0.12, -0.72)));
    float edge = 1.0 - smoothstep(MOON_R - 0.7 * px, MOON_R + 0.7 * px, sinA);
    col = uMoonColor * (lit * albedo + 0.006) * edge;
  }
  float halo = exp(-sinA / 0.02) * 0.02 + exp(-sinA / 0.1) * 0.003;
  col += uMoonColor * halo * uMoonHalo * step(0.0, cosA);
  // the 22° ice halo of a cold moonlit night, faint and nearly colourless to the eye
  if (uIce > 0.0) {
    vec3 ring = haloRing(acos(clamp(cosA, -1.0, 1.0)), px);
    col += uMoonColor * mix(vec3(dot(ring, vec3(0.333))), ring, 0.35) * 0.0016 * uIce * uMoonHalo;
  }
  return col * uShowMoon;
}

// cloud layers on spherical shells (km above the observer)
const float CU_H = 1.6;
const float CI_H = 9.0;
const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);

// distance along a ray (cosine mu >= 0) from radius r0 to the shell h km above it
float shellDist(float r0, float h, float mu) {
  float b = r0 * mu;
  float c = h * (2.0 * r0 + h);
  return c / (b + sqrt(b * b + c));
}

// octaves fade out once they are finer than the pixel footprint fp (noise units), so the horizon never
// shimmers; 'lost' is the amplitude that was filtered away
float cloudFbm(vec2 p, float fp, int oct, out float lost) {
  float s = 0.0;
  float a = 0.5;
  lost = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    float k = 1.0 - smoothstep(0.3, 0.7, fp);
    s += a * noise(p) * k;
    lost += a * (1.0 - k);
    p = OCT * p + 0.37;
    fp *= 2.0;
    a *= 0.5;
  }
  return s;
}
float cloudFbm(vec2 p, float fp, int oct) {
  float lost;
  return cloudFbm(p, fp, oct, lost);
}

// cumulus density 0..1: clustered rounded puffs, billowed along the rim (p and fp in km)
// low-cloud bank mask of the current pixel (set in main)
float gBank = 0.0;
float cumulus(vec2 p, float fp, bool detail, out float billow) {
  float lost;
  float cov = cloudCoverage + 0.25 * noise(p * 0.06 + vec2(17.0, 3.0)) * (1.0 - smoothstep(0.3, 0.7, fp * 0.06)) + gBank;
  float d = cloudFbm(p * 0.36, fp * 0.36, 2, lost) * 1.45 + cov - 0.5;
  billow = 0.0;
  if (detail) {
    billow = cloudFbm(OCT * p * 0.95 + 5.0, fp * 1.9, 2);
    float fine = cloudFbm(OCT * OCT * p * 3.3 + 9.0, fp * 6.6, 2);
    d += (billow * 0.24 + fine * 0.09) * (1.0 - smoothstep(0.0, 0.22, abs(d)));
    billow += fine * 0.5;
  }
  // the filtered octaves widen the edge: far clouds melt into a soft band instead of thin slivers
  float w = lost * 0.5;
  return smoothstep(-w, 0.28 + w, d);
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}
// relative to isotropic: forward silver lining plus some back-scatter
float phaseCloud(float c) {
  return 0.75 * hg(c, 0.6) + 0.25 * hg(c, -0.25);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 sunDir = normalize(sunPosition);
  // below the horizon the dome shows the horizon (the sea and the fjord cover it)
  vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
  float dl = length(d);
  d = dl > 1e-5 ? d / dl : vec3(1.0, 0.0, 0.0);
  vec3 col = skyRadiance(d, sunDir);
  vec3 skyCol = col;

  float r0 = RG + uViewAlt;
  vec3 Tview = atmoTransmittance(r0, d.y);
  // the sky is white balanced to a zenith sun, so a star overhead stays white
  vec3 Twb = Tview / atmoTransmittance(r0, 1.0);
  float above = smoothstep(-0.003, 0.004, dir.y);
  float px = max(length(fwidth(dir)), 1e-5);
  // cloud-layer coordinates outside any branch: their derivatives drive the noise LOD
  float mu = max(dir.y, 0.0);
  vec2 camKm = cameraPosition.xz * 0.001;
  float tCu = shellDist(r0, CU_H, mu);
  // shapes are projected flatter than the real shells so distant puffs keep some height instead of
  // collapsing into slivers; aerial perspective still uses the true distance
  vec2 pCu = camKm + dir.xz * (CU_H / (mu + 0.14)) + uCloudOffset;
  vec2 pCi = camKm + dir.xz * (CI_H / (mu + 0.08)) + uCirrusOffset;
  float fpCu = length(fwidth(pCu));
  float fpCi = length(fwidth(pCi));

  // the northern lights: emission behind every cloud, dimmed and reddened by the air in front
  vec3 aur = vec3(0.0);
  if (uAurOn > 0.5 && dir.y > 0.0) aur = auroraRadiance(dir, sunDir, px) * Twb * above;

  if (uStarIntensity > 0.001) {
    vec3 e = uStarRot * dir;
    // bright curtains drown the faint stars; the bright ones shine through
    float skyL = dot(col + aur, vec3(0.2126, 0.7152, 0.0722));
    float dens;
    vec3 mw = milkyWay(e, dens);
    vec3 st = starGrid(e, dir, 220.0, 0.12 * (1.0 + 2.5 * dens), 0.003, 0.036, px, skyL, 0.0)
            + starGrid(e, dir, 64.0, 0.06, 0.01, 0.06, px, skyL, 31.0)
            + brightStars(e, dir, px, skyL);
    col += (mw * uMilkyWay + st) * uStarIntensity * Twb * above;
  }
  col += moonDisc(dir, sunDir, px) * Twb * above;

  float sinA = length(cross(dir, sunDir));
  float aa = fwidth(sinA) + 1e-6;
  float disc = (1.0 - smoothstep(SUN_R - aa, SUN_R + aa, sinA)) * step(0.0, dot(dir, sunDir));
  float x = clamp(sinA / SUN_R, 0.0, 1.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(1.0 - x * x));
  vec3 sunT = atmoTransmittance(r0, sunDir.y);
  col += uSunDiscE * showSunDisc * disc * limb * sunT * above;
  // diamond dust and thin ice veils around the low sun: halo, sun dogs, parhelic circle
  if (uIce > 0.0 && sunDir.y > -0.02) {
    float sunUp = smoothstep(-0.02, 0.02, sunDir.y);
    col += uSunE * sunT * iceOptics(dir, sunDir, px, 1.0) * 0.0065 * uIce * sunUp * above;
  }

  col += aur;

  // the cloud bank over the open sea: low, ragged-topped, only far out in its own sector of the sky
  if (uBank > 0.0) {
    float hl = length(dir.xz);
    vec2 hz = hl > 1e-5 ? dir.xz / hl : vec2(1.0, 0.0);
    float top = 0.095 + 0.05 * noise(hz * 3.2 + 3.1) + 0.025 * noise(hz * 11.0 + 8.7);
    gBank = uBank * smoothstep(0.15, 0.7, dot(hz, uBankDir)) * smoothstep(top, top - 0.06, dir.y) * 0.9;
  }

  if (dir.y > 0.0 && (cloudCoverage > -0.25 || cirrusCoverage > 0.0 || gBank > 0.0)) {
    vec3 amb = 0.5 * (skyRadiance(vec3(0.0, 1.0, 0.0), sunDir) + skyRadiance(normalize(vec3(-sunDir.x, 0.7, -sunDir.z)), sunDir));
    // the aurora above lights the cloud tops and, through them, the cloud base
    amb += uAurFill * 0.55;
    // light inside a cloud is mixed by many bounces (sky, sun, sea below): far less blue than the zenith
    amb = mix(vec3(dot(amb, vec3(0.2126, 0.7152, 0.0722))), amb, 0.55);
    // in-scattering per unit of (1 - transmittance) along this ray: aerial perspective in front of a layer
    vec3 skyIn = skyCol / max(1.0 - Tview, vec3(1e-3));

    // cirrus: thin ice veils combed out (and bent) by the upper wind, still sunlit a while after sunset
    float lostC;
    vec2 pw = pCi + vec2(noise(pCi * 0.12 + 3.0), noise(pCi * 0.12 - 7.0)) * 2.0;
    vec2 q = vec2(dot(pw, uCirrusDir), dot(pw, vec2(-uCirrusDir.y, uCirrusDir.x)));
    float fib = cloudFbm(vec2(q.x * 0.16, q.y * 0.9), fpCi * 0.9, 4, lostC);
    float wC = lostC * 0.42;
    float ci = smoothstep(-wC, 0.45 + wC, fib * 1.2 + noise(pCi * 0.05 + 11.0) * 0.55 + cirrusCoverage - 0.8);
    if (ci > 0.0) {
      float rci = r0 + CI_H;
      vec3 Ls = uSunE * atmoTransmittance(rci, sunDir.y) * earthShadow(rci, sunDir.y);
      vec3 Lm = uMoonE * uMoonTint * atmoTransmittance(rci, uMoonDir.y) * earthShadow(rci, uMoonDir.y);
      vec3 cCi = (Ls * (0.8 * hg(dot(dir, sunDir), 0.7) + 0.25) + Lm * (0.8 * hg(dot(dir, uMoonDir), 0.7) + 0.25)) * 0.06 + amb * 0.8;
      vec3 Tp = pow(Tview, vec3(0.7));
      cCi = cCi * Tp + skyIn * (1.0 - Tp);
      col = mix(col, cCi, ci * 0.45 * smoothstep(0.0, 0.05, dir.y));
    }

    // cumulus: the density one step toward the key light gives the puffs their volume
    float billow = 0.0;
    float dCu = cloudCoverage > -0.25 || gBank > 0.0 ? cumulus(pCu, fpCu, true, billow) : 0.0;
    if (dCu > 0.0) {
      float rcu = r0 + CU_H;
      vec3 Ls = uSunE * atmoTransmittance(rcu, sunDir.y) * earthShadow(rcu, sunDir.y);
      vec3 Lm = uMoonE * uMoonTint * atmoTransmittance(rcu, uMoonDir.y) * earthShadow(rcu, uMoonDir.y);
      vec3 Lc = dot(Ls, vec3(1.0)) >= dot(Lm, vec3(1.0)) ? sunDir : uMoonDir;
      float unused;
      float dL = cumulus(pCu + normalize(Lc.xz + vec2(1e-4, 0.0)) * 0.32, fpCu, false, unused);
      float tauL = mix(dL * 1.1 + dCu * 0.3, dCu, smoothstep(0.25, 0.9, Lc.y)) * 3.2;
      // billows facing the light catch it, the folds between them stay in shade
      tauL = max(tauL - billow * 1.2 * dCu, 0.0);
      // faces turned toward the viewer catch more of the light
      tauL *= mix(0.55, 1.0, 0.5 + 0.5 * dot(dir, Lc));
      float thin = exp(-dCu * 2.5);
      // single scattering plus a multiple-scattering term that keeps thick cores grey, not black
      float light = exp(-tauL) + 0.5 * exp(-tauL * 0.15);
      vec3 direct = (Ls * mix(1.0, phaseCloud(dot(dir, sunDir)), thin) + Lm * mix(1.0, phaseCloud(dot(dir, uMoonDir)), thin)) * light * 0.14;
      vec3 cCu = direct + amb * mix(1.0, 0.7, dCu);
      vec3 Tp = exp(-(uRayScat * 0.9 + uMieExt * 0.5) * tCu);
      cCu = cCu * Tp + skyIn * (1.0 - Tp);
      col = mix(col, cCu, (1.0 - exp(-dCu * cloudDensity * 9.0)) * smoothstep(0.0, 0.03, dir.y));
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
function lutTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        generateMipmaps: false,
    });
}
/** GPU lookup tables of the atmosphere; all passes are a single fullscreen triangle pair. */
class AtmosphereLuts {
    uniforms = {
        uRayScat: { value: RAYLEIGH_SCAT.clone() },
        uMieScat: { value: MIE_SCAT },
        uMieExt: { value: MIE_EXT },
        uOzoneAbs: { value: OZONE_ABS.clone() },
        uMieG: { value: 0.8 },
        uGroundAlbedo: { value: new THREE.Vector3(0.55, 0.57, 0.6) },
        uTransLUT: { value: null },
        uMultiLUT: { value: null },
    };
    transmittance = lutTarget(TRANS_W, TRANS_H);
    multiScatter = lutTarget(MULTI_N, MULTI_N);
    sunView = lutTarget(VIEW_W, VIEW_H);
    moonView = lutTarget(VIEW_W, VIEW_H);
    /** bumps whenever the medium changed and the views must be re-rendered */
    version = 0;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad;
    transMat;
    multiMat;
    viewMat;
    medium = [NaN, NaN, NaN];
    constructor() {
        this.uniforms.uTransLUT.value = this.transmittance.texture;
        this.uniforms.uMultiLUT.value = this.multiScatter.texture;
        const make = (name, fragmentShader, extra = {}) => new THREE.ShaderMaterial({
            name,
            uniforms: { ...this.uniforms, ...extra },
            vertexShader: QUAD_VERT,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.transMat = make('fox-atmo-transmittance', TRANS_FRAG);
        this.multiMat = make('fox-atmo-multiscatter', MULTI_FRAG);
        this.viewMat = make('fox-atmo-skyview', VIEW_FRAG, {
            uLight: { value: new THREE.Vector3(0, 1, 0) },
            uViewAlt: { value: VIEW_ALT },
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.transMat);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
    }
    /** Rebuild transmittance + multiple scattering when the medium changed (rayleigh / mie are multipliers). */
    updateMedium(renderer, rayleigh, mie, g) {
        const m = this.medium;
        if (m[0] === rayleigh && m[1] === mie && m[2] === g)
            return;
        m[0] = rayleigh;
        m[1] = mie;
        m[2] = g;
        const u = this.uniforms;
        u.uRayScat.value.copy(RAYLEIGH_SCAT).multiplyScalar(rayleigh);
        u.uMieScat.value = MIE_SCAT * mie;
        u.uMieExt.value = MIE_EXT * mie;
        u.uMieG.value = g;
        this.draw(renderer, this.transMat, this.transmittance);
        this.draw(renderer, this.multiMat, this.multiScatter);
        this.version++;
    }
    /** CPU twin of the transmittance LUT: sunlight reaching the observer from a body at cos zenith mu. */
    sunlight(mu, out) {
        const RG = 6360;
        const RT = 6460;
        const r = RG + VIEW_ALT;
        const d = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT));
        const u = this.uniforms;
        const ray = u.uRayScat.value;
        const mie = u.uMieExt.value;
        const N = 64;
        const dt = d / N;
        let oR = 0;
        let oG = 0;
        let oB = 0;
        for (let i = 0; i < N; i++) {
            const t = (i + 0.5) * dt;
            const h = Math.max(0, Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG);
            const rd = Math.exp(-h / 8) * dt;
            const md = Math.exp(-h / 1.2) * mie * dt;
            const od = Math.max(0, 1 - Math.abs(h - 25) / 15) * dt;
            oR += ray.x * rd + md + OZONE_ABS.x * od;
            oG += ray.y * rd + md + OZONE_ABS.y * od;
            oB += ray.z * rd + md + OZONE_ABS.z * od;
        }
        return out.setRGB(Math.exp(-oR), Math.exp(-oG), Math.exp(-oB));
    }
    renderView(renderer, target, light) {
        this.viewMat.uniforms.uLight.value.copy(light);
        this.draw(renderer, this.viewMat, target);
    }
    draw(renderer, material, target) {
        this.quad.material = material;
        const prev = renderer.getRenderTarget();
        const face = renderer.getActiveCubeFace();
        const level = renderer.getActiveMipmapLevel();
        renderer.setRenderTarget(target);
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(prev, face, level);
    }
}
function makeSkyMaterial(atmo, aurora) {
    const uniforms = {
        ...atmo.uniforms,
        ...aurora.uniforms,
        // medium controls (multipliers on the standard atmosphere; turbidity 2 = standard aerosols)
        turbidity: { value: 2 },
        rayleigh: { value: 1 },
        mieDirectionalG: { value: 0.8 },
        sunPosition: { value: new THREE.Vector3(0, 1, 0) },
        showSunDisc: { value: 1 },
        time: { value: 0 },
        cloudSpeed: { value: 0.00002 },
        cloudCoverage: { value: -0.3 },
        cloudDensity: { value: 0.5 },
        cirrusCoverage: { value: 0.1 },
        /** cloud-layer drift (km), advanced with the wind */
        uCloudOffset: { value: new THREE.Vector2() },
        uCirrusOffset: { value: new THREE.Vector2() },
        /** upper-level westerlies */
        uCirrusDir: { value: new THREE.Vector2(0.94, 0.34).normalize() },
        uSkyLUT: { value: atmo.sunView.texture },
        uMoonLUT: { value: atmo.moonView.texture },
        /** white-balanced sun irradiance above the atmosphere that the sky LUT is scaled by */
        uSunE: { value: new THREE.Vector3(5, 5, 5) },
        uMoonE: { value: 0 },
        uMoonTint: { value: new THREE.Color(0.78, 0.9, 1.15) },
        uViewAlt: { value: VIEW_ALT },
        /** sun disc radiance above the atmosphere */
        uSunDiscE: { value: new THREE.Vector3(400, 400, 400) },
        uNight: { value: 0 },
        uNightZenith: { value: new THREE.Color(0.0005, 0.0008, 0.0017) },
        uNightHorizon: { value: new THREE.Color(0.0017, 0.0024, 0.0034) },
        uAirglow: { value: new THREE.Color(0.00022, 0.0008, 0.00034) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonColor: { value: new THREE.Color(1.6, 1.55, 1.45) },
        uStarRot: { value: new THREE.Matrix3() },
        uStarIntensity: { value: 1 },
        uShowMoon: { value: 1 },
        uMoonHalo: { value: 0 },
        uBright: { value: packBrightStars() },
        uMilkyWay: { value: 0.02 },
        /** galactic north pole and centre in equatorial coordinates (J2000) */
        uGalN: { value: new THREE.Vector3(-0.86766, -0.19807, 0.45598) },
        uGalC: { value: new THREE.Vector3(-0.05487, -0.87342, -0.48387) },
        uIce: { value: 0.6 },
        uBank: { value: 0 },
        /** the open sea lies west of the fjord mouth: the bank sits west-south-west (x east, z south) */
        uBankDir: { value: new THREE.Vector2(-0.95, 0.31).normalize() },
        uAurFill: shared.uAuroraLight,
    };
    return new THREE.ShaderMaterial({
        name: 'fox-sky',
        uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
}
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
export class SkySystem {
    /** time of day in hours, 0–24 (21:45: the aurora is up) */
    hours = 21.75;
    /** in-game minutes per real second (0 = paused) */
    speed = 0;
    sunDir = new THREE.Vector3();
    moonDir = new THREE.Vector3();
    /** the key light (sun by day, moon by night). Casts the only shadows in the scene. */
    light;
    sky;
    skyMaterial;
    /** raw sky cubemap (sky, aurora and clouds, no discs or stars); also in shared.uSkyCube */
    cubeTarget;
    /** the northern lights: activity director, footprint map and the uniforms of the dome's raymarch */
    aurora;
    /** sun elevation in radians */
    sunElevation = 0;
    /** multiplier the key light shadow frustum uses; features may override for close-ups */
    shadowExtentOverride = null;
    /** the weather the sky is heading to (it eases there over ~half a minute) */
    weather = params.weather ?? 'bank';
    /** the eased weather mix; read it, don't write it */
    weatherLook = { ...WEATHER[params.weather ?? 'bank'] };
    engine;
    quality;
    atmo;
    envScene = new THREE.Scene();
    envSkyMaterial;
    envGround;
    cubeCamera;
    pmrem;
    envTarget = null;
    lastEnvSun = new THREE.Vector3(10, 10, 10);
    lastLutSun = new THREE.Vector3(10, 10, 10);
    lastLutMoon = new THREE.Vector3(10, 10, 10);
    lastEnvAurora = -1;
    lastCubeAurora = -1;
    lastEnvWeather = NaN;
    lutVersion = -1;
    whiteVersion = -1;
    zenithT = new THREE.Color(1, 1, 1);
    sunT = new THREE.Color(1, 1, 1);
    moonT = new THREE.Color(1, 1, 1);
    sunMu = NaN;
    moonMu = NaN;
    keyColor = new THREE.Color();
    envTimer = 0;
    envAge = 0;
    reflTimer = 0;
    /** aurora light baked into the current environment map */
    envFill = new THREE.Color(0, 0, 0);
    fogColor = new THREE.Color(0.02, 0.03, 0.05);
    fogTarget = new THREE.Color(0.02, 0.03, 0.05);
    readBufs = Array.from({ length: 5 }, () => new Uint16Array(4 * 4));
    syncBufs = Array.from({ length: 5 }, () => new Uint16Array(4 * 4));
    reading = false;
    resampleQueued = false;
    envGeneration = 0;
    /** jump the fog/sky colors to the next sample instead of easing (after setTime) */
    snapColors = true;
    skyColorTarget = new THREE.Color(0.02, 0.04, 0.08);
    lastEmittedHours = -1;
    gust = 0;
    vUp = new THREE.Vector3();
    vRight = new THREE.Vector3();
    vUp2 = new THREE.Vector3();
    vSnap = new THREE.Vector3();
    constructor(engine, quality) {
        this.engine = engine;
        this.quality = quality;
        const { scene, renderer } = engine;
        this.aurora = new AuroraSystem(renderer, quality);
        this.atmo = new AtmosphereLuts();
        this.skyMaterial = makeSkyMaterial(this.atmo, this.aurora);
        this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.skyMaterial);
        this.sky.name = 'sky';
        this.sky.scale.setScalar(20000);
        this.sky.frustumCulled = false;
        // after the opaque world: early depth rejects the dome (and its aurora raymarch) behind mountains
        this.sky.renderOrder = 1000;
        scene.add(this.sky);
        const u = this.skyMaterial.uniforms;
        // clean, dry polar air: a deep blue zenith, a crisp horizon, a small glow around the sun
        u.turbidity.value = 1.7;
        u.rayleigh.value = 1;
        u.mieDirectionalG.value = 0.8;
        // cumulus drift is cloudSpeed * 500 km/s (6 m/s), cirrus twice that
        u.cloudSpeed.value = 0.000012;
        // environment scene: same sky without discs and stars + a snowy ground hemisphere for bounce light
        // shares the dome's uniforms (the discs and stars are toggled while rendering); not a clone, which
        // would try to copy the render-target textures
        this.envSkyMaterial = new THREE.ShaderMaterial({
            name: 'fox-env-sky',
            uniforms: this.skyMaterial.uniforms,
            vertexShader: this.skyMaterial.vertexShader,
            fragmentShader: this.skyMaterial.fragmentShader,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        });
        const envSky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.envSkyMaterial);
        envSky.scale.setScalar(900);
        this.envScene.add(envSky);
        const groundGeo = new THREE.SphereGeometry(400, 32, 12, 0, Math.PI * 2, Math.PI * 0.515, Math.PI * 0.485);
        const groundMat = new THREE.ShaderMaterial({
            name: 'fox-env-ground',
            uniforms: {
                ...this.skyMaterial.uniforms,
                uKeyColor: shared.uLightColor,
                uKeyDir: shared.uLightDir,
                // snowfields, frozen lakes and the dark fjord and sea between them
                uAlbedo: { value: new THREE.Color(0.52, 0.55, 0.6) },
                uAurFill: shared.uAuroraLight,
            },
            vertexShader: QUAD_GROUND_VERT,
            fragmentShader: GROUND_FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        });
        this.envGround = new THREE.Mesh(groundGeo, groundMat);
        this.envScene.add(this.envGround);
        this.cubeTarget = this.makeCubeTarget(quality.envSize);
        this.cubeCamera = new THREE.CubeCamera(1, 2000, this.cubeTarget);
        this.envScene.add(this.cubeCamera);
        this.pmrem = new THREE.PMREMGenerator(renderer);
        this.light = new THREE.DirectionalLight(0xffffff, 3);
        this.light.name = 'sun';
        this.light.castShadow = true;
        this.light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
        this.light.shadow.bias = -0.00025;
        this.light.shadow.normalBias = 0.035;
        this.light.shadow.radius = quality.shadowRadius;
        this.light.shadow.camera.near = 1;
        this.light.shadow.camera.far = 900;
        scene.add(this.light, this.light.target);
        scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.0001);
        this.computeCelestial();
        this.aurora.update(0, this.hours, this.sunDir.y, engine.camera.position);
        this.updateSkyLuts(true);
        this.applyLighting(0);
        this.updateEnvironment(true);
    }
    makeCubeTarget(size) {
        const t = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
        t.texture.name = 'fox-sky-cube';
        shared.uSkyCube.value = t.texture;
        return t;
    }
    setQuality(q) {
        this.quality = q;
        this.light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        this.light.shadow.radius = q.shadowRadius;
        if (this.light.shadow.map) {
            this.light.shadow.map.dispose();
            this.light.shadow.map = null;
        }
        this.aurora.setQuality(q);
        if (q.envSize !== this.cubeTarget.width) {
            const old = this.cubeTarget;
            this.cubeTarget = this.makeCubeTarget(q.envSize);
            this.cubeCamera.renderTarget = this.cubeTarget;
            old.dispose();
            this.readBufs = Array.from({ length: 5 }, () => new Uint16Array(4 * 4));
        }
        this.updateEnvironment(true);
    }
    /** Change the weather; it eases over ~half a minute unless `instant`. */
    setWeather(name, instant = false) {
        this.weather = name;
        if (instant) {
            Object.assign(this.weatherLook, WEATHER[name]);
            this.applyLighting(0);
            this.updateEnvironment(true);
        }
        events.emit('weather-changed', { weather: name });
    }
    /** Force the aurora activity (0..1), or null to follow the clock again. */
    setAuroraActivity(activity) {
        this.aurora.activityOverride = activity;
    }
    /**
     * Jump the clock. `sync` (default) reads the new sky's fog colour back at once so no frame shows the old
     * one; the boot passes false (nothing is drawn yet), so the first sky compiles and renders without
     * stalling the main thread.
     */
    setTime(hours, sync = true) {
        this.hours = ((hours % 24) + 24) % 24;
        this.snapColors = true;
        this.computeCelestial();
        if (params.shot && params.auroraT === null)
            this.aurora.seekClock(this.hours);
        this.aurora.update(0, this.hours, this.sunDir.y, this.engine.camera.position);
        this.updateSkyLuts(true);
        this.applyLighting(0);
        this.updateEnvironment(true);
        // a time jump must not show the previous sky's fog and ambient for the frames an async read takes
        if (sync && this.sampleHorizonSync())
            this.applyLighting(0);
        this.emitTime();
    }
    emitTime() {
        if (Math.abs(this.hours - this.lastEmittedHours) > 1 / 120) {
            this.lastEmittedHours = this.hours;
            events.emit('time-changed', { hours: this.hours });
        }
    }
    computeCelestial() {
        sunDirection(this.hours, this.sunDir);
        moonDirection(this.hours, this.moonDir);
        this.sunElevation = Math.asin(THREE.MathUtils.clamp(this.sunDir.y, -1, 1));
        // world → equatorial frame at the local sidereal time (the celestial pole maps to (0, sin φ, −cos φ))
        const m = starRotation(this.hours);
        this.skyMaterial.uniforms.uStarRot.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    }
    /** Re-render the medium LUTs if its parameters changed, and the sky views when the sun or moon moved. */
    updateSkyLuts(force) {
        const { renderer } = this.engine;
        const u = this.skyMaterial.uniforms;
        this.atmo.updateMedium(renderer, u.rayleigh.value, u.turbidity.value / 2, u.mieDirectionalG.value);
        const stale = force || this.lutVersion !== this.atmo.version;
        this.lutVersion = this.atmo.version;
        if (stale || this.lastLutSun.distanceToSquared(this.sunDir) > 1e-9) {
            this.lastLutSun.copy(this.sunDir);
            this.atmo.renderView(renderer, this.atmo.sunView, this.sunDir);
        }
        if (stale || (u.uMoonE.value > 0 && this.lastLutMoon.distanceToSquared(this.moonDir) > 1e-8)) {
            this.lastLutMoon.copy(this.moonDir);
            this.atmo.renderView(renderer, this.atmo.moonView, this.moonDir);
        }
    }
    easeWeather(dt) {
        const target = WEATHER[this.weather];
        const k = Math.min(1, dt / 12);
        const W = this.weatherLook;
        for (const key of WEATHER_KEYS)
            W[key] += (target[key] - W[key]) * k;
    }
    /** a scalar that changes whenever the eased weather does (env refresh trigger) */
    weatherKey() {
        const W = this.weatherLook;
        return W.cumulus * 3.1 + W.cirrus * 1.7 + W.bank * 2.3 + W.overcast * 5.3 + W.density;
    }
    applyLighting(dt) {
        const sun = this.sunDir;
        const moon = this.moonDir;
        const u = this.skyMaterial.uniforms;
        const W = this.weatherLook;
        // the ~10° polar noon counts as full day; full night once the sun is ~12° down
        const day = smooth(sun.y, -0.07, 0.06);
        const night = 1 - smooth(sun.y, -0.21, -0.02);
        shared.uDay.value = day;
        shared.uNight.value = night;
        shared.uSunDir.value.copy(sun);
        shared.uMoonDir.value.copy(moon);
        shared.uOvercast.value = W.overcast;
        shared.uSnowfall.value = W.snowfall;
        u.sunPosition.value.copy(sun);
        u.uNight.value = night;
        u.uMoonDir.value.copy(moon);
        // the brightest stars show through the afterglow; the shader hides the ones fainter than the sky
        u.uStarIntensity.value = (1 - smooth(sun.y, -0.17, -0.04)) * (1 - W.overcast);
        const nightK = 1 - smooth(sun.y, -0.15, 0.05);
        const moonRad = lerp(0.075, 0.6, nightK);
        u.uMoonColor.value.setRGB(moonRad, 0.98 * moonRad, 0.94 * moonRad);
        u.uMoonHalo.value = nightK;
        // a high gibbous moon washes out the Milky Way (kept a little brighter than nature, so it still reads)
        u.uMilkyWay.value = 0.02 * (1 - 0.4 * smooth(moon.y, -0.05, 0.3));
        u.cloudCoverage.value = W.cumulus;
        u.cirrusCoverage.value = W.cirrus;
        u.cloudDensity.value = W.density;
        u.uBank.value = W.bank;
        u.uIce.value = W.ice;
        // white balance on a zenith sun; the light and the sky share the atmosphere's transmittance
        const atmo = this.atmo;
        if (this.whiteVersion !== atmo.version) {
            this.whiteVersion = atmo.version;
            atmo.sunlight(1, this.zenithT);
            this.sunMu = NaN;
            this.moonMu = NaN;
        }
        const zt = this.zenithT;
        if (sun.y !== this.sunMu) {
            this.sunMu = sun.y;
            atmo.sunlight(Math.max(sun.y, -0.002), this.sunT);
        }
        if (moon.y !== this.moonMu) {
            this.moonMu = moon.y;
            atmo.sunlight(Math.max(moon.y, -0.002), this.moonT);
        }
        // twilight: the eye keeps adapting through the long blue hour, so the afterglow gets a gain the exposure cannot give
        const twilight = 1 + 3.2 * (1 - smooth(sun.y, -0.12, 0.03));
        // without direct light the land lives on sky fill; snow bounce already lifts it, so less than a dark island needs
        this.engine.scene.environmentIntensity = 1 + 1.3 * (1 - smooth(sun.y, -0.06, 0.06));
        const skyE = SUN_KEY * SKY_GAIN * twilight;
        u.uSunE.value.set(skyE / zt.r, skyE / zt.g, skyE / zt.b);
        const discE = 300;
        u.uSunDiscE.value.set(discE / zt.r, discE / zt.g, discE / zt.b);
        // moonlit sky, kept dark enough for the aurora to own it
        u.uMoonE.value = 0.17 * (1 - smooth(sun.y, -0.12, 0.05));
        // key light: sun by day, moon by night, crossfading through zero at twilight
        const useSun = sun.y > -0.035;
        const dir = useSun ? sun : moon;
        const color = this.keyColor;
        let intensity;
        if (useSun) {
            const T = this.sunT;
            color.setRGB(T.r / zt.r, T.g / zt.g, T.b / zt.b);
            // the low sun all day long: a stronger key for alpenglow on the peaks and long blue shadows
            const lowSun = lerp(1.35, 1.0, smooth(sun.y, 0.05, 0.3));
            intensity = SUN_KEY * lowSun * smooth(sun.y, -0.02, 0.012);
        }
        else {
            const T = this.moonT;
            // scotopic: moonlight on snow reads blue and dim, but not cyan
            color.setRGB((0.42 * T.r) / zt.r, (0.56 * T.g) / zt.g, (1.0 * T.b) / zt.b);
            intensity = 0.3 * smooth(moon.y, 0.0, 0.25) * (1 - smooth(sun.y, -0.12, -0.035));
        }
        intensity *= 1 - 0.85 * W.overcast;
        this.light.color.copy(color);
        this.light.intensity = intensity;
        shared.uLightDir.value.copy(dir);
        shared.uLightColor.value.copy(color).multiplyScalar(intensity);
        // the aurora's own light (the dome draws it; features get the fill)
        const aur = this.aurora;
        shared.uAurora.value = aur.strength * (1 - W.overcast);
        shared.uAuroraLight.value.copy(aur.fill);
        // what the environment map does not hold yet (it was baked with envFill): IBL-lit materials add this
        const fill = shared.uAuroraFill.value;
        const ef = this.envFill;
        fill.setRGB(Math.max(aur.fill.r - ef.r, -0.5 * ef.r), Math.max(aur.fill.g - ef.g, -0.5 * ef.g), Math.max(aur.fill.b - ef.b, -0.5 * ef.b));
        shared.uAuroraDir.value.copy(aur.dir);
        // exposure: eyes adapt to moonlight; indoors the eye opens up a little; a blazing storm closes it a touch
        const target = sampleCurve(EXPOSURE_CURVE, sun.y) *
            (state.inside ? 1.16 : 1) *
            (1 - 0.12 * smooth(aur.strength, 0.5, 1.2)) *
            (1 + 0.15 * W.overcast);
        const cur = this.engine.exposure;
        this.engine.setExposure(dt > 0 ? cur + (target - cur) * Math.min(1, dt * 2) : target);
        shared.uExposure.value = this.engine.renderer.toneMappingExposure;
        // fog: ease toward the sampled horizon color; crisp arctic air, thick when it snows
        if (dt > 0) {
            this.fogColor.lerp(this.fogTarget, Math.min(1, dt * 1.5));
            shared.uSkyColor.value.lerp(this.skyColorTarget, Math.min(1, dt * 1.5));
        }
        else {
            this.fogColor.copy(this.fogTarget);
            shared.uSkyColor.value.copy(this.skyColorTarget);
        }
        const fog = this.engine.scene.fog;
        fog.color.copy(this.fogColor);
        fog.density = lerp(0.00011, 0.00008, day) * (1 + W.haze);
        shared.uHorizonColor.value.copy(this.fogColor);
    }
    /**
     * Re-render the raw sky cube (reflections): sky, aurora at low detail and clouds, without discs and stars.
     * `aurScale` scales the aurora (the IBL source keeps it at its physical share despite the night lift).
     */
    renderCube(aurScale = 1) {
        const { renderer } = this.engine;
        const u = this.skyMaterial.uniforms;
        const showSun = u.showSunDisc.value;
        const showMoon = u.uShowMoon.value;
        const stars = u.uStarIntensity.value;
        const gain = u.uAurGain.value;
        u.showSunDisc.value = 0;
        u.uShowMoon.value = 0;
        u.uStarIntensity.value = 0;
        u.uAurGain.value = gain * aurScale;
        this.aurora.beginEnvPass();
        this.cubeCamera.position.set(0, 0, 0);
        this.cubeCamera.update(renderer, this.envScene);
        this.aurora.endEnvPass();
        u.showSunDisc.value = showSun;
        u.uShowMoon.value = showMoon;
        u.uStarIntensity.value = stars;
        u.uAurGain.value = gain;
        this.lastCubeAurora = aurScale === 1 ? this.aurora.version : -1;
    }
    /**
     * Image-based lighting: re-render the cube and prefilter it when the sun moved, the weather changed,
     * or (every quality.envRefresh seconds) the aurora changed, so snow and glass take on its green.
     */
    updateEnvironment(force) {
        const q = this.quality;
        const sunMoved = this.lastEnvSun.distanceToSquared(this.sunDir) >= 1.5e-5;
        const aurMoved = this.aurora.version !== this.lastEnvAurora && q.envRefresh > 0 && this.envAge >= q.envRefresh;
        const wKey = this.weatherKey();
        const weatherMoved = !(Math.abs(wKey - this.lastEnvWeather) < 0.01);
        if (!force && !sunMoved && !aurMoved && !weatherMoved)
            return;
        this.lastEnvSun.copy(this.sunDir);
        this.lastEnvAurora = this.aurora.version;
        this.lastEnvWeather = wKey;
        this.envAge = 0;
        // the night lift of environmentIntensity is for the dim moonlit sky, not for the aurora's own light
        // and a blazing storm does not turn the snow mint: the eye adapts to it, so its share of the fill is compressed
        const adapt = 1 / (1 + smooth(this.aurora.strength, 0.45, 1.2));
        const aurScale = Math.min(1, (1.25 * adapt) / Math.max(this.engine.scene.environmentIntensity, 1e-3));
        const scaled = aurScale < 0.999 && this.aurora.uniforms.uAurOn.value > 0.5;
        this.renderCube(scaled ? aurScale : 1);
        this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget ?? undefined);
        this.engine.scene.environment = this.envTarget.texture;
        this.envFill.copy(this.aurora.fill);
        this.envGeneration++;
        void this.sampleHorizon();
        // the raw cube (reflections, fog colour) shows the aurora at full strength
        if (scaled)
            this.renderCube(1);
    }
    /**
     * Reads the horizon (4 side faces) and zenith of the sky cube back to the
     * CPU for the fog color and shared.uSkyColor. A request that arrives while
     * a read is in flight is queued, so the latest sky always wins.
     */
    async sampleHorizon() {
        if (this.reading) {
            this.resampleQueued = true;
            return;
        }
        this.reading = true;
        const generation = this.envGeneration;
        const { renderer } = this.engine;
        const mid = Math.floor(this.cubeTarget.width / 2);
        const bufs = this.readBufs;
        try {
            // all reads are issued at once and share one GPU fence wait
            await Promise.all(HORIZON_FACES.map((face, i) => renderer.readRenderTargetPixelsAsync(this.cubeTarget, mid - 1, face === 2 ? mid - 1 : mid, 2, 2, bufs[i], face)));
            // a cube re-render during the read mixes two skies; the queued resample follows
            if (generation === this.envGeneration)
                this.applyHorizonSamples(bufs);
        }
        catch {
            // readback unsupported: keep the previous fog color
        }
        finally {
            this.reading = false;
            if (this.resampleQueued) {
                this.resampleQueued = false;
                void this.sampleHorizon();
            }
        }
    }
    /** Blocking horizon read for discrete time jumps; false where readback is unsupported. */
    sampleHorizonSync() {
        const { renderer } = this.engine;
        const mid = Math.floor(this.cubeTarget.width / 2);
        try {
            HORIZON_FACES.forEach((face, i) => renderer.readRenderTargetPixels(this.cubeTarget, mid - 1, face === 2 ? mid - 1 : mid, 2, 2, this.syncBufs[i], face));
        }
        catch {
            return false;
        }
        this.snapColors = true;
        return this.applyHorizonSamples(this.syncBufs);
    }
    /** Averages a readback (4 horizon faces, then the zenith) into the fog and sky color targets. */
    applyHorizonSamples(bufs) {
        const hz = [0, 0, 0];
        const zen = [0, 0, 0];
        const avg = (buf, out) => {
            for (let i = 0; i < 4; i++) {
                out[0] += THREE.DataUtils.fromHalfFloat(buf[i * 4]) / 4;
                out[1] += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]) / 4;
                out[2] += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]) / 4;
            }
        };
        for (let i = 0; i < 4; i++)
            avg(bufs[i], hz);
        avg(bufs[4], zen);
        if (!Number.isFinite(hz[0] + hz[1] + hz[2] + zen[0] + zen[1] + zen[2]))
            return false;
        // cold air: the haze over snow is a little bluer than the sky right at the horizon
        this.fogTarget.setRGB((hz[0] / 4) * 0.9, (hz[1] / 4) * 0.94, (hz[2] / 4) * 1.0);
        // falling snow scatters every colour alike: under an overcast the haze turns a cool grey
        const grey = this.weatherLook.overcast * 0.85;
        if (grey > 0) {
            const f = this.fogTarget;
            const lum = 0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b;
            f.setRGB(f.r + (lum * 0.94 - f.r) * grey, f.g + (lum * 0.98 - f.g) * grey, f.b + (lum * 1.06 - f.b) * grey);
        }
        this.skyColorTarget.setRGB(zen[0], zen[1], zen[2]);
        if (this.snapColors) {
            this.snapColors = false;
            this.fogColor.copy(this.fogTarget);
            shared.uSkyColor.value.copy(this.skyColorTarget);
        }
        return true;
    }
    /** Per-frame update: advance time, weather, aurora, lighting, env map refresh, shadow frustum. */
    update(dt, elapsed) {
        if (this.speed !== 0) {
            this.hours = (((this.hours + (this.speed * dt) / 60) % 24) + 24) % 24;
            this.computeCelestial();
            this.emitTime();
        }
        shared.uTime.value = elapsed;
        const u = this.skyMaterial.uniforms;
        u.time.value = elapsed;
        const drift = u.cloudSpeed.value * 500 * dt;
        u.uCloudOffset.value.addScaledVector(shared.uWindDir.value, -drift);
        u.uCirrusOffset.value.addScaledVector(u.uCirrusDir.value, -2 * drift);
        // slow gusts; stronger when it snows
        this.gust += dt;
        shared.uWindStrength.value =
            (0.45 + 0.25 * Math.sin(this.gust * 0.13) * Math.sin(this.gust * 0.071 + 1.3) + 0.1 * Math.sin(this.gust * 0.53)) *
                (1 + 0.4 * this.weatherLook.snowfall);
        this.easeWeather(dt);
        this.aurora.occlusion = this.weatherLook.overcast;
        this.aurora.update(dt, this.hours, this.sunDir.y, this.engine.camera.position);
        this.applyLighting(dt);
        this.updateSkyLuts(false);
        this.envAge += dt;
        this.envTimer -= dt;
        if (this.envTimer <= 0) {
            this.envTimer = 0.4;
            this.updateEnvironment(false);
        }
        // reflections of a moving aurora (glass, ice, open water) refresh faster than the prefiltered lighting
        const q = this.quality;
        if (q.reflectRefresh > 0 && this.aurora.version !== this.lastCubeAurora) {
            this.reflTimer -= dt;
            if (this.reflTimer <= 0) {
                this.reflTimer = q.reflectRefresh;
                this.renderCube();
            }
        }
        const cam = this.engine.camera;
        this.sky.position.copy(cam.position);
        this.updateShadowFrustum();
    }
    updateShadowFrustum() {
        const cam = this.engine.camera;
        const focus = this.engine.focus;
        const dir = shared.uLightDir.value;
        const dist = cam.position.distanceTo(focus);
        const sinE = Math.max(dir.y, 0.05);
        // long low-sun shadows need a little more room around the focus
        const low = 1 - smooth(sinE, 0.12, 0.45);
        const extent = this.shadowExtentOverride ?? THREE.MathUtils.clamp(dist * 1.5 + 14, 26, 380) * (1 + 0.35 * low);
        const half = extent / 2;
        // the frustum's ground footprint stretches by 1/sin(elevation) along the light: pull the light back so
        // sunward casters and the far end of that footprint stay inside the depth range
        const back = Math.round(THREE.MathUtils.clamp(half / sinE + 120, 450, 4200) / 10) * 10;
        const far = back * 2;
        const sc = this.light.shadow.camera;
        if (sc.right !== half || sc.far !== far) {
            sc.left = -half;
            sc.right = half;
            sc.top = half;
            sc.bottom = -half;
            sc.near = 1;
            sc.far = far;
            sc.updateProjectionMatrix();
        }
        // depth bias in world units stays ~0.2 m whatever the depth range
        this.light.shadow.bias = (-0.00025 * 900) / far;
        this.light.shadow.normalBias = 0.02 + extent * 0.0004;
        // snap the focus to shadow texels to avoid shimmering
        const texel = extent / this.light.shadow.mapSize.x;
        const up = Math.abs(dir.y) > 0.99 ? this.vUp.set(0, 0, 1) : this.vUp.set(0, 1, 0);
        const right = this.vRight.crossVectors(up, dir).normalize();
        const up2 = this.vUp2.crossVectors(dir, right).normalize();
        const fx = Math.round(focus.dot(right) / texel) * texel;
        const fy = Math.round(focus.dot(up2) / texel) * texel;
        const fz = focus.dot(dir);
        const snapped = this.vSnap.set(0, 0, 0).addScaledVector(right, fx).addScaledVector(up2, fy).addScaledVector(dir, fz);
        this.light.target.position.copy(snapped);
        this.light.position.copy(snapped).addScaledVector(dir, back);
        this.light.target.updateMatrixWorld();
    }
}
