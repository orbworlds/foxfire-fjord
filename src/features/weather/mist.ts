/**
 * Low mist that lies on flat water and ice: the ice fog that settles on
 * Mirror Lake on still, bitter nights, and the sea smoke that streams off
 * the fjord's open leads at dawn when air far colder than the sea flows over
 * it. Both are trains of soft sprites standing on a plane (the ice, sea
 * level): each starts near its own base point, drifts downwind, swells and
 * fades, and is reborn a little elsewhere. The sprites turn about the vertical
 * only, and lie down into flat sheets when seen from high above; their feet
 * fade analytically where the view ray meets the plane (and where they would
 * cut into a shore), so no hard edges show.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { WX_COMMON, WX_COMMON_PARS, WX_TERRAIN_GLSL, sharedUniforms, terrainUniforms } from './common';

export interface MistStyle {
  name: string;
  /** lifetime range (s) */
  life: [number, number];
  /** sprite width range at birth / death (m) */
  width: [number, number];
  /** sprite height range (m) */
  height: [number, number];
  /** drift speed along the wind (m/s at full strength) */
  drift: number;
  /** rise speed of the sprite's foot (m/s) */
  rise: number;
  /** random rebirth offset round the base point (m) */
  jitter: number;
  opacity: number;
  /** 0: a layer (horizontal streaks, densest at the foot), 1: wisps (vertical streaks, rising) */
  wisps: number;
  /** lie down into flat sheets when seen from above */
  flatten: boolean;
  /** soft fade distance where the view ray meets the plane (m) */
  soft: number;
  /** near-camera fade distances (m) */
  near: [number, number];
}

export interface MistBase {
  x: number;
  y: number;
  z: number;
  /** relative density */
  k: number;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WX_COMMON_PARS}
attribute vec4 aBase;  // x, plane y, z, strength
attribute vec4 aSeed;
uniform vec2 uLife;
uniform vec4 uSize;    // width birth, width death, height min, height max
uniform float uDrift;
uniform float uRise;
uniform float uJitter;
uniform float uLevel;
uniform float uFlatten;
uniform float uWisps;
uniform vec2 uNear;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec3 vSeed;   // noise offset, plane y
${WX_COMMON}

void main() {
  float life = mix(uLife.x, uLife.y, aSeed.y);
  float tt = uTime / life + aSeed.x;
  float ph = fract(tt);
  float cyc = floor(tt) + aSeed.z * 53.0;
  vec3 j = wxHash3(cyc * 2.31 + aSeed.w * 17.0);
  vec3 wdir = vec3(uWindDir.x, 0.0, uWindDir.y);
  float age = ph * life;
  float y0 = aBase.y;
  vec3 c = vec3(aBase.x, y0, aBase.z) + vec3(j.x - 0.5, 0.0, j.y - 0.5) * uJitter + wdir * uDrift * (0.4 + uWindStrength) * age;
  c.y += uRise * age;
  float width = mix(uSize.x, uSize.y, ph) * (0.7 + 0.6 * j.z);
  float height = mix(uSize.z, uSize.w, j.x) * (0.75 + 0.5 * ph);

  vec3 toCam = cameraPosition - c;
  float dist = length(toCam);
  vec2 hz = toCam.xz / max(length(toCam.xz), 1e-3);
  vec3 f = vec3(hz.x, 0.0, hz.y);
  // the camera's right as seen from the sprite (keeps the quad's winding front-facing)
  vec3 right = vec3(f.z, 0.0, -f.x);
  float k = uFlatten * smoothstep(0.16, 0.5, toCam.y / max(dist, 1e-3));
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), f, k));
  float hh = mix(height, width * 0.8, k);
  // rising wisps lean downwind
  float lean = uWisps * 0.45 * (0.3 + uWindStrength);
  vec3 wp = c + right * position.x * width + up * (position.y + 0.5) * hh + wdir * (lean * (position.y + 0.5) * (position.y + 0.5) * hh);
  // lying flat: centre the sheet on the base point, a little above the plane
  wp += vec3(0.0, k * 0.8, 0.0) - f * (k * hh * 0.5);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vWorld = wp;
  vUv = position.xy * 2.0;
  vSeed = vec3(aSeed.w * 7.1 + cyc * 0.131, aSeed.z * 3.7, y0);

  float env = smoothstep(0.0, 0.22, ph) * (1.0 - smoothstep(0.55, 1.0, ph));
  vAlpha = env * aBase.w * uLevel * (0.55 + 0.45 * j.z) * smoothstep(uNear.x, uNear.y, dist);
  if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec3 V = normalize(c - cameraPosition);
  float mu = dot(V, uLightDir);
  // the aurora overhead glows through the mist toward it
  float ma = max(dot(V, uAuroraDir), 0.0);
  vec3 col = wxAmbient() + wxKey(mu, 1.6, 6.0) * 0.9 + uAuroraLight * (0.5 * ma * ma);
  // many bounces inside the mist wash out the horizon's tint a little
  vColor = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.7) * 0.85;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform float uWisps;
