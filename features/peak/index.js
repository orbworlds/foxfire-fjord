/**
 * Fox Peak: the south massif's summit and the island's best seat for the
 * northern lights. A big dry-stone cairn on the knob with a painted red T and
 * rime feathers grown into the wind, the summit box with the visitors' book,
 * a bench on the wind-scoured lookout facing north behind a crescent of
 * dry-stone wall, and spindrift streaming off the crest.
 */
import * as THREE from 'three';
import { hitBox, mergeByMaterial } from '../../core/geometry.js';
import { vapour } from '../house/fx.js';
import { BENCH, BOX, CAIRN, LOOKOUT, SUMMIT_ALT } from './layout.js';
import { buildSummit } from './summit.js';
const create = (ctx) => {
    const root = new THREE.Group();
    root.name = 'peak';
    const M = ctx.materials;
    /* ---------- materials ---------- */
    const stone = M.get('granite').clone();
    stone.name = 'summitStone';
    stone.vertexColors = true;
    stone.roughness = 0.86;
    stone.bumpScale = 1.0;
    // cool the warm granite toward the island's blue-grey gneiss
    stone.color.setRGB(0.88, 0.92, 0.98);
    const wood = M.get('weatheredTimber');
    const red = new THREE.MeshStandardMaterial({ name: 'summitBox', color: 0x8e2219, roughness: 0.45, metalness: 0.35 });
    const snow = M.get('snowPack');
    /* ---------- summit furniture ---------- */
    const s = buildSummit(ctx);
    const raw = new THREE.Group();
    const addAll = (geos, m, cast) => {
        for (const g of geos) {
            const mesh = new THREE.Mesh(g, m);
            mesh.castShadow = cast;
            mesh.receiveShadow = true;
            raw.add(mesh);
        }
    };
    addAll(s.stone, stone, true);
    addAll(s.wood, wood, true);
    addAll(s.red, red, true);
    addAll(s.snow, snow, true);
    addAll(s.rime, snow, false);
    const detail = mergeByMaterial(raw);
    detail.name = 'peak-summit';
    const lookout = new THREE.Vector3(LOOKOUT.x + 6, s.heights.cairn, LOOKOUT.z);
    ctx.lod.register(detail, 450, lookout);
    root.add(detail);
    /* ---------- spindrift streaming off the crest ---------- */
    const q = ctx.quality;
    const sy = s.heights.cairn;
    const drift = vapour(ctx, {
        count: q.fancy ? 90 : 50,
        emitters: [
            { x: CAIRN.x + 0.8, y: sy + 0.1, z: CAIRN.z + 0.5, rx: 1.6, rz: 1.2, weight: 1.4 },
            { x: CAIRN.x - 2.5, y: sy - 1.6, z: CAIRN.z - 3.5, rx: 2.0, rz: 0.8, weight: 1 },
            { x: LOOKOUT.x + 4, y: s.heights.bench - 0.2, z: LOOKOUT.z - 7, rx: 4, rz: 0.8, weight: 1 },
        ],
        size: [0.25, 1.7],
        rise: [0.02, 0.18],
        life: [2.2, 4.2],
        drift: 2.2,
        opacity: 0.16,
        wander: 0.6,
        seed: 59,
        tint: new THREE.Color(0.95, 0.97, 1.0),
    }, { color: new THREE.Color(0, 0, 0), y: 0, fade: 1 });
    drift.mesh.name = 'peak-spindrift';
    root.add(drift.mesh);
    ctx.lod.register(drift.mesh, 600, lookout);
    /* ---------- walk mode ---------- */
    for (const c of s.circles)
        ctx.colliders.addCircle(c.x, c.z, c.r, { yMax: c.yMax });
    for (const g of s.segments)
        ctx.colliders.addSegment(g.ax, g.az, g.bx, g.bz, g.r, { yMax: g.yMax });
    ctx.world.reserve({ kind: 'circle', x: CAIRN.x, z: CAIRN.z, r: 2.2, tag: 'cairn' });
    /* ---------- info cards ---------- */
    const pCairn = hitBox(CAIRN.r * 2 + 0.2, s.heights.cairnTop - s.heights.cairn, CAIRN.r * 2 + 0.2);
    pCairn.position.set(CAIRN.x, (s.heights.cairnTop + s.heights.cairn) / 2, CAIRN.z);
    const pBox = hitBox(0.5, 1.6, 0.5);
    pBox.position.set(BOX.x, s.heights.box + 0.8, BOX.z);
    const pBench = hitBox(1.8, 0.7, 0.6);
    pBench.position.set(BENCH.x, s.heights.bench + 0.35, BENCH.z);
    pBench.rotation.y = Math.atan2(BENCH.fx, BENCH.fz);
    root.add(pCairn, pBox, pBench);
    ctx.interaction.register({
        object: pCairn,
        label: 'The cairn',
        maxDistance: 60,
        card: {
            title: `Fox Peak cairn, ${SUMMIT_ALT} m`,
            body: '<p>A varde: a tower of flat gneiss slabs laid dry, course on course, taller than a man so it shows above the snow and against the sky from the valleys. Every hiker who comes up adds a stone. The red T on its west face is the trail mark; you have followed its little brothers on the snow poles all the way up.</p>' +
                '<p>Facing the storm wind it wears rime: feathers of ice that grow <i>into</i> the wind, one supercooled droplet of cloud at a time, a few centimetres in a night.</p>',
        },
    });
    ctx.interaction.register({
        object: pBox,
        label: 'Summit box',
        maxDistance: 30,
        card: {
            title: 'Summit box',
            body: '<p>A red steel box on a post with the visitors’ book inside, wrapped in a plastic bag against the damp. Sign your name and the date; the first entry this winter is from the second of January, “minus nineteen, no wind, the whole sky green”.</p>',
        },
    });
    ctx.interaction.register({
        object: pBench,
        label: 'Lookout bench',
        maxDistance: 40,
        card: {
            title: 'The lookout',
            body: '<p><b>The best aurora seat on the island.</b> The bench faces due north: below you the white bowl of Mirror Lake, the cabin on its knoll, the frozen fjord and the Teeth beyond, and over them the whole northern sky with nothing in the way.</p>' +
                '<p>The crescent of stone on its windward side was built by the trail volunteers; the wind scours the top bare of snow, so the rock shows through all winter. Brush the snow off the seat and wait: when the lights break up overhead, the whole sky moves.</p>',
        },
    });
    return {
        id: 'peak',
        object: root,
        update: () => {
            if (!drift.mesh.visible)
                return;
            // spindrift shows in gusts
            const w = ctx.shared.uWindStrength.value;
            drift.visibility = THREE.MathUtils.smoothstep(w, 0.2, 0.8) * 0.9 + 0.1;
        },
        api: {
            summit: { x: LOOKOUT.x, z: LOOKOUT.z, y: s.heights.bench, altitude: SUMMIT_ALT },
            cairn: { x: CAIRN.x, z: CAIRN.z, y: s.heights.cairn, top: s.heights.cairnTop },
        },
    };
};
export default create;
