/**
 * The cabin's own lights: lamps with glowing linen shades and bare bulbs,
 * candles (stearin, a flame that leans and gutters, wax glowing round the
 * wick, a soft halo) and storm lanterns. Each light can be switched on its
 * own (click it) and they all follow the room's master switch (the HUD's
 * Lamps toggle, materials.setRoomLight). The brightest of them light the
 * room through the material library's positioned room sources.
 *
 * Positions are house-local; meshes live under the interior's house-local
 * root.
 */
import * as THREE from 'three';
import { HOUSE } from '../../world/layout.js';
import { turned } from './kit.js';
/** most candles / lantern flames */
const MAX_FLAMES = 48;
export class Lights {
    ctx;
    lights = [];
    flamePos = [];
    flameSize = [];
    flameOwner = [];
    /** per-flame brightness (uniform array) */
    uOn = { value: new Float32Array(MAX_FLAMES) };
    waxGeos = [];
    waxOwner = [];
    wax;
    group = new THREE.Group();
    sources = { living: [], glasswing: [] };
    constructor(ctx) {
        this.ctx = ctx;
        this.group.name = 'interior-lights';
        // stearin: creamy, a little translucent; glows round the flame (per candle, from uOn)
        const wax = new THREE.MeshStandardMaterial({ name: 'stearin', color: 0xf1e8d6, roughness: 0.55 });
        const uOn = this.uOn;
        wax.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute vec2 aWax;\nvarying float vWaxGlow;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaxGlow = aWax.y * uWaxOnV[int(aWax.x + 0.5)];`)
                .replace('#include <common>', `#include <common>\nuniform float uWaxOnV[${MAX_FLAMES}];`);
            shader.uniforms.uWaxOnV = uOn;
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vWaxGlow;')
                .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.55, 0.22) * vWaxGlow * 1.6;');
        };
        wax.customProgramCacheKey = () => 'fox-wax-1';
        wax.userData.snow = 0;
        this.wax = wax;
        ctx.materials.registerInterior(wax, 'living', { nightEnv: 0.35 });
    }
    registered = new Set();
    /** Register a light; returns its index. */
    add(def) {
        const st = { def, on: def.on ?? true, level: def.on === false ? 0 : 1, flames: [], source: null };
        // shades, bulbs and lantern glass belong to their room: lit by it, the night sky only faintly in them
        for (const g of def.glow ?? []) {
            if (this.registered.has(g.mat))
                continue;
            this.registered.add(g.mat);
            this.ctx.materials.registerInterior(g.mat, def.zone, { nightEnv: 0.35 });
        }
        if (def.power > 0) {
            const w = def.pos.clone().add(new THREE.Vector3(HOUSE.x, HOUSE.floorY, HOUSE.z));
            st.source = { position: w, kind: def.kind, power: def.power, reach: def.reach ?? 6 };
            this.sources[def.zone].push(st.source);
        }
        this.lights.push(st);
        return this.lights.length - 1;
    }
    /**
     * A candle standing at `base` (house-local; bottom of the wax): its body
     * goes into the shared wax mesh, its flame into the flame set. `light` is
     * the light it belongs to (one switch can carry several candles).
     */
    candle(light, base, h = 0.12, r = 0.011, melted = 0.3) {
        if (this.flamePos.length / 3 >= MAX_FLAMES)
            return;
        const idx = this.flamePos.length / 3;
        // a stearin candle: a slightly hollowed top where it has burned, a drip or two
        const prof = [
            [0, 0],
            [r, 0],
            [r * 1.01, h * 0.5],
            [r * (1 - 0.04 * melted), h - 0.004],
            [r * 0.82, h - 0.0015],
            [r * 0.45, h - 0.004 - 0.006 * melted],
            [0, h - 0.006 - 0.006 * melted],
        ];
        const g = turned(prof, 14);
        g.translate(base.x, base.y, base.z);
        const n = g.getAttribute('position').count;
        const a = new Float32Array(n * 2);
        const pos = g.getAttribute('position');
        for (let i = 0; i < n; i++) {
            const y = pos.getY(i) - base.y;
            a[i * 2] = idx;
            a[i * 2 + 1] = Math.pow(THREE.MathUtils.smoothstep(y, h - 0.05, h), 2.0) * 0.6;
        }
        g.setAttribute('aWax', new THREE.BufferAttribute(a, 2));
        this.waxGeos.push(g);
        this.waxOwner.push(light);
        // wick and flame
        this.flamePos.push(base.x, base.y + h - 0.004, base.z);
        this.flameSize.push(r < 0.02 ? 1 : 1.25);
        this.flameOwner.push(light);
        this.lights[light].flames.push(idx);
    }
    /** a bare flame (a lantern's candle drawn elsewhere, an oil lamp) */
    flame(light, at, size = 1) {
        if (this.flamePos.length / 3 >= MAX_FLAMES)
            return;
        const idx = this.flamePos.length / 3;
        this.flamePos.push(at.x, at.y, at.z);
        this.flameSize.push(size);
        this.flameOwner.push(light);
        this.lights[light].flames.push(idx);
    }
    /** Build the wax, flames and halos; call once after adding everything. */
    build() {
        if (this.waxGeos.length) {
            const pos = [];
            const nor = [];
            const uv = [];
            const wax = [];
            const idx = [];
            for (const g of this.waxGeos) {
                const base = pos.length / 3;
                const p = g.getAttribute('position');
                const n = g.getAttribute('normal');
                const u = g.getAttribute('uv');
                const w = g.getAttribute('aWax');
                for (let i = 0; i < p.count; i++) {
                    pos.push(p.getX(i), p.getY(i), p.getZ(i));
                    nor.push(n.getX(i), n.getY(i), n.getZ(i));
                    uv.push(u.getX(i), u.getY(i));
                    wax.push(w.getX(i), w.getY(i));
                }
                if (g.index)
                    for (let i = 0; i < g.index.count; i++)
                        idx.push(base + g.index.getX(i));
                else
                    for (let i = 0; i < p.count; i++)
                        idx.push(base + i);
                g.dispose();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setAttribute('aWax', new THREE.Float32BufferAttribute(wax, 2));
            geo.setIndex(idx);
            const mesh = new THREE.Mesh(geo, this.wax);
            mesh.name = 'candles';
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            this.group.add(mesh);
        }
        const n = this.flamePos.length / 3;
        if (!n)
            return;
        const quad = new THREE.PlaneGeometry(1, 1);
        const mk = (halo) => {
            const geo = new THREE.InstancedBufferGeometry();
            geo.index = quad.index;
            geo.setAttribute('position', quad.getAttribute('position'));
            const data = new Float32Array(n * 4);
            for (let i = 0; i < n; i++)
                data.set([this.flamePos[i * 3], this.flamePos[i * 3 + 1], this.flamePos[i * 3 + 2], i + this.flameSize[i] * 0.001], i * 4);
            geo.setAttribute('aFlame', new THREE.InstancedBufferAttribute(data, 4));
            const sz = new Float32Array(n);
            for (let i = 0; i < n; i++)
                sz[i] = this.flameSize[i];
            geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sz, 1));
            geo.instanceCount = n;
            const bb = new THREE.Box3();
            for (let i = 0; i < n; i++)
                bb.expandByPoint(new THREE.Vector3(this.flamePos[i * 3], this.flamePos[i * 3 + 1], this.flamePos[i * 3 + 2]));
            geo.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
            geo.boundingSphere.radius += 0.5;
            const mat = new THREE.ShaderMaterial({
                name: halo ? 'candleHalo' : 'candleFlame',
                defines: { HALO: halo ? 1 : 0, MAXF: MAX_FLAMES },
                uniforms: { uTime: this.ctx.shared.uTime, uOn: this.uOn, uNoise: { value: this.ctx.materials.noise } },
                vertexShader: FLAME_VERT,
                fragmentShader: FLAME_FRAG,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = halo ? 'candle-halos' : 'candle-flames';
            mesh.renderOrder = halo ? 8 : 7;
            mesh.raycast = () => { };
            mesh.frustumCulled = true;
            return mesh;
        };
        this.group.add(mk(false));
        this.group.add(mk(true));
        // the room sources: the stove keeps its own slot (set by the caller)
    }
    /** the positioned sources of a zone (the caller prepends the stove's fire) */
    zoneSources(zone) {
        return this.sources[zone];
    }
    find(id) {
        return this.lights.findIndex((l) => l.def.id === id);
    }
    toggle(i) {
        const l = this.lights[i];
        if (l)
            l.on = !l.on;
    }
    /** switch a light; `snap` skips the fade (for lights changed while the room was dark) */
    set(i, on, snap = false) {
        const l = this.lights[i];
        if (!l)
            return;
        l.on = on;
        if (snap)
            l.level = on ? 1 : 0;
    }
    isOn(i) {
        return !!this.lights[i]?.on;
    }
    update(dt, shot) {
        const M = this.ctx.materials;
        const t = this.ctx.shared.uTime.value;
        const master = { living: M.getRoomLight('living').lamps, glasswing: M.getRoomLight('glasswing').lamps };
        for (let i = 0; i < this.lights.length; i++) {
            const l = this.lights[i];
            const target = l.on ? 1 : 0;
            // lamps switch quickly (a filament's warm-up), candles catch slowly
            const rate = l.def.kind === 'lamp' ? 6 : 1.6;
            l.level = shot ? target : l.level + (target - l.level) * Math.min(1, dt * rate);
            const eff = l.level * master[l.def.zone];
            if (l.source)
                l.source.power = l.def.power * l.level;
            const fl = l.def.kind === 'candle' ? 1 + 0.1 * Math.sin(t * 8.3 + i * 2.1) * Math.sin(t * 3.1 + i) : 1;
            if (l.def.glow)
                for (const g of l.def.glow)
                    g.mat.emissiveIntensity = g.k * eff * fl;
            if (l.def.levels)
                for (const g of l.def.levels)
                    g.u.value = g.k * eff;
            for (const f of l.flames)
                this.uOn.value[f] = eff;
        }
    }
}
/* ------------------------------------------------------------------ */
/* Candle flames and halos                                             */
/* ------------------------------------------------------------------ */
const FLAME_VERT = /* glsl */ `
attribute vec4 aFlame; // xyz wick top (parent space), w index
attribute float aSize;
uniform float uTime;
uniform float uOn[MAXF];
varying vec2 vUv;
varying float vOn;
varying float vSeed;
void main() {
  int id = int(aFlame.w);
  vOn = uOn[id];
  vSeed = fract(aFlame.w * 0.618);
  vUv = position.xy + 0.5;
  vec4 mv = modelViewMatrix * vec4(aFlame.xyz, 1.0);
#if HALO
  float s = 0.2 * aSize;
  mv.xy += position.xy * s;
  mv.y += 0.012 * aSize;
  // pull the halo toward the camera so walls behind do not clip it
  mv.xyz += normalize(-mv.xyz) * 0.08;
#else
  float t = uTime * (1.0 + vSeed * 0.4) + vSeed * 30.0;
  float br = 1.0 + 0.08 * sin(t * 11.0) * sin(t * 3.7) + 0.05 * sin(t * 23.0);
  vec2 s = vec2(0.013, 0.042) * aSize * vec2(1.0, br);
  mv.xy += vec2(position.x * s.x, (position.y + 0.5) * s.y);
  mv.x += sin(t * 2.3) * sin(t * 0.9) * 0.0015 * (position.y + 0.5);
#endif
  gl_Position = projectionMatrix * mv;
  if (vOn < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FLAME_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vOn;
varying float vSeed;
void main() {
#if HALO
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float k = exp(-r * r * 9.0) * 0.5 + exp(-r * 4.0) * 0.12;
  k *= 1.0 - smoothstep(0.7, 1.0, r);
  vec3 col = vec3(1.0, 0.55, 0.2) * k * 0.09 * vOn;
  gl_FragColor = vec4(col, 1.0);
#else
  // a teardrop: round at the bottom, drawn to a point at the top; flutters
  float t = uTime + vSeed * 30.0;
  float y = vUv.y;
  float x = (vUv.x - 0.5) * 2.0;
  x += sin(t * 9.0 + y * 4.0) * 0.08 * y * y;
  float w = mix(0.75, 0.0, pow(y, 1.2)) * smoothstep(0.0, 0.18, y) + 0.06 * (1.0 - y);
  float body = 1.0 - smoothstep(w * 0.55, w, abs(x));
  body *= 1.0 - smoothstep(0.82, 1.0, y);
  // white-hot core low in the flame, yellow body, orange tip, a blue skirt at the wick
  float core = (1.0 - smoothstep(0.0, w * 0.45, abs(x))) * smoothstep(0.1, 0.3, y) * (1.0 - smoothstep(0.35, 0.65, y));
  vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.78, 0.38), smoothstep(0.9, 0.3, y));
  col = mix(col, vec3(1.0, 0.95, 0.85), core);
  col += vec3(0.05, 0.1, 0.6) * (1.0 - smoothstep(0.06, 0.2, y)) * (1.0 - smoothstep(0.2, 0.6, abs(x)));
  float k = body * (0.7 + 0.6 * core);
  if (k < 0.01) discard;
  gl_FragColor = vec4(col * k * 9.0 * vOn, 1.0);
#endif
}`;
