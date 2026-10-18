/**
 * MeshStandardMaterial patches for the winter ground cover: near blade clumps
 * and far tufts of bleached straw, green melt-ring grass and moss, lyme grass
 * and seed stalks. Keeping the standard material means shadows, fog and
 * image-based light come for free; we only replace the vertex shaping, the
 * albedo, the normal handling (both faces lit like the front), and add a
 * little light through the blades and the aurora's light between environment
 * refreshes.
 */
import * as THREE from 'three';
export function makeFieldUniforms(shared, noise, world) {
    const b = world.bounds;
    return {
        uTime: shared.uTime,
        uWindDir: shared.uWindDir,
        uWindStrength: shared.uWindStrength,
        uNoise: { value: noise },
        uPixel: { value: 0.0015 },
        uTransStrength: { value: 1 },
        uLightDir: shared.uLightDir,
        uShadowH: { value: world.heightTexture },
        uWorldInfo: { value: new THREE.Vector4(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ)) },
        uTerrainShadow: { value: 1 },
        uAuroraFill: shared.uAuroraFill,
    };
}
const COMMON_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform sampler2D uNoise;
uniform float uPixel;
uniform vec3 uLightDir;
uniform sampler2D uShadowH;
uniform vec4 uWorldInfo;
uniform float uTerrainShadow;
varying vec3 vGrassCol;
varying float vGrassTrans;
varying float vGrassSun;

// Terrain-scale cast shadow for a low sun or moon: the same ray march through
// the world height texture as the terrain's, so grass darkens with the ground.
float grassTerrainShadow(vec3 P) {
  vec3 L = uLightDir;
  if (uTerrainShadow < 0.5 || L.y <= 0.0 || L.y > 0.62) return 1.0;
  float sh = 1.0;
  float t = 5.0;
  for (int i = 0; i < 16; i++) {
    vec3 q = P + L * t;
    if (q.y > 620.0) break;
    float hq = textureLod(uShadowH, (q.xz - uWorldInfo.xy) * uWorldInfo.zw, 0.0).r;
    sh = min(sh, clamp((q.y + 0.8 - hq) / (0.05 * t), 0.0, 1.0));
    t *= 1.5;
  }
  return mix(1.0, sh, clamp((0.62 - L.y) * 8.0, 0.0, 1.0));
}

// xy: horizontal tip offset (fraction of height), z: gust 0..1
vec3 grassWind(vec2 p, float rnd, float flex) {
  vec2 wd = normalize(uWindDir + vec2(1e-5, 0.0));
  float gust = texture2D(uNoise, p * (1.0 / 150.0) - wd * uTime * (4.2 / 150.0)).r;
  gust = smoothstep(0.4, 0.76, gust);
  float turb = texture2D(uNoise, p * (1.0 / 41.0) - wd * uTime * (6.5 / 41.0) + vec2(0.31, 0.67)).g - 0.5;
  float ws = uWindStrength;
  float phase = uTime * (1.8 + rnd * 1.2) + dot(p, wd) * 0.42 + rnd * 6.2832;
  float flutter = sin(phase) * 0.6 + sin(phase * 2.37 + 1.3) * 0.3;
  float bend = (ws * (0.12 + 0.7 * gust + 0.4 * turb) + flutter * 0.045 * (0.3 + ws)) * flex;
  vec2 side = vec2(-wd.y, wd.x) * sin(phase * 0.73 + 2.0) * 0.05 * (0.25 + ws) * flex;
  return vec3(wd * bend + side, gust);
}
`;
/** Blade attributes and uniforms. */
const BLADE_PARS = /* glsl */ `
attribute vec4 iRoot;
attribute vec4 iShape;
attribute vec4 iTint;
uniform vec4 uLod;
uniform vec4 uFade;
uniform vec3 uColRoot;
uniform vec3 uColStraw;
uniform vec3 uColStrawTip;
uniform vec3 uColGreen;
uniform vec3 uColMoss;
uniform vec3 uColLyme;
uniform vec3 uColFrost;
${COMMON_VERT}
`;
/**
 * Builds the blade in object space. Geometry attribute `position` carries
 * (side -1..1, t 0..1 along the blade, blade index in the clump / card index).
 * uLod = (r0, pow, tuft fade-in start, end); uFade = (fade-out start, end, width scale, min px).
 */
const BLADE_MAIN = /* glsl */ `
vec3 gRootW = (modelMatrix * vec4(iRoot.xyz, 1.0)).xyz;
float gDist = distance(cameraPosition, gRootW);
float gF = min(1.0, pow(uLod.x / max(gDist, 0.01), uLod.y));
float gOut = 1.0 - smoothstep(uFade.x, uFade.y, gDist);
#ifdef GRASS_TUFT
  // tufts thicken in by rank where the blades thin out, and shrink away at the far edge
  float gCut = gF * smoothstep(uLod.z, uLod.w, gDist);
  float gShrink = gOut;
