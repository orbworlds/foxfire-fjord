/**
 * Flora materials.
 *
 * One patched MeshStandardMaterial program draws every near tree and shrub
 * (all geometry samples the single flora atlas):
 *   - wind (vertex): aWind = (bend m, flutter m, phase, seed). Bend is a slow
 *     whole-tree sway along the wind, flutter a small tremble of the twig ends
 *     (snow-laden spruce boughs are stiff). Instanced copies take their phase
 *     from their position and scale the amplitudes with the instance scale.
 *   - bark (fragment): uv.y >= BARK_FLAG wraps fract(v) into the atlas bark
 *     band with textureGrad, so trunks tile without seams.
 *   - snow (fragment): the atlas' snow layer lies on the cards that face the
 *     sky (aSnow.x how much, aSnow.y = 1 for cards that show it from both
 *     faces; seen from below a bough shows its dark needles), bark collects it
 *     on its upper side, aSnow.x > 1 rimes the needles and twigs themselves.
 *     The snow is the ground's snow (core/snow.ts snowAlbedo), blue in sky
 *     light, glinting in the sun and the moon.
 *   - the aurora's light between environment refreshes (shared.uAuroraFill).
 *   - alpha coverage boost from the mip level so distant foliage keeps its mass.
 *   - a little light through the twigs and needles from the key light.
 * The matching MeshDepthMaterial repeats the vertex and alpha logic so shadows
 * sway and cut out exactly like the lit surface.
 *
 * Impostors are camera-facing billboards sampling a baked albedo/normal atlas
 * (see impostors.ts, which bakes the same snow); their depth material faces
 * the key light instead.
 */
