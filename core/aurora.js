/**
 * The northern lights of Foxfire Fjord: an activity director, a footprint map
 * pass and the raymarch the sky dome uses to draw them.
 *
 * 1. Director (CPU). Activity follows the clock (none by day, faint arcs at the
 *    end of the blue hour, a peak around half past ten), gated by darkness. On
 *    top of it runs a substorm cycle on real time: quiet arcs → growth (the
 *    main arc brightens and creeps toward the observer) → breakup (sudden
 *    brightening, folding, racing rays, a pink lower border) → expansion (the
 *    sky fills from overhead to the northern horizon, a corona at the magnetic
 *    zenith) → recovery (diffuse, pulsating patches). Everything is a pure
 *    function of the aurora clock, so `?auroraT=` reproduces any moment.
 *
 * 2. Footprint map (GPU, re-drawn while the aurora moves). A top-down map of
 *    the auroral oval around the observer in (east, north) km at 100 km
 *    altitude, radially warped so texels are fine overhead and coarse toward
 *    the horizon. Target 0 holds the signed distance (km) to four folded
 *    east–west arcs; target 1 the fold warp (the along-arc coordinate), the
 *    diffuse aurora and a smooth 'red source' for the 630 nm glow above the
 *    curtains (mipmapped, filtered over each ray step).
 *
 * 3. Raymarch (AURORA_GLSL, inside the sky shader). The view ray is cut into
 *    altitude strata (dense through the lower border). The ends of each stratum
 *    are followed down the tilted field line to their footprints (rays converge
 *    on a magnetic zenith ~12° south of overhead), where the map gives the
 *    distance to every sheet; the Gaussian sheet column along the stratum is
 *    integrated in closed form (erf), so thin sheets never alias and folds seen
 *    edge-on brighten by themselves. At the column's centroid the curtain's own
 *    structure is evaluated: distinct field-aligned rays (filtered by the pixel
 *    footprint), a crisp green 557.7 nm lower border, a magenta N2 hem in
 *    storms and violet N2+ where ray tops stand in sunlight. The red 630 nm
 *    tops are a smooth volume (the O(1D) glow is long-lived and blurs the rays).
 */
import * as THREE from 'three';
import { params } from './params.js';
/** footprint map extent (km) and warp knee (km): m = q·C/(K+|q|) */
const MAP_Q = 1200;
const MAP_K = 200;
/** visible aurora activity by local clock hour, before the darkness gate (0..1, ~Kp/9) */
export const AURORA_BY_HOUR = [
    [0, 0.62],
    [1.5, 0.52],
    [3, 0.38],
    [4.5, 0.24],
    [6, 0.1],
    [7.5, 0],
    [15.5, 0],
    [16.5, 0.14],
    [18, 0.32],
    [19.5, 0.46],
    [21, 0.66],
    [22.5, 0.86],
    [23.5, 0.74],
    [24, 0.62],
];
export function sampleCurve(curve, x) {
    if (x <= curve[0][0])
        return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
        const [x1, y1] = curve[i];
        if (x <= x1) {
            const [x0, y0] = curve[i - 1];
            const t = (x - x0) / (x1 - x0);
            return y0 + (y1 - y0) * t * t * (3 - 2 * t);
        }
    }
    return curve[curve.length - 1][1];
}
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
/** how dark the sky must be to see the aurora: 0 above ~-4°, 1 below ~-11° sun elevation */
export function auroraDarkness(sunY) {
    return 1 - smooth(sunY, -0.2, -0.075);
}
/** base (hourly) activity times the darkness gate, without substorms: for clocks and charts */
export function auroraActivityAt(hours, sunY) {
    return sampleCurve(AURORA_BY_HOUR, ((hours % 24) + 24) % 24) * auroraDarkness(sunY);
}
const PHASES = ['quiet', 'growth', 'breakup', 'expansion', 'recovery'];
const PHASE_SECONDS = [34, 40, 9, 32, 62];
function hash1(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}
/** cycle length scale for cycle k (0.8 … 1.25) */
function cycleScale(k) {
    return 0.8 + 0.45 * hash1(k + 0.5);
}
/** phase index and progress at aurora time T (seconds) */
function phaseAt(T) {
    const base = PHASE_SECONDS.reduce((a, b) => a + b, 0);
    let t = Math.max(0, T);
    let k = 0;
    // a few hundred cycles at most for any sensible clock
    while (k < 100000) {
        const len = base * cycleScale(k);
        if (t < len)
            break;
        t -= len;
        k++;
    }
    const s = cycleScale(k);
    for (let i = 0; i < PHASES.length; i++) {
        const d = PHASE_SECONDS[i] * s;
        if (t < d || i === PHASES.length - 1)
            return { k, phase: i, p: Math.min(1, t / d) };
        t -= d;
    }
    return { k, phase: 0, p: 0 };
}
const LOOK_KEYS = ['bright', 'arcY', 'spacing', 'fold', 'storm', 'raySpeed', 'warpSpeed', 'driftSpeed', 'diffuse', 'pulse', 'sharp', 'w0', 'w1', 'w2', 'w3'];
/**
 * Keyframes at the start of each phase (index 5 = end of recovery = next quiet) for activity A.
 * The arcs are laid out so the main views (north, over the peaks across the fjord) always hold
 * some aurora: quiet arcs stand ~25–40° up with fainter poleward arcs below them, and even when
 * the main arc moves overhead the poleward arcs keep the northern sky lit.
 */
function keyframes(A) {
    // how violent the substorms get
    const amp = smooth(A, 0.15, 0.95);
    // lower border elevation of the main arc: ~29° (quiet evening) … ~37° (quiet but active) before a substorm,
    // ~44° in the growth phase, overhead (a corona at the magnetic zenith) at the height of an expansion, ~55° after
    const yQuiet = lerp(200, 128, A);
    const yGrowth = yQuiet - lerp(18, 55, amp);
    const yPeak = lerp(yGrowth - 25, -26, amp);
    const yRec = lerp(yGrowth, 62, amp);
    const b0 = lerp(0.45, 1.0, A);
    const storm0 = 0.3 * smooth(A, 0.55, 1.0);
    const sp0 = lerp(85, 70, A);
    const quiet = {
        bright: b0,
        arcY: yQuiet,
        spacing: sp0,
        fold: 0.55,
        storm: storm0,
        raySpeed: 0.8,
        warpSpeed: 0.8,
        driftSpeed: -0.3,
        diffuse: 0.35,
        pulse: 0,
        sharp: 0.3,
        w0: 1,
        w1: 0.34,
        w2: 0.16,
        w3: 0.08,
    };
    const growth = { ...quiet, bright: b0 * 1.08, arcY: yQuiet - 4, sharp: 0.38 };
    const breakup = {
        ...quiet,
        bright: b0 * (1 + 0.45 * amp),
        arcY: yGrowth,
        spacing: sp0 * 0.9,
        fold: 0.62,
        storm: storm0 + 0.15 * amp,
        raySpeed: 1.6,
        warpSpeed: 1.3,
        driftSpeed: -0.7,
        diffuse: 0.3,
        sharp: 0.62,
        w0: 1.2,
        w1: 0.5,
        w2: 0.24,
        w3: 0.12,
    };
    const expansion = {
        bright: b0 * (1 + 1.3 * amp),
        arcY: yPeak,
        spacing: lerp(70, 92, amp),
        fold: lerp(0.8, 1.15, amp),
        storm: Math.min(1, storm0 + 0.7 * amp),
        raySpeed: lerp(2.5, 6.5, amp),
        warpSpeed: lerp(1.8, 3.6, amp),
        driftSpeed: -lerp(1, 4.5, amp),
        diffuse: 0.55,
        pulse: 0,
        sharp: 1,
        w0: 1.35,
        w1: 1.0,
        w2: 0.8,
        w3: 0.55,
    };
    const recovery = {
        ...expansion,
        bright: b0 * (1 + 0.6 * amp),
        arcY: yRec,
        fold: lerp(0.75, 1.0, amp),
        storm: storm0 + 0.25 * amp,
        raySpeed: lerp(1.6, 3, amp),
        warpSpeed: 1.6,
        driftSpeed: -1.2,
        diffuse: 0.9,
        pulse: 0.3,
        sharp: 0.75,
        w0: 1.05,
        w1: 0.85,
        w2: 0.65,
        w3: 0.45,
    };
    const late = {
        ...quiet,
        bright: b0 * 0.8,
        arcY: lerp(yRec, yQuiet, 0.75),
        spacing: sp0 * 1.1,
        fold: 0.55,
        storm: storm0,
        diffuse: 1.0,
        pulse: lerp(0.4, 1, amp),
        sharp: 0.35,
        w0: 0.75,
        w1: 0.55,
        w2: 0.4,
        w3: 0.25,
    };
    return [quiet, growth, breakup, expansion, recovery, late];
}
/**
 * The aurora clock a screenshot shows at a given clock time when ?auroraT= is not set, so a series of shots
 * walks through a substorm: 21:45 a brightening arc (late growth), 22:30 the breakup, 23:00 the expansion with
 * its corona, after midnight the pulsating recovery, early evening quiet arcs.
 */
