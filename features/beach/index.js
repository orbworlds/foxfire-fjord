/**
 * Ice Beach — black sand on the outer west coast, a short walk on from
 * Lysvik, where the winter sea leaves glassy chunks of glacier ice stranded
 * in the swash like cut glass. Silver driftwood with snow cushions along the
 * back of the beach, black pebbles at the storm line and a driftwood bench
 * looking out to the skerries and the open sea.
 */
import * as THREE from 'three';
import { hitBox, mergeByMaterial } from '../../core/geometry.js';
import { BEACH } from '../../world/layout.js';
import { buildProps } from './props.js';
import { buildIce } from './ice.js';
const create = (ctx) => {
    const root = new THREE.Group();
    root.name = 'beach';
    const H = (x, z) => ctx.world.heightAt(x, z);
    const props = buildProps(ctx);
    const ice = buildIce(H, (x, z) => ctx.world.heightAtFast(x, z), ctx.quality.fancy);
    /* ---------- materials ---------- */
    const M = ctx.materials;
    const driftwood = M.get('weatheredTimber').clone();
    driftwood.name = 'driftwood';
    driftwood.vertexColors = true;
    driftwood.roughness = 0.92;
    driftwood.bumpScale = 1.4;
    const snowMat = M.get('snowPack');
    // clear glacier ice: the vertex colours carry clear (dark) vs milky (light)
    const iceWet = M.get('ice').clone();
    iceWet.name = 'beachIceWet';
    iceWet.color.set(0xffffff);
    iceWet.vertexColors = true;
    iceWet.roughness = 0.05;
    iceWet.userData.snow = 0;
    iceWet.userData.iceGround = [0.03, 0.03, 0.032];
    iceWet.userData.iceScallop = 0.15;
    const iceDry = M.get('ice').clone();
    iceDry.name = 'beachIceDry';
    iceDry.color.set(0xffffff);
    iceDry.vertexColors = true;
    iceDry.roughness = 0.12;
    iceDry.clearcoatRoughness = 0.1;
    iceDry.userData.snow = 0.15;
    iceDry.userData.iceGround = [0.04, 0.04, 0.042];
    iceDry.userData.iceScallop = 0.17;
    const pebbleWet = new THREE.MeshStandardMaterial({ name: 'pebbleWet', vertexColors: true, roughness: 0.22, metalness: 0 });
    pebbleWet.userData.snow = 0;
    const pebbleDry = new THREE.MeshStandardMaterial({ name: 'pebbleDry', vertexColors: true, roughness: 0.7, metalness: 0 });
    pebbleDry.userData.snow = 0.7;
    const add = (group, geos, mat, cast = true) => {
        for (const g of geos) {
            const m = new THREE.Mesh(g, mat);
            m.castShadow = cast;
            m.receiveShadow = true;
            group.add(m);
        }
    };
    // core: what reads from afar (ice, driftwood); detail: pebbles
    const coreRaw = new THREE.Group();
    add(coreRaw, ice.wet, iceWet);
    add(coreRaw, ice.dry, iceDry);
    add(coreRaw, props.wood, driftwood);
    add(coreRaw, props.snow, snowMat);
    const core = mergeByMaterial(coreRaw);
    core.name = 'beach-core';
    const detailRaw = new THREE.Group();
    add(detailRaw, props.pebblesWet, pebbleWet);
    add(detailRaw, props.pebblesDry, pebbleDry);
    const detail = mergeByMaterial(detailRaw, { castShadow: false });
    detail.name = 'beach-detail';
    root.add(core, detail);
    const center = new THREE.Vector3(BEACH.center.x, BEACH.y + 1, BEACH.center.z);
    ctx.lod.register(core, 1100, center);
    ctx.lod.register(detail, 260, center);
    /* ---------- walk mode ---------- */
    for (const c of props.circles)
        ctx.colliders.addCircle(c.x, c.z, c.r, { yMax: c.yMax });
    for (const s of props.segments)
        ctx.colliders.addSegment(s.ax, s.az, s.bx, s.bz, s.r, { yMax: s.yMax });
    for (const b of ice.big)
        ctx.colliders.addCircle(b.x, b.z, b.r * 0.8, { yMax: b.top });
    /* ---------- info cards ---------- */
    const icePick = new THREE.Group();
    for (const b of ice.big) {
        const h = hitBox(b.r * 2, b.r * 1.6, b.r * 2);
        h.position.set(b.x, b.top - b.r * 0.6, b.z);
        icePick.add(h);
    }
    const woodPick = new THREE.Group();
    for (const l of props.logs) {
        const h = hitBox(3, 0.8, 3);
        h.position.set(l.x, H(l.x, l.z) + 0.3, l.z);
        woodPick.add(h);
    }
    root.add(icePick, woodPick);
    if (ice.big.length) {
        ctx.interaction.register({
            object: icePick,
            label: 'Glacier ice',
            maxDistance: 60,
            card: {
                title: 'Ice on black sand',
                body: '<p><b>Chunks of old glacier ice, stranded by the tide.</b></p>' +
                    '<p>Ice that has been squeezed under a glacier for centuries loses its air, so it is as clear as glass: you look straight through it to the black sand, and thick pieces turn blue-green, the colour of the light that made it through. The milky bands are layers of tiny bubbles frozen in long ago.</p>' +
                    '<p>The swash rolls the chunks smooth and leaves them in its own scour hollows. At night they hold the moon and the aurora like lenses.</p>',
            },
        });
    }
    ctx.interaction.register({
        object: woodPick,
        label: 'Driftwood',
        maxDistance: 40,
        card: {
            title: 'Driftwood',
            body: '<p>Spruce and pine from the great rivers of the north, carried for years by the coastal current and thrown up by winter storms. Salt and sun have silvered it; the snow settles on the logs in soft round cushions. It is left where the sea put it — the shore birds shelter in its lee.</p>',
        },
    });
    if (props.bench) {
        const b = props.bench;
        const benchPick = hitBox(2.5, 0.6, 0.7);
        benchPick.position.set(b.x, b.y - 0.15, b.z);
        benchPick.rotation.y = -b.rot;
        root.add(benchPick);
        ctx.interaction.register({
            object: benchPick,
            label: 'Driftwood bench',
            maxDistance: 30,
            card: {
                title: 'Driftwood bench',
                body: '<p>A split log on two stumps where the path reaches the sand, facing west over the open sea to the skerries. Brush off the snow and sit for a while: on a clear night the aurora comes up behind you, over the fjord, and the ice on the beach catches it.</p>',
            },
        });
    }
    return {
        id: 'beach',
        object: root,
        api: { iceChunks: ice.big.map((b) => ({ x: b.x, z: b.z, r: b.r })) },
    };
};
export default create;
