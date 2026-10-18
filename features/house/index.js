/**
 * Aurora Cabin, the hero house: a long, low tarred-timber cabin with a steep
 * snow-loaded gable roof and a fieldstone chimney, a glass gable wing facing
 * north to the aurora, and a north deck with a wood-fired hot tub, a lantern
 * string and a fire pit on the snow beyond it.
 *
 *   plan.ts    derived dimensions (roof planes, the valley notch, openings)
 *   shell.ts   plinth, walls, windows, roof, snow slab, icicles, chimney, interior shell
 *   wing.ts    the glass A-frame: knee walls, rafters, glazing, ridge snow
 *   deck.ts    deck, hot tub and lid, firewood, lantern string, fire pit, kick sled
 *   yard.ts    drifts against the walls, the deck's shovelled snow, boot prints
 *   fx.ts      flames, embers, sparks, steam and smoke, tub water, light pools
 *   blinds.ts  pleated wool blinds under the wing's glass (GPU folded)
 *   doors.ts   the three hinged doors (walk mode opens them)
 *
 * The fabric is built in house-local metres (y = 0 at the finished floor)
 * under `root`; particles and flames live in world space under `fxRoot`.
 */
import * as THREE from 'three';
import { HOUSE } from '../../world/layout.js';
import { steamVisibility } from '../paths/kit/steam.js';
import { buildBlinds } from './blinds.js';
import { CARDS } from './cards.js';
import { DECK_STEPS, PIT, POSTS, SLED, TUB, TUB_STOVE, TUB_WATER, buildDeck, groundAt } from './deck.js';
import { buildFire, fireLights, fireLit, poolGeometry, poolMaterial, vapour, waterMaterial, windowLightGeometry, windowLightMaterial } from './fx.js';
import { approach, roleAt, smooth01 } from './kit.js';
import { cabinMats } from './mats.js';
import { C, D, OPENINGS_BY_ID, W, WALL_T, isInterior } from './plan.js';
import { buildShell, eaveIcicles, roofSnow } from './shell.js';
import { buildWing, KNEE_T } from './wing.js';
import { buildDoors } from './doors.js';
import { buildDrifts, buildFootprints, buildPitGround, deckSnow, deckSurface, terrainSurface } from './yard.js';
/** labels and cards of the parts a click can hit (Batch roles) */
const ROLE = {
    walls: { label: 'Tarred board-and-batten', card: 'cabin' },
    roof: { label: 'Snow roof', card: 'roof' },
    snow: { label: 'Snow', card: 'roof', once: true },
    chimney: { label: 'Fieldstone chimney', card: 'chimney' },
    windows: { label: 'Window', card: 'windows' },
    plinth: { label: 'Stone plinth', card: 'plinth', once: true },
    interior: { label: 'Pine panelling', card: 'interior', once: true },
    hearth: { label: 'Chimney breast', card: 'hearth' },
    frame: { label: 'Glass wing', card: 'wing' },
    glass: { label: 'Glass wing', card: 'wing' },
    deck: { label: 'Deck', card: 'deck', once: true },
    tub: { label: 'Hot tub', card: 'tub' },
    tubStove: { label: 'Tub stove', card: 'tub' },
    firewood: { label: 'Firewood', card: 'firewood' },
    sled: { label: 'Kick sled', card: 'sled' },
    lights: { label: 'Lantern string', card: 'lights' },
    firepit: { label: 'Fire pit', card: 'firepit' },
};
/** linear warm colours */
const FIRE = new THREE.Color(1.83, 0.83, 0.28);
const LAMP = new THREE.Color(1.54, 0.894, 0.462);
const create = (ctx) => {
    const object = new THREE.Group();
    object.name = 'house';
    const root = new THREE.Group();
    root.name = 'house-local';
    root.position.set(HOUSE.x, HOUSE.floorY, HOUSE.z);
    root.rotation.y = HOUSE.rotY;
    const fxRoot = new THREE.Group();
    fxRoot.name = 'house-fx';
    fxRoot.userData.snow = 0;
    fxRoot.userData.shelter = false;
    object.add(root, fxRoot);
    const M = ctx.materials;
    const S = ctx.shared;
    const q = ctx.quality;
    const fancy = q.fancy;
    const m = cabinMats(ctx);
    const X = HOUSE.x;
    const Z = HOUSE.z;
    const F = HOUSE.floorY;
    const world = (x, y, z) => new THREE.Vector3(X + x, F + y, Z + z);
    /* ------------------------------ fabric ------------------------------ */
    const shell = buildShell(m);
    const wing = buildWing(m);
    const fabric = new THREE.Group();
    fabric.name = 'house-fabric';
    for (const mesh of [...shell.meshes, ...wing.meshes])
        fabric.add(mesh);
    const roleMesh = (g, mat, role, name, cast = true) => {
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = name;
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.userData.roles = [{ role, start: 0, end: 1e9 }];
        return mesh;
    };
    const snowGeo = roofSnow([...shell.roofTops, ...wing.roofTops], fancy);
    if (snowGeo)
        fabric.add(roleMesh(snowGeo, m.snow, 'snow', 'house-roof-snow'));
    const ice = eaveIcicles();
    if (ice)
        fabric.add(roleMesh(ice, m.ice, 'roof', 'house-icicles', false));
    root.add(fabric);
    const blinds = buildBlinds(ctx, wing.roofBays, wing.gableBays);
    const doors = buildDoors(ctx, m);
    root.add(blinds.object, blinds.proxies, doors.object);
    /* ------------------------------- deck ------------------------------- */
    const L = fireLights();
    const extra = {
        bark: M.get('birchBark'),
        endGrain: new THREE.MeshStandardMaterial({ name: 'endGrain', color: 0xc8a477, roughness: 0.92 }),
        staves: fireLit(M.get('pineFloor').clone(), L, 'staves'),
        benchWood: fireLit(M.get('weatheredTimber').clone(), L, 'bench'),
        ring: fireLit(new THREE.MeshStandardMaterial({ name: 'ringStone', color: 0x8d8a86, roughness: 0.85 }), L, 'ring'),
        red: new THREE.MeshStandardMaterial({ name: 'sledRed', color: 0x8a2a1d, roughness: 0.55 }),
        char: charMaterial(ctx),
    };
    // the deck's boards, steps and the tub lid: the lantern string warms them (fire light slot 2)
    const deckLit = fireLit(M.get('weatheredTimber').clone(), L, 'deck');
    deckLit.name = 'deckBoards';
    extra.staves.name = 'tubStaves';
    // the warm, wet rim holds little snow
    extra.staves.userData.snow = 0.3;
    extra.staves.color.set(0x8a6448);
    extra.benchWood.name = 'benchWood';
    extra.ring.name = 'ringStone';
    // stones round a fire hold no snow, and wear a little soot
    extra.ring.userData.snow = 0;
    extra.char.userData.snow = 0;
    const deck = buildDeck({ ...m, deck: deckLit }, extra, fancy);
    const outdoor = new THREE.Group();
    outdoor.name = 'house-outdoor';
    for (const mesh of deck.meshes) {
        if (mesh.material === deckLit)
            mesh.userData.snow = 0.25;
        outdoor.add(mesh);
    }
    deck.bulbs.userData.roles = [{ role: 'lights', start: 0, end: 1e9 }];
    outdoor.add(deck.bulbs, deck.lid, deck.lidBack);
    deck.lidBack.userData.roles = [{ role: 'lid', start: 0, end: 1e9 }];
    const water = deck.water;
    const waterMat = waterMaterial(ctx);
    waterMat.uniforms.uC.value.set(X + TUB.x, Z + TUB.z, TUB.r);
    water.material = waterMat;
    water.userData.snow = 0;
    outdoor.add(water);
    root.add(outdoor);
    /* ------------------------------- yard ------------------------------- */
    // the ground as the terrain mesh draws it (its grid depends on the quality)
    const terrain = terrainSurface(q.terrainDetail);
    const drift = buildDrifts(fancy, terrain);
    if (drift.geometry)
        root.add(roleMesh(drift.geometry, m.snow, 'snow', 'house-drifts', false));
    const dsnow = deckSnow(fancy);
    if (dsnow)
        root.add(roleMesh(dsnow, m.snow, 'snow', 'house-deck-snow', false));
    root.add(buildFootprints(drift, terrain));
    /* ------------------------ steam, smoke, fire ------------------------ */
    const steamK = q.steam;
    const tubSteam = vapour(ctx, {
        count: Math.max(40, Math.round(120 * steamK)),
        emitters: [{ x: X + TUB.x, y: F + D.topY + TUB_WATER + 0.05, z: Z + TUB.z, rx: TUB.r * 0.8, rz: TUB.r * 0.8 }],
        size: [0.5, 2.3],
        rise: [0.2, 0.42],
        life: [3.5, 7.5],
        drift: 0.3,
        opacity: 0.24,
        wander: 0.25,
        seed: 61,
        tint: 0xffffff,
    }, { color: new THREE.Color(), y: F + D.topY + TUB_WATER, fade: 0.8 });
    const smoke = vapour(ctx, {
        count: Math.max(16, Math.round(60 * steamK)),
        emitters: [{ x: X + HOUSE.chimney.x, y: F + HOUSE.chimney.topY + 0.1, z: Z + HOUSE.chimney.z, rx: 0.12, rz: 0.12 }],
        size: [0.4, 3.2],
        rise: [0.5, 0.9],
        life: [6, 12],
        drift: 0.8,
        opacity: 0.28,
        wander: 0.45,
        seed: 71,
        tint: 0xdfe2e6,
    }, 
    // a faint moonlit lift so the plume still reads against the night sky
    { color: new THREE.Color(0.006, 0.007, 0.009), y: F + HOUSE.chimney.topY, fade: 6 });
    const tubSmoke = vapour(ctx, {
        count: Math.max(8, Math.round(26 * steamK)),
        emitters: [{ x: X + TUB_STOVE.x + -0.08, y: F + D.topY + 2.5, z: Z + TUB_STOVE.z, rx: 0.05, rz: 0.05 }],
        size: [0.2, 1.4],
        rise: [0.45, 0.75],
        life: [4, 8],
        drift: 0.7,
        opacity: 0.18,
        wander: 0.3,
        seed: 73,
        tint: 0xd8dbe0,
    }, { color: new THREE.Color(0, 0, 0), y: 0, fade: 1 });
    const pitBase = world(PIT.x, groundAt(PIT.x, PIT.z) + 0.05, PIT.z);
    const pitSmoke = vapour(ctx, {
        count: Math.max(10, Math.round(40 * steamK)),
        emitters: [{ x: pitBase.x, y: pitBase.y + 0.6, z: pitBase.z, rx: 0.18, rz: 0.18 }],
        size: [0.3, 2.2],
        rise: [0.6, 1.1],
        life: [4, 8],
        drift: 0.6,
        opacity: 0.16,
        wander: 0.4,
        seed: 79,
        tint: 0xcfd2d6,
    }, { color: new THREE.Color(), y: pitBase.y + 0.4, fade: 1.6 });
    for (const s of [tubSteam, smoke, tubSmoke, pitSmoke]) {
        s.mesh.userData.snow = 0;
        s.mesh.userData.shelter = false;
        fxRoot.add(s.mesh);
    }
    const fire = buildFire(ctx, pitBase, { radius: 0.2, size: 0.95, count: fancy ? 9 : 6, sparks: fancy ? 70 : 34, seed: 9 });
    fxRoot.add(fire.object);
    emberLevel.value.set(1, pitBase.y);
    /* --------------------------- light pools ---------------------------- */
    // the snow surface under a pool: terrain plus drift, the deck's snow on the deck
    const surface = (x, z) => {
        if (x > D.minX && x < D.maxX && z > D.minZ && z < D.maxZ)
            return deckSurface(x, z);
        return terrain(x, z) + drift.depth(x, z);
    };
    const pools = [];
    const pool = (geos, color, name) => {
        const mat = poolMaterial(color);
        const g = geos.length === 1 ? geos[0] : mergeGeos(geos);
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = name;
        mesh.renderOrder = 2;
        mesh.raycast = () => { };
        mesh.userData.snow = 0;
        mesh.userData.shelter = false;
        root.add(mesh);
        pools.push({ mesh, mat });
        return mat;
    };
    root.add(buildPitGround((x, z, rx, rz) => poolGeometry(x, z, rx, rz, [1, 0], surface, 0.03)));
    // each lit window throws its panes onto the snow in front of it
    const winPools = [];
    for (const w of shell.windows) {
        const o = w.opening;
        if (isInterior(o) || o.kind === 'attic' || o.kind === 'door')
            continue;
        const out = w.outward;
        winPools.push(windowLightGeometry(w.center.x, w.center.z, [out.x, out.z], 0.4 + 0.45 * o.sill, 2.5 + 0.9 * o.sill, o.w * 1.1, o.w * 2.1, surface, 0.05));
    }
    const winPoolMat = windowLightMaterial(0xffb070);
    {
        const mesh = new THREE.Mesh(mergeGeos(winPools), winPoolMat);
        mesh.name = 'house-window-light';
        mesh.renderOrder = 2;
        mesh.raycast = () => { };
        mesh.userData.snow = 0;
        mesh.userData.shelter = false;
        root.add(mesh);
    }
    const wingPoolMat = pool([
        poolGeometry((W.minX + W.maxX) / 2, W.minZ - 2.2, 3.2, 3.6, [0, -1], surface, 0.05),
        poolGeometry(W.maxX + 1.6, (W.minZ + W.maxZ) / 2, 2.2, 3.8, [1, 0], surface, 0.05),
    ], 0xffb878, 'house-wing-light');
    const pitPoolMat = pool([poolGeometry(PIT.x, PIT.z, 4.2, 4.2, [1, 0], surface, 0.06)], 0xff9248, 'house-fire-light');
    const doorPoolMat = pool([poolGeometry(deck.doorLampPos.x + 0.4, deck.doorLampPos.z + 1.3, 2.0, 2.3, [0, 1], surface, 0.05)], 0xffb070, 'house-door-light');
    const stringPoolMat = pool([poolGeometry((D.minX + D.maxX) / 2 - 0.8, (D.minZ + D.maxZ) / 2 - 0.6, 4.4, 3.6, [1, 0], surface, 0.04)], 0xffc080, 'house-string-light');
    /* --------------------------- room light ----------------------------- */
    M.setRoomLight('living', { lamps: 1, fire: 1 });
    M.setRoomLight('glasswing', { lamps: 1, fire: 0 });
    // defaults until the furniture places its own lamps: the stove and two lamps, lanterns in the wing
    M.setRoomSources('living', [
        { position: world(HOUSE.stove.x + 0.25, 0.45, HOUSE.stove.z), kind: 'fire', power: 0.5, reach: 7 },
        { position: world(-4.6, 1.9, -1.2), kind: 'lamp', power: 0.22, reach: 5 },
        { position: world(3.6, 1.2, 1.6), kind: 'lamp', power: 0.28, reach: 6 },
    ]);
    // two lanterns on the floor in the corners of the north glass (clear of the knee walls)
    M.setRoomSources('glasswing', [
        { position: world(W.minX + 0.85, 0.3, W.minZ + 0.75), kind: 'candle', power: 0.14, reach: 5 },
        { position: world(W.maxX - 0.85, 0.3, W.minZ + 0.75), kind: 'candle', power: 0.14, reach: 5 },
    ]);
    /* ----------------------------- state -------------------------------- */
    const st = {
        lidOpen: true,
        lid: 1,
        pit: 1,
        pitTarget: 1,
        string: 1,
        stringTarget: 1,
        tubFire: 1,
    };
    /* --------------------------- interaction ---------------------------- */
    const I = ctx.interaction;
    const seen = new Set();
    const once = (id) => {
        if (seen.has(id))
            return null;
        seen.add(id);
        return CARDS[id];
    };
    const roleOf = (hit) => (hit ? roleAt(hit.object, hit.faceIndex) : null);
    const refresh = () => ctx.ui.refreshControls();
    let clicked = null;
    const toggles = {
        lid: { action: () => (st.lidOpen ? 'Close the lid' : 'Open the lid'), run: () => api.setTubLid(!st.lidOpen) },
        tub: { action: () => (st.lidOpen ? 'Close the lid' : 'Open the lid'), run: () => api.setTubLid(!st.lidOpen) },
        firepit: { action: () => (st.pitTarget > 0.5 ? 'Let it burn down' : 'Light the fire'), run: () => api.setFirePit(st.pitTarget < 0.5) },
        lights: { action: () => (st.stringTarget > 0.5 ? 'Switch off' : 'Switch on'), run: () => api.setLanterns(st.stringTarget < 0.5) },
    };
    const register = (obj, fallback, maxDistance) => I.register({
        object: obj,
        get label() {
            const r = roleOf(I.hoverHit);
            if (r === 'lid')
                return 'Tub lid';
            return r && ROLE[r] ? ROLE[r].label : fallback;
        },
        get action() {
            const r = roleOf(I.hoverHit);
            return r && toggles[r] ? toggles[r].action() : undefined;
        },
        onClick: (hit) => {
            clicked = roleOf(hit);
            if (clicked && toggles[clicked])
                toggles[clicked].run();
        },
        card: () => {
            if (clicked === 'lid')
                return once('lid');
            const r = clicked && ROLE[clicked];
            if (!r)
                return CARDS.cabin;
            // things you operate explain themselves the first time only
            if (toggles[clicked])
                return once(r.card);
            return r.once ? once(r.card) : CARDS[r.card];
        },
        maxDistance,
    });
    register(fabric, 'Aurora Cabin', 80);
    register(outdoor, 'Aurora Cabin', 40);
    I.register({
        object: blinds.proxies,
        label: 'Wool blind',
        get action() {
            const i = blinds.blindAt(I.hoverHit);
            return i < 0 ? undefined : blinds.isDrawn(i) ? 'Fold away' : 'Draw';
        },
        onClick: (hit) => {
            const i = blinds.blindAt(hit);
            if (i >= 0)
                blinds.toggle(i);
            refresh();
        },
        card: () => once('blinds'),
        maxDistance: 14,
    });
    I.register({
        object: doors.object,
        get label() {
            return doors.doorOf(I.hoverHit)?.spec.label ?? 'Door';
        },
        get action() {
            const d = doors.doorOf(I.hoverHit);
            return d ? (d.open ? 'Close' : 'Open') : undefined;
        },
        onClick: (hit) => {
            const d = doors.doorOf(hit);
            if (d)
                doors.set(d.spec.id, !d.open);
        },
        card: () => once('doors'),
        maxDistance: 12,
    });
    /* ------------------------------- HUD -------------------------------- */
    ctx.ui.addControl({
        group: 'house',
        id: 'cabin-lamps',
        label: 'Lamps',
        kind: 'toggle',
        active: () => M.getRoomLight('living').lamps > 0.5,
        onClick: () => {
            const on = M.getRoomLight('living').lamps > 0.5;
            api.setLamps(on ? 0 : 1, 'living');
            api.setLamps(on ? 0 : 1, 'glasswing');
        },
    });
    ctx.ui.addControl({ group: 'house', id: 'cabin-stove', label: 'Stove', kind: 'toggle', active: () => api.getFire() > 0.5, onClick: () => api.setFire(api.getFire() > 0.5 ? 0 : 1) });
    for (const [id, label] of [
        ['aurora', 'Aurora watch'],
        ['privacy', 'Privacy'],
        ['warm', 'Keep warm'],
    ]) {
        ctx.ui.addControl({ group: 'house', id: `cabin-blinds-${id}`, label, kind: 'toggle', active: () => blinds.preset() === id, onClick: () => api.setBlinds(id) });
    }
    ctx.ui.addControl({ group: 'house', id: 'cabin-tub', label: 'Tub lid', kind: 'toggle', active: () => st.lidOpen, onClick: () => api.setTubLid(!st.lidOpen) });
    ctx.ui.addControl({ group: 'house', id: 'cabin-fire', label: 'Fire pit', kind: 'toggle', active: () => st.pitTarget > 0.5, onClick: () => api.setFirePit(st.pitTarget < 0.5) });
    /* ------------------------------ walking ------------------------------ */
    const Cl = ctx.colliders;
    const seg = (ax, az, bx, bz, r = WALL_T / 2 + 0.02) => Cl.addSegment(X + ax, Z + az, X + bx, Z + bz, r, { tag: 'house' });
    const wallRun = (fixed, axis, from, to, gaps, r) => {
        let s = from;
        for (const [g0, g1] of gaps.slice().sort((a, b) => a[0] - b[0])) {
            if (g0 > s)
                axis === 'x' ? seg(s, fixed, g0, fixed, r) : seg(fixed, s, fixed, g0, r);
            s = Math.max(s, g1);
        }
        if (to > s)
            axis === 'x' ? seg(s, fixed, to, fixed, r) : seg(fixed, s, fixed, to, r);
    };
    const gap = (id) => {
        const o = OPENINGS_BY_ID[id];
        return [o.c - o.w / 2, o.c + o.w / 2];
    };
    const h = WALL_T / 2;
    wallRun(C.maxZ - h, 'x', C.minX, C.maxX, [gap('entry')]);
    wallRun(C.minZ + h, 'x', C.minX, C.maxX, [gap('deck'), gap('wing')]);
    wallRun(C.minX + h, 'z', C.minZ, C.maxZ, []);
    wallRun(C.maxX - h, 'z', C.minZ, C.maxZ, []);
    wallRun(W.minX + KNEE_T / 2, 'z', W.minZ, W.maxZ, [], KNEE_T / 2 + 0.02);
    wallRun(W.maxX - KNEE_T / 2, 'z', W.minZ, W.maxZ, [], KNEE_T / 2 + 0.02);
    wallRun(W.minZ + 0.08, 'x', W.minX, W.maxX, [], 0.1);
    const ch = HOUSE.chimney;
    Cl.addBox(X + ch.x - ch.w / 2, Z + ch.z - ch.d / 2, X + ch.x + ch.w / 2, Z + ch.z + ch.d / 2, { tag: 'house' });
    // floors: the cabin and the wing, the entry landing and its step
    Cl.addGround({ minX: X + C.minX, maxX: X + C.maxX, minZ: Z + C.minZ, maxZ: Z + C.maxZ }, () => F);
    Cl.addGround({ minX: X + W.minX, maxX: X + W.maxX, minZ: Z + W.minZ, maxZ: Z + W.maxZ }, () => F);
    const ex = HOUSE.entryX;
    Cl.addGround({ minX: X + ex - 0.85, maxX: X + ex + 0.85, minZ: Z + C.maxZ, maxZ: Z + C.maxZ + 0.95 }, () => F - 0.2);
    Cl.addGround({ minX: X + ex - 0.7, maxX: X + ex + 0.7, minZ: Z + C.maxZ + 0.95, maxZ: Z + C.maxZ + 1.4 }, () => F - 0.42);
    // the deck and its steps; the tub, its stove, the firewood, the posts; the fire pit's ring and benches
    Cl.addGround({ minX: X + D.minX, maxX: X + D.maxX, minZ: Z + D.minZ, maxZ: Z + D.maxZ }, () => F + D.topY);
    const gs = groundAt(DECK_STEPS.x0 - 0.3, (DECK_STEPS.z0 + DECK_STEPS.z1) / 2);
    const rise = (D.topY - gs) / 3;
    for (let k = 1; k <= 2; k++) {
        const xa = D.minX - 0.34 * k;
        Cl.addGround({ minX: X + xa, maxX: X + xa + 0.36, minZ: Z + DECK_STEPS.z0, maxZ: Z + DECK_STEPS.z1 }, () => F + D.topY - rise * k, { priority: k });
    }
    Cl.addCircle(X + TUB.x, Z + TUB.z, TUB.r + 0.05, { tag: 'house' });
    Cl.addCircle(X + TUB_STOVE.x, Z + TUB_STOVE.z, 0.36, { tag: 'house' });
    Cl.addBox(X + C.minX + 0.1, Z + C.minZ - 0.46, X - 3.2, Z + C.minZ, { tag: 'house' });
    Cl.addBox(X + C.minX - 0.55, Z + C.minZ + 0.2, X + C.minX, Z - 0.3, { tag: 'house' });
    for (const [px, pz] of POSTS)
        Cl.addCircle(X + px, Z + pz, 0.09, { tag: 'house' });
    Cl.addCircle(X + PIT.x, Z + PIT.z, 0.78, { tag: 'house' });
    Cl.addCircle(X + SLED.x, Z + SLED.z, 0.5, { tag: 'house' });
    /* -------------------------------- LOD ------------------------------- */
    const center = new THREE.Vector3(X, F + 2, Z - 2);
    for (const mesh of fabric.children) {
        const mat = mesh.material;
        if (mat && (mat === m.pine || mat === m.wallIn || mat === m.curtain || mat === m.stoneIn || mat === m.slateIn || mat === m.floor))
            ctx.lod.register(mesh, 260, center);
    }
    ctx.lod.register(outdoor, 420, center);
    ctx.lod.register(doors.object, 300, center);
    ctx.lod.register(blinds.object, 600, center);
    ctx.lod.register(fxRoot, 900, center);
    /* -------------------------------- API ------------------------------- */
    const api = {
        setLamps(level, zone = 'living') {
            M.setRoomLight(zone, { lamps: THREE.MathUtils.clamp(level, 0, 1) });
            ctx.events.emit('cabin:light', { zone, ...M.getRoomLight(zone) });
            refresh();
        },
        getLamps: (zone = 'living') => M.getRoomLight(zone).lamps,
        setFire(level) {
            M.setRoomLight('living', { fire: THREE.MathUtils.clamp(level, 0, 1) });
            ctx.events.emit('cabin:light', { zone: 'living', ...M.getRoomLight('living') });
            refresh();
        },
        getFire: () => M.getRoomLight('living').fire,
        getFireLight: () => M.getRoomLight('living').fire * S.uFireFlicker.value,
        setTubLid(open) {
            st.lidOpen = open;
            refresh();
        },
        isTubLidOpen: () => st.lidOpen,
        setFirePit(burning) {
            st.pitTarget = burning ? 1 : 0;
            refresh();
        },
        setLanterns(on) {
            st.stringTarget = on ? 1 : 0;
            refresh();
        },
        setBlinds(preset) {
            blinds.applyPreset(preset);
            refresh();
        },
        getBlindsOpenness: () => blinds.openness(),
        setDoor: (id, open) => doors.set(id, open),
        isDoorOpen: (id) => !!doors.doors.find((d) => d.spec.id === id)?.open,
    };
    /* ------------------------------ update ------------------------------ */
    const fireLight = L.pos.value;
    const fireCol = L.col.value;
    fireLight[0].set(pitBase.x, pitBase.y + 0.45, pitBase.z, 7);
    fireLight[1].set(X + TUB_STOVE.x, F + D.topY + 0.4, Z + TUB_STOVE.z, 2.4);
    // the lantern string: one soft source a little under the middle of its bulbs
    {
        const c = new THREE.Vector3();
        for (const p of deck.bulbPts)
            c.add(p);
        c.multiplyScalar(1 / Math.max(1, deck.bulbPts.length));
        fireLight[2].set(X + c.x, F + c.y - 0.15, Z + c.z, 6);
        // the bulbs hang all round the deck: light reaching round the sides from a broad source
        L.shape.value[2].set(0.6, 1.2);
    }
    const update = (dt) => {
        const t = S.uTime.value;
        const night = S.uNight.value;
        const shot = ctx.params.shot;
        const step = shot ? 1e3 : dt;
        blinds.update(dt, shot);
        doors.update(dt, shot);
        // lid: the front half folds over the back one
        st.lid = approach(st.lid, st.lidOpen ? 1 : 0, 0.7, step);
        const pivot = deck.lid.children[0];
        pivot.rotation.x = -Math.PI * smooth01(st.lid);
        st.pit = approach(st.pit, st.pitTarget, 0.25, step);
        st.string = approach(st.string, st.stringTarget, 2, step);
        const flick = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1.3) + 0.06 * Math.sin(t * 17.9) + 0.04 * Math.sin(t * 3.7);
        // the fire pit
        fire.level = st.pit;
        emberLevel.value.x = (0.25 + 0.75 * st.pit) * flick;
        fire.update(t, true);
        fireCol[0].copy(FIRE).multiplyScalar(0.55 * st.pit * flick);
        pitPoolMat.opacity = 0.13 * st.pit * flick * (0.12 + 0.88 * night);
        pitSmoke.material.uniforms.uVapGlow.value.copy(FIRE).multiplyScalar(0.05 * st.pit * flick);
        pitSmoke.visibility = 0.5 + 0.5 * st.pit;
        // the tub's stove, water and steam
        const sf = 0.8 + 0.2 * S.uFireFlicker.value;
        fireCol[1].copy(FIRE).multiplyScalar(0.12 * st.tubFire * sf);
        deck.stoveGlow.emissiveIntensity = 1.6 * st.tubFire * sf;
        const lidK = 0.15 + 0.85 * st.lid;
        waterMat.uniforms.uGlow.value.copy(LAMP).multiplyScalar((0.004 + 0.016 * night) * (0.4 + 0.6 * st.string));
        tubSteam.visibility = steamVisibility(ctx) * lidK;
        tubSteam.material.uniforms.uVapGlow.value.copy(LAMP).multiplyScalar(0.075 * night * st.string);
        // the lantern string
        const on = smooth01((night - 0.15) / 0.45) * st.string;
        deck.bulbMat.emissiveIntensity = 2.4 * on;
        fireCol[2].copy(LAMP).multiplyScalar(0.3 * on);
        stringPoolMat.opacity = 0.09 * on;
        const lampOn = smooth01((night - 0.1) / 0.4);
        deck.doorLamp.emissiveIntensity = 2.4 * lampOn * (0.94 + 0.06 * Math.sin(t * 9.1) * Math.sin(t * 2.3));
        doorPoolMat.opacity = 0.16 * lampOn;
        // windows and the wing on the snow
        winPoolMat.opacity = 0.14 * M.glowLevel('living') * night;
        wingPoolMat.opacity = 0.1 * M.glowLevel('glasswing') * night;
        smoke.visibility = 0.35 + 0.65 * M.getRoomLight('living').fire;
    };
    update(0);
    return {
        id: 'house',
        object,
        update,
        api,
    };
};
/**
 * Charred logs in the fire: black, with embers glowing in the cracks near the
 * bottom where the coals are (by height above the fire's base, flickering).
 */
