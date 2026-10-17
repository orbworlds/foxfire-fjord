/**
 * The hot spring: a natural rock pool of clear teal water on a shelf high on
 * the crag, looking down the fjord to the open sea and north to the Teeth.
 * Steam pours off it into the frost; the rim rocks are wet and black at the
 * water line and white with rime downwind; the melt ring around it (wet
 * gravel, matted grass, moss, islands of slush) is a decal on the shelf (melt.ts)
 * that the grass grows through. Hot water arrives along
 * a split-log trough from between the source boulders. A small red changing
 * hut with a stove, a bench and a sheepskin stands on the shelf's east end;
 * ice lanterns on the rim rocks and two wax torches by the boardwalk are lit
 * after dark, their light glinting on the water and pooling on the snow.
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import { hitBox, mergeByMaterial } from '../../core/geometry';
import { heightAt } from '../../world/terrain-height';
import { vapour, windowLightGeometry, windowLightMaterial } from '../house/fx';
import { ensureGlyphs } from '../paths/kit/text';
import { steamVisibility } from '../paths/kit/steam';
import { buildIcefall } from './icefall';
import { buildLights, type IceLanternSpot } from './lights';
import { ENTRY_PHI, GROUND_Y, POOL, SOURCE_PHI, TROUGH, outlinePoint } from './layout';
import { buildMelt } from './melt';
import { buildPool } from './pool';
import { buildProps, SIGN_TEXT } from './props';
import { buildTrough } from './trough';
import { MAX_GLINTS } from './water';

const angDist = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
};

const create: FeatureFactory = async (ctx) => {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => {
    const t = performance.now();
    timings[k] = Math.round(t - t0);
    t0 = t;
  };
  await ensureGlyphs(SIGN_TEXT);
  lap('glyphs');
  const root = new THREE.Group();
  root.name = 'spring';
  const q = ctx.quality;

  const trough = buildTrough(ctx);
  lap('trough');
  const pool = buildPool(ctx, trough.impact);
  lap('pool');
  const props = buildProps(ctx);
  lap('props');

  /* ---------- lights: ice lanterns on the rim, the torches, pools of light ---------- */
  const lanternPhis = [ENTRY_PHI + 0.62, ENTRY_PHI - 0.6, 0.15, -1.55, SOURCE_PHI + 0.55];
  const lanterns: IceLanternSpot[] = [];
  for (const ph of lanternPhis) {
    let best: (typeof pool.rockInfo)[number] | null = null;
    let bd = Infinity;
    for (const r of pool.rockInfo) {
      if (r.phi === undefined || r.r < 0.36) continue;
      const d = angDist(r.phi, ph);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best && !lanterns.some((l) => Math.hypot(l.x - best!.x, l.z - best!.z) < 0.5)) {
      // stand it on the rock's top, nudged off its crown toward the outside
      const out = outlinePoint(best.phi!, 0);
      const x = best.x + out.nx * best.r * 0.25;
      const z = best.z + out.nz * best.r * 0.25;
      lanterns.push({ x, y: best.top - 0.07, z, r: 0.1 + (lanterns.length % 2) * 0.015, h: 0.22 + (lanterns.length % 3) * 0.03 });
    }
  }
  const ground = (x: number, z: number) => heightAt(x, z);
  const lights = buildLights(ctx, {
    name: 'spring-lights',
    flames: props.flames,
    iceLanterns: lanterns,
    pools: [
      ...props.flames.map((f) => ({ x: f.x, z: f.z, r: 4.2, k: 1 })),
      ...lanterns.map((l) => ({ x: l.x, z: l.z, r: 1.8, k: 0.6 })),
    ],
    ground,
    poolStrength: 0.16,
  });

  // warm glints on the water: torches, lanterns, the hut's window
  const glintSrc: { p: THREE.Vector3; k: number; kind: 'flame' | 'window' }[] = [];
  for (const f of props.flames) glintSrc.push({ p: new THREE.Vector3(f.x, f.y + f.size * 0.4, f.z), k: 1, kind: 'flame' });
  for (const l of lanterns) glintSrc.push({ p: new THREE.Vector3(l.x, l.y + 0.12, l.z), k: 0.35, kind: 'flame' });
  for (const w of props.hut.windowLights) glintSrc.push({ p: new THREE.Vector3(w.x, w.y + 0.25, w.z), k: 0.5, kind: 'window' });
  glintSrc.splice(MAX_GLINTS);

  /* ---------- steam off the pool, the stream and the source ---------- */
  const c = Math.cos(POOL.rot);
  const s = Math.sin(POOL.rot);
  const y = POOL.water + 0.05;
  const along = (k: number) => ({ x: POOL.x + c * k, z: POOL.z + s * k });
  const steam = vapour(
    ctx,
    {
      count: q.fancy ? (q.name === 'medium' ? 170 : 230) : 110,
      emitters: [
        { ...along(0), y, rx: 1.7, rz: 1.7, weight: 2.2 },
        { ...along(1.9), y, rx: 1.2, rz: 1.2, weight: 1.2 },
        { ...along(-1.9), y, rx: 1.2, rz: 1.2, weight: 1.2 },
        { x: trough.impact.x, z: trough.impact.y, y, rx: 0.35, rz: 0.35, weight: 0.45 },
        { x: TROUGH.from.x, z: TROUGH.from.z, y: TROUGH.from.y, rx: 0.3, rz: 0.3, weight: 0.35 },
      ],
      size: [0.7, 3.4],
      rise: [0.25, 0.6],
      life: [6, 11.5],
      drift: 0.42,
      opacity: 0.3,
      wander: 0.45,
      seed: 31,
      tint: new THREE.Color(1.0, 1.0, 1.0),
    },
    { color: new THREE.Color(0.11, 0.06, 0.025), y: POOL.water + 0.3, fade: 1.3 },
  );
  const steamGlow = steam.material.uniforms.uVapGlow.value as THREE.Color;
  const steamGlowBase = steamGlow.clone();

  // a thread of stove smoke from the hut
  const smoke = props.hut.flue
    ? vapour(
        ctx,
        {
          count: q.fancy ? 40 : 24,
          emitters: [{ x: props.hut.flue.x, y: props.hut.flue.y, z: props.hut.flue.z, rx: 0.05, rz: 0.05 }],
          size: [0.25, 1.6],
          rise: [0.35, 0.6],
          life: [6, 10],
          drift: 0.5,
          opacity: 0.2,
          wander: 0.3,
          seed: 47,
          tint: new THREE.Color(0.72, 0.72, 0.74),
        },
        { color: new THREE.Color(0, 0, 0), y: 0, fade: 1 },
      )
    : null;

  // the hut's south window throws its light on the snow toward the arriving path
  let winMat: THREE.MeshBasicMaterial | null = null;
  const winLights = new THREE.Group();
  for (const w of props.hut.windowLights) {
    const g = windowLightGeometry(w.x, w.z, [w.nx, w.nz], 0.2, 2.6, w.w + 0.15, w.w * 3.2, ground, 0.05);
    winMat ??= windowLightMaterial(0xffa860);
    const m = new THREE.Mesh(g, winMat);
    m.renderOrder = 2;
    m.raycast = () => {};
    winLights.add(m);
  }

  /* ---------- assemble: core (seen from afar) and detail ---------- */
  const core = new THREE.Group();
  core.name = 'spring-core';
  const melt = buildMelt(ctx);
  core.add(pool.rim, pool.outer, pool.water, props.hut.object, melt);
  const detail = new THREE.Group();
  detail.name = 'spring-detail';
  const detailRaw = new THREE.Group();
  detailRaw.add(trough.group, props.group);
  detail.add(mergeByMaterial(detailRaw), trough.stream, steam.mesh, lights.object, winLights);
  if (smoke) detail.add(smoke.mesh);
  root.add(core, detail);
  // the overflow frozen down the crag's north face
  lap('lights+steam+merge');
  const icefall = buildIcefall(ctx);
  lap('icefall');
  root.add(icefall);
  ctx.lod.register(icefall, 1400, new THREE.Vector3(POOL.x, GROUND_Y - 25, POOL.z - 8));

  const center = new THREE.Vector3(POOL.x + 3, GROUND_Y + 1, POOL.z);
  ctx.lod.register(core, 900, center);
  ctx.lod.register(detail, 380, center);

  /* ---------- walk mode ---------- */
  for (const r of pool.rockInfo) if (r.r >= 0.3) ctx.colliders.addCircle(r.x, r.z, r.r * 0.8, { yMax: r.top + 0.2 });
  for (const cc of props.circles) ctx.colliders.addCircle(cc.x, cc.z, cc.r, cc.yMax !== undefined ? { yMax: cc.yMax } : undefined);
  {
    const cs = props.hut.corners;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cs[i];
      const [bx, bz] = cs[(i + 1) % 4];
      ctx.colliders.addSegment(ax, az, bx, bz, 0.08);
    }
  }
  for (const e of pool.entry) {
    ctx.colliders.addGround({ minX: e.x - e.r, maxX: e.x + e.r, minZ: e.z - e.r, maxZ: e.z + e.r }, (x, z) => (Math.hypot(x - e.x, z - e.z) <= e.r ? e.top : null));
  }
  ctx.world.reserve({ kind: 'circle', x: POOL.x, z: POOL.z, r: POOL.a + 1.5, tag: 'hot spring' });

  /* ---------- info cards ---------- */
  const poolPick = hitBox(POOL.a * 2 + 1.4, 1.0, POOL.b * 2 + 1.2);
  poolPick.position.set(POOL.x, POOL.water + 0.1, POOL.z);
  poolPick.rotation.y = -POOL.rot;
  const sourcePick = hitBox(0.6, 0.8, 2.2);
  sourcePick.position.set((TROUGH.from.x + TROUGH.to.x) / 2, TROUGH.from.y - 0.1, (TROUGH.from.z + TROUGH.to.z) / 2);
  sourcePick.rotation.y = Math.atan2(TROUGH.to.x - TROUGH.from.x, TROUGH.to.z - TROUGH.from.z);
  const lanternPick = new THREE.Group();
  for (const l of lanterns) {
    const h = hitBox(0.4, 0.45, 0.4);
    h.position.set(l.x, l.y + 0.2, l.z);
    lanternPick.add(h);
  }
  const torchPick = new THREE.Group();
  for (const f of props.flames) {
    const h = hitBox(0.3, 1.4, 0.3);
    h.position.set(f.x, f.y - 0.6, f.z);
    torchPick.add(h);
  }
  const signPick = props.signPick;
  const benchPick = props.benchPick;
  root.add(poolPick, sourcePick, lanternPick, torchPick, props.hut.pick, signPick, benchPick);

  ctx.interaction.register({
    object: poolPick,
    label: 'Hot spring',
    maxDistance: 45,
    card: {
      title: 'Hot spring',
      body:
        '<p><b>39 °C · about 7 × 5 m and a metre deep · open all winter.</b></p>' +
        '<p>Water warmed deep in the old gneiss rises through a crack in the crag and fills a basin held by boulders, a step above the shelf. On its north-west side the shelf ends and the crag drops twenty metres to the strandflat, so from the water you look straight up the fjord to the Teeth.</p>' +
        '<p>In the frost the steam freezes onto every rock downwind as white rime, while the warm ground round the pool stays bare: a ring of wet black rock and bright green moss in the middle of the snow. Soak, climb out, stand in the cold until you steam, and get back in. On a clear night, stay for the lights.</p>',
    },
  });
  ctx.interaction.register({
    object: sourcePick,
    label: 'The source',
    maxDistance: 30,
    card: {
      title: 'The source',
      body: '<p>The water comes up between the big boulders at about 41 °C and runs the last metre along a split spruce log, the hollow worn smooth and stained rust-orange by the iron it carries. Some thirty litres a minute spill in, enough to renew the whole pool in a day; it leaves through the stones on the cliff side and freezes into an icefall below the shelf. Drips that miss the pool hang as icicles under the log.</p>',
    },
  });
  ctx.interaction.register({
    object: props.hut.pick,
    label: 'Changing hut',
    maxDistance: 35,
    card: {
      title: 'Changing hut',
      body: '<p>A red board hut just big enough to change in, with hooks, a slatted floor and a tiny wood stove; the window glows when someone has lit it. Leave your boots by the stove so they are warm when you come out.</p><p>The bench under the window is for cooling off: two minutes in the frost wrapped in the sheepskin, then back into the water.</p>',
    },
  });
  ctx.interaction.register({
    object: lanternPick,
    label: 'Ice lanterns',
    maxDistance: 30,
    card: {
      title: 'Ice lanterns',
      body: '<p>Fill a bucket with water and leave it out on a frosty night: it freezes from the outside in. In the morning tip it out, pour away the water still liquid in the middle, and you have a shell of ice. A tea light inside makes the whole thing glow. Here they stand on the rim rocks; the steam glazes them a little thicker every night.</p>',
    },
  });
  ctx.interaction.register({
    object: torchPick,
    label: 'Wax torches',
    maxDistance: 30,
    card: {
      title: 'Wax torches',
      body: '<p>Two wax torches on birch sticks stuck in the snow light the last metres of the boardwalk. They burn for about four hours, long enough for a soak under the lights, and the snow round them glows orange.</p>',
    },
  });
  ctx.interaction.register({
    object: signPick,
    label: 'Sign',
    maxDistance: 25,
    card: {
      title: 'Varmkilden',
      body: '<p>“Hot spring · 39 °C · Soak, look north, breathe out.” Painted by the people of Lysvik, who have walked up here on winter nights for as long as anyone remembers. Varmkilden simply means “the warm spring”.</p>',
    },
  });
  ctx.interaction.register({
    object: benchPick,
    label: 'Bench',
    maxDistance: 20,
    card: {
      title: 'Cooling-off bench',
      body: '<p>A half log on two birch stumps, with a sheepskin to sit on. Steaming in the frost after a long soak is half the point: your skin tingles, your hair turns white with frost, and the water feels even hotter when you get back in.</p>',
    },
  });

  return {
    id: 'spring',
    object: root,
    update(_dt, t) {
      const night = ctx.shared.uNight.value;
      const vis = steamVisibility(ctx);
      steam.visibility = Math.max(0.75, vis) * 1.05;
      if (smoke) smoke.visibility = vis * 0.8;
      lights.update(night, t);
      const lit = lights.level;
      // the hut's stove and lamp are lit for the evening
      const hutOn = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
      props.glow.emissiveIntensity = 1.35 * hutOn * (0.94 + 0.06 * Math.sin(t * 3.1) * Math.sin(t * 1.3 + 0.4));
      if (winMat) {
        winMat.opacity = 0.12 * hutOn;
        winMat.visible = hutOn > 0.01;
      }
      // the steam is lit warm from below by the lanterns
      steamGlow.copy(steamGlowBase).multiplyScalar(lit);
      const gl = pool.waterMat.glints;
      for (let i = 0; i < MAX_GLINTS; i++) {
        const src = glintSrc[i];
        if (!src) {
          gl[i].w = 0;
          continue;
        }
        gl[i].set(src.p.x, src.p.y, src.p.z, src.k * (src.kind === 'window' ? hutOn : lit));
      }
    },
    dispose() {
      lights.dispose();
    },
    api: { pool: { x: POOL.x, z: POOL.z, water: POOL.water }, timings },
  };
};

export default create;