#else
  float gCut = gF * gOut;
  float gShrink = 1.0;
#endif
gCut = max(gCut, 1e-4);
float gVis = (1.0 - smoothstep(gCut * 0.7, gCut, iRoot.w)) * gShrink;
float gKind = floor(iShape.w * 0.5);
float gLean = iShape.w - gKind * 2.0;
float gT = position.y;
float gSide = position.x;
float gIdx = position.z;
float gR1 = fract(sin(iRoot.w * 7123.17 + iShape.z * 91.31 + gIdx * 17.71) * 43758.5453);
float gR2 = fract(gR1 * 31.77 + 0.37);
float gR3 = fract(gR2 * 47.13 + 0.61);
float gNy = sqrt(max(0.05, 1.0 - iTint.z * iTint.z - iTint.w * iTint.w));
vec3 gTerrainN = vec3(iTint.z, gNy, iTint.w);
vec3 gBase = iRoot.xyz;
float gHMul = 1.0;
float gWMul = 1.0;
float gHueOff = (gR1 - 0.5) * 0.5;
#ifdef GRASS_TUFT
  float gFacing = iShape.z + gIdx * 1.0472 + (gR1 - 0.5) * 0.5;
  float gLeanSign = mod(gIdx, 2.0) * 2.0 - 1.0;
  gHMul = 0.82 + 0.3 * gR2;
#else
  // blade 0 follows the instance, the others fan out around it
  float gFacing = iShape.z;
  float gLeanSign = 1.0;
  if (gIdx > 0.5) {
    float ang = iShape.z + 1.5708 + gIdx * 1.2566 + (gR1 - 0.5) * 0.9;
    // spread wide enough that neighbouring clumps interleave instead of reading as separate plants
    vec2 dir = vec2(cos(ang), sin(ang)) * (0.03 + 0.08 * gR2) * (1.0 + 0.5 * gLean);
    gBase.xz += dir;
    gBase.y -= (dir.x * iTint.z + dir.y * iTint.w) / gNy;
    gFacing = ang - 1.5708 + (gR3 - 0.5) * 0.7;
    gHMul = 0.58 + 0.42 * gR3;
    gWMul = 0.8 + 0.3 * gR2;
    gLean = gLean * (0.6 + 0.6 * gR2) + 0.08;
    if (gIdx > 2.5) {
      // short splayed under-blades fill the sward close to the ground
      gHMul = 0.34 + 0.26 * gR3;
      gWMul = 0.95 + 0.3 * gR2;
      gLean = gLean * 0.4 + 0.5 + 0.35 * gR2;
    }
    if (gKind > 1.5 && gKind < 2.5) {
      gKind = 0.0;
      gHMul *= 0.55;
      gWMul *= 2.0;
    }
  }
#endif
float gH = iShape.x * gHMul * gVis;
vec3 gRight = vec3(cos(gFacing), 0.0, sin(gFacing));
vec3 gFwd = vec3(-gRight.z, 0.0, gRight.x);
#ifdef GRASS_TUFT
  float gComp = clamp(pow(gF, -0.3), 1.0, 1.6);
