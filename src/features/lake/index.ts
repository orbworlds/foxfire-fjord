/**
 * Mirror Lake's winter life on the black ice (the ice, its cracks and the
 * cleared rink are drawn by the terrain): a red ice-fishing hut on runners
 * with a stove pipe smoking and a warm window, two augered holes with a
 * stool, a jigging rod, the auger and a pulk beside it; benches with skates
 * and a lamp pole at the rink's edge; the timber sauna on the west shore
 * with its jetty out to the avanto (an ice hole with a ladder, steaming),
 * ice lanterns along the jetty; and boot-print trails across the snow on
 * the ice between them.
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hitBox } from '../../core/geometry';
import { ICE_HUT, LAKE, RINK, SAUNA } from '../../world/layout';
import { heightAt } from '../../world/terrain-height';
import { vapour, windowLightGeometry, windowLightMaterial } from '../house/fx';
import { steamVisibility } from '../paths/kit/steam';
import { buildLights } from '../spring/lights';
import { driftGeometry } from './drift';
import { buildHut, hutGlowMaterial } from './hut';
import { bootTrails } from './prints';
import { PropBatch, auger, benchSnow, fishingStool, jigRod, lampPole, placeAt, plankBench, pulk, shovel, skates } from './props';
import { buildSauna } from './sauna';

/** a point just outside the rink's snowbank at angle th (rink space), and the outward normal */
function rinkEdge(th: number, out: number): { x: number; z: number; nx: number; nz: number } {
  const c = Math.cos(RINK.rot);
  const s = Math.sin(RINK.rot);
  const lx = Math.cos(th) * RINK.rx;
  const lz = Math.sin(th) * RINK.rz;
  let nx = lx / (RINK.rx * RINK.rx);
  let nz = lz / (RINK.rz * RINK.rz);
  const nl = Math.hypot(nx, nz);
  nx /= nl;
  nz /= nl;
  const wx = nx * c - nz * s;
  const wz = nx * s + nz * c;
  return { x: RINK.x + lx * c - lz * s + wx * out, z: RINK.z + lx * s + lz * c + wz * out, nx: wx, nz: wz };
}

