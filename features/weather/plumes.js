/**
 * Spindrift: banners of snow torn off the summits and ridges of the Teeth and
 * Fox Peak by the wind aloft. The crests are found once from the baked height
 * grid (local maxima, spaced apart); each streams a train of large soft
 * sprites downwind that swell, rise, sag into the lee and fade, stretched
 * along the wind's direction on screen and streaked by noise. They glow when
 * the low sun or the moon stands behind them, pick up the aurora's green, and
 * fade softly where they would cut into a slope (the island's height texture).
 * Strength follows the gusts; overcast hides them.
 */
import * as THREE from 'three';
import { FOX_PEAK, VIEWPOINTS } from '../../world/layout.js';
import { mulberry32 } from '../../world/noise.js';
import { WX_COMMON, WX_COMMON_PARS, WX_TERRAIN_GLSL, sharedUniforms, terrainUniforms } from './common.js';
/**
 * Local maxima of the baked height grid inside a box (world xz), highest first,
 * at least `sep` metres apart.
 */
export function findCrests(ctx, box, minH, sep, max) {
    const w = ctx.world;
    const b = w.bounds;
    const nx = w.gridNX;
    const nz = w.gridNZ;
    const g = w.heightGrid;
    const dx = (b.maxX - b.minX) / (nx - 1);
    const dz = (b.maxZ - b.minZ) / (nz - 1);
    // max-pool to ~30 m cells
    const cell = 30;
    const sx = Math.max(1, Math.round(cell / dx));
    const sz = Math.max(1, Math.round(cell / dz));
    const i0 = Math.max(0, Math.floor((box.minX - b.minX) / dx));
    const i1 = Math.min(nx - 1, Math.ceil((box.maxX - b.minX) / dx));
    const j0 = Math.max(0, Math.floor((box.minZ - b.minZ) / dz));
    const j1 = Math.min(nz - 1, Math.ceil((box.maxZ - b.minZ) / dz));
    const cw = Math.floor((i1 - i0) / sx);
    const ch = Math.floor((j1 - j0) / sz);
    if (cw < 3 || ch < 3)
        return [];
    const pool = new Float32Array(cw * ch);
    const px = new Float32Array(cw * ch);
    const pz = new Float32Array(cw * ch);
    for (let cj = 0; cj < ch; cj++) {
        for (let ci = 0; ci < cw; ci++) {
            let best = -1e9;
            let bi = 0;
            let bj = 0;
            for (let j = j0 + cj * sz; j < j0 + (cj + 1) * sz; j++) {
                for (let i = i0 + ci * sx; i < i0 + (ci + 1) * sx; i++) {
                    const h = g[j * nx + i];
                    if (h > best) {
                        best = h;
                        bi = i;
                        bj = j;
                    }
                }
            }
            const k = cj * cw + ci;
            pool[k] = best;
            px[k] = b.minX + bi * dx;
            pz[k] = b.minZ + bj * dz;
        }
    }
    const R = 4;
    const cand = [];
    for (let cj = 0; cj < ch; cj++) {
        for (let ci = 0; ci < cw; ci++) {
            const h = pool[cj * cw + ci];
            if (h < minH)
                continue;
            let top = true;
            for (let j = Math.max(0, cj - R); j <= Math.min(ch - 1, cj + R) && top; j++) {
                for (let i = Math.max(0, ci - R); i <= Math.min(cw - 1, ci + R); i++) {
                    if (pool[j * cw + i] > h) {
                        top = false;
                        break;
                    }
                }
            }
            if (top)
                cand.push({ x: px[cj * cw + ci], y: h, z: pz[cj * cw + ci], k: 1 });
        }
    }
    cand.sort((a, c) => c.y - a.y);
    const out = [];
    for (const c of cand) {
        if (out.length >= max)
            break;
        if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < sep))
            continue;
        out.push(c);
    }
    return out;
}
/**
 * True when the summit stands on the skyline seen from the eye: its top and a point 45 m down its
 * face are both in sight over the baked terrain (a peak just peeping over a nearer one would put its
 * banner in the empty sky above the nearer summit).
 */
