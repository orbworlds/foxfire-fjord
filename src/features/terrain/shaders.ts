/**
 * GLSL for Foxfire Fjord's land: the CDLOD height model, the winter palette,
 * snow (wind crust, blue hollows, sastrugi, dunes, glints, translucency),
 * dark gneiss with snow on its ledges and couloirs, the sea shore with its
 * ice foot, Ice Beach's black sand, the hot spring's melt ring, packed and
 * plowed trails, Mirror Lake's black ice, the snow-capped boulders and the
 * terrain-scale shadows of a low sun or moon.
 */
import * as THREE from 'three';
import { SNOW_WIND } from '../../world/layout';
import { TERRAIN_MAX_HEIGHT } from '../../world/terrain-height';

/** sRGB hex → linear GLSL vec3 literal */
function lin(hex: string, k = 1): string {
  const c = new THREE.Color(hex);
  return `vec3(${(c.r * k).toFixed(4)}, ${(c.g * k).toFixed(4)}, ${(c.b * k).toFixed(4)})`;
}

/**
 * Vertex-side height model: bilinear R32F world grid everywhere (fading to the
 * deep sea floor outside the baked bounds) blended with the exact streamed
 * "fine window" near the camera, per-tile validity from the tile table.
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
attribute vec4 aNode;
uniform sampler2D tCoarseTex;
uniform sampler2D tDataTex;
uniform sampler2D tFineHTex;
uniform sampler2D tFineNTex;
uniform sampler2D tTileTex;
uniform vec4 tCoarseInfo;
uniform vec2 tCoarseSize;
uniform vec2 tDeep;
uniform vec4 tFine;
uniform float tFineOff;
uniform vec2 tFineFade;
uniform vec3 tLodCam;
uniform vec4 tLod;
varying vec3 vTPos;
varying float vTFine;

float tCoarseH(vec2 p) {
  vec2 g = (p - tCoarseInfo.xy) * tCoarseInfo.zw;
  vec2 gc = clamp(g, vec2(0.0), tCoarseSize - 1.0);
  vec2 i0 = min(floor(gc), tCoarseSize - 2.0);
  vec2 f = gc - i0;
  ivec2 c = ivec2(i0);
  float a = texelFetch(tCoarseTex, c, 0).r;
  float b = texelFetch(tCoarseTex, c + ivec2(1, 0), 0).r;
  float d = texelFetch(tCoarseTex, c + ivec2(0, 1), 0).r;
  float e = texelFetch(tCoarseTex, c + ivec2(1, 1), 0).r;
  float h = mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
  float o = length((g - gc) / tCoarseInfo.zw);
  return mix(h, tDeep.x, smoothstep(0.0, tDeep.y, o));
}

float tTileOK(ivec2 t, int T) {
  vec4 e = texelFetch(tTileTex, t % T, 0);
  return (ivec2(e.xy + 0.5) == t) ? e.z : 0.0;
}

// exact height from the fine window: (height, weight)
vec2 tFineHeight(vec2 p) {
  vec2 g = p * tFine.y;
  vec2 fl = floor(g);
  vec2 f = g - fl;
  int N = int(tFine.z + 0.5);
  int B = int(tFine.w + 0.5);
  int T = N / B;
  ivec2 i0 = ivec2(fl) + int(tFineOff + 0.5);
  ivec2 i1 = i0 + 1;
  ivec2 t0 = i0 / B;
  ivec2 t1 = i1 / B;
  float v = tTileOK(t0, T);
  if (t1.x != t0.x) v = min(v, tTileOK(ivec2(t1.x, t0.y), T));
  if (t1.y != t0.y) {
    v = min(v, tTileOK(ivec2(t0.x, t1.y), T));
    if (t1.x != t0.x) v = min(v, tTileOK(t1, T));
  }
  if (v <= 0.0) return vec2(0.0);
  ivec2 s0 = i0 % N;
  ivec2 s1 = i1 % N;
  float a = texelFetch(tFineHTex, s0, 0).r;
  float b = texelFetch(tFineHTex, ivec2(s1.x, s0.y), 0).r;
  float d = texelFetch(tFineHTex, ivec2(s0.x, s1.y), 0).r;
  float e = texelFetch(tFineHTex, s1, 0).r;
  return vec2(mix(mix(a, b, f.x), mix(d, e, f.x), f.y), v);
}

float tHeight(vec2 p, out float wf) {
  float h = tCoarseH(p);
  wf = 0.0;
  float d = max(abs(p.x - tLodCam.x), abs(p.y - tLodCam.z));
  float w = 1.0 - smoothstep(tFineFade.x, tFineFade.y, d);
  if (w > 0.0) {
    vec2 fh = tFineHeight(p);
    w *= fh.y;
    h = mix(h, fh.x, w);
    wf = w;
  }
  return h;
}

vec3 tNormalAt(vec2 p, float wf) {
  vec2 uvC = ((p - tCoarseInfo.xy) * tCoarseInfo.zw + 0.5) / tCoarseSize;
  vec2 n = textureLod(tDataTex, uvC, 0.0).xy;
  if (wf > 0.0) n = mix(n, textureLod(tFineNTex, (p * tFine.y + 0.5) / tFine.z, 0.0).xy, wf);
  n = n * 2.0 - 1.0;
  return normalize(vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y));
}
`;

/** Ground palette (authored in sRGB). */
const PALETTE = /* glsl */ `
const vec3 C_SNOW = ${lin('#f3f6fa')};
const vec3 C_SNOW_OLD = ${lin('#e3e6ea')};
const vec3 C_SNOW_BLUE = ${lin('#c4d7ec')};
const vec3 C_PACKED = ${lin('#d3d8de')};
const vec3 C_PLOWED = ${lin('#c8c7c3')};
const vec3 C_GRIT = ${lin('#5b5248')};
const vec3 C_GNEISS = ${lin('#2b2e34')};
const vec3 C_GNEISS2 = ${lin('#4b4f57')};
const vec3 C_FELDSPAR = ${lin('#6c5853')};
const vec3 C_QUARTZ = ${lin('#a7a6a2')};
const vec3 C_IRON = ${lin('#4e4036')};
const vec3 C_LICHEN = ${lin('#7d7c70')};
const vec3 C_WETROCK = ${lin('#161719')};
const vec3 C_KELP = ${lin('#3a311e')};
const vec3 C_ICEFOOT = ${lin('#d3e2eb')};
const vec3 C_BLACKSAND = ${lin('#232324')};
const vec3 C_BLACKSAND2 = ${lin('#333130')};
const vec3 C_HEATHER = ${lin('#4a3b35')};
const vec3 C_LITTER = ${lin('#463d35')};
const vec3 C_SPRUCE_FAR = ${lin('#26302c')};
const vec3 C_BIRCH_FAR = ${lin('#8d8288')};
const vec3 C_MOSS = ${lin('#4d6a28')};
const vec3 C_RIME = ${lin('#e2ecf2')};
const vec3 C_ICE_DEEP = ${lin('#050b10')};
const vec3 C_ICE_CLEAR = ${lin('#14303b')};
const vec3 C_ICE_CRACK = ${lin('#d5e6ef')};
const vec3 C_SEABED = ${lin('#2a2b29')};
`;

