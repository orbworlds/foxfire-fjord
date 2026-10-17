/**
 * The fox's tracks: a ring buffer of paw prints pressed into the snow as it
 * goes, one instanced draw of multiply-blended decals that fade over a
 * quarter of an hour. Winter paws are furred, so the prints are soft ovals:
 * four toe pads round a heel pad, blue-grey in their hollows. A trotting fox
 * places its hind feet into the front prints ("direct register"), so the
 * trail reads as a single, slightly zig-zag line.
 *
 * Prints lie on the surface the terrain mesh actually draws near the camera
 * (the level-0 triangle grid over exact heights), so they neither float nor
 * sink into the snow between grid points.
 */
import * as THREE from 'three';
import { heightAt } from '../../world/terrain-height';

let pawTex: THREE.Texture | null = null;

function pawTexture(): THREE.Texture {
  if (pawTex) return pawTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  // pads in a unit print (u across, v along, toes toward +v)
  const pads: [number, number, number, number][] = [
    // cx, cy, rx, ry (in 0..1 print space)
    [0.5, 0.36, 0.2, 0.17],
    [0.32, 0.6, 0.085, 0.1],
    [0.68, 0.6, 0.085, 0.1],
    [0.42, 0.75, 0.08, 0.095],
    [0.58, 0.75, 0.08, 0.095],
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      let k = 0;
      for (const [cx, cy, rx, ry] of pads) {
        const d = Math.hypot((u - cx) / rx, (v - cy) / ry);
        k = Math.max(k, 1 - Math.min(1, Math.max(0, (d - 0.55) / 0.7)));
      }
      // the furred foot sinks into the powder as one soft oval hollow, the pads deepest in it
      const oval = Math.hypot((u - 0.5) / 0.34, (v - 0.55) / 0.42);
      const hollow = 1 - Math.min(1, Math.max(0, (oval - 0.55) / 0.45));
      k = Math.max(k, hollow * 0.62);
      const o = (y * S + x) * 4;
      img.data[o] = Math.round(255 - k * 150);
      img.data[o + 1] = Math.round(255 - k * 128);
      img.data[o + 2] = Math.round(255 - k * 82);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  pawTex = new THREE.CanvasTexture(c);
  pawTex.colorSpace = THREE.SRGBColorSpace;
  return pawTex;
}

const VERT = /* glsl */ `
attribute vec4 aPrint; // x, y, z, heading
attribute float aBirth;
uniform float uTime;
uniform float uLife;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  float c = cos(aPrint.w);
  float s = sin(aPrint.w);
  // print size: a fox's winter paw ~6 x 7 cm, a little bigger in soft snow
  vec2 q = position.xy * vec2(0.088, 0.11);
  vec3 p = vec3(aPrint.x + q.x * c + q.y * s, aPrint.y, aPrint.z - q.x * s + q.y * c);
  float age = uTime - aBirth;
  vFade = (1.0 - smoothstep(uLife * 0.55, uLife, age)) * step(0.0, age);
  // pull the decal a few centimetres toward the eye so the drawn snow (coarse far away, rippled near)
  // never swallows it
  vec3 toEye = cameraPosition - p;
  float dist = length(toEye);
  p += toEye / max(dist, 1e-3) * (0.035 + dist * 0.0025);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(mix(vec3(1.0), c, vFade), 1.0);
}
`;

export class PawPrints {
  readonly mesh: THREE.Mesh;
  private print: THREE.InstancedBufferAttribute;
  private birth: THREE.InstancedBufferAttribute;
  private next = 0;
  readonly capacity: number;
  private surface: (x: number, z: number) => number;
  private uTime: { value: number };

  constructor(uTime: { value: number }, capacity: number, gridSpacing: number, life = 900) {
    this.capacity = capacity;
    this.uTime = uTime;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.print = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(-1e9), 1);
    this.print.setUsage(THREE.DynamicDrawUsage);
    this.birth.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPrint', this.print);
    g.setAttribute('aBirth', this.birth);
    g.instanceCount = capacity;
    // prints are scattered over the island: never cull
    const m = new THREE.ShaderMaterial({
      name: 'pawPrints',
      uniforms: { uTime, uLife: { value: life }, uMap: { value: pawTexture() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.MultiplyBlending,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'fox-prints';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.raycast = () => {};
    this.mesh.userData.snow = 0;
    this.mesh.userData.shelter = false;
    this.surface = drawnSurface(gridSpacing);
  }

  /** Press a print at (x, z), toes pointing along `heading` (rad, 0 = +z), made `age` seconds ago. */
  add(x: number, z: number, heading: number, age = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const y = this.surface(x, z) + 0.012;
    this.print.setXYZW(i, x, y, z, heading);
    this.birth.setX(i, this.uTime.value - age);
    this.print.addUpdateRange(i * 4, 4);
    this.birth.addUpdateRange(i, 1);
    this.print.needsUpdate = true;
    this.birth.needsUpdate = true;
  }

  /** after a batch of adds that wrapped around, upload everything */
  flushAll(): void {
    this.print.clearUpdateRanges();
    this.birth.clearUpdateRanges();
    this.print.needsUpdate = true;
    this.birth.needsUpdate = true;
  }
}

/**
 * The terrain surface as drawn by the level-0 grid (spacing `s`, world-aligned,
 * cells split along the b-c diagonal), from exact heights at the grid points.
 */
export function drawnSurface(s: number): (x: number, z: number) => number {
  const cache = new Map<number, number>();
  const H = (i: number, j: number) => {
    const k = i * 131071 + j;
    let v = cache.get(k);
    if (v === undefined) {
      if (cache.size > 20000) cache.clear();
      v = heightAt(i * s, j * s);
      cache.set(k, v);
    }
    return v;
  };
  return (x, z) => {
    const fx = x / s;
    const fz = z / s;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const ha = H(i, j);
    const hb = H(i + 1, j);
    const hc = H(i, j + 1);
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    const hd = H(i + 1, j + 1);
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  };
}
