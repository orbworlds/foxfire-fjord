/**
 * Computes exact terrain tiles for the fine (near-camera) height window:
 * heights, normals and path-carve masks for a B × B block of texels.
 */
import { computeFineTile } from './fine-tile.js';
self.onmessage = (e) => {
    const r = computeFineTile(e.data);
    self.postMessage(r, [r.h.buffer, r.n.buffer]);
};