import * as THREE from 'three';
import { SNOW_GLSL } from '../../core/snow.js';
/* ------------------------------------------------------------------ */
/* GLSL                                                                */
/* ------------------------------------------------------------------ */
const WIND_PARS = /* glsl */ `
attribute vec4 aWind;
attribute vec2 aSnow;
attribute float aHaze;
varying float vFloraHaze;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindScale;
#ifdef FLORA_SNOW
varying vec3 vFloraNw;
varying vec3 vFloraWp;
varying vec2 vFloraSnow;
#endif

vec3 floraWind(vec3 origin, float scale) {
  float s = uWindStrength * uWindScale;
  float ph = aWind.z + dot(origin.xz, vec2(0.0713, 0.0527));
  float t = uTime;
  float sway = 0.55 + 0.32 * sin(t * 0.83 + ph) + 0.13 * sin(t * 1.91 + ph * 1.7);
  float crossw = 0.28 * sin(t * 1.13 + ph * 0.61);
  vec3 dir = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 side = vec3(-uWindDir.y, 0.0, uWindDir.x);
  float bend = aWind.x * scale * s;
  vec3 off = dir * (bend * sway) + side * (bend * crossw);
  float fl = aWind.y * scale * (0.2 + s);
  float f = sin(t * 7.3 + aWind.w * 37.0 + ph) * 0.6 + sin(t * 11.9 + aWind.w * 91.0) * 0.4;
  off += vec3(dir.x * 0.35, 1.0, dir.z * 0.35) * (fl * f);
  return off;
}
`;
const WIND_PROJECT = /* glsl */ `
vec4 floraWp = vec4( transformed, 1.0 );
vec3 floraOrigin = vec3( 0.0 );
float floraScale = 1.0;
mat3 floraNm = mat3( modelMatrix );
#ifdef USE_INSTANCING
  floraWp = instanceMatrix * floraWp;
  floraOrigin = instanceMatrix[ 3 ].xyz;
  floraScale = length( instanceMatrix[ 0 ].xyz );
  floraNm = floraNm * mat3( instanceMatrix );
#endif
floraWp = modelMatrix * floraWp;
floraOrigin = ( modelMatrix * vec4( floraOrigin, 1.0 ) ).xyz;
#ifdef FLORA_WIND
  floraWp.xyz += floraWind( floraOrigin, floraScale );
#endif
#ifdef FLORA_SNOW
  vFloraNw = normalize( floraNm * objectNormal );
  vFloraWp = floraWp.xyz;
  vFloraSnow = aSnow;
#endif
vFloraHaze = aHaze;
vec4 mvPosition = viewMatrix * floraWp;
gl_Position = projectionMatrix * mvPosition;
`;
const WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = floraWp;
#endif
`;
const MAP_PARS = /* glsl */ `
uniform float uBarkV0;
uniform float uBarkVH;
uniform float uCoverage;
varying float vFloraHaze;
#ifdef FLORA_SNOW
uniform sampler2D uFloraSnowTex;
varying vec3 vFloraNw;
varying vec3 vFloraWp;
varying vec2 vFloraSnow;
#endif
`;
/** Bark wrap + coverage boost. Declares floraBark (1 on bark) and floraSnowPix for later chunks. */
const MAP_FRAGMENT = /* glsl */ `
float floraBark = 0.0;
float floraSnowPix = 0.0;
#ifdef USE_MAP
{
  vec2 fuv = vMapUv;
  vec2 fdx = dFdx( fuv );
  vec2 fdy = dFdy( fuv );
  if ( fuv.y > 9.0 ) {
    floraBark = 1.0;
    fuv.y = uBarkV0 + fract( fuv.y ) * uBarkVH;
    fdx.y *= uBarkVH;
    fdy.y *= uBarkVH;
  }
  vec4 floraTex = textureGrad( map, fuv, fdx, fdy );
  vec2 floraTs = vec2( textureSize( map, 0 ) );
  float floraRho = max( dot( fdx * floraTs, fdx * floraTs ), dot( fdy * floraTs, fdy * floraTs ) );
  float floraLod = 0.5 * log2( max( floraRho, 1e-8 ) );
  floraTex.a = min( 1.0, floraTex.a * ( 1.0 + max( floraLod, 0.0 ) * uCoverage ) );
  #ifdef FLORA_SNOW
  if ( vFloraHaze > 0.5 ) {
    // fine twigs: crisp up close; once they are thinner than a pixel their coverage is dithered
    // on screen, so a bare crown fades into a haze with distance
    float floraIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    float floraTh = mix( 0.45, mix( 0.08, 0.62, floraIgn ), smoothstep( 1.0, 2.5, floraLod ) );
    floraTex.a = floraTex.a > floraTh ? 1.0 : 0.0;
  }
  #endif
  diffuseColor *= floraTex;
  #ifdef FLORA_SNOW
    if ( floraBark < 0.5 ) floraSnowPix = textureGrad( uFloraSnowTex, fuv, fdx, fdy ).r;
  #endif
}
#endif
`;
/** Snow on the needles, twigs and bark (after the vertex colour so AO only half darkens it). */
const SNOW_FRAGMENT = /* glsl */ `
#include <color_fragment>
float floraSnowAmt = 0.0;
#ifdef FLORA_SNOW
{
  vec3 fNw = normalize( vFloraNw );
  float fCap = vFloraSnow.x;
  if ( floraBark > 0.5 ) {
    float fNz = texture( uSnowNoise, vFloraWp.xz * 1.7 + vFloraWp.y * 0.61 ).g;
    floraSnowAmt = smoothstep( 0.4, 0.78, fNw.y + ( fNz - 0.5 ) * 0.5 ) * min( fCap, 1.0 );
  } else {
    float fFace = vFloraSnow.y > 0.5 ? 1.0 : ( gl_FrontFacing ? 1.0 : 0.0 );
    // less snow = a smaller pillow (the mask's soft edge is its depth), not a paler one
    float fLess = 1.0 - min( fCap, 1.0 );
    float fM = smoothstep( 0.1 + fLess * 0.5, 0.45 + fLess * 0.4, floraSnowPix );
    floraSnowAmt = fM * step( 0.02, fCap ) * fFace;
    // rime and plastered snow: the needles and twigs themselves go white
    floraSnowAmt = max( floraSnowAmt, clamp( fCap - 1.0, 0.0, 1.0 ) * ( 0.6 + 0.4 * fM ) );
    // aSnow.x >= 3: a lump of snow (drift domes, the casing of a snow ghost)
    floraSnowAmt = max( floraSnowAmt, clamp( fCap - 2.0, 0.0, 1.0 ) );
  }
  floraSnowAmt *= uSnowCover;
  if ( floraSnowAmt > 0.0 ) {
    vec3 fSnow = snowAlbedo( vFloraWp.xz ) * mix( 0.78, 1.0, smoothstep( 0.25, 0.85, floraSnowPix + floraBark ) );
    #ifdef USE_COLOR
      fSnow *= mix( 1.0, vColor.r, 0.45 );
    #endif
    diffuseColor.rgb = mix( diffuseColor.rgb, fSnow, floraSnowAmt );
  }
}
#endif
`;
const TRANSLUCENCY = /* glsl */ `
#include <lights_fragment_begin>
#if defined( FLORA_TRANSLUCENT ) && ( NUM_DIR_LIGHTS > 0 )
{
  float floraLeaf = ( 1.0 - floraBark ) * ( 1.0 - floraSnowAmt );
  vec3 floraL = directLight.direction;
  float floraBack = pow( saturate( dot( -geometryViewDir, floraL ) ), 3.0 );
  float floraWrap = 0.5 + 0.5 * dot( -geometryNormal, floraL );
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( floraLeaf * uTranslucency * ( 0.35 * floraWrap + 1.6 * floraBack ) );
  #ifdef FLORA_SNOW
  if ( floraSnowAmt > 0.0 ) {
    // light through the snow softens the terminator; facets sparkle in the sun and the moon
    float sNdl = dot( geometryNormal, floraL );
    float sWrap = max( 0.0, ( sNdl + 0.4 ) / 1.4 ) - max( 0.0, sNdl );
    reflectedLight.directDiffuse += directLight.color * material.diffuseContribution * vec3( 0.86, 0.95, 1.08 ) * sWrap * 0.3 * floraSnowAmt;
    vec3 sLw = transformDirectionByInverseViewMatrix( floraL, viewMatrix );
    vec3 sVw = normalize( cameraPosition - vFloraWp );
    float sG = snowGlint( vFloraWp, normalize( vFloraNw ), sVw, sLw, length( cameraPosition - vFloraWp ) );
    reflectedLight.directSpecular += directLight.color * sG * floraSnowAmt * saturate( dot( normalize( vFloraNw ), sLw ) * 4.0 ) * 0.6;
  }
  #endif
}
#endif
`;
const INDIRECT = /* glsl */ `
#include <lights_fragment_end>
#ifdef FLORA_SNOW
// sky-lit snow is blue; the aurora's light between environment refreshes
reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 0.84, 0.94, 1.14 ), floraSnowAmt * 0.55 );
reflectedLight.indirectDiffuse += material.diffuseContribution * uAuroraFill * ( 0.5 + 0.5 * normalize( vFloraNw ).y ) * RECIPROCAL_PI;
#endif
`;
export function createPlantMaterials(atlas, shared, snow) {
    const uniforms = {
        uWindScale: { value: 1 },
        uCoverage: { value: 0.3 },
        uTranslucency: { value: 0.18 },
        uBarkV0: { value: atlas.barkBand.v0 },
        uBarkVH: { value: atlas.barkBand.vh },
        uFloraSnowTex: { value: atlas.snow },
    };
    const plant = new THREE.MeshStandardMaterial({
        map: atlas.texture,
        vertexColors: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0,
        envMapIntensity: 0.75,
    });
    plant.name = 'flora-plant';
    plant.defines = { FLORA_WIND: '', FLORA_TRANSLUCENT: '', FLORA_SNOW: '' };
    plant.userData.snow = 0;
    plant.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, snow, {
            uTime: shared.uTime,
            uWindDir: shared.uWindDir,
            uWindStrength: shared.uWindStrength,
            ...uniforms,
        });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
            .replace('#include <project_vertex>', WIND_PROJECT)
            .replace('#include <worldpos_vertex>', WORLDPOS);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${SNOW_GLSL}\n${MAP_PARS}\nuniform float uTranslucency;`)
            .replace('#include <map_fragment>', MAP_FRAGMENT)
            .replace('#include <color_fragment>', SNOW_FRAGMENT)
            .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'))
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( mix( roughnessFactor, 0.95, floraBark ), 0.82, floraSnowAmt );')
            .replace('#include <lights_fragment_begin>', TRANSLUCENCY)
            .replace('#include <lights_fragment_end>', INDIRECT);
    };
    plant.customProgramCacheKey = () => 'fox-flora-plant-1';
    const plantDepth = new THREE.MeshDepthMaterial();
    plantDepth.name = 'flora-plant-depth';
    plantDepth.defines = { FLORA_WIND: '' };
    plantDepth.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
            uTime: shared.uTime,
            uWindDir: shared.uWindDir,
            uWindStrength: shared.uWindStrength,
            ...uniforms,
        });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
            .replace('#include <project_vertex>', WIND_PROJECT);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${MAP_PARS}`).replace('#include <map_fragment>', MAP_FRAGMENT);
    };
    plantDepth.customProgramCacheKey = () => 'fox-flora-plant-depth-1';
    return { plant, plantDepth, uniforms };
}
/* ------------------------------------------------------------------ */
/* Impostors                                                           */
/* ------------------------------------------------------------------ */
/** Max templates the impostor uniforms hold. */
export const IMP_MAX_TEMPLATES = 12;
/** Elevation of the last baked column (radians); columns are evenly spaced from 0. */
export const IMP_TOP_ELEVATION = THREE.MathUtils.degToRad(80);
export const IMP_COLUMNS = 4;
const IMP_VERTEX_PARS = /* glsl */ `
attribute vec3 aImp;
uniform vec4 uImpGeo[ ${IMP_MAX_TEMPLATES} ];
uniform vec2 uImpCells;
uniform float uImpSlotsX;
uniform float uImpInset;
uniform vec3 uNearCenter;
uniform float uNearR;
uniform vec4 uNearPlanes[ 6 ];
uniform vec3 uLightDir;
uniform vec3 uViewPos;
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying float vImpT;
varying float vImpTint;
#ifndef IMP_DEPTH
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
uniform float uShadowPush;
#endif
`;
/**
 * Billboard: aImp = (template, flip, tint). uImpGeo[t] = (center height,
 * radius, max distance, unused) in template units (scaled by the instance).
 */
const IMP_PROJECT = /* glsl */ `
vec3 impBase = instanceMatrix[ 3 ].xyz;
float impS = length( instanceMatrix[ 0 ].xyz );
int impT = int( aImp.x + 0.5 );
vec4 impGeo = uImpGeo[ impT ];
vec3 impC = impBase + vec3( 0.0, impGeo.x * impS, 0.0 );
float impRad = impGeo.y * impS;
#ifdef IMP_DEPTH
  vec3 impF = normalize( uLightDir );