uniform float uSoft;
${WX_TERRAIN_GLSL}
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec3 vSeed;
void main() {
  float x = vUv.x;
  float y = vUv.y * 0.5 + 0.5;
  // layer: wide and densest at the foot; wisps: columns that fray and thin toward the top
  float layer = (1.0 - smoothstep(0.35, 1.0, abs(x))) * exp(-y * 2.4) * (1.0 - smoothstep(0.75, 1.0, y));
  float wisp = (1.0 - smoothstep(0.1, 1.0, abs(x) * (1.0 - 0.3 * y))) * smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.45, 1.0, y));
  float shape = mix(layer, wisp, uWisps);
  // big soft lumps (one or two across a sprite), finer curls inside; layers streak sideways, wisps upward
  vec2 sc = mix(vec2(0.06, 0.22), vec2(0.2, 0.06), uWisps);
  vec2 nq = vec2(x, y) * sc + vSeed.xy + vec2(uTime * 0.004, -uTime * 0.012 * uWisps);
  float n1 = texture2D(uNoise, nq).r;
  float n2 = texture2D(uNoise, nq * 1.7 + 0.41).g;
  float n = clamp(0.45 + 1.6 * (n1 - 0.5) + 0.8 * (n2 - 0.5), 0.0, 1.0);
  // wisps break into tendrils
  n = mix(n, smoothstep(0.3, 0.75, n), uWisps);
  float a = min(0.9, shape * n * vAlpha * uOpacity);
  float y0 = vSeed.z;
  a *= wxPlaneFade(vWorld, y0, uSoft);
  a *= smoothstep(0.0, 1.2, vWorld.y - max(wxGround(vWorld.xz), y0) + 0.3);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}
`;

export class Mist {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(ctx: FeatureContext, style: MistStyle, bases: MistBase[], seed = 1) {
    const rnd = mulberry32(seed);
    const n = bases.length;
    const base = new Float32Array(n * 4);
    const sd = new Float32Array(n * 4);
    const box = new THREE.Box3();
    bases.forEach((b, i) => {
      base.set([b.x, b.y, b.z, b.k], i * 4);
      sd.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      box.expandByPoint(new THREE.Vector3(b.x, b.y, b.z));
    });
    const reach = style.drift * 1.5 * style.life[1] + style.width[1] + style.jitter;
    box.expandByVector(new THREE.Vector3(reach, 0, reach));
    box.max.y += style.height[1] * 1.6 + style.rise * style.life[1];
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4));
    geo.instanceCount = n;
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    this.material = new THREE.ShaderMaterial({
      name: style.name,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uLife: { value: new THREE.Vector2(...style.life) },
          uSize: { value: new THREE.Vector4(style.width[0], style.width[1], style.height[0], style.height[1]) },
          uDrift: { value: style.drift },
          uRise: { value: style.rise },
          uJitter: { value: style.jitter },
          uLevel: { value: 1 },
          uFlatten: { value: style.flatten ? 1 : 0 },
          uNear: { value: new THREE.Vector2(...style.near) },
          uOpacity: { value: style.opacity },
          uWisps: { value: style.wisps },
          uSoft: { value: style.soft },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    Object.assign(this.material.uniforms, sharedUniforms(ctx), terrainUniforms(ctx), { uNoise: { value: ctx.materials.noise } });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = style.name;
    this.mesh.renderOrder = 3;
    this.mesh.raycast = () => {};
    this.mesh.visible = n > 0;
  }

  get count(): number {
    return (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
  }

  update(level: number): void {
    this.mesh.visible = level > 0.004 && this.count > 0;
    this.material.uniforms.uLevel.value = level;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