export function shotAuroraT(hours) {
    const fromNoon = (((hours - 12) % 24) + 24) % 24;
    const T = 72 + 24 * (fromNoon - 9.75);
    const len = PHASE_SECONDS.reduce((a, b) => a + b, 0) * cycleScale(0);
    return ((T % len) + len) % len;
}
/** easing inside each phase: the breakup is a sudden ignition, the rest drifts */
function easePhase(phase, p) {
    if (phase === 2)
        return 1 - Math.pow(1 - p, 3) * (1 - p);
    // growth creeps in; the expansion lingers overhead (the corona) before the arcs drift poleward
    if (phase === 1 || phase === 3)
        return p * p;
    return p * p * (3 - 2 * p);
}
function evalLook(A, T, out) {
    const { phase, p } = phaseAt(T);
    const keys = keyframes(A);
    // recovery spans two keys: fade to the late state, which is where the next quiet phase starts
    let a;
    let b;
    let e;
    if (phase === 4) {
        a = keys[4];
        b = keys[5];
        e = easePhase(4, p);
    }
    else if (phase === 0) {
        a = keys[5];
        b = keys[1];
        e = easePhase(0, p);
    }
    else {
        a = keys[phase];
        b = keys[phase + 1];
        e = easePhase(phase, p);
    }
    for (const key of LOOK_KEYS)
        out[key] = a[key] + (b[key] - a[key]) * e;
    // slow breathing on top
    out.bright *= 1 + 0.12 * Math.sin(T * 0.21) * Math.sin(T * 0.13 + 1.1);
    return { phase: PHASES[phase], p };
}
// ---------------------------------------------------------------------------------------------
// shaders
const NOISE_GLSL = /* glsl */ `
float aH11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float aH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 aG22(vec2 i) {
  vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
// value noise 0..1
float aVn1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(aH11(i), aH11(i + 1.0), u);
}
// gradient noise about -1..1
float aGn2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(aG22(i), f);
  float b = dot(aG22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(aG22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(aG22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
float aFbm2(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    s += a * aGn2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s;
}
float aFbm1(float x) {
  return 0.55 * aVn1(x) + 0.3 * aVn1(x * 2.13 + 5.1) + 0.15 * aVn1(x * 4.37 + 1.7);
}
`;
const MAP_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
/**
 * Footprint map pass (GLSL 3, two outputs):
 *   gDist: signed distance (km, at 100 km altitude) to each of the four folded arcs
 *   gAux:  r = fold warp offset along the arcs (km; gives the along-sheet coordinate),
 *          g = diffuse and pulsating aurora (volume emission per km, premultiplied),
 *          b = red source: the arcs blurred over ~25 km, for the smooth 630 nm glow above them
 */
const MAP_FRAG = /* glsl */ `
layout(location = 0) out vec4 gDist;
layout(location = 1) out vec4 gAux;
uniform vec2 uRes;
uniform float uT;
uniform float uWarpPhase;
uniform float uDrift;
uniform float uArcY;
uniform float uSpacing;
uniform float uFold;
uniform float uPulse;
uniform float uDiffuse;
uniform vec4 uArcW;

const float MAP_Q = ${MAP_Q.toFixed(1)};
const float MAP_K = ${MAP_K.toFixed(1)};
${NOISE_GLSL}

// inverse of the radial warp m = q·C/(K+|q|), C = (Q+K)/Q
vec2 mapToKm(vec2 uv) {
  vec2 m = uv * 2.0 - 1.0;
  float a = length(m);
  float c = (MAP_Q + MAP_K) / MAP_Q;
  if (a >= c * 0.995) return m / max(a, 1e-6) * 1e5;
  float r = MAP_K * a / (c - a);
  return a > 1e-6 ? m * (r / a) : vec2(0.0);
}

// the domain warp: big swirls and surges, then folds that bend the east-west arcs into S-shapes and curls
vec2 auroraWarp(vec2 p) {
  float wp = uWarpPhase;
  vec2 w = p + vec2(aFbm2(p * 0.0048 + vec2(wp * 0.05, 3.7)), aFbm2(p * 0.0048 + vec2(8.3, -wp * 0.04))) * vec2(95.0, 120.0) * uFold;
  w += vec2(aGn2(w * 0.016 + vec2(wp * 0.21, 1.3)), aGn2(w * 0.016 + vec2(5.1, wp * 0.17))) * vec2(16.0, 20.0) * uFold;
  w += vec2(0.0, aGn2(w * 0.06 + vec2(wp * 0.4, 9.0))) * 2.2 * uFold;
  return w;
}

// north offset of arc i at warped east coordinate x
float arcLine(float x, float fi) {
  float wp = uWarpPhase;
  // the poleward arcs meander more, so they never run parallel to the main arc for long
  return (30.0 * sin(x * 0.0035 + fi * 1.7 + wp * 0.012) + 34.0 * (aFbm1(x * 0.0068 + fi * 11.0 + wp * 0.03) - 0.5)) * (1.0 + 0.35 * fi);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = mapToKm(uv);
  vec2 p = q + vec2(uDrift, 0.0);
  vec2 w = auroraWarp(p);
  // Jacobian of the warp by finite differences (smooth everywhere, unlike per-quad screen derivatives)
  const float EPS = 0.25;
  mat2 Jw = mat2((auroraWarp(p + vec2(EPS, 0.0)) - w) / EPS, (auroraWarp(p + vec2(0.0, EPS)) - w) / EPS);

  // pin the main arc due north of the observer to the director's distance (its elevation is part of the
  // composition), whatever the warp does there; elsewhere the arcs wander freely
  vec2 pT = vec2(uDrift, uArcY);
  vec2 wT = auroraWarp(pT);
  float pin = wT.y - pT.y - arcLine(wT.x, 0.0);

  vec4 dist;
  float offs[4];
  offs[0] = 0.0;
  offs[1] = uSpacing;
  offs[2] = uSpacing * 2.4;
  offs[3] = uSpacing * 4.2;
  float red = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    // the oval curves toward the pole at the ends of each arc; the poleward arcs are slowly turned against each other,
    // so seen from the fjord they converge and part across the sky instead of stacking up as parallel bands
    float tilt = fi > 0.5 ? 0.2 * sin(fi * 2.3 + 0.7 + uWarpPhase * 0.006) : 0.0;
    float yc = uArcY + offs[i] + arcLine(w.x, fi) + pin + q.x * q.x / 7000.0 + tilt * q.x;
    float d = w.y - yc;
    // distance to the folded sheet: d over its gradient in km (chain rule through the warp)
    float slope = (arcLine(w.x + 0.5, fi) - arcLine(w.x - 0.5, fi));
    vec2 gq = vec2(-slope, 1.0) * Jw - vec2(2.0 * q.x / 7000.0 + tilt, 0.0);
    float di = clamp(d / clamp(length(gq), 0.25, 8.0), -160.0, 160.0);
    dist[i] = di;
    red += uArcW[i] * exp(-di * di / 600.0);
  }

  // diffuse aurora equatorward of the arcs, with pulsating patches during recovery; per km of path,
  // and a ray near the horizon crosses hundreds of km of it, so it stays very faint
  float band = smoothstep(uArcY - 420.0, uArcY - 220.0, w.y) * (1.0 - smoothstep(uArcY - 30.0, uArcY + 20.0, w.y));
  float poleward = smoothstep(uArcY - 10.0, uArcY + 30.0, w.y) * (1.0 - smoothstep(uArcY + 150.0, uArcY + 450.0, w.y));
  float cloudy = smoothstep(-0.25, 0.7, aFbm2(p * 0.011 + vec2(0.0, uT * 0.006)));
  float Id = uDiffuse * (0.0024 * band * (0.3 + 0.7 * cloudy) + 0.001 * poleward * cloudy);
  vec2 cellP = p / 38.0 + vec2(aGn2(p * 0.02), aGn2(p * 0.02 + 4.0)) * 0.6;
  vec2 cell = floor(cellP);
  vec2 cf = fract(cellP) - 0.5;
  float ch = aH21(cell);
  float period = 5.0 + 10.0 * aH21(cell + 17.0);
  float blink = smoothstep(0.2, 0.9, sin(6.2832 * (uT / period + ch)));
  float blob = smoothstep(0.5, 0.1, length(cf) * (0.8 + 0.5 * aH21(cell + 3.0)));
  Id += uPulse * 0.016 * band * blob * blink * step(0.35, aH21(cell + 9.0));
  float edge = 1.0 - smoothstep(900.0, 1150.0, length(q));
  // the red glow follows the arcs' brightness along their length, smoothly
  red *= 0.45 + 0.55 * smoothstep(0.15, 0.75, aFbm1(w.x * 0.004 + 3.0));

  gDist = dist;
  gAux = vec4(w.x - p.x, Id * edge, red * edge, 1.0);
}
`;
/**
 * GLSL for the sky shader. Needs ATMO_COMMON (RG, earthShadow) and a uViewAlt uniform before it.
 * auroraRadiance(dir, sunDir, px) returns linear radiance (already scaled by the visibility gain).
 */
