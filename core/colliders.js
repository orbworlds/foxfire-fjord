import { heightAt } from '../world/terrain-height.js';
const CELL = 8;
export class Colliders {
    entries = new Map();
    grid = new Map();
    grounds = [];
    nextId = 1;
    /** maximum step a walker can climb (m) */
    stepUp = 0.55;
    add(shape, opts = {}) {
        const id = this.nextId++;
        const e = { id, shape, yMin: opts.yMin ?? -Infinity, yMax: opts.yMax ?? Infinity, enabled: true, tag: opts.tag };
        this.entries.set(id, e);
        const bb = bounds(shape);
        for (let cz = Math.floor(bb.minZ / CELL); cz <= Math.floor(bb.maxZ / CELL); cz++) {
            for (let cx = Math.floor(bb.minX / CELL); cx <= Math.floor(bb.maxX / CELL); cx++) {
                const key = cz * 100003 + cx;
                let list = this.grid.get(key);
                if (!list)
                    this.grid.set(key, (list = []));
                list.push(id);
            }
        }
        return id;
    }
    addBox(minX, minZ, maxX, maxZ, opts) {
        return this.add({ kind: 'box', minX, maxX, minZ, maxZ }, opts);
    }
    addCircle(x, z, r, opts) {
        return this.add({ kind: 'circle', x, z, r }, opts);
    }
    addSegment(ax, az, bx, bz, r = 0.05, opts) {
        return this.add({ kind: 'segment', ax, az, bx, bz, r }, opts);
    }
    setEnabled(id, enabled) {
        const e = this.entries.get(id);
        if (e)
            e.enabled = enabled;
    }
    remove(id) {
        this.entries.delete(id);
    }
    /** Register a walkable surface. Return null from `height` where it does not apply. */
    addGround(bounds, height, opts = {}) {
        const id = this.nextId++;
        this.grounds.push({ id, bounds, height, priority: opts.priority ?? 0 });
        this.grounds.sort((a, b) => b.priority - a.priority);
        return id;
    }
    removeGround(id) {
        this.grounds = this.grounds.filter((g) => g.id !== id);
    }
    /**
     * Height of the walkable surface under (x, z) for a walker whose feet are at
     * `feetY` (surfaces higher than feetY + stepUp are ignored, e.g. a table).
     * Pass feetY = Infinity to get the highest surface.
     */
    groundAt(x, z, feetY = Infinity) {
        let best = heightAt(x, z);
        for (const g of this.grounds) {
            const b = g.bounds;
            if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)
                continue;
            const h = g.height(x, z);
            if (h === null || h === undefined)
                continue;
            if (h > feetY + this.stepUp)
                continue;
            if (h > best)
                best = h;
        }
        return best;
    }
    /** Push a walker (feet position) out of colliders. Mutates `p`. */
    resolve(p, radius = 0.3, height = 1.7) {
        for (let iter = 0; iter < 3; iter++) {
            let moved = false;
            const ids = new Set();
            for (let cz = Math.floor((p.z - radius) / CELL); cz <= Math.floor((p.z + radius) / CELL); cz++) {
                for (let cx = Math.floor((p.x - radius) / CELL); cx <= Math.floor((p.x + radius) / CELL); cx++) {
                    const list = this.grid.get(cz * 100003 + cx);
                    if (list)
                        for (const id of list)
                            ids.add(id);
                }
            }
            for (const id of ids) {
                const e = this.entries.get(id);
                if (!e || !e.enabled)
                    continue;
                if (p.y + height < e.yMin || p.y + 0.25 > e.yMax)
                    continue;
                const [cx, cz] = closest(e.shape, p.x, p.z);
                let dx = p.x - cx;
                let dz = p.z - cz;
                let d = Math.hypot(dx, dz);
                const r = radius + (e.shape.kind === 'segment' ? e.shape.r : 0);
                const inside = e.shape.kind === 'box' && p.x > e.shape.minX && p.x < e.shape.maxX && p.z > e.shape.minZ && p.z < e.shape.maxZ;
                if (inside && e.shape.kind === 'box') {
                    // push out through the nearest box edge
                    const s = e.shape;
                    const opts = [
                        [p.x - s.minX, -1, 0],
                        [s.maxX - p.x, 1, 0],
                        [p.z - s.minZ, 0, -1],
                        [s.maxZ - p.z, 0, 1],
                    ].sort((a, b) => a[0] - b[0])[0];
                    p.x += opts[1] * (opts[0] + radius);
                    p.z += opts[2] * (opts[0] + radius);
                    moved = true;
                }
                else if (d < r) {
                    if (d < 1e-6) {
                        dx = 1;
                        dz = 0;
                        d = 1;
                    }
                    p.x = cx + (dx / d) * r;
                    p.z = cz + (dz / d) * r;
                    moved = true;
                }
            }
            if (!moved)
                break;
        }
    }
}
function bounds(s) {
    if (s.kind === 'box')
        return { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ };
    if (s.kind === 'circle')
        return { minX: s.x - s.r, maxX: s.x + s.r, minZ: s.z - s.r, maxZ: s.z + s.r };
    return {
        minX: Math.min(s.ax, s.bx) - s.r,
        maxX: Math.max(s.ax, s.bx) + s.r,
        minZ: Math.min(s.az, s.bz) - s.r,
        maxZ: Math.max(s.az, s.bz) + s.r,
    };
}
function closest(s, x, z) {
    if (s.kind === 'box')
        return [Math.min(s.maxX, Math.max(s.minX, x)), Math.min(s.maxZ, Math.max(s.minZ, z))];
    if (s.kind === 'circle') {
        const dx = x - s.x;
        const dz = z - s.z;
        const d = Math.hypot(dx, dz) || 1;
        return [s.x + (dx / d) * s.r, s.z + (dz / d) * s.r];
    }
    const abx = s.bx - s.ax;
    const abz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * abx + (z - s.az) * abz) / (abx * abx + abz * abz || 1)));
    return [s.ax + abx * t, s.az + abz * t];
}
