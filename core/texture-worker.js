/**
 * Module worker: runs one of the procedural texture generators of
 * core/textures.ts on an OffscreenCanvas and posts the pixels back, bottom
 * row first (the main thread uploads them as DataTextures the same way up a
 * canvas would be). Started through world/spawn-worker.ts by
 * core/texture-pool.ts; no three, no bare imports.
 */
import * as T from './textures.js';
self.onmessage = (e) => {
    const { key, fn, args } = e.data;
    const t0 = performance.now();
    try {
        const gen = T[fn];
        if (typeof gen !== 'function')
            throw new Error(`no texture generator ${fn}`);
        const set = gen(...args);
        const out = {};
        const transfer = [];
        for (const k of ['map', 'bump', 'rough']) {
            const c = set[k];
            if (!c)
                continue;
            const w = c.width;
            const h = c.height;
            const src = c.getContext('2d').getImageData(0, 0, w, h).data;
            const data = new Uint8Array(w * h * 4);
            const row = w * 4;
            for (let y = 0; y < h; y++)
                data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
            out[k] = { width: w, height: h, data };
            transfer.push(data.buffer);
        }
        self.postMessage({ key, ok: true, out, ms: performance.now() - t0 }, transfer);
    }
    catch (err) {
        self.postMessage({ key, ok: false, error: String(err) });
    }
};
