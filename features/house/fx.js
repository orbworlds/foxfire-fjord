/**
 * The cabin's small fires and waters: flame billboards and an ember bed for
 * the fire pit and the tub stove, rising sparks, smoke and steam lit warm
 * from below and green by the aurora, the hot tub's water (sky and aurora
 * mirrored on dark water, warm light from under it), soft pools of light on
 * the snow, and a cheap "fire light" for nearby props (benches, stones,
 * staves) that needs no scene light.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../world/noise.js';
import { Steam } from '../paths/kit/steam.js';
export function fireLights() {
    return {
        pos: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        col: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
        shape: { value: [new THREE.Vector2(0.08, 0.25), new THREE.Vector2(0.08, 0.25), new THREE.Vector2(0.08, 0.25)] },
    };
}
/**
 * Light a standard material by the fires: an inverse-square warm term on the
 * diffuse irradiance, no shadows (chained before the snow sweep's patch).
 */
export function fireLit(mat, L, key) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
        prev.call(mat, shader, renderer);
        shader.uniforms.uFirePos = L.pos;
        shader.uniforms.uFireCol = L.col;
        shader.uniforms.uFireShape = L.shape;
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec4 uFirePos[3];\nuniform vec3 uFireCol[3];\nuniform vec2 uFireShape[3];')
            .replace('#include <lights_fragment_maps>', 
        /* glsl */ `#include <lights_fragment_maps>
        {
          vec3 fW = ((-vViewPosition) - viewMatrix[3].xyz) * mat3(viewMatrix);
          vec3 fN = transformDirectionByInverseViewMatrix(normal, viewMatrix);
          for (int i = 0; i < 3; i++) {
            vec4 fp = uFirePos[i];
            if (fp.w <= 0.0) continue;
            vec3 d = fp.xyz - fW;
            float d2 = dot(d, d);
            float ndl = max(dot(fN, d * inversesqrt(d2 + 1e-4)), 0.0);
            vec2 sh = uFireShape[i];
            float fall = (1.0 / (d2 + sh.y)) * (1.0 - smoothstep(fp.w * 0.5, fp.w, sqrt(d2)));
            irradiance += uFireCol[i] * fall * (sh.x + (1.0 - sh.x) * ndl);
          }
        }`);
    };
    mat.customProgramCacheKey = () => `fox-firelit2-${key}`;
    return mat;
}
/* ------------------------------------------------------------------ */
/* Flames                                                              */
/* ------------------------------------------------------------------ */
const FLAME_VERT = /* glsl */ `
attribute vec4 aFlame; // x, z offset from the base, seed, scale
uniform vec3 uBase;
uniform float uSize;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aFlame.z;
  // each tongue breathes on its own rhythm
  float br = 0.82 + 0.12 * sin(uTime * (5.0 + aFlame.z * 4.0) + aFlame.z * 40.0) + 0.08 * sin(uTime * 13.0 + aFlame.z * 17.0);
  float s = uSize * aFlame.w * br;
  vec3 c = uBase + vec3(aFlame.x, 0.0, aFlame.y);
  // cylindrical billboard: stands upright, turns to face the camera
  vec3 toCam = cameraPosition - c;
  vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  vec3 p = c + side * position.x * s * 0.5 + vec3(0.0, (position.y + 0.5) * s, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const FLAME_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying float vSeed;
float fbm2(vec2 p) {
  return texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.03 + 0.17).g * 0.3 + texture2D(uNoise, p * 4.1 + 0.53).b * 0.15;
}
void main() {
  vec2 uv = vUv;
  float t = uTime + vSeed * 31.0;
  // turbulence that rises through the flame and tears its top into tongues
  float n = fbm2(vec2(uv.x * 0.55 + vSeed, uv.y * 0.45 - t * 0.42));
  float m = fbm2(vec2(uv.x * 1.1 - vSeed * 2.0, uv.y * 0.9 - t * 0.85));
  float x = uv.x - 0.5 + (n - 0.5) * 0.42 * uv.y;
  // a soft teardrop: wide and hot at the base, narrowing upward
  float w = 0.24 * pow(max(1.0 - uv.y, 0.0), 0.9) + 0.01;
  float across = exp(-pow(x / w, 2.0) * 2.2);
  float up = smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.2, 0.92, uv.y + (m - 0.5) * 0.65));
  float heat = across * up * smoothstep(0.15, 0.85, m + 0.25 * (1.0 - uv.y));
  heat *= 1.0 - smoothstep(0.42, 0.5, abs(uv.x - 0.5));
  if (heat < 0.01) discard;
  // black-body-ish ramp: red edges, orange body, a yellow-white heart low down
  vec3 col = vec3(1.0, 0.22, 0.03) * smoothstep(0.0, 0.35, heat);
  col += vec3(0.0, 0.38, 0.08) * smoothstep(0.25, 0.75, heat);
  col += vec3(0.0, 0.25, 0.32) * smoothstep(0.75, 1.15, heat) * (1.0 - uv.y);
  gl_FragColor = vec4(col * heat * uIntensity * 1.6, 1.0);
}
`;
/**
 * A small open fire: `count` flame billboards round a base point (world), an
 * ember bed, and rising sparks. Additive and unlit; ~3 draw calls.
 */