#else
  vec3 impF = normalize( cameraPosition - impC );
#endif
vec3 impRr = vec3( impF.z, 0.0, -impF.x );
if ( dot( impRr, impRr ) < 1e-8 ) impRr = vec3( 1.0, 0.0, 0.0 );
vec3 impRt = normalize( impRr );
vec3 impUp = cross( impF, impRt );
vec3 impP = impC + ( impRt * position.x + impUp * position.y ) * ( 2.0 * impRad );

bool impHide = distance( uViewPos, impC ) > impGeo.z;
if ( distance( impC, uNearCenter ) < uNearR ) {
  bool impIn = true;
  for ( int i = 0; i < 6; i ++ ) {
    if ( dot( uNearPlanes[ i ].xyz, impC ) + uNearPlanes[ i ].w < -impRad ) impIn = false;
  }
  if ( impIn ) impHide = true;
}

float impEl = asin( clamp( impF.y, 0.0, 1.0 ) );
float impCol = clamp( impEl / ${(IMP_TOP_ELEVATION / (IMP_COLUMNS - 1)).toFixed(6)}, 0.0, ${(IMP_COLUMNS - 1).toFixed(1)} );
float impC0 = floor( impCol );
float impC1 = min( impC0 + 1.0, ${(IMP_COLUMNS - 1).toFixed(1)} );
vImpT = impCol - impC0;
vImpTint = aImp.z;
vec2 impCellUv = vec2( mix( uv.x, 1.0 - uv.x, aImp.y ), uv.y );
impCellUv = mix( vec2( uImpInset ), vec2( 1.0 - uImpInset ), impCellUv );
float impSlotX = mod( float( impT ), uImpSlotsX ) * ${IMP_COLUMNS.toFixed(1)};
float impSlotY = floor( float( impT ) / uImpSlotsX );
vImpUv0 = ( vec2( impSlotX + impC0, impSlotY ) + impCellUv ) / uImpCells;
vImpUv1 = ( vec2( impSlotX + impC1, impSlotY ) + impCellUv ) / uImpCells;

