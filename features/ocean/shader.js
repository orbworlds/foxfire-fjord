/**
 * Foxfire Fjord's sea: a cold, dark winter fjord. Linear HDR out (tone mapping
 * happens in post).
 *
 * Vertex: a low Gerstner swell filtered by the local mesh spacing, damped in
 * shallow water, far away, in the sheltered fjord and under the ice, plus a
 * gentle shoreward swash that travels along the baked shore-distance field.
 *
 * Fragment: the sea ice first. Shore-fast ice (the fjord head, sheltered
 * coves, the harbour) and drifting floes stand a freeboard above the water, so
 * the view ray meets their tops a little before it reaches the sea: near the
 * camera the slabs show their wet side walls and a submerged ice foot glows
 * under the water round them. Floes are warped Voronoi plates with ragged
 * edges, some broken into pieces by narrow leads; the tops carry wind-packed
 * snow, grey scoured patches and young ice that mirrors the sky; pancake ice
 * with raised rims drifts in fields off the ice edge. The open water between
 * is near-black over black sand and rock, rippled out at sea and almost a
 * mirror on the sheltered fjord: the sky and the aurora come from the
 * mirrored-sky render (mirror.ts), the shores and the Teeth from a ray march
 * over the height grid. Grease ice dulls the water by the shores and the
 * swash leaves lumpy grey slush instead of white surf. A horizon blend into
 * the sky colour of the same azimuth finishes it.
 */
import { SNOW_GLSL } from '../../core/snow.js';
const COMMON = /* glsl */ `
uniform float uTime;
uniform vec4 uWaveA[WAVES];
uniform vec4 uWaveB[WAVES];
uniform sampler2D uHeightTex;
uniform vec4 uHeightXf;
uniform sampler2D uCoastTex;
uniform vec4 uCoastXf;
uniform sampler2D uIceTex;
uniform sampler2D uNoise;
uniform float uSurfAmp;

const float SURF_K = 6.2831853 / 14.0;
const float SURF_W = 0.8;

float seabed(vec2 xz) { return texture2D(uHeightTex, xz * uHeightXf.xz + uHeightXf.yw).r; }
vec4 coastAt(vec2 xz) { return texture2D(uCoastTex, xz * uCoastXf.xz + uCoastXf.yw); }
// r shelter, g shore-fast ice, b drift ice, a slush / grease ice
vec4 iceAt(vec2 xz) { return texture2D(uIceTex, xz * uCoastXf.xz + uCoastXf.yw); }

// smooth fBm, about one feature per unit of p: two incommensurate, rotated lookups of the
// noise's low-frequency channel, so it never shows the texture's tiling
float nS(vec2 p, vec2 o) {
  float a = texture2D(uNoise, p * 0.25 + o).r;
  float b = texture2D(uNoise, mat2(0.6, -0.8, 0.8, 0.6) * p * 0.3433 + o.yx + 0.37).r;
  return (a * 0.62 + b * 0.38 - 0.5) * 1.37 + 0.5;
}

// shoreward-travelling swash: phase grows offshore, so crests move toward the beach
float surfPhase(float sd, vec2 xz, float t) {
  float n = nS(xz * (1.0 / 160.0), vec2(0.37, 0.12));
  return sd * SURF_K + t * SURF_W - n * 11.0;
}
float surfEnvelope(float sd) {
  return smoothstep(60.0, 20.0, sd) * mix(0.42, 1.0, smoothstep(0.0, 8.0, sd)) * smoothstep(-5.0, -1.5, sd);
}
float surfShape(float ph) {
  float s = 0.5 + 0.5 * sin(ph);
  return s * s - 0.375;
}
// waves die in shallow water, far away, in the sheltered fjord and under the ice
float waveAtt(float depth, float camDist, vec4 ice) {
  return smoothstep(0.1, 3.0, depth) * (1.0 - smoothstep(2500.0, 9000.0, camDist)) * mix(1.0, 0.12, smoothstep(0.45, 0.8, ice.r)) * (1.0 - ice.g);
}
`;
export const OCEAN_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aCell;
${COMMON}
varying vec3 vWorld;
varying vec2 vXZ;
varying float vCrest;
varying float vViewZ;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp.xz;
  float depth = -seabed(xz);
  float camDist = length(xz - cameraPosition.xz);
  vec4 ice = iceAt(xz);
  float att = waveAtt(depth, camDist, ice);
  vec3 disp = vec3(0.0);
  for (int i = 0; i < WAVES; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float A = a.w * att * (1.0 - smoothstep(b.w * 0.1, b.w * 0.28, aCell));
    float th = a.z * dot(a.xy, xz) - b.x * uTime + b.z;
    disp.y += A * sin(th);
    disp.xz += (b.y * A * cos(th)) * a.xy;
  }
  float sd = coastAt(xz).r;
  float env = surfEnvelope(sd) * (1.0 - smoothstep(0.4, 0.75, ice.r)) * (1.0 - ice.g);
  if (env > 0.0) disp.y += uSurfAmp * env * surfShape(surfPhase(sd, xz, uTime));
  vec3 world = vec3(xz.x + disp.x, disp.y, xz.y + disp.z);
  vWorld = world;
  vXZ = xz;
  vCrest = disp.y;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
