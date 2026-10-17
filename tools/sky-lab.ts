/**
 * Sky lab: the engine, the polar sky and the aurora over a stand-in snowy fjord
 * (procedural fells to the north, a frozen fjord, a few dark blocks), for tuning
 * light, aurora and grade without loading the whole world.
 *   /tools/sky-lab.html?shot=1&time=22&aurora=0.7&cam=0,60,0,0,260,-3000
 */
import * as THREE from 'three';
import { params } from '../src/core/params';
import { Engine } from '../src/core/engine';
import { qualityPreset, QUALITY_ORDER } from '../src/core/quality';
import { SkySystem } from '../src/core/sky';
import { shared } from '../src/core/shared';

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridged(x: number, z: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 6; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1);
    s += n * n * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}

function height(x: number, z: number): number {
  // the Teeth: a jagged wall north of the fjord
  const north = THREE.MathUtils.smoothstep(-z, 900, 2200);
  const teeth = ridged(x / 900 + 3.1, z / 900) * 1150 * north;
  // the south shore knoll where the cabin stands, and low fells behind
  const south = THREE.MathUtils.smoothstep(z, -250, 600);
  const fells = (40 + ridged(x / 700, z / 700 + 7) * 260) * south;
  const fjord = -20;
  return Math.max(fjord, teeth + fells - 15);
}

async function main() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const qn = params.quality && QUALITY_ORDER.includes(params.quality) ? params.quality : 'low';
  const quality = qualityPreset(qn);
  const engine = new Engine(canvas, quality);
  const sky = new SkySystem(engine, quality);
  sky.setTime(params.time ?? 21.75);
  sky.speed = params.speed ?? 0;
  const scene = engine.scene;

  const N = 320;
  const S = 14000;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const snow = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.9, 0.95), roughness: 0.85 });
  // rock shows on the steep faces
  snow.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.05, 0.05, 0.055), diffuseColor.rgb, smoothstep(0.55, 0.75, vWN.y));');
  };
  const land = new THREE.Mesh(geo, snow);
  land.receiveShadow = true;
  land.castShadow = false;
  scene.add(land);

  // the frozen fjord: dark glassy ice with some snow
  const ice = new THREE.Mesh(
    new THREE.PlaneGeometry(S, S),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.05, 0.07, 0.09), roughness: 0.12, metalness: 0 }),
  );
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = -2;
  ice.receiveShadow = true;
  scene.add(ice);

  // a few dark cabins and spruce cones near the camera for scale, shadows and the key light
  const tar = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.03, 0.028, 0.026), roughness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.35, 0.03, 0.02), roughness: 0.75 });
  const spruce = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.015, 0.04, 0.025), roughness: 0.9 });
  const win = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 1.1, 0.35) });
  const place = (m: THREE.Mesh, x: number, z: number, lift = 0) => {
    m.position.set(x, height(x, z) + lift, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  place(new THREE.Mesh(new THREE.BoxGeometry(12, 5, 7), tar), 0, 0, 2.5);
  place(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 0.2), win), 0, -3.6, 2.2);
  place(new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), red), 40, 25, 2);
  for (let i = 0; i < 40; i++) {
    const x = (hash(i, 3) - 0.5) * 300;
    const z = 30 + hash(i, 9) * 200;
    const h = 8 + hash(i, 5) * 10;
    place(new THREE.Mesh(new THREE.ConeGeometry(h * 0.28, h, 7), spruce), x, z, h / 2);
  }
  // a sphere of mirror glass to check the sky reflections
  const mirror = new THREE.Mesh(
    new THREE.SphereGeometry(3, 48, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1, envMap: shared.uSkyCube.value as THREE.Texture }),
  );
  place(mirror, -12, -6, 3.2);

  const cam = params.cam && params.cam.length >= 6 ? params.cam : [0, 60, 30, 0, 260, -3000];
  engine.camera.position.set(cam[0], cam[1], cam[2]);
  engine.camera.lookAt(cam[3], cam[4], cam[5]);
  engine.focus.set(0, height(0, 0), 0);

  engine.onUpdate((dt, t) => sky.update(dt, t), 10);
  // ?mapview: the aurora footprint map (sheets in white, diffuse glow in green, fold warp in blue), ±1200 km, north up
  // ?mapview=lin: the same map in linear km, ±mapkm (default 400) around the observer, rings every 100 km
  const mapview = new URLSearchParams(location.search).get('mapview');
  if (mapview !== null) {
    const u = sky.aurora.uniforms;
    const lin = mapview === 'lin';
    const R = Number(new URLSearchParams(location.search).get('mapkm') ?? 400);
    const ov = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { dmap: u.uAurDist, amap: u.uAurAux, cam: u.uAurCam, lin: { value: lin ? 1 : 0 }, R: { value: R } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 1.1 + vec2(0.42, 0.0), 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D dmap; uniform sampler2D amap; uniform vec2 cam; uniform float lin; uniform float R; varying vec2 vUv;
          void main(){
            vec2 uvm = vUv;
            float ring = 0.0;
            if (lin > 0.5) {
              vec2 q = (vUv * 2.0 - 1.0) * R;
              float r = length(q);
              ring = 1.0 - smoothstep(0.0, R * 0.004, abs(fract(r / 100.0 + 0.5) - 0.5) * 100.0);
              q += cam;
              uvm = q * ((1400.0 / 1200.0) / (200.0 + length(q))) * 0.5 + 0.5;
            }
            vec4 d = texture2D(dmap, uvm); vec4 a = texture2D(amap, uvm);
            vec4 l = exp(-d * d / 4.0);
            float sheet = l.x + 0.6 * l.y + 0.4 * l.z + 0.25 * l.w;
            gl_FragColor = vec4(vec3(sheet) * 0.3 + vec3(0.0, a.g * 60.0, 0.0) + vec3(0.0, 0.0, 0.02 + 0.02 * a.r / 50.0) + vec3(0.3, 0.0, 0.0) * ring, 1.0); }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ov.frustumCulled = false;
    ov.renderOrder = 9999;
    scene.add(ov);
  }
  (window as unknown as Record<string, unknown>).foxfire = { engine, sky, shared };
  sky.update(0, 0);
  engine.renderer.compile(scene, engine.camera);
  engine.start();
  let frames = 0;
  const off = engine.onUpdate(() => {
    if (++frames > 4) {
      (window as unknown as Record<string, unknown>).__SCENE_READY__ = true;
      off();
    }
  }, 1000);
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = String(err?.stack ?? err);
});
