/**
 * Foxfire Fjord's material library: one Nordic material language for the
 * cabin, the village, the sauna and the props (falu red and ochre boards,
 * white trim, knotty pine, tarred and silvered timber, birch bark, gneiss,
 * granite, slate and fieldstone, cast iron, enamel, stoneware, wool,
 * sheepskin, linen, felt, rope, ice and packed snow, plus the Fresnel glass).
 * Textures are generated once: in background workers as soon as the quality
 * is known (`MaterialLibrary.prefetch`, core/texture-pool.ts), or on the main
 * thread on first use when a worker result is not ready.
 *
 * TEXTURE SCALE CONTRACT: all library textures repeat in *metres*. Geometry
 * using library materials must have UVs in metres — call
 * `applyBoxUV(geometry)` from core/geometry.ts (or produce metre UVs yourself).
 * Wood grain runs along U; use `applyBoxUV(geo, { grain: 'y' })` for vertical
 * boards. Board cladding stacks its boards along V.
 *
 * SNOW: exterior standard materials are swept once after the features load
 * (`snowify`, see core/snow.ts): flat tops collect snow, windward faces are
 * plastered. Opt out with `userData.snow = 0`.
 *
 * ROOM LIGHT: interiors are lamp-lit. Interior variants
 * (`materials.get('knottyPine', 'living')`, zones living | glasswing | sauna)
 * get the warm light of the zone's lamps and fire (with the stove's flicker)
 * on top of the daylight from the windows, and never get snow. Set the
 * sources with `setRoomLight(zone, { lamps, fire })`. Warm windows and
 * lamp shades glow at night via `registerNightGlow(mat, strength, zone)`.
 */
import * as THREE from 'three';
import { shared } from './shared.js';
import { state } from './state.js';
import { SnowSystem, SNOW_GLSL } from './snow.js';
import * as T from './textures.js';
import { texturePool } from './texture-pool.js';
const ROOM_ZONES = ['living', 'glasswing', 'sauna'];
/**
 * The texture generator call of each textured recipe at a texture size. Kept apart from the recipes
 * so the texture workers can start on them before the library or any feature exists
 * (`MaterialLibrary.prefetch`); ordered roughly by first use (the cabin, the village, the sites).
 */
const TEX = {
    tarredWood: (s) => ['boardTextures', [s, { tar: true, boards: 5, batten: true, seed: 77 }]],
    whiteTrim: (s) => ['boardTextures', [Math.min(1024, s), { paint: '#ebe8df', boards: 2, wear: 0.12, seed: 75 }]],
    fieldstone: (s) => ['fieldstoneTextures', [s, 91]],
    weatheredTimber: (s) => ['woodTextures', [s, '#aaa59c', '#6b675f', { rings: 8, contrast: 0.7, seed: 4, checks: 1 }]],
    knottyPine: (s) => ['panelTextures', [Math.min(1024, s), '#d9bb8f', '#a77b4b', { boards: 18, knots: 7, seed: 2 }]],
    pineFloor: (s) => ['plankTextures', [s, '#cba57a', '#946a43', 8, 3, 3]],
    linen: (s) => ['linenTextures', [Math.min(1024, s), '#e9e3d6', 31]],
    castIron: (s) => ['castTextures', [Math.min(512, s), '#2e2d2c']],
    sheepskin: (s) => ['fleeceTextures', [Math.min(512, s), '#eee5d2']],
    wool: (s) => ['knitTextures', [Math.min(512, s), '#e1dbcf']],
    stoneware: (s) => ['glazeTextures', [Math.min(256, s), '#8c98a2']],
    stainless: (s) => ['brushedTextures', [Math.min(512, s)]],
    rope: (s) => ['ropeTextures', [Math.min(256, s), '#b49a6c']],
    felt: (s) => ['feltTextures', [Math.min(256, s), '#6d675f']],
    birchBark: (s) => ['birchBarkTextures', [Math.min(1024, s)]],
    faluRed: (s) => ['boardTextures', [s, { paint: '#8b2d20', boards: 5, batten: true, wear: 0.16, seed: 71 }]],
    ochre: (s) => ['boardTextures', [s, { paint: '#c4903c', boards: 5, batten: true, wear: 0.14, seed: 73 }]],
    slate: (s) => ['stoneTextures', [s, '#3d4046', { speckle: 0.15, seed: 18, veins: 12 }]],
    granite: (s) => ['stoneTextures', [s, '#a9a49d', { speckle: 1, seed: 12 }]],
    gneiss: (s) => ['stoneTextures', [s, '#4c4f55', { speckle: 0.5, seed: 14, veins: 6 }]],
};
/** most positioned light sources a room can have (see MaterialLibrary.setRoomSources) */
const ROOM_SOURCES = 6;
function roomUniforms() {
    return {
        warm: { value: 0 },
        lamp: { value: new THREE.Color() },
        srcPos: { value: Array.from({ length: ROOM_SOURCES }, () => new THREE.Vector4()) },
        srcCol: { value: Array.from({ length: ROOM_SOURCES }, () => new THREE.Color()) },
    };
}
/** 2700 K lamplight, linear, normalised to luminance 1 */
const LAMP_COLOR = new THREE.Color(1.54, 0.894, 0.462);
/** wood fire, linear, normalised to luminance 1 */
const FIRE_COLOR = new THREE.Color(1.83, 0.83, 0.28);
/** default warm emissive for glowing windows and shades (×1 strength ≈ blooms at night) */
const GLOW_COLOR = new THREE.Color(1.0, 0.6, 0.28);
/** lamp / fire irradiance per zone at full power (scene-linear) */
const ZONE_POWER = {
    living: { lamps: 0.42, fire: 0.3 },
    glasswing: { lamps: 0.16, fire: 0.0 },
    sauna: { lamps: 0.08, fire: 0.4 },
};
/** share of the outdoor sky light that reaches a zone through its windows */
const ZONE_DAYLIGHT = { exterior: 1, living: 0.55, glasswing: 1, sauna: 0.3 };
/**
 * Room light: indoors the sky's image light comes through the windows and
 * bounces off pine, so it is pulled toward a warm neutral; on top of it the
 * room's own lamps and fire add a soft warm fill from all round (a little
 * more on faces that look up) and warm glossy reflections. Chained after any
 * existing patch; the uniform names double as an "already patched" guard.
 */
