/**
 * Falling snow around the camera. Three nested boxes of flakes (near, middle,
 * far) wrap round the eye, so the snowfall never ends however far you walk;
 * every flake is placed and animated in the vertex shader from its seed and
 * two accumulated offsets (the fall and the wind drift), and drawn as a soft
 * capsule stretched along its motion relative to the camera (a short shutter
 * blur). Flakes are lit by the sky, the moon or the low sun from behind, the
 * aurora, and the warm lamps nearby; none fall inside the cabin.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../world/noise.js';
import { INDOORS_GLSL, WX_COMMON, WX_COMMON_PARS, sharedUniforms } from './common.js';
import { LAMP_GLSL } from './lamps.js';
/** box sizes (m) per layer: the near box is dense, the outer ones are hollow shells round it */
const LAYERS = [
    { box: [12, 8, 12], share: 0.5, inner: 0 },
    { box: [30, 20, 30], share: 0.3, inner: 5 },
    { box: [80, 40, 80], share: 0.2, inner: 13 },
];
/**
 * Offsets wrap at 8× the least common multiple of the box sizes (heights 8/20/40 -> 40,
 * widths 12/30/80 -> 240), so every speed factor n/8 shifts the pattern by whole boxes.
 */
const WRAP_Y = 8 * 40;
const WRAP_XZ = 8 * 240;
const VERT = /* glsl */ `
${WX_COMMON_PARS}
${LAMP_GLSL}
attribute vec4 aSeed;
attribute vec4 aBox;
uniform vec3 uCam;
uniform vec3 uOff;
uniform vec3 uVel;
uniform vec3 uCamVel;
uniform float uDensity;
uniform float uSize;
uniform float uShutter;
uniform float uPx;
varying vec2 vQ;
varying vec2 vShape;
varying vec3 vColor;
varying float vAlpha;
${WX_COMMON}
${INDOORS_GLSL}
void main() {
  float r = aSeed.w;
  // the snowfall thickens by switching flakes on in seed order
  float keep = step(fract(r * 7.31 + 0.13), uDensity);
  // fall-speed factor n/8 (n = 6..10): the offsets wrap without a jump for every n
  float s = (6.0 + floor(r * 4.999)) / 8.0;
  vec3 box = aBox.xyz;
  vec3 p = aSeed.xyz * box + vec3(uOff.x, -uOff.y, uOff.z) * s;
  vec3 rel = mod(p - uCam + 0.5 * box, box) - 0.5 * box;
  // flutter: a slow helix with a per-flake rate
  float ph = r * 61.0;
  float fq = 0.7 + fract(r * 13.7) * 1.1;
  float amp = 0.05 + 0.16 * fract(r * 3.31);
  float a1 = uTime * fq + ph;
  float a2 = uTime * fq * 0.83 + ph * 1.3;
  rel.xz += vec2(sin(a1), cos(a2)) * amp;
  vec3 wp = uCam + rel;
  vec3 vel = uVel * s + vec3(cos(a1) * fq, 0.0, -sin(a2) * fq * 0.83) * amp - uCamVel;

  // fades: the layer's outer shell, its hollow core (the nearer layer fills it), indoors
  float dh = length(rel.xz) / (0.5 * box.x);
  float dv = abs(rel.y) / (0.5 * box.y);
  float fade = (1.0 - smoothstep(0.62, 0.98, dh)) * (1.0 - smoothstep(0.6, 0.98, dv));
  float dist = length(rel);
  fade *= aBox.w > 0.0 ? smoothstep(aBox.w * 0.7, aBox.w, dist) : 1.0;
  fade *= 1.0 - indoors(wp);
  fade *= keep;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float depth = max(-mv.z, 0.05);
  float px = uPx / depth;
  // a few big loose aggregates among the single crystals
  float size = uSize * (0.55 + 0.9 * fract(r * 5.71)) * (fract(r * 17.3) > 0.9 ? 1.8 : 1.0);
  // sub-pixel flakes keep their energy as a faint 1.6 px dot instead of shimmering
  float grow = max(1.0, 1.6 / max(size * px, 1e-4));
  float alpha = fade / (grow * grow);
  size *= grow;
  vec2 streak = (viewMatrix * vec4(vel * uShutter, 0.0)).xy;
  float L = length(streak);
  float lim = 36.0 / px;
  if (L > lim) { streak *= lim / L; L = lim; }
  vec2 ax = L > 1e-6 ? streak / L : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float hl = 0.5 * L;
  float rad = 0.5 * size;
  vec2 ext = vec2(hl + rad, rad) * 1.15;
  mv.xy += ax * position.x * 2.0 * ext.x + ay * position.y * 2.0 * ext.y;
  gl_Position = projectionMatrix * mv;
  vQ = vec2(position.x, position.y) * 2.0 * ext;
  vShape = vec2(hl, rad);
  // the streak spreads the flake's light over its length
  alpha *= rad / (hl + rad);
  if (alpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vAlpha = alpha;

  vec3 V = normalize(wp - cameraPosition);
  float mu = dot(V, uLightDir);
  vec3 col = wxAmbient() + wxKey(mu, 1.2, 7.0) + wxLamps(wp) * 0.55;
  vColor = col * 0.92;
}
`;
const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec2 vShape;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(vec2(max(abs(vQ.x) - vShape.x, 0.0), vQ.y)) / vShape.y;
  float a = vAlpha * exp(-d * d * 2.2);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}
