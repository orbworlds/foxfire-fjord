/**
 * A carpet of mist lying on flat ice or open water: one horizontal sheet at
 * the floor of a thin slab of fog. Each pixel of the sheet works out how far
 * the view ray runs inside the slab before it reaches that point (the whole
 * way when the eye stands in the fog, slab thickness over the ray's slope when
 * it looks down from above) and turns that path into opacity, so the mist is
 * thin underfoot, thickens toward the far shore and lies flat seen from a
 * summit. A mask texture (lake shoreline, open leads) says where it may lie;
 * two scales of noise drifting with the wind make it patchy.
 */
import * as THREE from 'three';
import { WX_COMMON, WX_COMMON_PARS, sharedUniforms } from './common.js';
const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${WX_COMMON_PARS}
uniform sampler2D uMask;
uniform vec4 uMaskXf;
uniform sampler2D uNoise;
uniform vec2 uDrift;
uniform vec2 uScales;
uniform float uY0;
uniform float uThick;
uniform float uDensity;
uniform float uFloor;
uniform float uLevel;
varying vec3 vWorld;
${WX_COMMON}
void main() {
  vec3 d = vWorld - cameraPosition;
  float dist = length(d);
  vec3 V = d / max(dist, 1e-3);
  float hEye = cameraPosition.y - uY0;
  // the length of the view ray inside the slab [y0, y0 + thick] on its way to this point of the floor
  float path = hEye <= uThick ? dist : uThick / max(-V.y, 0.015);
  path = min(path, 900.0);
  float m = texture2D(uMask, (vWorld.xz - uMaskXf.xy) * uMaskXf.zw).r;
  float n1 = texture2D(uNoise, (vWorld.xz - uDrift) / uScales.x).r;
  float n2 = texture2D(uNoise, (vWorld.xz - uDrift * 1.5) / uScales.y).g;
  float clump = smoothstep(0.3, 0.72, n1 * 0.75 + n2 * 0.45);
  float tau = uDensity * m * (uFloor + (1.0 - uFloor) * clump) * path;
  float a = (1.0 - exp(-tau)) * uLevel;
  // standing in it you see through it close by
  a *= smoothstep(1.5, 25.0, dist);
  if (a < 0.003) discard;
  float mu = dot(V, uLightDir);
  float ma = max(dot(V, uAuroraDir), 0.0);
  // a sea of tiny droplets: lit by the whole sky (the bright horizon most), the key light and the aurora
  float hz = dot(uHorizonColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 amb = uSkyColor * 0.5 + mix(uHorizonColor, vec3(hz), 0.55) * 1.25 + uAuroraLight * (0.32 + 0.5 * ma * ma);
  vec3 col = amb + wxKey(mu, 1.6, 6.0) * 0.9;
  // many bounces wash the tint out of the mist: grey with a breath of blue, a little of the sky's colour left
  col = mix(dot(col, vec3(0.2126, 0.7152, 0.0722)) * vec3(0.93, 0.98, 1.06), col, 0.35) * 1.6;
  gl_FragColor = vec4(col, min(a, 0.92));
  #include <fog_fragment>
}
`;
export class MistLayer {
    ctx;
    mesh;
    material;
    mask;
    drift = new THREE.Vector2();
    speed;
    constructor(ctx, o) {
        this.ctx = ctx;
        const [nx, nz] = o.res;
        const b = o.box;
        const raw = new Float32Array(nx * nz);
        for (let j = 0; j < nz; j++) {
            const z = b.minZ + ((j + 0.5) / nz) * (b.maxZ - b.minZ);
            for (let i = 0; i < nx; i++) {
                const x = b.minX + ((i + 0.5) / nx) * (b.maxX - b.minX);
                raw[j * nx + i] = o.mask(x, z);
            }
        }
        // soften the edges (two box-blur passes) so the mist thins out toward the shores
        const blur = (src) => {
            const out = new Float32Array(src.length);
            for (let j = 0; j < nz; j++) {
                for (let i = 0; i < nx; i++) {
                    let s = 0;
                    let n = 0;
                    for (let dj = -1; dj <= 1; dj++) {
                        for (let di = -1; di <= 1; di++) {
                            const ii = i + di;
                            const jj = j + dj;
                            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz)
                                continue;
                            s += src[jj * nx + ii];
                            n++;
                        }
                    }
                    out[j * nx + i] = s / n;
                }
            }
            return out;
        };
        const soft = blur(blur(raw));
        const bytes = new Uint8Array(nx * nz);
        for (let k = 0; k < bytes.length; k++)
            bytes[k] = Math.round(255 * Math.min(1, Math.max(0, soft[k])));
        this.mask = new THREE.DataTexture(bytes, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
        this.mask.magFilter = THREE.LinearFilter;
        this.mask.minFilter = THREE.LinearFilter;
        this.mask.wrapS = this.mask.wrapT = THREE.ClampToEdgeWrapping;
        this.mask.needsUpdate = true;
        this.speed = o.drift;
        const w = b.maxX - b.minX;
        const d = b.maxZ - b.minZ;
        const geo = new THREE.PlaneGeometry(w, d);
        geo.rotateX(-Math.PI / 2);
        this.material = new THREE.ShaderMaterial({
            name: o.name,
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uMaskXf: { value: new THREE.Vector4(b.minX, b.minZ, 1 / w, 1 / d) },
                    uScales: { value: new THREE.Vector2(o.scales[0], o.scales[1]) },
                    uY0: { value: o.y0 },
                    uThick: { value: o.thick },
                    uDensity: { value: o.density },
                    uFloor: { value: o.floor },
                    uLevel: { value: 1 },
                },
            ]),
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            fog: true,
        });
        Object.assign(this.material.uniforms, sharedUniforms(ctx), { uMask: { value: this.mask }, uNoise: { value: ctx.materials.noise }, uDrift: { value: this.drift } });
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.name = o.name;
        this.mesh.position.set((b.minX + b.maxX) / 2, o.y0 + 0.06, (b.minZ + b.maxZ) / 2);
        this.mesh.renderOrder = 2;
        this.mesh.raycast = () => { };
    }
    update(dt, level) {
        this.mesh.visible = level > 0.004;
        this.material.uniforms.uLevel.value = level;
        const sh = this.ctx.shared;
        const v = this.speed * (0.3 + sh.uWindStrength.value);
        // wrap inside float precision at a whole number of noise tiles (scales divide 2048, and 1.5 x 2048 / 128 is whole)
        this.drift.x = (this.drift.x + sh.uWindDir.value.x * v * dt) % 2048;
        this.drift.y = (this.drift.y + sh.uWindDir.value.y * v * dt) % 2048;
    }
    dispose() {
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.mask.dispose();
    }
}