/** The wind that carved the snow (unit xz, blowing toward), the sastrugi and drift frame. */
const WIND_GLSL = /* glsl */ `
const vec2 T_WIND = vec2(${SNOW_WIND.x.toFixed(4)}, ${SNOW_WIND.z.toFixed(4)});
`;

/**
 * Snow albedo as the terrain draws it on open, level ground:
 * `vec3 tSnowColorAt(vec2 xz, float dist)`. For features that sit in the snow
 * (grass tips, tree skirts, drift caps) and want to match the ground.
 * Declares `uniform sampler2D tNoise` (bind ctx.materials.noise).
 */
export const SNOW_COLOR_GLSL = /* glsl */ `
#define TSAT(x) clamp(x, 0.0, 1.0)
uniform sampler2D tNoise;
${PALETTE}
${WIND_GLSL}
const mat2 tR1 = mat2(0.8253, 0.5646, -0.5646, 0.8253);
const mat2 tR2 = mat2(0.6216, -0.7833, 0.7833, 0.6216);

vec3 tSnowColorAt(vec2 xz, float dist) {
  vec2 q = vec2(dot(xz, T_WIND), dot(xz, vec2(-T_WIND.y, T_WIND.x)));
  float nA = texture(tNoise, xz * (1.0 / 2600.0) + vec2(0.37, 0.71)).r;
  float nB = texture(tNoise, tR1 * xz * (1.0 / 640.0) + vec2(0.13, 0.52)).g;
  float nW = texture(tNoise, vec2(q.x / 260.0, q.y / 48.0) + 0.17).g;
  vec3 snow = mix(C_SNOW, C_SNOW_OLD, TSAT((nA - 0.5) * 2.5 + (nB - 0.5) * 1.5 + 0.3));
  return snow * (0.97 + 0.05 * nW);
}
`;

/** Shared by terrain and rocks: palette, wind frame, world-space bump, triplanar gneiss. */
export const SHADE_COMMON_GLSL = /* glsl */ `
${SNOW_COLOR_GLSL}

// surface-gradient bump in world space (Mikkelsen)
vec3 tBump(vec3 N, vec3 P, float hgt) {
  vec3 dpdx = dFdx(P);
  vec3 dpdy = dFdy(P);
  float dhx = dFdx(hgt);
  float dhy = dFdy(hgt);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-9) return N;
  vec3 g = sign(det) * (dhx * r1 + dhy * r2) / abs(det);
  float gl = length(g);
  if (gl > 0.7) g *= 0.7 / gl;
  return normalize(N - g);
}

// ledge-ness of the last tRockColor call (0..1): sheet joints and foliation steps where snow lies
float tRockBand = 0.0;

// triplanar gneiss: cool dark grey with gently tilted foliation, sheet-joint ledges at two
// scales (≈23 m and ≈4 m), sparse feldspar and quartz close up, faint water stain down the
// fall line. Large-scale tone changes come from a 420 m tile so faces read as one rock from
// afar instead of camouflage blotches.
vec3 tRockColor(vec3 P, vec3 N, float near, out float rh) {
  vec3 bw = abs(N);
  bw *= bw;
  bw *= bw;
  bw /= (bw.x + bw.y + bw.z);
  vec4 r = texture(tNoise, P.zy * (1.0 / 70.0)) * bw.x + texture(tNoise, P.xy * (1.0 / 70.0) + 0.31) * bw.z + texture(tNoise, P.xz * (1.0 / 70.0) + 0.67) * bw.y;
  vec4 R = texture(tNoise, P.zy * (1.0 / 420.0) + 0.13) * bw.x + texture(tNoise, P.xy * (1.0 / 420.0) + 0.53) * bw.z + texture(tNoise, P.xz * (1.0 / 420.0) + 0.29) * bw.y;
  float d = texture(tNoise, P.zy * (1.0 / 9.0) + 0.5).r * bw.x + texture(tNoise, P.xy * (1.0 / 9.0) + 0.2).r * bw.z + texture(tNoise, P.xz * (1.0 / 9.0) + 0.8).r * bw.y;
  // foliation: gently tilted planes, warped at two scales
  float fol = dot(P, vec3(0.2, 1.0, 0.13)) + (R.r - 0.5) * 70.0 + (r.r - 0.5) * 9.0;
  float bandF = sin(fol * 1.7) * 0.5 + 0.5;
  float bandC = sin(fol * (6.2832 / 23.0)) * 0.5 + 0.5;
  // ledges: flat-topped steps where snow can lie
  float ledgeC = smoothstep(0.72, 0.94, bandC + (r.g - 0.5) * 0.5 + (R.b - 0.5) * 0.3) * TSAT((r.b - 0.32) * 2.5) * TSAT((R.a - 0.3) * 2.5);
  float ledgeF = smoothstep(0.72, 0.94, bandF + (d - 0.5) * 0.5) * near;
  tRockBand = max(ledgeC, ledgeF * 0.8);
  vec3 c = mix(C_GNEISS, C_GNEISS2, TSAT(0.4 + (R.g - 0.5) * 1.4 + (r.g - 0.5) * 0.9 + (bandC - 0.5) * 0.3 + (bandF - 0.5) * 0.25 * near));
  c = mix(c, C_FELDSPAR, TSAT((r.b - 0.64) * 4.0) * 0.3 * near);
  float vein = 1.0 - smoothstep(0.0, 0.022, abs(r.a - 0.5));
  c = mix(c, C_QUARTZ, vein * 0.5 * near);
  // water / iron stain streaks down the steep walls, faint
  float stain = texture(tNoise, vec2(dot(P.xz, vec2(0.7, 0.7)) * (1.0 / 30.0), P.y * (1.0 / 160.0)) + 0.37).b;
  c = mix(c, C_IRON, TSAT((stain - 0.6) * 3.0) * TSAT(1.0 - bw.y * 2.5) * 0.25);
  float crack = 1.0 - smoothstep(0.0, 0.03, abs(r.b - 0.5));
  c *= 1.0 - 0.3 * crack * near;
  c *= 0.9 + 0.2 * mix(0.5, d, near);
  c = mix(c, C_LICHEN, TSAT((r.a - 0.64) * 5.0) * TSAT(N.y * 2.0 - 0.6) * 0.22);
  rh = (r.g - 0.5) * 0.3 + (d - 0.5) * 0.05 * near - crack * 0.05 * near + bandF * 0.05 * near + ledgeC * 0.12;
  return c;
}
`;

