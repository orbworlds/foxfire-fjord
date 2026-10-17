/**
 * The interior's palette, fetched once from the material library and lit by
 * the rooms' lamps and stove: oiled and stained pine for the furniture (the
 * floor's plank texture recoloured, no new wood to bake), painted cupboard
 * fronts, cast iron and steel, copper and enamel, stoneware, wax, and the
 * textiles: wool upholstery, plaid throws, sheepskins, a reindeer hide, a rag
 * rug, linen duvets. Each comes in the zone it lives in (`living` for the
 * cabin, `glasswing` for the bedroom under the glass).
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import type { MaterialName } from '../../core/materials';
import { fleeceTextures } from '../../core/textures';
import { duvetCanvas, fireBrickCanvas, hideCanvas, plaidCanvas, ragRugCanvas, spineAtlasCanvas } from './textures';

export type RoomZone = 'living' | 'glasswing';

export interface InteriorMats {
  /** oiled pine (tables, shelves, chairs, bed frames) */
  pine: THREE.MeshStandardMaterial;
  /** darker stained pine (sofa frame, bookshelf, skis) */
  darkWood: THREE.MeshStandardMaterial;
  /** grey-blue painted cupboards and the kitchen fronts */
  painted: THREE.MeshStandardMaterial;
  /** worn red painted chairs, the sled-red skis */
  paintedRed: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  enamelRed: THREE.MeshStandardMaterial;
  enamelWhite: THREE.MeshStandardMaterial;
  stoneware: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  /** worktop: oiled slate */
  slate: THREE.MeshStandardMaterial;
  /** charcoal wool upholstery */
  wool: THREE.MeshStandardMaterial;
  /** oat wool (cushions) */
  woolOat: THREE.MeshStandardMaterial;
  /** red / ochre plaid throws */
  plaidRed: THREE.MeshStandardMaterial;
  plaidGrey: THREE.MeshStandardMaterial;
  sheepskin: THREE.MeshStandardMaterial;
  hide: THREE.MeshStandardMaterial;
  rug: THREE.MeshStandardMaterial;
  linen: THREE.MeshStandardMaterial;
  felt: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  rope: THREE.MeshStandardMaterial;
  birch: THREE.MeshStandardMaterial;
  books: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  /** antler: pale grey-brown, a little polished at the tips */
  bone: THREE.MeshStandardMaterial;
  /** the same set for the glass wing */
  wing: {
    pine: THREE.MeshStandardMaterial;
    darkWood: THREE.MeshStandardMaterial;
    duvet: THREE.MeshStandardMaterial;
    duvetGrey: THREE.MeshStandardMaterial;
    linen: THREE.MeshStandardMaterial;
    wool: THREE.MeshStandardMaterial;
    plaid: THREE.MeshStandardMaterial;
    sheepskin: THREE.MeshStandardMaterial;
    hide: THREE.MeshStandardMaterial;
    rug: THREE.MeshStandardMaterial;
    steel: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    felt: THREE.MeshStandardMaterial;
    books: THREE.MeshStandardMaterial;
    enamel: THREE.MeshStandardMaterial;
    painted: THREE.MeshStandardMaterial;
  };
  /** fire bricks of the firebox (map, for the stove's own shader) */
  brickMap: THREE.Texture;
}

