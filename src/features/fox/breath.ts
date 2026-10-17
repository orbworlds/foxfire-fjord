/**
 * Breath in the frost: little puffs of vapour from an animal's nose, one per
 * exhale, drifting forward and up as they fade. A handful of camera-facing
 * quads attached to the head bone, animated entirely in the vertex shader.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';

const VERT = /* glsl */ `
attribute vec2 aSeed;
uniform float uTime;
uniform float uPeriod;
uniform float uSize;
uniform vec3 uDir;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = position.xy + 0.5;
  // each puff belongs to one exhale; puffs of the same breath spread a little
  float t = fract(uTime / uPeriod + aSeed.x * 0.18);
  float exhale = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 1.0, t));
  vec3 p = uDir * (0.02 + t * uSize * 2.2) + vec3(0.0, t * uSize * 0.6, 0.0);
  p.x += (aSeed.y - 0.5) * t * uSize * 1.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float s = uSize * (0.35 + 1.3 * sqrt(t));
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
  vA = exhale * (1.0 - t) * 0.55;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSkyColor;
uniform vec3 uAuroraLight;
uniform vec3 uLightColor;
uniform float uVis;
varying vec2 vUv;
varying float vA;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA * uVis;
  if (a < 0.003) discard;
  vec3 col = uSkyColor * 1.2 + uAuroraLight * 0.6 + uLightColor * 0.15;
  gl_FragColor = vec4(col, a);
}
`;

/** Vapour puffs at `nose` (in the bone's space), blown along `dir`. `size` ~ the puff radius (m). */
export function buildBreath(ctx: FeatureContext, nose: THREE.Vector3, dir: THREE.Vector3, size: number, period: number): { mesh: THREE.Mesh; vis: { value: number } } {
  const n = 4;
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  const seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) seed.set([i / n, Math.random()], i * 2);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
  g.instanceCount = n;
  const vis = { value: 1 };
  const m = new THREE.ShaderMaterial({
    name: 'breath',
    uniforms: {
      uTime: ctx.shared.uTime,
      uPeriod: { value: period },
      uSize: { value: size },
      uDir: { value: dir.clone().normalize() },
      uSkyColor: ctx.shared.uSkyColor,
      uAuroraLight: ctx.shared.uAuroraLight,
      uLightColor: ctx.shared.uLightColor,
      uVis: vis,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'breath';
  mesh.position.copy(nose);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.raycast = () => {};
  mesh.userData.snow = 0;
  return { mesh, vis };
}
