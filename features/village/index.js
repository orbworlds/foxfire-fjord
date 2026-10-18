/**
 * Lysvik, the fishing village at the fjord mouth: painted Nordic houses on
 * the terraces above the quay, red rorbuer on stilts and tarred boathouses at
 * the water's edge, the fish landing and the old warehouse on piles, the
 * general store at the foot of the main street, a white church with a spire
 * on the top terrace, plowed lanes with street lamps, a harbour of riprap
 * breakwaters with flashing lights, boats in the open berth and frozen in
 * the ice, stockfish racks on the rocks, birches, rowans and spruces.
 *
 * Everything is merged into a handful of meshes (one per material, plus a
 * small-props group hidden from afar). At night windows, lamps and grave
 * candles glow through emissive attributes on a polar-night schedule; a
 * point-sprite light field keeps them twinkling from afar, and warm pools of
 * light lie on the snow under the lamps and below the lit windows. There are
 * no real lights. Chimneys smoke where someone is home, and the church clock
 * keeps the world's time.
 */
import * as THREE from 'three';
import { VILLAGE } from '../../world/layout.js';
import { Steam } from '../paths/kit/steam.js';
import { ensureGlyphs } from '../paths/kit/text.js';
import { Frame } from './builder.js';
import { makePlan, obbCorners } from './plan.js';
import { createVillageMaterials } from './materials.js';
import { Kit, cachedHeight } from './kit.js';
import { buildLanes } from './lanes.js';
import { buildBuildings } from './houses.js';
import { buildChurch } from './church.js';
import { buildHarbor } from './harbor.js';
import { planTrees } from './trees.js';
import { buildLightPoints } from './lights.js';
import { buildGlints, openWater } from './glints.js';
import { signCanvas } from './textures.js';
import { WalkGround } from './walk.js';
import { villageCard, harborCard, churchCard, storeCard, plantCard, rackCard, boatCard, buildingCard } from './cards.js';
const SIGN_TEXT = 'LYSVIK HANDEL Dagligvarer · Post · Fiskeutstyr LYSVIK FISK Fiskemottak';
const create = async (ctx) => {
    await ensureGlyphs(SIGN_TEXT, 700);
    const h = (x, z) => ctx.world.heightAt(x, z);
    const plan = makePlan(h, (x, z, pad) => ctx.world.isReserved(x, z, pad));
    const mats = createVillageMaterials(ctx);
    const k = new Kit(cachedHeight(h), ctx.quality.fancy);
    // build in a few slices so the main thread can breathe between them
    const yieldFrame = () => new Promise((res) => setTimeout(res, 0));
    await yieldFrame();
    // buildings first: their front doors' footpaths open the lanes' plow banks
    const signs = [];
    const doors = [];
    const buildings = await buildBuildings(k, plan, signs, doors, yieldFrame);
    await yieldFrame();
    const lanes = buildLanes(k, plan, doors);
    await yieldFrame();
    const church = buildChurch(k, plan);
    const harbor = buildHarbor(k, plan);
    const { plantings, trunks } = planTrees(k, plan, ctx.quality.vegetationDensity);
    await yieldFrame();
    // the lanes' pools: the nearest lamps to the village centre first
    const lamps = k.lamps.slice().sort((a, b) => Math.hypot(a[0] - VILLAGE.center.x, a[2] - VILLAGE.center.z) - Math.hypot(b[0] - VILLAGE.center.x, b[2] - VILLAGE.center.z));
    mats.setLamps(lamps);
    /* ---------------- walkable ground (lanes, churchyard, stair, breakwaters) ---------------- */
    const walk = new WalkGround();
    for (const ln of lanes)
        for (let i = 0; i < ln.pts.length - 1; i++)
            walk.addSegment(ln.pts[i], ln.pts[i + 1], ln.hw + 0.15);
    walk.addObb(church.yard, plan.churchyard.pad.y);
    {
        const { a, b, hw } = church.stair;
        const mid = (a[2] + b[2]) / 2;
        const f = Frame.facing(a[0], 0, mid, 0, 1);
        const o = { cx: a[0], cz: mid, ux: 1, uz: 0, hx: hw, hz: Math.abs(b[2] - a[2]) / 2 };
        walk.addRamp(o, f, a[2] - mid, a[1], b[2] - mid, b[1], hw);
    }
    for (const bw of harbor.breakwaters) {
        for (let i = 0; i < bw.pts.length - 1; i++)
            walk.addSegment({ ...bw.pts[i], y: bw.y }, { ...bw.pts[i + 1], y: bw.y }, bw.hw);
    }
    const groundAt = (x, z) => walk.height(x, z) ?? h(x, z);
    /* ---------------- meshes ---------------- */
    const root = new THREE.Group();
    root.name = 'village';
    const near = new THREE.Group();
    near.name = 'village-near';
    root.add(near);
    const geometries = [];
    const addMesh = (b, m, name, parent, cast) => {
        if (b.vertexCount === 0)
            return null;
        const g = b.build();
        geometries.push(g);
        const mesh = new THREE.Mesh(g, m);
        mesh.name = name;
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        parent.add(mesh);
        return mesh;
    };
    addMesh(k.facade, mats.facade, 'village-facade', root, true);
    addMesh(k.snow, mats.snow, 'village-snow', root, true);
    addMesh(k.stone, mats.stone, 'village-stone', root, true);
    addMesh(k.paving, mats.paving, 'village-paving', root, false);
    addMesh(k.glow, mats.glow, 'village-glow', root, false);
    addMesh(k.boat, mats.boat, 'village-boats', root, true);
    addMesh(k.boatGlow, mats.glowBob, 'village-boat-glow', root, false);
    addMesh(k.foliage, mats.foliage, 'village-foliage', root, true);
    addMesh(k.cards, mats.cards, 'village-cards', root, true);
    addMesh(k.nearFacade, mats.facade, 'village-near-facade', near, false);
    addMesh(k.nearSnow, mats.snow, 'village-near-snow', near, false);
    addMesh(k.nearStone, mats.stone, 'village-near-stone', near, false);
    addMesh(k.nearGlow, mats.glow, 'village-near-glow', near, false);
    addMesh(k.nearCards, mats.cards, 'village-near-cards', near, false);
    const ice = addMesh(k.ice, mats.ice, 'village-icicles', near, false);
    if (ice)
        ice.userData.shelter = false;
    const points = buildLightPoints(k.lights, mats.points);
    geometries.push(points.geometry);
    root.add(points);
    const glints = buildGlints(k.lights, openWater, ctx.shared, mats.uClock);
    if (glints) {
        geometries.push(glints.geometry);
        root.add(glints);
    }
    const pools = buildPools(k.pools, groundAt, mats.pools);
    if (pools) {
        geometries.push(pools.geometry);
        root.add(pools);
    }
    const offLod = ctx.lod.register(near, 420, new THREE.Vector3(VILLAGE.center.x, 10, VILLAGE.center.z));
    /* ---------------- the church clock: hands that keep the world's time ---------------- */
    const handMat = new THREE.MeshStandardMaterial({ name: 'village-clock-hands', color: 0x0a0a0c, roughness: 0.5, metalness: 0.3 });
    handMat.userData.snow = 0;
    const hourGeo = new THREE.BoxGeometry(0.075, 0.36, 0.02).translate(0, 0.14, 0);
    const minGeo = new THREE.BoxGeometry(0.05, 0.54, 0.02).translate(0, 0.22, 0);
    geometries.push(hourGeo, minGeo);
    const hands = [];
    for (const c of church.clocks) {
        const face = new THREE.Group();
        face.name = 'village-clock';
        face.position.set(c.x, c.y, c.z);
        face.lookAt(c.x + c.nx, c.y, c.z + c.nz);
        const hour = new THREE.Mesh(hourGeo, handMat);
        hour.position.z = 0.01;
        const min = new THREE.Mesh(minGeo, handMat);
        min.position.z = 0.03;
        face.add(hour, min);
        near.add(face);
        hands.push({ hour, min });
    }
    const setClock = (hrs) => {
        // clockwise seen from outside (the face looks along its local +z)
        const h12 = ((hrs % 12) + 12) % 12;
        for (const hd of hands) {
            hd.hour.rotation.z = -(h12 / 12) * Math.PI * 2;
            hd.min.rotation.z = -(((hrs % 1) + 1) % 1) * Math.PI * 2;
        }
    };
    setClock(ctx.sky.hours);
    /* ---------------- signs ---------------- */
    const signMats = [];
    const signTex = [];
    for (const s of signs) {
        const c = signCanvas(s.text, s.sub, 1024, Math.round((1024 * s.h) / s.w), s.light);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = ctx.materials.anisotropy;
        const m = new THREE.MeshStandardMaterial({ name: 'village-sign', map: t, emissiveMap: t, emissive: new THREE.Color(1.0, 0.72, 0.45), emissiveIntensity: 0, roughness: 0.7 });
        m.userData.snow = 0;
        signMats.push(m);
        signTex.push(t);
        const g = new THREE.PlaneGeometry(s.w, s.h);
        geometries.push(g);
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(s.x, s.y, s.z);
        mesh.lookAt(s.x + s.fx, s.y, s.z + s.fz);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.name = 'village-sign';
        root.add(mesh);
    }
    /* ---------------- chimney smoke ---------------- */
    let smoke = null;
    if (k.smoke.length && ctx.quality.steam > 0) {
        smoke = new Steam(ctx, {
            count: Math.min(1100, Math.round(k.smoke.length * 18 * ctx.quality.steam)),
            emitters: k.smoke.map(([x, y, z, w]) => ({ x, y, z, rx: 0.12, rz: 0.12, weight: w })),
            size: [0.45, 3.2],
            rise: [0.45, 0.85],
            life: [7, 14],
            drift: 0.75,
            opacity: 0.24,
            wander: 0.5,
            seed: 404,
            tint: 0xe9ecf0,
        });
        smoke.mesh.name = 'village-smoke';
        smoke.mesh.userData.snow = 0;
        smoke.mesh.userData.shelter = false;
        root.add(smoke.mesh);
    }
    /* ---------------- reservations (before grass / flora) ---------------- */
    const reserveCircle = (x, z, r) => ctx.world.reserve({ kind: 'circle', x, z, r, tag: 'village' });
    const reserveObb = (o, pad = 0.5) => {
        const major = Math.max(o.hx, o.hz) + pad;
        const minor = Math.min(o.hx, o.hz) + pad;
        const n = Math.max(1, Math.ceil(major / minor));
        const ax = o.hx >= o.hz ? [o.ux, o.uz] : [-o.uz, o.ux];
        const half = major / n;
        const rr = Math.hypot(half, minor);
        for (let i = 0; i < n; i++) {
            const off = -major + half * (2 * i + 1);
            reserveCircle(o.cx + ax[0] * off, o.cz + ax[1] * off, rr);
        }
    };
    const allLots = [...plan.houses, ...plan.rorbuer, ...plan.naust, ...plan.stabbur, ...plan.sheds, plan.store, plan.plant, plan.warehouse, ...(plan.school ? [plan.school] : [])];
    for (const lot of allLots)
        reserveObb(lot.obb);
    reserveObb(church.yard, 1);
    for (const ln of plan.lanes)
        for (let i = 0; i < ln.pts.length; i += 2)
            reserveCircle(ln.pts[i].x, ln.pts[i].z, ln.width / 2 + 1.2);
    ctx.world.reserve({ kind: 'rect', minX: plan.quay.minX, maxX: plan.quay.maxX, minZ: plan.quay.front, maxZ: plan.quay.back, tag: 'village' });
    for (const bw of harbor.breakwaters)
        for (let i = 0; i < bw.pts.length; i += 2)
            reserveCircle(bw.pts[i].x, bw.pts[i].z, bw.hw + 3);
    for (const rk of plan.racks)
        for (let s = -rk.len / 2; s <= rk.len / 2; s += 2)
            reserveCircle(rk.x + rk.hx * s, rk.z + rk.hz * s, 2.2);
    for (const b of plan.boats)
        if (b.state === 'land')
            reserveCircle(b.x, b.z, b.len / 2 + 0.5);
    for (const t of trunks)
        reserveCircle(t.x, t.z, Math.max(1.0, t.r + 0.8));
    /* ---------------- colliders ---------------- */
    const C = ctx.colliders;
    const colliderIds = [];
    const obbSegments = (o, r, yMin, yMax) => {
        const c = obbCorners(o, 0);
        for (let i = 0; i < 4; i++) {
            const a = c[i];
            const b = c[(i + 1) % 4];
            colliderIds.push(C.addSegment(a[0], a[1], b[0], b[1], r, { yMin, yMax, tag: 'village' }));
        }
    };
    const footprint = (b) => {
        const fx = Math.sin(b.yaw);
        const fz = Math.cos(b.yaw);
        return { cx: b.x, cz: b.z, ux: fz, uz: -fx, hx: b.w / 2, hz: b.d / 2 };
    };
    for (const b of buildings)
        obbSegments(footprint(b), 0.12, b.y - 3, b.y + b.h);
    for (const p of church.parts)
        obbSegments(footprint(p), 0.12, church.y - 3, church.y + p.h);
    for (const t of trunks)
        if (t.collide)
            colliderIds.push(C.addCircle(t.x, t.z, t.r + 0.05, { yMin: t.y - 2, yMax: t.y + 4, tag: 'village' }));
    for (const [ax, az, bx, bz, yMin, yMax] of k.walls)
        colliderIds.push(C.addSegment(ax, az, bx, bz, 0.3, { yMin, yMax, tag: 'village' }));
    for (const [x, z, r, y] of k.solids)
        colliderIds.push(C.addCircle(x, z, r, { yMin: y - 1, yMax: y + 1.6, tag: 'village' }));
    for (let i = 0; i < church.fence.length - 1; i++) {
        const [ax, az] = church.fence[i];
        const [bx, bz] = church.fence[i + 1];
        colliderIds.push(C.addSegment(ax, az, bx, bz, 0.06, { yMin: plan.churchyard.pad.y - 1, yMax: plan.churchyard.pad.y + 1.2, tag: 'village' }));
    }
    const groundId = C.addGround({ ...walk.bounds }, (x, z) => walk.height(x, z), { priority: 1 });
    /* ---------------- interaction ---------------- */
    const stats = { houses: plan.houses.length, rorbuer: plan.rorbuer.length, boats: plan.boats.length, graves: church.graves, candles: church.candles, racks: plan.racks.length };
    const village = () => villageCard(stats);
    const withVillage = (c) => ({ ...c, actions: [...(c.actions ?? []), { label: 'About Lysvik', onClick: () => ctx.ui.showCard(village()) }] });
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p3 = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const pickMesh = (items, name) => {
        const m = new THREE.InstancedMesh(unit, pickMat, items.length);
        items.forEach((b, i) => {
            q.setFromAxisAngle(UP, b.yaw);
            p3.set(b.x, b.y + b.h / 2, b.z);
            s3.set(b.w, b.h, b.d);
            m.setMatrixAt(i, m4.compose(p3, q, s3));
        });
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
        m.name = name;
        m.userData.noShadow = true;
        m.userData.shelter = false;
        m.userData.snow = 0;
        root.add(m);
        return m;
    };
    const offs = [];
    const register = (items, name, label, card) => {
        if (!items.length)
            return;
        const mesh = pickMesh(items, name);
        let picked = 0;
        offs.push(ctx.interaction.register({
            object: mesh,
            label,
            action: 'About',
            maxDistance: 70,
            onClick: (hit) => {
                picked = hit.instanceId ?? 0;
            },
            card: () => card(picked),
        }));
    };
    const box = (b) => ({ x: b.x, y: b.y, z: b.z, w: b.w, h: b.h, d: b.d, yaw: b.yaw });
    const groups = [
        ['house', 'House', (b) => b.kind === 'house'],
        ['rorbu', 'Rorbu', (b) => b.kind === 'rorbu'],
        ['naust', 'Boathouse', (b) => b.kind === 'naust'],
        ['stabbur', 'Stabbur', (b) => b.kind === 'stabbur'],
        ['shed', 'Woodshed', (b) => b.kind === 'shed'],
        ['school', 'The old school', (b) => b.kind === 'school'],
        ['warehouse', 'Old warehouse', (b) => b.kind === 'warehouse'],
        ['store', 'Lysvik Handel', (b) => b.kind === 'store', () => storeCard()],
        ['plant', 'Lysvik Fisk', (b) => b.kind === 'plant', () => plantCard()],
    ];
    for (const [id, label, test, special] of groups) {
        const list = buildings.filter(test);
        register(list.map(box), `village-pick-${id}`, label, (i) => {
            const b = list[i] ?? list[0];
            return withVillage(special ? special(b, i) : buildingCard(b, buildings.indexOf(b)));
        });
    }
    register(church.parts.map((p) => ({ x: p.x, y: church.y, z: p.z, w: p.w, h: p.h, d: p.d, yaw: p.yaw })), 'village-pick-church', 'Lysvik church', () => withVillage(churchCard(church.graves, church.candles)));
    const portBoxes = harbor.towers.map((t) => ({ x: t.x, y: t.y, z: t.z, w: 2.2, h: t.h, d: 2.2, yaw: 0 }));
    {
        const qd = plan.quay;
        portBoxes.push({ x: (qd.minX + qd.maxX) / 2, y: qd.y - 0.4, z: qd.front + 1.2, w: qd.maxX - qd.minX, h: 0.8, d: 2.4, yaw: 0 });
    }
    register(portBoxes, 'village-pick-port', 'Lysvik harbour', () => withVillage(harborCard(plan.boats.length)));
    register(harbor.boats.map((b) => ({ x: b.x, y: b.y - 0.6, z: b.z, w: b.len * 0.3, h: 3.2, d: b.len, yaw: b.yaw })), 'village-pick-boats', 'Fishing boat', (i) => withVillage(boatCard(harbor.boats[i]?.state ?? 'afloat')));
    register(plan.racks.map((rk) => ({ x: rk.x, y: rk.y, z: rk.z, w: 2.6, h: 4.6, d: rk.len, yaw: Math.atan2(rk.hx, rk.hz) })), 'village-pick-racks', 'Stockfish racks', () => withVillage(rackCard()));
    const api = {
        houses: plan.houses.length,
        buildings: buildings.length + 1,
        boats: plan.boats.length,
        lights: k.lights.length,
        trees: trunks.length,
        harbor: { x: plan.basin[0], z: plan.basin[1] },
        church: { x: church.x, y: church.y, z: church.z },
        pathEnd: { x: plan.pathEnd[0], z: plan.pathEnd[1] },
        card: village,
        plantings,
    };
    const halfFov = () => Math.tan((ctx.camera.fov * Math.PI) / 360);
    const night = () => Math.max(ctx.shared.uNight.value, THREE.MathUtils.smoothstep(-ctx.sky.sunDir.y, -0.06, 0.09));
    return {
        id: 'village',
        object: root,
        api,
        update() {
            mats.uClock.value = ctx.sky.hours;
            setClock(ctx.sky.hours);
            mats.uPixelScale.value = ctx.renderer.domElement.height / (2 * halfFov());
            const n = night();
            // the light-only layers draw nothing by day: skip them
            const dark = n > 0.005;
            points.visible = dark;
            if (pools)
                pools.visible = dark;
            if (glints)
                glints.visible = dark;
            const hrs = ctx.sky.hours;
            const open = hrs > 7.5 && hrs < 23 ? 1 : 0;
            for (const m of signMats)
                m.emissiveIntensity = 0.55 * n * open;
            if (smoke)
                smoke.visibility = 0.75 + 0.25 * n;
        },
        dispose() {
            offs.forEach((off) => off());
            offLod();
            colliderIds.forEach((id) => C.remove(id));
            C.removeGround(groundId);
            geometries.forEach((g) => g.dispose());
            unit.dispose();
            pickMat.dispose();
            handMat.dispose();
            signMats.forEach((m) => m.dispose());
            signTex.forEach((t) => t.dispose());
            smoke?.mesh.geometry.dispose();
            glints?.material?.dispose();
            smoke?.material.dispose();
            mats.dispose();
        },
    };
};
/** Warm light lying on the snow: one small draped grid per pool, additive, switched by the schedules. */
function buildPools(list, groundAt, mat) {
    if (!list.length)
        return null;
    const N = 5;
    const vpp = (N + 1) * (N + 1);
    const pos = new Float32Array(list.length * vpp * 3);
    const uv = new Float32Array(list.length * vpp * 2);
    const glow = new Float32Array(list.length * vpp * 4);
    const kind = new Float32Array(list.length * vpp * 4);
    const col = new Float32Array(list.length * vpp * 3);
    const idx = [];
    list.forEach((p, n) => {
        const base = n * vpp;
        // local axes: along = the fan direction (or z), across
        const ax = p.dx;
        const az = p.dz;
        const cx = -az;
        const cz = ax;
        for (let j = 0; j <= N; j++) {
            for (let i = 0; i <= N; i++) {
                const u = (i / N) * 2 - 1;
                const v = (j / N) * 2 - 1;
                const x = p.x + cx * u * p.rx + ax * v * p.rz;
                const z = p.z + cz * u * p.rx + az * v * p.rz;
                const y = Math.max(groundAt(x, z), p.y ?? -1e9) + 0.05;
                const k = base + j * (N + 1) + i;
                pos.set([x, y, z], k * 3);
                uv.set([u, v], k * 2);
                glow.set(p.glow, k * 4);
                kind.set([p.shape, p.sched, 0, 0], k * 4);
                col.set(p.color, k * 3);
            }
        }
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const a = base + j * (N + 1) + i;
                idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
            }
        }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = 'village-pools';
    m.renderOrder = 4;
    m.matrixAutoUpdate = false;
    m.userData.noPick = true;
    m.userData.snow = 0;
    m.userData.shelter = false;
    m.raycast = () => { };
    return m;
}
export default create;
