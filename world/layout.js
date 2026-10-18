/**
 * Foxfire Fjord site plan: the single source of truth for where everything is.
 *
 * World units are metres. +X = east, -Z = north, +Z = south. Sea level is
 * y = 0. The aurora lives in the north, so the cabin, the hot spring and the
 * summit lookout all face north (-Z) across the fjord to the Teeth.
 *
 *   the Teeth         jagged range north of the fjord, 650-900 m
 *   the fjord         long and steep, from the open sea in the west into the island
 *   Aurora Cabin      on a knoll on the fjord's south shore (house origin)
 *   Mirror Lake       frozen, in a hanging valley east of the cabin
 *   hot spring        a shelf on the fjord's south wall west of the cabin
 *   Lysvik            fishing village at the fjord mouth, south shore
 *   Ice Beach         black sand on the outer west coast
 *   Fox Peak          the south massif's summit lookout
 *
 * Interior features work in HOUSE-LOCAL coordinates: origin at the centre of
 * the main cabin on its finished floor level, axes aligned with world axes:
 *   world = (HOUSE.x + lx, HOUSE.floorY + ly, HOUSE.z + lz)
 *
 * Feature code must never hardcode terrain elevations outside the flat pads
 * declared here; sample `heightAt(x, z)` at runtime instead. This module is
 * pure data (no three): the terrain workers import it.
 */
export const SEA_LEVEL = 0;
/**
 * Prevailing storm wind that shaped the snow (unit xz vector the snow was
 * blown toward): in from the open sea in the west-north-west, up the fjord.
 * Sastrugi run along it, drifts pile on the lee (east-south-east) sides and
 * windward faces are scoured. Matches the default `shared.uWindDir`.
 */
export const SNOW_WIND = { x: 0.8487, z: 0.5289 };
/* ------------------------------------------------------------------ */
/* Aurora Cabin                                                        */
/* ------------------------------------------------------------------ */
/**
 * The hero house, Aurora Cabin: a long, low timber cabin (main volume, steep
 * gable roof with its ridge along X) plus a glass gable wing projecting north
 * from its east half (an A-frame of glass: glazed roof and north end), and a
 * deck along the north side west of the wing. Everything faces north (-Z).
 * Dimensions are outer wall faces; roof heights are the underside of the
 * roof (the ceiling line) above the finished floor.
 */