export const TERRAIN_SHADE_GLSL = /* glsl */ `
uniform sampler2D tDataTex;
uniform sampler2D tFineNTex;
uniform sampler2D tLocalTex;
uniform sampler2D tTrailTex;
#ifndef T_SHADOW_H
#define T_SHADOW_H
uniform sampler2D tShadowH;
#endif
uniform vec4 tCoarseInfo;
uniform vec2 tCoarseSize;
uniform vec4 tFine;
uniform vec4 tLocalInfo;
uniform vec4 tWorldInfo;
uniform sampler2D tVegTex;
uniform vec4 tVegInfo;
uniform vec3 tLightDir;
uniform vec4 tLake;
uniform vec4 tLakeR;
uniform vec4 tRink;
uniform vec4 tSpring;
uniform vec4 tBeach;
varying vec3 vTPos;
varying float vTFine;
float tTerrainShadow = 1.0;
// read by the lighting hooks: snow cover (glints, translucency, sky tint) and polished ice (mirror)
float tSnowW = 0.0;
float tIceW = 0.0;
vec3 tSnowAlb = vec3(0.0);

float tEllipse(vec2 p, vec2 c, vec2 r, float rot) {
  vec2 d = p - c;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 u = vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);
  float k0 = length(u / r);
  float k1 = length(u / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

float tHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// distance-like measure to the nearest edge of a jittered cell network (F2 - F1)
float tCellEdge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + vec2(tHash(i + g), tHash(i + g + 19.7)) * 0.9 + 0.05 - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) d2 = d;
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void terrainShade(vec3 P, float wf, out vec3 alb, out float rgh, out vec3 N, out float ao) {
  vec2 xz = P.xz;
  float h = P.y;
  float dist = length(P - cameraPosition);
  float fNear = 1.0 - smoothstep(25.0, 140.0, dist);
  float fMid = 1.0 - smoothstep(120.0, 1500.0, dist);

  // baked macro data: normal, cavity, wind shelter; exact normal + path masks near the camera
  vec2 uvC = ((xz - tCoarseInfo.xy) * tCoarseInfo.zw + 0.5) / tCoarseSize;
  vec4 dC = texture(tDataTex, uvC);
  vec4 dF = texture(tFineNTex, (xz * tFine.y + 0.5) / tFine.z);
  vec2 nxz = mix(dC.xy, dF.xy, wf) * 2.0 - 1.0;
  vec3 Ng = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y));
  float sl = length(Ng.xz) / max(Ng.y, 0.05);
  float cav = (dC.z - 0.5) * 8.0;
  float shelter = (dC.w - 0.5) * 2.0;
  float exposed = TSAT(-shelter * 1.6);
  float lee = TSAT(shelter * 1.6);

  // wind frame: x along the wind, y across it
  vec2 q = vec2(dot(xz, T_WIND), dot(xz, vec2(-T_WIND.y, T_WIND.x)));

  // multi-scale noise, rotated scales so nothing repeats visibly from the air
  vec4 nA = texture(tNoise, xz * (1.0 / 2600.0) + vec2(0.37, 0.71));
  vec4 nB = texture(tNoise, tR1 * xz * (1.0 / 640.0) + vec2(0.13, 0.52));
  vec4 nC = texture(tNoise, tR2 * xz * (1.0 / 90.0));
  vec4 nD = texture(tNoise, xz * (1.0 / 11.0));
  vec4 nW = texture(tNoise, vec2(q.x / 260.0, q.y / 48.0) + 0.17);
  float grain = texture(tNoise, tR1 * xz * (1.0 / 1.9)).a;

  // ---- snow: wind-packed and fresh, blue in hollows and drift troughs
  vec3 snow = mix(C_SNOW, C_SNOW_OLD, TSAT((nA.r - 0.5) * 2.5 + (nB.g - 0.5) * 1.5 + 0.3 + exposed * 0.35 - lee * 0.3));
  snow *= 0.97 + 0.05 * nW.g;
  float trough = TSAT((0.42 - nW.b) * 2.5) * (0.4 + 0.6 * lee);
  float hollow = TSAT(cav * 0.16) + trough * 0.3;
  snow = mix(snow, C_SNOW_BLUE, TSAT(hollow) * 0.42);
  // wind crust: firm, slightly grey and glossy patches on exposed ground between soft powder
  float crust = TSAT((nC.r - 0.52) * 3.0 + (nW.a - 0.5) * 1.2) * (0.3 + 0.7 * exposed) * (1.0 - lee * 0.7);
  snow *= 1.0 - 0.045 * crust;
  // close up: crystalline grain
  snow *= mix(1.0, 0.975 + 0.05 * grain, fNear);

  // ---- under the trees: shaded, needle-strewn snow and tree wells
  vec4 veg = texture(tVegTex, (xz - tVegInfo.xy) * tVegInfo.zw);
  // from afar a softened mask (no pin-holes in the canopy) with ragged edges: tree groups
  // (clumps) decide where a wood ends
  vec4 vegS = texture(tVegTex, (xz - tVegInfo.xy) * tVegInfo.zw, 1.5);
  float farF = smoothstep(220.0, 900.0, dist);
  // (tNoise channels hold 4 / 8 / 16 / 32 features per tile: .a at 1/160 gives ~5 m crowns,
  // .b at 1/300 ~19 m clumps)
  float crown = texture(tNoise, tR2 * xz * (1.0 / 160.0) + 0.41).a;
  float clump = texture(tNoise, tR1 * xz * (1.0 / 300.0) + 0.23).b;
  float stand = smoothstep(0.26, 0.44, vegS.r + (clump - 0.5) * 0.3);
  float treeW = mix(TSAT(veg.r * 1.3), stand, farF);
  vec3 forest = snow * mix(0.9, 0.78, nC.g);
  float litter = TSAT((nD.a - 0.6) * 5.0) * fNear * TSAT((grain - 0.45) * 4.0);
  forest = mix(forest, C_LITTER, litter * 0.35);
  // from afar the forest floor reads darker through the crowns
  forest = mix(forest, snow * 0.62, (1.0 - fNear) * 0.5);
  // and farther still the forest is its canopy (the flora feature draws the trees nearer than
  // this): near-black snow-flecked spruce, a mauve-brown haze of bare birch over the snow; single
  // crowns as a fine speckle, averaging out with distance while the clumps carry the texture
  float birchS = smoothstep(0.35, 0.75, vegS.a);
  vec3 canopy = mix(C_SPRUCE_FAR * (0.8 + 0.4 * nC.g), C_BIRCH_FAR * (0.85 + 0.3 * nC.b), birchS);
  float fineGap = mix(smoothstep(0.5, 0.8, crown), 0.3, smoothstep(300.0, 1200.0, dist));
  float clumpGap = smoothstep(0.6, 0.74, clump);
  float gap = TSAT(fineGap * mix(0.25, 0.55, birchS) + clumpGap * mix(0.25, 0.45, birchS));
  canopy = mix(canopy, snow * 0.8, gap);
  float canopyW = farF * 0.9;
  forest = mix(forest, canopy, canopyW);
  canopyW *= treeW;
  vec3 col = mix(snow, forest, treeW);
  float rough = mix(mix(0.84, 0.6, crust), 0.95, canopyW);

  // ---- exposed rock: steep faces and wind-scoured crests, snow left on ledges and in couloirs
  float thr = 1.0 + lee * 0.28 - exposed * 0.22 + (nB.g - 0.5) * 0.45 + (nC.b - 0.5) * 0.28;
  // spray-washed crags and skerries just above the sea hold little snow
  thr -= 0.4 * (1.0 - smoothstep(5.0, 16.0, h)) * smoothstep(0.5, 3.0, h);
  // the north foreland's moraine and domes keep their snow (only the shore cliffs and the Teeth show rock)
  thr += 0.45 * smoothstep(-900.0, -1000.0, xz.y) * (1.0 - smoothstep(170.0, 340.0, h));
  float rockW = TSAT((sl - thr) / 0.22);
  // ribs and buttresses breaking through the snow aprons under the high walls, along the fall line
  vec2 fl = normalize(Ng.xz + 1e-4);
  float ribN = mix(texture(tNoise, vec2(xz.x / 38.0, xz.y / 140.0) + 0.61).r, texture(tNoise, vec2(xz.y / 38.0, xz.x / 140.0) + 0.27).r, fl.x * fl.x);
  float outc = smoothstep(0.62, 0.8, ribN * 0.55 + nC.b * 0.3 + nB.a * 0.15 + (sl - 0.85) * 0.3) * TSAT((sl - 0.5) / 0.2) * TSAT((h - 240.0) / 160.0);
  rockW = max(rockW, outc);
  // couloirs and hollows on the faces hold snow
  rockW *= 1.0 - TSAT(cav * 0.22) * TSAT((2.2 - sl) * 1.2);
  // scoured crests and knolls: thin snow, rock and heather showing through
  float scour = exposed * TSAT((h - 140.0) / 220.0) * TSAT(0.4 - cav * 0.25) * TSAT((nC.g - 0.38) * 3.0);
  float rh;
  vec3 rockC = tRockColor(P, Ng, fNear, rh);
  // snow left on the faces: flutes and streaks down the fall line, thinning on the sheerest walls
  float stick = TSAT((2.5 - sl) * 0.8) * (0.55 + 0.45 * lee);
  float ledge = TSAT(tRockBand * 1.25 - 0.1 + (nC.r - 0.5) * 0.35 + (stick - 0.5) * 0.4) * stick;
  // couloirs and runnels down the faces hold snow
  ledge = max(ledge, TSAT(cav * 0.22 - 0.35 + (nC.g - 0.5) * 0.4) * TSAT((2.6 - sl) * 0.9));
  ledge = max(ledge, TSAT((nD.g - 0.64) * 4.0) * TSAT((1.5 - sl) * 2.0) * 0.8);
  rockC = mix(rockC, snow * 0.96, ledge * 0.85);
  col = mix(col, mix(C_HEATHER * (0.8 + 0.4 * nD.b), rockC, TSAT((nC.a - 0.5) * 3.0 + 0.5)), scour * 0.55 * (1.0 - treeW));
  col = mix(col, rockC, rockW);
  rough = mix(rough, 0.72, rockW);
  float snowW = (1.0 - rockW * (1.0 - ledge * 0.85)) * (1.0 - scour * 0.5) * (1.0 - canopyW * 0.85);

  // ---- the sea shore: wet black rock and wrack below the tide, a white ice foot above
  float wetLine = 0.65 + (nC.b - 0.5) * 0.5 + (nD.b - 0.5) * 0.2;
  float shoreW = TSAT((h + 2.0) / 1.5) * TSAT((3.2 - h) / 1.2);
  float wetW = TSAT((wetLine - h) / 0.25);
  float kelpW = TSAT(1.0 - abs(h - wetLine + 0.35) / 0.35) * TSAT((nC.g - 0.38) * 4.0) * TSAT((nD.r - 0.35) * 3.0);
  float footTop = 1.75 + (nC.r - 0.5) * 0.9 + (nD.g - 0.5) * 0.3;
  float footW = TSAT((h - wetLine) / 0.12) * TSAT((footTop - h) / 0.2) * TSAT((1.6 - sl) * 2.0);
  vec3 wetRock = mix(C_WETROCK, rockC * 0.45, 0.35);
  vec3 shore = mix(wetRock, C_KELP * (0.8 + 0.4 * nD.a), kelpW);
  shore = mix(shore, C_ICEFOOT * (0.92 + 0.1 * nD.b), footW);
  float shoreMix = shoreW * max(wetW, footW);

  // ---- Ice Beach: black sand, wet below the swash, snow patches on the back beach
  float bd = length(xz - tBeach.xy) / tBeach.z;
  float beachW = (1.0 - smoothstep(0.75, 1.0, bd)) * TSAT((tBeach.w + 1.2 + (nC.b - 0.5) * 1.5 - h) / 1.0) * TSAT((0.7 - sl) * 3.0);
  vec3 sand = mix(C_BLACKSAND, C_BLACKSAND2, TSAT((nC.g - 0.5) * 2.0 + 0.5)) * mix(1.0, 0.85 + 0.3 * grain, fNear);
  sand *= mix(1.0, 0.72, TSAT((wetLine + 0.2 - h) / 0.3));
  float sandSnow = TSAT((h - tBeach.w + 0.2 + (nD.b - 0.5) * 1.2) / 0.5) * TSAT((nC.a - 0.45) * 3.0);
  // dry sand above the swash: snow blown across it in thin streaks along the wind, rime between
  // (thin wisps in loose patches: one stretched lookup alone repeats as parallel bands)
  float blown = TSAT((texture(tNoise, vec2(q.x / 31.0, q.y / 2.3) + 0.37).g - 0.6) * 4.0)
    * TSAT((texture(tNoise, vec2(q.x / 83.0, q.y / 13.0) + 0.61).b - 0.48) * 3.0) * TSAT((nW.b - 0.35) * 3.0) * 0.75;
  float dry = TSAT((h - wetLine - 0.5) / 0.5);
  sandSnow = max(sandSnow, blown * dry * 0.85);
  sand = mix(sand, mix(sand, C_RIME, 0.18), dry * TSAT((nD.g - 0.45) * 3.0));
  sand = mix(sand, snow * 0.95, sandSnow);

  col = mix(col, shore, shoreMix * (1.0 - beachW));
  rough = mix(rough, mix(0.75, 0.25, wetW), shoreMix * (1.0 - beachW));
  col = mix(col, sand, beachW);
  rough = mix(rough, mix(0.9, 0.35, wetW), beachW);
  snowW *= 1.0 - shoreMix * (1.0 - footW * 0.6);
  snowW *= 1.0 - beachW * (1.0 - sandSnow);

  // ---- the hot spring: a melt ring of wet rock and green moss, rime on its rim
  float sd = length(xz - tSpring.xy) + (nD.b - 0.5) * 3.0 + (nC.g - 0.5) * 3.0;
  float meltW = (1.0 - smoothstep(tSpring.z * 0.5, tSpring.z, sd)) * TSAT((h - tSpring.w + 6.0) / 3.0) * 0.85;
  float rimW = TSAT(1.0 - abs(sd - tSpring.z * 1.02) / (tSpring.z * 0.18)) * TSAT((h - tSpring.w + 6.0) / 3.0);
  vec3 melt = mix(mix(C_WETROCK * 1.8, rockC * 0.7, 0.5), C_MOSS * (0.7 + 0.5 * nD.a), TSAT((nD.a - 0.5) * 4.0) * TSAT((sd - tSpring.z * 0.3) / 2.0) * 0.8);
  melt = mix(melt, snow * 0.8, TSAT((nD.r - 0.55) * 4.0) * TSAT((sd - tSpring.z * 0.45) / 2.0));
  col = mix(col, C_RIME, rimW * 0.5 * (1.0 - meltW));
  col = mix(col, melt, meltW);
  rough = mix(rough, 0.45, meltW);
  snowW *= 1.0 - meltW;

  // ---- masks: paths, plowed snow, structures
  vec2 uvL = (xz - tLocalInfo.xy) * tLocalInfo.zw;
  float inL = step(0.0, uvL.x) * step(uvL.x, 1.0) * step(0.0, uvL.y) * step(uvL.y, 1.0);
  vec4 mL = texture(tLocalTex, vec2(uvL.x, 1.0 - uvL.y)) * inL;
  vec2 pIsl = texture(tTrailTex, (xz - tWorldInfo.xy) * tWorldInfo.zw).rg;
  float pathL = TSAT((mL.r - 0.5) * 4.0);
  float pathO = mix(TSAT((pIsl.r - 0.2) * 2.0), TSAT(dF.z * 1.25), wf);
  float pathW = mix(pathO, pathL, inL);
  pathW = smoothstep(0.15, 0.85, pathW + ((nC.b - 0.5) * 0.5 + (nD.b - 0.5) * 0.35) * pathW * (1.0 - pathW) * 3.0);
  float plowW = mix(TSAT((pIsl.g - 0.3) * 2.5), TSAT((mL.g - 0.5) * 4.0), inL);
  // snowbanks thrown up along the shoulders: fresh, bright, a little lumpy
  float shoulder = TSAT(dF.w - dF.z) * wf;
  col = mix(col, snow * (1.02 + 0.04 * nD.a), TSAT(shoulder * 1.2) * (1.0 - rockW) * 0.6);

  // packed trail: trodden, faintly grey, footprints close up
  vec3 packed = C_PACKED * (0.95 + 0.08 * nD.b) * mix(1.0, 0.93 + 0.1 * grain, fNear);
  // plowed road: compacted snow with grit spread on it
  float grit = TSAT((0.4 - texture(tNoise, tR2 * xz * 1.7 + 0.21).a) * 3.0) * TSAT((nD.r - 0.3) * 2.0);
  vec3 plowed = mix(C_PLOWED * (0.92 + 0.12 * nC.r), C_GRIT, grit * 0.45 * (0.4 + 0.6 * fNear));
  vec3 pathC = mix(packed, plowed, plowW);
  col = mix(col, pathC, pathW);
  rough = mix(rough, mix(0.62, 0.78, plowW), pathW);
  snowW *= 1.0 - pathW * mix(0.6, 0.9, plowW);
  // shovelled patches (local mask green, away from roads): thin trampled snow
  float cleared = TSAT((mL.g - 0.3) * 3.0) * (1.0 - pathW);
  col = mix(col, packed * 0.97, cleared);
  snowW *= 1.0 - cleared * 0.6;
  float under = TSAT((mL.b - 0.3) * 3.0);
  col = mix(col, packed * 0.9, under * 0.5);

  // ---- Mirror Lake: black ice with snow streaks, cracks, bubbles and a cleared rink
  float lakeBound = tEllipse(xz, tLake.xy, tLakeR.xy + 45.0, tLakeR.z);
  float iceW = lakeBound < 0.0 ? TSAT((tLake.z + 0.03 - h) / 0.025) : 0.0;
  float iceMirror = 0.0;
  if (iceW > 0.0) {
    // nearness to the shore from the height pyramid (a shoreline margin of drifted snow)
    float sh = 0.0;
    vec2 su = tWorldInfo.zw;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(k == 0 ? 7.0 : (k == 1 ? -7.0 : 0.0), k == 2 ? 7.0 : (k == 3 ? -7.0 : 0.0));
      float hn = textureLod(tShadowH, (xz + o - tWorldInfo.xy) * su, 0.0).r;
      sh = max(sh, TSAT((hn - tLake.z - 0.1) / 0.5));
    }
    float rs = tEllipse(xz, tRink.xy, tRink.zw, tLakeR.w) + (nD.b - 0.5) * 1.2;
    float rink = 1.0 - smoothstep(-0.6, 0.4, rs);
    // wind-swept snow on the ice: broad soft drifts along the wind, a margin along the shore, a dusting
    // long streamlined drifts: broad wind-aligned bands broken into tongues, few small flecks
    float drift = texture(tNoise, vec2(q.x / 330.0, q.y / 60.0) + 0.29).g * 0.56 + texture(tNoise, vec2(q.x / 110.0, q.y / 22.0) + 0.61).b * 0.3 + texture(tNoise, vec2(q.x / 30.0, q.y / 7.0) + 0.47).a * 0.14;
    float soft = mix(0.025, 0.08, smoothstep(30.0, 300.0, dist));
    // mostly bare black ice: the snow lies in long streaks and tongues along the wind
    float powder = smoothstep(0.63 - soft, 0.63 + soft, drift + (nA.g - 0.5) * 0.22);
    powder = max(powder, TSAT(sh * 1.3 - 0.15 + (nD.g - 0.5) * 0.6));
    float dust = TSAT((nC.a - 0.45) * 1.5) * 0.25 + TSAT((nD.b - 0.55) * 2.0) * 0.1;
    powder *= 1.0 - rink;
    dust *= 1.0 - rink * 0.8;
    // the ice itself: near-black where clear and deep, green-blue depth tint, frosted patches
    vec3 ice = mix(C_ICE_DEEP, C_ICE_CLEAR, TSAT((nB.r - 0.35) * 1.4) * 0.65 + TSAT((nC.g - 0.5) * 2.0) * 0.25);
    float frost = TSAT((nC.b - 0.55) * 3.0 + (nD.a - 0.5) * 0.8) * (1.0 - rink * 0.8);
    ice = mix(ice, C_ICE_CLEAR * 2.4, frost * 0.35);
    // cracks: straight-edged fracture polygons at three scales (long cracks across the lake, an
    // incomplete network between them, fine shatter in patches close up), thin white lines with a
    // milky halo where the fracture plane shows through the clear ice; anti-aliased by footprint
    vec2 cw = (nB.rg - 0.5) * 0.35;
    float e0 = tCellEdge(xz * (1.0 / 46.0) + cw + 3.1);
    float fw0 = fwidth(e0) + 1e-4;
    float big = (1.0 - smoothstep(0.0016, 0.0016 + fw0 * 1.2, e0)) * TSAT((nA.b - 0.36) * 4.0);
    float halo = (1.0 - smoothstep(0.0, 0.012 + fw0, e0)) * TSAT((nA.b - 0.36) * 4.0);
    float e1 = tCellEdge(xz * (1.0 / 11.0) + cw * 2.0 + 7.7);
    float fw1 = fwidth(e1) + 1e-4;
    float net = (1.0 - smoothstep(0.0035, 0.0035 + fw1 * 1.2, e1)) * TSAT((nB.b - 0.5) * 3.0) * TSAT((nC.a - 0.45) * 3.0);
    float e2 = tCellEdge(xz * (1.0 / 2.6) + nC.rg * 0.3);
    float fw2 = fwidth(e2) + 1e-4;
    float fine = (1.0 - smoothstep(0.005, 0.005 + fw2 * 1.2, e2)) * TSAT((nC.b - 0.66) * 5.0) * TSAT((nB.a - 0.5) * 4.0) * (1.0 - smoothstep(12.0, 40.0, dist));
    // a line thinner than a pixel fades instead of aliasing
    big *= TSAT(0.004 / fw0);
    net *= TSAT(0.012 / fw1);
    fine *= TSAT(0.03 / fw2);
    float crack = TSAT(big + net * 0.55 + fine * 0.5) * (1.0 - smoothstep(120.0, 600.0, dist) * 0.85);
    ice = mix(ice, C_ICE_CLEAR * 2.2, halo * 0.22 * (1.0 - smoothstep(60.0, 300.0, dist)));
    ice = mix(ice, C_ICE_CRACK * 0.75, crack * 0.6);
    // trapped bubbles close up: small pale specks in hashed cells
    vec2 bc = floor(xz * 3.0);
    vec2 bf = fract(xz * 3.0) - 0.5;
    float bub = step(0.92, tHash(bc)) * (1.0 - smoothstep(0.05, 0.12, length(bf - (vec2(tHash(bc + 7.1), tHash(bc + 3.3)) - 0.5) * 0.6)));
    ice = mix(ice, C_ICE_CRACK * 0.55, bub * 0.6 * (1.0 - smoothstep(4.0, 18.0, dist)));
    // skate scratches in the rink: fine pale arcs running round the oval and crossing each
    // other, in bundles that come and go (three wobbling families of lines parallel to the edge)
    float scr = 0.0;
    if (rink > 0.0 && dist < 45.0) {
      float re = tEllipse(xz, tRink.xy, tRink.zw, tLakeR.w);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float wob = texture(tNoise, xz * (1.0 / (60.0 + fk * 25.0)) + vec2(0.13 + fk * 0.29, 0.71 - fk * 0.17)).r - 0.5;
        float v = re * (1.0 / 0.85) + wob * (3.0 + fk * 1.5) + fk * 0.37;
        float dv = abs(fract(v + 0.5) - 0.5);
        float ln = 1.0 - smoothstep(0.0, fwidth(v) * 1.2 + 0.012, dv);
        float keep = step(tHash(vec2(floor(v + 0.5), fk * 13.1)), 0.5);
        float run = smoothstep(0.44, 0.62, texture(tNoise, xz * (1.0 / 45.0) + vec2(fk * 0.43, 0.21)).g);
        scr += ln * keep * run * (0.6 + 0.4 * tHash(vec2(floor(v + 0.5), fk + 4.0)));
      }
      scr = TSAT(scr) * (1.0 - smoothstep(12.0, 45.0, dist));
    }
    ice = mix(ice, C_ICE_CRACK * 0.6, scr * rink * 0.5);
    ice = mix(ice, snow * 0.8, dust);
    vec3 lakeC = mix(ice, snow * (0.94 + 0.05 * nD.r), powder);
    float lakeR = mix(mix(0.05, 0.22, frost + dust), 0.85, powder);
    lakeR = mix(lakeR, 0.03, rink * (1.0 - powder));
    col = mix(col, lakeC, iceW);
    rough = mix(rough, lakeR, iceW);
    snowW = mix(snowW, powder, iceW);
    iceMirror = iceW * (1.0 - powder) * (1.0 - crack * 0.4) * (1.0 - frost * 0.5) * (1.0 - dust);
  }

  // ---- sea floor (mostly hidden by the ocean, which draws its own)
  float uwW = TSAT((0.1 - h) / 0.6) * (1.0 - beachW);
  col = mix(col, mix(C_SEABED, rockC * 0.6, TSAT((nC.b - 0.4) * 3.0)), uwW);
  rough = mix(rough, 0.6, uwW);

  // ---- occlusion: cavities, tree wells, rock crevices
  ao = 1.0 - 0.3 * TSAT(cav * 0.12);
  ao *= 1.0 - 0.18 * treeW * TSAT((nD.g - 0.4) * 2.0);
  ao *= mix(1.0, 0.72 + 0.28 * TSAT(rh * 4.0 + 0.6), rockW * fNear);

  // ---- detail relief, faded with distance
  // sastrugi and wind ripples on exposed snow; soft dimples in the lee
  vec2 qs = q + (nC.rg - 0.5) * 6.0;
  float sastrugi = texture(tNoise, vec2(qs.x / 5.0, qs.y / 1.7) + 0.53).g * 0.6 + texture(tNoise, tR1 * vec2(qs.x / 3.1, qs.y / 1.3) + 0.21).b * 0.4;
  sastrugi = smoothstep(0.35, 0.75, sastrugi);
  float snowBump = (sastrugi - 0.5) * mix(0.02, 0.07, exposed) * TSAT((nC.b - 0.3) * 2.0) + (nD.a - 0.5) * 0.04 * lee + (grain - 0.5) * 0.004;
  float bump = snowBump * snowW * (1.0 - iceW);
  bump += rh * 0.6 * rockW;
  bump += ((nD.r - 0.5) * 0.05 + (grain - 0.5) * 0.008) * beachW;
  // footprints in packed trails: oval dimples in hashed cells
  vec2 fc = floor(xz * 1.6);
  vec2 ff = fract(xz * 1.6) - 0.5;
  float foot = step(0.45, tHash(fc + 3.7)) * (1.0 - smoothstep(0.12, 0.3, length(ff * vec2(1.0, 1.7))));
  bump += (-foot * 0.025 * (1.0 - plowW) + (nD.b - 0.5) * 0.02) * pathW;
  bump *= fNear;
  // wind dunes and drift tongues at walking-to-valley scale
  float dune = texture(tNoise, vec2(qs.x / 42.0, qs.y / 9.5) + 0.83).g * 0.7 + texture(tNoise, vec2(qs.x / 15.0, qs.y / 4.0) + 0.19).r * 0.3;
  bump += (dune - 0.5) * 0.11 * (1.0 - smoothstep(60.0, 450.0, dist)) * TSAT((0.7 - sl) * 2.0) * snowW * (1.0 - iceW) * (0.5 + 0.5 * exposed + 0.3 * lee);
  // macro relief for the far terrain: drifts stretched along the wind
  bump += ((nW.g - 0.5) * 0.6 + (nC.g - 0.5) * 0.25) * fMid * (1.0 - iceW) * (1.0 - beachW) * (1.0 - rockW * 0.5);
  // a canopy seen from afar is lit like a rough mat, not like the ground's swells under it
  bump *= 1.0 - canopyW * 0.85;
  N = tBump(normalize(mix(Ng, vec3(0.0, 1.0, 0.0), canopyW * (1.0 - rockW) * 0.45)), P, bump);
  if (iceW > 0.0) {
    // frozen ripples: a gently wavy mirror
    vec2 wv = vec2(texture(tNoise, xz * (1.0 / 23.0) + 0.13).r, texture(tNoise, xz * (1.0 / 23.0) + 0.57).r) - 0.5;
    N = normalize(mix(N, normalize(vec3(wv.x * 0.012, 1.0, wv.y * 0.012)), iceW * (1.0 - snowW)));
  }

  alb = col;
  rgh = rough;
  tSnowW = TSAT(snowW) * (1.0 - TSAT(uwW * 2.0));
  tIceW = iceMirror;
  tSnowAlb = col;
}
`;

