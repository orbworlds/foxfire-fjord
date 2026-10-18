/**
 * Soft billboard vapour: steam off the hot spring, the hot tub and the lake's
 * ice hole, wood smoke from the chimneys, spindrift at the cairn. One instanced
 * draw call; every particle is animated in the vertex shader from a
 * per-instance seed, so there is no per-frame CPU work besides a few uniforms.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../../world/noise.js';
const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aOrigin;
attribute vec4 aSeed;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec2 uSize;
uniform vec2 uRise;
uniform vec2 uLife;
uniform float uDrift;
uniform float uWander;
varying vec2 vUv;
varying float vAlpha;
varying vec2 vSeed;
varying vec3 vWorldPos;
void main() {
  float life = mix(uLife.x, uLife.y, aSeed.y);
  float t = fract(uTime / life + aSeed.x);
  float age = t * life;
  float rise = mix(uRise.x, uRise.y, aSeed.z);
  vec3 p = aOrigin;
  p.y += rise * age * (1.0 - 0.3 * t);
  float w = 0.25 + uWindStrength;
  p.xz += uWindDir * w * uDrift * age * (0.35 + 0.9 * t);
  float ph = aSeed.w * 6.2831853;
  p.x += sin(age * 0.8 + ph) * uWander * t;
  p.z += cos(age * 0.63 + ph * 1.7) * uWander * t;
  float size = mix(uSize.x, uSize.y, sqrt(t)) * (0.7 + 0.6 * fract(aSeed.w * 7.13));
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  float rot = ph + age * 0.25 * (aSeed.z - 0.5);
  float c = cos(rot);
  float s = sin(rot);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  mvPosition.xy += corner * size;
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.42, 1.0, t));
  vUv = position.xy + 0.5;
  vSeed = vec2(aSeed.w, aSeed.y);
  vWorldPos = p;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uTint;
uniform float uVis;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying vec2 vSeed;
varying vec3 vWorldPos;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  vec2 q = vUv * 0.42 + vSeed * 3.7 + vec2(0.0, -uTime * 0.012);
  float n1 = texture2D(uNoise, q).r;
  float n2 = texture2D(uNoise, vUv * 0.9 + vSeed.yx * 5.1 + vec2(uTime * 0.01, 0.0)).g;
  float body = 1.0 - smoothstep(0.15, 1.0, r);
  float a = body * body * clamp(0.35 + 1.5 * (n1 - 0.5) + 0.9 * (n2 - 0.5) + 0.35, 0.0, 1.0);
  a *= vAlpha * uVis * uOpacity;
  if (a < 0.002) discard;
  vec3 V = normalize(vWorldPos - cameraPosition);
  float mu = dot(V, normalize(uLightDir));
  float forward = pow(max(mu, 0.0), 5.0);
  float phase = 0.18 + 0.75 * forward + 0.06 * max(-mu, 0.0);
  // the fog colour glows red at twilight; vapour is lit by the whole sky, so desaturate it
  float hzLum = dot(uHorizonColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 ambient = uSkyColor + mix(uHorizonColor, vec3(hzLum), 0.65) * 0.6;
  vec3 col = (ambient + uLightColor * phase * 0.3) * uTint;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;
export class Steam {
    mesh;
    material;
    constructor(ctx, o) {
        const rnd = mulberry32(o.seed ?? 77);
        const quad = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = quad.index;
        geo.setAttribute('position', quad.getAttribute('position'));
        const n = Math.max(1, Math.round(o.count));
        const origin = new Float32Array(n * 3);
        const seed = new Float32Array(n * 4);
        const total = o.emitters.reduce((s, e) => s + (e.weight ?? 1), 0);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < n; i++) {
            let pick = rnd() * total;
            let e = o.emitters[0];
            for (const em of o.emitters) {
                pick -= em.weight ?? 1;
                if (pick <= 0) {
                    e = em;
                    break;
                }
            }
            const a = rnd() * Math.PI * 2;
            const rr = Math.sqrt(rnd());
            origin[i * 3] = e.x + Math.cos(a) * rr * e.rx;
            origin[i * 3 + 1] = e.y;
            origin[i * 3 + 2] = e.z + Math.sin(a) * rr * e.rz;
            seed[i * 4] = rnd();
            seed[i * 4 + 1] = rnd();
            seed[i * 4 + 2] = rnd();
            seed[i * 4 + 3] = rnd();
            minX = Math.min(minX, e.x - e.rx);
            maxX = Math.max(maxX, e.x + e.rx);
            minZ = Math.min(minZ, e.z - e.rz);
            maxZ = Math.max(maxZ, e.z + e.rz);
            minY = Math.min(minY, e.y);
            maxY = Math.max(maxY, e.y);
        }
        geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
        geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
        geo.instanceCount = n;
        const reach = o.rise[1] * o.life[1] + o.drift * 1.5 * o.life[1] + o.size[1] + (o.wander ?? 0.3);
        const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2 + reach * 0.5, (minZ + maxZ) / 2);
        const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + reach;
        geo.boundingSphere = new THREE.Sphere(center, radius);
        geo.boundingBox = new THREE.Box3(new THREE.Vector3(minX - reach, minY - 1, minZ - reach), new THREE.Vector3(maxX + reach, maxY + reach, maxZ + reach));
        const s = ctx.shared;
        this.material = new THREE.ShaderMaterial({
            name: 'steam',
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) },
                    uRise: { value: new THREE.Vector2(o.rise[0], o.rise[1]) },
                    uLife: { value: new THREE.Vector2(o.life[0], o.life[1]) },
                    uDrift: { value: o.drift },
                    uWander: { value: o.wander ?? 0.3 },
                    uVis: { value: 1 },
                    uOpacity: { value: o.opacity },
                    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
                    uNoise: { value: ctx.materials.noise },
                },
            ]),
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            fog: true,
        });
        const u = this.material.uniforms;
        u.uTime = s.uTime;
        u.uWindDir = s.uWindDir;
        u.uWindStrength = s.uWindStrength;
        u.uLightDir = s.uLightDir;
        u.uLightColor = s.uLightColor;
        u.uSkyColor = s.uSkyColor;
        u.uHorizonColor = s.uHorizonColor;
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.name = 'steam';
        this.mesh.renderOrder = 5;
        this.mesh.userData.noMerge = true;
        this.mesh.userData.noPick = true;
        this.mesh.raycast = () => { };
    }
    set visibility(v) {
        this.material.uniforms.uVis.value = v;
    }
}
/**
 * How visible vapour is at the current time: thick in the bitter cold before
 * and around sunrise, plain at night, a little thinner when the low noon sun
 * has warmed the air a degree or two.
 */
export function steamVisibility(ctx) {
    const h = ctx.sky.hours;
    const sunY = ctx.sky.sunDir.y;
    const day = ctx.shared.uDay.value;
    const high = THREE.MathUtils.smoothstep(sunY, 0.08, 0.7);
    let v = THREE.MathUtils.lerp(0.95, 0.42, day * high);
    // dawn boost: low sun in the morning, cold air over hot water
    const morning = h > 3.5 && h < 10.5 ? 1 : 0.35;
    const low = day * (1 - THREE.MathUtils.smoothstep(sunY, 0.02, 0.4));
    v += 0.45 * low * morning;
    return v;
}
