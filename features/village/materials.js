/**
 * Lysvik's materials. Few programs, many looks: per-vertex attributes pick a
 * procedural style, so the whole village draws in a handful of calls.
 *
 *   facade   painted board-and-batten, weatherboard, white trim, logs,
 *            corrugated metal, silvered timber, rendered plinths, brick,
 *            birch bark, stacked firewood, roof sheeting and slate
 *   snow     the library's snowPack (roof slabs, cornices, caps, plow banks)
 *   stone    fieldstone (plinths, quay wall, riprap), vertex-tinted
 *   paving   plowed lanes and the quay: compacted snow, ruts, grit, and the
 *            pools of lamp light after dark
 *   glow     windows (Nordic six-pane sashes with lace curtains and a lamp on
 *            the sill), shop windows, church windows, lamps and grave candles,
 *            switched by a polar-night schedule per house
 *   cards    alpha-cut cards: bare birch and rowan crowns, picket fences,
 *            stockfish on the racks
 *   points   one sprite per light so the village twinkles from afar
 *   pools    warm light thrown on the snow under lamps and lit windows
 */
import * as THREE from 'three';
import { cardAtlas } from './textures.js';
/** Facade styles (aStyle.x) */
export const STYLE = {
    /** standing board-and-batten (tint); aStyle.y = 0 battens, 1 overlapping boards */
    panel: 0,
    /** horizontal weatherboard (tint) */
    clap: 1,
    /** flat paint: trim, doors, frames (tint) */
    paint: 2,
    /** horizontal round logs (stabbur) */
    log: 3,
    /** corrugated metal, ribs along v (tint) */
    metal: 4,
    /** silvered timber, grain along v (tint) */
    timber: 5,
    /** rendered concrete plinth */
    concrete: 6,
    /** brick (chimneys) */
    brick: 7,
    /** birch bark (tubes: u around, v along) */
    bark: 8,
    /** firewood stacked end-on */
    woodpile: 9,
    /** roof sheeting: standing seams along v (up the slope) */
    roofMetal: 10,
    /** roof tiles / slate courses along u */
    roofTile: 11,
};
/** Glow element kinds (aKind.x) */
export const GLOW = {
    /** two casements of three panes, lace curtains, a lamp on the sill */
    sash: 0,
    /** glazed upper half of a door */
    door: 1,
    /** shop window: big panes, shelves */
    shop: 2,
    /** plain lamp glass */
    lamp: 3,
    /** tall church window with small panes and a round head */
    church: 4,
    /** small gable / attic window, four panes */
    attic: 5,
    /** grave candle (flickers) */
    candle: 6,
    /** factory / boathouse window: many small panes */
    works: 7,
};
/** Light schedules (aKind.y) */
export const SCHED = {
    /** homes: on after dark, off at bedtime, on again before dawn for the early risers */
    home: 0,
    /** street lamps: dusk to dawn */
    street: 1,
    /** shop and fish landing: working hours when dark */
    work: 2,
    flashRed: 3,
    flashGreen: 4,
    /** church: lit through the evening */
    church: 5,
    /** grave candles: all night, flickering */
    candle: 6,
};
/**
 * Per-quad constants go to the shaders on fixed grids (seeds 1/256, sizes 1/64 m): the shaders snap the
 * interpolated values back onto them before hashing or counting panes, which kills per-pixel flicker.
 */
