/**
 * Computes exact terrain tiles for the fine (near-camera) height window:
 * heights, normals and path-carve masks for a B × B block of texels.
 */
import { computeFineTile, type FineTileJob } from './fine-tile';

self.onmessage = (e: MessageEvent<FineTileJob>) => {
  const r = computeFineTile(e.data);
  (self as unknown as Worker).postMessage(r, [r.h.buffer, r.n.buffer]);
};