`;
export class Snowfall {
    ctx;
    mesh;
    material;
    geo;
    off = new THREE.Vector3();
    lastCam = new THREE.Vector3();
    camVel = new THREE.Vector3();
    hasCam = false;
    tmp = new THREE.Vector3();
    constructor(ctx, lamps, count) {
        this.ctx = ctx;
        this.geo = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        this.geo.index = quad.index;
        this.geo.setAttribute('position', quad.getAttribute('position'));
        this.setCount(count);
        this.material = new THREE.ShaderMaterial({
            name: 'snowfall',
            uniforms: {
                ...sharedUniforms(ctx),
                ...lamps.uniforms,
                uCam: { value: new THREE.Vector3() },
                uOff: { value: this.off },
                uVel: { value: new THREE.Vector3() },
                uCamVel: { value: this.camVel },
                uDensity: { value: 1 },
                uSize: { value: 0.02 },
                uShutter: { value: 0.012 },
                uPx: { value: 600 },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
        });
        this.mesh = new THREE.Mesh(this.geo, this.material);
        this.mesh.name = 'snowfall';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 6;
        this.mesh.raycast = () => { };
    }
    /** (re)build the flake seeds for a new particle budget */
    setCount(count) {
        const n = Math.max(0, Math.round(count));
        const rnd = mulberry32(4211);
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
    /** level 0..1 = how thick the snowfall is */
    update(dt, level, pxScale) {
        const vis = level > 0.004;
        this.mesh.visible = vis;
        const cam = this.ctx.camera.position;
        if (!this.hasCam) {
            this.lastCam.copy(cam);
            this.hasCam = true;
        }
        // camera velocity for the streaks (smoothed; teleports don't count)
        if (dt > 0) {
            const vx = (cam.x - this.lastCam.x) / dt;
            const vy = (cam.y - this.lastCam.y) / dt;
            const vz = (cam.z - this.lastCam.z) / dt;
            const k = 1 - Math.exp(-dt * 10);
            if (vx * vx + vy * vy + vz * vz < 900)
                this.camVel.lerp(this.tmp.set(vx, vy, vz), k);
            else
                this.camVel.set(0, 0, 0);
        }
        this.lastCam.copy(cam);
        if (!vis)
            return;
        const u = this.material.uniforms;
        const sh = this.ctx.shared;
        const wind = 0.5 + 2.4 * sh.uWindStrength.value;
        const fall = 1.05;
        const vel = u.uVel.value;
        vel.set(sh.uWindDir.value.x * wind, -fall, sh.uWindDir.value.y * wind);
        this.off.x = (this.off.x + vel.x * dt) % WRAP_XZ;
        this.off.y = (this.off.y + fall * dt) % WRAP_Y;
        this.off.z = (this.off.z + vel.z * dt) % WRAP_XZ;
        u.uCam.value.copy(cam);
        u.uDensity.value = Math.min(1, level * 1.15);
        u.uPx.value = pxScale;
    }
    dispose() {
        this.geo.dispose();
        this.material.dispose();
    }
}
