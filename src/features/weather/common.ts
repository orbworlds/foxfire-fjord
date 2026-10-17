/**
 * Shared bits of the weather's particle shaders: hashes, the light a snow
 * crystal or a wisp of fog receives (sky and horizon fill, the key light with
 * a forward-scattering lobe, the aurora's green wash), terrain and plane soft
 * fades, and the uniforms that bind them by reference to `shared`.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { HOUSE } from '../../world/layout';

export const WX_COMMON = /* glsl */ `
float wxHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
vec3 wxHash3(float n) { return fract(sin(vec3(n, n + 1.731, n + 3.917) * vec3(12.9898, 78.233, 37.719)) * 43758.5453); }

// sky fill seen by a small particle or a wisp of fog: the zenith, the (greyed) horizon all round and
// the bounce off the snow below, plus the aurora's wash
vec3 wxAmbient() {
  float hz = dot(uHorizonColor, vec3(0.2126, 0.7152, 0.0722));
  return uSkyColor * 0.6 + mix(uHorizonColor, vec3(hz), 0.5) * 0.9 + uAuroraLight * 0.32;
}

// the key light (sun by day, moon by night) scattered toward the eye; mu = cos(angle between view ray and light)
vec3 wxKey(float mu, float forward, float sharp) {
  float lobe = pow(max(mu, 0.0), sharp);
  return uLightColor * (0.22 + forward * lobe + 0.05 * max(-mu, 0.0));
}
`;

/** GLSL uniform declarations for WX_COMMON (put before it) */
export const WX_COMMON_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAuroraLight;
uniform vec3 uAuroraDir;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uNight;
`;

/** the shared uniform objects WX_COMMON_PARS declares (bound by reference) */
export function sharedUniforms(ctx: FeatureContext): Record<string, THREE.IUniform> {
  const s = ctx.shared;
  return {
    uTime: s.uTime,
    uSkyColor: s.uSkyColor,
    uHorizonColor: s.uHorizonColor,
    uLightDir: s.uLightDir,
    uLightColor: s.uLightColor,
    uAuroraLight: s.uAuroraLight,
    uAuroraDir: s.uAuroraDir,
    uWindDir: s.uWindDir,
    uWindStrength: s.uWindStrength,
    uNight: s.uNight,
  };
}

/**
 * Terrain soft fade: the baked height texture of the island, so big sprites
 * fade out where they would cut into a slope instead of showing a hard line.
 */
export const WX_TERRAIN_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform vec4 uHeightXf; // x0, z0, 1/width, 1/depth
float wxGround(vec2 xz) {
  return texture2D(uHeightTex, (xz - uHeightXf.xy) * uHeightXf.zw).r;
}
// fade toward zero as p nears the ground (or a flat plane at y0) along the ray from the camera
float wxPlaneFade(vec3 p, float y0, float soft) {
  vec3 d = p - cameraPosition;
  float dist = length(d);
  float vy = d.y / max(dist, 1e-4);
  if (vy > -1e-4) return 1.0;
  float tPlane = (cameraPosition.y - y0) / -vy;
  return smoothstep(0.0, soft, tPlane - dist);
}
`;

export function terrainUniforms(ctx: FeatureContext): Record<string, THREE.IUniform> {
  const b = ctx.world.bounds;
  return {
    uHeightTex: { value: ctx.world.heightTexture },
    uHeightXf: { value: new THREE.Vector4(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ)) },
  };
}

/** pixels per metre at 1 m depth for the current camera and drawing buffer */
export function pixelScale(ctx: FeatureContext): number {
  const h = ctx.renderer.domElement.height;
  return h / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
}

const C = HOUSE.cabin;
const Wg = HOUSE.wing;

/** indoors(worldPos): 1 under the cabin's or the glass wing's roof, so weather particles stay outside. */
export const INDOORS_GLSL = /* glsl */ `
// under the cabin's or the glass wing's roof (house-local)
float indoors(vec3 w) {
  vec3 l = w - vec3(${HOUSE.x.toFixed(2)}, ${HOUSE.floorY.toFixed(2)}, ${HOUSE.z.toFixed(2)});
  float inC = step(${(C.minX - 0.4).toFixed(2)}, l.x) * step(l.x, ${(C.maxX + 0.4).toFixed(2)}) * step(${(C.minZ - 0.4).toFixed(2)}, l.z) * step(l.z, ${(C.maxZ + 0.4).toFixed(2)});
  float rc = ${C.ridgeH.toFixed(2)} + 0.6 - ${(C.ridgeH - C.wallH).toFixed(2)} * abs(l.z - ${((C.minZ + C.maxZ) / 2).toFixed(2)}) / ${((C.maxZ - C.minZ) / 2).toFixed(2)};
  float inW = step(${(Wg.minX - 0.3).toFixed(2)}, l.x) * step(l.x, ${(Wg.maxX + 0.3).toFixed(2)}) * step(${(Wg.minZ - 0.3).toFixed(2)}, l.z) * step(l.z, ${(Wg.maxZ + 0.3).toFixed(2)});
  float rw = ${Wg.ridgeH.toFixed(2)} + 0.5 - ${(Wg.ridgeH - Wg.wallH).toFixed(2)} * abs(l.x - ${((Wg.minX + Wg.maxX) / 2).toFixed(2)}) / ${((Wg.maxX - Wg.minX) / 2).toFixed(2)};
  return max(inC * step(l.y, rc), inW * step(l.y, rw)) * step(-0.8, l.y);
}
`;
