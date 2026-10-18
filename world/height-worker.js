/**
 * Module worker: bakes rows of the world height grid (`heightAt`) for
 * world.ts. Started through spawn-worker.ts; no three, no bare imports.
 */
import { heightAt } from './terrain-height.js';
self.onmessage = (e) => {
    const { minX, minZ, maxX, maxZ, nx, nz, row0, row1 } = e.data;
    const out = new Float32Array(nx * (row1 - row0));
    for (let j = row0; j < row1; j++) {
        const z = minZ + ((maxZ - minZ) * j) / (nz - 1);
        const base = (j - row0) * nx;
        for (let i = 0; i < nx; i++) {
            const x = minX + ((maxX - minX) * i) / (nx - 1);
            out[base + i] = heightAt(x, z);
        }
    }
    self.postMessage({ row0, row1, data: out }, [out.buffer]);
};
