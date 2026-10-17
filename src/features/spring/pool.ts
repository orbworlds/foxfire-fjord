/**
 * The rock pool: an organic ring of dark gneiss boulders holding the hot
 * water a hand above the shelf. Rim rocks are wet and black at the water
 * line (glossy, so they catch the lantern light and the aurora), bare of
 * snow where the steam keeps them warm, and furred with white rime on the
 * faces the drifting steam reaches downwind; the outer boulders carry snow.
 * A few big boulders at the south-west end hide the source. The water is a
 * single fan polygon tucked under the rocks.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FeatureContext } from '../../core/types';
import { mulberry32 } from '../../world/noise';
import { heightAt } from '../../world/terrain-height';
import { boulderGeometry, flatStoneGeometry, noise3, paintVertices } from '../paths/kit/rocks';
import { ENTRY_PHI, GROUND_Y, POOL, SOURCE_PHI, TROUGH, VIEW_DIR, outlinePoint } from './layout';
import { createWaterMaterial, type SpringWater } from './water';

export interface RockInfo {
  x: number;
  z: number;
  r: number;
  top: number;
  /** angle on the outline (rim rocks only) */
  phi?: number;
}

export interface PoolBuild {
  /** rim rocks: wet, no snow, rime downwind */
  rim: THREE.Mesh;
  /** outer boulders: snowed */
  outer: THREE.Mesh;
  water: THREE.Mesh;
  waterMat: SpringWater;
  rockInfo: RockInfo[];
  /** flat entry stones (walkable): centre, radius, top height */
  entry: { x: number; z: number; r: number; top: number }[];
}

type Side = 'near' | 'far' | 'east' | 'west';

function sideOf(nx: number, nz: number): Side {
  const d = nx * VIEW_DIR.x + nz * VIEW_DIR.z;
  if (d > 0.45) return 'far';
  if (d < -0.5) return 'near';
  return nx * VIEW_DIR.z - nz * VIEW_DIR.x > 0 ? 'east' : 'west';
}

const angDist = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
};

/**
 * Dark gneiss with per-vertex wetness and rime (attribute aWR): wet rock goes
 * black and glossy; rime is a crust of white feathery crystals (fine noise,
 * sparkling a little), thickest on the faces that meet the steam.
 */