export function buildFire(ctx, base, opts) {
    const rnd = mulberry32(opts.seed ?? 5);
    const group = new THREE.Group();
    group.name = 'fire';
    group.userData.snow = 0;
    group.userData.noPick = true;
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const data = new Float32Array(opts.count * 4);
    for (let i = 0; i < opts.count; i++) {
        const a = (i / opts.count) * Math.PI * 2 + rnd() * 0.8;
        const r = i === 0 ? 0 : opts.radius * (0.35 + 0.65 * rnd());
        data.set([Math.cos(a) * r, Math.sin(a) * r, rnd(), i === 0 ? 1.0 : 0.45 + rnd() * 0.45], i * 4);
    }
    geo.setAttribute('aFlame', new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = opts.count;
    geo.boundingSphere = new THREE.Sphere(base.clone().add(new THREE.Vector3(0, opts.size * 0.5, 0)), opts.size + opts.radius);
    const intensity = { value: 1 };
    const mat = new THREE.ShaderMaterial({
        name: 'flame',
        uniforms: {
            uBase: { value: base.clone() },
            uSize: { value: opts.size },
            uNoise: { value: ctx.materials.noise },
            uTime: ctx.shared.uTime,
            uIntensity: intensity,
        },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const flames = new THREE.Mesh(geo, mat);
    flames.name = 'flames';
    flames.frustumCulled = true;
    flames.renderOrder = 6;
    flames.raycast = () => { };
    group.add(flames);
    // ember bed: a glowing disc of coals (emissive noise) just above the ground
    let emberMat = null;
    if (opts.embers !== false) {
        const r = opts.radius * 1.6 + 0.08;
        const disc = new THREE.CircleGeometry(r, 20);
        disc.rotateX(-Math.PI / 2);
        disc.translate(base.x, base.y + 0.015, base.z);
        emberMat = new THREE.ShaderMaterial({
            name: 'embers',
            uniforms: { uNoise: { value: ctx.materials.noise }, uTime: ctx.shared.uTime, uIntensity: intensity, uC: { value: new THREE.Vector3(base.x, base.z, r) } },
            vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
            fragmentShader: /* glsl */ `
        uniform sampler2D uNoise; uniform float uTime; uniform float uIntensity; uniform vec3 uC;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz - uC.xy;
          float d = length(p) / uC.z;
          float n = texture2D(uNoise, p * 0.9 + 0.3).g;
          float cell = texture2D(uNoise, p * 3.1 + vec2(uTime * 0.01, 0.0)).r;
          float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + n * 12.0);
          float hot = smoothstep(0.42, 0.72, cell) * (1.0 - smoothstep(0.55, 1.0, d)) * pulse;
          vec3 ash = vec3(0.035, 0.03, 0.028) * (0.6 + 0.6 * n);
          vec3 glow = mix(vec3(0.7, 0.08, 0.01), vec3(1.0, 0.45, 0.08), hot) * hot * 2.2 * uIntensity;
          float a = 1.0 - smoothstep(0.8, 1.0, d);
          gl_FragColor = vec4(ash * (1.0 - hot) + glow, a);
        }`,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        const em = new THREE.Mesh(disc, emberMat);
        em.name = 'embers';
        em.raycast = () => { };
        em.renderOrder = 3;
        group.add(em);
    }
    // sparks: tiny additive points rising and fading (vertex animated)
    const nSp = opts.sparks ?? 0;
    if (nSp > 0) {
        const pos = new Float32Array(nSp * 3);
        const seed = new Float32Array(nSp * 4);
        for (let i = 0; i < nSp; i++) {
            pos.set([base.x, base.y, base.z], i * 3);
            seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
        sg.boundingSphere = new THREE.Sphere(base.clone().add(new THREE.Vector3(0, 2, 0)), 3.5);
        const sm = new THREE.ShaderMaterial({
            name: 'sparks',
            uniforms: { uTime: ctx.shared.uTime, uWind: ctx.shared.uWindDir, uIntensity: intensity, uR: { value: opts.radius }, uPx: { value: 1 } },
            vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uTime; uniform vec2 uWind; uniform float uR; uniform float uPx;
        varying float vA;
        void main() {
          float life = 1.4 + aSeed.y * 1.8;
          float t = fract(uTime / life + aSeed.x);
          float age = t * life;
          vec3 p = position;
          float a = aSeed.z * 6.2831;
          p.xz += vec2(cos(a), sin(a)) * uR * aSeed.w;
          p.y += 0.25 + age * (1.1 + aSeed.w * 0.9) - age * age * 0.12;
          p.xz += uWind * age * 0.45 + vec2(sin(age * 3.0 + a), cos(age * 2.3 + a)) * 0.12 * age;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPx * 0.045 / max(0.3, -mv.z), 1.0, 4.0);
          vA = (1.0 - t) * smoothstep(0.0, 0.05, t) * step(0.35, fract(aSeed.w * 7.3 + floor(uTime / life + aSeed.x) * 0.37));
        }`,
            fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.2, 0.5, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 3.0 * vA * d * uIntensity, 1.0);
        }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const pts = new THREE.Points(sg, sm);
        pts.name = 'sparks';
        pts.raycast = () => { };
        group.add(pts);
        sm.onBeforeRender = (renderer) => {
            sm.uniforms.uPx.value = renderer.domElement.height * renderer.getPixelRatio() * 0.5 / Math.tan(THREE.MathUtils.degToRad(25));
        };
    }
    const fire = {
        object: group,
        level: 1,
        update(t, visible) {
            const flick = 0.85 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1.3) + 0.06 * Math.sin(t * 17.9);
            intensity.value = fire.level * flick;
            group.visible = visible && fire.level > 0.01;
        },
    };
    return fire;
}
/* ------------------------------------------------------------------ */
/* Vapour (steam and smoke)                                            */
/* ------------------------------------------------------------------ */
/**
 * The shared steam kit with two extra lights: a warm glow from below (the
 * tub's water, a fire) fading with height above `glowY`, and the aurora's
 * green wash, so steam and smoke still read at night.
 */
export function vapour(ctx, o, glow) {
    const s = new Steam(ctx, o);
    const mat = s.material;
    mat.uniforms.uVapGlow = { value: glow.color };
    mat.uniforms.uVapY = { value: new THREE.Vector2(glow.y, glow.fade) };
    mat.uniforms.uAuroraLight = ctx.shared.uAuroraLight;
    mat.fragmentShader = mat.fragmentShader
        .replace('uniform float uTime;', 'uniform float uTime;\nuniform vec3 uVapGlow;\nuniform vec2 uVapY;\nuniform vec3 uAuroraLight;')
        .replace('gl_FragColor = vec4(col, a);', `col += uAuroraLight * 0.35 * uTint;
  col += uVapGlow * exp(-max(vWorldPos.y - uVapY.x, 0.0) / uVapY.y);
  gl_FragColor = vec4(col, a);`);
    mat.needsUpdate = true;
    return s;
}
/* ------------------------------------------------------------------ */
/* Hot tub water                                                       */
/* ------------------------------------------------------------------ */
export function waterMaterial(ctx) {
    const s = ctx.shared;
    return new THREE.ShaderMaterial({
        name: 'tubWater',
        uniforms: {
            uSkyCube: s.uSkyCube,
            uTime: s.uTime,
            uNoise: { value: ctx.materials.noise },
            uGlow: { value: new THREE.Color(0, 0, 0) },
            uLightDir: s.uLightDir,
            uLightColor: s.uLightColor,
            uDay: s.uDay,
            uSkyColor: s.uSkyColor,
            uC: { value: new THREE.Vector3() },
        },
        vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
      uniform samplerCube uSkyCube; uniform sampler2D uNoise; uniform float uTime; uniform vec3 uGlow;
      uniform vec3 uLightDir; uniform vec3 uLightColor; uniform float uDay; uniform vec3 uSkyColor; uniform vec3 uC;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz - uC.xy;
        float r = length(p) / uC.z;
        // a calm surface: the faint shiver of convection and a slow wobble from the stove's inflow
        vec2 q = p * 6.0;
        float t = uTime;
        vec2 gr = vec2(
          sin(q.x * 2.3 + t * 1.7) * 0.5 + sin(q.y * 3.1 - t * 1.3 + q.x) * 0.35 + (texture2D(uNoise, p * 1.3 + t * 0.03).r - 0.5),
          cos(q.y * 2.7 + t * 1.5) * 0.5 + cos(q.x * 3.3 + t * 1.1 - q.y) * 0.35 + (texture2D(uNoise, p * 1.3 - t * 0.03).g - 0.5)
        ) * 0.012;
        vec3 N = normalize(vec3(gr.x, 1.0, gr.y));
        vec3 V = normalize(cameraPosition - vW);
        float NdV = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = textureCube(uSkyCube, R).rgb;
        float spec = pow(max(dot(R, normalize(uLightDir)), 0.0), 300.0) * 6.0;
        // the water itself: peaty dark, warm where the light below reaches it, darker at the staves
        vec3 body = vec3(0.006, 0.009, 0.009) * (0.4 + 0.6 * uDay) + uSkyColor * 0.02;
        body += uGlow * (0.7 + 0.3 * smoothstep(1.0, 0.2, r)) * (1.0 - F);
        vec3 col = body * (1.0 - F) + sky * F + uLightColor * spec * F;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
}
/* ------------------------------------------------------------------ */
/* Pools of light on the snow                                          */
/* ------------------------------------------------------------------ */
let poolTex = null;
function poolTexture() {
    if (poolTex)
        return poolTex;
    const n = 128;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
            const e = Math.pow(1 / (1 + r * r * 9), 1.4) * Math.max(0, 1 - r * r) ** 2;
            const v = Math.round(255 * Math.min(1, e));
            const k = (y * n + x) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
            img.data[k + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    poolTex = new THREE.CanvasTexture(c);
    poolTex.colorSpace = THREE.NoColorSpace;
    return poolTex;
}
/**
 * An additive pool of light lying on the ground: an ellipse centred at (x, z)
 * with half axes (rx along `dir`, rz across), conforming to `ground(x, z)`.
 */
export function poolGeometry(x, z, rx, rz, dir, ground, lift = 0.04) {
    const rings = 6;
    const seg = 20;
    const pos = [];
    const uv = [];
    const idx = [];
    const [dx, dz] = dir;
    const at = (u, v) => {
        const px = x + dx * u * rx - dz * v * rz;
        const pz = z + dz * u * rx + dx * v * rz;
        pos.push(px, ground(px, pz) + lift, pz);
        uv.push(0.5 + u / 2, 0.5 + v / 2);
    };
    at(0, 0);
    for (let i = 1; i <= rings; i++) {
        for (let j = 0; j < seg; j++) {
            const a = (j / seg) * Math.PI * 2;
            at((Math.cos(a) * i) / rings, (Math.sin(a) * i) / rings);
        }
    }
    for (let j = 0; j < seg; j++)
        idx.push(0, 1 + ((j + 1) % seg), 1 + j);
    for (let i = 1; i < rings; i++) {
        const a0 = 1 + (i - 1) * seg;
        const b0 = 1 + i * seg;
        for (let j = 0; j < seg; j++) {
            const j1 = (j + 1) % seg;
            idx.push(a0 + j, a0 + j1, b0 + j1, a0 + j, b0 + j1, b0 + j);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // make the winding face up regardless of dir
    g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    if (nrm.getY(0) < 0) {
        const ix = g.index.array;
        for (let i = 0; i < ix.length; i += 3) {
            const t = ix[i + 1];
            ix[i + 1] = ix[i + 2];
            ix[i + 2] = t;
        }
    }
    return g;
}
/* ------------------------------------------------------------------ */
/* Window light on the snow                                            */
/* ------------------------------------------------------------------ */
let paneTex = null;
/**
 * The light of a lit six-light window thrown onto the snow: u runs out from
 * the wall (0 near, 1 far), v across. Two sashes side by side throw a dark
 * stile down the middle; the glazing bars between the three rows of panes
 * throw two softer bands across (the upper panes light the snow further out).
 * Everything blurs with distance (the lamps inside are not points).
 */
function paneTexture() {
    if (paneTex)
        return paneTex;
    const nu = 128;
    const nv = 64;
    const c = document.createElement('canvas');
    c.width = nv;
    c.height = nu;
    const g = c.getContext('2d');
    const img = g.createImageData(nv, nu);
    const ss = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    const vals = [];
    let max = 0;
    for (let j = 0; j < nu; j++) {
        const u = (j + 0.5) / nu;
        for (let i = 0; i < nv; i++) {
            const v = (i + 0.5) / nv;
            const along = ss(0.0, 0.22, u) * Math.pow(1 - u, 1.7);
            const soft = 0.1 + 0.16 * u;
            const across = ss(0, soft, v) * ss(0, soft, 1 - v);
            const stile = 1 - 0.7 * Math.exp(-(((v - 0.5) / (0.03 + 0.05 * u)) ** 2));
            const rows = 1 - 0.5 * Math.exp(-(((u - 0.34) / (0.02 + 0.03 * u)) ** 2)) - 0.45 * Math.exp(-(((u - 0.58) / (0.025 + 0.035 * u)) ** 2));
            const val = along * across * stile * rows;
            vals.push(val);
            max = Math.max(max, val);
        }
    }
    for (let k = 0; k < vals.length; k++) {
        const v = Math.round(255 * Math.min(1, vals[k] / max));
        img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
        img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    paneTex = new THREE.CanvasTexture(c);
    paneTex.colorSpace = THREE.NoColorSpace;
    // row 0 of the canvas is u = 0 (the wall end)
    paneTex.flipY = false;
    return paneTex;
}
/**
 * A window's light lying on the snow in front of it: a trapezoid from `d0` to
 * `d1` metres out from the wall point (x, z) along `out`, `w0` wide at its near
 * edge and `w1` at its far edge, conforming to `ground(x, z)`. uv as paneTexture.
 */
export function windowLightGeometry(x, z, out, d0, d1, w0, w1, ground, lift = 0.05) {
    const nu = 10;
    const nv = 4;
    const [ox, oz] = out;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= nu; j++) {
        const u = j / nu;
        const d = d0 + (d1 - d0) * u;
        const w = w0 + (w1 - w0) * u;
        for (let i = 0; i <= nv; i++) {
            const v = i / nv;
            const s = (v - 0.5) * w;
            const px = x + ox * d - oz * s;
            const pz = z + oz * d + ox * s;
            pos.push(px, ground(px, pz) + lift, pz);
            uv.push(v, u);
        }
    }
    for (let j = 0; j < nu; j++) {
        for (let i = 0; i < nv; i++) {
            const a = j * (nv + 1) + i;
            const b = a + nv + 1;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}
export function windowLightMaterial(color) {
    const m = poolMaterial(color);
    m.name = 'windowLight';
    m.map = paneTexture();
    m.side = THREE.DoubleSide;
    return m;
}
export function poolMaterial(color) {
    const m = new THREE.MeshBasicMaterial({
        name: 'lightPool',
        map: poolTexture(),
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true,
    });
    m.userData.snow = 0;
    return m;
}