export const HOUSE = {
    x: 0,
    z: 0,
    /** terrain level of the flat pad around the cabin (world y) */
    groundY: 72,
    /** finished floor level, world y (local y = 0): a 0.6 m fieldstone plinth */
    floorY: 72.6,
    /** the cabin faces north (-Z); rotation of the plan about Y (radians) */
    rotY: 0,
    /** half extents of a box centred on the origin that holds the cabin and the wing (for quick inside tests) */
    halfW: 7.5,
    halfD: 10.6,
    /** main cabin (12 x 7 m), house-local outer wall faces; wallH = eave line, ridgeH = ridge (roof underside) */
    cabin: { minX: -6, maxX: 6, minZ: -3.5, maxZ: 3.5, wallH: 2.7, ridgeH: 6.4 },
    /** glass gable wing (6 x 7 m) projecting north; knee walls wallH, its ridge (along Z) at ridgeH */
    wing: { minX: -0.4, maxX: 5.6, minZ: -10.5, maxZ: -3.5, wallH: 1.1, ridgeH: 5.4 },
    /** north deck (west of the wing), top just below the floor */
    deck: { minX: -7.6, maxX: -0.4, minZ: -9.2, maxZ: -3.5, topY: -0.06 },
    /** where the wood-fired hot tub sits on the deck (local centre, outer radius) */
    hotTub: { x: -5.2, z: -7.0, r: 1.05 },
    /** entry door on the south wall (local x of its centre) */
    entryX: -3.2,
    /** fieldstone chimney breast: rises from the floor through the roof just south of the ridge (local centre, size) */
    chimney: { x: -1.65, z: 0.4, w: 0.86, d: 0.96, topY: 8.15 },
    /**
     * Where the cast-iron wood stove stands (local floor point; rotY turns its front, +Z, to face +X):
     * in front of the chimney breast, its flue going into the breast at ~1.3 m.
     */
    stove: { x: -0.82, z: 0.4, rotY: Math.PI / 2 },
    /** fire pit with log benches, west of the deck on the snow (local) */
    firePit: { x: -13.5, z: -7.5, r: 3.2 },
};
export const HOUSE_OPENINGS = [
    // south front (the yard and the road)
    { id: 'entry', wall: 'south', c: HOUSE.entryX, w: 1.0, sill: 0, head: 2.05, kind: 'door' },
    { id: 'kitchen-s', wall: 'south', c: -5.0, w: 0.8, sill: 1.05, head: 2.05, kind: 'window' },
    { id: 'living-s1', wall: 'south', c: -0.5, w: 1.0, sill: 0.72, head: 2.12, kind: 'window' },
    { id: 'living-s2', wall: 'south', c: 1.9, w: 1.0, sill: 0.72, head: 2.12, kind: 'window' },
    { id: 'living-s3', wall: 'south', c: 4.3, w: 1.0, sill: 0.72, head: 2.12, kind: 'window' },
    // north (the deck and the fjord); the wing covers x -0.4..5.6 of this wall
    { id: 'kitchen-n', wall: 'north', c: -4.9, w: 0.8, sill: 1.05, head: 2.05, kind: 'window' },
    { id: 'deck', wall: 'north', c: -2.6, w: 0.95, sill: 0, head: 2.05, kind: 'glazedDoor' },
    { id: 'deck-side', wall: 'north', c: -1.25, w: 0.55, sill: 0.9, head: 2.05, kind: 'window' },
    { id: 'wing', wall: 'north', c: 2.6, w: 0.95, sill: 0, head: 2.05, kind: 'door' },
    // gables
    { id: 'kitchen-w', wall: 'west', c: 0.9, w: 0.8, sill: 1.05, head: 2.05, kind: 'window' },
    { id: 'attic-w', wall: 'west', c: 0, w: 0.62, sill: 4.0, head: 4.72, kind: 'attic' },
    { id: 'living-e1', wall: 'east', c: -1.5, w: 1.0, sill: 0.72, head: 2.12, kind: 'window' },
    { id: 'living-e2', wall: 'east', c: 1.5, w: 1.0, sill: 0.72, head: 2.12, kind: 'window' },
    { id: 'attic-e', wall: 'east', c: 0, w: 0.62, sill: 4.0, head: 4.72, kind: 'attic' },
];
/** Local bounding box of the whole built footprint (cabin + wing + deck). */
export const HOUSE_FOOTPRINT = { minX: -7.6, maxX: 6, minZ: -10.5, maxZ: 3.5 };
/** Interior zones (house-local, inside the walls). Each interior feature builds only inside its own zone. */
export const ZONES = {
    /** main cabin interior: entry, kitchen nook (west end), living room round the stove */
    living: { minX: -5.76, maxX: 5.76, minZ: -3.26, maxZ: 3.26 },
    /** glass wing: beds facing the north glass (knee walls 1.1 m high on the east and west sides) */
    glasswing: { minX: -0.2, maxX: 5.4, minZ: -10.38, maxZ: -3.5 },
};
export function houseToWorld(lx, ly, lz) {
    return [HOUSE.x + lx, HOUSE.floorY + ly, HOUSE.z + lz];
}
/** Height (local, above the floor) of the underside of the roof at local (x, z); 0 outside the buildings. */
export function roofHeightLocal(lx, lz) {
    const c = HOUSE.cabin;
    const w = HOUSE.wing;
    let h = 0;
    if (lx >= c.minX && lx <= c.maxX && lz >= c.minZ && lz <= c.maxZ) {
        const t = Math.abs(lz - (c.minZ + c.maxZ) / 2) / ((c.maxZ - c.minZ) / 2);
        h = c.ridgeH - (c.ridgeH - c.wallH) * t;
    }
    if (lx >= w.minX && lx <= w.maxX && lz >= w.minZ && lz <= w.maxZ) {
        const t = Math.abs(lx - (w.minX + w.maxX) / 2) / ((w.maxX - w.minX) / 2);
        h = Math.max(h, w.ridgeH - (w.ridgeH - w.wallH) * t);
    }
    return h;
}
/** Interior zone id at house-local (x, z), or null outside the buildings. */
export function houseZoneAt(lx, lz) {
    const inBox = (b) => lx >= b.minX && lx <= b.maxX && lz >= b.minZ && lz <= b.maxZ;
    if (inBox(HOUSE.wing))
        return 'glasswing';
    if (inBox(HOUSE.cabin))
        return 'living';
    return null;
}
/**
 * Mirror Lake: a frozen lake in a hanging valley. Inside the shoreline the
 * terrain is exactly flat at `y` (the ice surface); the terrain feature draws
 * the ice there. The shoreline is an ellipse roughened by noise (see
 * `lakeSd` in terrain-height.ts).
 */