const create: FeatureFactory = (ctx) => {
  const root = new THREE.Group();
  root.name = 'lake';
  const q = ctx.quality;
  const ground = (x: number, z: number) => heightAt(x, z);
  const glow = hutGlowMaterial('lakeWindow');

  /* ---------- the ice-fishing hut ---------- */
  // the door and the window face the south shore (and the lake viewpoint)
  const hutYaw = -0.25;
  const hut = buildHut(
    ctx,
    {
      name: 'lake-icehut',
      x: ICE_HUT.x,
      z: ICE_HUT.z,
      y: ICE_HUT.y + 0.24,
      rotY: hutYaw,
      w: 2.3,
      d: 1.8,
      wallH: 1.85,
      pitch: 0.62,
      eave: 0.25,
      rake: 0.18,
      wall: 'faluRed',
      trim: 'whiteTrim',
      doors: [{ side: 'front', s: -0.45, y: 0, w: 0.68, h: 1.65 }],
      windows: [
        { side: 'front', s: 0.55, y: 0.9, w: 0.42, h: 0.42 },
        { side: 'right', s: 0.0, y: 0.95, w: 0.38, h: 0.38 },
      ],
      pipe: { x: 0.7, z: -0.35, r: 0.05, h: 0.5 },
      base: 'skids',
      baseH: 0.24,
      snow: 0.17,
      icicles: 0.22,
      drifts: true,
      seed: 31,
    },
    glow,
  );
  const props = new PropBatch();
  // augered holes in front of the hut: dark water, a ring of slush and ice chips
  const holes = [hut.toWorld(1.55, 0, 1.55), hut.toWorld(0.35, 0, 2.6)];
  const holeGeos: THREE.BufferGeometry[] = [];
  for (const h of holes) {
    const g = new THREE.CircleGeometry(0.11, 18);
    g.rotateX(-Math.PI / 2);
    g.translate(h.x, LAKE.y + 0.014, h.z);
    holeGeos.push(g);
    // slush and ice chips scooped out and heaped round it in low, uneven heaps
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.sin(k * 2.3 + h.x) * 0.5;
      const r = 0.3 + 0.06 * Math.sin(k * 1.7 + h.z);
      props.add('snowPack', driftGeometry(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r, 0.24, 0.14, 0.06 + 0.02 * Math.sin(k * 3.1), () => LAKE.y, { rot: a + Math.PI / 2, skew: 0, seg: 6, sink: 0.01 }), false);
    }
  }
  {
    const h0 = holes[0];
    const yaw = hutYaw + 0.9;
    props.place(fishingStool(), placeAt(h0.x - 0.45 * Math.cos(yaw), LAKE.y, h0.z + 0.45 * Math.sin(yaw), yaw));
    const rodBase = new THREE.Vector3(h0.x + 0.32, LAKE.y, h0.z + 0.18);
    const m = placeAt(rodBase.x, rodBase.y, rodBase.z, 0);
    props.place(jigRod(h0.x - rodBase.x, h0.z - rodBase.z), m, false);
    const h1 = holes[1];
    props.place(auger(), placeAt(h1.x + 0.55, LAKE.y, h1.z + 0.2, 0.7));
    const pk = hut.toWorld(-1.9, 0, 0.6);
    props.place(pulk(), placeAt(pk.x, LAKE.y, pk.z, hutYaw + 2.6));
  }
  const holeMat = new THREE.MeshStandardMaterial({ name: 'fishingHole', color: 0x040607, roughness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  holeMat.userData.snow = 0;
  const holeMesh = new THREE.Mesh(mergeGeos(holeGeos), holeMat);
  holeMesh.name = 'fishing-holes';

  /* ---------- the rink's edge: benches, skates, a lamp pole, a shovel ---------- */
  const lampLights: THREE.Vector3[] = [];
  {
    for (const [th, k] of [
      [2.05, 0],
      [2.35, 1],
    ] as [number, number][]) {
      const e = rinkEdge(th, 3.0);
      const yaw = Math.atan2(-e.nx, -e.nz);
      const len = 1.5;
      const m = placeAt(e.x, ground(e.x, e.z) - 0.04, e.z, yaw + Math.PI / 2);
      props.place(plankBench(len), m);
      props.add('snowPack', benchSnow(len, m, 50 + k), false);
      if (k === 0) {
        const sm = m.clone().multiply(new THREE.Matrix4().makeTranslation(-0.35, 0.45, 0));
        props.place(skates(9), sm);
      }
    }
    const e = rinkEdge(2.2, 3.4);
    const lp = lampPole(3.4);
    const yaw = Math.atan2(-e.nx, -e.nz) - Math.PI / 2;
    const m = placeAt(e.x, ground(e.x, e.z) - 0.1, e.z, yaw);
    props.place(lp.parts, m);
    lampLights.push(lp.lamp.clone().applyMatrix4(m));
    const sh = rinkEdge(2.6, 1.6);
    props.place(shovel(), placeAt(sh.x, ground(sh.x, sh.z), sh.z, Math.atan2(sh.nx, sh.nz)));
  }

  /* ---------- the sauna and the avanto ---------- */
  const sauna = buildSauna(ctx, props, glow);

  /* ---------- boot prints on the snow over the ice ---------- */
  const rinkW = rinkEdge(Math.PI, 1);
  const rinkE = rinkEdge(0, 1);
  const bench0 = rinkEdge(2.2, 2.0);
  const prints = bootTrails(
    [
      // from the sauna's shore to the rink and its benches
      [
        [268, 99],
        [285, 104],
        [rinkW.x - 1, rinkW.z + 2],
        [bench0.x + 1, bench0.z - 1],
      ],
      // across from the rink to the fishing hut
      [
        [rinkE.x + 1, rinkE.z],
        [400, 130],
        [422, 158],
        [hut.doorSteps[0].x, hut.doorSteps[0].z],
      ],
      // the fisher's own track from the south shore path
      [
        [446, 233],
        [441, 205],
        [436, 182],
        [holes[0].x + 0.5, holes[0].z + 0.6],
      ],
      // round the hole and back to the door
      [
        [holes[0].x - 0.6, holes[0].z + 0.5],
        [hut.doorSteps[0].x + 0.3, hut.doorSteps[0].z + 0.4],
      ],
    ],
    ground,
    17,
  );

  /* ---------- lights: lamp at the rink, ice lanterns along the jetty ---------- */
  const jetty = sauna.ladderTop;
  const jetLanterns = [
    { x: jetty.x - 0.3, y: jetty.y, z: jetty.z - 0.62 },
    { x: (jetty.x + SAUNA.x) / 2 + 2, y: jetty.y, z: jetty.z - 1.0 },
  ];
  const lights = buildLights(ctx, {
    name: 'lake-lights',
    flames: [],
    iceLanterns: jetLanterns.map((l) => ({ ...l, r: 0.1, h: 0.24 })),
    pools: [
      ...lampLights.map((l) => ({ x: l.x, z: l.z, r: 8, k: 1 })),
      { x: sauna.doorLamp.x + 0.6, z: sauna.doorLamp.z, r: 3.2, k: 0.8 },
      { x: jetLanterns[1].x, z: jetLanterns[1].z, r: 2.2, k: 0.7 },
    ],
    ground,
    poolStrength: 0.15,
  });
  // window light on the snow
  const winGroup = new THREE.Group();
  const winMat = windowLightMaterial(0xffa860);
  for (const w of [...hut.windowLights, ...sauna.hut.windowLights]) {
    const g = windowLightGeometry(w.x, w.z, [w.nx, w.nz], 0.2, 2.4, w.w + 0.15, w.w * 3, ground, 0.05);
    const m = new THREE.Mesh(g, winMat);
    m.renderOrder = 2;
    m.raycast = () => {};
    winGroup.add(m);
  }

  /* ---------- smoke and steam ---------- */
  const smokeEmitters = [hut.flue, sauna.hut.flue].filter((f): f is THREE.Vector3 => !!f);
  const smoke = vapour(
    ctx,
    {
      count: q.fancy ? 70 : 40,
      emitters: smokeEmitters.map((f, i) => ({ x: f.x, y: f.y, z: f.z, rx: 0.08, rz: 0.08, weight: i === 1 ? 1.6 : 1 })),
      size: [0.3, 2.2],
      rise: [0.4, 0.7],
      life: [6, 11],
      drift: 0.55,
      opacity: 0.22,
      wander: 0.35,
      seed: 61,
      tint: new THREE.Color(0.7, 0.7, 0.72),
    },
    { color: new THREE.Color(0, 0, 0), y: 0, fade: 1 },
  );
  const hole = SAUNA.iceHole;
  const steam = vapour(
    ctx,
    {
      count: q.fancy ? 80 : 46,
      emitters: [{ x: hole.x, y: LAKE.y + 0.05, z: hole.z, rx: hole.r * 0.8, rz: hole.r * 0.8 }],
      size: [0.5, 2.4],
      rise: [0.2, 0.45],
      life: [5, 9.5],
      drift: 0.35,
      opacity: 0.28,
      wander: 0.35,
      seed: 67,
      tint: new THREE.Color(1, 1, 1),
    },
    { color: new THREE.Color(0.06, 0.035, 0.015), y: LAKE.y + 0.4, fade: 1.2 },
  );
  const steamGlow = steam.material.uniforms.uVapGlow.value as THREE.Color;
  const steamGlowBase = steamGlow.clone();

  /* ---------- assemble ---------- */
  const lampGlass = new THREE.MeshStandardMaterial({ name: 'lampGlass', color: 0x3a2a1a, roughness: 0.25, emissive: 0xffb866, emissiveIntensity: 0 });
  lampGlass.userData.snow = 0;
  const propMeshes = props.build(ctx, 'lake-props', { lampGlass });
  const propsGroup = new THREE.Group();
  propsGroup.add(...propMeshes);
  const icehutGroup = new THREE.Group();
  icehutGroup.name = 'lake-icehut';
  icehutGroup.add(hut.object, holeMesh);
  const saunaGroup = new THREE.Group();
  saunaGroup.name = 'lake-sauna';
  saunaGroup.add(sauna.hut.object, sauna.hole);
  root.add(icehutGroup, saunaGroup, propsGroup, prints, lights.object, winGroup, smoke.mesh, steam.mesh);
  ctx.lod.register(propsGroup, 420, new THREE.Vector3(360, LAKE.y, 110));
  ctx.lod.register(prints, 300, new THREE.Vector3(370, LAKE.y, 140));
  ctx.lod.register(winGroup, 500, new THREE.Vector3(370, LAKE.y, 110));

  /* ---------- walk mode ---------- */
  for (const hb of [hut, sauna.hut]) {
    const cs = hb.corners;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cs[i];
      const [bx, bz] = cs[(i + 1) % 4];
      ctx.colliders.addSegment(ax, az, bx, bz, 0.1);
    }
  }
  for (const c of sauna.circles) ctx.colliders.addCircle(c.x, c.z, c.r, c.yMax !== undefined ? { yMax: c.yMax } : undefined);
  ctx.colliders.addGround(sauna.deckBounds, sauna.deckAt, { priority: 1 });
  for (const l of lampLights) ctx.colliders.addCircle(l.x, l.z, 0.4);

  /* ---------- info cards ---------- */
  const rinkPick = hitBox(RINK.rx * 2, 0.3, RINK.rz * 2);
  rinkPick.position.set(RINK.x, LAKE.y + 0.1, RINK.z);
  rinkPick.rotation.y = -RINK.rot;
  const holePick = hitBox(hole.r * 2 + 0.6, 0.4, hole.r * 2 + 0.6);
  holePick.position.set(hole.x, LAKE.y + 0.1, hole.z);
  const fishPick = new THREE.Group();
  for (const h of holes) {
    const b = hitBox(1.1, 0.8, 1.1);
    b.position.set(h.x, LAKE.y + 0.3, h.z);
    fishPick.add(b);
  }
  root.add(rinkPick, holePick, fishPick, hut.pick, sauna.hut.pick);
  ctx.interaction.register({
    object: hut.pick,
    label: 'Ice-fishing hut',
    maxDistance: 60,
    card: {
      title: 'Ice-fishing hut',
      body: '<p>A red plywood hut on runners, dragged out onto the ice with a snowmobile once it is half a metre thick. Inside: a bench, a little wood stove (the pipe smokes when someone is in), and a hatch in the floor over a hole in the ice. Arctic char and trout come up from the dark water to a jigged lure.</p><p>The owner, a retired ferry captain from Lysvik, leaves the door on the latch: knock, then help yourself to coffee.</p>',
    },
  });
  ctx.interaction.register({
    object: fishPick,
    label: 'Ice fishing',
    maxDistance: 40,
    card: {
      title: 'Augered holes',
      body: '<p>Two holes bored with the hand auger, about fifteen centimetres across: through 60 cm of black ice it takes a minute of hard cranking. A reindeer-skin stool, a short jigging rod with the line going straight down into the dark, and a pulk for the gear and the catch.</p><p>The holes skin over with new ice in an hour; the slush is skimmed off with a ladle.</p>',
    },
  });
  ctx.interaction.register({
    object: rinkPick,
    label: 'Skating rink',
    maxDistance: 120,
    card: {
      title: 'The rink',
      body: '<p>Black ice cleared of snow by shovel and kept smooth by flooding it with a few buckets of lake water on cold nights. The scratches are a winter of skating; the benches and the lamp were carried out in December. Skates are left on the bench for whoever comes.</p><p>Clear ice this thick sings when it cools at night: long, falling, whale-like notes that run across the whole lake.</p>',
    },
  });
  ctx.interaction.register({
    object: sauna.hut.pick,
    label: 'Lake sauna',
    maxDistance: 60,
    card: {
      title: 'Lake sauna',
      body: '<p>A wood-fired sauna of silvered timber on the west shore, with a fieldstone chimney and a stove that takes two hours to bring the room to 80 °C. Throw water on the stones for the löyly, the wave of steam, sit until you cannot bear it, then walk out along the jetty.</p>',
    },
  });
  ctx.interaction.register({
    object: holePick,
    label: 'Avanto',
    maxDistance: 50,
    card: {
      title: 'Avanto',
      body: '<p>A hole kept open in the ice at the end of the jetty, chopped free again every morning. The water underneath is a few degrees above freezing. Down the ladder, under to the shoulders, a few breaths, out. Then back into the sauna, where the heat feels gentle. The steam you see rising is the lake breathing out into air twenty degrees colder.</p>',
    },
  });

  return {
    id: 'lake',
    object: root,
    update(_dt, t) {
      const night = ctx.shared.uNight.value;
      const on = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
      glow.emissiveIntensity = 1.3 * on * (0.95 + 0.05 * Math.sin(t * 2.7) * Math.sin(t * 1.1 + 0.5));
      lampGlass.emissiveIntensity = 2.4 * on;
      winMat.opacity = 0.11 * on;
      winGroup.visible = on > 0.01;
      lights.update(night, t);
      const vis = steamVisibility(ctx);
      smoke.visibility = vis * (0.4 + 0.6 * on);
      steam.visibility = Math.max(0.6, vis);
      steamGlow.copy(steamGlowBase).multiplyScalar(lights.level);
    },
    dispose() {
      lights.dispose();
    },
    api: {
      iceHut: { x: ICE_HUT.x, z: ICE_HUT.z },
      avanto: { x: hole.x, z: hole.z },
    },
  };
};

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)), false)!;
  g.computeBoundingSphere();
  return g;
}

export default create;
