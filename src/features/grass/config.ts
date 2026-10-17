/**
 * Ground-cover settings: chunk sizes, the per-instance layout, the kinds of
 * blades (straw, lyme grass, seed stalks, melt-ring moss) and the densities and
 * distances derived from the quality preset.
 */
import type { QualitySettings } from '../../core/quality';

/** Near blades live in small chunks (fine LOD granularity), far tufts in big ones. */
export const NEAR_CHUNK = 16;
export const FAR_CHUNK = 32;

/** Floats per grass instance: root.xyz rank | height width facing kind*2+lean | hue dry nx nz */
export const STRIDE = 12;

/** Instance kinds (encoded as floor(iShape.w / 2) in the shader). */
/** bleached winter straw (green grass in the melt ring, where `dry` is low) */
export const KIND_STRAW = 0;
/** lyme grass on the beach dunes: stiff, arching, blue-grey to straw */
export const KIND_LYME = 1;
/** a dried seed stalk */
export const KIND_SEED = 2;
/** low green moss cushions in the hot spring's melt ring */
export const KIND_MOSS = 3;

export interface GrassSettings {
  /** blade clumps (5 blades each) / m² at full density (the melt ring) */
  bladeDensity: number;
  /** crossed-card tufts / m² at full far-field density */
  tuftDensity: number;
  /** radius around the camera with full blade density */
  lodR0: number;
  /** blade density falls off as (lodR0 / d)^lodPow beyond lodR0 */
  lodPow: number;
  /** near blades hand over to tufts across [nearFadeStart, nearFadeEnd] */
  nearFadeStart: number;
  nearFadeEnd: number;
  /** tufts shrink away across [farFadeStart, farFadeEnd]; terrain shading takes over */
  farFadeStart: number;
  farFadeEnd: number;
  /** full tuft density out to here */
  tuftR0: number;
  /** blade width multiplier compensating lower densities */
  widthScale: number;
  /** per-frame CPU budget for chunk / flower builds (ms) */
  budgetMs: number;
  /** spacing of the per-chunk height grid: the terrain mesh's near vertex spacing */
  heightStep: number;
  /** the terrain shades terrain-scale sun shadows above its lowest tier; grass follows */
  terrainShadow: boolean;
}

export function grassSettings(q: QualitySettings): GrassSettings {
  const dist = q.grassDistance;
  const dens = Math.max(0.05, q.grassDensity);
  const nearEnd = Math.max(16, Math.min(46, dist * 0.42));
  return {
    // dense close in, where the view looks down into the sward; beyond lodR0 the
    // (lodR0 / d)^lodPow falloff matches the cost of a sparser, wider disc
    bladeDensity: 38 * dens,
    tuftDensity: 7 * Math.sqrt(dens),
    lodR0: 3.85 + 3.85 * dens,
    lodPow: 1.55,
    nearFadeStart: nearEnd - 8,
    nearFadeEnd: nearEnd,
    farFadeStart: dist * 0.68,
    farFadeEnd: dist,
    tuftR0: nearEnd,
    widthScale: Math.pow(0.85 / dens, 0.32),
    budgetMs: 2.6,
    // the terrain draws exact heights on a 64 m / gridN lattice near the camera;
    // sampling the same lattice keeps roots on the rendered surface
    heightStep: 64 / (q.terrainDetail >= 1 ? 64 : q.terrainDetail >= 0.75 ? 48 : 32),
    terrainShadow: q.terrainDetail >= 0.75,
  };
}