export const LAKE = {
    x: 430,
    z: 105,
    /** half axes of the shoreline ellipse (m) */
    rx: 178,
    rz: 98,
    /** rotation of the long axis from +X toward +Z (radians) */
    rot: -0.12,
    /** ice surface, world y */
    y: 112,
};
/** Lakeside sauna on the west shore (ground pad centre, facing east over the ice) and its ice hole. */
export const SAUNA = { x: 262, z: 92, y: LAKE.y + 1.4, rotY: Math.PI / 2, iceHole: { x: 281, z: 96, r: 1.2 } };
/** Ice-fishing hut out on the ice, in front of the lake viewpoint. */
export const ICE_HUT = { x: 432, z: 165, y: LAKE.y };
/** Cleared skating rink on the ice: an ellipse with soft snowbanks around it. */
export const RINK = { x: 352, z: 112, rx: 34, rz: 19, rot: 0.1 };
/**
 * Hot spring: a natural rock pool on a shelf high on Spring Hill's crag above the
 * strandflat, looking north over the fjord and west down it to the open sea.
 */
export const SPRING = { x: -380, z: -28, y: 120, r: 4.2 };
/** Lysvik, the fishing village at the fjord mouth (south shore). */
export const VILLAGE = {
    center: { x: -870, z: -95 },
    radius: 170,
    /** the partly frozen harbour basin (water) in front of the quay */
    harbor: { x: -880, z: -225 },
    /** quay front: a level strip along the shore at y */
    quay: { minX: -960, maxX: -780, minZ: -178, maxZ: -150, y: 1.8 },
    /** the village ground: a plane rising south from the back of the quay at `grade` */
    slope: { z0: -150, y0: 2.6, grade: 0.09 },
};
/** Lysvik's ground level (world y) at z: streets and gardens between the terraces follow it. */
export function villageGroundY(z) {
    return VILLAGE.slope.y0 + VILLAGE.slope.grade * Math.max(0, z - VILLAGE.slope.z0);
}
function terrace(minX, maxX, minZ, maxZ, falloff) {
    return { minX, maxX, minZ, maxZ, y: Math.round(villageGroundY((minZ + maxZ) / 2) * 10) / 10, falloff };
}
/** Ice Beach: black sand with stranded glassy ice on the outer west coast. */
export const BEACH = {
    center: { x: -1418, z: 132 },
    /** direction the beach faces (toward the sea), unit xz */
    facing: { x: -0.94, z: 0.33 },
    /** approximate along-shore half length (m) */
    halfLength: 120,
    y: 1.4,
};
/** Fox Peak: the south massif's summit, a wind-scoured lookout with a cairn and a bench. */
export const FOX_PEAK = { x: 655, z: 832, y: 567, r: 9 };
/** Alias: the summit lookout where the trail ends. */
export const SUMMIT = FOX_PEAK;
/** Exact-flat pads (y fixed). Features may build on them freely. */
export const SITES = {
    /** the cabin yard: house, deck, fire pit, woodshed */
    cabin: { minX: -20, maxX: 15, minZ: -11, maxZ: 14, y: HOUSE.groundY, falloff: 4 },
    /** hot-spring shelf (pool, changing hut) */
    spring: { minX: SPRING.x - 6.5, maxX: SPRING.x + 13, minZ: SPRING.z - 6, maxZ: SPRING.z + 11, y: SPRING.y, falloff: 4 },
    /** lakeside sauna pad on the west shore */
    sauna: { minX: SAUNA.x - 9, maxX: SAUNA.x + 4, minZ: SAUNA.z - 7, maxZ: SAUNA.z + 7, y: SAUNA.y, falloff: 6 },
    /** Lysvik quay front */
    quay: { ...VILLAGE.quay, falloff: 8 },
    /** Fox Peak summit lookout */
    summit: { minX: FOX_PEAK.x - 7, maxX: FOX_PEAK.x + 7, minZ: FOX_PEAK.z - 6, maxZ: FOX_PEAK.z + 6, y: FOX_PEAK.y, falloff: 10 },
};
/**
 * Lysvik terraces: level house platforms stepping up from the quay (world).
 * The village feature builds on these; heights are exact.
 */
