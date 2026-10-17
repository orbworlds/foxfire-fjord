/**
 * The wood stove's fire, drawn inside its firebox: tongues of flame rising
 * from each log (a ray-marched emissive volume, so the fire has depth from
 * every side and through the open door), the logs themselves charred black
 * with embers glowing in their cracks, a bed of coals breathing orange,
 * fire bricks lit by the flames, sparks, and the door's ceramic glass with
 * soot creeping in from its edges.
 *
 * Everything works in the stove's own frame (front = +z, y up from the
 * floor). All materials are unlit and read the shared fire state below.
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';

/** a log in the firebox (stove frame): a capsule a..b of radius r; hf = its flames' height */
export interface FireLog {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
  hf: number;
}

/** Shared state of the fire (uniform objects, bound by reference). */
export interface FireState {
  /** x: flame level 0..1.5 (fire × door × stoking), y: ember glow 0..1.2, z: flicker, w: door open 0..1 */
  uFire: { value: THREE.Vector4 };
  uTime: { value: number };
  uNoise: { value: THREE.Texture };
}

export function fireState(ctx: FeatureContext): FireState {
  return { uFire: { value: new THREE.Vector4(1, 1, 1, 0) }, uTime: ctx.shared.uTime, uNoise: { value: ctx.materials.noise } };
}

const MAX_LOGS = 3;

/** a hot-object ramp: deep red → orange → yellow → white */
const RAMP = /* glsl */ `
vec3 fireRamp(float t) {
  t = clamp(t, 0.0, 1.6);
  vec3 c = vec3(0.55, 0.05, 0.005) * smoothstep(0.0, 0.25, t);
  c = mix(c, vec3(1.0, 0.32, 0.04), smoothstep(0.15, 0.55, t));
  c = mix(c, vec3(1.0, 0.68, 0.22), smoothstep(0.5, 0.95, t));
  c = mix(c, vec3(1.0, 0.92, 0.7), smoothstep(0.95, 1.5, t));
  return c;
}`;

/* ------------------------------------------------------------------ */
/* Flames: a ray-marched volume in the firebox                         */
/* ------------------------------------------------------------------ */