export function interiorMats(ctx: FeatureContext): InteriorMats {
  const M = ctx.materials;
  const small = ctx.quality.textureSize <= 512;
  /** a recoloured clone of a library material, lit as part of a room */
  const room = (name: MaterialName, zone: RoomZone, label: string, set: (m: THREE.MeshStandardMaterial) => void = () => {}) => {
    const m = M.get(name).clone() as THREE.MeshStandardMaterial;
    m.name = `${label}@${zone}`;
    set(m);
    m.userData.snow = 0;
    M.registerInterior(m, zone, { nightEnv: 0.35 });
    return m;
  };
  const plain = (zone: RoomZone, label: string, p: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ name: `${label}@${zone}`, ...p });
    m.userData.snow = 0;
    M.registerInterior(m, zone, { nightEnv: 0.35 });
    return m;
  };
  const tex = (c: HTMLCanvasElement, tile: number) => M.canvasTexture(c, tile, true);

  // textiles painted once, shared by both rooms
  const rugTex = tex(ragRugCanvas(small ? 256 : 512), 1);
  const plaidRedTex = tex(plaidCanvas(small ? 128 : 256, '#8f2f25', '#2f3b33', '#d7b066', '#e8dcc0'), 0.42);
  const plaidGreyTex = tex(plaidCanvas(small ? 128 : 256, '#8d8a80', '#3f4650', '#c6b79a', '#a5452f', 51), 0.46);
  const hideTex = tex(hideCanvas(small ? 256 : 512, small ? 256 : 512), 1);
  hideTex.wrapS = hideTex.wrapT = THREE.ClampToEdgeWrapping;
  hideTex.repeat.set(1, 1);
  const spines = tex(spineAtlasCanvas(24), 1);
  spines.wrapS = spines.wrapT = THREE.ClampToEdgeWrapping;
  spines.repeat.set(1, 1);
  const duvetTex = tex(duvetCanvas(small ? 128 : 256), 0.9);
  const duvetGreyTex = tex(duvetCanvas(small ? 128 : 256, '#b9bec4', '#9aa1a8', 53), 0.9);
  const brickMap = tex(fireBrickCanvas(small ? 128 : 256), 0.24);
  // sheepskin fleece: the library's look from a smaller bake (nothing else in the world wears it)
  const fleece = fleeceTextures(small ? 256 : 512, '#eee5d2');
  const fleeceMap = tex(fleece.map, 0.3);
  const fleeceBump = fleece.bump ? M.canvasTexture(fleece.bump, 0.3, false) : null;
  const sheep = (zone: RoomZone, label: string) => {
    const m = new THREE.MeshPhysicalMaterial({ name: `${label}@${zone}`, color: 0xe6dac4, map: fleeceMap, bumpMap: fleeceBump, bumpScale: 2.2, roughness: 1, sheen: 1, sheenRoughness: 0.55, sheenColor: 0xf0e4cc });
    m.userData.snow = 0;
    M.registerInterior(m, zone, { nightEnv: 0.35 });
    return m;
  };

  const make = (zone: RoomZone) => {
    const pine = room('pineFloor', zone, 'oiledPine', (m) => {
      m.color.set(0xe6d2b4);
      m.roughness = 0.62;
    });
    const darkWood = room('pineFloor', zone, 'stainedPine', (m) => {
      m.color.set(0x7b5a40);
      m.roughness = 0.55;
    });
    // upholstery: a tight woven wool (the linen weave, charcoal), not a chunky knit
    const wool = room('linen', zone, 'charcoalWool', (m) => {
      m.color.set(0x5a667a);
      m.roughness = 1;
      m.bumpScale = 0.8;
    });
    const plaid = room('linen', zone, 'plaid', (m) => {
      m.map = zone === 'living' ? plaidRedTex : plaidGreyTex;
      m.color.set(0xffffff);
      m.roughness = 1;
    });
    const sheepskin = sheep(zone, 'sheepskin');
    const hide = sheep(zone, 'reindeerHide');
    hide.map = hideTex;
    hide.color.set(0xffffff);
    // short straight hair: the painted coat carries it, a bump would only blotch it
    hide.bumpMap = null;
    hide.sheenColor.set(0x6a5a48);
    hide.sheen = 0.5;
    const rug = plain(zone, 'ragRug', { map: rugTex, roughness: 1, bumpMap: rugTex, bumpScale: 1.4 });
    const linen = room('linen', zone, 'linen', (m) => m.color.set(0xf0ebe1));
    const felt = room('felt', zone, 'felt');
    const books = plain(zone, 'books', { map: spines, roughness: 0.8 });
    const steel = room('blackSteel', zone, 'steel');
    const brass = room('brass', zone, 'brass');
    return { pine, darkWood, wool, plaid, sheepskin, hide, rug, linen, felt, books, steel, brass };
  };
  const L = make('living');
  const Wg = make('glasswing');
  const duvet = (zone: RoomZone, t: THREE.Texture, label: string) => {
    const m = room('linen', zone, label, (x) => {
      x.map = t;
      x.color.set(0xffffff);
      x.bumpScale = 0.25;
    });
    return m;
  };

  return {
    pine: L.pine,
    darkWood: L.darkWood,
    painted: plain('living', 'paintedCupboard', { color: 0x8a9ea5, roughness: 0.55 }),
    paintedRed: plain('living', 'paintedRed', { color: 0x8e3326, roughness: 0.6 }),
    iron: room('castIron', 'living', 'stoveIron'),
    steel: L.steel,
    brass: L.brass,
    copper: room('copper', 'living', 'copper'),
    enamelRed: room('enamelRed', 'living', 'enamelRed'),
    enamelWhite: room('enamelWhite', 'living', 'enamelWhite'),
    stoneware: room('stoneware', 'living', 'stoneware'),
    ceramic: room('ceramicWhite', 'living', 'ceramic'),
    slate: plain('living', 'worktop', { color: 0x34373b, roughness: 0.42 }),
    wool: L.wool,
    woolOat: room('linen', 'living', 'oatWool', (m) => {
      m.color.set(0xd6cbb6);
      m.roughness = 1;
      m.bumpScale = 0.9;
    }),
    plaidRed: L.plaid,
    plaidGrey: room('linen', 'living', 'plaidGrey', (m) => {
      m.map = plaidGreyTex;
      m.color.set(0xffffff);
      m.roughness = 1;
    }),
    sheepskin: L.sheepskin,
    hide: L.hide,
    rug: L.rug,
    linen: L.linen,
    felt: L.felt,
    leather: plain('living', 'leather', { color: 0x5a3b26, roughness: 0.5 }),
    rope: room('rope', 'living', 'rope'),
    birch: room('birchBark', 'living', 'birchLogs'),
    books: L.books,
    black: plain('living', 'black', { color: 0x141414, roughness: 0.7 }),
    bone: plain('living', 'antler', { color: 0xb9a68a, roughness: 0.62 }),
    wing: {
      pine: Wg.pine,
      darkWood: Wg.darkWood,
      duvet: duvet('glasswing', duvetTex, 'duvet'),
      duvetGrey: duvet('glasswing', duvetGreyTex, 'duvetGrey'),
      linen: Wg.linen,
      wool: Wg.wool,
      plaid: Wg.plaid,
      sheepskin: Wg.sheepskin,
      hide: Wg.hide,
      rug: Wg.rug,
      steel: Wg.steel,
      brass: Wg.brass,
      felt: Wg.felt,
      books: Wg.books,
      enamel: room('enamelWhite', 'glasswing', 'enamelWhite'),
      painted: plain('glasswing', 'paintedChest', { color: 0x9a8f7c, roughness: 0.55 }),
    },
    brickMap,
  };
}
