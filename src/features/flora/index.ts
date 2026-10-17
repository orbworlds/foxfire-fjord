/**
 * FLORA — the boreal forest of the island: snow-laden Norway spruce in the
 * sheltered valleys, mountain birch on the margins and up to the treeline,
 * juniper and dwarf birch poking out of the snow above it, dried herbs along
 * the paths and lyme grass on Ice Beach.
 *
 *   hero trees      a spruce stand by Aurora Cabin, a snow ghost on the knoll's
 *                   brink, a rimed birch at the hot spring, a rowan with red
 *                   berries by the road into Lysvik (hero.ts; merged mesh)
 *   near forest     the closest scattered trees as instanced geometry
 *                   (tier.ts, refilled as the camera moves, triangle-budgeted)
 *   far forest      baked billboard impostors for the rest of the island,
 *                   snow included (impostors.ts; albedo + normal atlases)
 *
 * Everything samples one canvas-painted atlas plus its snow layer (atlas.ts)
 * and one patched MeshStandardMaterial with wind, bark wrapping and snow on
 * the needles and branches (material.ts). Placement follows the terrain's
 * vegetation mask and is deterministic (placement.ts).
 *
 * API (ctx.getFeature('flora')?.api): stats(), setNearRadius(m), and
 * treesNear(x, z, r) for features that want to know about the trees.
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import type { QualitySettings } from '../../core/quality';
import { buildAtlas } from './atlas';
import { createImpostorMaterials, createPlantMaterials, type SnowUniforms } from './material';
import { buildForestTemplates, TPL_MAX_DIST, TPL_NEAR_CAPS } from './templates';
import { bakeImpostors, buildImpostorChunks, countBelow, measureTemplate } from './impostors';
import { densityThreshold, scatterForest, SMALL_TEMPLATES, TPL, VegMask, type ForestData, type Planting } from './placement';
import { NearTier } from './tier';
import { buildHero, HERO_KEEPOUT } from './hero';
import { CARDS } from './cards';

const frame = () => new Promise<void>((r) => setTimeout(r, 0));

const NEAR: Record<QualitySettings['name'], { radius: number; tris: number }> = {
  low: { radius: 90, tris: 110_000 },
  medium: { radius: 130, tris: 200_000 },
  high: { radius: 170, tris: 300_000 },
  ultra: { radius: 220, tris: 450_000 },
};

export interface TreeHit {
  x: number;
  z: number;
  /** 0 spruce, 1 birch, 2 shrub or herb */
  kind: number;
  /** approximate crown radius (m) */
  r: number;
}

export interface FloraApi {
  stats(): Record<string, unknown>;
  /** override the near-geometry radius (m) */
  setNearRadius(r: number): void;
  /** trees with their trunk within r of (x, z) */
  treesNear(x: number, z: number, r: number, out?: TreeHit[]): TreeHit[];
  /** debug: show the baked impostor atlas (albedo or normal) over the page */
  showBake(normal?: boolean): void;
}

const KIND = [0, 0, 0, 0, 1, 1, 2, 2, 2, 2];
const CROWN = [3.4, 2.4, 1.2, 1.0, 3.2, 2.3, 0.8, 0.5, 0.3, 0.5];

/** A coarse spatial hash over the forest for treesNear(). */
function treeIndex(f: ForestData) {
  const C = 16;
  const cells = new Map<number, number[]>();
  for (let i = 0; i < f.count; i++) {
    const k = Math.floor(f.x[i] / C) * 65536 + Math.floor(f.z[i] / C);
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(i);
  }
  return (x: number, z: number, r: number, out: TreeHit[] = []): TreeHit[] => {
    out.length = 0;
    const c0 = Math.floor((x - r) / C);
    const c1 = Math.floor((x + r) / C);
    const r0 = Math.floor((z - r) / C);
    const r1 = Math.floor((z + r) / C);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const l = cells.get(cx * 65536 + cz);
        if (!l) continue;
        for (const i of l) {
          if ((f.x[i] - x) ** 2 + (f.z[i] - z) ** 2 > r * r) continue;
          const t = f.template[i];
          out.push({ x: f.x[i], z: f.z[i], kind: KIND[t], r: CROWN[t] * f.scale[i] });
        }
      }
    }
    return out;
  };
}