export const snapSeed = (s) => Math.round(s * 256) / 256;
export const snapSize = (s) => Math.round(s * 64) / 64;
/** JS mirror of the shader's light colour */
export function warmColor(warmth, sched) {
    if (sched === SCHED.flashRed)
        return [1.0, 0.12, 0.06];
    if (sched === SCHED.flashGreen)
        return [0.15, 1.0, 0.35];
    if (sched === SCHED.candle)
        return [1.0, 0.55, 0.18];
    return [1.0, 0.5 + 0.26 * warmth, 0.18 + 0.3 * warmth];
}
/** Shared GLSL: when is a light on? */
export const LIT_GLSL = /* glsl */ `
uniform float uNight;
uniform vec3 uSunDir;
uniform float uClock;
uniform float uTime;
float villageDark() {
  // leads uNight a little so the first windows light up in the blue hour
  return max(uNight, smoothstep(0.06, -0.09, uSunDir.y));
}
float villageLit(vec4 g, float sched) {
  float dark = villageDark();
  float on = smoothstep(g.x, g.x + 0.1, dark);
  float t = mod(uClock + 12.0, 24.0); // hours since noon (12 = midnight)
  float s = 1.0;
  if (sched < 0.5) {
    float bed = 9.0 + g.w * 4.0;                                  // 21:00 .. 01:00
    float wake = g.w > 0.72 ? 16.5 + (g.w - 0.72) * 5.0 : 18.6;   // fishermen up 04:30 .. 05:50, others 06:36
    s = clamp(step(t, bed) + step(wake, t), 0.0, 1.0);
  } else if (sched < 1.5) {
    s = 1.0;
    on = smoothstep(0.04, 0.2, dark);
  } else if (sched < 2.5) {
    s = (t > 19.5 || t < 8.5) ? 1.0 : 0.0;                         // 07:30 .. 20:30
    on = smoothstep(0.04, 0.25, dark);
  } else if (sched < 4.5) {
    float period = sched < 3.5 ? 4.0 : 5.0;
    float ph = fract(uTime / period + g.w);
    s = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.1, 0.22, ph)) + 0.03;
    on = smoothstep(0.05, 0.25, dark);
  } else if (sched < 5.5) {
    s = (t > 3.0 && t < 11.0) ? 1.0 : 0.0;                         // 15:00 .. 23:00
    on = smoothstep(0.05, 0.3, dark);
  } else {
    float f = 0.82 + 0.1 * sin(uTime * 9.0 + g.w * 40.0) + 0.08 * sin(uTime * 23.0 + g.w * 13.0);
    s = f;
    on = smoothstep(0.1, 0.35, dark);
  }
  return on * s;
}
// shop and fish-landing glass keeps its lights on through the short polar day (working hours)
float villageDayLit(float sched) {
  if (sched < 1.5 || sched > 2.5) return 0.0;
  float t = mod(uClock + 12.0, 24.0);
  return (t > 19.5 || t < 8.5) ? 1.0 : 0.0;
}
vec3 villageWarm(float warmth, float sched) {
  if (sched > 5.5) return vec3(1.0, 0.55, 0.18);
  if (sched > 3.5 && sched < 4.5) return vec3(0.15, 1.0, 0.35);
  if (sched > 2.5 && sched < 3.5) return vec3(1.0, 0.12, 0.06);
  return mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.76, 0.48), warmth);
}
`;
/** boats rock gently in open water (aBob: pivot xyz, phase w; w < 0 = still) */
const BOB_GLSL = /* glsl */ `
{
  float amp = step(0.0, aBob.w);
  float ph = aBob.w * 6.2831;
  float t = uTime;
  vec3 p = transformed - aBob.xyz;
  float heave = (sin(t * 0.9 + ph) * 0.03 + sin(t * 0.53 + ph * 1.7) * 0.02) * amp;
  float roll = sin(t * 0.71 + ph * 2.3) * 0.018 * amp;
  float pitch = sin(t * 0.57 + ph * 0.7) * 0.01 * amp;
  vec3 r = p;
  r.y = p.y + p.x * roll + p.z * pitch;
  r.x = p.x - p.y * roll;
  r.z = p.z - p.y * pitch;
  transformed = aBob.xyz + r + vec3(0.0, heave, 0.0);
}`;
export const MAX_LAMPS = 64;
export function createVillageMaterials(ctx) {
    const { shared } = ctx;
    const noise = ctx.materials.noise;
    const uClock = { value: ctx.sky.hours };
    const uPixelScale = { value: 600 };
    const uLamps = { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) };
    const uLampCount = { value: 0 };
    /* ---------------- facade ---------------- */
    const facade = new THREE.MeshStandardMaterial({ name: 'village-facade', vertexColors: true, roughness: 0.85, metalness: 0 });
    facade.onBeforeCompile = (shader) => {
        shader.uniforms.uNoiseTex = { value: noise };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\nattribute vec4 aStyle;\nvarying vec4 vStyle;\nvarying vec2 vWUv;\nvarying vec3 vWPos;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvStyle = aStyle;\nvWUv = uv;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform sampler2D uNoiseTex;\nvarying vec4 vStyle;\nvarying vec2 vWUv;\nvarying vec3 vWPos;\n${FACADE_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
float gRough = 0.85;
float gMetal = 0.0;
diffuseColor.rgb = facadeColor(diffuseColor.rgb, vWUv, vStyle, vWPos, gRough, gMetal);`)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;');
    };
    facade.customProgramCacheKey = () => 'fox-village-facade-v1';
    /* ---------------- snow (roof slabs, cornices, caps, banks) ---------------- */
    const snow = ctx.materials.get('snowPack');
    /* ---------------- stone ---------------- */
    const stone = ctx.materials.get('fieldstone').clone();
    stone.name = 'village-stone';
    stone.vertexColors = true;
    /* ---------------- paving: plowed lanes and the quay ---------------- */
    const paving = new THREE.MeshStandardMaterial({
        name: 'village-paving',
        vertexColors: true,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
    });
    paving.userData.snow = 0;
    paving.onBeforeCompile = (shader) => {
        shader.uniforms.uNoiseTex = { value: noise };
        shader.uniforms.uNight = shared.uNight;
        shader.uniforms.uSunDir = shared.uSunDir;
        shader.uniforms.uLamps = uLamps;
        shader.uniforms.uLampCount = uLampCount;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 aLane;\nvarying vec4 vLane;\nvarying vec3 vPWorld;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLane = aLane;\nvPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform sampler2D uNoiseTex;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec4 uLamps[${MAX_LAMPS}];
uniform int uLampCount;
varying vec4 vLane;
varying vec3 vPWorld;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
float pRough = 0.72;
{
  // vLane: x = across the lane (m from the centre), y = along (m), z = half width, w = kind (0 lane, 1 quay)
  vec2 xz = vPWorld.xz;
  float fw = fwidth(vLane.y) + fwidth(vLane.x);
  float n1 = texture2D(uNoiseTex, xz * 0.043).r;
  float n2 = texture2D(uNoiseTex, xz * 0.31 + 0.17).g;
  float n3 = texture2D(uNoiseTex, xz * 1.7 + 0.53).b;
  vec3 packed = vec3(0.80, 0.81, 0.82) * (0.94 + 0.08 * n1) * (0.96 + 0.06 * n2);
  // grit and sand spread on the ice, thicker in the wheel tracks
  float across = vLane.x / max(vLane.z, 0.5);
  float track = 0.0;
  if (vLane.w < 0.5) {
    float tw = 0.32;
    float t1 = 1.0 - smoothstep(tw * 0.25, tw, abs(abs(vLane.x) - min(0.85, vLane.z * 0.45)) + (n2 - 0.5) * 0.25);
    track = t1 * (1.0 - smoothstep(0.02, 0.15, fw));
  } else {
    track = smoothstep(0.55, 0.8, n1) * 0.6;
  }
  float grit = smoothstep(0.45, 0.85, n3 * 0.6 + n2 * 0.4 + track * 0.35);
  vec3 gritC = vec3(0.42, 0.38, 0.34);
  vec3 col = mix(packed, packed * vec3(0.86, 0.88, 0.92), track * 0.6);
  col = mix(col, gritC, grit * 0.35);
  // bare dark ice where the wheels polish it, fresh powder toward the edges
  float glaze = track * smoothstep(0.55, 0.75, n2) * 0.5;
  col = mix(col, vec3(0.55, 0.6, 0.66), glaze);
  float edge = smoothstep(0.6, 1.0, abs(across) + (n2 - 0.5) * 0.3);
  col = mix(col, vec3(0.93, 0.95, 0.97), edge * 0.7);
  pRough = mix(0.72, 0.35, glaze) * mix(1.0, 1.1, edge);
  diffuseColor.rgb = col * vColor.rgb;
}
{
  // pools of lamp light on the snow after dark (the village has no real lights)
  float dark = smoothstep(0.04, 0.22, max(uNight, smoothstep(0.06, -0.09, uSunDir.y)));
  if (dark > 0.0) {
    float E = 0.0;
    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      if (i >= uLampCount) break;
      vec4 L = uLamps[i];
      vec3 d = L.xyz - vPWorld;
      float r2 = dot(d, d) + 0.4;
      E += L.w * max(d.y, 0.0) * inversesqrt(r2 * r2 * r2);
    }
    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.32) * (E * dark * 0.35);
  }
}`)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pRough;');
    };
    paving.customProgramCacheKey = () => 'fox-village-paving-v1';
    /* ---------------- glow (windows, doors, lamps); the boats' copy bobs with them ---------------- */
    const makeGlow = (bob) => {
        const glow = new THREE.MeshStandardMaterial({
            name: 'village-glow',
            vertexColors: true,
            roughness: 0.6,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -6,
        });
        glow.userData.snow = 0;
        glow.onBeforeCompile = (shader) => {
            shader.uniforms.uNight = shared.uNight;
            shader.uniforms.uSunDir = shared.uSunDir;
            shader.uniforms.uTime = shared.uTime;
            shader.uniforms.uClock = uClock;
            shader.uniforms.uNoiseTex = { value: noise };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute vec4 aGlow;\nattribute vec4 aKind;\nvarying vec4 vGlow;\nvarying vec4 vKind;\nvarying vec2 vGUv;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvKind = aKind;\nvGUv = uv;' + (bob ? `\n${BOB_GLSL}` : ''));
            if (bob)
                shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aBob;\nuniform float uTime;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>\nuniform sampler2D uNoiseTex;\nvarying vec4 vGlow;\nvarying vec4 vKind;\nvarying vec2 vGUv;\n${LIT_GLSL}\n${GLOW_GLSL}`)
                .replace('#include <color_fragment>', `#include <color_fragment>
float gEmit = 0.0;
float gGlass = 0.0;
vec3 gEmitCol = vec3(1.0);
{
  float lit = villageLit(vGlow, vKind.y);
  float kx = vKind.x + 0.5;
  if (kx > 2.0 && kx < 3.0 || kx > 7.0) lit = max(lit, 0.45 * villageDayLit(vKind.y));
  vec3 warm = villageWarm(vGlow.y, vKind.y);
  windowLook(vGUv, vKind, vGlow, diffuseColor.rgb, lit, warm, diffuseColor.rgb, gEmitCol, gGlass);
  gEmit = lit * vGlow.z;
  // windows are tuned to glow across the bay; up close the eye reads the room, the lace and the lamp,
  // so the glass dims toward the camera instead of blowing out (lamps and candles keep their strength)
  if (kx < 3.0 || kx > 4.0 && kx < 6.0 || kx > 7.0) gEmit *= mix(0.5, 1.0, smoothstep(6.0, 45.0, length(vViewPosition)));
}`)
                .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, gGlass);')
                .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, gGlass);')
                .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += gEmitCol * gEmit;`);
        };
        glow.customProgramCacheKey = () => (bob ? 'fox-village-glow-bob-v1' : 'fox-village-glow-v1');
        return glow;
    };
    const glow = makeGlow(false);
    const glowBob = makeGlow(true);
    /* ---------------- boats (gentle bob in open water) ---------------- */
    const boat = new THREE.MeshStandardMaterial({ name: 'village-boat', vertexColors: true, roughness: 0.42 });
    boat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = shared.uTime;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 aBob;\nuniform float uTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