const FLAME_VERT = /* glsl */ `
uniform mat4 uInvModel;
varying vec3 vObj;
varying vec3 vCamObj;
void main() {
  vObj = position;
  vCamObj = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLAME_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec4 uFire;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uLogA[${MAX_LOGS}];
uniform vec4 uLogB[${MAX_LOGS}]; // xyz end, w radius
uniform float uLogH[${MAX_LOGS}];
varying vec3 vObj;
varying vec3 vCamObj;
${RAMP}
float nz(vec2 p) { return texture2D(uNoise, p).r; }
float nz2(vec2 p) { return texture2D(uNoise, p).g; }

// iq's ray-capsule intersection: distance along the ray, or -1
float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) {
  vec3 ba = pb - pa;
  vec3 oa = ro - pa;
  float baba = dot(ba, ba);
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float rdoa = dot(rd, oa);
  float oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - r * r * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc);
    c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}

float hash1(float n) { return fract(sin(n * 127.1 + 0.3) * 43758.5453); }

// one tongue of flame in its cell along the log: round in section, pointed at the tip, breathing on its own rhythm
float tongue(float cell, float fu, float w, float hh, float n3, float hf, float seed, float t) {
  float hsh = hash1(cell + seed * 17.0);
  float hsh2 = hash1(cell * 3.7 + seed * 5.0 + 1.3);
  float H = hf * (0.4 + 0.75 * hsh + 0.32 * sin(t * (2.3 + 2.4 * hsh2) + hsh * 6.28)) * uFire.x;
  H = max(H, 0.015);
  float k = clamp(hh / H + (n3 - 0.5) * 0.3 * hh / H, 0.0, 1.0);
  // round root, pointed tip; the edge eaten by turbulence
  float R = (0.032 + 0.016 * hsh2) * pow(1.0 - k, 0.8) * (0.65 + 0.7 * n3);
  float rho = length(vec2(fu, w));
  float body = 1.0 - smoothstep(R * 0.1, R * 1.05, rho);
  return body * (1.0 - smoothstep(0.75, 1.0, k)) * (1.3 - 0.8 * k);
}

// the flames standing on one log: a row of tongues along its crown and a low carpet of fire
float tongues(vec3 p, vec3 a, vec3 b, float r, float hf, float seed) {
  vec3 ab = b - a;
  float len = length(ab);
  vec3 ax = ab / len;
  float u = dot(p - a, ax);
  if (u < -0.03 || u > len + 0.03) return 0.0;
  vec3 c = a + ax * clamp(u, 0.0, len);
  vec3 d = p - c;
  float h = d.y - r * 0.55;
  if (h < -r * 1.2 || h > hf * 1.9) return 0.0;
  vec3 side = normalize(cross(ax, vec3(0.0, 1.0, 0.0)));
  float w = dot(d, side);
  float t = uTime;
  float hh = max(h, 0.0);
  float rise = hh / max(hf, 1e-3);
  // the column bends and licks: slow sway plus turbulence, growing with height
  float n2 = nz2(vec2(u * 3.0 + seed, hh * 2.6 - t * 1.3));
  float n3 = nz(vec2(u * 8.0 - seed, hh * 6.0 - t * 2.7));
  w += (n2 - 0.5) * 0.09 * rise + sin(t * 1.9 + seed * 3.0 + u * 7.0) * 0.014 * rise;
  float uw = u + (n3 - 0.5) * 0.06 * rise;
  const float S = 0.058;
  float c0 = floor(uw / S - 0.5);
  float f0 = uw - (c0 + 0.5) * S;
  float heat = max(tongue(c0, f0, w, hh, n3, hf, seed, t), tongue(c0 + 1.0, f0 - S, w, hh, n3, hf, seed, t));
  // the carpet: a thin sheet of flame hugging the crown of the log
  float carpet = (1.0 - smoothstep(0.0, 0.04 + 0.045 * n2, hh)) * (1.0 - smoothstep(r * 0.7, r * 1.3, abs(w)));
  heat = max(heat, carpet * (0.7 + 0.5 * n3));
  float ends = smoothstep(-0.02, 0.025, u) * smoothstep(len + 0.02, len - 0.025, u);
  float base = smoothstep(-r * 1.2, -r * 0.3, h);
  return heat * ends * base;
}

void main() {
  vec3 ro = vCamObj;
  vec3 rd = normalize(vObj - vCamObj);
  // box span
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= tn || uFire.x <= 0.01) discard;
  // logs block the flames behind them
  for (int i = 0; i < ${MAX_LOGS}; i++) {
    float th = capsule(ro, rd, uLogA[i], uLogB[i].xyz, uLogB[i].w);
    if (th > tn) tf = min(tf, th);
  }
  const int STEPS = FLAME_STEPS;
  float dt = (tf - tn) / float(STEPS);
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 col = vec3(0.0);
  float tt = tn + dt * jit;
  for (int s = 0; s < STEPS; s++) {
    vec3 p = ro + rd * tt;
    float heat = 0.0;
    for (int i = 0; i < ${MAX_LOGS}; i++) heat += tongues(p, uLogA[i], uLogB[i].xyz, uLogB[i].w, uLogH[i], float(i) * 1.37);
    // a low blue-violet sheet where the gases first light, just above the coals
    float lowY = p.y - uBoxMin.y;
    heat = min(heat, 1.6);
    vec3 c = fireRamp(heat * 0.82) * heat;
    c += vec3(0.05, 0.08, 0.35) * smoothstep(0.06, 0.0, lowY) * smoothstep(0.0, 0.3, heat) * 0.6;
    col += c * dt;
    tt += dt;
  }
  col *= 40.0 * (0.6 + 0.4 * uFire.z);
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, 1.0);
}`;