function applyRoomLight(shader, u) {
    if (shader.fragmentShader.includes('uRoomWarm') || !shader.fragmentShader.includes('#include <lights_fragment_maps>'))
        return;
    shader.uniforms.uRoomWarm = u.warm;
    shader.uniforms.uRoomLamp = u.lamp;
    shader.uniforms.uRoomSrcPos = u.srcPos;
    shader.uniforms.uRoomSrcCol = u.srcCol;
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uRoomWarm;\nuniform vec3 uRoomLamp;\nuniform vec4 uRoomSrcPos[${ROOM_SOURCES}];\nuniform vec3 uRoomSrcCol[${ROOM_SOURCES}];`)
        .replace('#include <lights_fragment_maps>', 
    /* glsl */ `#include <lights_fragment_maps>
    {
      // a true no-op at weight 0: mix(a, b, 0) would still turn an infinite b into NaN
      if (uRoomWarm > 0.0 && !any(isinf(radiance)) && !any(isinf(iblIrradiance))) {
        const vec3 rLum = vec3(0.2126, 0.7152, 0.0722);
        const vec3 rWarm = vec3(1.08, 1.0, 0.86);
        radiance = mix(radiance, dot(radiance, rLum) * rWarm, uRoomWarm * 0.6);
        iblIrradiance = mix(iblIrradiance, dot(iblIrradiance, rLum) * rWarm, uRoomWarm);
      }
      if (dot(uRoomLamp, vec3(1.0)) > 0.0) {
        float rUp = transformDirectionByInverseViewMatrix(geometryNormal, viewMatrix).y;
        iblIrradiance += uRoomLamp * (0.78 + 0.22 * rUp);
        radiance += uRoomLamp * (RECIPROCAL_PI * 0.55);
      }
      // positioned lamps, the stove and candles: soft inverse-square pools of warm light (no shadows),
      // a little reaching the faces turned away (bounce)
      if (uRoomSrcPos[0].w > 0.0) {
        vec3 rW = ((-vViewPosition) - viewMatrix[3].xyz) * mat3(viewMatrix);
        vec3 rN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
        for (int i = 0; i < ${ROOM_SOURCES}; i++) {
          vec4 sp = uRoomSrcPos[i];
          if (sp.w <= 0.0) continue;
          vec3 d = sp.xyz - rW;
          float d2 = dot(d, d);
          float ndl = max(dot(rN, d * inversesqrt(d2 + 1e-4)), 0.0);
          float fall = (1.0 / (d2 + 0.09)) * (1.0 - smoothstep(sp.w * 0.55, sp.w, sqrt(d2)));
          iblIrradiance += uRoomSrcCol[i] * fall * (0.12 + 0.88 * ndl);
        }
      }
    }`);
}
/**
 * Clear glacier / lake ice: little diffuse scattering, a crisp wet surface,
 * and the light that went *through* it: the environment seen along the
 * refracted ray, tinted blue-green by the path through the ice. Milky,
 * bubble-filled parts come from the diffuse colour (vertex colours or map).
 */
/** debug switch for the ice patch (0 off; 1 only the light through the ice; 2 everything but it) */
const ICE_DEBUG = { value: 0 };
function applyIce(shader, mat) {
    if (shader.fragmentShader.includes('iceThrough'))
        return;
    // what lies under / behind the ice (albedo): snow by default, black sand on the beach (`userData.iceGround`)
    const g = mat.userData.iceGround ?? [0.62, 0.66, 0.72];
    shader.uniforms.uIceGround = { value: new THREE.Color(g[0], g[1], g[2]) };
    shader.uniforms.uIceDebug = ICE_DEBUG;
    // melt scallops: the sea and the air hollow the surface into shallow dishes (cell size in m, 0 = smooth)
    shader.uniforms.uIceScallop = { value: mat.userData.iceScallop ?? 0 };
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uIceGround;\nuniform float uIceDebug;\nuniform float uIceScallop;')
        .replace('#include <clearcoat_normal_fragment_maps>', 
    /* glsl */ `#include <clearcoat_normal_fragment_maps>
    if (uIceScallop > 0.0) {
      // world position, in cells
      vec3 sP = (((-vViewPosition) - viewMatrix[3].xyz) * mat3(viewMatrix)) / uIceScallop;
      float sPx = length(fwidth(sP));
      if (sPx < 0.8) {
        vec3 sC = floor(sP);
        vec3 sF = sP - sC;
        float sD1 = 9.0;
        float sD2 = 9.0;
        vec3 sR = vec3(0.0);
        float sH = 0.0;
        for (int k = 0; k < 27; k++) {
          vec3 g = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0;
          vec3 c = sC + g;
          vec3 h = fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          vec3 r = g + 0.1 + h * 0.8 - sF;
          float d = dot(r, r);
          if (d < sD1) {
            sD2 = sD1;
            sD1 = d;
            sR = r;
            sH = h.x;
          } else if (d < sD2) {
            sD2 = d;
          }
        }
        // a concave dish round each cell point: the normal leans toward its middle, sharp ridges between
        vec3 sV = mat3(viewMatrix) * sR;
        sV -= normal * dot(sV, normal);
        float sRidge = smoothstep(0.0, 0.3, sqrt(sD2) - sqrt(sD1));
        // dishes of different depths, some nearly flat
        float sK = 0.6 * (0.3 + 0.7 * sRidge) * (0.25 + 1.1 * sH * sH) * (1.0 - smoothstep(0.3, 0.8, sPx));
        normal = normalize(normal + sV * sK);
        #ifdef USE_CLEARCOAT
          clearcoatNormal = normal;
        #endif
      }
    }`)
        .replace('#include <lights_fragment_maps>', 
    /* glsl */ `#include <lights_fragment_maps>
    #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
    {
      // the key light shining through the ice toward the eye (directLight: the sun or moon after the
      // lights loop, shadow included): a backlit chunk glows blue-green, its milky parts brightest
      float iBack = saturate(dot(-geometryViewDir, directLight.direction));
      float iAway = saturate(0.6 - 0.6 * dot(geometryNormal, directLight.direction));
      float iMilk = saturate(dot(diffuseColor.rgb, vec3(0.333)) * 1.3);
      // thin toward the silhouette (warm, bright), thick in the middle (deep blue, dim)
      float iRim = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
      // bubbles scatter the light out early: milky ice glows white, clear thick ice deep blue
      float iThick = mix(1.7, 0.45, iRim) * mix(1.0, 0.35, iMilk);
      float iLobe = pow(iBack, 8.0) * 0.8 + pow(iBack, 3.0) * 0.2;
      vec3 iGlowT = exp(-vec3(1.7, 0.5, 0.15) * iThick);
      // clear ice lets the light straight through (it shows only at the thin rims); bubbly ice scatters it
      float iScatter = iMilk * 0.9 + iRim * 0.35;
      reflectedLight.directDiffuse += directLight.color * iGlowT * iLobe * (0.25 + 0.75 * iAway) * iScatter * 0.4;
    }
    #endif`)
        .replace('#include <lights_fragment_end>', 
    /* glsl */ `#include <lights_fragment_end>
    #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
    {
      vec3 iN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
      vec3 iV = transformDirectionByInverseViewMatrix(geometryViewDir, viewMatrix);
      float iNdV = saturate(dot(iN, iV));
      vec3 iT = refract(-iV, iN, 1.0 / 1.31);
      // a rounded chunk is a thick lens: the ray bends again on the way out, so the world behind it
      // is seen bent twice as far (the horizon, the sea and the sky show upside down inside the ice)
      vec3 iX = normalize(-iV + 2.2 * (iT + iV));
      // path length through the chunk grows at grazing angles
      float iPath = 0.35 / max(iNdV, 0.25);
      vec3 iTint = exp(-vec3(1.5, 0.45, 0.12) * iPath);
      // what lies behind along the bent ray: the sky (and the bright horizon) above, the ground below
      vec3 iSky = textureCubeUV(envMap, envMapRotation * vec3(iX.x, max(iX.y, 0.02), iX.z), 0.12).rgb * envMapIntensity;
      vec3 iUp = textureCubeUV(envMap, envMapRotation * vec3(0.0, 1.0, 0.0), 1.0).rgb * envMapIntensity;
      vec3 iGround = uIceGround * iUp;
      vec3 iceThrough = mix(iGround, iSky, smoothstep(-0.05, 0.04, iX.y)) + iSky * 0.03;
      // sky light caught inside the ice (bounced between its faces and off the bubbles): even clear
      // ice over black sand glows a little blue-green
      vec3 iInner = iUp * vec3(0.35, 0.66, 0.95) * 0.075;
      float iF = 0.02 + 0.98 * pow(1.0 - iNdV, 5.0);
      // clear where the diffuse colour is dark, milky where it is light
      float iClear = 1.0 - saturate(dot(diffuseColor.rgb, vec3(0.333)) * 1.3);
      vec3 iAdd = (iceThrough * iTint + iInner) * (1.0 - iF) * iClear;
      if (uIceDebug > 0.5 && uIceDebug < 1.5) {
        reflectedLight.directDiffuse = vec3(0.0);
        reflectedLight.directSpecular = vec3(0.0);
        reflectedLight.indirectSpecular = vec3(0.0);
        reflectedLight.indirectDiffuse = vec3(0.0);
      }
      if (uIceDebug < 1.5) reflectedLight.indirectDiffuse += iAdd;
    }
    #endif`);
}
/** Chains a patch after the material's existing onBeforeCompile, keeping program sharing intact. */
function chainPatch(mat, tag, fn) {
    const prev = mat.onBeforeCompile;
    const ownKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
    const prevKey = mat.customProgramCacheKey;
    const prevSrc = prev.toString();
    // a method, not an arrow: clones that keep the patch compile with their own `this`
    mat.onBeforeCompile = function (shader, renderer) {
        prev.call(this, shader, renderer);
        fn(shader, this);
    };
    mat.customProgramCacheKey = () => `${ownKey ? prevKey.call(mat) : prevSrc}|${tag}`;
}
/**
 * Clones of a patched recipe material (features clone library materials to
 * recolour them) keep the recipe's patch: three's Material.copy drops
 * onBeforeCompile and customProgramCacheKey.
 */
