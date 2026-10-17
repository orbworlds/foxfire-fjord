import type { QualitySettings } from '../../core/quality';

/**
 * Terrain LOD configuration per quality level.
 *
 * The terrain is a CDLOD quadtree: every selected node is drawn with the same
 * `gridN × gridN` grid mesh (one instanced draw call). Level 0 nodes are
 * `nodeSize0` meters wide, every level doubles. Near the camera the heights come
 * from the exact `heightAt` "fine window" (streamed by workers at `fineSpacing`),
 * farther away from the baked 3 m world grid.
 */
export interface TerrainConfig {
  gridN: number;
  nodeSize0: number;
  levels: number;
  rootX: number;
  rootZ: number;
  rootSize: number;
  /** LOD range of level 0 (m); level L uses range0 · 2^L */
  range0: number;
  /** fraction of each range where vertices start morphing to the next level */
  morphStart: number;
  fineSpacing: number;
  fineN: number;
  fineTile: number;
  maxNodes: number;
  /** shader detail tier (0 = low) */
  tier: number;
}

export function terrainConfig(q: QualitySettings): TerrainConfig {
  const d = q.terrainDetail;
  const gridN = d >= 1 ? 64 : d >= 0.75 ? 48 : 32;
  const nodeSize0 = 64;
  const fineSpacing = nodeSize0 / gridN;
  // the fine window spans ~512 m around the camera at every quality
  const fineN = d >= 1 ? 512 : d >= 0.75 ? 384 : 256;
  return {
    gridN,
    nodeSize0,
    levels: 8,
    rootX: -4096,
    rootZ: -5120,
    rootSize: 8192,
    range0: nodeSize0 * (d >= 1 ? 3.0 : d >= 0.75 ? 2.9 : 2.85),
    morphStart: 0.7,
    fineSpacing,
    fineN,
    fineTile: 32,
    maxNodes: 512,
    tier: d >= 1 ? 2 : d >= 0.75 ? 1 : 0,
  };
}
