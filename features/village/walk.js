import { obbContains } from './plan.js';
const CELL = 16;
export class WalkGround {
    bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    surfs = [];
    grid = new Map();
    /** extra flat surface (the quay apron), tested last */
    extra = null;
    addObb(o, y) {
        this.push({ kind: 'obb', o, y }, obbBox(o, 0));
    }
    addSegment(a, b, hw) {
        const box = {
            minX: Math.min(a.x, b.x) - hw,
            maxX: Math.max(a.x, b.x) + hw,
            minZ: Math.min(a.z, b.z) - hw,
            maxZ: Math.max(a.z, b.z) + hw,
        };
        this.push({ kind: 'seg', ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw }, box);
    }
    /** linear ramp in frame `f` from local z = zA (height yA) to zB (yB), |local x| ≤ hw */
    addRamp(o, f, zA, yA, zB, yB, hw) {
        this.push({ kind: 'ramp', o, f, zA, yA, zB, yB, hw }, obbBox(o, 0.2));
    }
    expand(b) {
        this.bounds.minX = Math.min(this.bounds.minX, b.minX);
        this.bounds.maxX = Math.max(this.bounds.maxX, b.maxX);
        this.bounds.minZ = Math.min(this.bounds.minZ, b.minZ);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, b.maxZ);
    }
    push(s, b) {
        const i = this.surfs.length;
        this.surfs.push(s);
        this.expand(b);
        for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
            for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) {
                const key = cz * 100003 + cx;
                let l = this.grid.get(key);
                if (!l)
                    this.grid.set(key, (l = []));
                l.push(i);
            }
        }
    }
    height(x, z) {
        let best = null;
        const l = this.grid.get(Math.floor(z / CELL) * 100003 + Math.floor(x / CELL));
        if (l) {
            for (const i of l) {
                const y = sample(this.surfs[i], x, z);
                if (y !== null && (best === null || y > best))
                    best = y;
            }
        }
        if (best === null && this.extra)
            best = this.extra(x, z);
        return best;
    }
}
function sample(s, x, z) {
    if (s.kind === 'obb')
        return obbContains(s.o, x, z) ? s.y : null;
    if (s.kind === 'seg') {
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
        const px = s.ax + dx * t - x;
        const pz = s.az + dz * t - z;
        if (px * px + pz * pz > s.hw * s.hw)
            return null;
        return s.ay + (s.by - s.ay) * t;
    }
    const f = s.f;
    const rx = x - f.ox;
    const rz = z - f.oz;
    const lx = rx * f.exx + rz * f.exz;
    const lz = rx * f.ezx + rz * f.ezz;
    if (Math.abs(lx) > s.hw)
        return null;
    const lo = Math.min(s.zA, s.zB);
    const hi = Math.max(s.zA, s.zB);
    if (lz < lo || lz > hi)
        return null;
    const t = (lz - s.zA) / (s.zB - s.zA || 1);
    return s.yA + (s.yB - s.yA) * t;
}
function obbBox(o, pad) {
    const ex = Math.abs(o.ux) * o.hx + Math.abs(o.uz) * o.hz + pad;
    const ez = Math.abs(o.uz) * o.hx + Math.abs(o.ux) * o.hz + pad;
    return { minX: o.cx - ex, maxX: o.cx + ex, minZ: o.cz - ez, maxZ: o.cz + ez };
}