${BOB_GLSL}`);
    };
    boat.customProgramCacheKey = () => 'fox-village-boat-v1';
    /* ---------------- foliage: spruce needles, rowan berries ---------------- */
    const foliage = new THREE.MeshStandardMaterial({ name: 'village-foliage', vertexColors: true, roughness: 0.9 });
    foliage.userData.snow = 1.4;
    foliage.onBeforeCompile = (shader) => {
        shader.uniforms.uNoiseTex = { value: noise };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vFPos;\nvarying float vFUp;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFUp = normal.y;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D uNoiseTex;\nvarying vec3 vFPos;\nvarying float vFUp;')
            .replace('#include <color_fragment>', `#include <color_fragment>
{
  // needle clumps: two octaves of world-space noise, darker toward the underside
  float a = texture2D(uNoiseTex, vFPos.xz * 0.37 + vFPos.y * 0.21).r;
  float b = texture2D(uNoiseTex, vFPos.xy * 1.3 + vFPos.z * 0.57).g;
  float leaf = smoothstep(0.25, 0.75, a * 0.6 + b * 0.4);
  diffuseColor.rgb *= (0.55 + 0.6 * leaf) * mix(0.45, 1.0, smoothstep(-0.7, 0.5, vFUp));
}`);
    };
    foliage.customProgramCacheKey = () => 'fox-village-foliage-v1';
    /* ---------------- alpha-cut cards: bare crowns, fences, stockfish ---------------- */
    const atlas = cardAtlas(ctx.quality.textureSize >= 1024 ? 1024 : 512);
    const atlasTex = new THREE.CanvasTexture(atlas);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = ctx.materials.anisotropy;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    const cards = new THREE.MeshStandardMaterial({
        name: 'village-cards',
        vertexColors: true,
        map: atlasTex,
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 0.9,
    });
    cards.userData.snow = 0.8;
    /* ---------------- icicles ---------------- */
    const ice = ctx.materials.get('ice');
    /* ---------------- light field (point sprites) ---------------- */
    const points = new THREE.ShaderMaterial({
        name: 'village-lights',
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPixelScale: { value: 600 } }]),
        vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aGlow;
attribute vec4 aKind;
attribute vec3 aColor;
attribute vec3 aDir;
uniform float uPixelScale;
varying vec3 vCol;
${LIT_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 toCam = cameraPosition - wp.xyz;
  float dist = max(length(toCam), 0.1);
  float facing = 1.0;
  float shrink = 1.0;
  if (dot(aDir, aDir) > 0.01) {
    // a window seen edge-on shows little of its light: the sprite shrinks and dims with the angle,
    // so it never bulges out beside the glass
    float c = dot(aDir, toCam / dist);
    facing = smoothstep(-0.08, 0.55, c);
    shrink = 0.3 + 0.7 * clamp(c, 0.0, 1.0);
  }
  float lit = villageLit(aGlow, aKind.y);
  float px = aKind.z * shrink * uPixelScale / dist;
  float size = max(px, aKind.w);
  float flux = px / size;
  float nearFade = smoothstep(16.0, 60.0, dist);
  float twinkle = 1.0 + 0.2 * sin(uTime * (1.7 + aGlow.w * 3.1) + aGlow.w * 57.0) * sin(uTime * (0.43 + aGlow.w) + aGlow.w * 13.0) * smoothstep(220.0, 700.0, dist);
  vCol = aColor * lit * facing * nearFade * twinkle * mix(1.0, flux, 0.55);
  vec4 mvPosition = viewMatrix * wp;
  // pull toward the camera by roughly the depth-buffer resolution at this distance
  float pull = min(0.25 + dist * dist * 8.0e-7, dist * 0.5);
  mvPosition.xyz *= (dist - pull) / dist;
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = (vCol.r + vCol.g + vCol.b) < 0.0005 ? 0.0 : size;
  #include <fog_vertex>
}`,
        fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 10.0);
  float halo = exp(-r2 * 3.2) * 0.28 * (1.0 - r2);
  vec3 col = vCol * (core + halo);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, 1.0);
}`,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        fog: true,
    });
    points.uniforms.uNight = shared.uNight;
    points.uniforms.uSunDir = shared.uSunDir;
    points.uniforms.uTime = shared.uTime;
    points.uniforms.uClock = uClock;
    points.uniforms.uPixelScale = uPixelScale;
    /* ---------------- light thrown on the snow ---------------- */
    const pools = new THREE.ShaderMaterial({
        name: 'village-pools',
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
        vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aGlow;
attribute vec4 aKind;
attribute vec3 aColor;
varying vec3 vCol;
varying vec2 vQ;
varying float vShape;
${LIT_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float lit = villageLit(aGlow, aKind.y);
  vCol = aColor * lit;
  vQ = uv;
  vShape = aKind.x;
  vec4 mvPosition = viewMatrix * wp;
  float dist = length(mvPosition.xyz);
  mvPosition.xyz *= (dist - min(0.12 + dist * 0.0008, dist * 0.5)) / dist;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
        fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uExposure;
varying vec3 vCol;
varying vec2 vQ;
varying float vShape;
void main() {
  // q in -1..1; round pools under lamps, a soft trapezoid fanning out from a window
  vec2 q = vQ;
  float a;
  if (vShape < 0.5) {
    float r2 = dot(q, q);
    a = (exp(-r2 * 5.0) * 0.8 + exp(-r2 * 18.0) * 0.6) * (1.0 - smoothstep(0.6, 1.0, r2));
  } else {
    float along = q.y * 0.5 + 0.5;
    float w = 0.55 + 0.45 * along;
    float x = abs(q.x) / w;
    a = (1.0 - smoothstep(0.55, 1.0, x)) * smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.25, 1.0, along)) * (1.0 - 0.5 * along);
  }
  vec3 col = vCol * a;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col *= 1.0 - fogFactor;
  #endif
  if (col.r + col.g + col.b < 1e-4) discard;
  gl_FragColor = vec4(col, 1.0);
}`,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        fog: true,
    });
    pools.uniforms.uNight = shared.uNight;
    pools.uniforms.uSunDir = shared.uSunDir;
    pools.uniforms.uTime = shared.uTime;
    pools.uniforms.uClock = uClock;
    pools.uniforms.uExposure = shared.uExposure;
    return {
        facade,
        snow,
        stone,
        paving,
        glow,
        glowBob,
        boat,
        foliage,
        cards,
        ice,
        points,
        pools,
        uClock,
        uPixelScale,
        setLamps(lamps) {
            const n = Math.min(MAX_LAMPS, lamps.length);
            for (let i = 0; i < n; i++)
                uLamps.value[i].set(lamps[i][0], lamps[i][1], lamps[i][2], lamps[i][3]);
            uLampCount.value = n;
        },
        dispose() {
            for (const m of [facade, stone, paving, glow, glowBob, boat, foliage, cards, points, pools])
                m.dispose();
            atlasTex.dispose();
        },
    };
}
/* ------------------------------------------------------------------ */
/* facade styles                                                      */
/* ------------------------------------------------------------------ */
const FACADE_GLSL = /* glsl */ `
float fHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 facadeColor(vec3 tint, vec2 uv, vec4 st4, vec3 wp, inout float rough, inout float metal) {
  float st = st4.x + 0.5;
  // the seed is a per-vertex constant, but interpolation can wobble it in the last bits, which the sin hashes
  // below would turn into speckle: snap it back to the 1/256 grid the builder wrote it on
  float seed = floor(st4.w * 256.0 + 0.5) / 256.0;
  float fw = max(fwidth(uv.x), fwidth(uv.y));
  float detail = 1.0 - smoothstep(0.012, 0.06, fw);
  float coarse = 1.0 - smoothstep(0.05, 0.22, fw);
  float n1 = texture2D(uNoiseTex, wp.xz * 0.19 + vec2(wp.y * 0.13, seed * 7.0)).r;
  float n2 = texture2D(uNoiseTex, vec2(uv.x * 0.09 + seed * 3.0, uv.y * 0.5)).g;
  vec3 col = tint;
  if (st < 1.0) {
    // standing boards: board-and-batten or overlapping boards, each board its own shade of the paint
    float bw = st4.y > 0.5 ? 0.17 : 0.24;
    float bi = floor(uv.x / bw);
    float bu = fract(uv.x / bw);
    float shade = 0.9 + 0.16 * fHash(bi + seed * 91.0);
    float seam = mix(1.0, smoothstep(0.0, 0.05, bu) * (0.75 + 0.25 * smoothstep(0.96, 0.9, bu)), detail);
    float batten = 0.0;
    if (st4.y < 0.5) {
      float bd = abs(bu - 0.0) * bw;
      batten = (1.0 - smoothstep(0.022, 0.03, min(bd, bw - bd))) * detail;
    } else {
      // every other board laps over its neighbours and catches more light
      batten = mod(bi, 2.0) * 0.6 * coarse;
    }
    float grain = texture2D(uNoiseTex, vec2(uv.x * 2.1 + bi * 0.37, uv.y * 0.08)).b;
    col = tint * shade * seam * (0.94 + 0.1 * grain);
    col = mix(col, tint * 1.12, batten * 0.7);
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.6, uv.y + n1 * 0.3));
    // chalky, weathered paint: patches worn to grey wood low down and on the weather side
    float wear = smoothstep(0.8, 0.95, texture2D(uNoiseTex, uv * vec2(1.3, 0.5) + seed * 5.0).r + (0.4 - min(uv.y, 1.6) * 0.25) * 0.5);
    col = mix(col, tint * 0.7 + vec3(0.08, 0.075, 0.07), wear * 0.4 * detail);
    rough = 0.88;
  } else if (st < 2.0) {
    // horizontal weatherboard: a shadow line under each board's lower edge
    float bh = 0.135;
    float cb = fract(uv.y / bh);
    float bi = floor(uv.y / bh);
    float shadowLine = mix(1.0, 0.58 + 0.42 * smoothstep(0.0, 0.16, cb), detail);
    shadowLine *= mix(1.0, 1.0 + 0.08 * smoothstep(0.75, 1.0, cb), detail);
    col = tint * shadowLine * (0.95 + 0.07 * n1) * (0.96 + 0.06 * fHash(bi + seed * 17.0));
    col *= mix(0.88, 1.0, smoothstep(0.0, 0.5, uv.y));
    rough = 0.66;
  } else if (st < 3.0) {
    col = tint * (0.95 + 0.07 * n1);
    rough = 0.5;
  } else if (st < 4.0) {
    // round logs, dark caulked gaps
    float lh = 0.21;
    float f = fract(uv.y / lh);
    float li = floor(uv.y / lh);
    float round_ = sin(f * 3.14159);
    float gap = mix(1.0, smoothstep(0.0, 0.1, f) * smoothstep(1.0, 0.9, f), detail);
    float grain = texture2D(uNoiseTex, vec2(uv.x * 0.6 + li * 0.71, f * 0.4 + li)).g;
    col = tint * (0.62 + 0.45 * round_) * (0.82 + 0.3 * grain) * gap * (0.9 + 0.2 * fHash(li + seed * 13.0));
    rough = 0.9;
  } else if (st < 5.0) {
    float rib = 0.5 + 0.5 * sin(uv.x * 6.2831 / 0.076);
    col = tint * mix(1.0, 0.84 + 0.24 * rib, detail) * (0.9 + 0.14 * n1);
    float rust = smoothstep(0.7, 0.92, texture2D(uNoiseTex, uv * vec2(0.3, 0.12) + seed).b) * smoothstep(1.2, 0.0, uv.y);
    col = mix(col, vec3(0.3, 0.15, 0.08), rust * 0.5);
    rough = 0.5;
    metal = 0.3;
  } else if (st < 6.0) {
    // silvered timber, grain along v
    float bi = floor(uv.x / 0.21);
    float grain = texture2D(uNoiseTex, vec2(uv.x * 3.1 + bi * 0.13, uv.y * 0.11)).b;
    float check = smoothstep(0.78, 0.86, texture2D(uNoiseTex, vec2(uv.x * 9.0 + bi, uv.y * 0.05)).a) * detail;
    col = tint * (0.78 + 0.34 * grain) * (0.9 + 0.2 * fHash(bi + seed * 7.0)) * (1.0 - 0.35 * check);
    rough = 0.9;
  } else if (st < 7.0) {
    // rendered concrete plinth: mottled, damp and dark at the foot
    float n3 = texture2D(uNoiseTex, wp.xz * 0.07 + wp.y * 0.09).b;
    col = tint * (0.84 + 0.16 * n1 + 0.1 * n3);
    col *= mix(0.72, 1.0, smoothstep(0.0, 0.5, uv.y));
    rough = 0.95;
  } else if (st < 8.0) {
    // brick courses
    float ch = 0.075;
    float row = floor(uv.y / ch);
    float bx = uv.x / 0.24 + mod(row, 2.0) * 0.5;
    float mx = abs(fract(bx) - 0.5) * 0.24;
    float my = abs(fract(uv.y / ch) - 0.5) * ch;
    float mortar = max(1.0 - smoothstep(0.004, 0.009, 0.12 - mx), 1.0 - smoothstep(0.004, 0.008, ch * 0.5 - my));
    vec3 brick = tint * (0.8 + 0.35 * fHash2(vec2(floor(bx), row) + seed));
    col = mix(brick, vec3(0.5, 0.48, 0.45), mortar * detail);
    col = mix(col, vec3(0.05), smoothstep(0.6, 1.0, uv.y / max(st4.y, 0.5)) * 0.5);
    rough = 0.9;
  } else if (st < 9.0) {
    // birch bark: chalk white, dark horizontal lenticels, black diamonds and a rough dark foot
    float n4 = texture2D(uNoiseTex, vec2(uv.x * 0.9, uv.y * 3.2) + seed).r;
    float lent = smoothstep(0.62, 0.72, texture2D(uNoiseTex, vec2(uv.x * 0.35 + seed, uv.y * 7.0)).g) * detail;
    float patch_ = smoothstep(0.66, 0.74, texture2D(uNoiseTex, vec2(uv.x * 0.5, uv.y * 0.9) + seed * 3.0).b);
    col = vec3(0.86, 0.85, 0.8) * (0.9 + 0.12 * n4);
    col = mix(col, vec3(0.12, 0.1, 0.09), max(lent * 0.8, patch_ * 0.85));
    col = mix(col, vec3(0.22, 0.2, 0.18), (1.0 - smoothstep(0.0, 0.8, uv.y)) * 0.8);
    col *= tint;
    rough = 0.8;
  } else if (st < 10.0) {
    // firewood end-on: discs in loose rows
    vec2 p = uv / vec2(0.16, 0.14);
    float row = floor(p.y);
    p.x += mod(row, 2.0) * 0.5 + fHash(row + seed) * 0.3;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float r = 0.42 + 0.08 * fHash2(cell + seed);
    float d = length(f);
    float log_ = 1.0 - smoothstep(r - 0.04, r, d);
    float rings = 0.5 + 0.5 * sin(d * 40.0 + fHash2(cell) * 6.0);
    vec3 wood = mix(vec3(0.62, 0.48, 0.32), vec3(0.78, 0.64, 0.45), rings * 0.5) * (0.8 + 0.3 * fHash2(cell + 3.0));
    vec3 bark = vec3(0.2, 0.15, 0.11);
    col = mix(vec3(0.03, 0.025, 0.02), mix(bark, wood, 1.0 - smoothstep(r - 0.1, r - 0.05, d)), mix(0.75, log_, detail));
    rough = 0.95;
  } else if (st < 11.0) {
    // standing-seam sheeting: seams along v every 0.55 m
    float s = abs(fract(uv.x / 0.55 + 0.5) - 0.5) * 0.55;
    float seamL = (1.0 - smoothstep(0.008, 0.02, s)) * detail;
    col = tint * (0.9 + 0.12 * n1) * (1.0 + 0.35 * seamL);
    col = mix(col, tint * vec3(1.2, 0.9, 0.75), smoothstep(0.75, 0.95, texture2D(uNoiseTex, uv * vec2(0.4, 0.2) + seed).b) * 0.3);
    rough = 0.45;
    metal = 0.35;
  } else {
    // tiles / slate courses along u
    float ch = 0.32;
    float row = floor(uv.y / ch);
    float cy = fract(uv.y / ch);
    float tx = uv.x / 0.3 + mod(row, 2.0) * 0.5;
    float jx = abs(fract(tx) - 0.5);
    float butt = mix(1.0, 0.55 + 0.45 * smoothstep(0.0, 0.15, cy), detail);
    float joint = mix(1.0, smoothstep(0.47, 0.44, jx) * 0.3 + 0.7, detail);
    col = tint * butt * joint * (0.85 + 0.25 * fHash2(vec2(floor(tx), row) + seed));
    rough = 0.6;
  }
  return col;
}
`;
/* ------------------------------------------------------------------ */
/* window looks                                                       */
/* ------------------------------------------------------------------ */
const GLOW_GLSL = /* glsl */ `
float gHash(float n) { return fract(sin(n * 91.7) * 43758.5453); }
// a bar every period (half width hw) along p, antialiased: fades to its area coverage when it gets thinner than a pixel
float barAA(float p, float period, float hw, float fw) {
  float d = abs(fract(p / period + 0.5) - 0.5) * period;
  float b = 1.0 - smoothstep(hw - fw * 0.5, hw + fw * 0.5, d);
  float cov = min(1.0, 2.0 * hw / period);
  return mix(b, cov, smoothstep(hw, hw * 4.0 + 0.002, fw));
}
// a frame band of width w just inside the quad edges, antialiased the same way
float rimAA(vec2 q, float W, float H, float w, float fw) {
  float d = min(min(q.x, W - q.x), min(q.y, H - q.y));
  float f = min(fw, w);
  float b = 1.0 - smoothstep(w - f * 0.5, w + f * 0.5, d);
  float cov = min(1.0, w * 2.0 * (W + H) / max(W * H, 1e-3));
  return mix(b, cov, smoothstep(w, w * 4.0 + 0.002, fw));
}
float gBox(vec2 q, vec2 lo, vec2 hi, float fw) {
  vec2 a = smoothstep(lo - fw, lo + fw, q) * (1.0 - smoothstep(hi - fw, hi + fw, q));
  return a.x * a.y;
}
// Writes the daytime surface colour (col), the light colour seen at night (emit, multiplied by lit),
// and how much of the quad is glass (mirror-like by day).
void windowLook(vec2 q, vec4 k, vec4 g, vec3 tint, float lit, vec3 warm, out vec3 col, out vec3 emit, out float glass) {
  // the attributes are per-quad constants, but interpolation wobbles them in the last bits: snap them back
  // to their grids (the builder writes them there), or pane counts and the sin hashes flicker per pixel
  float W = floor(k.z * 64.0 + 0.5) / 64.0;
  float H = floor(k.w * 64.0 + 0.5) / 64.0;
  float kind = floor(k.x + 0.5) + 0.5;
  float fw = max(fwidth(q.x), fwidth(q.y));
  float detail = 1.0 - smoothstep(0.01, 0.045, fw);
  float seed = floor(g.w * 256.0 + 0.5) / 256.0;
  vec3 frameC = tint;
  vec3 darkGlass = vec3(0.025, 0.03, 0.035);
  col = darkGlass;
  emit = vec3(0.0);
  glass = 1.0;
  float bars = 0.0;
  float inside = 1.0;
  if (kind < 1.0 || kind > 5.0 && kind < 6.0 || kind > 7.0) {
    // sash / attic / works windows
    float cols = kind < 1.0 ? 2.0 : kind < 6.0 ? 2.0 : max(3.0, floor(W / 0.45 + 0.5));
    float rows = kind < 1.0 ? (gHash(seed * 7.0) < 0.75 ? 3.0 : 2.0) : kind < 6.0 ? 2.0 : max(2.0, floor(H / 0.45 + 0.5));
    float cw = W / cols;
    float ch = H / rows;
    float post = kind < 1.0 ? 0.035 : 0.018;
    float mul = barAA(q.x, cw, post, fw);
    float mun = barAA(q.y, ch, 0.014, fw);
    float edge = rimAA(q, W, H, 0.032, fw);
    bars = clamp(max(max(mul, mun), edge), 0.0, 1.0);
  } else if (kind < 2.0) {
    // door glass: two narrow panes
    bars = max(barAA(q.x - W * 0.5, W * 4.0, 0.028, fw), rimAA(q, W, H, 0.032, fw));
  } else if (kind < 3.0) {
    // shop window: big panes with slim mullions and a transom
    float panes = max(1.0, floor(W / 1.3 + 0.5));
    float pw = W / panes;
    bars = max(max(barAA(q.x, pw, 0.032, fw), barAA(q.y - H * 0.78, H * 4.0, 0.022, fw)), rimAA(q, W, H, 0.042, fw));
  } else if (kind < 4.0) {
    // lamp glass
    col = tint;
    emit = warm * 1.0;
    glass = 0.0;
    return;
  } else if (kind < 5.0) {
    // church window: round head, small panes
    float r = W * 0.5;
    vec2 c = vec2(r, H - r);
    float head = q.y > H - r ? step(length(q - c), r - 0.01) : 1.0;
    if (head < 0.5) {
      col = tint;
      glass = 0.0;
      return;
    }
    bars = max(barAA(q.x, W / 3.0, 0.02, fw), barAA(q.y, 0.32, 0.016, fw));
    float rim = rimAA(q, W, H + r, 0.042, fw);
    float arc = q.y > H - r ? 1.0 - smoothstep(0.035 - min(fw, 0.035) * 0.5, 0.035 + min(fw, 0.035) * 0.5, r - length(q - c)) : 0.0;
    bars = max(bars, max(rim, arc));
  } else {
    // grave candle: a little lantern, flickering flame
    vec2 c = vec2(W * 0.5, H * 0.42);
    float flame = exp(-dot((q - c) / vec2(W * 0.18, H * 0.3), (q - c) / vec2(W * 0.18, H * 0.3)) * 2.0);
    col = tint * 0.6;
    emit = warm * (0.5 + 2.4 * flame);
    glass = 0.3;
    return;
  }
  // what is seen through the glass at night
  float t = gHash(seed * 13.0 + floor(q.x / max(W, 0.1)));
  vec3 room = warm;
  if (kind < 1.0 || kind > 5.0 && kind < 6.0) {
    // lace curtains drawn to the sides, a valance across the top, a lamp on the sill
    float side = min(q.x, W - q.x) / W;
    float wave = 0.03 * sin(q.y * 14.0 + seed * 20.0) + 0.02 * sin(q.y * 31.0 + seed * 7.0);
    float curtainW = gHash(seed * 3.1) < 0.2 ? 0.0 : 0.13 + 0.12 * gHash(seed * 5.3);
    float curtain = 1.0 - smoothstep(curtainW - 0.02, curtainW + 0.02, side + wave);
    float valance = gHash(seed * 9.7) < 0.55 ? smoothstep(H - 0.2, H - 0.16, q.y) : 0.0;
    // lace: a fine diamond net with denser rosettes, fading to its mean where it gets finer than a pixel,
    // and the soft vertical folds of the cloth
    float dia = abs(sin((q.x + q.y) * 115.0) * sin((q.x - q.y) * 115.0));
    float ros = smoothstep(0.55, 0.8, sin(q.x * 38.0) * sin(q.y * 38.0));
    float folds = 0.9 + 0.1 * sin(q.x * 47.0 + sin(q.y * 6.0 + seed * 9.0) * 1.5);
    float laceD = 1.0 - smoothstep(0.004, 0.012, fw);
    float lace = mix(0.78, 0.62 + 0.3 * dia + 0.2 * ros, laceD) * folds;
    float drape = max(curtain, valance);
    // the room behind: brighter toward the ceiling lamp, a darker sill, a figure of furniture
    vec2 lc = vec2(W * (0.3 + 0.4 * gHash(seed * 2.3)), H * 0.95);
    float lamp = exp(-dot(q - lc, q - lc) * 2.2);
    float back = 0.45 + 0.4 * lamp + 0.15 * smoothstep(0.0, H, q.y);
    float furn = gHash(seed * 4.9) < 0.5 ? gBox(q, vec2(W * 0.55, 0.0), vec2(W * 0.95, H * 0.32), 0.01) : 0.0;
    back *= 1.0 - 0.55 * furn;
    // the window lamp: a small glowing shade on the sill between the curtains
    float hasLamp = step(0.35, gHash(seed * 6.1)) * (kind < 1.0 ? 1.0 : 0.0);
    float lx = W * 0.5 + (gHash(seed * 8.3) - 0.5) * W * 0.3;
    vec2 sq = (q - vec2(lx, 0.2)) / vec2(0.11, 0.08);
    float shadeTop = 0.75;
    float shade = (1.0 - smoothstep(0.9, 1.05, abs(sq.y))) * (1.0 - smoothstep(mix(0.7, 1.0, (sq.y + 1.0) * 0.5) * shadeTop + 0.25, 1.05, abs(sq.x)));
    float stem = gBox(q, vec2(lx - 0.012, 0.02), vec2(lx + 0.012, 0.12), 0.004);
    float lampGlow = exp(-dot(sq, sq) * 0.35) * 0.6;
    room = warm * back * (1.0 - drape) + mix(warm, vec3(1.0, 0.92, 0.8), 0.5) * drape * 1.15 * lace;
    room = mix(room, warm * 0.15, stem * hasLamp);
    room += warm * (shade * 2.6 + lampGlow) * hasLamp;
    // daytime: the curtains read white behind the glass
    col = mix(darkGlass, vec3(0.62, 0.62, 0.6) * lace, drape * 0.85);
    glass = 1.0 - drape * 0.7;
  } else if (kind < 3.0) {
    // shop: shelves of brightly packed goods under strip lights, a sale poster taped to the glass
    vec3 light = mix(vec3(1.0, 0.93, 0.8), warm, 0.45);
    float top = step(H * 0.8, q.y);
    float sy = q.y / 0.38;
    float row = floor(sy);
    float sf = fract(sy);
    float cell = floor(q.x / 0.1);
    float hx = gHash(cell * 1.7 + row * 17.0 + seed * 5.0);
    float fill = 0.45 + 0.5 * gHash(cell * 3.1 + row * 7.0 + seed * 2.0);
    float item = step(0.16, hx) * step(0.14, sf) * step(sf, fill) * (1.0 - top);
    float board = (1.0 - smoothstep(0.08, 0.13, sf)) * (1.0 - top);
    vec3 pc = hx < 0.36 ? vec3(0.9, 0.22, 0.14) : hx < 0.5 ? vec3(0.22, 0.38, 0.8) : hx < 0.63 ? vec3(0.98, 0.82, 0.3) : hx < 0.76 ? vec3(0.32, 0.62, 0.34) : vec3(0.96, 0.94, 0.9);
    vec3 near = light * mix(vec3(0.78), pc * 0.85, item) * (1.0 - 0.5 * board);
    vec3 far = light * vec3(0.72, 0.6, 0.52);
    room = mix(far, near, detail) * (1.0 - top);
    // the ceiling: strip lights across a dimmer ceiling
    float strip = smoothstep(0.55, 0.62, fract(q.x / 1.6 + seed)) * (1.0 - smoothstep(0.88, 0.95, fract(q.x / 1.6 + seed)));
    room += top * light * (0.55 + 1.1 * strip * smoothstep(H * 0.86, H * 0.9, q.y));
    col = mix(darkGlass, vec3(0.22, 0.2, 0.2), item * 0.4 * detail);
    // a sale poster in some panes (paper, seen by day as well): red with a white band
    float panes = max(1.0, floor(W / 1.3 + 0.5));
    float pw = W / panes;
    float pi = floor(q.x / pw);
    if (H > 1.2 && gHash(pi * 3.7 + seed * 11.0) < 0.3) {
      float px = pi * pw + 0.12 + (pw - 0.66) * gHash(pi + seed * 9.0);
      float poster = gBox(q, vec2(px, 0.22), vec2(px + 0.42, 0.82), 0.006);
      float band_ = gBox(q, vec2(px + 0.05, 0.48), vec2(px + 0.37, 0.63), 0.006);
      vec3 paper = mix(vec3(0.8, 0.09, 0.06), vec3(0.96, 0.94, 0.88), band_);
      room = mix(room, paper * light * 0.8, poster);
      col = mix(col, paper * 0.75, poster);
      glass *= 1.0 - poster * 0.9;
    }
  } else if (kind < 5.0) {
    // church: chandeliers high in the nave, pew backs dimming the lowest panes, and old glass
    // that makes every small pane a shade different
    float pane = gHash(floor(q.x / (W / 3.0)) * 7.0 + floor(q.y / 0.32) * 13.0 + seed * 31.0);
    vec2 cl = (q - vec2(W * 0.5, H * 0.74)) / vec2(W * 0.8, H * 0.32);
    float chand = exp(-dot(cl, cl) * 1.4);
    float pews = 0.74 + 0.26 * smoothstep(0.2, 0.85, q.y);
    room = warm * (0.72 + 0.3 * chand) * pews * (0.9 + 0.2 * pane);
    room = mix(room, vec3(1.0, 0.9, 0.72), chand * 0.25);
    col = darkGlass * 1.4;
  } else if (kind > 7.0) {
    // works: bright, cold-ish strip lights
    room = mix(warm, vec3(0.95, 0.95, 1.0), 0.55) * (0.8 + 0.3 * step(0.5, fract(q.x / 1.8)));
  } else {
    room = warm * 0.9;
  }
  emit = room * (1.0 - bars) * inside;
  // glazing bars read as dark silhouettes against a lit room
  col = mix(col, frameC * (1.0 - 0.6 * clamp(lit, 0.0, 1.0)), bars);
  glass *= 1.0 - bars;
}
`;