function skylineVisible(ctx, eye, c) {
    const clear = (ty) => {
        const steps = 90;
        for (let i = 2; i < steps - 2; i++) {
            const t = i / steps;
            const x = eye[0] + (c.x - eye[0]) * t;
            const z = eye[2] + (c.z - eye[2]) * t;
            const y = eye[1] + (ty - eye[1]) * t;
            if (ctx.world.heightAtFast(x, z) > y + 1)
                return false;
        }
        return true;
    };
    return clear(c.y + 6) && clear(c.y - 45);
}
const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${WX_COMMON_PARS}
attribute vec4 aCrest;   // xyz crest, w strength
attribute float aVis;    // the crest is on the skyline seen from the camera (eased 0..1)
attribute vec4 aSeed;
uniform float uSpeed;
uniform float uLevel;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec2 vSeed;
${WX_COMMON}

void main() {
  float life = 9.0 + 7.0 * aSeed.y;
  float tt = uTime / life + aSeed.x;
  float ph = fract(tt);
  float cyc = floor(tt) + aSeed.z * 97.0;
  vec3 j = wxHash3(cyc * 1.37 + aSeed.w * 31.0);
  // the wind aloft backs westerly over the crests: the banners stream east along the range
  vec3 wdir = normalize(vec3(uWindDir.x, 0.0, uWindDir.y * 0.3));
  vec3 side = vec3(-wdir.z, 0.0, wdir.x);
  float age = ph * life;
  // torn loose slowly, then carried off at the speed of the wind aloft
  float run = uSpeed * (0.75 + 0.5 * j.x) * age * (0.25 + 0.75 * ph);
  // the puff's head is torn off the crest and runs downwind, sinking into the lee; its body trails behind
  vec3 head = aCrest.xyz + side * (j.y - 0.5) * 50.0 + wdir * (run - 6.0);
  // (from afar the terrain's coarse levels cut summits down by tens of metres: start a little below the top)
  head.y += -14.0 + 6.0 * j.z - (16.0 + 22.0 * j.x) * ph;
  float len = mix(40.0 + 25.0 * j.z, 190.0 + 130.0 * j.y, sqrt(ph)) * (0.8 + 0.4 * aCrest.w);
  float wid = len * (0.3 + 0.14 * j.x);
  // a gust drives each puff: some are thick, many faint
  float gust = 0.45 + 0.55 * j.x;
  float env = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.4, 1.0, ph));

  // laid along the wind as seen on screen (foreshortened when it blows toward or away from the eye)
  vec4 mv = viewMatrix * vec4(head, 1.0);
  vec3 wv = mat3(viewMatrix) * wdir;
  float lw = length(wv.xy);
  vec2 ax = lw > 1e-3 ? wv.xy / lw : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float lenS = len * mix(0.4, 1.0, smoothstep(0.15, 0.8, lw));
  vec2 ext = vec2(0.5 * lenS, 0.5 * max(wid, 0.4 * lenS));
  // the quad's upwind end sits on the head
  vec2 off = ax * (position.x * 2.0 + 1.0) * ext.x + ay * position.y * 2.0 * ext.y;
  mv.xy += off;
  vec3 c = head;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vWorld = head + camR * off.x + camU * off.y;
  vUv = position.xy * 2.0;
  vSeed = vec2(aSeed.w, cyc * 0.173);

  float dist = length(c - cameraPosition);
  vAlpha = env * gust * aCrest.w * aVis * uLevel * smoothstep(180.0, 420.0, dist);
  if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec3 V = normalize(c - cameraPosition);
  float mu = dot(V, uLightDir);
  vColor = wxAmbient() * 0.95 + wxKey(mu, 2.0, 5.0);
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
${WX_TERRAIN_GLSL}
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vWorld;
varying vec2 vSeed;
void main() {
  vec2 q = vUv;
  // head (u = 0) to tail (u = 1): narrow and dense where it leaves the crest, widening and fraying
  float u = q.x * 0.5 + 0.5;
  float w = 0.22 + 0.78 * sqrt(u);
  float body = smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.5, 1.0, u)) * exp(-2.6 * (q.y / w) * (q.y / w)) * (1.25 - 0.7 * u);
  vec2 nq = vec2(q.x * 0.22 - uTime * 0.05, q.y * 0.8 / w) + vSeed * vec2(3.1, 7.3);
  float n1 = texture2D(uNoise, nq).g;
  float n2 = texture2D(uNoise, nq * vec2(1.9, 2.4) + 0.37).b;
  float streak = clamp(0.4 + 1.7 * (n1 - 0.5) + 1.2 * (n2 - 0.5), 0.0, 1.0);
  float a = min(1.0, body * streak * vAlpha * uOpacity);
  a *= smoothstep(-14.0, 4.0, vWorld.y - wxGround(vWorld.xz));
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}
`;
export class Plumes {
    ctx;
    perCrest;
    mesh;
    crests;
    material;
    visAttr;
    vis = [];
    target = [];
    visTimer = 0;
    lastCam = new THREE.Vector3(1e9, 0, 0);
    constructor(ctx, perCrest) {
        this.ctx = ctx;
        this.perCrest = perCrest;
        // only summits on the skyline seen from the main viewpoints (a banner off a hidden peak floats in the sky)
        const eyes = VIEWPOINTS.filter((v) => !v.interior && ['cabin', 'deck', 'lake', 'overview', 'spring', 'sauna'].includes(v.id)).map((v) => v.pos);
        const seen = (c) => eyes.some((e) => skylineVisible(ctx, e, c));
        const teeth = findCrests(ctx, { minX: -1900, maxX: 2000, minZ: -2950, maxZ: -1350 }, 560, 260, 40).filter(seen).slice(0, ctx.quality.fancy ? 14 : 9);
        const peak = findCrests(ctx, { minX: FOX_PEAK.x - 450, maxX: FOX_PEAK.x + 450, minZ: FOX_PEAK.z - 350, maxZ: FOX_PEAK.z + 350 }, FOX_PEAK.y - 120, 220, 3);
        // the highest crests carry the strongest banners
        const top = teeth.length ? teeth[0].y : 800;
        for (const c of teeth)
            c.k = 0.55 + 0.45 * THREE.MathUtils.smoothstep(c.y, top - 260, top);
        for (const c of peak)
            c.k = 0.8;
        this.crests = [...teeth, ...peak];
        const rnd = mulberry32(5521);
        const n = this.crests.length * perCrest;
        const crest = new Float32Array(n * 4);
        const seed = new Float32Array(n * 4);
        let i = 0;
        for (const c of this.crests) {
            for (let k = 0; k < perCrest; k++, i++) {
                crest.set([c.x, c.y, c.z, c.k], i * 4);
                seed.set([(k + rnd() * 0.6) / perCrest, rnd(), rnd(), rnd()], i * 4);
            }
        }
        const quad = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = quad.index;
        geo.setAttribute('position', quad.getAttribute('position'));
        geo.setAttribute('aCrest', new THREE.InstancedBufferAttribute(crest, 4));
        geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
        this.vis = this.crests.map(() => -1);
        this.target = this.crests.map(() => 1);
        this.visAttr = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
        this.visAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aVis', this.visAttr);
        geo.instanceCount = n;
        const box = new THREE.Box3();
        for (const c of this.crests)
            box.expandByPoint(new THREE.Vector3(c.x, c.y, c.z));
        box.expandByScalar(450);
        geo.boundingBox = box;
        geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        this.material = new THREE.ShaderMaterial({
            name: 'spindrift',
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uSpeed: { value: 12 },
                    uLevel: { value: 1 },
                    uOpacity: { value: 2.0 },
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
        this.mesh.name = 'spindrift-plumes';
        this.mesh.renderOrder = 4;
        this.mesh.raycast = () => { };
    }
    update(dt, level, windStrength) {
        this.mesh.visible = level > 0.004 && this.crests.length > 0;
        const u = this.material.uniforms;
        u.uLevel.value = level;
        u.uSpeed.value = 7 + 12 * windStrength;
        if (!this.mesh.visible)
            return;
        // which summits the camera sees (a banner off a hidden peak would float in the sky): re-test when it moves
        const cam = this.ctx.camera.position;
        this.visTimer -= dt;
        if (this.visTimer <= 0 || cam.distanceToSquared(this.lastCam) > 400) {
            this.visTimer = 0.5;
            this.lastCam.copy(cam);
            const eye = [cam.x, cam.y, cam.z];
            this.crests.forEach((c, i) => (this.target[i] = skylineVisible(this.ctx, eye, c) ? 1 : 0));
        }
        const k = dt > 0 ? Math.min(1, dt * 1.5) : 1;
        let changed = false;
        this.crests.forEach((_, i) => {
            const cur = this.vis[i] < 0 ? this.target[i] : this.vis[i];
            const v = cur + (this.target[i] - cur) * k;
            if (Math.abs(v - this.vis[i]) > 1e-4)
                changed = true;
            this.vis[i] = Math.abs(v - this.target[i]) < 1e-3 ? this.target[i] : v;
        });
        if (changed) {
            const a = this.visAttr.array;
            for (let i = 0; i < a.length; i++)
                a[i] = this.vis[Math.floor(i / this.perCrest)];
            this.visAttr.needsUpdate = true;
        }
    }
    dispose() {
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