/** Far cull distance of a rock: min(max, a + b · diameter) metres. */
export const ROCK_REACH = { a: 60, b: 220, max: 1700 };

/** Rock vertex: per-instance shape variant (4 position/normal sets), world varyings. */
export const ROCK_VERTEX_PARS = /* glsl */ `
const float rReachA = ${ROCK_REACH.a.toFixed(1)};
const float rReachB = ${ROCK_REACH.b.toFixed(1)};
const float rReachMax = ${ROCK_REACH.max.toFixed(1)};
attribute vec3 position1;
attribute vec3 position2;
attribute vec3 position3;
attribute vec3 normal1;
attribute vec3 normal2;
attribute vec3 normal3;
attribute vec2 aRock;
varying vec3 vRPos;
varying vec3 vRNrm;
varying float vRRand;
varying float vRLocalY;
`;

export const ROCK_SELECT_NORMAL = /* glsl */ `
vec3 objectNormal = aRock.x < 0.5 ? normal : (aRock.x < 1.5 ? normal1 : (aRock.x < 2.5 ? normal2 : normal3));
`;

export const ROCK_SELECT_POSITION = /* glsl */ `
vec3 transformed = aRock.x < 0.5 ? position : (aRock.x < 1.5 ? position1 : (aRock.x < 2.5 ? position2 : position3));
#ifndef ROCK_NO_FADE
{
  // shrink and sink into the ground toward the far cull distance instead of popping
  vec3 rC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float rReach = min(rReachMax, rReachA + rReachB * length(instanceMatrix[1].xyz) * 2.0);
  float rKeep = 1.0 - smoothstep(rReach * 0.75, rReach, distance(rC, cameraPosition));
  transformed = mix(vec3(0.0, -0.9, 0.0), transformed, rKeep);
}
#endif
`;