export const OCEAN_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
${SNOW_GLSL}
uniform samplerCube uSkyCube;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uAuroraLight;
uniform vec2 uWindDir;
uniform float uNight;
uniform vec3 uDeep;
uniform vec3 uSand;
uniform vec3 uRock;
uniform vec3 uAbsorb;
uniform float uNear;
uniform vec2 uDrift;
uniform sampler2D uVegTex;
uniform vec4 uVegInfo;
#ifdef SKY_MIRROR
uniform sampler2D uMirror;
uniform mat4 uMirrorVP;
// the sky seen along a reflected direction, from the mirrored-sky render (sharp aurora, moon and
// stars); directions outside the mirror camera's frame fall back to the cube
vec3 mirrorSky(vec3 R, vec3 fallback) {
  vec4 c = uMirrorVP * vec4(R, 0.0);
  if (c.w <= 1e-4) return fallback;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  vec2 e = min(uv, 1.0 - uv);
  float k = smoothstep(0.0, 0.03, min(e.x, e.y));
  if (k <= 0.0) return fallback;
  return mix(fallback, texture2D(uMirror, uv).rgb, k);
}
#endif
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D uEnvMap;
uniform float uEnvIntensity;
#include <cube_uv_reflection_fragment>
#endif
varying vec3 vWorld;
varying vec2 vXZ;
varying float vCrest;
varying float vViewZ;

/** height of the ice tops above the water (m, snow included) */
const float FREEBOARD = 0.3;

float D_GGX(float NdH, float a) {
  float a2 = a * a;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float V_Smith(float NdL, float NdV, float a) {
  float a2 = a * a;
  float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
  float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

// wind ripples: a fan of short gravity-capillary waves round the wind, summed as analytic slopes
// (no texture quantisation in the mirror), each fading out before it gets smaller than a pixel and
// gathered into patches like cat's-paws
vec2 ripples(vec2 xz, vec2 w, float fp, float t) {
  float pA = smoothstep(0.3, 0.75, nS(xz * (1.0 / 55.0) + w * (t * 0.01), vec2(0.13, 0.71)));
  float pB = smoothstep(0.3, 0.75, nS(xz * (1.0 / 31.0) - w * (t * 0.014), vec2(0.57, 0.23)));
  vec2 g = vec2(0.0);
  for (int i = 0; i < RIPPLES * 3; i++) {
    float fi = float(i);
    float lambda = 8.0 * pow(0.73, fi);
    float a = (fract(sin(fi * 78.233 + 1.3) * 43758.5453) - 0.5) * 2.4;
    vec2 d = vec2(w.x * cos(a) - w.y * sin(a), w.x * sin(a) + w.y * cos(a));
    float k = 6.2831853 / lambda;
    float om = sqrt(9.81 * k + 7.4e-5 * k * k * k);
    float ph = k * dot(d, xz) - om * t + fi * 2.39;
    float steep = 0.055 * (1.0 - smoothstep(lambda * 0.12, lambda * 0.45, fp)) * mix(pA, pB, mod(fi, 2.0)) ;
    g += d * (steep * cos(ph));
  }
  return g;
}

vec2 iHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Voronoi: x = F1, y = distance to the border with the second-nearest site (cell units), zw = id of
// the nearest site; n = unit vector across that border (the plate's outward edge normal)
vec4 voronoiN(vec2 p, out vec2 n) {
  vec2 c = floor(p);
  vec2 f = p - c;
  float d1 = 64.0;
  float d2 = 64.0;
  vec2 r1 = vec2(0.0);
  vec2 r2 = vec2(1.0);
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + iHash2(c + g) * 0.85 + 0.075 - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        r2 = r1;
        d1 = d;
        r1 = r;
        id = c + g;
      } else if (d < d2) {
        d2 = d;
        r2 = r;
      }
    }
  }
  n = normalize(r2 - r1 + 1e-5);
  return vec4(sqrt(d1), dot(0.5 * (r1 + r2), n), id);
}

// nearest-centre Voronoi: x distance to the nearest point, y distance to the cell border, zw cell id;
// c = vector from p to that point (cell units)
vec4 voronoiC(vec2 p, out vec2 c) {
  vec2 cc = floor(p);
  vec2 f = p - cc;
  float d1 = 64.0;
  float d2 = 64.0;
  vec2 r1 = vec2(0.0);
  vec2 r2 = vec2(1.0);
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + iHash2(cc + g) * 0.85 + 0.075 - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        r2 = r1;
        d1 = d;
        r1 = r;
        id = cc + g;
      } else if (d < d2) {
        d2 = d;
        r2 = r;
      }
    }
  }
  c = r1;
  vec2 n = normalize(r2 - r1 + 1e-5);
  return vec4(sqrt(d1), dot(0.5 * (r1 + r2), n), id);
}

