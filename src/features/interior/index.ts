/**
 * Inside Aurora Cabin: the furnished rooms, lamp- and fire-lit.
 *
 *   stove.ts    the cast-iron wood stove: firebox, logs, flames, door, kettle, flue; log basket, fire irons
 *   fire.ts     the fire's shaders: ray-marched flames, burning logs, coals, bricks, sooty glass, sparks
 *   living.ts   sofa, rag rug, reindeer hide, low table, reading chair and lamp, bookshelf, sideboard, sills
 *   kitchen.ts  cupboards, sink, cooker, shelves, coffee things, pantry, the dining table and its pendant
 *   entry.ts    skis, poles, snowshoes, boots, peg rail, boot bench, door mat
 *   bedroom.ts  the glass wing: two low beds facing the north glass, hides, lanterns
 *   lights.ts   lamps, candles and lanterns: switching, flames, glow, the rooms' light sources
 *   mats.ts     the interior palette; textures.ts its painted textiles; kit.ts / furn.ts geometry
 *
 * Everything is built in house-local metres under one root placed at the
 * house origin, merged into one mesh per material. The stove's fire and the
 * lamps light the rooms through the material library's room sources (soft
 * pools, no shadows); contact shadows ground the furniture. Clicking a lamp,
 * candle or lantern switches it; the stove door opens; the log basket stokes
 * the fire. The house's Lamps / Stove HUD switches stay the master controls.
 */
import * as THREE from 'three';
import type { FeatureFactory } from '../../core/types';
import type { InfoCard } from '../../core/interaction';
import type { RoomSource } from '../../core/materials';
import { HOUSE } from '../../world/layout';
import type { CabinApi } from '../house';
import { Batch, roleAt } from '../house/kit';
import { buildBedroom, BEDS, BED_Z } from './bedroom';
import { INTERIOR_CARDS, type InteriorCardId } from './cards';
import { buildEntry } from './entry';
import { ContactShadows, type Kit } from './furn';
import { buildKitchen, KITCHEN } from './kitchen';
import { Lights } from './lights';
import { buildLiving, LIVING } from './living';
import { interiorMats } from './mats';
import { buildStove } from './stove';

/** Public API (ctx.getFeature<InteriorApi>('interior').api). */
export interface InteriorApi {
  setStoveDoor(open: boolean): void;
  isStoveDoorOpen(): boolean;
  /** put a log on: the fire flares for a while */
  stoke(): void;
  /** lights by id (see `lightIds`): lamps, candles, lanterns */
  setLight(id: string, on: boolean): void;
  isLightOn(id: string): boolean;
  lightIds(): string[];
}