export const ROCK_WORLD_VARYINGS = /* glsl */ `
vec4 rW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vRPos = rW.xyz;
mat3 rIm = mat3(instanceMatrix);
vec3 rN = objectNormal / vec3(dot(rIm[0], rIm[0]), dot(rIm[1], rIm[1]), dot(rIm[2], rIm[2]));
vRNrm = normalize(mat3(modelMatrix) * (rIm * rN));
vRRand = aRock.y;
vRLocalY = transformed.y;
`;

export const ROCK_FRAGMENT_PARS = /* glsl */ `
varying vec3 vRPos;
varying vec3 vRNrm;
varying float vRRand;
varying float vRLocalY;
`;

/** Gneiss boulders: snow caps on the upper faces, rime on the windward side, ice glaze at the sea. */
export const ROCK_SHADE = /* glsl */ `
vec3 rNw = normalize(vRNrm);
float rDist = length(vRPos - cameraPosition);
float rNear = 1.0 - smoothstep(15.0, 110.0, rDist);
float rh;
vec3 rCol = tRockColor(vRPos * 1.7, rNw, rNear, rh);
float rHgt = vRPos.y;
// boulder-scale detail close up: mineral speckle, crust and lichen rosettes
float rFine = 1.0 - smoothstep(6.0, 40.0, rDist);
vec3 rBw = rNw * rNw;
rBw *= rBw;
rBw /= rBw.x + rBw.y + rBw.z;
vec4 rF = texture(tNoise, vRPos.zy * 0.45 + vRRand) * rBw.x + texture(tNoise, vRPos.xy * 0.45 + vRRand + 0.37) * rBw.z + texture(tNoise, vRPos.xz * 0.45 + vRRand + 0.71) * rBw.y;
rCol *= (1.08 + 0.1 * TSAT(rNw.y)) * mix(1.0, (0.86 + 0.28 * rF.g) * (0.93 + 0.14 * rF.a), rFine);
float rLich = TSAT((rF.b - 0.62) * 6.0 + (rF.a - 0.5) * 2.5) * TSAT(rNw.y * 1.5 + 0.4) * TSAT((rHgt - 2.5) / 3.0);
rCol = mix(rCol, C_LICHEN * vec3(0.95, 1.0, 0.9), rLich * 0.35 * rFine);
float rBumpH = rh * 0.3 * rNear + ((rF.g - 0.5) * 0.05 + (rF.a - 0.5) * 0.015) * rFine;
// wet and ice-glazed by the sea
float rWet = TSAT((2.0 - rHgt) / 1.6);
rCol *= 1.0 - 0.45 * rWet;
rCol *= 0.8 + 0.4 * vRRand;
// rime feathers on the windward faces
float rWind = TSAT(dot(rNw.xz, -T_WIND) * 1.6 - 0.2) * TSAT((rHgt - 3.0) / 4.0);
float rRime = rWind * TSAT((rF.r - 0.38) * 3.0) * 0.6;
rCol = mix(rCol, C_RIME, rRime);
// snow caps on everything that faces up, thicker on big flat tops
float rCapN = (rF.b - 0.5) * 1.4 + (texture(tNoise, vRPos.xz * 0.11 + vRRand).g - 0.5) * 1.2;
float rCap = TSAT((rNw.y - 0.42 + rCapN * 0.25) * 5.0) * TSAT((rHgt - 1.2) / 1.0);
// snow drifted up against the foot of the boulder
rCap = max(rCap, TSAT((0.25 - vRLocalY) * 2.5) * TSAT(rNw.y + 0.6) * TSAT((rHgt - 1.2) / 1.0) * 0.8);
vec3 rSnow = tSnowColorAt(vRPos.xz, rDist);
rCol = mix(rCol, rSnow, rCap);
rBumpH = mix(rBumpH, (rF.a - 0.5) * 0.02, rCap);
float rAO = mix(0.55, 1.0, smoothstep(-0.7, 0.25, vRLocalY));
diffuseColor.rgb = rCol;
`;