/** The flame volume: a box (stove frame) drawn additively; logs occlude it analytically. */
export function flameVolume(F: FireState, boxMin: THREE.Vector3, boxMax: THREE.Vector3, logs: FireLog[], steps: number): { mesh: THREE.Mesh; invModel: { value: THREE.Matrix4 } } {
  const size = boxMax.clone().sub(boxMin);
  const g = new THREE.BoxGeometry(size.x, size.y, size.z);
  g.translate((boxMin.x + boxMax.x) / 2, (boxMin.y + boxMax.y) / 2, (boxMin.z + boxMax.z) / 2);
  const invModel = { value: new THREE.Matrix4() };
  const L = logs.slice(0, MAX_LOGS);
  while (L.length < MAX_LOGS) L.push({ a: new THREE.Vector3(0, -9, 0), b: new THREE.Vector3(0.01, -9, 0), r: 0.001, hf: 0 });
  const mat = new THREE.ShaderMaterial({
    name: 'stoveFlames',
    defines: { FLAME_STEPS: steps },
    uniforms: {
      uNoise: F.uNoise,
      uTime: F.uTime,
      uFire: F.uFire,
      uInvModel: invModel,
      uBoxMin: { value: boxMin.clone() },
      uBoxMax: { value: boxMax.clone() },
      uLogA: { value: L.map((l) => l.a.clone()) },
      uLogB: { value: L.map((l) => new THREE.Vector4(l.b.x, l.b.y, l.b.z, l.r)) },
      uLogH: { value: L.map((l) => l.hf) },
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'stove-flames';
  mesh.renderOrder = 5;
  mesh.raycast = () => {};
  // the camera's position in the box's own frame comes from its world matrix, fresh every draw
  mesh.onBeforeRender = () => {
    invModel.value.copy(mesh.matrixWorld).invert();
  };
  return { mesh, invModel };
}

/* ------------------------------------------------------------------ */
/* Lit-by-fire surfaces: firebox bricks, logs, coals                   */
/* ------------------------------------------------------------------ */

const LOCAL_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vP = position;
  vN = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * The firebox lining: fire bricks lit by the flames from below and in front,
 * darkening with soot toward the top; the room's lamp fill reaches in when
 * the fire is out. `fireC` is the fire's centre (stove frame).
 */
export function brickMaterial(F: FireState, map: THREE.Texture, lampFill: { value: THREE.Color }, fireC: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'fireBricks',
    uniforms: { uMap: { value: map }, uFire: F.uFire, uTime: F.uTime, uNoise: F.uNoise, uC: { value: fireC.clone() }, uFill: lampFill },
    vertexShader: LOCAL_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform sampler2D uNoise; uniform vec4 uFire; uniform float uTime; uniform vec3 uC; uniform vec3 uFill;
      varying vec3 vP; varying vec3 vN; varying vec2 vUv;
      void main() {
        vec3 alb = texture2D(uMap, vUv * 4.1667).rgb;
        vec3 d = uC - vP;
        float dist = length(d);
        float ndl = max(dot(normalize(vN), d / dist), 0.0);
        // flames dance on the bricks
        float dance = 0.75 + 0.5 * texture2D(uNoise, vec2(vP.x * 2.0 + vP.z * 1.3, vP.y * 1.5 - uTime * 0.45)).r;
        float soot = clamp(smoothstep(0.42, 0.74, vP.y) * 0.85 + (texture2D(uNoise, vP.xy * 3.0 + vP.z).g - 0.5) * 0.5, 0.0, 0.95);
        vec3 fire = vec3(1.0, 0.4, 0.1) * uFire.x * uFire.z * dance * (0.3 + 0.7 * ndl) * 0.028 / (dist * dist + 0.01);
        vec3 col = alb * (fire + uFill * 0.3) * (1.0 - soot);
        // the glow of coals on the lowest course
        col += vec3(0.6, 0.12, 0.02) * uFire.y * smoothstep(0.34, 0.28, vP.y) * 0.25 * alb.r;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/**
 * Burning logs: split birch charred black, a crazing of cracks glowing
 * orange-red that pulse, brightest underneath (on the coals) and where the
 * flames lick; the bark peels on the cooler ends.
 */
export function logMaterial(F: FireState, fireC: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'burningLogs',
    uniforms: { uFire: F.uFire, uTime: F.uTime, uNoise: F.uNoise, uC: { value: fireC.clone() } },
    vertexShader: LOCAL_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform vec4 uFire; uniform float uTime; uniform vec3 uC;
      varying vec3 vP; varying vec3 vN; varying vec2 vUv;
      ${RAMP}
      void main() {
        vec3 n = normalize(vN);
        // alligator cracks of charcoal: cells from two noise octaves
        float c1 = texture2D(uNoise, vUv * vec2(1.6, 3.2)).b;
        float c2 = texture2D(uNoise, vUv * vec2(3.7, 6.1) + 0.31).a;
        float crack = smoothstep(0.08, 0.0, abs(c1 - 0.5)) + 0.6 * smoothstep(0.06, 0.0, abs(c2 - 0.5));
        float under = smoothstep(0.35, -0.6, n.y);
        float pulse = 0.65 + 0.35 * sin(uTime * 1.3 + c1 * 18.0) * sin(uTime * 0.7 + c2 * 11.0);
        float heat = uFire.y * (crack * (0.7 + 0.9 * under) * pulse + under * 0.45 + 0.1);
        vec3 glow = fireRamp(heat * 0.9) * heat * 1.6;
        // lit by the flames above: a warm sheen on the charcoal tops
        vec3 d = uC - vP;
        float dist2 = dot(d, d);
        float lit = max(dot(n, normalize(d + vec3(0.0, 0.12, 0.0))), 0.0) * 0.012 / (dist2 + 0.004);
        vec3 charc = vec3(0.035, 0.028, 0.024) * (0.6 + 0.8 * texture2D(uNoise, vUv * 7.0).r);
        vec3 col = charc * vec3(1.0, 0.5, 0.2) * lit * uFire.x * uFire.z + glow;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** The bed of coals on the grate: ash grey cells with orange hearts breathing. */
export function coalMaterial(F: FireState): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'coalBed',
    uniforms: { uFire: F.uFire, uTime: F.uTime, uNoise: F.uNoise },
    vertexShader: LOCAL_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform vec4 uFire; uniform float uTime;
      varying vec3 vP; varying vec3 vN; varying vec2 vUv;
      ${RAMP}
      void main() {
        vec2 p = vP.xz;
        float cell = texture2D(uNoise, p * 2.2 + vec2(0.13, uTime * 0.004)).b;
        float cell2 = texture2D(uNoise, p * 5.3 + 0.7).a;
        float lump = smoothstep(0.42, 0.62, cell) * (0.6 + 0.6 * cell2);
        float breathe = 0.7 + 0.3 * sin(uTime * 0.9 + cell * 14.0 + cell2 * 6.0);
        float heat = uFire.y * lump * breathe * 1.1;
        vec3 ash = vec3(0.045, 0.04, 0.036) * (0.5 + cell2) * (0.3 + 0.7 * uFire.x);
        vec3 col = mix(ash, fireRamp(heat) * heat * 2.0, smoothstep(0.05, 0.4, heat));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/* ------------------------------------------------------------------ */
/* The door's ceramic glass                                            */
/* ------------------------------------------------------------------ */

/**
 * Smoky ceramic glass: nearly clear in the middle, a brown-black soot veil
 * thickening toward the edges and the bottom corners; a faint reflection of
 * the lamp-lit room. UVs 0..1 over the pane.
 */
export function stoveGlassMaterial(F: FireState, lampFill: { value: THREE.Color }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'stoveGlass',
    uniforms: { uFire: F.uFire, uNoise: F.uNoise, uFill: lampFill },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform vec4 uFire; uniform vec3 uFill;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = min(e.x, e.y);
        float n = texture2D(uNoise, vUv * vec2(1.3, 0.9)).r;
        float n2 = texture2D(uNoise, vUv * 4.0 + 0.5).g;
        // soot: thick at the frame, wisps reaching in, heavier low down and in the corners
        float soot = smoothstep(0.16 + 0.1 * n, 0.0, edge) * 0.85 + smoothstep(0.35, 0.0, vUv.y) * 0.25 * n2;
        soot = clamp(soot + (n - 0.5) * 0.25, 0.0, 0.92);
        float fres = pow(1.0 - abs(dot(normalize(vN), vV)), 4.0);
        vec3 refl = uFill * (0.15 + 0.85 * fres) * 0.6;
        // the inside of the glass carries the soot; seen from behind it is darker still
        if (!gl_FrontFacing) { soot = min(0.95, soot + 0.35); refl *= 0.3; }
        float a = 0.06 + soot * 0.9;
        vec3 sootCol = vec3(0.012, 0.009, 0.007);
        gl_FragColor = vec4(sootCol * a + refl, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ */
/* Sparks in the firebox                                               */
/* ------------------------------------------------------------------ */

/**
 * Sparks rising off the logs (stove frame): they spiral up and wink out
 * under the baffle; with the door open some escape out of the front and
 * up past the top plate.
 */
export function sparkPoints(F: FireState, count: number, boxMin: THREE.Vector3, boxMax: THREE.Vector3, seed = 3): THREE.Points {
  const pos = new Float32Array(count * 3);
  const s = new Float32Array(count * 4);
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) {
    pos.set([boxMin.x + (boxMax.x - boxMin.x) * (0.15 + 0.7 * rnd()), boxMin.y + 0.06, boxMin.z + (boxMax.z - boxMin.z) * (0.2 + 0.6 * rnd())], i * 3);
    s.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
  g.boundingSphere = new THREE.Sphere(boxMin.clone().add(boxMax).multiplyScalar(0.5), 1.2);
  const mat = new THREE.ShaderMaterial({
    name: 'stoveSparks',
    uniforms: { uFire: F.uFire, uTime: F.uTime, uTop: { value: boxMax.y }, uFront: { value: boxMax.z }, uPx: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform vec4 uFire; uniform float uTime; uniform float uTop; uniform float uFront; uniform float uPx;
      varying float vA;
      void main() {
        float life = 0.7 + aSeed.y * 1.1;
        float t = fract(uTime / life + aSeed.x);
        float cyc = floor(uTime / life + aSeed.x);
        vec3 p = position;
        float a = aSeed.z * 6.2831 + t * 5.0;
        p.y += t * (0.3 + 0.35 * aSeed.w);
        p.x += sin(a) * 0.02 * t + (aSeed.w - 0.5) * 0.06 * t;
        // with the door open the draught pulls some sparks out of the front and up
        float out_ = step(0.55, fract(aSeed.w * 13.7 + cyc * 0.31)) * uFire.w;
        p.z += out_ * t * 0.35;
        p.y += out_ * t * t * 0.45;
        float under = out_ > 0.5 ? 1.0 : step(p.y, uTop - 0.03);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPx * 0.006 / max(0.2, -mv.z), 1.0, 3.5);
        float alive = step(0.3 + 0.4 * (1.0 - uFire.x), fract(aSeed.w * 7.3 + cyc * 0.37));
        vA = (1.0 - t) * smoothstep(0.0, 0.08, t) * under * alive * min(uFire.x, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = 1.0 - smoothstep(0.15, 0.5, length(c));
        gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * 4.0 * vA * d, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'stove-sparks';
  pts.raycast = () => {};
  pts.renderOrder = 6;
  mat.onBeforeRender = (renderer, _s, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    mat.uniforms.uPx.value = (renderer.domElement.height * renderer.getPixelRatio() * 0.5) / Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 50) / 2));
  };
  return pts;
}