/** labels and cards of the furniture's parts (Batch roles) */
const ROLE: Record<string, { label: string; card: InteriorCardId; once?: boolean }> = {
  stove: { label: 'Wood stove', card: 'stove' },
  flue: { label: 'Stove flue', card: 'stove' },
  kettle: { label: 'Copper kettle', card: 'kettle' },
  basket: { label: 'Birch logs', card: 'basket' },
  tools: { label: 'Fire irons', card: 'tools', once: true },
  sofa: { label: 'Sofa', card: 'sofa' },
  sheepskin: { label: 'Sheepskin', card: 'sheepskin' },
  plaid: { label: 'Wool plaid', card: 'plaid' },
  rug: { label: 'Rag rug', card: 'rug' },
  hide: { label: 'Reindeer hide', card: 'hide' },
  table: { label: 'Low table', card: 'table' },
  chair: { label: 'Reading chair', card: 'chair' },
  lamp: { label: 'Lamp', card: 'lamp' },
  shelf: { label: 'Bookshelf', card: 'shelf' },
  books: { label: 'Books', card: 'books' },
  sideboard: { label: 'Sideboard', card: 'sideboard' },
  antlers: { label: 'Reindeer antlers', card: 'antlers' },
  sill: { label: 'Candles', card: 'candles' },
  kitchen: { label: 'Kitchen', card: 'kitchen' },
  sink: { label: 'Farmhouse sink', card: 'sink' },
  cooker: { label: 'Cooker', card: 'cooker' },
  enamel: { label: 'Coffee kettle', card: 'enamel' },
  grinder: { label: 'Coffee grinder', card: 'grinder' },
  mugs: { label: 'Mugs', card: 'mugs' },
  shelves: { label: 'Open shelves', card: 'mugs' },
  pantry: { label: 'Pantry', card: 'pantry' },
  dining: { label: 'Table by the window', card: 'dining' },
  chairs: { label: 'Chair', card: 'dining', once: true },
  skis: { label: 'Wooden skis', card: 'skis' },
  poles: { label: 'Ski poles', card: 'poles' },
  snowshoes: { label: 'Snowshoes', card: 'snowshoes' },
  boots: { label: 'Winter boots', card: 'boots' },
  pegs: { label: 'Peg rail', card: 'pegs' },
  bench: { label: 'Bench', card: 'bench', once: true },
  mat: { label: 'Rag mat', card: 'mat', once: true },
  bed: { label: 'Bed', card: 'bed' },
  duvet: { label: 'Duvet', card: 'duvet' },
  lantern: { label: 'Storm lantern', card: 'lantern' },
  stool: { label: 'Stool', card: 'lantern', once: true },
  cord: { label: 'Blind cord', card: 'bed', once: true },
  nook: { label: 'Sky-watching corner', card: 'nook' },
  chest: { label: 'Chest of drawers', card: 'bed', once: true },
};

