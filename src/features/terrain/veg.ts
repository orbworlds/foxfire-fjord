import * as THREE from 'three';
import { FOX_PEAK, HOUSE, SITES, SPRING, VILLAGE } from '../../world/layout';
import { coastDistance, lakeSd } from '../../world/terrain-height';
import { createSimplex2D, fbm, smoothstep as smooth } from '../../world/noise';
import type { TerrainBake } from './bake';

/**
 * Boreal vegetation cover, RGBA8 on an 8 m grid:
 *   R: tree cover (0..1),
 *   G: open dwarf scrub (dwarf birch, juniper) poking through the snow,
 *   B: clearing factor (0 = deliberate clearing),
 *   A: birch share of the trees (0 = Norway spruce, 1 = mountain birch).
 *
 * Spruce fills the sheltered valleys and lower slopes up to a treeline of
 * ~150-200 m, mountain birch takes the margins and climbs to ~300 m; bare snow
 * and rock above. The foreland across the fjord, under the Teeth, carries open
 * birch woodland in irregular stands with spruce clumps, white bogs and stream
 * tracks between them (the terrain draws it as canopy from afar, a stippled
 * grey belt between the fjord and the white mountains). No trees on the lake ice, the fjord walls and other steep
 * faces, or wind-scoured crests; view corridors stay open north of the cabin,
 * the hot spring and the summit. The terrain darkens the snow under the cover
 * and the flora scatter should follow the same terms (keep the two in sync).
 */
export interface VegMask {
  tex: THREE.DataTexture;
  /** (minX, minZ, 1 / width, 1 / depth) for uv = (xz - min) * scale */
  info: THREE.Vector4;
}

const CELL = 8;
const X0 = -1760;
const X1 = 1720;
const Z0 = -2100;
const Z1 = 1520;

/** Open view cones (apex x, z, direction x, z, half angle cos, length). */
const CORRIDORS: [number, number, number, number, number, number][] = [
  [HOUSE.x, HOUSE.z - 6, 0, -1, Math.cos(0.75), 260],
  [SPRING.x, SPRING.z, -0.92, -0.39, Math.cos(0.6), 300],
  [SPRING.x, SPRING.z, 0, -1, Math.cos(0.5), 200],
];

function inBox(x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }, pad: number): boolean {
  return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
}

