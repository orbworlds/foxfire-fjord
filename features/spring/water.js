/**
 * Hot-spring water: clear geothermal teal over dark rock. A MeshStandard
 * material (so the sky, the moon and the aurora mirror in it through the
 * environment map) patched with:
 *   - a fake basin: the bottom (dark gneiss, pale pebbles, rust-orange iron
 *     stains) seen through the water along a refracted ray, its depth growing
 *     from the rim to the middle, absorbed toward deep teal;
 *   - wind and convection ripples (noise normals) and rings where the
 *     trough's stream lands, with a little foam;
 *   - glints of the torches, ice lanterns and the hut window on the surface
 *     (they are not in the environment map), warm and stretched by ripples.
 */
import * as THREE from 'three';
import { POOL } from './layout.js';
export const MAX_GLINTS = 6;
export function createWaterMaterial(ctx, impact) {
    const mat = new THREE.MeshStandardMaterial({
        name: 'springWater',
        color: 0xffffff,
        roughness: 0.06,
        metalness: 0,
        envMapIntensity: 1.0,
    });
    mat.userData.snow = 0;
    const glints = Array.from({ length: MAX_GLINTS }, () => new THREE.Vector4());
    const uniforms = {
        uTime: ctx.shared.uTime,
        uNoise: { value: ctx.materials.noise },
        uImpact: { value: impact },
        uPool: { value: new THREE.Vector4(POOL.x, POOL.z, POOL.water, POOL.depth) },
        uGlints: { value: glints },
        uGlintCol: { value: new THREE.Color(1.0, 0.62, 0.3) },
        uAuroraLight: ctx.shared.uAuroraLight,
    };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec3 vWPos;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEdge = aEdge;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', 
        /* glsl */ `#include <common>
uniform float uTime;
uniform sampler2D uNoise;
uniform vec2 uImpact;
uniform vec4 uPool;
uniform vec4 uGlints[${MAX_GLINTS}];
uniform vec3 uGlintCol;
uniform vec3 uAuroraLight;
varying float vEdge;
varying vec3 vWPos;
float springH(vec2 p) {
  float t = uTime;
  float h = texture2D(uNoise, p * 0.21 + vec2(t * 0.012, t * 0.008)).r * 0.55;
  h += texture2D(uNoise, p * 0.57 - vec2(t * 0.021, -t * 0.015)).g * 0.3;
  h += texture2D(uNoise, p * 1.6 + vec2(-t * 0.034, t * 0.027)).b * 0.13;
  // convection: slow upwellings breaking the surface
  h += texture2D(uNoise, p * 0.11 + vec2(0.0, t * 0.004)).a * 0.25;
  float d = length(p - uImpact);
  h += 0.12 * sin(d * 30.0 - t * 7.0) * exp(-d * 1.4) * smoothstep(0.02, 0.12, d);
  h += 0.05 * sin(d * 17.0 - t * 3.7 + 1.3) * exp(-d * 0.8);
  return h;
}
vec3 springBottom(vec2 p) {
  // dark wet gneiss with pale pebbles and rusty iron stains (the spring's minerals)
  float n1 = texture2D(uNoise, p * 0.35).r;
  float n2 = texture2D(uNoise, p * 1.3 + 0.21).g;
  float n3 = texture2D(uNoise, p * 4.1 + 0.57).b;
  vec3 rock = mix(vec3(0.05, 0.055, 0.06), vec3(0.16, 0.16, 0.15), n1);
  float pebble = smoothstep(0.62, 0.78, n3) * smoothstep(0.35, 0.6, n2);
  rock = mix(rock, vec3(0.42, 0.41, 0.38), pebble * 0.7);
  float rust = smoothstep(0.55, 0.8, n2) * (0.5 + 0.5 * n1);
  rock = mix(rock, vec3(0.36, 0.17, 0.06), rust * 0.55);
  return rock;
}`)
            .replace('#include <map_fragment>', 
        /* glsl */ `#include <map_fragment>
// depth of the basin under this point: shallow shelf at the rim, deep in the middle
float sDepth = uPool.w * smoothstep(0.08, 0.85, vEdge) + 0.06;
vec3 sV = normalize(vWPos - cameraPosition);
// refracted ray into the water (n = 1.33), followed down to the bottom
vec3 sT = refract(sV, vec3(0.0, 1.0, 0.0), 0.75);
vec2 sBot = vWPos.xz + sT.xz / max(-sT.y, 0.2) * sDepth;
float sPath = sDepth / max(-sT.y, 0.2);
vec3 sAbs = exp(-vec3(1.25, 0.32, 0.36) * sPath);
vec3 sBottom = springBottom(sBot);
// caustics dancing on the bottom: bright creases of the refracted ripples
{
  float c1 = texture2D(uNoise, sBot * 0.9 + vec2(uTime * 0.03, uTime * 0.021)).r;
  float c2 = texture2D(uNoise, sBot * 1.3 - vec2(uTime * 0.025, -uTime * 0.034)).g;
  float caus = pow(1.0 - abs(c1 + c2 - 1.0), 10.0);
  sBottom *= 1.0 + caus * 1.6 * (1.0 - smoothstep(0.3, 1.1, sDepth));
}
// light scattered back by the water itself (and fine silica in it): teal
vec3 sScatter = vec3(0.02, 0.15, 0.15) * (1.0 - exp(-sPath * 0.9));
float dImp = length(vWPos.xz - uImpact);
float foam = smoothstep(0.26, 0.0, dImp) * (0.55 + 0.45 * texture2D(uNoise, vWPos.xz * 3.0 + vec2(uTime * 0.25, 0.0)).r);
diffuseColor.rgb = mix(sBottom * sAbs + sScatter, vec3(0.85, 0.92, 0.92), foam * 0.6);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.4, foam);`)
            .replace('#include <normal_fragment_begin>', 
        /* glsl */ `#include <normal_fragment_begin>
{
  vec2 p = vWPos.xz;
  float e = 0.04;
  float hx = springH(p + vec2(e, 0.0)) - springH(p - vec2(e, 0.0));
  float hz = springH(p + vec2(0.0, e)) - springH(p - vec2(0.0, e));
  float k = 0.06 / (2.0 * e);
  vec3 nW = normalize(vec3(-hx * k, 1.0, -hz * k));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`)
            .replace('#include <lights_fragment_end>', 
        /* glsl */ `#include <lights_fragment_end>
{
  // warm glints of the torches and lanterns (not in the environment map), smeared by the ripples
  vec3 gN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
  vec3 gV = normalize(cameraPosition - vWPos);
  vec3 gR = reflect(-gV, gN);
  float gF = 0.02 + 0.98 * pow(1.0 - saturate(dot(gN, gV)), 5.0);
  for (int i = 0; i < ${MAX_GLINTS}; i++) {
    vec4 g = uGlints[i];
    if (g.w <= 0.0) continue;
    vec3 L = g.xyz - vWPos;
    float dl = length(L);
    float c = dot(gR, L / dl);
    float lobe = pow(saturate(c), 260.0) * 14.0 + pow(saturate(c), 30.0) * 0.35;
    reflectedLight.indirectSpecular += uGlintCol * g.w * lobe * (0.35 + gF * 3.0) / (1.0 + dl * 0.15);
  }
}`);
    };
    mat.customProgramCacheKey = () => 'fox-springWater-v1';
    return { material: mat, glints };
}