// drift ice at p (drifting xz): x = metres inside the floe's top (< 0 in the water), y = floe seed,
// zw = outward edge normal. Warped Voronoi cells rounded off at the corners, with ragged edges; a few
// big floes are broken into pieces by narrow, wandering leads.
vec4 floeField(vec2 p, float density) {
  vec2 wv = vec2(nS(p * (1.0 / 47.0), vec2(0.11, 0.53)), nS(p * (1.0 / 47.0), vec2(0.67, 0.29))) - 0.5;
  vec2 q = p + wv * 13.0;
  const float S = 21.0;
  vec2 n;
  vec4 v = voronoiN(q / S, n);
  vec2 h = iHash2(v.zw);
  if (h.x > density) return vec4(-9.0, h.y, n);
  vec2 h2 = iHash2(v.zw + 7.7);
  float gap = 0.6 + 2.6 * h2.y + (1.0 - min(density, 1.0)) * 3.0;
  // rounded: the corners (far from the cell's site) are cut off by a disc of varying size
  float radius = S * (0.42 + 0.22 * h2.x);
  float d = min(v.y * S - gap, (radius - v.x * S) * 0.7);
  d += (nS(p * (1.0 / 1.6), vec2(0.31, 0.83)) - 0.5) * 0.6 + (nS(p * (1.0 / 5.5), vec2(0.93, 0.21)) - 0.5) * 1.3;
  #if ICE_DETAIL
  if (h.y > 0.84 && d > -1.0) {
    vec2 n2;
    vec2 qc = q + (vec2(nS(p * (1.0 / 7.0), vec2(0.4, 0.2)), nS(p * (1.0 / 7.0), vec2(0.8, 0.6))) - 0.5) * 7.0;
    vec4 v2 = voronoiN(qc / 14.0 + v.zw * 3.17, n2);
    float d2 = v2.y * 14.0 - (0.15 + 0.9 * iHash2(v2.zw).x * (h.y - 0.84) * 6.0);
    if (d2 < d) {
      d = d2;
      n = n2;
    }
  }
  #endif
  return vec4(d, h.y, n);
}

// shore-fast ice: metres inside its seaward edge (approximate; < 0 in the water)
float fastField(vec2 xz, float g) {
  if (g < 0.01) return -9.0;
  float n = nS(xz * (1.0 / 29.0), vec2(0.41, 0.17)) * 0.65 + nS(xz * (1.0 / 6.5), vec2(0.83, 0.61)) * 0.35;
  return (g - 0.5 + (n - 0.5) * 0.5) * 22.0;
}

// terrain shadow on the ice: a short march toward the light over the height grid
float landShadow(vec3 P, vec3 L) {
  if (L.y <= 0.0) return 1.0;
  float sh = 1.0;
  float t = 12.0;
  for (int i = 0; i < 12; i++) {
    vec3 q = P + L * t;
    if (q.y > 980.0) break;
    float h = seabed(q.xz);
    sh = min(sh, clamp((q.y + 1.0 - h) / (0.05 * t + 1.0), 0.0, 1.0));
    t *= 1.6;
  }
  return sh;
}

#if MIRROR_STEPS > 0
// the land mirrored in calm water: march the reflected ray over the height grid, then refine
float mirrorLand(vec3 P, vec3 R, out vec3 H) {
  float t = 2.0;
  float pt = 0.0;
  float pd = P.y - seabed(P.xz);
  H = P;
  for (int i = 0; i < MIRROR_STEPS; i++) {
    vec3 q = P + R * t;
    if (q.y > 990.0) break;
    float d = q.y - seabed(q.xz);
    if (d < 0.0) {
      float a = pt;
      float b = t;
      for (int k = 0; k < 4; k++) {
        float m = 0.5 * (a + b);
        vec3 qm = P + R * m;
        if (qm.y - seabed(qm.xz) < 0.0) b = m;
        else a = m;
      }
      H = P + R * b;
      return b;
    }
    pt = t;
    pd = d;
    t = t * MIRROR_GROWTH + 4.0;
  }
  return -1.0;
}