const create: FeatureFactory = async (ctx) => {
  const t0 = performance.now();
  const object = new THREE.Group();
  object.name = 'interior';
  object.userData.snow = 0;
  object.userData.shelter = false;
  const root = new THREE.Group();
  root.name = 'interior-local';
  root.position.set(HOUSE.x, HOUSE.floorY, HOUSE.z);
  root.rotation.y = HOUSE.rotY;
  object.add(root);

  const M = ctx.materials;
  const fancy = ctx.quality.fancy;
  const house = ctx.getFeature<CabinApi>('house')?.api;
  const tm: Record<string, number> = {};
  let tmark = performance.now();
  const lap = (k: string) => {
    const now = performance.now();
    tm[k] = Math.round(now - tmark);
    tmark = now;
  };
  // the build is sliced: give the page a frame between the rooms so loading never stalls for long
  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
  const m = interiorMats(ctx);
  lap('mats');
  await breathe();
  tmark = performance.now();
  const lights = new Lights(ctx);
  const B = new Batch();
  const shadows = new ContactShadows();
  const kit: Kit = { B, shadows };

  /* ------------------------------ build ------------------------------ */
  const stove = buildStove(ctx, m);
  root.add(stove.object);
  lap('stove');
  await breathe();
  tmark = performance.now();
  // the basket of logs north of the stove, the fire irons on the hearth's south corner
  stove.basket.position.set(HOUSE.stove.x - 0.05, 0, HOUSE.stove.z - 1.05);
  stove.tools.position.set(HOUSE.stove.x + 0.42, 0.025, HOUSE.stove.z + 0.55);
  root.add(stove.basket, stove.tools);
  shadows.add(HOUSE.stove.x - 0.05, HOUSE.stove.z - 1.05, 0.5, 0.5, 0, 0.1, 0.5);
  shadows.add(HOUSE.stove.x, HOUSE.stove.z, 0.42, 0.5, 0, 0.12, 0.55, 0.027);
  const living = buildLiving(kit, m, lights, fancy);
  lap('living');
  await breathe();
  tmark = performance.now();
  const kitchen = buildKitchen(kit, m, lights);
  lap('kitchen');
  await breathe();
  tmark = performance.now();
  buildEntry(kit, m, fancy);
  lap('entry');
  const bedroom = buildBedroom(kit, m, lights, fancy);
  lap('bedroom');
  await breathe();
  tmark = performance.now();
  lights.build();

  const furniture = new THREE.Group();
  furniture.name = 'interior-furniture';
  for (const mesh of B.build('interior')) {
    mesh.receiveShadow = true;
    furniture.add(mesh);
  }
  root.add(furniture, lights.group);
  lap('merge');
  const sh = shadows.build('interior-contact-shadows');
  if (sh) root.add(sh);
  if (stove.steam) {
    stove.steam.mesh.userData.snow = 0;
    object.add(stove.steam.mesh);
  }
  const picks = new THREE.Group();
  picks.name = 'interior-light-picks';
  const pickLight = new Map<THREE.Object3D, number>();
  for (const p of [...living.lampPicks, ...kitchen.lampPicks, ...bedroom.lampPicks]) {
    picks.add(p.object);
    pickLight.set(p.object, p.light);
  }
  root.add(picks);
  const cords = new THREE.Group();
  cords.name = 'interior-blind-cords';
  for (const c of bedroom.cords) cords.add(c);
  root.add(cords);

  /* --------------------------- room light ---------------------------- */
  const fireSource: RoomSource = { position: stove.lightPos.clone().add(new THREE.Vector3(HOUSE.x, HOUSE.floorY, HOUSE.z)), kind: 'fire', power: 0.6, reach: 8 };
  const livingSources = [fireSource, ...lights.zoneSources('living')].slice(0, 6);
  if (lights.zoneSources('living').length > 5 || lights.zoneSources('glasswing').length > 6) console.warn('[interior] more room light sources than the material library takes (6 per room)');
  M.setRoomSources('living', livingSources, { fill: 0.08 });
  M.setRoomSources('glasswing', lights.zoneSources('glasswing').slice(0, 6), { fill: 0.35 });

  /* ----------------------------- state ------------------------------- */
  const st = { door: 0, doorOpen: false, stoke: 0 };

  /* -------------------------- interaction ---------------------------- */
  const I = ctx.interaction;
  const seen = new Set<InteriorCardId>();
  const once = (id: InteriorCardId): InfoCard | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    return INTERIOR_CARDS[id];
  };
  const refresh = () => ctx.ui.refreshControls();
  const fireLevel = () => (house ? house.getFire() : 1);
  const api: InteriorApi = {
    setStoveDoor(open) {
      st.doorOpen = open;
      refresh();
    },
    isStoveDoorOpen: () => st.doorOpen,
    stoke() {
      st.stoke = 1;
      if (house && house.getFire() < 0.5) house.setFire(1);
    },
    setLight(id, on) {
      const i = lights.find(id);
      if (i >= 0) lights.set(i, on);
    },
    isLightOn: (id) => lights.isOn(lights.find(id)),
    lightIds: () => lights.lights.map((l) => l.def.id),
  };
  let clicked: string | null = null;
  const roleOf = (hit: THREE.Intersection | null | undefined) => (hit ? roleAt(hit.object, hit.faceIndex) : null);
  I.register({
    object: furniture,
    get label() {
      const r = roleOf(I.hoverHit);
      return r && ROLE[r] ? ROLE[r].label : 'Cabin';
    },
    get action() {
      const r = roleOf(I.hoverHit);
      if (r === 'basket') return 'Put a log on';
      return undefined;
    },
    onClick: (hit) => {
      clicked = roleOf(hit);
      if (clicked === 'basket') api.stoke();
    },
    card: () => {
      const r = clicked && ROLE[clicked];
      if (!r) return null;
      if (clicked === 'basket') return once('basket');
      return r.once ? once(r.card) : INTERIOR_CARDS[r.card];
    },
    maxDistance: 14,
  });
  I.register({
    object: stove.object,
    get label() {
      const h = I.hoverHit;
      if (h && isUnder(h.object, stove.door)) return 'Stove door';
      const r = roleOf(h);
      return r && ROLE[r] ? ROLE[r].label : 'Wood stove';
    },
    get action() {
      const h = I.hoverHit;
      if (h && isUnder(h.object, stove.door)) return st.doorOpen ? 'Close' : 'Open';
      if (fireLevel() < 0.5) return 'Light the fire';
      return undefined;
    },
    onClick: (hit) => {
      clicked = isUnder(hit.object, stove.door) ? 'door' : roleOf(hit);
      if (clicked === 'door') api.setStoveDoor(!st.doorOpen);
      else if (fireLevel() < 0.5 && house) house.setFire(1);
    },
    card: () => {
      if (clicked === 'door') return once('stoveDoor');
      if (clicked === 'kettle') return INTERIOR_CARDS.kettle;
      return INTERIOR_CARDS.stove;
    },
    maxDistance: 12,
  });
  for (const part of [stove.basket, stove.tools]) {
    I.register({
      object: part,
      label: part === stove.basket ? 'Birch logs' : 'Fire irons',
      get action() {
        return part === stove.basket ? 'Put a log on' : undefined;
      },
      onClick: () => {
        if (part === stove.basket) api.stoke();
      },
      card: () => (part === stove.basket ? once('basket') : once('tools')),
      maxDistance: 10,
    });
  }
  I.register({
    object: picks,
    get label() {
      const h = I.hoverHit;
      const i = h ? pickLight.get(h.object) : undefined;
      return i === undefined ? 'Light' : lights.lights[i].def.label;
    },
    get action() {
      const h = I.hoverHit;
      const i = h ? pickLight.get(h.object) : undefined;
      if (i === undefined) return undefined;
      const l = lights.lights[i];
      if (l.def.kind === 'lamp') return l.on ? 'Switch off' : 'Switch on';
      return l.on ? 'Snuff' : 'Light';
    },
    onClick: (hit) => {
      const i = pickLight.get(hit.object);
      if (i === undefined) return;
      const l = lights.lights[i];
      if (house && house.getLamps(l.def.zone) < 0.5) {
        // the room's master switch is off: light just this one (the others stay dark)
        lights.lights.forEach((o, k) => {
          if (o.def.zone === l.def.zone && k !== i) lights.set(k, false, true);
        });
        lights.set(i, true);
        selfSwitch = true;
        house.setLamps(1, l.def.zone);
        selfSwitch = false;
      } else lights.toggle(i);
      clicked = l.def.id;
    },
    card: () => {
      const i = lights.find(clicked ?? '');
      if (i < 0) return null;
      const d = lights.lights[i].def;
      if (d.zone === 'glasswing') return once('lantern');
      return d.kind === 'lamp' ? once('lamp') : once('candles');
    },
    maxDistance: 12,
  });

  // the wing's wool blinds (built by the house): a pull cord by each bed draws or folds them all
  if (house) {
    I.register({
      object: cords,
      label: 'Blind cord',
      get action() {
        return house.getBlindsOpenness() > 0.5 ? 'Draw the blinds' : 'Open to the sky';
      },
      onClick: () => {
        house.setBlinds(house.getBlindsOpenness() > 0.5 ? 'warm' : 'aurora');
      },
      card: () => once('bed'),
      maxDistance: 8,
    });
  }

  // the HUD's master switch turning a dark room's lamps back on lights all of them again
  let selfSwitch = false;
  ctx.events.on('cabin:light', (e: { zone?: string; lamps?: number }) => {
    if (selfSwitch || !e || (e.zone !== 'living' && e.zone !== 'glasswing') || (e.lamps ?? 0) < 0.5) return;
    lights.lights.forEach((o, k) => {
      if (o.def.zone === e.zone && !o.on) lights.set(k, true, true);
    });
  });

  /* ------------------------------- HUD ------------------------------- */
  ctx.ui.addControl({ group: 'house', id: 'cabin-stove-door', label: 'Stove door', kind: 'toggle', active: () => st.doorOpen, onClick: () => api.setStoveDoor(!st.doorOpen) });

  /* ---------------------------- walking ------------------------------ */
  const Cl = ctx.colliders;
  const X = HOUSE.x;
  const Z = HOUSE.z;
  const box = (x0: number, z0: number, x1: number, z1: number) => Cl.addBox(X + Math.min(x0, x1), Z + Math.min(z0, z1), X + Math.max(x0, x1), Z + Math.max(z0, z1), { tag: 'interior' });
  const S = LIVING.sofa;
  box(S.x - S.depth / 2, S.z - S.len / 2, S.x + S.depth / 2, S.z + S.len / 2);
  box(LIVING.table.x - 0.3, LIVING.table.z - 0.52, LIVING.table.x + 0.3, LIVING.table.z + 0.52);
  Cl.addCircle(X + LIVING.chair.x, Z + LIVING.chair.z, 0.42, { tag: 'interior' });
  Cl.addCircle(X + LIVING.lamp.x, Z + LIVING.lamp.z, 0.17, { tag: 'interior' });
  box(LIVING.shelf.x0, LIVING.shelf.z, LIVING.shelf.x1, LIVING.shelf.z + LIVING.shelf.d);
  box(LIVING.sideboard.x - LIVING.sideboard.d, LIVING.sideboard.z0, LIVING.sideboard.x, LIVING.sideboard.z1);
  Cl.addCircle(X + HOUSE.stove.x, Z + HOUSE.stove.z, 0.36, { tag: 'interior' });
  Cl.addCircle(X + HOUSE.stove.x - 0.05, Z + HOUSE.stove.z - 1.05, 0.27, { tag: 'interior' });
  const K = KITCHEN.counter;
  box(K.x0, K.z0, K.x1, K.z1);
  box(K.x0, K.z1, K.x0 + 0.62, KITCHEN.ret.z1);
  box(K.x0, KITCHEN.pantry.z0, K.x0 + KITCHEN.pantry.d, KITCHEN.pantry.z1);
  const T = KITCHEN.table;
  box(K.x0, T.z - T.d / 2 - 0.4, K.x0 + T.w + 0.35, T.z + T.d / 2 + 0.4);
  box(HOUSE.entryX - 1.48, 3.26 - 0.38, HOUSE.entryX - 0.55, 3.26);
  box(-2.62, 3.26 - 0.38, -1.3, 3.26);
  for (const b of BEDS) box(b.x - b.w / 2 - 0.05, BED_Z.foot - 0.05, b.x + b.w / 2 + 0.05, BED_Z.head + 0.1);
  box(-0.2, -3.5 - 1.1 - 0.47, 0.3, -3.5 - 1.1 + 0.47);

  /* ------------------------------ LOD -------------------------------- */
  const center = new THREE.Vector3(HOUSE.x, HOUSE.floorY + 1.5, HOUSE.z - 2);
  ctx.lod.register(root, 140, center);
  if (stove.steam) ctx.lod.register(stove.steam.mesh, 40, center);

  /* ----------------------------- update ------------------------------ */
  const update = (dt: number) => {
    const shot = ctx.params.shot;
    const step = shot ? 1e3 : dt;
    st.door += ((st.doorOpen ? 1 : 0) - st.door) * Math.min(1, step * 3);
    st.stoke = Math.max(0, st.stoke - dt / 25);
    const fire = fireLevel();
    const flick = ctx.shared.uFireFlicker.value;
    stove.update(dt, { fire, door: st.door, stoke: Math.sin(Math.min(1, st.stoke) * Math.PI * 0.5), flicker: flick, shot });
    fireSource.power = 0.6 * (1 + 0.8 * st.door + 0.35 * st.stoke);
    lights.update(dt, shot);
  };
  update(0);

  tm.total = Math.round(performance.now() - t0);
  object.userData.timings = tm;
  if (ctx.params.debug) console.info('[interior] build ms', tm);

  return { id: 'interior', object, update, api };
};

function isUnder(o: THREE.Object3D | null, parent: THREE.Object3D): boolean {
  while (o) {
    if (o === parent) return true;
    o = o.parent;
  }
  return false;
}

export default create;
