/**
 * Where the trail furniture stands: signposts at the junctions (what their
 * arms say and where they point), lantern posts round the cabin, and the
 * spacing of the snow poles that mark each kind of path.
 */
import { FOX_PEAK, HOUSE, SPRING, VILLAGE, type PathKind } from '../../world/layout';

export interface SignArm {
  /** place name on the board */
  en: string;
  /** walking time and direction of travel, e.g. "6 min ↑" */
  time: string;
  /** a world point the arrow points toward (along the path) */
  toward: [number, number];
}

export interface SignDef {
  id: string;
  x: number;
  z: number;
  arms: SignArm[];
  card: { title: string; body: string };
}

const H = (lx: number, lz: number): [number, number] => [HOUSE.x + lx, HOUSE.z + lz];

export const SIGNS: SignDef[] = [
  {
    id: 'cabin-west',
    x: -22.5,
    z: 19.6,
    arms: [
      { en: 'Lysvik', time: '12 min', toward: [-70, 12] },
      { en: 'Hot spring', time: '6 min ↑', toward: [-62, 33] },
    ],
    card: {
      title: 'Trails from the cabin',
      body:
        '<p><b>Lysvik — 12 min.</b> The plowed road follows the bench west and drops 65 m to the harbour at the fjord mouth. The farmer plows it after every storm; the birch poles along the edges show him where the road is.</p>' +
        '<p><b>Hot spring — 6 min ↑.</b> A packed footpath climbs 70 m to a rock pool on a crag above the fjord. The water comes out of the gneiss at about 39 °C.</p>',
    },
  },
  {
    id: 'cabin-east',
    x: 10.5,
    z: 10.2,
    arms: [{ en: 'Mirror Lake', time: '4 min ↑', toward: [62, 24] }],
    card: {
      title: 'Path to Mirror Lake',
      body: '<p><b>Mirror Lake — 4 min ↑.</b> 260 m of packed snow up to the hanging valley. The lake freezes black in December; there is a cleared rink, an ice-fishing hut and a wood-fired sauna on the west shore with a hole cut in the ice.</p>',
    },
  },
  {
    id: 'trailhead',
    x: 522,
    z: 191,
    arms: [
      { en: 'Fox Peak', time: '50 min ↑', toward: [548, 238] },
      { en: 'Aurora Cabin', time: '9 min', toward: [470, 206] },
    ],
    card: {
      title: 'Fox Peak trail',
      body: '<p><b>Fox Peak — 50 min ↑.</b> 1.6 km and 430 m of climbing in switchbacks up the north-west ridge, marked with red-tipped snow poles every twenty metres. The top is wind-scoured rock with a cairn and a bench facing north: the best seat on the island for the northern lights.</p><p>Turn back if the poles ahead disappear in blowing snow.</p>',
    },
  },
  {
    id: 'summit',
    x: FOX_PEAK.x - 6.5,
    z: FOX_PEAK.z - 3.5,
    arms: [
      { en: 'Mirror Lake', time: '35 min ↓', toward: [600, 700] },
      { en: 'Aurora Cabin', time: '45 min ↓', toward: [600, 700] },
    ],
    card: {
      title: 'Fox Peak, 566 m',
      body: '<p>From here the whole fjord lies below you: the cabin on its knoll, the black ice of Mirror Lake, Lysvik at the mouth and the open sea beyond. North, across the water, the Teeth.</p><p>Going down, follow the poles; in flat light the ridge and the sky are the same colour.</p>',
    },
  },
  {
    id: 'lysvik',
    x: -852,
    z: -79,
    arms: [
      { en: 'Ice Beach', time: '8 min', toward: [-930, -66] },
      { en: 'Aurora Cabin', time: '12 min ↑', toward: [-800, -90] },
    ],
    card: {
      title: 'Lysvik',
      body: '<p><b>Ice Beach — 8 min.</b> Over the low neck to the outer coast, where the swell strands blocks of glassy sea ice on black sand.</p><p><b>Aurora Cabin — 12 min ↑.</b> Up the plowed road along the fjord.</p>',
    },
  },
];

/** Lantern posts round the cabin (world xz; the lantern hangs on the arm toward `face`). */
export const LANTERNS: { x: number; z: number; face: [number, number] }[] = [
  { x: H(-4.9, 6.9)[0], z: H(-4.9, 6.9)[1], face: [0.6, -0.8] },
  { x: H(-11.9, 2.6)[0], z: H(-11.9, 2.6)[1], face: [1, 0] },
  { x: H(-16.6, -4.6)[0], z: H(-16.6, -4.6)[1], face: [0.8, -0.6] },
  { x: H(8.6, 7.4)[0], z: H(8.6, 7.4)[1], face: [-0.2, -1] },
  { x: H(27, 16.2)[0], z: H(27, 16.2)[1], face: [-0.4, -0.9] },
  { x: H(-2.5, 11.6)[0], z: H(-2.5, 11.6)[1], face: [0, -1] },
  { x: -27.5, z: 18.9, face: [0.3, -0.95] },
  // beside the start of the boardwalk, out of the hot-spring view
  { x: SPRING.x + 12.5, z: SPRING.z + 3.5, face: [-1, 0.15] },
];

/**
 * Snow poles per path kind: spacing along the path (m), offset from the
 * centreline beyond the walking surface (m), height above the snow (m).
 * Plowed roads get tall birch plow poles on both edges.
 */
export const POLE_RULES: Partial<Record<PathKind, { spacing: number; offset: number; height: number; both: boolean }>> = {
  trail: { spacing: 20, offset: 0.75, height: 1.7, both: false },
  packed: { spacing: 28, offset: 0.8, height: 1.55, both: false },
  plowed: { spacing: 24, offset: 2.3, height: 2.5, both: true },
};

/** No poles within this distance of a path's start near the cabin yard or in Lysvik's streets. */
export const POLE_KEEPOUT = [
  { x: HOUSE.x, z: HOUSE.z, r: 30 },
  { x: VILLAGE.center.x, z: VILLAGE.center.z, r: VILLAGE.radius * 0.75 },
  { x: SPRING.x, z: SPRING.z, r: 16 },
  { x: FOX_PEAK.x, z: FOX_PEAK.z, r: 12 },
];