export function rockMaterial(ctx: FeatureContext, name: string): THREE.MeshStandardMaterial {
  const m = ctx.materials.get('granite').clone();
  m.name = name;
  m.vertexColors = true;
  m.roughness = 0.9;
  m.bumpScale = 0.9;
  const uniforms = { uNoise: { value: ctx.materials.noise } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWR;\nvarying vec2 vWR;\nvarying vec3 vRockW;\nvarying vec3 vRockN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWR = aWR;\nvRockW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
varying vec2 vWR;
varying vec3 vRockW;
varying vec3 vRockN;
float rRime = 0.0;
float rWet = 0.0;
float rHgt = 0.0;
// tilt the normal by the slope of a height (m) across the pixel
vec3 rockBump(vec3 surfPos, vec3 n, float h) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
{
  vec3 p = vRockW;
  vec3 an = abs(normalize(vRockN));
  // triplanar fine noise for the rime's crystals
  float nx = texture2D(uNoise, p.zy * 2.7).r;
  float ny = texture2D(uNoise, p.xz * 2.7 + 0.31).g;
  float nz = texture2D(uNoise, p.xy * 2.7 + 0.67).b;
  float fine = (nx * an.x + ny * an.y + nz * an.z) / (an.x + an.y + an.z);
  float coarse = texture2D(uNoise, p.xz * 0.6 + p.y * 0.3).a;
  rRime = smoothstep(0.28, 0.58, vWR.y * (0.55 + 0.9 * coarse) + (fine - 0.5) * 0.55);
  rWet = vWR.x;
  // cool the warm granite toward blue-grey gneiss
  diffuseColor.rgb *= vec3(0.86, 0.94, 1.08);
  // gneiss foliation: wavy pale and dark bands folded through the stone
  float fold = texture2D(uNoise, p.xz * 0.11 + p.y * 0.05).g;
  float band = sin(dot(p, vec3(0.7, 2.4, 0.5)) * 2.3 + fold * 7.0 + coarse * 3.5);
  float bandK = smoothstep(-0.3, 0.9, band) * smoothstep(0.25, 0.6, fold + 0.3 * coarse);
  diffuseColor.rgb *= mix(0.86, 1.1, bandK) * (0.9 + 0.2 * fine);
  // crusts of grey-green lichen on the dry, older stone
  float lich = smoothstep(0.62, 0.7, texture2D(uNoise, p.xz * 1.3 + p.y * 0.7 + 0.5).r * 0.7 + coarse * 0.45) * (1.0 - vWR.x) * (1.0 - smoothstep(0.1, 0.4, vWR.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.58, 0.5) * (0.85 + 0.3 * fine), lich * 0.7);
  rHgt = fine * 0.0025 + coarse * 0.008 + bandK * 0.0015 + lich * 0.0012;
  diffuseColor.rgb *= mix(1.0, 0.55, rWet);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95) * (0.82 + 0.3 * fine), rRime);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = rockBump(-vViewPosition, normal, rHgt * (1.0 - 0.6 * rRime));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// dry rock is matte: only the splashed band shines
roughnessFactor = max(roughnessFactor, 0.9);
roughnessFactor = mix(roughnessFactor, 0.22, rWet * (1.0 - rRime));
roughnessFactor = mix(roughnessFactor, 0.95, rRime);`,
      );
  };
  m.customProgramCacheKey = () => 'fox-springRock-v4';
  return m;
}

export function buildPool(ctx: FeatureContext, impact: THREE.Vector2): PoolBuild {
  const rnd = mulberry32(4242);
  const rimGeos: THREE.BufferGeometry[] = [];
  const outerGeos: THREE.BufferGeometry[] = [];
  const rockInfo: RockInfo[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const tone = new THREE.Color();
  // blue-grey to warm-grey gneiss, a few rusty with iron from the spring
  const tones = [
    new THREE.Color(0.5, 0.53, 0.58),
    new THREE.Color(0.42, 0.44, 0.48),
    new THREE.Color(0.52, 0.5, 0.5),
    new THREE.Color(0.46, 0.48, 0.52),
    new THREE.Color(0.37, 0.39, 0.43),
  ];
  const rust = new THREE.Color(0.55, 0.3, 0.14);
  const wind = ctx.shared.uWindDir.value;

  const addBoulder = (
    x: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    sink: number,
    seed: number,
    opts: { facets?: number; detail?: number; rim?: boolean; phi?: number } = {},
  ) => {
    const g = boulderGeometry(seed, {
      sx,
      sy,
      sz,
      detail: opts.detail ?? (Math.max(sx, sz) > 0.45 ? 3 : 2),
      lumps: 0.3,
      grain: 0.1,
      facets: opts.facets ?? 13,
      facetDepth: 1.0,
      flatBottom: 0.4,
      crease: 0.2,
    });
    const crack = g.userData.crease as Float32Array;
    const ground = Math.min(heightAt(x, z), GROUND_Y + 0.02);
    const y = ground + sy * sink;
    e.set((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m4);
    tone.copy(tones[Math.floor(rnd() * tones.length)]).multiplyScalar(0.85 + rnd() * 0.3);
    const t0 = tone.clone();
    const ns = rnd() * 40;
    const rim = opts.rim ?? false;
    // downwind of the pool the drifting steam freezes onto the rocks
    const dx = x - POOL.x;
    const dz = z - POOL.z;
    const dl = Math.hypot(dx, dz) || 1;
    const downwind = Math.max(0, (dx * wind.x + dz * wind.y) / dl);
    const rimeK = rim ? 0.55 + 0.45 * downwind : 0.25 + 0.5 * downwind;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const wr = new Float32Array(n.count * 2);
    paintVertices(g, (p, nn, c, i) => {
      c.copy(t0);
      const mott = noise3(p.x * 1.7 + ns, p.y * 1.7, p.z * 1.7);
      c.multiplyScalar((0.82 + 0.32 * mott) * (1 - 0.55 * crack[i]));
      const hw = p.y - POOL.water;
      // a thin rusty line of iron at the water line (the spring's minerals)
      if (rim) c.lerp(rust, Math.exp(-Math.pow((hw - 0.02) / 0.035, 2)) * (0.12 + 0.18 * Math.max(0, mott)));
      // wet: splashed at the water line, drier up top
      const wet = rim ? 1 - THREE.MathUtils.smoothstep(hw, 0.0, 0.07 + 0.06 * mott) : 0;
      // rime: faces turned to the pool (toward the steam) and the tops, above the wet band
      const tx = POOL.x - p.x;
      const tz = POOL.z - p.z;
      const tl = Math.hypot(tx, tz) || 1;
      const facing = Math.max(0, (nn.x * tx + nn.z * tz) / tl);
      const up = Math.max(0, nn.y);
      const dry = THREE.MathUtils.smoothstep(hw, 0.06, 0.2);
      const rime = Math.min(1, rimeK * dry * (0.5 * facing + 0.9 * up) * (rim ? 1.25 : 0.7));
      wr[i * 2] = wet;
      wr[i * 2 + 1] = rime;
    });
    g.setAttribute('aWR', new THREE.BufferAttribute(wr, 2));
    (rim ? rimGeos : outerGeos).push(g);
    rockInfo.push({ x, z, r: Math.max(sx, sz) * 0.88, top: y + sy, phi: opts.phi });
  };

  // --- main ring (gap at the step-in from the boardwalk) ---
  let phi = ENTRY_PHI + 0.32;
  const end = ENTRY_PHI + Math.PI * 2 - 0.32;
  let seed = 1;
  while (phi < end) {
    const p = outlinePoint(phi);
    const side = sideOf(p.nx, p.nz);
    let r: number;
    let hy: number;
    if (side === 'far') {
      // the fjord side: long low slabs, the water nearly brimming over them
      r = 0.42 + rnd() * 0.16;
      hy = 0.42 + rnd() * 0.12;
    } else if (side === 'near') {
      r = 0.4 + rnd() * 0.14;
      hy = 0.55 + rnd() * 0.12;
    } else {
      r = 0.52 + rnd() * 0.24;
      hy = 0.62 + rnd() * 0.18;
    }
    const pick = rnd();
    if (pick < 0.2) r *= 0.72;
    else if (pick > 0.84 && side !== 'far' && side !== 'near') {
      r *= 1.3;
      hy *= 1.08;
    }
    const nearSource = angDist(phi, SOURCE_PHI) < 0.35;
    if (nearSource) {
      r = Math.max(r, 0.6);
      hy = Math.max(hy, 0.7);
    }
    const sx = r * (0.95 + rnd() * 0.3);
    const sz = r * (0.8 + rnd() * 0.25) * (side === 'far' ? 0.85 : 1);
    const sy = r * hy;
    const c = outlinePoint(phi, r * 0.42);
    addBoulder(c.x, c.z, sx, sy, sz, 0.22 + rnd() * 0.16, seed++, { rim: true, phi });
    const p2 = outlinePoint(phi + 0.01);
    const dsdphi = Math.hypot(p2.x - p.x, p2.z - p.z) / 0.01;
    phi += (r * 1.3) / dsdphi;
  }

  // --- filler stones tucked behind the ring ---
  for (let i = 0; i < 18; i++) {
    const ph = ENTRY_PHI + 0.45 + (i / 18) * (Math.PI * 2 - 0.9) + (rnd() - 0.5) * 0.12;
    const c = outlinePoint(ph, 0.66 + rnd() * 0.3);
    const side = sideOf(c.nx, c.nz);
    const r = side === 'far' || side === 'near' ? 0.2 + rnd() * 0.1 : 0.26 + rnd() * 0.14;
    addBoulder(c.x, c.z, r * 1.1, r * 0.62, r * 0.9, 0.3, seed++, { detail: 2, rim: true });
  }

  // --- the source: big boulders at the south-west end, the trough between them ---
  addBoulder(TROUGH.rock.x, TROUGH.rock.z, 1.0, 0.82, 0.9, 0.32, seed++, { facets: 6 });
  const backdrop: [number, number, number, number, number][] = [
    // phi, grow, sx, sy, sz
    [SOURCE_PHI - 0.42, 1.3, 0.75, 0.62, 0.68],
    [SOURCE_PHI + 0.45, 1.25, 0.7, 0.55, 0.75],
    [SOURCE_PHI + 0.12, 2.5, 0.62, 0.5, 0.58],
    [SOURCE_PHI - 0.95, 1.4, 0.55, 0.4, 0.6],
    [ENTRY_PHI + 0.75, 1.35, 0.6, 0.42, 0.55],
    [ENTRY_PHI - 0.8, 1.3, 0.55, 0.38, 0.6],
  ];
  for (const [ph, grow, sx, sy, sz] of backdrop) {
    const c = outlinePoint(ph, grow);
    addBoulder(c.x, c.z, sx, sy, sz, 0.3, seed++, { facets: 6 });
  }

  // --- flat step-in stones between the boardwalk end and the water ---
  const entry: PoolBuild['entry'] = [];
  {
    const stone = (c: { x: number; z: number }, rx: number, rz: number, top: number, s: number, rotY: number) => {
      entry.push({ x: c.x, z: c.z, r: Math.min(rx, rz), top });
      const g = flatStoneGeometry(s, rx, 0.3, rz, 0.3);
      m4.compose(new THREE.Vector3(c.x, top - 0.3, c.z), q.setFromEuler(e.set(0, rotY, 0)), new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      paintVertices(g, (p, _n, col) => {
        col.setRGB(0.46, 0.48, 0.52).multiplyScalar(0.85 + 0.25 * noise3(p.x * 3, p.y * 3, p.z * 3));
      });
      const n = g.getAttribute('position').count;
      const wr = new Float32Array(n * 2);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) wr[i * 2] = 0.6 * (1 - THREE.MathUtils.smoothstep(pos.getY(i) - POOL.water, -0.02, 0.1));
      g.setAttribute('aWR', new THREE.BufferAttribute(wr, 2));
      rimGeos.push(g);
    };
    stone(outlinePoint(ENTRY_PHI, 0.25), 0.6, 0.45, POOL.water + 0.02, 91, 0.9);
    stone(outlinePoint(ENTRY_PHI, 0.95), 0.45, 0.36, GROUND_Y + 0.12, 92, -0.3);
    // a submerged seat step inside the rim
    stone(outlinePoint(ENTRY_PHI, -0.45), 0.5, 0.4, POOL.water - 0.32, 93, 0.4);
  }

  const merge = (geos: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)), false)!;
    geos.forEach((x) => x.dispose());
    g.computeBoundingSphere();
    return g;
  };
  const rimMat = rockMaterial(ctx, 'springRimRock');
  rimMat.userData.snow = 0;
  const outerMat = rockMaterial(ctx, 'springRock');
  const rim = new THREE.Mesh(merge(rimGeos), rimMat);
  rim.name = 'spring-rim';
  rim.castShadow = true;
  rim.receiveShadow = true;
  rim.userData.snow = 0;
  const outer = new THREE.Mesh(merge(outerGeos), outerMat);
  outer.name = 'spring-rocks';
  outer.castShadow = true;
  outer.receiveShadow = true;

  // --- water surface: rings + centre fan, tucked under the rocks ---
  const N = 120;
  const rings: [number, number][] = [
    [0.32, 0],
    [0.0, 0.18],
    [-0.5, 0.55],
    [-1.2, 0.9],
  ];
  const posArr: number[] = [];
  const edgeArr: number[] = [];
  posArr.push(POOL.x, POOL.water, POOL.z);
  edgeArr.push(1);
  for (const [grow, edge] of rings) {
    for (let i = 0; i < N; i++) {
      const p = outlinePoint((i / N) * Math.PI * 2, grow);
      posArr.push(p.x, POOL.water, p.z);
      edgeArr.push(edge);
    }
  }
  const idx: number[] = [];
  const ringStart = (k: number) => 1 + k * N;
  for (let k = 0; k < rings.length - 1; k++) {
    const a0 = ringStart(k);
    const b0 = ringStart(k + 1);
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      idx.push(a0 + i, b0 + i, a0 + i1);
      idx.push(a0 + i1, b0 + i, b0 + i1);
    }
  }
  const last = ringStart(rings.length - 1);
  for (let i = 0; i < N; i++) idx.push(0, last + ((i + 1) % N), last + i);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(edgeArr, 1));
  const nrm = new Float32Array(posArr.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  wg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  wg.setIndex(idx);
  // make sure the triangles face up
  wg.computeVertexNormals();
  if ((wg.getAttribute('normal') as THREE.BufferAttribute).getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    wg.setIndex(idx);
  }
  wg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  wg.computeBoundingSphere();
  const waterMat = createWaterMaterial(ctx, impact);
  const water = new THREE.Mesh(wg, waterMat.material);
  water.name = 'spring-water';
  water.receiveShadow = true;
  water.userData.snow = 0;
  return { rim, outer, water, waterMat, rockInfo, entry };
}