#else
  float gComp = clamp(pow(gF, -0.42), 1.0, 2.6);
#endif
float gWidth = iShape.y * gWMul * uFade.z * gComp;
gWidth = max(gWidth, gDist * uPixel * uFade.w);
gWidth *= mix(0.35, 1.0, gVis);
float gRnd = fract(iRoot.w * 113.17 + iShape.z * 0.618 + gIdx * 0.31);
float gFlex = 0.5 + 0.9 * clamp(iShape.x * gHMul / 0.45, 0.25, 1.6);
vec3 gWind = grassWind(gRootW.xz, gRnd, gFlex);
vec2 gOff = gFwd.xz * (gLean * gLeanSign) + gWind.xy;
float gOL = length(gOff);
if (gOL > 0.86) gOff *= 0.86 / gOL;
float gTy = sqrt(max(0.06, 1.0 - dot(gOff, gOff)));
float gTp = pow(gT, 1.7);
vec3 gCurve = vec3(gOff.x * gTp, gTy * gT, gOff.y * gTp);
float gD = 1.7 * pow(max(gT, 0.02), 0.7);
vec3 gTan = normalize(vec3(gOff.x * gD, gTy, gOff.y * gD));
float gProf;
if (gKind < 0.5) gProf = (1.0 - pow(gT, 1.5)) * (0.92 + 0.3 * gT);
else if (gKind < 1.5) gProf = 1.0 - pow(gT, 2.4);
else if (gKind < 2.5) gProf = 0.32 + 1.15 * smoothstep(0.5, 0.75, gT) * (1.0 - smoothstep(0.8, 1.0, gT));
else gProf = 1.0 - pow(gT, 3.0);
vec3 grassPos = gBase + gCurve * gH + gRight * (gSide * 0.5 * gWidth * gProf);

vec3 gN = normalize(cross(gRight, gTan));
vec3 gWorld = gRootW + (grassPos - iRoot.xyz);
if (dot(gN, cameraPosition - gWorld) < 0.0) gN = -gN;
gN = normalize(gN + gRight * (gSide * 0.4));
gN = normalize(mix(gN, gTerrainN, 0.62 + 0.25 * gT));
vec3 objectNormal = gN;

float gHue = iTint.x + gHueOff;
float gDry = iTint.y;
// winter straw: bleached, paler toward the tips, a little rime on the exposed ones
vec3 gStraw = mix(uColStraw * 0.5, uColStraw, smoothstep(0.0, 0.55, gT));
gStraw = mix(gStraw, uColStrawTip, smoothstep(0.5, 1.0, gT) * 0.8);
gStraw *= 0.82 + 0.18 * clamp(gHue + 0.6, 0.0, 1.4);
gStraw = mix(gStraw, gStraw * vec3(1.12, 0.95, 0.8), clamp(gHue, 0.0, 1.0) * 0.5);
// living grass of the melt ring: deep green at the base, yellow-green tips
vec3 gGreen = mix(uColGreen * 0.45, uColGreen, smoothstep(0.0, 0.5, gT));
gGreen = mix(gGreen, uColGreen * vec3(1.35, 1.2, 0.7), smoothstep(0.6, 1.0, gT) * (0.4 + 0.3 * gHue));
vec3 gCol = mix(gGreen, gStraw, gDry);
gCol = mix(uColRoot, gCol, smoothstep(0.0, 0.18, gT));
if (gKind > 0.5 && gKind < 1.5) {
  // lyme grass: glaucous blue-grey blades bleaching to straw
  vec3 ly = mix(uColLyme * 0.6, uColLyme, smoothstep(0.0, 0.5, gT));
  gCol = mix(ly, mix(uColStraw, uColStrawTip, gT), clamp(gDry - 0.3, 0.0, 1.0) * (0.6 + 0.4 * gT));
}
if (gKind > 1.5 && gKind < 2.5) gCol = mix(gStraw * 0.9, uColStraw * vec3(0.7, 0.62, 0.55), smoothstep(0.55, 0.75, gT));
if (gKind > 2.5) {
  vec3 mo = uColMoss * (0.75 + 0.5 * clamp(gHue + 0.5, 0.0, 1.0));
  gCol = mix(mo * 0.55, mo * vec3(1.2, 1.15, 0.85), smoothstep(0.0, 1.0, gT));
}
// hoar frost on the dry tips
gCol = mix(gCol, uColFrost, smoothstep(0.7, 1.0, gT) * 0.3 * gDry * (gKind < 0.5 ? 1.0 : 0.4));
// gusts run through the grass as waves of lighter, silvery blades
gCol = mix(gCol, gCol * 1.25 + vec3(0.015), gWind.z * (0.15 + 0.5 * uWindStrength));
#ifdef GRASS_TUFT
  float gAO = mix(0.62, 1.0, smoothstep(0.0, 0.7, gT));