export const VILLAGE_TERRACES = [
    terrace(-955, -880, -148, -118, 6),
    terrace(-872, -795, -146, -114, 6),
    terrace(-940, -860, -108, -74, 7),
    terrace(-850, -770, -104, -70, 7),
    terrace(-905, -830, -62, -26, 8),
];
/** Small snowy rock islets offshore (x, z, height, radius). */
export const SKERRIES = [
    // in the fjord mouth, on the line the hot spring looks down
    { x: -1330, z: -640, h: 14, r: 30 },
    { x: -1282, z: -604, h: 6, r: 14 },
    { x: -1690, z: -830, h: 18, r: 34 },
    { x: -1752, z: -772, h: 8, r: 16 },
    // off the outer coast
    { x: -1690, z: 330, h: 16, r: 30 },
    { x: -1730, z: 380, h: 7, r: 14 },
    { x: -380, z: -2760, h: 18, r: 34 },
    { x: 1700, z: -260, h: 24, r: 38 },
    { x: 1150, z: 1520, h: 12, r: 26 },
];
/** Per-kind carving rules: grade limit, profile smoothing window, shoulder width and snowbank height. */
export const PATH_RULES = {
    packed: { maxGrade: 0.19, windowM: 34, shoulder: 5, bank: 0.32 },
    plowed: { maxGrade: 0.11, windowM: 70, shoulder: 7, bank: 0.85 },
    trail: { maxGrade: 0.42, windowM: 40, shoulder: 6, bank: 0.22 },
    boardwalk: { maxGrade: 0.08, windowM: 12, shoulder: 2.5, bank: 0 },
};
/**
 * A zig-zag trail along a spine: the spine is resampled every `step` metres
 * and alternate points are pushed sideways, with an amplitude that grows
 * from `amp0` to `amp1` toward the top.
 */