const create: FeatureFactory = async (ctx) => {
  const root = new THREE.Group();
  root.name = 'flora';
  // the trees draw their own snow: no userData.snow here, so the core snow sweep and its
  // shelter bake skip this feature (core/snow.ts DEFAULT_SKIP)
  const q = ctx.quality;
  const t0 = performance.now();
  const ms: Record<string, number> = {};
  let tl = t0;
  const lap = (k: string) => {
    const now = performance.now();
    ms[k] = Math.round(now - tl);
    tl = now;
  };

  const atlas = await buildAtlas(q.textureSize >= 1024 ? 2048 : 1024, Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()));
  lap('atlas');
  await frame();
  const snowU = ctx.materials.snow.uniforms as unknown as SnowUniforms;
  const mats = createPlantMaterials(atlas, ctx.shared, snowU);

  const templates = buildForestTemplates(atlas).map((g, i) => measureTemplate(g, TPL_MAX_DIST[i]));
  lap('templates');
  await frame();
  const bake = bakeImpostors(ctx.renderer, templates, atlas, q.textureSize >= 1024 ? 256 : 128);
  const imp = createImpostorMaterials(bake.albedo, bake.normal, ctx.shared);
  imp.uniforms.uImpCells.value.set(bake.cellsX, bake.cellsY);
  imp.uniforms.uImpSlotsX.value = bake.slotsX;
  templates.forEach((t, i) => imp.uniforms.uImpGeo.value[i].set(t.centerY, t.radius, t.maxDist, 0));
  lap('bake');
  await frame();

  const terrain = ctx.getFeature<{ vegTexture?: THREE.DataTexture; vegInfo?: THREE.Vector4 }>('terrain')?.api;
  const vegImg = terrain?.vegTexture?.image as { data?: ArrayLike<number> } | undefined;
  const veg = terrain?.vegTexture && terrain.vegInfo && vegImg?.data ? new VegMask(terrain.vegTexture, terrain.vegInfo) : null;
  // the trees Lysvik plants in its yards and groves (village api.plantings)
  const planted = ctx.getFeature<{ plantings?: Planting[] }>('village')?.api?.plantings ?? [];
  const forest = await scatterForest(ctx.world, { veg, keepOut: HERO_KEEPOUT, plant: planted });
  lap('scatter');
  await frame();
  const chunks = buildImpostorChunks(forest, templates, imp, 6);
  for (const c of chunks) root.add(c.mesh);

  const near = NEAR[q.name] ?? NEAR.high;
  const tier = new NearTier(forest, templates, mats.plant, mats.plantDepth, imp.uniforms, { radius: near.radius, triBudget: near.tris, caps: TPL_NEAR_CAPS });
  for (const t of SMALL_TEMPLATES) tier.setShadowless(t);
  root.add(tier.group);

  const rowans = planted.filter((p) => p.kind === 'rowan').map((p) => ({ kind: 'rowan' as const, x: p.x, z: p.z, height: p.height, seed: p.seed, force: true }));
  const hero = buildHero(ctx.world, atlas, mats, ctx.colliders, rowans);
  for (const m of hero.meshes) root.add(m);
  for (const g of Object.values(hero.hits)) root.add(g);
  lap('tier+hero');

  const labels: Record<keyof typeof CARDS, string> = { spruce: 'Norway spruce', ghost: 'Snow ghost', birch: 'Mountain birch', rowan: 'Rowan' };
  const offs: (() => void)[] = [];
  for (const key of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
    const object = hero.hits[key];
    if (!object.children.length) continue;
    offs.push(ctx.interaction.register({ object, label: labels[key], action: 'About', card: CARDS[key], maxDistance: 45 }));
  }

  let active = 0;
  const applyQuality = () => {
    const t = densityThreshold(q.vegetationDensity);
    active = countBelow(forest.key, t);
    for (const c of chunks) c.mesh.count = countBelow(c.keys, t);
    tier.setActive(active);
    const nq = NEAR[q.name] ?? NEAR.high;
    tier.radius = nq.radius;
    tier.triBudget = nq.tris;
    mats.uniforms.uWindScale.value = q.fancy ? 1 : 0;
  };
  applyQuality();
  offs.push(ctx.events.on('quality-changed', () => applyQuality()));

  const counts = new Array(templates.length).fill(0);
  for (let i = 0; i < forest.count; i++) counts[forest.template[i]]++;
  const near3 = treeIndex(forest);
  const viewPos = imp.uniforms.uViewPos.value;
  const api: FloraApi = {
    stats: () => ({
      ms: { ...ms, total: Math.round(tl - t0), atlas: atlas.ms },
      forestInstances: forest.count,
      perTemplate: Object.fromEntries(Object.entries(TPL).map(([k, v]) => [k, counts[v]])),
      activeInstances: active,
      impostorChunks: chunks.map((c) => c.mesh.count),
      near: { ...tier.stats },
      heroTriangles: hero.triangles,
      heroes: hero.plants,
      templateTriangles: templates.map((t) => t.triangles),
      vegMask: !!veg,
    }),
    setNearRadius(r: number) {
      tier.radius = r;
      tier.invalidate();
    },
    treesNear: near3,
    showBake(normal = false) {
      const c = bake.toCanvas(ctx.renderer, normal);
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;max-width:100vw;max-height:100vh;background:#808080';
      document.body.appendChild(c);
    },
  };

  return {
    id: 'flora',
    object: root,
    api,
    update() {
      tier.update(ctx.camera);
      viewPos.setFromMatrixPosition(ctx.camera.matrixWorld);
    },
    dispose() {
      for (const off of offs) off();
      tier.dispose();
      bake.dispose();
      atlas.texture.dispose();
      atlas.snow.dispose();
    },
  };
};

export default create;