/**
 * Terrain-scale cast shadows for a low sun / moon: ray march through a
 * half-float height pyramid, coarser mips for farther steps so only ridges and
 * peaks cast long shadows, penumbra widening with distance. Marches up to
 * the top of the Teeth so a winter sun or moon throws shadows across the fjord.
 */
export const TERRAIN_SHADOW_GLSL = /* glsl */ `
#ifndef T_SHADOW_H
#define T_SHADOW_H
uniform sampler2D tShadowH;
#endif
float terrainSunShadow(vec3 P, vec3 L) {
  if (L.y <= 0.0 || L.y > 0.78) return 1.0;
  float sh = 1.0;
  float t = 5.0;
  for (int i = 0; i < 18; i++) {
    vec3 q = P + L * t;
    if (q.y > ${(TERRAIN_MAX_HEIGHT + 20).toFixed(1)}) break;
    float hq = textureLod(tShadowH, (q.xz - tWorldInfo.xy) * tWorldInfo.zw, log2(1.0 + t / 30.0)).r;
    sh = min(sh, TSAT((q.y + 1.2 - hq) / (0.06 * t + 0.6)));
    t *= 1.43;
  }
  return mix(1.0, sh, TSAT((0.78 - L.y) * 8.0));
}
`;

/**
 * Light hooks for snow (inside the directional-light loop, view-space vectors):
 * a soft wrapped term for light scattered through the snowpack and sparkle
 * glints: hashed micro-facets per 2.5 cm and 12 cm cell that flash when they
 * mirror the sun or the moon into the eye. Needs tSnowW / tSnowAlb from
 * terrainShade and the world position vTPos.
 */