function switchbackTrail(spine, step, amp0, amp1) {
    const dense = [];
    for (let i = 0; i < spine.length - 1; i++) {
        const [ax, az] = spine[i];
        const [bx, bz] = spine[i + 1];
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
        for (let k = 0; k < n; k++)
            dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    dense.push(spine[spine.length - 1]);
    const out = [];
    const last = dense.length - 1;
    for (let i = 0; i <= last; i++) {
        const [x, z] = dense[i];
        if (i < 1 || i > last - 1) {
            out.push([x, z]);
            continue;
        }
        const [px, pz] = dense[i - 1];
        const [nx, nz] = dense[i + 1];
        const dx = nx - px;
        const dz = nz - pz;
        const len = Math.hypot(dx, dz) || 1;
        const side = i % 2 === 0 ? 1 : -1;
        const t = i / last;
        const amp = amp0 + (amp1 - amp0) * t;
        out.push([x + (-dz / len) * amp * side, z + (dx / len) * amp * side]);
    }
    return out;
}
export const PATHS = [
    {
        id: 'yard',
        label: 'Round the cabin',
        kind: 'packed',
        width: 1.3,
        points: [
            [-3.2, 5.6],
            [-8.6, 6.4],
            [-10.6, 1],
            [-11.2, -4.6],
        ],
    },
    {
        id: 'road',
        label: 'Road to Lysvik',
        kind: 'plowed',
        width: 4.2,
        points: [
            [-2, 9],
            [-26, 14],
            [-62, 12],
            [-110, -6],
            [-160, -34],
            [-230, -62],
            [-320, -86],
            [-420, -100],
            [-520, -107],
            [-620, -108],
            [-720, -103],
            [-800, -94],
            [-860, -92],
        ],
    },
    {
        id: 'lake',
        label: 'Path to Mirror Lake',
        kind: 'packed',
        width: 1.7,
        points: [
            [6.8, 4.4],
            [24, 12],
            [62, 24],
            [110, 40],
            [160, 58],
            [205, 78],
            [240, 90],
            [255, 92],
        ],
    },
    {
        id: 'spring',
        label: 'Path to the hot spring',
        kind: 'packed',
        width: 1.5,
        points: [
            [-26, 14],
            [-60, 38],
            [-104, 60],
            [-150, 62],
            [-210, 42],
            [-262, 20],
            [-304, 4],
            [-336, -4],
            [-356, -15],
            [-368, -21],
        ],
    },
    {
        id: 'beach',
        label: 'Path to Ice Beach',
        kind: 'packed',
        width: 1.6,
        points: [
            [-860, -92],
            [-930, -66],
            [-1010, -34],
            [-1100, 6],
            [-1196, 46],
            [-1290, 84],
            [-1370, 112],
            [-1404, 123],
        ],
    },
    {
        id: 'summit',
        label: 'Fox Peak trail',
        kind: 'trail',
        width: 1.1,
        points: [
            [516, 196],
            ...switchbackTrail([
                [548, 238],
                [552, 330],
                [560, 440],
                [566, 560],
                [590, 690],
                [624, 780],
                [651, 827],
            ], 24, 22, 32),
        ],
    },
    {
        id: 'shore',
        label: 'Lake shore path',
        kind: 'packed',
        width: 1.3,
        points: [
            [255, 92],
            [266, 146],
            [300, 196],
            [362, 226],
            [440, 236],
            [500, 222],
            [516, 196],
        ],
    },
    {
        id: 'quay',
        label: 'Lysvik quay',
        kind: 'plowed',
        width: 5,
        points: [
            [-955, -158],
            [-900, -160],
            [-840, -158],
            [-785, -152],
        ],
    },
    {
        id: 'springwalk',
        label: 'Boardwalk to the pool',
        kind: 'boardwalk',
        width: 1.2,
        points: [
            [-368, -21],
            [-376, -25],
        ],
    },
];
const F = HOUSE.floorY;
/**
 * A look-at target `dist` metres from `pos` toward azimuth `az` (degrees from
 * north, + = east), pitched `pitch` degrees above the horizontal.
 */
function aim(pos, az, pitch, dist) {
    const a = (az * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    const r = (v) => Math.round(v * 10) / 10;
    return [r(pos[0] + Math.sin(a) * Math.cos(p) * dist), r(pos[1] + Math.sin(p) * dist), r(pos[2] - Math.cos(a) * Math.cos(p) * dist)];
}
/** An outdoor viewpoint at an absolute eye position, looking along azimuth `az` pitched `pitch` up. */
function view(id, label, pos, az, pitch, dist) {
    return { id, label, pos, target: aim(pos, az, pitch, dist) };
}
/**
 * The night views look north and up: the Teeth stand 12-19° high from the
 * cabin, the deck, the lake and the hot spring, and the aurora's arcs climb
 * above them, so the exterior views pitch up until most of the frame is sky.
 * Eye heights are absolute (checked against the terrain by
 * tools/terrain-preview.ts); targets sit ~40-120 m out so orbiting stays local.
 */
export const VIEWPOINTS = [
    view('overview', 'Foxfire Fjord', [140, 284, 820], -6, 10, 160),
    // from the west, past the fire pit: the deck, the lit glass wing and the gable under the aurora, the fjord and the Teeth to the north
    view('cabin', 'Aurora Cabin', [-27, F + 2.0, -6], 75, 12, 60),
    // from the east end over the sofa's back: the rug, the stove's fire, the chimney breast, the kitchen and its table beyond
    { id: 'living', label: 'By the stove', pos: [4.9, F + 1.55, 2.6], target: [-1.2, F + 0.7, 0.0], interior: true },
    // in the wing's doorway: the two beds facing the north glass, the lanterns along it, the aurora over the Teeth
    { id: 'glasswing', label: 'Glass wing', pos: [2.6, F + 1.75, -3.75], target: aim([2.6, F + 1.75, -3.75], 0, 6, 10), interior: true },
    // by the deck door: the steaming tub on the left, the fjord and the aurora beyond
    view('deck', 'The deck', [-1.3, F + 1.7, -4.3], -40, 5, 40),
    view('lake', 'Mirror Lake', [420, LAKE.y + 2.9, 212], -6, 12, 80),
    // out on the ice: the steaming avanto in front, the jetty with its ice lanterns leading to the sauna, the lights to the north
    view('sauna', 'Lake sauna', [290, LAKE.y + 1.8, 107.5], -48, 3, 40),
    // above the boardwalk: the steaming pool and its ice lanterns, the red hut on the right, the fjord and the Teeth
    view('spring', 'Hot spring', [-371.2, SPRING.y + 2.5, -19.6], -32, 2, 40),
    view('village', 'Lysvik', [-835, 35, 14], -9, -4, 80),
    view('harbor', 'Harbour', [-813, 3.7, -175.8], -79, 6, 60),
    view('beach', 'Ice Beach', [-1408, 3.3, 185], -10, 7, 60),
    // on the knob's shoulder: the bench and its windbreak on the left, the cairn right, north over the fjord to the Teeth
    view('summit', 'Fox Peak', [666, FOX_PEAK.y + 4.2, 841.5], -4, 6, 120),
];
