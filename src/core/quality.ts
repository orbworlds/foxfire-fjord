/**
 * Quality presets for Foxfire Fjord. Phones start on low; a desktop with eight
 * or more cores starts on high. Features read the preset at build time and
 * listen for 'quality-changed' to rebuild; the sky, the aurora and the post
 * chain re-read it in setQuality.
 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  name: QualityName;
  /** cap for renderer pixel ratio */
  pixelRatio: number;
  shadowMapSize: number;
  /** soft-shadow PCF radius in texels */
  shadowRadius: number;
  ao: 'off' | 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  aoHalfRes: boolean;
  bloom: boolean;
  /** mip levels of the bloom blur (fewer = smaller halos, cheaper) */
  bloomLevels: number;
  smaa: boolean;
  /** 0..1 multiplier for low ground-cover instance counts (dwarf shrubs, snow tufts, …) */
  grassDensity: number;
  /** meters; how far instanced ground cover is drawn */
  grassDistance: number;
  /** 0..1 multiplier for trees / shrubs / scattered props */
  vegetationDensity: number;
  /** terrain mesh resolution multiplier (1 = full) */
  terrainDetail: number;
  /** size of procedural canvas textures (boards, wool, stone, …) */
  textureSize: number;
  /** sky environment cube face size */
  envSize: number;
  /** if false, features should skip purely decorative animated details */
  fancy: boolean;
  /** aurora raymarch samples per sky pixel */
  auroraSteps: number;
  /** aurora footprint map size (texels per side) */
  auroraMapSize: number;
  /**
   * seconds between image-based-lighting refreshes while the aurora moves
   * (0 = only when the sun moves); the raw reflection cube refreshes faster
   */
  envRefresh: number;
  /** seconds between refreshes of the raw sky cube (reflections on glass, ice and water) while the aurora moves */
  reflectRefresh: number;
  /** falling snow particles around the camera (0 = none) */
  snowfall: number;
  /** 0..1 multiplier for steam and smoke particle counts */
  steam: number;
}

const PRESETS: Record<QualityName, Omit<QualitySettings, 'name'>> = {
  low: {
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadowRadius: 1.5,
    ao: 'off',
    aoHalfRes: true,
    bloom: true,
    bloomLevels: 5,
    smaa: true,
    grassDensity: 0.25,
    grassDistance: 45,
    vegetationDensity: 0.45,
    terrainDetail: 0.5,
    textureSize: 512,
    envSize: 64,
    fancy: false,
    auroraSteps: 16,
    auroraMapSize: 512,
    envRefresh: 2.5,
    reflectRefresh: 0.5,
    snowfall: 2400,
    steam: 0.4,
  },
  medium: {
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    shadowRadius: 2,
    ao: 'Performance',
    aoHalfRes: true,
    bloom: true,
    bloomLevels: 7,
    smaa: true,
    grassDensity: 0.55,
    grassDistance: 70,
    vegetationDensity: 0.7,
    terrainDetail: 0.75,
    textureSize: 1024,
    envSize: 128,
    fancy: true,
    auroraSteps: 24,
    auroraMapSize: 1024,
    envRefresh: 1,
    reflectRefresh: 0.12,
    snowfall: 6000,
    steam: 0.7,
  },
  high: {
    pixelRatio: 1.5,
    shadowMapSize: 4096,
    shadowRadius: 2.5,
    ao: 'Medium',
    aoHalfRes: true,
    bloom: true,
    bloomLevels: 8,
    smaa: true,
    grassDensity: 0.85,
    grassDistance: 95,
    vegetationDensity: 1,
    terrainDetail: 1,
    textureSize: 1024,
    envSize: 256,
    fancy: true,
    auroraSteps: 32,
    auroraMapSize: 1024,
    envRefresh: 0.6,
    reflectRefresh: 0.07,
    snowfall: 12000,
    steam: 1,
  },
  ultra: {
    pixelRatio: 2,
    shadowMapSize: 4096,
    shadowRadius: 3,
    ao: 'High',
    aoHalfRes: false,
    bloom: true,
    bloomLevels: 8,
    smaa: true,
    grassDensity: 1,
    grassDistance: 120,
    vegetationDensity: 1,
    terrainDetail: 1,
    textureSize: 2048,
    envSize: 256,
    fancy: true,
    auroraSteps: 44,
    auroraMapSize: 2048,
    envRefresh: 0.4,
    reflectRefresh: 0.05,
    snowfall: 20000,
    steam: 1,
  },
};

export function qualityPreset(name: QualityName): QualitySettings {
  return { name, ...PRESETS[name] };
}

export function detectDefaultQuality(): QualityName {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (mobile) return 'low';
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return cores >= 8 ? 'high' : 'medium';
}

export const QUALITY_ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];