vec4 floraWp = vec4( impP, 1.0 );
vec4 mvPosition = viewMatrix * floraWp;
gl_Position = projectionMatrix * mvPosition;
if ( impHide ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );

#ifndef IMP_DEPTH
  float impFlip = aImp.y > 0.5 ? -1.0 : 1.0;
  vImpR = normalize( ( viewMatrix * vec4( impRt, 0.0 ) ).xyz ) * impFlip;
  vImpU = normalize( ( viewMatrix * vec4( impUp, 0.0 ) ).xyz );
  vImpF = normalize( ( viewMatrix * vec4( impF, 0.0 ) ).xyz );
  transformedNormal = vImpF;
  vNormal = vImpF;
#endif
`;
const IMP_WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = floraWp;
  worldPosition.xyz += normalize( uLightDir ) * ( uShadowPush * impRad );
#endif
`;
const IMP_FRAGMENT_PARS = /* glsl */ `
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying float vImpT;
varying float vImpTint;
uniform float uCoverage;
#ifndef IMP_DEPTH
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
uniform sampler2D uNormalAtlas;
uniform float uTranslucency;
uniform vec3 uAuroraFill;
#endif
`;
const IMP_MAP_FRAGMENT = /* glsl */ `
float impDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
vec2 impUv = impDither < vImpT ? vImpUv1 : vImpUv0;
vec2 impGx = dFdx( vImpUv0 );
vec2 impGy = dFdy( vImpUv0 );
#ifdef USE_MAP
{
  vec4 impAlb = textureGrad( map, impUv, impGx, impGy );
  impAlb.rgb /= max( impAlb.a, 1e-3 );
  vec2 impTs = vec2( textureSize( map, 0 ) );
  float impRho = max( dot( impGx * impTs, impGx * impTs ), dot( impGy * impTs, impGy * impTs ) );
  float impLod = 0.5 * log2( max( impRho, 1e-8 ) );
  impAlb.a = min( 1.0, impAlb.a * ( 1.0 + max( impLod, 0.0 ) * uCoverage ) );
  #ifndef IMP_DEPTH
    // soft coverage dithered against a screen-space pattern: a haze of bare twigs, soft spruce edges
    float impIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + 17.0, vec2( 0.06711056, 0.00583715 ) ) ) );
    impAlb.a = impAlb.a > mix( 0.22, 0.78, impIgn ) ? 1.0 : 0.0;
  #endif
  diffuseColor *= impAlb;
}
#endif
diffuseColor.rgb *= vImpTint;
float impSnow = smoothstep( 0.3, 0.65, dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) );
`;
const IMP_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec4 impNt = textureGrad( uNormalAtlas, impUv, impGx, impGy );
vec3 impN = ( impNt.rgb / max( impNt.a, 1e-3 ) ) * 2.0 - 1.0;
vec3 normal = normalize( vImpR * impN.x + vImpU * impN.y + vImpF * max( impN.z, 0.05 ) );
vec3 nonPerturbedNormal = normal;
`;
const IMP_TRANSLUCENCY = /* glsl */ `
#include <lights_fragment_begin>
#if NUM_DIR_LIGHTS > 0
{
  vec3 impL = directLight.direction;
  float impBack = pow( saturate( dot( -geometryViewDir, impL ) ), 3.0 );
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( uTranslucency * ( 1.0 - impSnow ) * ( 0.12 + 1.2 * impBack ) );
}
#endif
`;
const IMP_INDIRECT = /* glsl */ `
#include <lights_fragment_end>
// the baked snow (bright texels) is blue in sky light; the aurora's light between environment refreshes
reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 0.84, 0.94, 1.14 ), impSnow * 0.55 );
reflectedLight.indirectDiffuse += material.diffuseContribution * uAuroraFill * 0.8 * RECIPROCAL_PI;
`;
export function createImpostorMaterials(albedo, normal, shared) {
    const geo = [];
    for (let i = 0; i < IMP_MAX_TEMPLATES; i++)
        geo.push(new THREE.Vector4(1, 1, 1e9, 0));
    const planes = [];
    for (let i = 0; i < 6; i++)
        planes.push(new THREE.Vector4(0, 0, 0, 0));
    const uniforms = {
        uImpGeo: { value: geo },
        uImpCells: { value: new THREE.Vector2(8, 5) },
        uImpSlotsX: { value: 2 },
        uImpInset: { value: 0.004 },
        uNearCenter: { value: new THREE.Vector3(1e9, 0, 0) },
        uViewPos: { value: new THREE.Vector3() },
        uNearR: { value: 0 },
        uNearPlanes: { value: planes },
        uShadowPush: { value: 0.85 },
        uNormalAtlas: { value: normal },
        uCoverage: { value: 0.35 },
        uTranslucency: { value: 0.12 },
    };
    const material = new THREE.MeshStandardMaterial({
        map: albedo,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.86,
        metalness: 0,
        envMapIntensity: 0.65,
    });
    material.name = 'flora-impostor';
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, { uLightDir: shared.uLightDir, uAuroraFill: shared.uAuroraFill, ...uniforms });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${IMP_VERTEX_PARS}`)
            .replace('#include <project_vertex>', IMP_PROJECT)
            .replace('#include <worldpos_vertex>', IMP_WORLDPOS);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${IMP_FRAGMENT_PARS}`)
            .replace('#include <map_fragment>', IMP_MAP_FRAGMENT)
            .replace('#include <normal_fragment_begin>', IMP_NORMAL)
            .replace('#include <lights_fragment_begin>', IMP_TRANSLUCENCY)
            .replace('#include <lights_fragment_end>', IMP_INDIRECT);
    };
    material.userData.snow = 0;
    material.customProgramCacheKey = () => 'fox-flora-impostor-1';
    const depth = new THREE.MeshDepthMaterial();
    depth.name = 'flora-impostor-depth';
    depth.defines = { IMP_DEPTH: '' };
    depth.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, { uLightDir: shared.uLightDir, ...uniforms });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${IMP_VERTEX_PARS}`)
            .replace('#include <project_vertex>', IMP_PROJECT);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${IMP_FRAGMENT_PARS}`)
            .replace('#include <map_fragment>', IMP_MAP_FRAGMENT);
    };
    depth.customProgramCacheKey = () => 'fox-flora-impostor-depth-1';
    return { material, depth, uniforms };
}