export const SNOW_LIGHT_GLSL = /* glsl */ `
vec3 tHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float tGlintCell(vec3 P, float scale, vec3 Nw, vec3 Hw, float density, float sharp) {
  vec3 q = P * scale;
  vec3 c = floor(q);
  vec3 r = tHash3(c);
  if (r.x > density) return 0.0;
  // the facet: a random normal tipped around the surface normal, a small flake inside the cell
  vec3 fn = normalize(Nw + (tHash3(c + 17.0) - 0.5) * 1.3);
  vec3 f = fract(q) - 0.25 - 0.5 * r.yzx;
  float flake = 1.0 - smoothstep(0.06, 0.2, length(f));
  float spec = TSAT((dot(fn, Hw) - sharp) / (1.0 - sharp));
  return flake * spec * spec;
}

void tSnowLight(IncidentLight dl, vec3 Nv, vec3 Vv, inout ReflectedLight rl) {
  if (tSnowW <= 0.0) return;
  float ndl = dot(Nv, dl.direction);
  // light scattered through the snowpack softens the terminator, slightly blue
  float wrap = max(0.0, (ndl + 0.4) / 1.4) - max(0.0, ndl);
  rl.directDiffuse += dl.color * tSnowAlb * vec3(0.86, 0.95, 1.08) * wrap * 0.3 * tSnowW;
  if (ndl <= 0.0) return;
  // sparkle: world-space facets so the glints stay put on the ground and twinkle as you move
  vec3 Lw = normalize((vec4(dl.direction, 0.0) * viewMatrix).xyz);
  vec3 Vw = normalize(cameraPosition - vTPos);
  vec3 Nw = normalize((vec4(Nv, 0.0) * viewMatrix).xyz);
  vec3 Hw = normalize(Lw + Vw);
  float d = length(cameraPosition - vTPos);
  float g = 0.0;
  float n1 = 1.0 - smoothstep(9.0, 26.0, d);
  float n2 = (1.0 - smoothstep(40.0, 130.0, d)) * smoothstep(6.0, 16.0, d);
  if (n1 > 0.0) g += tGlintCell(vTPos, 40.0, Nw, Hw, 0.07, 0.975) * n1;
  if (n2 > 0.0) g += tGlintCell(vTPos, 8.0, Nw, Hw, 0.05, 0.985) * n2 * 0.7;
  rl.directSpecular += dl.color * g * 40.0 * tSnowW * TSAT(ndl * 4.0);
}
`;