export function bakeVegetation(bake: TerrainBake): VegMask {
  const nx = Math.ceil((X1 - X0) / CELL);
  const nz = Math.ceil((Z1 - Z0) / CELL);
  const nClear = createSimplex2D(9101);
  const nSpecies = createSimplex2D(9202);
  const nPatch = createSimplex2D(9303);
  const nLine = createSimplex2D(9404);
  const nStand = createSimplex2D(9505);
  const nStream = createSimplex2D(9606);
  const data = new Uint8Array(nx * nz * 4);
  const H = (x: number, z: number) => bake.sample(bake.heights, x, z);
  for (let j = 0; j < nz; j++) {
    const z = Z0 + (j + 0.5) * CELL;
    for (let i = 0; i < nx; i++) {
      const x = X0 + (i + 0.5) * CELL;
      const o = (j * nx + i) * 4;
      const h = H(x, z);
      if (h < 1.5) {
        data[o + 2] = 255;
        continue;
      }
      const slope = bake.sample(bake.slope, x, z);
      const cav = bake.sample(bake.cavity, x, z);
      const shel = bake.sample(bake.shelter, x, z);
      const cd = coastDistance(x, z);
      // the treeline wanders with exposure: higher in sheltered valleys, lower on windy spurs
      const line = 16 * fbm(nLine, x / 300, z / 300, 2) + 40 * shel + 6 * Math.max(-3, Math.min(3, cav));
      const fSpruce = 1 - smooth(130, 200, h - line);
      const fBirch = 1 - smooth(230, 310, h - line);
      const fCoast = smooth(10, 45, cd);
      const fSlope = 1 - smooth(0.62, 1.05, slope);
      const fScour = 1 - smooth(0.15, 0.6, -shel) * smooth(-1, 2, -cav);
      const dVil = Math.hypot(x - VILLAGE.center.x, z - VILLAGE.center.z);
      const fVil = 0.15 + 0.85 * smooth(VILLAGE.radius * 0.7, VILLAGE.radius + 60, dVil);
      const ls = lakeSd(x, z);
      const fLake = smooth(6, 30, ls);
      let fSite = 1;
      if (inBox(x, z, { minX: HOUSE.x - 26, maxX: HOUSE.x + 22, minZ: HOUSE.z - 24, maxZ: HOUSE.z + 20 }, 0)) fSite = 0;
      if (inBox(x, z, SITES.spring, 10) || inBox(x, z, SITES.sauna, 8) || inBox(x, z, SITES.quay, 12)) fSite = 0;
      if (Math.hypot(x - FOX_PEAK.x, z - FOX_PEAK.z) < 80) fSite = 0;
      let fView = 1;
      for (const [ax, az, dx, dz, cosA, len] of CORRIDORS) {
        const vx = x - ax;
        const vz = z - az;
        const l = Math.hypot(vx, vz);
        if (l > len || l < 1e-3) continue;
        const c = (vx * dx + vz * dz) / l;
        if (c > cosA) fView = Math.min(fView, smooth(len * 0.85, len, l) + (1 - smooth(cosA, cosA + 0.08, c)));
      }
      const fClear = smooth(-0.5, -0.1, fbm(nClear, x / 240, z / 240, 3));
      // the north foreland, sheltered under the Teeth: a wood along the fjord climbing to a ragged
      // upper edge (higher in the sheltered hollows), scattered clumps above it, then open snow up
      // to the mountains; broad white bogs on the flats, stream and avalanche tracks running down
      // the fall line through it
      const fore = smooth(-950, -1080, z) * (1 - smooth(140, 230, h - line * 0.5));
      let fStand = 1;
      if (fore > 0) {
        const wx = x + 90 * fbm(nPatch, x / 400 + 7, z / 400, 2);
        const edge = 80 + 55 * fbm(nStand, x / 420, z / 380 + 3.1, 3) + 35 * smooth(0, 0.8, shel);
        const dense = 1 - smooth(edge - 12, edge + 18, h + 18 * fbm(nStand, wx / 70, z / 55, 2));
        const clumps =
          smooth(0.12, 0.3, fbm(nStand, wx / 85, z / 65 + 9.3, 3) - 0.2 * smooth(edge, edge + 110, h)) * (1 - smooth(edge + 50, edge + 140, h));
        const bog = smooth(0.22, 0.36, fbm(nPatch, x / 260 + 4, z / 170 - 2, 3)) * smooth(0.14, 0.05, slope);
        const track = smooth(0.85, 0.94, 1 - Math.abs(nStream(wx / 150, z / 1100))) * smooth(-0.25, 0.15, nStream(x / 320 + 5.3, z / 320 - 2.1));
        const gully = smooth(1.2, 3.2, cav);
        fStand = Math.max(dense, clumps) * (1 - bog) * (1 - track) * (1 - 0.85 * gully);
        fStand = 1 - fore + fore * fStand;
      }
      const base = fCoast * fSlope * Math.max(fScour, fore * 0.9) * fVil * fLake * fSite * fView * Math.max(fClear, fore * 0.85) * fStand;
      const spruce = base * fSpruce * Math.max(0.55 + 0.45 * smooth(-0.2, 0.5, shel + cav * 0.08), fore);
      const birch = base * fBirch * (1 - fSpruce * 0.6);
      const tree = Math.min(0.95, Math.max(spruce, birch * 0.7));

      // birch share: margins, the treeline, riparian strips, the coast; spruce in sheltered hollows
      let birchShare = 0.5;
      if (tree > 0.02) {
        const nS = fbm(nSpecies, x / 160, z / 160, 2);
        const high = smooth(110, 220, h - line);
        const coastal = 1 - smooth(25, 140, cd);
        const lakeside = 1 - smooth(15, 70, ls);
        const wB = (0.25 + 1.4 * high + 0.8 * coastal + 0.9 * lakeside + 0.5 * smooth(0.4, 0.8, slope)) * (0.6 + 0.8 * smooth(-0.35, 0.35, nS));
        const wS = (1.2 * fSpruce + 0.6 * smooth(0, 0.6, shel) + 0.4 * smooth(1, 5, cav)) * (0.6 + 0.8 * smooth(-0.35, 0.35, -nS));
        birchShare = wB / Math.max(1e-3, wB + wS);
        // the foreland is mountain-birch country with dark spruce clumps in its hollows
        const fB = 0.25 + 0.7 * smooth(-0.3, 0.15, fbm(nSpecies, x / 140 + 3.7, z / 140 - 1.9, 2) - 0.25 * smooth(0.5, 3, cav));
        birchShare += (fB - birchShare) * fore;
      }

      // dwarf scrub poking out above the treeline and in the clearings, never on the lake or steep rock
      const above = smooth(150, 230, h - line) * (1 - smooth(380, 470, h)) * fLake * fCoast * (1 - smooth(0.7, 1.1, slope));
      const clearing = (1 - fClear) * fSpruce * fLake;
      const patch = 0.5 + 0.7 * smooth(-0.3, 0.4, fbm(nPatch, x / 70, z / 70, 2));
      const open = Math.min(0.95, Math.max(above * 0.6 * smooth(-0.6, 0.2, -shel), clearing * 0.45) * patch);

      data[o] = Math.round(tree * 255);
      data[o + 1] = Math.round((1 - tree) * open * 255);
      data[o + 2] = Math.round(fClear * 255);
      data[o + 3] = Math.round(birchShare * 255);
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, info: new THREE.Vector4(X0, Z0, 1 / (nx * CELL), 1 / (nz * CELL)) };
}