function charMaterial(ctx) {
    const m = new THREE.MeshStandardMaterial({ name: 'charred', color: 0x141110, roughness: 0.95, emissive: 0xff5a14, emissiveIntensity: 1 });
    m.userData.snow = 0;
    m.onBeforeCompile = (shader) => {
        shader.uniforms.uNoise = { value: ctx.materials.noise };
        shader.uniforms.uTime = ctx.shared.uTime;
        shader.uniforms.uEmber = emberLevel;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCharW;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCharW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nuniform float uTime;\nuniform vec2 uEmber;\nvarying vec3 vCharW;')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float hgt = vCharW.y - uEmber.y;
          float crack = smoothstep(0.55, 0.8, texture2D(uNoise, vCharW.xz * 3.1 + vCharW.y * 1.7).g);
          float pulse = 0.7 + 0.3 * sin(uTime * 2.3 + vCharW.x * 40.0);
          totalEmissiveRadiance *= uEmber.x * (smoothstep(0.32, 0.0, hgt) * (0.25 + 1.6 * crack) * pulse + 0.03);
        }`);
    };
    m.customProgramCacheKey = () => 'fox-charred-1';
    return m;
}
/** x: ember brightness, y: world height of the fire's base (set by the feature) */
const emberLevel = { value: new THREE.Vector2(1, 0) };
function mergeGeos(geos) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (const g of geos) {
        const base = pos.length / 3;
        const p = g.getAttribute('position');
        const u = g.getAttribute('uv');
        for (let i = 0; i < p.count; i++) {
            pos.push(p.getX(i), p.getY(i), p.getZ(i));
            uv.push(u.getX(i), u.getY(i));
        }
        const ix = g.index;
        for (let i = 0; i < ix.count; i++)
            idx.push(base + ix.getX(i));
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
}
export default create;
