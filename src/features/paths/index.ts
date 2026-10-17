/**
 * The trails in winter. The terrain itself carves every path (a packed trench
 * with soft snowbank shoulders, the plowed road between high banks); this
 * feature adds what stands beside them:
 *   - red-tipped snow poles along the footpaths and the Fox Peak trail,
 *   - tall birch plow poles on both edges of the plowed road,
 *   - lantern posts round the cabin, glowing after dark,
 *   - the plank boardwalk out to the hot-spring pool,
 *   - wooden signposts at the junctions.
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import { hitBox } from '../../core/geometry';
import { buildBoardwalks } from './boardwalk';
import { InstanceField } from './field';
import { ensureGlyphs } from './kit/text';
import { buildLanterns } from './lanterns';
import { buildPoles, plowPoleLevels, poleLevels, poleMaterial } from './markers';
import { buildSigns, SIGN_GLYPHS } from './signs';

const create: FeatureFactory = async (ctx) => {
  await ensureGlyphs(SIGN_GLYPHS);
  const root = new THREE.Group();
  root.name = 'paths';

  /* ---------- snow poles ---------- */
  const mat = poleMaterial();
  const trailPoles = new InstanceField('paths-poles', poleLevels(), mat, { cell: 64, castShadow: true, move: 4 });
  const plowPoles = new InstanceField('paths-plow-poles', plowPoleLevels(), mat, { cell: 64, castShadow: true, move: 4 });
  const poles = buildPoles();
  trailPoles.setBatch(poles.trail);
  plowPoles.setBatch(poles.plow);
  root.add(trailPoles.group, plowPoles.group);

  /* ---------- lanterns ---------- */
  const lanterns = buildLanterns();
  root.add(lanterns.object);
  ctx.lod.register(lanterns.object, 600, new THREE.Vector3(0, 74, 0));
  for (const p of lanterns.posts) ctx.colliders.addCircle(p.x, p.z, 0.08, { yMax: p.ground + 1.9 });

  /* ---------- boardwalk ---------- */
  const boards = buildBoardwalks();
  if (boards.object) {
    root.add(boards.object);
    const b = boards.bounds!;
    ctx.lod.register(boards.object, 300, new THREE.Vector3((b.minX + b.maxX) / 2, ctx.world.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2), (b.minZ + b.maxZ) / 2));
    ctx.colliders.addGround(b, boards.deckAt, { priority: 1 });
  }

  /* ---------- signposts ---------- */
  const sites = buildSigns(ctx);
  for (const site of sites) {
    root.add(site.object);
    ctx.lod.register(site.object, 300, site.center);
  }
  for (const site of sites) for (const s of site.signs) ctx.colliders.addCircle(s.def.x, s.def.z, 0.09, { yMax: s.ground + 2.1 });

  /* ---------- info cards ---------- */
  for (const site of sites) {
    for (const s of site.signs) {
      const pick = hitBox(0.9, 2.3, 0.9);
      pick.position.set(s.def.x, s.ground + 1.15, s.def.z);
      root.add(pick);
      ctx.interaction.register({ object: pick, label: s.def.card.title, maxDistance: 25, card: s.def.card });
    }
  }
  const polePick = new THREE.Group();
  const plowPick = new THREE.Group();
  for (const p of poles.spots) {
    const h = hitBox(0.5, p.height, 0.5);
    h.position.set(p.x, p.y + p.height / 2, p.z);
    (p.plow ? plowPick : polePick).add(h);
  }
  root.add(polePick, plowPick);
  ctx.interaction.register({
    object: polePick,
    label: 'Snow poles',
    maxDistance: 18,
    card: {
      title: 'Snow poles',
      body: '<p>In summer the trails are marked with painted stones and cairns; by February they are under a metre of snow. So every autumn the poles go in, about twenty paces apart, with red tops that still show above the drifts.</p><p>In a whiteout you walk from pole to pole: never leave one until you can see the next.</p>',
    },
  });
  ctx.interaction.register({
    object: plowPick,
    label: 'Plow poles',
    maxDistance: 18,
    card: {
      title: 'Plow poles',
      body: '<p>Birch sticks, cut in the autumn and pushed into the verge before the first snow, so the plow driver can find the edges of the road when everything is white. The orange tops catch the headlights.</p><p>The banks the plow throws up grow all winter; by March they can be taller than a person.</p>',
    },
  });
  const lanternPick = new THREE.Group();
  for (const p of lanterns.posts) {
    const h = hitBox(0.6, 2.0, 0.6);
    h.position.set(p.x, p.ground + 1, p.z);
    lanternPick.add(h);
  }
  root.add(lanternPick);
  ctx.interaction.register({
    object: lanternPick,
    label: 'Lantern posts',
    maxDistance: 20,
    card: {
      title: 'Lantern posts',
      body: '<p>Iron storm lanterns on tarred posts light the yard and the first stretch of each path. In the polar night they are lit at three in the afternoon and burn until bedtime; the small pools of warm light on the snow are how you find the way back from the sauna.</p>',
    },
  });

  const refresh = (force: boolean) => {
    const cam = ctx.camera.position;
    trailPoles.update(cam, force);
    plowPoles.update(cam, force);
  };
  refresh(true);

  return {
    id: 'paths',
    object: root,
    update: () => {
      refresh(false);
      lanterns.update(ctx.shared.uNight.value, ctx.shared.uTime.value);
    },
    dispose: () => {
      lanterns.dispose();
      mat.dispose();
    },
    api: {
      poles: poles.spots.length,
      drawn: () => ({ poles: trailPoles.drawn, plowPoles: plowPoles.drawn }),
    },
  };
};

export default create;