// what the mirrored land looks like: snow on the gentle ground, dark rock on the faces, the
// near-black spruce and grey birch woods where the terrain grows them, lit by the key light, the sky
// and the aurora
vec3 landColor(vec3 H, vec3 L, vec3 Esky) {
  const float e = 6.0;
  float hx = seabed(H.xz + vec2(e, 0.0)) - seabed(H.xz - vec2(e, 0.0));
  float hz = seabed(H.xz + vec2(0.0, e)) - seabed(H.xz - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
  float slope = 1.0 - n.y;
  float rn = nS(H.xz * (1.0 / 37.0), vec2(0.21, 0.77));
  float rock = smoothstep(0.26, 0.46, slope + (rn - 0.5) * 0.35) * smoothstep(-2.0, 8.0, H.y);
  vec4 veg = texture2D(uVegTex, (H.xz - uVegInfo.xy) * uVegInfo.zw);
  float forest = veg.r * (1.0 - rock);
  vec3 canopy = mix(vec3(0.016, 0.022, 0.02), vec3(0.11, 0.085, 0.08), veg.a) * 1.6 + vec3(0.12) * smoothstep(0.4, 0.9, rn) * 0.4;
  vec3 alb = mix(vec3(0.78, 0.82, 0.88), vec3(0.06, 0.065, 0.072), rock);
  alb = mix(alb, canopy, smoothstep(0.15, 0.6, forest));
  float NdL = max(dot(n, L), 0.0);
  vec3 E = uLightColor * NdL + Esky * (0.55 + 0.45 * n.y) + uAuroraLight * (0.5 + 0.5 * n.y);
  return alb * E * RECIPROCAL_PI;
}
#endif

void main() {
  vec2 xz = vXZ;
  float depth = -seabed(xz);
  // the sea under dry land is never visible: skip it before any shading
  if (depth < -0.4) discard;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = max(length(fwidth(xz)), 0.002);
  vec4 coast = coastAt(xz);
  float sd = coast.r;
  float column = depth + vWorld.y;
  vec4 iceF = iceAt(xz);
  float shelter = smoothstep(0.45, 0.82, iceF.r);
  float att = waveAtt(depth, dist, iceF);
  vec3 L = normalize(uLightDir);
  vec2 w = normalize(uWindDir);
  float aa = fp * 1.1 + 0.12;

  #ifdef ENVMAP_TYPE_CUBE_UV
    vec3 Esky = PI * textureCubeUV(uEnvMap, vec3(0.0, 1.0, 0.0), 1.0).rgb * uEnvIntensity;
  #else
    vec3 Esky = PI * mix(uHorizonColor, uSkyColor, 0.55);
  #endif

  // ---------------------------------------------------------------- sea ice
  // The ice stands FREEBOARD above the sea: the view ray meets its top at A, a little before it
  // reaches the water at P. Inside the ice at P but not at A: the ray hit a side wall.
  bool anyIce = iceF.g > 0.01 || iceF.b > 0.02;
  #if ICE_DETAIL
  float par = anyIce && dist < 450.0 ? min(FREEBOARD / max(V.y, 0.025), 12.0) : 0.0;
  #else
  float par = 0.0;
  #endif
  vec2 xzA = xz + V.xz * par;
  vec4 iceA = par > 0.0 ? iceAt(xzA) : iceF;
  float fastP = fastField(xz, iceF.g);
  float fastA = par > 0.0 ? fastField(xzA, iceA.g) : fastP;
  vec4 floeP = vec4(-9.0, 0.0, 0.0, 1.0);
  vec4 floeA = floeP;
  if (iceF.b > 0.02 || iceA.b > 0.02) {
    floeP = floeField(xz + uDrift, iceF.b * 1.1);
    floeA = par > 0.0 ? floeField(xzA + uDrift, iceA.b * 1.1) : floeP;
  }
  float fastTop = smoothstep(0.0, aa, fastA);
  float floeTop = smoothstep(0.0, aa, floeA.x) * (1.0 - fastTop);
  float top = fastTop + floeTop;
  float iceP = max(fastP, floeP.x);
  float wall = smoothstep(0.0, aa, iceP) * (1.0 - top);

  // pancake ice: fields of rounded cakes with raised rims, densest off the ice edge (on the water at P)
  float pancake = 0.0;
  float rim = 0.0;
  float dip = 0.0;
  float cakeSeed = 0.0;
  float cakeFar = 1.0;
  vec2 rimSlope = vec2(0.0);
  float pdF = 0.0;
  if (iceF.b > 0.02 || iceF.a > 0.15) {
    vec2 dp = xz + uDrift;
    float field = smoothstep(0.42, 0.62, nS(dp * (1.0 / 140.0), vec2(0.29, 0.61)) + iceF.b * 0.35 + iceF.a * 0.25 * shelter - 0.3);
    float pd = field * clamp(iceF.b * 1.4 + iceF.a * 0.5 * shelter, 0.0, 1.0) * (1.0 - smoothstep(-1.5, 0.0, iceP));
    pdF = pd;
    if (fp < 0.7 && pd > 0.01) {
      // round cakes on a fixed lattice (a scale that varies in space would swirl the cells into
      // rings), flattened where they press against their neighbours; small ones fill the gaps
      const float cs = 2.2;
      vec2 cc;
      vec4 vp = voronoiC(dp / cs + 17.3, cc);
      vec2 ph = iHash2(vp.zw);
      float shape = min(cs * (0.36 + 0.2 * ph.x) - vp.x * cs, vp.y * cs - 0.05);
      float pres = step(iHash2(vp.zw + 1.7).y, pd * 1.35);
      shape = pres > 0.5 ? shape : -1.0;
      // outward from the cake's centre (world xz)
      vec2 outD = -cc / max(length(cc), 1e-4);
      float rimW = 0.13 + 0.1 * ph.y;
      vec2 cq;
      vec4 vq = voronoiC(dp / 0.85 + 3.1, cq);
      vec2 qh = iHash2(vq.zw + 9.1);
      float shape2 = min(0.85 * (0.28 + 0.14 * qh.x) - vq.x * 0.85, vq.y * 0.85 - 0.03);
      if (step(qh.y, pd * 0.9) > 0.5 && shape2 > shape) {
        shape = shape2;
        outD = -cq / max(length(cq), 1e-4);
        rimW = 0.07;
        ph.x = qh.x;
      }
      float paa = fp * 0.8 + 0.02;
      pancake = smoothstep(0.0, paa, shape);
      // the raised rim of slush the cakes push up knocking together, a shallow wet dip inside it
      // (only while they are wider than a pixel)
      float near = 1.0 - smoothstep(0.05, 0.16, fp);
      float tR = clamp(shape / rimW, 0.0, 1.6);
      rim = pancake * (1.0 - smoothstep(0.75, 1.15, tR)) * near;
      dip = pancake * smoothstep(0.9, 1.15, tR) * (1.0 - smoothstep(1.3, 1.6, tR)) * near;
      // slope of the rim bump (height ~ sin(pi t)) along the outward direction
      float dh = (tR < 1.0 ? cos(3.14159 * tR) : 0.0) * 3.14159 / rimW * 0.035;
      rimSlope = outD * dh * near;
      cakeSeed = iHash2(vp.zw + 3.3).x;
      cakeFar = smoothstep(0.15, 0.6, fp);
      pancake = mix(pancake, pd * 0.62, cakeFar);
      rim *= 1.0 - cakeFar;
    } else {
      pancake = pd * 0.62;
    }
    pancake *= 1.0 - top - wall;
  }

  float sh = 1.0;
  if (top + wall + pancake > 0.0) sh = landShadow(vec3(xz.x, FREEBOARD, xz.y), L);

  // ---- ice tops
  vec3 topCol = vec3(0.0);
  if (top > 0.0) {
    vec2 a = xzA;
    vec3 snowA = snowAlbedo(a);
    // wind-packed drifts streaked along the storm wind, and scoured patches of bare grey ice
    vec2 qw = vec2(dot(a, S_WIND), dot(a, vec2(-S_WIND.y, S_WIND.x)));
    float streak = nS(vec2(qw.x / 42.0, qw.y / 9.0), vec2(0.27, 0.71)) * 0.6 + nS(vec2(qw.x / 17.0, qw.y / 3.2), vec2(0.61, 0.13)) * 0.4;
    // broken into drifts and dunes, not endless lines
    streak = mix(0.5, streak, 0.35 + 0.65 * nS(a * (1.0 / 16.0), vec2(0.37, 0.59)));
    float scour = nS(a * (1.0 / 55.0), vec2(0.13, 0.47)) * 0.7 + nS(a * (1.0 / 12.0), vec2(0.5, 0.9)) * 0.3;
    float fineA = 1.0 - smoothstep(0.5, 3.0, fp);
    // shore-fast ice: snow over grey scoured patches, young grey ice along its seaward edge, a few
    // refrozen cracks
    float bare = smoothstep(0.6, 0.74, scour) * (1.0 - smoothstep(0.45, 0.62, streak));
    // behind the edge, patches of refrozen grey ice where leads opened and closed again
    float young = (1.0 - smoothstep(3.0, 10.0 + 14.0 * scour, fastA)) * smoothstep(0.42, 0.58, nS(a * (1.0 / 9.0), vec2(0.71, 0.33)));
    vec3 fastAlb = snowA * (0.96 + (0.1 * streak - 0.05) * (0.35 + 0.65 * smoothstep(0.03, 0.25, fp)));
    fastAlb = mix(fastAlb, vec3(0.38, 0.44, 0.5), bare * 0.6);
    fastAlb = mix(fastAlb, vec3(0.22, 0.27, 0.31), young * 0.7);
    #if ICE_DETAIL
    if (fastTop > 0.0 && fineA > 0.0) {
      vec2 cn;
      vec4 cv = voronoiN(a / 37.0 + 3.7, cn);
      float crack = (1.0 - smoothstep(0.0, 0.2 + fp * 0.5, cv.y * 37.0)) * step(0.45, iHash2(cv.zw).x) * fineA;
      fastAlb *= 1.0 - 0.5 * crack;
    }
    #endif
    // floes: a snow crust broken by grey refrozen patches, a few bare young floes
    float seed = floeA.y;
    vec3 floeAlb = snowA * (0.9 + 0.1 * seed) * (0.94 + 0.08 * streak);
    floeAlb = mix(floeAlb, vec3(0.4, 0.46, 0.52), smoothstep(0.6, 0.76, scour + seed * 0.25) * 0.55);
    // some floes are young grey ice with a thin dusting, a few bare and dark
    floeAlb = mix(floeAlb, vec3(0.42, 0.48, 0.53) * (0.9 + 0.2 * streak), smoothstep(0.6, 0.64, seed) * 0.6);
    float bareFloe = step(0.84, seed);
    floeAlb = mix(floeAlb, vec3(0.2, 0.25, 0.29), bareFloe * 0.8);
    float isFloe = floeTop / max(top, 1e-4);
    vec3 alb = mix(fastAlb, floeAlb, isFloe);
    // the snow rounds over at the rim (it catches the light on the side facing it)
    float edgeIn = mix(fastA, floeA.x, isFloe);
    vec2 en = mix(vec2(coast.b, coast.a), floeA.zw, isFloe);
    float lip = (1.0 - smoothstep(0.0, 0.8, edgeIn)) * fineA;
    vec2 nb = vec2(nS(a * 0.6, vec2(0.2, 0.4)), nS(a * 0.6, vec2(0.6, 0.1))) - 0.5;
    // sastrugi: wind-carved ridges across the drift streaks catch the low light on one side
    float sA = nS(vec2(qw.x / 21.0, qw.y / 2.7), vec2(0.61, 0.13));
    float sB = nS(vec2(qw.x / 21.0, (qw.y + 0.35) / 2.7), vec2(0.61, 0.13));
    // (close to the eye the soft drift field would read as brush strokes: calm it there)
    float nearCalm = 0.35 + 0.65 * smoothstep(0.03, 0.25, fp);
    vec2 sastr = vec2(-S_WIND.y, S_WIND.x) * (sB - sA) * 1.1 * fineA * nearCalm;
    vec3 Ni = normalize(vec3(nb.x * 0.14 * fineA + en.x * lip * 0.8 + sastr.x, 1.0, nb.y * 0.14 * fineA + en.y * lip * 0.8 + sastr.y));
    // rubble: the slabs broken along the edge of the shore ice, heaped and tilted every way
    float rubble = 0.0;
    #if ICE_DETAIL
    // (and round the rims of the floes that have been knocking together)
    float floeRubble = (1.0 - smoothstep(0.4, 1.6 + 1.2 * scour, floeA.x)) * step(0.45, fract(seed * 3.71));
    float rubbleZone = mix(1.0 - smoothstep(0.8, 2.2 + 2.5 * scour, fastA), floeRubble, isFloe) * fineA;
    if (rubbleZone > 0.01) {
      const float RS = 1.1;
      vec2 rn;
      vec4 rv = voronoiN((a + (nb * 1.4)) / RS + 11.3, rn);
      vec2 rh = iHash2(rv.zw + 4.4);
      rubble = step(rh.x, rubbleZone * 0.55);
      float gapR = 1.0 - smoothstep(0.03, 0.09 + fp * 0.4, rv.y * RS);
      // broken slabs tipped a little this way and that, snow on them, blue ice where they broke
      vec3 slabN = normalize(vec3((rh.y - 0.5) * 0.7 + nb.x * 0.3, 1.0, (fract(rh.y * 7.13) - 0.5) * 0.7 + nb.y * 0.3));
      Ni = normalize(mix(Ni, slabN, rubble));
      alb = mix(alb, mix(snowA * 0.95, vec3(0.45, 0.56, 0.62), step(0.75, fract(rh.x * 13.1)) * 0.5), rubble);
      alb *= 1.0 - 0.55 * gapR * rubble;
    }
    #endif
    float NdL = dot(Ni, L);
    float wrap = max(0.0, (NdL + 0.4) / 1.4);
    vec3 Ed = uLightColor * mix(max(NdL, 0.0), wrap, 0.3) * sh;
    // sky light, a little bluer than the ground's (the snow's own blue comes from its albedo)
    vec3 Ea = Esky * vec3(0.93, 0.99, 1.07) + uAuroraFill * 0.75;
    topCol = alb * (Ed + Ea) * RECIPROCAL_PI;
    float snowy = (1.0 - max(bare * 0.6, young) * (1.0 - isFloe)) * (1.0 - bareFloe * isFloe);
    topCol += uLightColor * sh * snowGlint(vec3(a.x, FREEBOARD, a.y), Ni, V, L, dist) * snowy * smoothstep(0.0, 0.3, NdL) * 0.6;
    // young and bare ice is glossy: it mirrors the sky and the aurora
    float gloss = (young * 0.85 + bare * 0.35) * (1.0 - isFloe) + bareFloe * isFloe * 0.7;
    if (gloss > 0.01) {
      vec3 Rf = reflect(-V, vec3(0.0, 1.0, 0.0));
      vec3 sk = textureCube(uSkyCube, Rf).rgb;
      #ifdef SKY_MIRROR
        sk = mirrorSky(Rf, sk);
      #endif
      float Fi = 0.03 + 0.97 * pow(1.0 - max(V.y, 0.0), 5.0);
      topCol = mix(topCol, sk, Fi * gloss * 0.75);
    }
  }

  // ---- side walls: wet, blue-grey ice, a snow lip at the top
  vec3 wallCol = vec3(0.0);
  if (wall > 0.0) {
    // where on the wall the ray hits: 0 at the waterline, 1 at the top
    float s = clamp(iceP / max(par, 1e-3), 0.0, 1.0);
    vec3 nW = normalize(vec3(V.x, 0.0, V.z) + 1e-4);
    vec3 albW = mix(vec3(0.15, 0.21, 0.25), vec3(0.42, 0.54, 0.6), smoothstep(0.0, 0.4, s));
    albW = mix(albW, snowAlbedo(xz) * 0.92, smoothstep(0.62, 0.85, s));
    float NdLw = max(dot(nW, L), 0.0);
    wallCol = albW * (uLightColor * NdLw * sh + Esky * vec3(0.4, 0.5, 0.6) + uAuroraFill * 0.5) * RECIPROCAL_PI;
  }

  vec3 col = topCol;
  if (top < 0.999) {
    // ------------------------------------------------------------ open water
    // Gerstner normal (exact parametric tangents), each wave faded by the pixel footprint
    vec3 tx = vec3(1.0, 0.0, 0.0);
    vec3 tz = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < WAVES; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float f = att * (1.0 - smoothstep(b.w * 0.06, b.w * 0.3, fp));
      float th = a.z * dot(a.xy, xz) - b.x * uTime + b.z;
      float wa = a.z * a.w * f;
      float s = sin(th);
      float c = cos(th);
      float q = b.y * wa * s;
      tx += vec3(-q * a.x * a.x, wa * a.x * c, -q * a.x * a.y);
      tz += vec3(-q * a.x * a.y, wa * a.y * c, -q * a.y * a.y);
    }
    vec3 N = normalize(cross(tz, tx));

    // shore swash slope
    float env = surfEnvelope(sd) * (1.0 - shelter) * (1.0 - iceF.g);
    float ph = surfPhase(sd, xz, uTime);
    if (env > 0.0) {
      float s = 0.5 + 0.5 * sin(ph);
      float dh = uSurfAmp * env * s * cos(ph) * SURF_K * (1.0 - smoothstep(2.0, 10.0, fp));
      N = normalize(N - vec3(coast.b, 0.0, coast.a) * dh);
    }

    // ripples: cat's-paws out at sea, almost none on the sheltered fjord; grease ice and the ice
    // floes smooth them away
    float gustP = nS(xz * (1.0 / 420.0) + w * (uTime * 0.0012), vec2(0.17, 0.43));
    float calm = mix(0.8, 1.0, smoothstep(0.2, 2.0, column)) * mix(1.0, 0.03 + 0.2 * smoothstep(0.58, 0.8, gustP), shelter);
    calm *= (1.0 - 0.85 * iceF.a) * (1.0 - 0.8 * iceF.b) * (1.0 - 0.9 * smoothstep(-6.0, 0.0, iceP));
    vec2 slope = ripples(xz, w, fp, uTime) * 1.6;
    float rippleVis = 1.0 - smoothstep(0.05, 3.0, fp);
    N = normalize(N - vec3(slope.x, 0.0, slope.y) * calm);
    // waves smaller than a pixel still tilt the facets out at sea; the sheltered fjord stays a mirror
    float unresolved = (1.0 - rippleVis) * mix(1.0, 0.03, shelter) * (1.0 - iceF.b * 0.7);

    float NdV = clamp(dot(N, V), 1e-3, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y) + 0.004;
    R = normalize(R);
    vec3 skyR = textureCube(uSkyCube, R).rgb;
    #ifdef SKY_MIRROR
      skyR = mirrorSky(R, skyR);
    #endif
    #ifdef ENVMAP_TYPE_CUBE_UV
      float gust = nS(xz * (1.0 / 280.0) + w * (uTime * 0.0012), vec2(0.71, 0.19)) * 0.7 + nS(xz * (1.0 / 70.0) - w.yx * (uTime * 0.002), vec2(0.37, 0.93)) * 0.5;
      float rough = mix(0.1, 0.24, smoothstep(0.35, 0.85, gust)) * unresolved;
      vec3 Rb = normalize(vec3(R.x, max(R.y, 0.25 * rough), R.z));
      skyR = mix(skyR, textureCubeUV(uEnvMap, Rb, rough).rgb, smoothstep(0.0, 0.3, unresolved));
    #endif
    #if MIRROR_STEPS > 0
      // the shores and the Teeth hang upside down in the calm water
      vec3 Hm;
      float tHit = mirrorLand(vec3(xz.x, vWorld.y + 0.05, xz.y), R, Hm);
      if (tHit > 0.0) {
        vec3 land = landColor(Hm, L, Esky);
        #ifdef USE_FOG
          float fogM = 1.0 - exp(-fogDensity * fogDensity * tHit * tHit);
          land = mix(land, fogColor, fogM);
        #endif
        skyR = mix(skyR, land, 1.0 - 0.5 * smoothstep(0.1, 0.6, unresolved));
      }
    #endif

    float sunH = max(L.y, 0.0);
    vec3 Esun = uLightColor * sunH * (1.0 - (0.02 + 0.98 * pow(1.0 - sunH, 5.0)));
    vec3 Ein = Esun + Esky * 0.93;

    // water column: black sand and dark rock through cold, clear water; the submerged foot of
    // the ice glows pale round the floes and along the ice edge
    float d = max(column, 0.0);
    float cosT = sqrt(1.0 - (1.0 - NdV * NdV) * 0.5625);
    vec3 T = exp(-uAbsorb * d * (1.0 + 1.0 / max(cosT, 0.2)));
    vec3 bottom = mix(uRock, uSand, coast.g);
    vec3 Rw = uDeep * (1.0 - T) + bottom * T;
    float foot = smoothstep(-1.6, -0.1, iceP) * (1.0 - wall) * (1.0 - smoothstep(0.3, 2.0, fp));
    // nilas: a dark, rubbery skin of new ice on the water just off the shore ice
    float nilas = smoothstep(-10.0, -1.0, fastP) * smoothstep(0.35, 0.55, nS(xz * (1.0 / 11.0), vec2(0.19, 0.83)) + smoothstep(-4.0, -1.0, fastP) * 0.3);
    vec3 Tf = exp(-uAbsorb * (0.5 + 1.6 * (1.0 - foot)) * 2.0);
    Rw = mix(Rw, vec3(0.3, 0.42, 0.46) * Tf, foot * 0.6);
    vec3 body = Rw * Ein * RECIPROCAL_PI;
    body = mix(body, vec3(dot(body, vec3(0.2126, 0.7152, 0.0722))), uNight * 0.4);

    // sun / moon glint: sharp sparkle + broad sheen; widen with unresolved ripples
    vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    float NdH = max(dot(N, H), 0.0);
    float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float a1 = mix(0.02, 0.085, unresolved);
    float a2 = mix(0.12, 0.3, unresolved);
    float spec = D_GGX(NdH, a1) * V_Smith(NdL, NdV, a1) + 0.22 * D_GGX(NdH, a2) * V_Smith(NdL, NdV, a2);
    vec3 glint = uLightColor * min(spec * NdL * Fh, 80.0) * (1.0 - iceF.a * 0.6);

    // calm, sheltered water lies a touch more mirror-like than the Fresnel term alone gives (a still
    // fjord at night holds the aurora)
    float Fm = F + (1.0 - F) * 0.035 * shelter * (1.0 - unresolved) * (1.0 - iceF.a * 0.5);
    vec3 water = mix(body, skyR, Fm) + glint;

    water = mix(water, vec3(0.07, 0.085, 0.095) * Ein * RECIPROCAL_PI + skyR * Fm * 0.85, nilas * 0.6);

    // grease ice: a dull, oily film that takes the shine off the water near the shores and the ice
    vec3 grease = vec3(0.12, 0.15, 0.17) * Ein * RECIPROCAL_PI;
    float greaseW = iceF.a * smoothstep(0.38, 0.62, nS(xz * (1.0 / 37.0) + w * (uTime * 0.004), vec2(0.5, 0.1)) + iceF.a * 0.25);
    water = mix(water, grease + skyR * F * 0.4, greaseW * 0.5);

    // slush: lumps of grey ice in the swash and a lumpy line at the waterline, no white surf
    float gx = seabed(xz + vec2(1.0, 0.0)) - seabed(xz - vec2(1.0, 0.0));
    float gz = seabed(xz + vec2(0.0, 1.0)) - seabed(xz - vec2(0.0, 1.0));
    float toShore = max(column, 0.0) / max(length(vec2(gx, gz)) * 0.5, 0.01);
    float fA = nS(xz * (1.0 / 3.1) + w * (uTime * 0.03), vec2(0.23, 0.67));
    float line = 1.0 - smoothstep(0.2, 0.9 + 1.6 * fA + fp, toShore);
    float swashZ = (1.0 - smoothstep(1.0, 6.0 + 4.0 * fA, toShore)) * smoothstep(-3.0, 0.5, sd) * (1.0 - shelter * 0.6);
    float slushAmt = clamp(max(line, swashZ * 0.55) + iceF.a * 0.25, 0.0, 1.0) * (1.0 - smoothstep(0.0, 1.0, iceP));
    float lump = 0.0;
    if (slushAmt > 0.02) {
      if (fp < 0.2) {
        vec2 ln;
        vec4 sv = voronoiN((xz + uDrift * 0.2) * (1.0 / 0.45) + 5.1, ln);
        float lg = 0.06 + 0.12 * iHash2(sv.zw).y;
        float pres = step(iHash2(sv.zw).x, slushAmt * 1.25);
        lump = pres * smoothstep(lg, lg + fp * 2.0 + 0.03, sv.y * 0.45);
        lump = mix(lump, slushAmt * 0.6, smoothstep(0.06, 0.2, fp));
      } else {
        lump = slushAmt * 0.6;
      }
    }
    // wet lumps of ice: pale, and they keep a little of the sky's shine
    vec3 slushCol = vec3(0.5, 0.56, 0.6) * (Ein * 0.8 * mix(0.75, 1.0, sh) + uAuroraFill) * RECIPROCAL_PI + skyR * 0.1;
    water = mix(water, slushCol, lump * 0.85);

    // between the cakes the water is thick with slush
    water = mix(water, vec3(0.11, 0.13, 0.145) * Ein * RECIPROCAL_PI + skyR * Fm * 0.45, pdF * 0.5);

    // pancakes: grey slushy young ice, some dusted with snow, with white raised rims
    if (pancake > 0.0) {
      vec3 snowC = snowAlbedo(xz);
      float mott = nS(xz * 2.3, vec2(0.41, 0.17)) * 0.6 + nS(xz * 7.0, vec2(0.83, 0.29)) * 0.4;
      vec3 cakeIn = mix(vec3(0.3, 0.35, 0.39), vec3(0.52, 0.57, 0.62), smoothstep(0.35, 0.75, mott)) * (0.85 + 0.3 * cakeSeed);
      cakeIn = mix(cakeIn, snowC * 0.82, step(0.62, cakeSeed) * smoothstep(0.3, 0.6, mott) * 0.8);
      // from afar the rims and the dusting blend into a paler grey
      cakeIn = mix(cakeIn, mix(cakeIn, snowC * 0.9, 0.35), cakeFar);
      vec3 cakeAlb = mix(cakeIn, snowC * 0.95, rim) * (1.0 - 0.3 * dip);
      vec3 Nc = normalize(vec3((cakeSeed - 0.5) * 0.1 + rimSlope.x, 1.0, (fract(cakeSeed * 7.3) - 0.5) * 0.1 + rimSlope.y));
      vec3 cake = cakeAlb * (uLightColor * max(dot(Nc, L), 0.0) * sh + Esky * vec3(0.86, 0.95, 1.12) + uAuroraFill * 0.7) * RECIPROCAL_PI;
      // the wet young ice keeps a little of the water's shine (the sky and the aurora in it)
      cake += skyR * Fm * 0.3 * (1.0 - rim) * (1.0 - 0.6 * step(0.62, cakeSeed));
      water = mix(water, cake, pancake);
    }

    water = mix(water, wallCol, wall);
    col = mix(water, topCol, top);
  }

  // ---- distance: fade into the fog, and at the horizon into the sky of the same azimuth
  #ifdef USE_FOG
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    vec3 hz = textureCube(uSkyCube, normalize(vec3(-V.x, 0.006, -V.z))).rgb;
    vec3 fogC = mix(fogColor, hz, smoothstep(3000.0, 16000.0, vFogDepth));
    col = mix(col, fogC, fogF);
  #endif

  gl_FragColor = vec4(col, 1.0);

  // Shoreline depth resolve. With a tiny near plane the depth buffer cannot
  // separate the sea surface from the seabed a metre below it kilometres away,
  // so decide it here: over sea floor the water wins (bias toward the camera,
  // never more than the real seabed separation along the ray), over dry land
  // it loses. Units are depth-buffer steps; n/d² converts meters to window depth.
  const float STEP = 1.0 / 16777216.0;
  float dzdd = uNear / max(vViewZ * vViewZ, 1e-6);
  float seabedGap = max(depth, 0.0) / max(V.y, 0.04) * dzdd;
  float bias = depth > 0.0 ? -min(3.0 * STEP, seabedGap) : 2.0 * STEP;
  gl_FragDepth = gl_FragCoord.z + bias;
}
`;