#else
  float gAO = mix(0.72, 1.0, smoothstep(0.0, 0.5, gT));
#endif
vGrassCol = gCol * gAO;
#ifdef GRASS_TUFT
  vGrassTrans = (0.1 + 0.45 * gT) * (1.0 - 0.5 * gDry);
#else
  vGrassTrans = (0.2 + 0.8 * gT) * (1.0 - 0.5 * gDry);
#endif
vGrassSun = gVis > 0.0 ? grassTerrainShadow(gWorld) : 1.0;
`;
const FRAG_PARS = /* glsl */ `
uniform vec3 uAuroraFill;
varying vec3 vGrassCol;
varying float vGrassTrans;
varying float vGrassSun;
uniform float uTransStrength;
uniform vec3 uTransTint;
`;
const FRAG_RE = /* glsl */ `
void RE_Direct_Grass( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( dot( -geometryViewDir, directLight.direction ) );
  float through = pow( back, 4.0 ) * 0.6 + back * back * 0.12 + 0.03;
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uTransTint * ( vGrassTrans * through * uTransStrength );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass
`;
const FRAG_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
vec3 nonPerturbedNormal = normal;
`;
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vGrassSun;');
function patchFragment(shader) {
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;')
        .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${FRAG_RE}`)
        .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += material.diffuseContribution * uAuroraFill * 0.8 * RECIPROCAL_PI;');
}
/** Ground-cover colours (linear RGB, authored in sRGB). */
export const GRASS_COLORS = {
    root: new THREE.Color('#2a2118'),
    straw: new THREE.Color('#a48c62'),
    strawTip: new THREE.Color('#d2c39c'),
    green: new THREE.Color('#58852a'),
    moss: new THREE.Color('#4f7a26'),
    lyme: new THREE.Color('#8e9b98'),
    frost: new THREE.Color('#dfe7ef'),
};
export function makeBladeMaterial(field, opts) {
    const mat = new THREE.MeshStandardMaterial({
        name: opts.tuft ? 'grass-tuft' : 'grass-blade',
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide,
    });
    mat.userData.snow = 0;
    const uniforms = {
        ...field,
        uLod: opts.lod,
        uFade: opts.fade,
        uColRoot: { value: GRASS_COLORS.root },
        uColStraw: { value: GRASS_COLORS.straw },
        uColStrawTip: { value: GRASS_COLORS.strawTip },
        uColGreen: { value: GRASS_COLORS.green },
        uColMoss: { value: GRASS_COLORS.moss },
        uColLyme: { value: GRASS_COLORS.lyme },
        uColFrost: { value: GRASS_COLORS.frost },
        uTransTint: { value: new THREE.Color(1.0, 1.0, 0.85) },
    };
    if (opts.tuft)
        mat.defines = { GRASS_TUFT: '' };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${BLADE_PARS}`)
            .replace('#include <beginnormal_vertex>', BLADE_MAIN)
            .replace('#include <begin_vertex>', 'vec3 transformed = grassPos;');
        patchFragment(shader);
    };
    const key = `fox-grass-${opts.tuft ? 'tuft' : 'blade'}-1`;
    mat.customProgramCacheKey = () => key;
    return mat;
}
