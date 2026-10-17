/**
 * Diamond dust: tiny ice plates and columns hanging in the still, bitter air
 * of a clear night (or a cold sunny noon). Each crystal is a mirror a few
 * tenths of a millimetre across that tumbles as it sinks, so it only shows
 * for an instant, when a facet swings through the angle that throws a light
 * into the eye: the moon (or the low sun), the aurora and the lamps near the
 * cabin. Toward the light the crystals forward-scatter it, so the glitter
 * thickens there and along the 22-degree halo. Drawn as additive star-shaped
 * points in two boxes wrapped round the camera; the brightest flashes bloom.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { INDOORS_GLSL, WX_COMMON, WX_COMMON_PARS, sharedUniforms } from './common';
import { LAMP_GLSL, type LampSet } from './lamps';

const LAYERS = [
  { box: [14, 10, 14], share: 0.65, inner: 0 },
  { box: [42, 20, 42], share: 0.35, inner: 6 },
];
/** offsets wrap at 8x the least common multiple of the box sizes (heights 10/20, widths 14/42) */
const WRAP_Y = 8 * 20;
const WRAP_XZ = 8 * 42;

const VERT = /* glsl */ `
${WX_COMMON_PARS}
${LAMP_GLSL}
attribute vec4 aSeed;
attribute vec4 aBox;
uniform vec3 uCam;
uniform vec3 uOff;
uniform float uDensity;
uniform float uPx;
uniform float uGain;
uniform float uExposure;
varying vec2 vUv;
varying vec3 vColor;
varying float vStar;
${WX_COMMON}
${INDOORS_GLSL}

void main() {
  float r = aSeed.w;
  float keep = step(fract(r * 5.17 + 0.31), uDensity);
  float s = (6.0 + floor(r * 4.999)) / 8.0;
  vec3 box = aBox.xyz;
  vec3 p = aSeed.xyz * box + vec3(uOff.x, -uOff.y, uOff.z) * s;
  vec3 rel = mod(p - uCam + 0.5 * box, box) - 0.5 * box;
  float ph = r * 47.0;
  rel += vec3(sin(uTime * 0.31 + ph), sin(uTime * 0.23 + ph * 1.7) * 0.5, cos(uTime * 0.27 + ph * 0.7)) * 0.12;
  // most of the dust hangs low, round and below the eye (seen against the snow rather than among the stars)
  vec3 wp = uCam + rel - vec3(0.0, 1.5, 0.0);
  float dh = length(rel.xz) / (0.5 * box.x);
  float dv = abs(rel.y) / (0.5 * box.y);
  float fade = (1.0 - smoothstep(0.6, 0.97, dh)) * (1.0 - smoothstep(0.6, 0.97, dv)) * keep;
  float dist = length(wp - uCam);
  fade *= aBox.w > 0.0 ? smoothstep(aBox.w * 0.7, aBox.w, dist) : smoothstep(0.35, 1.2, dist);
  fade *= 1.0 - indoors(wp);

  // every crystal tumbles: a facet flashes when it turns through the mirror angle between a light and
  // the eye. For random orientations that chance is the same in every direction, so each crystal gets
  // its own flash rhythm, and the light it can throw is what decides how bright the flash is.
  float w1 = 1.3 + 2.6 * fract(r * 9.13);
  float w2 = 0.7 + 1.9 * fract(r * 4.71);
  float f1 = pow(max(sin(uTime * w1 + ph), 0.0), 16.0);
  float f2 = pow(max(sin(uTime * w2 + ph * 2.3 + 1.7), 0.0), 120.0);
  float flash = f1 + 2.2 * f2;
  vec3 V = normalize(cameraPosition - wp);
  float mu = dot(-V, uLightDir);
  // toward the light the crystals refract it forward (and ring it with the 22-degree halo)
  float fwd = 1.0 + 5.0 * pow(max(mu, 0.0), 10.0) + 2.0 * exp(-pow((acos(clamp(mu, -1.0, 1.0)) - 0.384) / 0.02, 2.0));
  vec3 e = uLightColor * (flash * fwd + 0.025);
  // the aurora's glow, green flashes
  e += uAuroraLight * 30.0 * f2;
  // nearby lamps: warm flashes, denser close to the lamp
  e += wxLamps(wp) * (flash * 2.5 + 0.02);
  // a touch of colour from refraction
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * cos(6.2831 * (r * 3.0 + vec3(0.0, 0.33, 0.67))), 0.3);
  vec3 col = e * tint * uGain * fade;
  // at most a few display units, whatever the light (by day, against bright snow and sky, fewer still)
  float lum = dot(col, vec3(0.3, 0.6, 0.1));
  col *= min(1.0, mix(6.0, 2.0, 1.0 - uNight) / max(lum * uExposure, 1e-5));
  lum = dot(col, vec3(0.3, 0.6, 0.1)) * uExposure;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // brighter sparkles draw bigger (with a cross); faint ones are 1.5 px points
  float big = smoothstep(0.4, 4.0, lum);
  float sizePx = 1.6 + 6.0 * big;
  float depth = max(-mv.z, 0.05);
  float hs = 0.5 * sizePx * depth / uPx;
  mv.xy += position.xy * 2.0 * hs;
  gl_Position = projectionMatrix * mv;
  if (lum < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = position.xy * 2.0;
  vStar = big;
  // energy of a 1.6 px point regardless of the sprite size
  vColor = col * (1.6 * 1.6) / (sizePx * sizePx) * (1.0 + 2.0 * big);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vStar;
void main() {
  vec2 q = vUv;
  float r2 = dot(q, q);
  float core = exp(-r2 * 7.0);
  float arms = (exp(-abs(q.x) * 14.0) * exp(-q.y * q.y * 2.5) + exp(-abs(q.y) * 14.0) * exp(-q.x * q.x * 2.5)) * vStar;
  float a = core + 0.7 * arms;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export class DiamondDust {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private off = new THREE.Vector3();

  constructor(
    private ctx: FeatureContext,
    lamps: LampSet,
    count: number,
  ) {
    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.setCount(count);
    this.material = new THREE.ShaderMaterial({
      name: 'diamondDust',
      uniforms: {
        ...sharedUniforms(ctx),
        ...lamps.uniforms,
        uCam: { value: new THREE.Vector3() },
        uOff: { value: this.off },
        uDensity: { value: 1 },
        uPx: { value: 600 },
        uGain: { value: 4 },
        uExposure: ctx.shared.uExposure,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'diamond-dust';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.raycast = () => {};
  }

  setCount(count: number): void {
    const n = Math.max(0, Math.round(count));
    const rnd = mulberry32(9133);
    const seed = new Float32Array(n * 4);
    const box = new Float32Array(n * 4);
    let i = 0;
    for (const L of LAYERS) {
      const m = L === LAYERS[LAYERS.length - 1] ? n - i : Math.round(n * L.share);
      for (let k = 0; k < m && i < n; k++, i++) {
        seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
        box.set([L.box[0], L.box[1], L.box[2], L.inner], i * 4);
      }
    }
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    this.geo.setAttribute('aBox', new THREE.InstancedBufferAttribute(box, 4));
    this.geo.instanceCount = n;
  }

  /** level 0..1 = how much dust hangs in the air */
  update(dt: number, level: number, pxScale: number): void {
    const vis = level > 0.004;
    this.mesh.visible = vis;
    if (!vis) return;
    const u = this.material.uniforms;
    const sh = this.ctx.shared;
    const wind = 0.15 + 0.6 * sh.uWindStrength.value;
    const fall = 0.08;
    this.off.x = (this.off.x + sh.uWindDir.value.x * wind * dt) % WRAP_XZ;
    this.off.y = (this.off.y + fall * dt) % WRAP_Y;
    this.off.z = (this.off.z + sh.uWindDir.value.y * wind * dt) % WRAP_XZ;
    (u.uCam.value as THREE.Vector3).copy(this.ctx.camera.position);
    u.uDensity.value = Math.min(1, level * 1.2);
    u.uPx.value = pxScale;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
