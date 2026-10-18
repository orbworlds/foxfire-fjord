/**
 * Hand-placed hero trees with their own geometry (merged into one mesh, one
 * draw + one shadow draw):
 *   - a stand of big snow-laden spruces east of Aurora Cabin, framing it from
 *     the yard and the road and standing dark behind the glass wing;
 *   - a wind-bent snow ghost on the brink of the cabin knoll above the fjord,
 *     plastered white by the storms off the sea;
 *   - a lone mountain birch at the hot spring, its twigs rimed white by the steam;
 *   - a rowan with red berry clusters by the road into Lysvik.
 * The scatter keeps clear of them (HERO_KEEPOUT).
 */
import * as THREE from 'three';
import { hitBox } from '../../core/geometry.js';
import { SNOW_WIND, SPRING } from '../../world/layout.js';
import { MeshBuilder } from './builder.js';
import { birchTemplate, rowanTemplate, spruceTemplate } from './trees.js';
const HERO_SPOTS = [
    // the stand east of the cabin
    { kind: 'spruce', x: 27, z: -3, height: 15, seed: 7101 },
    { kind: 'spruce', x: 22, z: 12, height: 12, seed: 7102 },
    { kind: 'spruce', x: 34, z: 8, height: 17.5, seed: 7103 },
    { kind: 'spruce', x: 31, z: 21, height: 10, seed: 7104 },
    // a dark backdrop behind the glass wing, seen from the yard's west end
    { kind: 'spruce', x: 45, z: -22, height: 14, seed: 7105 },
    { kind: 'spruce', x: 58, z: -13, height: 16.5, seed: 7106 },
    { kind: 'spruce', x: 38, z: -31, height: 11, seed: 7107 },
    // on the knoll's brink, bent by the wind up the fjord
    { kind: 'ghost', x: -30, z: -16, height: 7.5, seed: 7201 },
    // by the hot pool
    { kind: 'birch', x: SPRING.x - 7.5, z: SPRING.z + 4, height: 7.5, seed: 7301, force: true },
    // by the road into Lysvik
    { kind: 'rowan', x: -687, z: -80, height: 6.5, seed: 7401 },
];
/** Where the scatter must not put trees (hero trunks and crowns). */
export const HERO_KEEPOUT = HERO_SPOTS.map((s) => ({ x: s.x, z: s.z, r: s.kind === 'spruce' ? 6 : 4.5 }));
function makeMesh(b, mats, name) {
    const mesh = new THREE.Mesh(b.build(), mats.plant);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = mats.plantDepth;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
}
/** First free spot near (x, z) among a few small offsets. */
function freeSpot(world, x, z, pad) {
    const offsets = [
        [0, 0],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
        [3, 3],
        [-3, -3],
        [4, -3],
        [-4, 3],
        [0, 5],
        [5, 0],
        [-5, 0],
    ];
    for (const [ox, oz] of offsets) {
        if (world.isReserved(x + ox, z + oz, pad))
            continue;
        if (world.pathCarve(x + ox, z + oz).weight > 0.3)
            continue;
        return [x + ox, z + oz];
    }
    return null;
}
export function buildHero(world, atlas, mats, colliders, extra = []) {
    const hits = { spruce: new THREE.Group(), ghost: new THREE.Group(), birch: new THREE.Group(), rowan: new THREE.Group() };
    for (const [k, g] of Object.entries(hits))
        g.name = `flora-hit-${k}`;
    const all = new MeshBuilder();
    const plants = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const UPV = new THREE.Vector3(0, 1, 0);
    // the storm wind's lee side: the ghost's flagged crown points downwind (template +x)
    const leeYaw = -Math.atan2(SNOW_WIND.z, SNOW_WIND.x);
    for (const s of [...HERO_SPOTS, ...extra]) {
        const spot = s.force ? [s.x, s.z] : freeSpot(world, s.x, s.z, s.kind === 'rowan' ? 1.5 : 1);
        if (!spot)
            continue;
        const [x, z] = spot;
        const h = world.heightAt(x, z);
        let tpl;
        let trunkR = 0.3;
        let crownR = 3;
        switch (s.kind) {
            case 'spruce':
                tpl = spruceTemplate(atlas, s.seed, { height: s.height, spread: 0.21, profile: 0.9, load: 0.8, whorl: 0.42, boughs: 8, lichen: 0.25 });
                trunkR = 0.1 + 0.013 * s.height;
                crownR = s.height * 0.21;
                break;
            case 'ghost':
                tpl = spruceTemplate(atlas, s.seed, { height: s.height, spread: 0.27, profile: 0.7, load: 1.3, whorl: 0.4, boughs: 7, flag: 0.7, plaster: 1, lean: 0.1 });
                trunkR = 0.18;
                crownR = s.height * 0.22;
                break;
            case 'birch':
                tpl = birchTemplate(atlas, s.seed, { height: s.height, stems: 3, lean: 0.38, crook: 0.7, bark: 'birch', twigs: 'rimeTwigs', twigScale: 1.3, limbs: 6, rime: 0.35, weep: 0.2 });
                trunkR = 0.25;
                crownR = s.height * 0.38;
                break;
            default:
                tpl = rowanTemplate(atlas, s.seed, { height: s.height, stems: 2, berries: 80 });
                trunkR = 0.2;
                crownR = s.height * 0.36;
        }
        const yaw = s.kind === 'ghost' ? leeYaw : (s.yaw ?? ((s.seed * 2.39996) % (Math.PI * 2)));
        q.setFromAxisAngle(UPV, yaw);
        m.compose(new THREE.Vector3(x, h - (s.kind === 'birch' || s.kind === 'rowan' ? 0.15 : 0.3), z), q, new THREE.Vector3(1, 1, 1));
        all.append(tpl, m);
        colliders.addCircle(x, z, trunkR + 0.15);
        const box = hitBox(crownR * 1.6, s.height, crownR * 1.6);
        box.position.set(x, h + s.height * 0.5, z);
        hits[s.kind].add(box);
        plants.push({ kind: s.kind, x, z, y: h, height: s.height });
    }
    const meshes = [];
    if (all.vertexCount)
        meshes.push(makeMesh(all, mats, 'flora-hero'));
    return { meshes, plants, hits, triangles: all.triangleCount };
}
