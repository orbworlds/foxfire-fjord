/**
 * Trees in and around Lysvik: mountain birches and rowans in the yards and
 * along the lanes, spruce shelter belts and birch groves on the village
 * fringe, spruces at the churchyard's back corners. The village only plans
 * them (spots, kinds, heights): the flora feature draws them with the
 * forest's own templates (api.plantings → spruce/birch instances with
 * impostors, rowans with berries as hand-built trees), so they match the
 * woods around the village. The village keeps their trunks for colliders
 * and reservations.
 */
import { mulberry32 } from '../../world/noise.js';
const TAU = Math.PI * 2;
export function planTrees(k, plan, density) {
    const r = mulberry32(1717);
    const spots = [...k.trees];
    const clear = (x, z, d) => spots.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > d * d);
    const add = (x, z, kind, s, gap, clearance) => {
        if (!plan.isFree(x, z, clearance) || plan.blocksView(x, z) || !clear(x, z, gap))
            return false;
        const y = k.h(x, z);
        if (y < 2)
            return false;
        spots.push({ x, y, z, kind, s, seed: Math.floor(r() * 1e6) });
        return true;
    };
    const dens = Math.max(0.6, density);
    // yard trees: a birch or a rowan behind or beside most houses
    for (const hs of [...plan.houses, ...(plan.school ? [plan.school] : [])]) {
        if (r() > 0.75 * dens)
            continue;
        const ux = hs.fz;
        const uz = -hs.fx;
        const cands = [
            [(r() - 0.5) * hs.w * 0.8, -(hs.d / 2 + 3 + r() * 2)],
            [(r() < 0.5 ? -1 : 1) * (hs.w / 2 + 2.6 + r() * 1.5), (r() - 0.5) * hs.d * 0.6],
            [(r() - 0.5) * hs.w, -(hs.d / 2 + 5.5 + r() * 2)],
        ];
        let n = 0;
        for (const [lx, lz] of cands) {
            const x = hs.x + ux * lx + hs.fx * lz;
            const z = hs.z + uz * lx + hs.fz * lz;
            if (add(x, z, r() < 0.62 ? 'birch' : 'rowan', 0.75 + r() * 0.4, 4.5, 1.4) && ++n >= (r() < 0.3 ? 2 : 1))
                break;
        }
    }
    // spruce shelter belts and birch groves on the village fringe
    const C = plan.churchyard.pad;
    const fringe = [
        [C.minX - 26, C.maxZ + 10, 9, 'spruce', 16],
        [C.maxX + 40, C.maxZ + 18, 8, 'spruce', 16],
        [C.minX - 70, C.minZ - 10, 8, 'birch', 15],
        [C.maxX + 70, C.minZ + 4, 7, 'birch', 15],
        [C.minX - 90, C.maxZ + 30, 9, 'birch', 18],
        [(C.minX + C.maxX) / 2, C.maxZ + 40, 8, 'birch', 18],
        [C.maxX + 95, C.maxZ + 35, 8, 'spruce', 16],
    ];
    for (const [cx, cz, n, kind, R] of fringe) {
        const count = Math.round(n * dens);
        let placed = 0;
        for (let i = 0; i < count * 4 && placed < count; i++) {
            const a = r() * TAU;
            const d = Math.sqrt(r()) * R;
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            const kk = kind === 'spruce' && r() < 0.2 ? 'birch' : kind;
            if (add(x, z, kk, 0.75 + r() * 0.5, kk === 'spruce' ? 4.2 : 3.6, 1.6))
                placed++;
        }
    }
    const plantings = [];
    const trunks = [];
    for (const t of spots) {
        const q = mulberry32(t.seed);
        const H = t.kind === 'spruce' ? (10 + q() * 5) * t.s : t.kind === 'birch' ? (7.5 + q() * 3) * t.s : (5.5 + q() * 2) * t.s;
        plantings.push({ kind: t.kind, x: t.x, z: t.z, height: H, seed: t.seed });
        trunks.push({ x: t.x, z: t.z, r: t.kind === 'spruce' ? 0.1 + 0.013 * H : t.kind === 'birch' ? 0.16 : 0.2, y: t.y, h: H, collide: t.kind !== 'rowan' });
    }
    return { plantings, trunks };
}
