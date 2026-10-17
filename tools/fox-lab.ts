/**
 * Fox lab (development only, not shipped): the arctic fox in a row of poses
 * on a snow plane under a simple sky, for quick screenshots.
 *   tools/fox-lab.html?poses=stand,trot0,trot25,sit,sniff,pounce70&view=side|front|three&shells=12&night=0|1
 * window.__LAB_READY__ is set after a few frames.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { noiseRGBA } from '../src/core/textures';
import { buildFoxBody, B } from '../src/features/fox/body';
import { furMaterials, shellGeometry } from '../src/features/fox/fur';
import { Pose, applyPose, poseStand, poseTrot, poseSit, poseSniff, posePounce } from '../src/features/fox/rig';
import { buildHerd } from '../src/features/fox/reindeer';

const sp = new URLSearchParams(location.search);
const poses = (sp.get('poses') ?? 'stand,trot0,trot25,sit,sniff,pounce68').split(',');
const view = sp.get('view') ?? 'three';
const nShells = Number(sp.get('shells') ?? 12);
const night = sp.get('night') === '1';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x0b1324 : 0x9fb3c8);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = night ? 0.08 : 0.6;
const sun = new THREE.DirectionalLight(night ? 0x9fc2ff : 0xfff1e0, night ? 0.6 : 2.6);
sun.position.set(...((sp.get('light') ?? '-2,3,2.5').split(',').map(Number) as [number, number, number]));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 2;
sun.shadow.camera.bottom = -2;
scene.add(sun);
if (night) scene.add(new THREE.HemisphereLight(0x3aa077, 0x203040, 0.35));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const n = 256;
const noise = new THREE.DataTexture(noiseRGBA(n), n, n, THREE.RGBAFormat);
noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
noise.minFilter = THREE.LinearMipmapLinearFilter;
noise.generateMipmaps = true;
noise.needsUpdate = true;

const t0 = performance.now();
const body = buildFoxBody(0.012);
console.log('fox body', (performance.now() - t0).toFixed(0), 'ms', body.geometry.getAttribute('position').count, 'verts');
const fur = furMaterials(noise);
const shellGeo = shellGeometry(body.geometry, nShells);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0703, roughness: 0.18, envMapIntensity: 0.6 });
const hipsRest = new THREE.Vector3(0, 0.26, -0.13);

const groups: THREE.Group[] = [];
poses.forEach((name) => {
  const b2 = buildFoxBody(0.012);
  const mesh = new THREE.SkinnedMesh(body.geometry, fur.base);
  const shells = new THREE.SkinnedMesh(shellGeo, fur.shell);
  mesh.castShadow = true;
  const skel = new THREE.Skeleton(b2.bones);
  mesh.add(b2.bones[0]);
  mesh.bind(skel);
  shells.bind(skel, mesh.bindMatrix);
  mesh.frustumCulled = shells.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(mesh, shells);
  for (const e of [body.eyes.l, body.eyes.r]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(body.eyes.radius, 12, 8), eyeMat);
    eye.scale.set(1, 0.78, 0.8);
    eye.position.copy(e).sub(new THREE.Vector3(0, 0.355, 0.265));
    b2.bones[B.head].add(eye);
  }
  grp.visible = false;
  scene.add(grp);
  groups.push(grp);
  const p = new Pose();
  const t = Number(sp.get('t') ?? 1.3);
  if (name === 'stand') poseStand(p, t, { yaw: 0, pitch: 0 });
  else if (name.startsWith('trot')) poseTrot(p, Number(name.slice(4)) / 100, 1.5, t);
  else if (name === 'sit') poseSit(p, t, { yaw: 0, pitch: -0.5 });
  else if (name === 'sit0') poseSit(p, t, { yaw: 0.3, pitch: 0 });
  else if (name === 'sniff') poseSniff(p, t);
  else if (name.startsWith('pounce')) posePounce(p, Number(name.slice(6)) / 100, t);
  applyPose(b2.bones, p, hipsRest);
  grp.position.y = Math.max(0, p.lift * 0);
});

// reindeer mode: the herd round the origin, seen from a few metres
if (sp.get('animal') === 'deer') {
  groups.forEach((g) => scene.remove(g));
  groups.length = 0;
  const fakeCtx = { shared: { uTime: { value: 0 }, uSkyColor: { value: new THREE.Color(0.6, 0.7, 0.8) }, uAuroraLight: { value: new THREE.Color(0, 0, 0) }, uLightColor: { value: new THREE.Color(1, 1, 1) } } };
  const herd = buildHerd(fakeCtx as never, fur, (g) => shellGeometry(g, 6), 0, 0, 5, 4, () => true);
  // run the herd for a while so they spread into different states
  for (let i = 0; i < Number(sp.get('steps') ?? 200); i++) herd.update(0.1, i * 0.1);
  herd.object.position.y = -72.0;
  scene.add(herd.object);
  groups.push(herd.object as unknown as THREE.Group);
}

// a contact sheet: one column per pose; rows = views (side profile, three-quarter front, three-quarter back)
const views = (sp.get('views') ?? 'side,front,back').split(',');
const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
const W = innerWidth;
const H = innerHeight;
const cw = Math.floor(W / poses.length);
const ch = Math.floor(H / views.length);
renderer.setScissorTest(true);
let frames = 0;
renderer.setAnimationLoop(() => {
  if (frames >= 3) return;
  groups.forEach((g, i) => {
    groups.forEach((o) => (o.visible = o === g));
    views.forEach((v, r) => {
      const d = sp.get('animal') === 'deer' ? 9 : 1.95;
      if (v === 'side') cam.position.set(d, 0.3, 0.0);
      else if (v === 'front') cam.position.set(d * 0.55, 0.42, d * 0.85);
      else if (v === 'back') cam.position.set(-d * 0.6, 0.55, -d * 0.8);
      else if (v === 'top') cam.position.set(0.01, d * 1.2, 0.0);
      else if (v === 'face') cam.position.set(0.32, 0.4, 0.95);
      else if (v === 'profile') cam.position.set(0.85, 0.36, 0.25);
      if (v === 'face' || v === 'profile') cam.lookAt(0, 0.33, 0.14);
      else cam.lookAt(0, sp.get('animal') === 'deer' ? 0.8 : 0.22, -0.05);
      cam.aspect = cw / ch;
      cam.updateProjectionMatrix();
      const x = i * cw;
      const y = H - (r + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      renderer.render(scene, cam);
    });
  });
  if (++frames === 3) (window as unknown as { __LAB_READY__: boolean }).__LAB_READY__ = true;
});