export const AURORA_GLSL = /* glsl */ `
uniform sampler2D uAurDist;
uniform sampler2D uAurAux;
uniform float uAurOn;
uniform float uAurSteps;
uniform float uAurGain;
uniform vec2 uAurCam;
uniform vec4 uAurArcW;
uniform float uAurThick;
uniform float uAurStorm;
uniform float uAurRayPhase;
uniform float uAurT;
uniform float uAurDrift;
uniform float uAurDebug;
uniform float uAurDebugScale;
/** 2 / footprint map size: the map's texel in warped units */
uniform float uAurTexel;
/** ray contrast: homogeneous quiet arcs (~0.3) … rayed, racing curtains in a breakup (1) */
uniform float uAurRays;
/** 2 = all ray scales, 1 = no fine texture (low quality), 0 = no rays (environment pass) */
uniform float uAurDetail;
uniform vec3 uAurGreen;
uniform vec3 uAurRed;
uniform vec3 uAurPink;
uniform vec3 uAurBlue;

const float AUR_Q = ${MAP_Q.toFixed(1)};
const float AUR_K = ${MAP_K.toFixed(1)};
const float AUR_C = (AUR_Q + AUR_K) / AUR_Q;
// tan of the field line's tilt from the vertical (inclination ~78°)
const float AUR_TILT = 0.2126;
// extra thickness (km) of a sheet the ray grazes
const float AUR_GRAZE = 3.0;

float aurH11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 aurH31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float aurVn1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(aurH11(i), aurH11(i + 1.0), f * f * (3.0 - 2.0 * f));
}
float aurFbm1(float x) {
  return 0.55 * aurVn1(x) + 0.3 * aurVn1(x * 2.13 + 5.1) + 0.15 * aurVn1(x * 4.37 + 1.7);
}

// altitude (km) of the strata boundaries: fine through the lower border (~92–125 km), coarse up high
float aurAlt(float f) {
  float f2 = f * f;
  return 88.0 + 51.5 * f + 260.5 * f2 * f2 * f;
}

vec2 aurUv(vec2 q) {
  return q * (AUR_C / (AUR_K + length(q))) * 0.5 + 0.5;
}

float aurShell(float r0, float h, float mu) {
  float b = r0 * mu;
  float c = h * (2.0 * r0 + h);
  return c / (b + sqrt(b * b + c));
}

// integral over [a, b] of a two-sided exponential peaking at pk (scale lo below, hi above)
float aurInt(float a, float b, float pk, float lo, float hi) {
  float s = 0.0;
  float a1 = min(a, pk);
  float b1 = min(b, pk);
  if (b1 > a1) s += lo * (exp((b1 - pk) / lo) - exp((a1 - pk) / lo));
  float a2 = max(a, pk);
  float b2 = max(b, pk);
  if (b2 > a2) s += hi * (exp(-(a2 - pk) / hi) - exp(-(b2 - pk) / hi));
  return s;
}
// mean of that profile over [h0, h1] (or its value when the window is tiny)
float aurMean(float h0, float h1, float pk, float lo, float hi) {
  if (h1 - h0 < 0.05) {
    float h = 0.5 * (h0 + h1);
    return h < pk ? exp((h - pk) / lo) : exp((pk - h) / hi);
  }
  return aurInt(h0, h1, pk, lo, hi) / (h1 - h0);
}

float aurErf(float x) {
  float x2 = x * x;
  float ax2 = 0.147 * x2;
  return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + ax2) / (1.0 + ax2)));
}

vec4 aurErf4(vec4 x) {
  vec4 x2 = x * x;
  vec4 ax2 = 0.147 * x2;
  return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + ax2) / (1.0 + ax2)));
}

// A Gaussian sheet exp(-(d/th)²) seen along four linear pieces of a stratum (d runs from a to b on each): the mean
// weight on each piece (erf in closed form) and the centroid of that weight within the piece (0..1). Smooth in a
// and b, so nothing steps as a sheet slides along a ray.
vec4 aurPieces(vec4 a, vec4 b, float th, out vec4 c) {
  vec4 kd = b - a;
  vec4 ak = abs(kd);
  vec4 sk = (step(0.0, kd) * 2.0 - 1.0) * max(ak, vec4(1e-3 * th));
  vec4 ia = a / th;
  vec4 ib = b / th;
  vec4 mid = 0.5 * (ia + ib);
  vec4 col = 0.8862269 * th / sk * (aurErf4(ib) - aurErf4(ia));
  vec4 blend = smoothstep(vec4(0.03 * th), vec4(0.12 * th), ak);
  vec4 I1 = (0.5 * th * th * (exp(-ia * ia) - exp(-ib * ib)) / sk - a * col) / sk;
  c = mix(vec4(0.5), clamp(I1 / max(col, vec4(1e-7)), 0.0, 1.0), blend);
  return max(mix(exp(-mid * mid), col, blend), 0.0);
}
vec4 aurPieces(vec4 a, vec4 b, float th) {
  vec4 kd = b - a;
  vec4 ak = abs(kd);
  vec4 sk = (step(0.0, kd) * 2.0 - 1.0) * max(ak, vec4(1e-3 * th));
  vec4 mid = 0.5 * (a + b) / th;
  vec4 col = 0.8862269 * th / sk * (aurErf4(b / th) - aurErf4(a / th));
  return max(mix(exp(-mid * mid), col, smoothstep(vec4(0.03 * th), vec4(0.12 * th), ak)), 0.0);
}

// One layer of field-aligned rays along a curtain, normalised to a mean of 1: one soft streak per cell (jittered
// position, width and brightness; a heavy tail, so a few rays stand out). x is in cells, fpc the pixel footprint in
// cells: streaks narrower than the pixel melt into their mean, so distant curtains never shimmer. ht returns the
// brightness-weighted height class (0..1) of the rays here.
float aurRays(float x, float seed, float fpc, float flick, float wmin, float wmax, out float ht) {
  float kf = smoothstep(0.3, 1.1, fpc);
  ht = 0.45;
  if (kf >= 1.0) return 1.0;
  // E[b] · √π · E[width]
  float mean = 0.48 * 1.7725 * (wmin + (wmax - wmin) / 3.0);
  float i0 = floor(x);
  float sum = 0.0;
  float hs = 0.0;
  float fp2 = 0.3 * fpc * fpc;
  for (int j = -1; j <= 1; j++) {
    float ci = i0 + float(j);
    vec3 h = aurH31(ci * 1.37 + seed);
    float c = ci + 0.15 + 0.7 * h.x;
    float wd = mix(wmin, wmax, h.y * h.y);
    float b = 0.18 + 1.2 * h.z * h.z * h.z;
    // each ray brightens and fades on its own clock (the mean is kept)
    b *= 1.0 + flick * 0.55 * sin(uAurT * (0.7 + 1.9 * h.y) + h.x * 31.0);
    // convolved with the pixel footprint: same integral, wider
    float we = sqrt(wd * wd + fp2);
    float d = (x - c) / we;
    float g = exp(-d * d) * wd / we;
    sum += b * g;
    hs += b * g * fract(h.z * 7.13 + h.x * 3.1);
  }
  ht = mix(hs / max(sum, 1e-4), 0.45, kf);
  return mix(sum / mean, 1.0, kf);
}

// The curtain's emission averaged over the altitudes [h0, h1] the ray spends inside the sheet: the bright lower
// border, the body above it (the roots of the rays), the rays fading upward, and the storm colours.
vec3 aurCurtain(float h0, float h1, float hb, float Hray, float rc, float hemK, float R, float Rb, vec3 cRay, float pinkK, float redK, float blueK) {
  float hem = aurMean(h0, h1, hb + 0.7, 0.6, 3.0);
  float body = aurMean(h0, h1, hb + 1.4, 1.0, mix(9.0, 7.0, rc));
  float ray = aurMean(h0, h1, hb + 2.4, 1.5, Hray);
  vec3 e = cRay * (hemK * hem * mix(1.0, Rb, 0.6) + mix(0.9, 0.5, rc) * body * Rb + mix(0.18, 0.5, rc) * ray * R);
  // the magenta N2 hem of a storm curtain hangs just below the green border
  if (pinkK > 0.0) e += uAurPink * (aurMean(h0, h1, hb - 2.4, 1.8, 1.6) * pinkK);
  // red tips on the tallest rays in a storm (the smooth red glow is drawn separately)
  if (redK > 0.0) e += uAurRed * (aurMean(h0, h1, 205.0, 40.0, 90.0) * redK);
  // ray tops still in sunlight scatter the violet N2+ band
  if (blueK > 0.0) e += uAurBlue * (aurMean(h0, h1, hb + 30.0, 14.0, 110.0) * blueK);
  return e;
}

// where the view ray at altitude h maps to on the footprint map: the field line followed down to 100 km
vec2 aurFoot(vec2 hd, float sinZ, float mu, float r0, float h, out float t) {
  t = aurShell(r0, h - uViewAlt, mu);
  vec2 q = hd * (RG * atan(t * sinZ, r0 + t * mu)) + uAurCam;
  q.y += AUR_TILT * (h - 100.0);
  return q;
}

vec3 auroraRadiance(vec3 dir, vec3 sunDir, float px) {
  float mu = max(dir.y, 0.0);
  float sinZ = sqrt(max(0.0, 1.0 - mu * mu));
  vec2 hd = vec2(dir.x, -dir.z);
  float hl = length(hd);
  hd = hl > 1e-5 ? hd / hl : vec2(0.0, 1.0);
  vec2 side = vec2(-hd.y, hd.x);
  float r0 = RG + uViewAlt;
  bool sunNear = sunDir.y > -0.42;
  float st = uAurStorm;
  float rc = uAurRays;
  bool rays = uAurDetail > 0.5;

  float hA = aurAlt(0.0);
  float tA;
  vec2 qA = aurFoot(hd, sinZ, mu, r0, hA, tA);
  vec4 dA = textureLod(uAurDist, aurUv(qA), 0.0);
  vec3 acc = vec3(0.0);
  // path already spent inside each sheet along this ray (the edge-on soft limit applies to the total)
  vec4 spent = vec4(0.0);
  vec4 dbg = vec4(0.0);

  for (int i = 0; i < 64; i++) {
    if (float(i) >= uAurSteps) break;
    float fB = (float(i) + 1.0) / uAurSteps;
    float hB = aurAlt(fB);
    float tB;
    vec2 qB = aurFoot(hd, sinZ, mu, r0, hB, tB);
    vec4 dB = textureLod(uAurDist, aurUv(qB), 0.0);
    float L = tB - tA;
    float dh = max(hB - hA, 1e-3);
    float fpx = max(px * 0.5 * (tA + tB), 0.02);

    // smooth volumes (red glow, diffuse aurora) at the stratum's middle, filtered over the step
    float hM = aurAlt(fB - 0.5 / uAurSteps);
    float tMid;
    vec2 qM = aurFoot(hd, sinZ, mu, r0, hM, tMid);
    vec2 uvM = aurUv(qM);
    vec2 gS = aurUv(qM + side * max(fpx, 6.0)) - uvM;
    vec4 xM = textureGrad(uAurAux, uvM, aurUv(qB) - aurUv(qA), gS);
    // 630 nm: long-lived, so the glow above the curtains is smooth; it only shows in active displays
    float redK = 0.0011 * smoothstep(0.2, 0.9, st) * st * xM.b;
    if (redK > 1e-5 && abs(uAurDebug - 6.0) > 0.5) acc += uAurRed * redK * aurInt(hA, hB, mix(240.0, 215.0, st), 40.0, 110.0) * (L / dh);
    // diffuse and pulsating aurora: a faint slab around 100–140 km
    if (xM.g > 1e-6 && abs(uAurDebug - 6.0) > 0.5) acc += uAurGreen * xM.g * aurInt(hA, hB, 106.0, 3.0, 22.0) * (L / dh);

    // d along the stratum is a parabola through its ends and its middle, cut into four linear pieces: a fold that
    // grazes the ray is followed smoothly (straight pieces between fixed altitudes drew contour lines across it)
    vec4 dM = textureLod(uAurDist, uvM, 0.0);
    float m = clamp((hM - hA) / dh, 0.1, 0.9);
    float im = 1.0 - m;
    vec4 d1 = dA * (0.25 * (2.0 - m)) + dM * ((2.0 - m) / (4.0 * im)) - dB * (m * m / (4.0 * im));
    vec4 d3 = dM * ((1.0 + m) / (4.0 * m)) + dB * (0.25 * (1.0 + m)) - dA * (im * im / (4.0 * m));
    vec4 ell = vec4(0.5 * m, 0.5 * m, 0.5 * im, 0.5 * im);
    vec4 us = vec4(0.0, 0.5 * m, m, m + 0.5 * im);
    // how far the footprint moves across this stratum (km), and per km of altitude
    float lq = length(qB - qA);
    float rate = lq / dh;
    // the map's texel (km) here: local slopes are measured over a few texels, so its bilinear kinks never show
    float qMl = AUR_K + length(qM);
    float texKm = uAurTexel * qMl * qMl / (AUR_C * AUR_K);
    float dlt = clamp(2.5 * texKm / max(rate, 1e-3), 0.15 * dh, 0.6 * dh);

    for (int k = 0; k < 4; k++) {
      float w = uAurArcW[k];
      if (w < 0.004 || abs(uAurDebug - 7.0) < 0.5) continue;
      vec4 n0 = vec4(dA[k], d1[k], dM[k], d3[k]);
      vec4 n1 = vec4(d1[k], dM[k], d3[k], dB[k]);
      float fk = float(k);
      float th = uAurThick * (1.0 + 0.15 * fk);
      float thE = sqrt(th * th + 0.25 * fpx * fpx);
      float thH = thE * 6.0 + 3.0;
      vec4 an = min(abs(n0), abs(n1));
      float near = min(min(an.x, an.y), min(an.z, an.w));
      if (near > 2.6 * thH && all(greaterThan(n0 * n1, vec4(0.0)))) continue;
      // A ray grazing a sheet (a fold seen edge-on) depends on where exactly it passes, which the map only knows to
      // a few hundred metres: there the sheet is thickened (same column), as a real, rippled sheet would look.
      float gz = 1.0 - smoothstep(0.1, 0.35, abs(dB[k] - dA[k]) / max(lq, 1e-3));
      float thW = sqrt(thE * thE + gz * AUR_GRAZE * AUR_GRAZE);
      vec4 cj;
      vec4 wj = aurPieces(n0, n1, thW, cj) * ell * (thE / thW);
      float Wg = wj.x + wj.y + wj.z + wj.w;
      vec4 cjH;
      vec4 wjH = aurPieces(n0, n1, thH, cjH) * ell;
      float WH = wjH.x + wjH.y + wjH.z + wjH.w;
      // the share of the sheet's crossings that falls into this stratum: it telescopes across the pieces and the
      // strata, so a crossing sliding from one stratum into the next hands its weight over without a seam
      float share = dot(abs(aurErf4(n1 / thE) - aurErf4(n0 / thE)), vec4(0.5));
      if (Wg + share + 0.045 * WH < 1e-6) continue;

      // where the ray meets the sheet here (the centroid of the weight)
      float U = Wg > 1e-30 ? clamp(dot(wj, us + cj * ell) / Wg, 0.0, 1.0) : 0.5;
      // d's slope there and its curvature (per stratum), from the parabola
      float slope = dA[k] * (2.0 * U - m - 1.0) / m - dM[k] * (2.0 * U - 1.0) / (m * im) + dB[k] * (2.0 * U - m) / im;
      float curv = 2.0 * (dA[k] / m - dM[k] / (m * im) + dB[k] / im);
      // how spread out that meeting is (variance in strata²)
      float V = 1.0 / (12.0 + 2.0 * slope * slope / (thE * thE) + 1.5 * abs(curv) / thE);
      float hS0 = hA + dh * U;

      // The crossing refined on the map itself: three samples around the centroid give the local slope and bend of d,
      // the nearest root of that parabola is where the ray pierces the sheet. Its column (√π·th over the slope) and
      // the altitudes it lights depend only on the ray and the sheet, never on where the strata or their pieces
      // happen to end, so a curtain seen obliquely shades smoothly instead of in bands at fixed altitudes.
      // (strata that only hold the faint glow around a sheet skip this)
      float bb = slope / dh;
      float x = 0.0;
      float b1 = bb;
      float cl = 0.0;
      float rateL = rate;
      if (share > 2e-3 || Wg > 2e-3) {
        float tq;
        // The parabola through three samples 10-40 km of footprint apart can put the centroid kilometres off the true
        // crossing; the ray pattern read there then slid sideways within each stratum (rays zigzagging up the sky).
        // When the stratum's ends straddle the sheet, two false-position steps on the map itself start the refinement.
        if (dA[k] * dB[k] < 0.0) {
          float lo = 0.0;
          float hi = 1.0;
          float flo = dA[k];
          float fhi = dB[k];
          for (int it = 0; it < 2; it++) {
            float span = hi - lo;
            float uu = clamp((lo * fhi - hi * flo) / (fhi - flo), lo + 0.05 * span, hi - 0.05 * span);
            float fu = textureLod(uAurDist, aurUv(aurFoot(hd, sinZ, mu, r0, hA + dh * uu, tq)), 0.0)[k];
            if (fu * flo > 0.0) {
              lo = uu;
              flo = fu;
            } else {
              hi = uu;
              fhi = fu;
            }
          }
          hS0 = hA + dh * (lo * fhi - hi * flo) / (fhi - flo);
        }
        vec2 q0 = aurFoot(hd, sinZ, mu, r0, hS0, tq);
        vec2 qm = aurFoot(hd, sinZ, mu, r0, hS0 - dlt, tq);
        vec2 qp = aurFoot(hd, sinZ, mu, r0, hS0 + dlt, tq);
        float e0 = textureLod(uAurDist, aurUv(q0), 0.0)[k];
        float em = textureLod(uAurDist, aurUv(qm), 0.0)[k];
        float ep = textureLod(uAurDist, aurUv(qp), 0.0)[k];
        bb = (ep - em) / (2.0 * dlt);
        float cc = (ep - 2.0 * e0 + em) / (2.0 * dlt * dlt);
        float disc = bb * bb - 4.0 * cc * e0;
        float sb = bb < 0.0 ? -1.0 : 1.0;
        x = clamp(-2.0 * e0 / (bb + sb * (sqrt(max(disc, 0.0)) + 1e-6)), -1.5 * dlt, 1.5 * dlt);
        b1 = bb + 2.0 * cc * x;
        // clean: the sheet is crossed, and d runs well past it before it could bend back (a grazing ray is not)
        cl = disc > 0.0 ? smoothstep(1.0, 4.0, b1 * b1 / (4.0 * abs(cc) * thE + 1e-9)) : 0.0;
        rateL = length(qp - qm) / (2.0 * dlt);
        // a ray that pierces the sheet more than once inside this stratum (a ripple or a fold seen obliquely) is no
        // single crossing: one root here and another in the next stratum drew a ray zigzagging between them
        cl *= 1.0 - smoothstep(1.15, 1.7, share);
      }
      float Wc = share * min(1.7725 * thE / max(abs(b1) * dh, 1e-6), 1.0);
      float W = mix(Wg, Wc, cl);
      float dP = (W + 0.045 * WH) * L;
      if (dP < 1e-4) continue;
      // edge-on folds brighten, but a real sheet is not a perfect plane: the total path inside it is soft-limited
      float P0 = spent[k];
      float P1 = P0 + dP;
      spent[k] = P1;
      float path = P1 / (1.0 + P1 / 22.0) - P0 / (1.0 + P0 / 22.0);
      // the share of the sheet itself; the rest is the glow, drawn with a smooth profile over the whole stratum
      float pathC = path * W / (W + 0.045 * WH);
      float pathH = path - pathC;

      float hS = hS0 + cl * x;
      float tS;
      vec2 qS = aurFoot(hd, sinZ, mu, r0, hS, tS);
      // the angle between the ray's footprint track and the sheet (sin): 1 crossing it square, 0 running along it;
      // a ray running up a field line (the corona) has no track, so it counts as square
      float sinRaw = mix(abs(bb), abs(b1), cl) / max(rateL, 1e-4);
      float sinP = mix(1.0, clamp(sinRaw, 0.06, 1.0), smoothstep(0.03, 0.12, rateL));
      // the spread of the meeting along the stratum: one crossing's own width, or the gap between several
      vec4 Uj = us + cj * ell - U;
      float sdev = sqrt(max(V, dot(wj, Uj * Uj) / max(Wg, 1e-30)));
      // footprint along the curtain: the pixel's width across an oblique sheet, plus how far along it the ray travels
      // while inside it (a sheet seen edge-on averages many rays, so folds glow instead of hatching)
      float cosP = sqrt(1.0 - sinP * sinP);
      float travel = max(min(1.7725 * thE * cosP / sinP, 40.0), (1.0 - cl) * lq * cosP * 3.0 * sdev);
      if (uAurDebug > 4.5) sinP = 1.0;
      float fpL = max(px * tS, 0.02);
      float fpS = sqrt(fpL * fpL / (sinP * sinP) + travel * travel);
      vec2 wS = side * max(fpL, 0.04);
      float warpS = textureGrad(uAurAux, aurUv(qS), aurUv(qS + 0.5 * wS) - aurUv(qS - 0.5 * wS), vec2(0.0)).r;
      // coordinate along the arc (km)
      float s = qS.x + uAurDrift + warpS + fk * 137.0;

      // brightness along the curtain: long bright stretches, fainter gaps and a few bright knots
      // (the poleward arcs break into long fragments, so the northern sky never reads as stacked parallel ribbons)
      float gapF = min(fk, 1.0) * (1.0 - smoothstep(0.55, 0.95, rc));
      float patchy = mix(0.22, 0.0, gapF) + mix(0.78, 1.0, gapF) * smoothstep(mix(0.28, 0.46, gapF), mix(0.72, 0.66, gapF), aurFbm1(s * 0.0058 + fk * 2.3 + uAurT * 0.0035));
      float knot = aurVn1(s * 0.019 + fk * 7.1 - uAurT * 0.011);
      patchy *= 0.75 + 0.9 * knot * knot * knot;
      float I = w * patchy * (1.0 - smoothstep(900.0, 1150.0, length(qS)));

      // ray structure: broad bundles, distinct rays and (up close) fine striations, drifting at different speeds
      float R = 1.0;
      float hf = 0.4;
      float bund = 1.0;
      if (rays) {
        float htB;
        float htR;
        float htF;
        float rB = aurRays((s + 0.4 * uAurRayPhase) / 16.0, 11.7 + fk * 5.0, fpS / 16.0, 0.3 * rc, 0.2, 0.45, htB);
        float rR = aurRays((s - uAurRayPhase) / 4.5, 3.1 + fk * 17.0, fpS / 4.5, 0.7 * rc, 0.16, 0.42, htR);
        float rF = uAurDetail > 1.5 ? aurRays((s - 1.7 * uAurRayPhase) / 1.1, 23.3 + fk * 3.0, fpS / 1.1, 0.9 * rc, 0.18, 0.45, htF) : 1.0;
        // quiet arcs are nearly homogeneous ribbons, active curtains are rayed through and through
        R = mix(1.0, rB, 0.45 + 0.4 * rc) * mix(1.0, rR, 0.22 + 0.73 * rc) * mix(1.0, rF, 0.2 + 0.4 * rc);
        // each ray's own top: most stay low, the bright ones climb
        hf = clamp(htR * (0.5 + 0.2 * min(rR, 3.0)) * (0.6 + 0.4 * htB), 0.0, 1.0);
        bund = rB;
      }
      // lower border ~100 km, undulating slowly; in storms it sags a little along the brightest stretches (smoothly,
      // over tens of km: a border that dipped under each ray bundle read as a row of teeth)
      float hb = 100.0 + 7.0 * (aurVn1(s * 0.013 + fk * 4.0) - 0.5) - 2.5 * st * smoothstep(0.3, 0.8, aurVn1(s * 0.04 + fk * 9.0));
      // ray heights: most rays climb well above the bright band, a few tall ones far higher (they fill the sky
      // between a curtain and the next one behind it, so the arcs never read as a stack of flat ribbons)
      float Hray = mix(mix(12.0, 16.0, rc), mix(30.0, 52.0, st), smoothstep(0.0, 0.85, hf));
      float Rb = mix(1.0, R, 0.3 + 0.6 * rc);
      // the main arc has the crisp bright border; the poleward arcs are softer bands (until a storm sharpens them all)
      float hemK = mix(1.1, mix(0.55, 1.0, smoothstep(0.6, 1.0, rc)), min(fk, 1.0));
      // high up the green line weakens against the blue N2+ band: ray tops shade toward teal
      vec3 cRay = mix(uAurGreen, vec3(0.08, 0.8, 0.7), 0.4 * smoothstep(115.0, 185.0, hS));
      // (a continuous fringe that brightens under the bright bundles, not a dot at the foot of each ray)
      float pinkK = smoothstep(0.45, 0.9, st) * (0.45 + 0.55 * smoothstep(0.5, 1.8, bund)) * mix(1.0, Rb, 0.3) * 0.45;
      // (630 nm lives ~100 s, so the red tops blur the rays into their bundles)
      float redT = 0.035 * smoothstep(0.35, 0.9, st) * st * mix(1.0, bund, 0.5);
      float blueK = 0.0;
      if (sunNear) {
        vec3 P = vec3(0.0, r0, 0.0) + dir * tS;
        float rP = length(P);
        blueK = earthShadow(rP, dot(P, sunDir) / rP) * (0.25 + 0.75 * hf) * R * 0.5;
      }
      vec3 e = vec3(0.0);
      // a clean crossing lights the altitudes the ray spends inside the sheet around its root
      if (cl > 0.0) {
        float wC = min(1.7725 * thE / max(abs(b1), 1e-4), 40.0);
        e += (cl * Wc) * aurCurtain(hS - 0.5 * wC, hS + 0.5 * wC, hb, Hray, rc, hemK, R, Rb, cRay, pinkK, redT, blueK);
      }
      // a grazing ray, piece by piece: on each linear piece of the stratum the sheet is a box √π·th/|slope| wide at
      // that piece's own centroid (kept inside the piece); a ray running along the sheet spreads over whole pieces
      if (cl < 1.0) {
        vec4 wdt = min(vec4(1.0), 1.7725 * thW / max(abs(n1 - n0), vec4(1e-4)));
        vec4 lo = clamp(cj - 0.5 * wdt, vec4(0.0), 1.0 - wdt);
        vec4 a0 = hA + dh * (us + ell * lo);
        vec4 a1 = a0 + dh * ell * wdt;
        vec3 eg = vec3(0.0);
        float wsum = 0.0;
        for (int j = 0; j < 4; j++) {
          float wpj = wj[j];
          if (wpj < 0.015 * Wg) continue;
          eg += wpj * aurCurtain(a0[j], a1[j], hb, Hray, rc, hemK, R, Rb, cRay, pinkK, redT, blueK);
          wsum += wpj;
        }
        e += ((1.0 - cl) * Wg / max(wsum, 1e-30)) * eg;
      }
      e /= max(W, 1e-30);
      if (uAurDebug > 0.5 && uAurDebug < 1.5) e = (mod(float(i), 2.0) < 0.5 ? vec3(1.0, 0.1, 0.0) : vec3(0.0, 0.3, 1.0)) * dot(e, vec3(0.3, 0.6, 0.1)) * (k == 0 ? 1.0 : 0.4);
      if (uAurDebug > 1.5 && uAurDebug < 4.5) {
        float wd = W * L;
        if (uAurDebug < 2.5) dbg += vec4(fract(s / 4.5), U, cl, 1.0) * wd;
        else if (uAurDebug < 3.5) dbg += vec4(R * 0.3, cl, sinP, 1.0) * wd;
        else dbg += vec4(fract(hS / 2.0), fpS / 4.0, travel / 4.0, 1.0) * wd;
      }
      acc += e * (I * pathC);
      // the faint scattered glow around the sheet, at its own centroid and spread
      if (pathH > 1e-5) {
        float UH = clamp(dot(wjH, us + cjH * ell) / max(WH, 1e-30), 0.0, 1.0);
        float winH = 3.0 * dh / sqrt(12.0 + 2.0 * slope * slope / (thH * thH));
        float hH = hA + dh * UH;
        acc += uAurGreen * (1.5 * aurMean(hH - 0.5 * winH, hH + 0.5 * winH, hb + 1.4, 1.5, 10.0) * I * pathH);
      }
    }

    hA = hB;
    tA = tB;
    qA = qB;
    dA = dB;
  }
  if (uAurDebug > 1.5 && uAurDebug < 4.5) return dbg.rgb / max(dbg.a, 1e-6) * uAurDebugScale * smoothstep(0.0, 0.5, dbg.a);
  return acc * uAurGain;
}
`;
/** linear colours of the emission lines (sRGB primaries) */
const GREEN = new THREE.Color(0.14, 1.0, 0.42);
const RED = new THREE.Color(1.0, 0.05, 0.2);
const PINK = new THREE.Color(1.0, 0.12, 0.5);
const BLUE = new THREE.Color(0.32, 0.12, 1.0);
/** radiance per unit of sheet emission × km of path */
const GAIN = 0.12;
export class AuroraSystem {
    renderer;
    /** uniforms consumed by the sky shader (AURORA_GLSL) */
    uniforms = {
        uAurDist: { value: null },
        uAurAux: { value: null },
        uAurOn: { value: 0 },
        uAurSteps: { value: 24 },
        uAurGain: { value: 0 },
        /** observer offset from the map centre (east, north km) */
        uAurCam: { value: new THREE.Vector2() },
        /** brightness of the four arcs */
        uAurArcW: { value: new THREE.Vector4(1, 0.5, 0.25, 0.1) },
        /** sheet thickness scale (km) */
        uAurThick: { value: 1.2 },
        uAurStorm: { value: 0 },
        uAurRayPhase: { value: 0 },
        uAurT: { value: 0 },
        uAurDrift: { value: 0 },
        /** debug views: 1 strata parity, 2 ray coordinate / centroid / clean crossing, 3 rays / clean / track angle,
         *  4 crossing altitude / ray footprints (scaled by uAurDebugScale), 5 no oblique ray blur, 6 sheets only, 7 volumes only */
        uAurDebug: { value: 0 },
        uAurDebugScale: { value: 0.02 },
        uAurTexel: { value: 2 / 512 },
        uAurRays: { value: 0.5 },
        uAurDetail: { value: 2 },
        uAurGreen: { value: GREEN.clone() },
        uAurRed: { value: RED.clone() },
        uAurPink: { value: PINK.clone() },
        uAurBlue: { value: BLUE.clone() },
    };
    /** aurora clock (real seconds; frozen in screenshot mode) */
    time;
    /** clock speed: 1 = real time */
    timeScale = 1;
    /** forces the base activity (0..1), e.g. from ?aurora= or a forecast setting; null = follow the clock */
    activityOverride = params.aurora;
    /** multiplies the hourly curve (a 'forecast'): 0.5 quiet … 1 active … 1.4 storm */
    forecast = 1;
    /** 0..1 how much of the sky is covered (weather); dims the light the aurora casts */
    occlusion = 0;
    /** overall brightness multiplier (tuning) */
    gainScale = 1;
    info = { phase: 'quiet', progress: 0, activity: 0, visible: 0 };
    /** visible activity × brightness, 0..1-ish: what shared.uAurora carries */
    strength = 0;
    /** linear irradiance the aurora casts on an up-facing surface */
    fill = new THREE.Color(0, 0, 0);
    /** unit direction toward the brightest arc (world) */
    dir = new THREE.Vector3(0, 0.45, -0.89);
    /** bumps whenever the footprint map or the gain changed (reflection and env refreshes key on it) */
    version = 0;
    target;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    material;
    look = {};
    rayPhase = 0;
    warpPhase = 0;
    drift = 0;
    frame = 0;
    mapEvery = 1;
    lastMapKey = '';
    steps = 24;
    detail = 2;
    lastHours = 21.75;
    constructor(renderer, quality) {
        this.renderer = renderer;
        this.time = 0;
        this.timeScale = params.shot ? 0 : 1;
        this.target = this.makeTarget(quality.auroraMapSize);
        this.material = new THREE.ShaderMaterial({
            name: 'fox-aurora-map',
            glslVersion: THREE.GLSL3,
            uniforms: {
                uRes: { value: new THREE.Vector2(quality.auroraMapSize, quality.auroraMapSize) },
                uT: { value: 0 },
                uWarpPhase: { value: 0 },
                uDrift: { value: 0 },
                uArcY: { value: 300 },
                uSpacing: { value: 50 },
                uFold: { value: 0.5 },
                uPulse: { value: 0 },
                uDiffuse: { value: 0.3 },
                uArcW: { value: new THREE.Vector4(1, 0.5, 0.25, 0.1) },
            },
            vertexShader: MAP_VERT,
            fragmentShader: MAP_FRAG,
            depthTest: false,
            depthWrite: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        quad.frustumCulled = false;
        this.scene.add(quad);
        this.setQuality(quality);
        // replay the phases from zero so a given clock always looks the same
        // a live start lands ~20 s before the first breakup
        this.seek(params.auroraT ?? (params.shot ? 72 : 60));
    }
    /** Screenshots without ?auroraT=: jump to the moment of the substorm cycle this clock time stands for. */
    seekClock(hours) {
        this.lastHours = hours;
        this.seek(shotAuroraT(hours));
    }
    makeTarget(size) {
        const t = new THREE.WebGLRenderTarget(size, size, {
            count: 2,
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            generateMipmaps: false,
        });
        const [dist, aux] = t.textures;
        dist.name = 'fox-aurora-sheets';
        aux.name = 'fox-aurora-aux';
        // the aux map (fold warp, diffuse glow, red source) is filtered over each step's footprint
        aux.minFilter = THREE.LinearMipmapLinearFilter;
        aux.generateMipmaps = true;
        aux.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.uniforms.uAurDist.value = dist;
        this.uniforms.uAurTexel.value = 2 / size;
        this.uniforms.uAurAux.value = aux;
        return t;
    }
    setQuality(q) {
        if (this.target && this.target.width !== q.auroraMapSize) {
            this.target.dispose();
            this.target = this.makeTarget(q.auroraMapSize);
            this.material.uniforms.uRes.value.set(q.auroraMapSize, q.auroraMapSize);
            this.lastMapKey = '';
        }
        this.steps = q.auroraSteps;
        this.detail = q.name === 'low' ? 1 : 2;
        this.uniforms.uAurSteps.value = q.auroraSteps;
        this.uniforms.uAurDetail.value = this.detail;
        this.mapEvery = q.name === 'low' ? 2 : 1;
    }
    /** ray-march steps for the low-detail environment pass */
    get envSteps() {
        return Math.max(8, Math.round(this.steps * 0.5));
    }
    /** low-detail settings for the environment pass */
    beginEnvPass() {
        this.uniforms.uAurSteps.value = this.envSteps;
        this.uniforms.uAurDetail.value = 0;
    }
    endEnvPass() {
        this.uniforms.uAurSteps.value = this.steps;
        this.uniforms.uAurDetail.value = this.detail;
    }
    /** Jump the aurora clock to T seconds (replays the speed integrals from zero, so any T looks the same every time). */
    seek(T) {
        this.rayPhase = 0;
        this.warpPhase = 0;
        this.drift = 0;
        this.time = Math.max(0, T);
        this.integrate(0, this.time, 0.1);
        this.lastMapKey = '';
    }
    /** advance the speed integrals (ray drift, fold evolution, westward surge) from t0 to t1 */
    integrate(t0, t1, step) {
        const A = this.baseActivity(this.lastHours);
        let t = t0;
        const L = {};
        while (t < t1 - 1e-9) {
            const h = Math.min(step, t1 - t);
            evalLook(A, t + h * 0.5, L);
            this.rayPhase += L.raySpeed * h;
            this.warpPhase += L.warpSpeed * h;
            this.drift += L.driftSpeed * h;
            t += h;
        }
    }
    baseActivity(hours) {
        if (this.activityOverride !== null)
            return THREE.MathUtils.clamp(this.activityOverride, 0, 1);
        return THREE.MathUtils.clamp(sampleCurve(AURORA_BY_HOUR, hours) * this.forecast, 0, 1);
    }
    /**
     * Per frame: advance the director and redraw the footprint map when needed.
     * `sunY` is the sine of the sun's elevation; `camera` the observer (world metres).
     */
    update(dt, hours, sunY, camera) {
        this.lastHours = hours;
        if (camera)
            this.uniforms.uAurCam.value.set(camera.x * 0.001, -camera.z * 0.001);
        const A = this.baseActivity(hours);
        const dark = auroraDarkness(sunY);
        const vis = A * dark;
        const step = dt * this.timeScale;
        if (step > 0) {
            const L = this.look;
            evalLook(A, this.time + step * 0.5, L);
            this.rayPhase += L.raySpeed * step;
            this.warpPhase += L.warpSpeed * step;
            this.drift += L.driftSpeed * step;
            this.time += step;
        }
        const st = evalLook(A, this.time, this.look);
        const L = this.look;
        const info = this.info;
        info.phase = st.phase;
        info.progress = st.p;
        info.activity = A;
        info.visible = vis;
        // faint arcs at low activity also look fainter; brightness rides on the substorm look
        const on = vis > 0.003;
        const gain = GAIN * this.gainScale * smooth(vis, 0.0, 0.3) * (0.4 + 0.6 * Math.min(1, A / 0.6));
        const gainNow = on ? gain : 0;
        const u = this.uniforms;
        if (Math.abs(gainNow - u.uAurGain.value) > 1e-6 * (1 + gainNow))
            this.version++;
        u.uAurOn.value = on ? 1 : 0;
        u.uAurGain.value = gainNow;
        this.strength = on ? THREE.MathUtils.clamp(vis * L.bright * 0.75, 0, 1.5) : 0;
        this.estimateFill(gain, L);
        if (!on)
            return;
        this.frame++;
        u.uAurArcW.value.set(L.w0, L.w1, L.w2, L.w3).multiplyScalar(L.bright);
        u.uAurThick.value = lerp(1.7, 0.7, L.sharp);
        u.uAurStorm.value = L.storm;
        u.uAurRays.value = lerp(0.35, 1.0, smooth(L.sharp, 0.25, 0.9));
        u.uAurRayPhase.value = this.rayPhase;
        u.uAurT.value = this.time;
        u.uAurDrift.value = this.drift;
        const mu = this.material.uniforms;
        mu.uT.value = this.time;
        mu.uWarpPhase.value = this.warpPhase;
        mu.uDrift.value = this.drift;
        mu.uArcY.value = L.arcY;
        mu.uSpacing.value = L.spacing;
        mu.uFold.value = L.fold;
        mu.uPulse.value = L.pulse;
        mu.uDiffuse.value = L.diffuse;
        mu.uArcW.value.copy(u.uAurArcW.value);
        // the map only depends on these; a frozen clock draws it once
        const key = `${this.time.toFixed(3)}|${A.toFixed(4)}|${this.target.width}`;
        if (key === this.lastMapKey)
            return;
        if (this.lastMapKey && this.frame % this.mapEvery !== 0)
            return;
        this.lastMapKey = key;
        this.renderMap();
        this.version++;
    }
    renderMap() {
        const r = this.renderer;
        const prev = r.getRenderTarget();
        const face = r.getActiveCubeFace();
        const level = r.getActiveMipmapLevel();
        r.setRenderTarget(this.target);
        r.render(this.scene, this.camera);
        r.setRenderTarget(prev, face, level);
    }
    /**
     * Irradiance on a horizontal surface from the arcs (each a sheet at distance y, emitting from
     * ~100 km up) plus the diffuse glow overhead. Analytic, so it can pulse every frame.
     */
    estimateFill(gain, L) {
        // the brightest arc: its lower border ~105 km up, toward magnetic north
        const y = Math.max(Math.abs(L.arcY), 1);
        const elev = Math.atan2(105 - (y * y) / 12742, y);
        const north = L.arcY >= 0 ? -1 : 1;
        this.dir.set(0, Math.sin(elev), north * Math.cos(elev)).normalize();
        if (gain <= 0) {
            this.fill.setRGB(0, 0, 0);
            return;
        }
        const h = 120;
        // irradiance of an infinitely long east–west line source at distance y, height h, per unit radiant intensity
        const sheet = (yy) => (2 * h) / (yy * yy + h * h);
        const sp = L.spacing;
        // a curtain's column (√π·thickness × mean along-arc brightness) × its altitude-profile integral (~35 km)
        const column = 1.6 * 35;
        let E = 0;
        E += L.w0 * sheet(L.arcY) + L.w1 * sheet(L.arcY + sp) + L.w2 * sheet(L.arcY + sp * 2.4) + L.w3 * sheet(L.arcY + sp * 4.2);
        E *= column * 0.5;
        // diffuse layer: a slab of faint emission × ~40 km column over part of the sky
        const over = 1 / (1 + Math.pow(Math.max(0, L.arcY - 100) / 300, 2));
        E += (L.diffuse * 0.0024 + L.pulse * 0.002) * 40 * Math.PI * 0.5 * over;
        E *= L.bright * gain * (1 - 0.9 * this.occlusion);
        const red = 0.04 + 0.2 * L.storm;
        const pink = 0.06 * L.storm * L.storm;
        this.fill.setRGB(E * (GREEN.r + RED.r * red + PINK.r * pink), E * (GREEN.g + RED.g * red + PINK.g * pink), E * (GREEN.b + RED.b * red + PINK.b * pink));
    }
    dispose() {
        this.target.dispose();
        this.material.dispose();
    }
}
