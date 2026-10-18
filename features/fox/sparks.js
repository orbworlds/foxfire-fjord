/**
 * Foxfire: as the legend has it, the fox's brush sweeps the snow into the sky
 * and the sparks become the northern lights. When the fox trots or pounces
 * on an aurora night, a few glittering motes of snow flick up off the tip of
 * its tail, rise a little, glow faintly green and go out. A ring buffer of
 * additive points animated in the vertex shader; the CPU only writes the
 * newly emitted ones.
 */
import * as THREE from 'three';
const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec2 aBirth; // birth time, seed
uniform float uTime;
uniform float uLife;
uniform float uPx;
varying float vA;
varying float vSeed;
void main() {
  float age = uTime - aBirth.x;
  float u = age / (uLife * (0.7 + 0.6 * aBirth.y));
  float alive = step(0.0, age) * step(u, 1.0);
  // flicked up, slowed by the air, then drifting and climbing as they fade
  float k = 1.0 - exp(-age * 2.2);
  vec3 p = position + aVel * k / 2.2;
  p.y += 0.18 * age * age;
  p.x += 0.06 * sin(age * 2.6 + aBirth.y * 40.0) * age;
  p.z += 0.06 * cos(age * 2.1 + aBirth.y * 23.0) * age;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.65 + 0.35 * sin(uTime * (9.0 + 7.0 * aBirth.y) + aBirth.y * 50.0);
  vA = alive * smoothstep(0.0, 0.06, u) * (1.0 - u) * (1.0 - u) * twinkle;
  gl_PointSize = alive * clamp(uPx * (0.02 + 0.016 * aBirth.y) / max(0.2, -mv.z), 1.5, 8.0);
  vSeed = aBirth.y;
}
`;
const FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uGreen;
varying float vA;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = 1.0 - smoothstep(0.1, 0.5, length(c));
  // white-hot snow glints turning aurora green (a rare one red, like the curtains' tops)
  vec3 col = mix(vec3(0.85, 1.0, 0.92), uGreen, 0.55 + 0.4 * vSeed);
  col = mix(col, vec3(1.0, 0.35, 0.45), step(0.93, vSeed) * 0.7);
  gl_FragColor = vec4(col * vA * d * uIntensity * 2.2, 1.0);
}
`;
export class TailSparks {
    mesh;
    pos;
    vel;
    birth;
    n;
    next = 0;
    intensity = { value: 0 };
    time;
    debt = 0;
    constructor(ctx, n = 72) {
        this.n = n;
        this.time = ctx.shared.uTime;
        const g = new THREE.BufferGeometry();
        this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
        this.vel = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
        // born long ago: all dead at start
        const b = new Float32Array(n * 2);
        for (let i = 0; i < n; i++)
            b[i * 2] = -1e4;
        this.birth = new THREE.BufferAttribute(b, 2);
        for (const a of [this.pos, this.vel, this.birth])
            a.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('position', this.pos);
        g.setAttribute('aVel', this.vel);
        g.setAttribute('aBirth', this.birth);
        const mat = new THREE.ShaderMaterial({
            name: 'foxfireSparks',
            uniforms: {
                uTime: ctx.shared.uTime,
                uLife: { value: 1.6 },
                uPx: { value: 600 },
                uIntensity: this.intensity,
                uGreen: { value: new THREE.Color(0.25, 1.0, 0.6) },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        mat.onBeforeRender = (renderer, _s, camera) => {
            const fov = camera.fov ?? 55;
            mat.uniforms.uPx.value = (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
        };
        this.mesh = new THREE.Points(g, mat);
        this.mesh.name = 'fox-sparks';
        this.mesh.frustumCulled = false;
        this.mesh.raycast = () => { };
        this.mesh.renderOrder = 7;
        this.mesh.userData.noMerge = true;
    }
    /** how bright the sparks are (0 by day, up on aurora nights) */
    set level(v) {
        this.intensity.value = v;
        this.mesh.visible = v > 0.01;
    }
    /**
     * Emit `rate` sparks a second (fractional rates accumulate) from `at`,
     * flicked along `dir` with some spread.
     */
    emit(at, dir, rate, dt, speed = 0.9) {
        this.debt += rate * dt;
        let k = 0;
        while (this.debt >= 1 && k < 8) {
            this.debt -= 1;
            k++;
            const i = this.next;
            this.next = (this.next + 1) % this.n;
            const s = Math.random();
            this.pos.setXYZ(i, at.x + (Math.random() - 0.5) * 0.08, at.y + (Math.random() - 0.5) * 0.05, at.z + (Math.random() - 0.5) * 0.08);
            const sp = speed * (0.5 + Math.random() * 0.8);
            this.vel.setXYZ(i, (dir.x + (Math.random() - 0.5) * 0.9) * sp, (dir.y + 0.4 + Math.random() * 0.8) * sp, (dir.z + (Math.random() - 0.5) * 0.9) * sp);
            this.birth.setXY(i, this.time.value, s);
        }
        if (k) {
            this.pos.needsUpdate = true;
            this.vel.needsUpdate = true;
            this.birth.needsUpdate = true;
        }
    }
}