function keepPatchesOnClone(mat, patch) {
    const proto = Object.getPrototypeOf(mat);
    mat.clone = function () {
        const c = proto.clone.call(this);
        c.onBeforeCompile = patch.fn;
        c.customProgramCacheKey = patch.key;
        keepPatchesOnClone(c, patch);
        return c;
    };
}
/** CubeUV (PMREM) defines for a ShaderMaterial that samples scene.environment itself (0 = none). */
function setCubeUVDefines(mat, height) {
    const d = (mat.defines ??= {});
    delete d.ENVMAP_TYPE_CUBE_UV;
    delete d.CUBEUV_TEXEL_WIDTH;
    delete d.CUBEUV_TEXEL_HEIGHT;
    delete d.CUBEUV_MAX_MIP;
    if (height > 0) {
        const maxMip = Math.log2(height) - 2;
        d.ENVMAP_TYPE_CUBE_UV = '';
        d.CUBEUV_TEXEL_WIDTH = 1 / (3 * Math.max(2 ** maxMip, 7 * 16));
        d.CUBEUV_TEXEL_HEIGHT = 1 / height;
        d.CUBEUV_MAX_MIP = `${maxMip}.0`;
    }
    mat.needsUpdate = true;
}
export class MaterialLibrary {
    renderer;
    quality;
    cache = new Map();
    interior = [];
    glowing = [];
    zoneDaylight = { ...ZONE_DAYLIGHT };
    rooms = {
        living: roomUniforms(),
        glasswing: roomUniforms(),
        sauna: roomUniforms(),
    };
    /** positioned sources per room and how much of the all-round fill stays when they are set */
    sources = {
        living: { list: [], fill: 1 },
        glasswing: { list: [], fill: 1 },
        sauna: { list: [], fill: 1 },
    };
    roomLight = {
        living: { lamps: 1, fire: 1 },
        glasswing: { lamps: 1, fire: 0 },
        sauna: { lamps: 1, fire: 1 },
    };
    /** current glow (emissive scale) per zone, updated each frame */
    glow = { living: 0, glasswing: 0, sauna: 0 };
    glassMaterials = [];
    /** recipe-level patches (ice), carried over to interior variants */
    recipePatch = new WeakMap();
    envLift = { value: 1 };
    glassEnv = { value: null };
    glassEnvHeight = -1;
    anisotropy;
    size;
    /** tileable RGBA fBm noise texture (repeat wrapping) for custom shaders */
    noise;
    /** the snow system: uniforms and GLSL for custom shaders, the sweep, the shelter map */
    snow;
    /** debug: 0 off, 1 only the light through the ice, 2 the ice without it */
    iceDebug = ICE_DEBUG;
    constructor(renderer, quality) {
        this.renderer = renderer;
        this.quality = quality;
        this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        this.size = quality.textureSize;
        const n = 256;
        this.noise = new THREE.DataTexture(T.noiseRGBA(n), n, n, THREE.RGBAFormat);
        this.noise.wrapS = this.noise.wrapT = THREE.RepeatWrapping;
        this.noise.magFilter = THREE.LinearFilter;
        this.noise.minFilter = THREE.LinearMipmapLinearFilter;
        this.noise.generateMipmaps = true;
        this.noise.needsUpdate = true;
        this.snow = new SnowSystem(this.noise, quality.fancy);
    }
    /** Texture from a canvas with metre-based repeat. */
    canvasTexture(canvas, tile, color = true) {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / tile, 1 / tile);
        t.anisotropy = this.anisotropy;
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        return t;
    }
    /** Texture from pixels a texture worker made (bottom row first, so it lies the same way up as a canvas). */
    pixelTexture(px, tile, color = true) {
        const t = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / tile, 1 / tile);
        t.anisotropy = this.anisotropy;
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        return t;
    }
    tex(src, tile, color) {
        return 'data' in src ? this.pixelTexture(src, tile, color) : this.canvasTexture(src, tile, color);
    }
    set(set, tile) {
        const map = this.tex(set.map, tile, true);
        const bump = set.bump ? this.tex(set.bump, tile, false) : undefined;
        const rough = set.rough ? this.tex(set.rough, tile, false) : undefined;
        return { map, bump, rough };
    }
    /** a recipe's texture set: from the texture workers when it is ready, otherwise generated here */
    textures(call) {
        const ready = texturePool.take(call);
        if (ready)
            return ready;
        const gen = T[call[0]];
        return gen(...call[1]);
    }
    /**
     * Start generating every recipe's textures for this quality in background workers. Call as early as
     * possible (before the world is baked); the promise resolves when they are all done.
     */
    static prefetch(quality) {
        const calls = Object.values(TEX).map((f) => f(quality.textureSize));
        return texturePool.prefetch(calls);
    }
    /** Forget prefetched textures nobody asked for (after the features have loaded). */
    releasePrefetch() {
        texturePool.release();
    }
    /** a standard material from a texture set (roughness map multiplies `roughness`) */
    std(name, set, tile, p = {}) {
        const t = this.set(set, tile);
        const m = new THREE.MeshStandardMaterial({ name, map: t.map, ...p });
        if (t.bump)
            m.bumpMap = t.bump;
        if (t.rough)
            m.roughnessMap = t.rough;
        return m;
    }
    recipes = {
        /* ---- painted and natural timber ---- */
        faluRed: {
            // iron-oxide red board-and-batten, matte and chalky, chipped to silver at the edges
            build: (s, t) => this.std('faluRed', t, 1.2, { bumpScale: 1.4, roughness: 1 }),
        },
        ochre: {
            build: (s, t) => this.std('ochre', t, 1.2, { bumpScale: 1.4, roughness: 1 }),
        },
        whiteTrim: {
            // gloss oil paint on wide trim boards: window frames, corner boards, barge boards
            build: (s, t) => this.std('whiteTrim', t, 1.2, { bumpScale: 0.6, roughness: 0.62 }),
        },
        knottyPine: {
            // honey-toned tongue-and-groove pine panelling (13 cm boards, V joints) with small live and dead knots
            build: (s, t) => this.std('knottyPine', t, 2.4, { bumpScale: 0.7, roughness: 1 }),
        },
        pineFloor: {
            // wide, oiled, foot-polished pine boards
            build: (s, t) => this.std('pineFloor', t, 1.6, { bumpScale: 0.6, roughness: 0.75 }),
        },
        tarredWood: {
            // pine-tarred board-and-batten: near-black, satin, the grain still showing
            build: (s, t) => this.std('tarredWood', t, 1.2, { bumpScale: 1.2, roughness: 1 }),
        },
        weatheredTimber: {
            // silver-grey sun- and salt-bleached timber with checks along the grain
            build: (s, t) => this.std('weatheredTimber', t, 1.2, { bumpScale: 1.3, roughness: 0.88 }),
        },
        birchBark: {
            build: (s, t) => this.std('birchBark', t, 0.5, { bumpScale: 1.2, roughness: 0.82 }),
        },
        /* ---- stone ---- */
        gneiss: {
            build: (s, t) => this.std('gneiss', t, 1.6, { bumpScale: 0.8, roughness: 0.72 }),
        },
        granite: {
            build: (s, t) => this.std('granite', t, 0.8, { bumpScale: 0.4, roughness: 0.58 }),
        },
        slate: {
            build: (s, t) => this.std('slate', t, 0.7, { bumpScale: 0.4, roughness: 0.6 }),
        },
        fieldstone: {
            build: (s, t) => this.std('fieldstone', t, 1.3, { bumpScale: 2.4, roughness: 0.86 }),
        },
        /* ---- metal ---- */
        castIron: {
            build: (s, t) => this.std('castIron', t, 0.4, { metalness: 0.4, roughness: 1, bumpScale: 0.6 }),
        },
        blackSteel: {
            build: () => new THREE.MeshStandardMaterial({ name: 'blackSteel', color: 0x1e2023, metalness: 0.8, roughness: 0.42 }),
        },
        brass: {
            build: () => new THREE.MeshStandardMaterial({ name: 'brass', color: 0xcaa767, metalness: 1, roughness: 0.38 }),
        },
        copper: {
            build: () => new THREE.MeshStandardMaterial({ name: 'copper', color: 0xc8805a, metalness: 1, roughness: 0.34 }),
        },
        stainless: {
            build: (s, set) => {
                const t = this.set(set, 0.5);
                return new THREE.MeshStandardMaterial({ name: 'stainless', color: 0xc9ccd0, metalness: 1, roughness: 0.32, roughnessMap: t.map });
            },
        },
        /* ---- glaze and enamel ---- */
        enamelWhite: {
            build: () => new THREE.MeshPhysicalMaterial({ name: 'enamelWhite', color: 0xeeebe2, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
        },
        enamelRed: {
            build: () => new THREE.MeshPhysicalMaterial({ name: 'enamelRed', color: 0xa62a1f, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
        },
        stoneware: {
            build: (s, set) => {
                const t = this.set(set, 0.12);
                return new THREE.MeshPhysicalMaterial({ name: 'stoneware', map: t.map, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
            },
        },
        ceramicWhite: {
            build: () => new THREE.MeshPhysicalMaterial({ name: 'ceramicWhite', color: 0xf0ede6, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
        },
        /* ---- textiles ---- */
        wool: {
            // undyed oat-grey knit; clone and set .color for coloured throws (the map is light, so tints work)
            build: (s, set) => {
                const t = this.set(set, 0.22);
                return new THREE.MeshPhysicalMaterial({ name: 'wool', map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 1, sheen: 0.6, sheenRoughness: 0.8, sheenColor: 0xe8e2d6 });
            },
        },
        sheepskin: {
            build: (s, set) => {
                const t = this.set(set, 0.3);
                return new THREE.MeshPhysicalMaterial({ name: 'sheepskin', map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: 0xf3ebd8 });
            },
        },
        linen: {
            build: (s, t) => this.std('linen', t, 0.12, { bumpScale: 0.4, roughness: 0.93 }),
        },
        felt: {
            build: (s, t) => this.std('felt', t, 0.3, { bumpScale: 0.3, roughness: 1 }),
        },
        rope: {
            build: (s, t) => this.std('rope', t, 0.08, { bumpScale: 0.8, roughness: 0.95 }),
        },
        /* ---- plain ---- */
        matteBlack: {
            build: () => new THREE.MeshStandardMaterial({ name: 'matteBlack', color: 0x161616, roughness: 0.8 }),
        },
        matteWhite: {
            build: () => new THREE.MeshStandardMaterial({ name: 'matteWhite', color: 0xefefea, roughness: 0.85 }),
        },
        frostedGlass: {
            build: () => new THREE.MeshPhysicalMaterial({
                name: 'frostedGlass',
                color: 0xf2f5f7,
                roughness: 0.6,
                transparent: true,
                opacity: 0.6,
                depthWrite: false,
            }),
        },
        /* ---- winter ---- */
        ice: {
            // clear glacier ice: icicles, stranded floes, the ice hole's rim
            build: () => {
                const m = new THREE.MeshPhysicalMaterial({
                    name: 'ice',
                    color: 0x2a3a42,
                    roughness: 0.08,
                    metalness: 0,
                    ior: 1.31,
                    clearcoat: 1,
                    clearcoatRoughness: 0.04,
                    specularIntensity: 1,
                });
                chainPatch(m, 'fox-ice', applyIce);
                m.userData.snow = 0.35;
                return m;
            },
        },
        snowPack: {
            // snow as a surface: drifts, caps, snowbanks, snowballs (same albedo and sparkle as the ground)
            build: () => {
                const m = new THREE.MeshStandardMaterial({ name: 'snowPack', color: 0xffffff, roughness: 0.8 });
                this.snow.patch(m, 1, true);
                return m;
            },
        },
    };
    get(name, zone = 'exterior') {
        const key = `${name}:${zone}`;
        const hit = this.cache.get(key);
        if (hit)
            return hit;
        if (name === 'glass') {
            const g = this.glass({ room: zone === 'exterior' ? undefined : zone });
            this.cache.set(key, g);
            return g;
        }
        let base = this.cache.get(`${name}:exterior`);
        if (!base) {
            const call = TEX[name]?.(this.size);
            base = this.recipes[name].build(this.size, call ? this.textures(call) : undefined);
            this.cache.set(`${name}:exterior`, base);
            if (base.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
                const patch = { fn: base.onBeforeCompile, key: base.customProgramCacheKey };
                this.recipePatch.set(base, patch);
                keepPatchesOnClone(base, patch);
            }
        }
        if (zone === 'exterior')
            return base;
        const variant = base.clone();
        variant.name = `${base.name}@${zone}`;
        variant.userData = { ...base.userData, snow: 0 };
        // the recipe's own patch (ice) carries over; room light chains after it
        const rp = this.recipePatch.get(base);
        if (rp) {
            variant.onBeforeCompile = rp.fn;
            variant.customProgramCacheKey = rp.key;
        }
        this.cache.set(key, variant);
        // at night the room is lamp-lit: the (lifted) night sky through the windows lights and mirrors it only a little
        this.registerInterior(variant, zone, { nightEnv: 0.35 });
        return variant;
    }
    /**
     * Register a custom material as part of a room: its image light follows the
     * room's windows and it gets the room's lamp and fire light (chained after
     * any existing onBeforeCompile). It is never snowed. Pass `{ warm: false }`
     * if the material brings its own room light. `nightEnv` scales its image
     * light at full night (mirror-like metal would return the lifted night sky).
     */
    registerInterior(mat, zone, opts = {}) {
        this.snow.exclude(mat);
        this.interior.push({ mat, zone, base: mat.envMapIntensity ?? 1, night: opts.nightEnv ?? 1 });
        if (opts.warm === false || zone === 'exterior')
            return;
        const u = this.rooms[zone];
        chainPatch(mat, 'fox-room', (shader) => applyRoomLight(shader, u));
    }
    /** Unregister an interior or glowing material (e.g. on dispose). */
    unregisterInterior(mat) {
        this.interior = this.interior.filter((e) => e.mat !== mat);
        this.glowing = this.glowing.filter((e) => e.mat !== mat);
    }
    /**
     * Warm night glow (lit windows seen from outside, lamp shades, a lantern's
     * glass): the emissive intensity follows the zone's lamps and fire, with
     * the stove's flicker, strongest at night. At strength 1 it blooms at night.
     * A black emissive colour is replaced by the default warm glow colour.
     */
    registerNightGlow(mat, strength = 1, zone = 'living') {
        if (mat.emissive.r + mat.emissive.g + mat.emissive.b === 0)
            mat.emissive.copy(GLOW_COLOR);
        mat.userData.snow = mat.userData.snow ?? 0;
        this.glowing.push({ mat, strength, zone });
    }
    /**
     * Place a room's lamps, its fire and candles (up to 6): each lights the interior materials of the
     * zone with a soft inverse-square pool (no shadows), following the room's lamp dimmer / fire state
     * and the stove's flicker. With sources set, the all-round fill drops to `fill` (default 0.45) so
     * the pools give the room depth. Pass [] to clear.
     */
    setRoomSources(zone, sources, opts = {}) {
        this.sources[zone] = { list: sources.slice(0, ROOM_SOURCES), fill: sources.length ? (opts.fill ?? 0.45) : 1 };
    }
    /** Switch a room's lamps (0..1 dimmer) and fire (0..1). */
    setRoomLight(zone, light) {
        Object.assign(this.roomLight[zone], light);
    }
    getRoomLight(zone) {
        return this.roomLight[zone];
    }
    /** Current night-glow level of a zone (≈0..1.3; what registerNightGlow multiplies by its strength). */
    glowLevel(zone) {
        return this.glow[zone];
    }
    /** Share of the sky light reaching a zone (curtains drawn → lower). */
    setZoneDaylight(zone, k) {
        this.zoneDaylight[zone] = k;
    }
    /**
     * Snow on everything under `root` (see core/snow.ts). Call it for objects
     * built after load (the features' first build is swept automatically).
     */
    snowify(root, amount = 1) {
        return this.snow.sweep(root, amount);
    }
    /** The startup sweep over all features plus the shelter-map bake (main.ts calls this once). */
    snowifyFeatures(scene, features) {
        return this.snow.snowifyFeatures(this.renderer, scene, features, this.quality.fancy ? 1024 : 512);
    }
    /**
     * Fresnel glass for windows, the glass wing and glassware. Nearly invisible
     * face-on, a mirror of the sky (and the aurora) at grazing angles; optional
     * frost creeping in from the pane edges, snow on up-facing panes and a
     * little condensation, lit from inside by the room's lamps.
     */
    glass(opts = {}) {
        const m = new THREE.ShaderMaterial({
            name: 'fresnelGlass',
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uTint: { value: new THREE.Color(opts.tint ?? 0xdfe9e6) },
                    uBaseAlpha: { value: opts.opacity ?? 0.035 },
                    uReflect: { value: opts.reflect ?? 1 },
                    uInside: { value: 0 },
                    uFrost: { value: opts.frost ?? 0 },
                    uSnowAmt: { value: opts.snow ?? 0 },
                    uGlow: { value: new THREE.Color(0, 0, 0) },
                },
            ]),
            vertexShader: GLASS_VERT,
            fragmentShader: GLASS_FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor,
            blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        });
        // shared uniforms by reference (UniformsUtils.merge clones values)
        Object.assign(m.uniforms, this.snow.uniforms);
        m.uniforms.uSkyCube = shared.uSkyCube;
        m.uniforms.uLightDir = shared.uLightDir;
        m.uniforms.uLightColor = shared.uLightColor;
        m.uniforms.uSkyColor = shared.uSkyColor;
        m.uniforms.uHorizonColor = shared.uHorizonColor;
        m.uniforms.uAuroraLight = shared.uAuroraLight;
        m.uniforms.uDay = shared.uDay;
        m.uniforms.uEnvLift = this.envLift;
        // the sky's prefiltered environment (set in update): irradiance on the frost and the snow
        m.uniforms.uEnvMap = this.glassEnv;
        m.uniforms.uEnvIntensity = this.envLift;
        m.userData.snow = 0;
        if (this.glassEnvHeight > 0)
            setCubeUVDefines(m, this.glassEnvHeight);
        this.glassMaterials.push({ mat: m, room: opts.room });
        return m;
    }
    /** Called every frame by the app. */
    update(scene) {
        const t = shared.uTime.value;
        const night = shared.uNight.value;
        // the stove: a slow breathing glow with quick licks of flame
        const flicker = 1 +
            0.07 * Math.sin(t * 2.3) * Math.sin(t * 0.71 + 1.3) +
            0.05 * Math.sin(t * 7.9 + Math.sin(t * 1.7) * 2) +
            0.035 * Math.sin(t * 13.1 + 0.4) * Math.max(0, Math.sin(t * 0.37));
        shared.uFireFlicker.value = flicker;
        const dayK = shared.uDay.value;
        for (const zone of ROOM_ZONES) {
            const L = this.roomLight[zone];
            const P = ZONE_POWER[zone];
            const room = this.rooms[zone];
            room.lamp.value.copy(LAMP_COLOR).multiplyScalar(L.lamps * P.lamps);
            const f = L.fire * P.fire * flicker;
            room.lamp.value.r += FIRE_COLOR.r * f;
            room.lamp.value.g += FIRE_COLOR.g * f;
            room.lamp.value.b += FIRE_COLOR.b * f;
            const src = this.sources[zone];
            room.lamp.value.multiplyScalar(src.fill);
            for (let i = 0; i < ROOM_SOURCES; i++) {
                const sp = room.srcPos.value[i];
                const sc = room.srcCol.value[i];
                const so = src.list[i];
                if (!so) {
                    sp.w = 0;
                    continue;
                }
                sp.set(so.position.x, so.position.y, so.position.z, so.reach ?? 6);
                if (so.kind === 'fire') {
                    sc.copy(FIRE_COLOR).multiplyScalar((so.power ?? 0.45) * L.fire * flicker);
                }
                else if (so.kind === 'candle') {
                    const fl = 1 + 0.12 * Math.sin(t * 9.1 + i * 2.3) * Math.sin(t * 3.7 + i);
                    sc.copy(FIRE_COLOR).lerp(LAMP_COLOR, 0.5).multiplyScalar((so.power ?? 0.06) * L.lamps * fl);
                }
                else {
                    sc.copy(LAMP_COLOR).multiplyScalar((so.power ?? 0.3) * L.lamps);
                }
            }
            // daylight from the windows bounces off pine and wool: warmer than the sky outside
            room.warm.value = dayK * 0.5;
            // window glow: lamps carry it, the fire adds its flicker; faint by day
            this.glow[zone] = (L.lamps * 0.85 + L.fire * 0.45 * flicker) * (0.25 + 0.75 * night);
        }
        shared.uLampFill.value.copy(this.rooms.living.lamp.value);
        // three.js ignores envMapIntensity on materials lit by scene.environment, so interior
        // materials carry the environment themselves, with the scene's night lift folded in
        const env = scene.environment;
        const envI = scene.environmentIntensity;
        this.envLift.value = envI;
        for (const e of this.interior) {
            e.mat.envMap = env;
            e.mat.envMapIntensity = e.base * envI * this.zoneDaylight[e.zone] * (e.night + (1 - e.night) * dayK);
        }
        for (const g of this.glowing)
            g.mat.emissiveIntensity = g.strength * this.glow[g.zone];
        // glass samples the PMREM itself (it is a ShaderMaterial): bind it and its CubeUV defines
        const envH = env && env.mapping === THREE.CubeUVReflectionMapping ? env.image.height : 0;
        this.glassEnv.value = envH > 0 ? env : null;
        if (envH !== this.glassEnvHeight) {
            this.glassEnvHeight = envH;
            for (const g of this.glassMaterials)
                setCubeUVDefines(g.mat, envH);
        }
        const inside = state.inside ? 1 : 0;
        for (const g of this.glassMaterials) {
            g.mat.uniforms.uInside.value = inside;
            if (g.room)
                g.mat.uniforms.uGlow.value.copy(this.rooms[g.room].lamp.value);
        }
    }
}
const GLASS_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aPane;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vPane;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(m) * normal);
  vPane = aPane;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const GLASS_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${SNOW_GLSL}
uniform samplerCube uSkyCube;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uAuroraLight;
uniform vec3 uTint;
uniform vec3 uGlow;
uniform float uBaseAlpha;
uniform float uReflect;
uniform float uInside;
uniform float uDay;
uniform float uFrost;
uniform float uSnowAmt;
uniform float uEnvLift;
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D uEnvMap;
uniform float uEnvIntensity;
#include <cube_uv_reflection_fragment>
#endif
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vPane;

float frostRidge(float v) {
  float r = 1.0 - abs(v * 2.0 - 1.0);
  return r * r * r;
}
// ice ferns growing in from a pane edge: p.x runs along the edge, p.y inward (metres). Stems ~3 cm
// apart reach in along the growth direction, feathered side branches leave them at about 55 degrees.
float frostFerns(vec2 p, float seed) {
  // the growth direction wanders: stems lean left and right in clumps (a bounded shear, so the
  // pattern never swirls), and only some places sprout long ones
  float lean = (texture(uSnowNoise, vec2(p.x * 0.8, 0.13) + seed * 0.3).r - 0.5) * 2.2;
  vec2 q = vec2(p.x + p.y * lean, p.y);
  float clump = smoothstep(0.35, 0.65, texture(uSnowNoise, vec2(p.x * 1.7, 0.71) + seed * 0.5).g);
  float st = frostRidge(texture(uSnowNoise, vec2(q.x * 3.2, q.y * 0.6) + seed).g) * (0.45 + 0.55 * clump);
  // feathered side branches leave the stems at about 55 degrees, finer twigs off those
  vec2 b1 = vec2(q.x * 0.57 + q.y * 0.82, -q.x * 0.82 + q.y * 0.57);
  vec2 b2 = vec2(q.x * 0.57 - q.y * 0.82, q.x * 0.82 + q.y * 0.57);
  float br = max(frostRidge(texture(uSnowNoise, vec2(b1.x * 9.0, b1.y * 1.6) + seed * 1.7).g),
                 frostRidge(texture(uSnowNoise, vec2(b2.x * 9.0, b2.y * 1.6) + seed * 2.3).g));
  float tw = frostRidge(texture(uSnowNoise, vec2(b2.x * 26.0, b2.y * 5.0) + seed * 3.1).a);
  float gr = texture(uSnowNoise, p * 8.0 + seed).a;
  return st * 0.5 + br * 0.4 * (0.3 + 0.7 * smoothstep(0.05, 0.45, st)) + tw * 0.12 * smoothstep(0.1, 0.5, br) + (gr - 0.5) * 0.12;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 Ng = normalize(vWorldNormal);
  vec3 N = Ng;
  bool back = dot(N, V) < 0.0;
  if (back) N = -N;
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.66 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 env = textureCube(uSkyCube, R).rgb;
  // from inside, the glass mostly reflects the (darker) interior, not the sky
  float refl = uReflect * mix(1.0, 0.12, uInside);
  float spec = pow(max(dot(R, uLightDir), 0.0), 900.0) * 40.0 + pow(max(dot(R, uLightDir), 0.0), 60.0) * 0.4;
  vec3 col = env * F * refl + uLightColor * spec * F * refl;
  float alpha = clamp(uBaseAlpha + F * 0.85 * refl, 0.0, 1.0);
  col += uTint * uBaseAlpha * (0.15 + 0.85 * uDay) * 0.6;

  // light falling on the pane from outside (key light, sky, aurora) and from the room behind it
  vec3 L = normalize(uLightDir);
  // sky light on the pane's outer face: the environment's irradiance (as every standard material gets it)
  #ifdef ENVMAP_TYPE_CUBE_UV
    vec3 Esky = PI * textureCubeUV(uEnvMap, Ng, 1.0).rgb * uEnvIntensity;
  #else
    vec3 Esky = mix(uHorizonColor, uSkyColor, 0.5) * PI * uEnvLift * (0.6 + 0.4 * max(Ng.y, 0.0));
  #endif
  vec3 Eout = uLightColor * max(dot(Ng, L), 0.0) + Esky + uAuroraFill * (0.5 + 0.5 * Ng.y);
  vec3 Ein = uGlow;

  // ---- frost: solid along the frame, ferns reaching in, furthest from the bottom edge and the corners
  if (uFrost > 0.0) {
    float fr = 0.0;
    vec2 fp;
    if (vPane.z > 0.0) {
      fp = vPane.xy;
      vec2 s = vPane.zw;
      vec2 e2 = min(fp, s - fp);
      float dE = min(e2.x, e2.y);
      // the nearest edge's frame: along it, and inward from it
      bool horiz = e2.y < e2.x;
      vec2 q = horiz ? vec2(fp.x, e2.y) : vec2(fp.y, e2.x);
      float side = horiz ? (fp.y < s.y * 0.5 ? 0.0 : 1.0) : (fp.x < s.x * 0.5 ? 2.0 : 3.0);
      float corner = exp(-length(e2) / 0.14);
      // it reaches furthest from the bottom (where condensation gathers) and the corners
      float reach = uFrost * (0.07 + 0.22 * exp(-fp.y / 0.3) + 0.32 * corner) * (0.65 + 0.7 * texture(uSnowNoise, vec2(q.x * 1.3, side * 0.37 + 0.1)).r);
      float t = dE / max(reach, 1e-3);
      float fern = frostFerns(q, side * 0.31 + s.x * 0.7 + s.y * 0.3);
      float ferns = smoothstep(0.0, 0.1, fern - 0.2 - 0.6 * t) * (1.0 - smoothstep(0.85, 1.35, t)) * (0.55 + 0.45 * fern);
      // once the fronds are finer than a pixel they would only sparkle as specks: show their
      // average, a soft white fan thinning toward its reach
      float fine = 1.0 - smoothstep(0.004, 0.016, length(fwidth(fp)));
      ferns = mix((1.0 - smoothstep(0.05, 1.0, t)) * 0.5, ferns, fine);
      fr = (1.0 - smoothstep(0.02, 0.16, t)) * 0.8 + ferns;
    } else {
      // no pane coordinates: a thin even rime in feathered patches
      fp = vec2(dot(vWorldPos.xz, vec2(-Ng.z, Ng.x)), vWorldPos.y);
      fr = smoothstep(0.62, 0.8, frostFerns(fp * 2.0, 0.37)) * uFrost * 0.5;
    }
    fr = clamp(fr, 0.0, 1.0);
    // a thin scattering layer: white, lit from both sides
    // white rime lit from both sides; the lamplight only warms it (keep it from turning orange)
    vec3 frostE = Eout * 0.55 + Ein * 0.9;
    frostE = mix(vec3(dot(frostE, vec3(0.2126, 0.7152, 0.0722))), frostE, 0.45);
    vec3 frostCol = vec3(0.86, 0.92, 0.98) * frostE * RECIPROCAL_PI;
    // ice crystals scatter mostly forward: the rime glows with whatever lies behind the pane (the
    // night sky and the aurora seen from the room, the lamplight seen from outside)
    vec3 behind = back ? textureCube(uSkyCube, -V).rgb : Ein * RECIPROCAL_PI;
    frostCol += vec3(0.88, 0.94, 1.0) * behind * (0.3 + 0.25 * fr);
    float fa = fr * 0.8;
    col = col * (1.0 - fa) + frostCol * fa;
    alpha = alpha + fa * (1.0 - alpha);
    // condensation: a faint haze and beads low on the pane
    if (vPane.z > 0.0) {
      float cz = (1.0 - smoothstep(0.0, 0.2, vPane.y)) * uFrost;
      float bead = step(0.93, snowHash(vec3(floor(vPane.xy * 260.0), 3.0)));
      float ca = cz * (0.07 + 0.1 * bead);
      col = col * (1.0 - ca) + (Eout * 0.3 + Ein) * RECIPROCAL_PI * 0.8 * ca;
      alpha = alpha + ca * (1.0 - alpha);
    }
  }

  // ---- snow lying on up-facing panes (roof glass), heaped against the lower frame
  if (uSnowAmt > 0.0 && Ng.y > 0.2) {
    float cov;
    if (vPane.z > 0.0) {
      // the warm glass sheds most of it: snow heaped on the lower frame, wedges along the glazing
      // bars, a cornice under the ridge, a few clumps stuck between (the middle stays clear for the sky)
      vec2 p = vPane.xy;
      vec2 s = vPane.zw;
      float amt = min(uSnowAmt, 2.0);
      float steep = 1.0 - smoothstep(0.25, 0.8, Ng.y);
      float heap = (0.08 + 0.1 * amt) * (0.55 + 0.9 * texture(uSnowNoise, vec2(p.x * 1.6, 0.31 + s.x)).r) * (1.0 - 0.5 * steep)
                 + (texture(uSnowNoise, vec2(p.x * 6.0, 0.77)).g - 0.5) * 0.035;
      float wedgeL = (0.02 + 0.03 * amt) * (0.3 + 1.3 * texture(uSnowNoise, vec2(p.y * 2.3, 0.53 + s.y)).r) * (1.0 - 0.6 * p.y / s.y);
      float wedgeR = (0.02 + 0.03 * amt) * (0.3 + 1.3 * texture(uSnowNoise, vec2(p.y * 2.3, 0.19 + s.y)).r) * (1.0 - 0.6 * p.y / s.y);
      float cornice = (0.04 + 0.06 * amt) * (0.4 + 1.1 * texture(uSnowNoise, vec2(p.x * 2.1, 0.67)).r);
      float dIn = min(min(p.y - heap, s.y - p.y - cornice), min(p.x - wedgeL, s.x - p.x - wedgeR));
      float aaS = fwidth(dIn) + 0.002;
      cov = 1.0 - smoothstep(-aaS, aaS, dIn);
      // a few clumps that stuck lower on the pane
      float crumb = texture(uSnowNoise, p * 0.9 + 0.3 + s * 0.1).r * 0.8 + texture(uSnowNoise, p * 4.0).g * 0.2;
      cov = max(cov, smoothstep(0.76, 0.78, crumb + 0.3 * (1.0 - p.y / s.y) - 0.24) * (1.0 - smoothstep(0.3, 0.5, p.y / s.y)) * 0.95 * (1.0 - steep));
      // thin at the rim: a little light comes through it
      cov *= mix(0.82, 1.0, smoothstep(0.004, 0.03, -dIn));
      cov *= smoothstep(0.15, 0.35, Ng.y) * uSnowCover * (1.0 - snowShelter(vWorldPos));
    } else {
      cov = snowCoverage(vWorldPos, Ng, uSnowAmt);
    }
    if (cov > 0.0) {
      vec3 alb = snowAlbedo(vWorldPos.xz);
      vec3 sc;
      if (!back) {
        sc = alb * Eout * RECIPROCAL_PI;
        sc += uLightColor * snowGlint(vWorldPos, Ng, V, L, length(cameraPosition - vWorldPos));
      } else {
        // from below: light through the snow, blue and soft, and the room's lamplight on its underside
        vec3 EinS = mix(vec3(dot(Ein, vec3(0.2126, 0.7152, 0.0722))), Ein, 0.35);
        sc = alb * (Eout * 0.07 * vec3(0.7, 0.85, 1.0) + EinS * 0.22) * RECIPROCAL_PI;
        // the sky behind glows through where the snow lies thin (its rim, the crumbs)
        float thin = vPane.z > 0.0 ? 1.0 - smoothstep(0.75, 1.0, cov) : 0.3;
        sc += textureCube(uSkyCube, -V).rgb * vec3(0.55, 0.75, 1.0) * (0.06 + 0.22 * thin);
      }
      col = mix(col, sc, cov);
      alpha = mix(alpha, 1.0, cov);
    }
  }

  gl_FragColor = vec4(col, alpha);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor );
  #endif
}
`;
