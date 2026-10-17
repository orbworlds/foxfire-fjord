/**
 * Snow on everything that is not the ground: one GLSL chunk for coverage,
 * albedo, sparkle and shelter, shared by every material that wants snow, and
 * a one-time sweep (`SnowSystem.sweep`, via `materials.snowify(root)`) that
 * patches the standard materials of the loaded features.
 *
 * Coverage comes from the world-space geometric normal (flat tops hold the
 * most, steep faces none), a breakup noise, the storm wind (snow plastered on
 * the windward faces) and the per-material amount. Snow is the same albedo
 * the terrain draws (`tSnowColorAt` in terrain/shaders.ts uses the same noise
 * and palette), blue where only the sky lights it, glinting in the sun and the
 * moon, and washed green by the aurora.
 *
 * A top-down shelter map (heights of everything that can hold snow, baked once
 * after the features load) stops the snow under eaves, porches and roofs.
 *
 * Opting out: `object.userData.snow = 0` (inherited by children) or
 * `material.userData.snow = 0`. Amounts: 0 none, 0.5 a dusting, 1 settled
 * snow (default), up to 2 deep and drifting.
 *
 * Custom ShaderMaterials can use the chunk: put `SNOW_GLSL` in the fragment
 * shader, `Object.assign(uniforms, materials.snow.uniforms)` after any
 * UniformsUtils.merge, and call `snowCoverage(worldPos, worldNormal, amount)`,
 * `snowAlbedo(worldPos.xz)` and `snowGlint(...)`.
 */
import * as THREE from 'three';
import { shared } from './shared';
import { SNOW_WIND, HOUSE, VILLAGE, SAUNA, SPRING, ICE_HUT } from '../world/layout';

/** sRGB hex → linear GLSL vec3 literal */
function lin(hex: string): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/** maximum number of shelter-map regions */
export const SNOW_REGIONS = 6;

/**
 * The snow chunk (fragment side). Declares its own uniforms; bind
 * `SnowSystem.uniforms` (by reference) into the material.
 */
export const SNOW_GLSL = /* glsl */ `
#ifndef FOX_SNOW
#define FOX_SNOW
#define SSAT(x) clamp(x, 0.0, 1.0)
uniform sampler2D uSnowNoise;
uniform float uSnowCover;
uniform float uSnowSparkle;
uniform vec3 uAuroraFill;
uniform sampler2D uSnowShelter;
uniform vec4 uSnowRect[${SNOW_REGIONS}];
uniform vec4 uSnowAtlas[${SNOW_REGIONS}];
uniform int uSnowRegionCount;
const vec2 S_WIND = vec2(${SNOW_WIND.x.toFixed(4)}, ${SNOW_WIND.z.toFixed(4)});
const vec3 S_SNOW = ${lin('#f3f6fa')};
const vec3 S_SNOW_OLD = ${lin('#e3e6ea')};
const vec3 S_SNOW_BLUE = ${lin('#c4d7ec')};
const mat2 S_R1 = mat2(0.8253, 0.5646, -0.5646, 0.8253);

// snow albedo, the same as the terrain's open snow at that spot
vec3 snowAlbedo(vec2 xz) {
  vec2 q = vec2(dot(xz, S_WIND), dot(xz, vec2(-S_WIND.y, S_WIND.x)));
  float nA = texture(uSnowNoise, xz * (1.0 / 2600.0) + vec2(0.37, 0.71)).r;
  float nB = texture(uSnowNoise, S_R1 * xz * (1.0 / 640.0) + vec2(0.13, 0.52)).g;
  float nW = texture(uSnowNoise, vec2(q.x / 260.0, q.y / 48.0) + 0.17).g;
  vec3 s = mix(S_SNOW, S_SNOW_OLD, SSAT((nA - 0.5) * 2.5 + (nB - 0.5) * 1.5 + 0.3));
  return s * (0.97 + 0.05 * nW);
}

// 0 in the open … 1 under a roof (from the baked top-down height map)
float snowShelter(vec3 wp) {
  for (int i = 0; i < ${SNOW_REGIONS}; i++) {
    if (i >= uSnowRegionCount) break;
    vec4 r = uSnowRect[i];
    vec2 uv = (wp.xz - r.xy) * r.z;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      vec4 a = uSnowAtlas[i];
      float h = texture(uSnowShelter, a.xy + uv * a.zw).r + r.w;
      return smoothstep(0.06, 0.45, h - wp.y);
    }
  }
  return 0.0;
}

// settled snow on an object's surface: 0..1
float snowCoverage(vec3 wp, vec3 Nw, float amount) {
  if (amount <= 0.0 || uSnowCover <= 0.0) return 0.0;
  float up = Nw.y;
  float a = min(amount, 2.0);
  float nA = texture(uSnowNoise, wp.xz * (1.0 / 3.7) + 0.31).g;
  float nB = texture(uSnowNoise, wp.xz * 0.61 + wp.y * 0.23 + 0.17).b;
  float brk = nA * 0.6 + nB * 0.4 - 0.5;
  // flat tops hold it all, gentle slopes a broken crust, steep faces nothing
  float c = smoothstep(0.5, 0.78, up + brk * 0.6 + (a - 1.0) * 0.3);
  // plastered on the faces turned into the storm wind: fine feathered streaks along the wind
  float windward = SSAT(dot(Nw.xz, -S_WIND) * 1.4 - 0.35) * (1.0 - abs(up));
  if (windward > 0.0) {
    vec2 pw = vec2(dot(wp.xz, vec2(-Nw.z, Nw.x)), wp.y);
    float nP = texture(uSnowNoise, pw * vec2(0.35, 1.3) + 0.53).b * 0.55 + texture(uSnowNoise, pw * vec2(1.2, 4.5) + 0.11).a * 0.45;
    c = max(c, windward * smoothstep(0.66, 0.78, nP) * 0.32);
  }
  c *= SSAT(a) * uSnowCover;
  if (c > 0.0) c *= 1.0 - snowShelter(wp);
  return c;
}

float snowHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 snowHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float snowGlintCell(vec3 P, float scale, vec3 Nw, vec3 Hw, float density, float sharp) {
  vec3 q = P * scale;
  vec3 c = floor(q);
  vec3 r = snowHash3(c);
  if (r.x > density) return 0.0;
  vec3 fn = normalize(Nw + (snowHash3(c + 17.0) - 0.5) * 1.3);
  vec3 f = fract(q) - 0.25 - 0.5 * r.yzx;
  float flake = 1.0 - smoothstep(0.06, 0.2, length(f));
  float spec = SSAT((dot(fn, Hw) - sharp) / (1.0 - sharp));
  return flake * spec * spec;
}
// sparkle: hashed ice facets that flash when they mirror the light (world space, stays put on the surface)
float snowGlint(vec3 wp, vec3 Nw, vec3 Vw, vec3 Lw, float dist) {
  if (uSnowSparkle <= 0.0) return 0.0;
  vec3 Hw = normalize(Lw + Vw);
  float g = 0.0;
  float n1 = 1.0 - smoothstep(9.0, 26.0, dist);
  float n2 = (1.0 - smoothstep(40.0, 130.0, dist)) * smoothstep(6.0, 16.0, dist);
  if (n1 > 0.0) g += snowGlintCell(wp, 40.0, Nw, Hw, 0.07, 0.975) * n1;
  if (n2 > 0.0) g += snowGlintCell(wp, 8.0, Nw, Hw, 0.05, 0.985) * n2 * 0.7;
  return g * 40.0 * uSnowSparkle;
}
#endif
`;

/** Per-material snow settings: x amount, y full cover (snow objects), z unused. */
type MatUniform = { value: THREE.Vector3 };

/**
 * Patch text spliced into MeshStandard/Physical fragment shaders. Fragment only:
 * the world position is recovered from vViewPosition, so instancing, batching
 * and vertex displacement by other patches are all respected.
 */
const PATCH_COMMON = /* glsl */ `
${SNOW_GLSL}
uniform vec3 uSnowMat;
float sCov = 0.0;
vec3 sWorld = vec3(0.0);
vec3 sNw = vec3(0.0, 1.0, 0.0);
`;

const PATCH_SURFACE = /* glsl */ `
#include <emissivemap_fragment>
sWorld = ((-vViewPosition) - viewMatrix[3].xyz) * mat3(viewMatrix);
sNw = transformDirectionByInverseViewMatrix(nonPerturbedNormal, viewMatrix);
sCov = uSnowMat.y > 0.5 ? uSnowCover : snowCoverage(sWorld, sNw, uSnowMat.x);
if (sCov > 0.0) {
  vec3 sAlb = snowAlbedo(sWorld.xz);
  // a soft lip of brighter, wind-packed snow where the cover thins out
  sAlb *= 1.0 + 0.04 * SSAT(1.0 - abs(sCov - 0.5) * 2.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, sAlb, sCov);
  roughnessFactor = mix(roughnessFactor, 0.8, sCov);
  metalnessFactor = mix(metalnessFactor, 0.0, sCov);
  // bury the board grain and the stone bump under the snow, keep a faint crust
  float sGrain = texture(uSnowNoise, sWorld.xz * 2.7 + sWorld.y * 0.9).a - 0.5;
  normal = normalize(mix(normal, nonPerturbedNormal + vec3(sGrain * 0.06), sCov));
  totalEmissiveRadiance *= 1.0 - sCov;
}
`;

const PATCH_DIRECT = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
if (sCov > 0.0) {
  // light scattered through the snowpack softens the terminator, slightly blue; sparkle in the key light
  float sNdl = dot(geometryNormal, directLight.direction);
  float sWrap = max(0.0, (sNdl + 0.4) / 1.4) - max(0.0, sNdl);
  reflectedLight.directDiffuse += directLight.color * material.diffuseContribution * vec3(0.86, 0.95, 1.08) * sWrap * 0.3 * sCov;
  if (sNdl > 0.0) {
    vec3 sLw = transformDirectionByInverseViewMatrix(directLight.direction, viewMatrix);
    vec3 sVw = normalize(cameraPosition - sWorld);
    float sG = snowGlint(sWorld, sNw, sVw, sLw, length(cameraPosition - sWorld));
    reflectedLight.directSpecular += directLight.color * sG * sCov * SSAT(sNdl * 4.0);
  }
}
#endif
#include <lights_fragment_maps>
`;

const PATCH_INDIRECT = /* glsl */ `
#include <lights_fragment_end>
// sky-lit snow is blue; every exterior surface takes the aurora's light between environment refreshes
reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.84, 0.94, 1.14), sCov * 0.55);
reflectedLight.indirectDiffuse += material.diffuseContribution * uAuroraFill * (0.5 + 0.5 * sNw.y) * RECIPROCAL_PI;
`;

const PATCH_CLEARCOAT = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - sCov;
#endif
`;

/** A rectangle of the world baked into the shelter map. */
export interface ShelterRegion {
  minX: number;
  minZ: number;
  /** side length (regions are square) */
  size: number;
  /** reference height: shelter heights are stored relative to it (half-float precision) */
  baseY: number;
}

function square(cx: number, cz: number, half: number, baseY: number): ShelterRegion {
  return { minX: cx - half, minZ: cz - half, size: half * 2, baseY };
}

/** Where buildings stand: the cabin yard, Lysvik, the lake sauna, the ice hut and the hot spring. */
export function defaultShelterRegions(): ShelterRegion[] {
  return [
    square(HOUSE.x - 3, HOUSE.z - 2, 30, HOUSE.groundY),
    square(VILLAGE.center.x, VILLAGE.center.z - 30, VILLAGE.radius + 40, 10),
    square(SAUNA.x - 2, SAUNA.z, 20, SAUNA.y),
    square(SPRING.x + 3, SPRING.z + 2, 18, SPRING.y),
    square(ICE_HUT.x, ICE_HUT.z, 9, ICE_HUT.y),
  ];
}

/** Features whose objects get no snow sweep by default (they draw their own snow, or none). */
const DEFAULT_SKIP = new Set(['terrain', 'ocean', 'grass', 'flora']);

const SHELTER_VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <skinning_pars_vertex>
varying float vY;
void main() {
  #include <batching_vertex>
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vY = ((mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix)).y;
}
`;
const SHELTER_FRAG = /* glsl */ `
uniform float uBaseY;
varying float vY;
void main() { gl_FragColor = vec4(vY - uBaseY, 0.0, 0.0, 1.0); }
`;

export class SnowSystem {
  /** bind these (by reference) into any material that uses SNOW_GLSL */
  readonly uniforms: {
    uSnowNoise: { value: THREE.Texture };
    uSnowCover: { value: number };
    uSnowSparkle: { value: number };
    uAuroraFill: { value: THREE.Color };
    uSnowShelter: { value: THREE.Texture };
    uSnowRect: { value: THREE.Vector4[] };
    uSnowAtlas: { value: THREE.Vector4[] };
    uSnowRegionCount: { value: number };
  };
  private patched = new WeakMap<THREE.Material, MatUniform>();
  /** each patched material's own patch from before the snow (clones per amount restart from it) */
  private pre = new WeakMap<THREE.Material, { fn: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>();
  /** materials that must never be snowed (interior variants) */
  private excluded = new WeakSet<THREE.Material>();
  private clones = new Map<string, THREE.Material>();
  private shelterTarget: THREE.WebGLRenderTarget | null = null;
  private blank: THREE.DataTexture;

  constructor(noise: THREE.Texture, sparkle: boolean) {
    this.blank = new THREE.DataTexture(new Float32Array([-1000, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.blank.needsUpdate = true;
    this.uniforms = {
      uSnowNoise: { value: noise },
      uSnowCover: shared.uSnowCover,
      uSnowSparkle: { value: sparkle ? 1 : 0 },
      uAuroraFill: shared.uAuroraFill,
      uSnowShelter: { value: this.blank },
      uSnowRect: { value: Array.from({ length: SNOW_REGIONS }, () => new THREE.Vector4()) },
      uSnowAtlas: { value: Array.from({ length: SNOW_REGIONS }, () => new THREE.Vector4()) },
      uSnowRegionCount: { value: 0 },
    };
  }

  setSparkle(on: boolean): void {
    this.uniforms.uSnowSparkle.value = on ? 1 : 0;
  }

  /** Never snow this material (interior variants register here). */
  exclude(mat: THREE.Material): void {
    this.excluded.add(mat);
  }

  /** The material's own snow uniform once patched (amount in x). */
  amountOf(mat: THREE.Material): number | undefined {
    return this.patched.get(mat)?.value.x;
  }

  /**
   * Patch one standard material (chained after any existing onBeforeCompile).
   * `full` makes it snow everywhere (snow drifts, caps, snowballs).
   */
  patch(mat: THREE.MeshStandardMaterial, amount = 1, full = false): void {
    const have = this.patched.get(mat);
    if (have) {
      have.value.set(amount, full ? 1 : 0, 0);
      return;
    }
    const u: MatUniform = { value: new THREE.Vector3(amount, full ? 1 : 0, 0) };
    this.patched.set(mat, u);
    const prev = mat.onBeforeCompile;
    const ownKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
    const prevKey = mat.customProgramCacheKey;
    const prevSrc = prev.toString();
    this.pre.set(mat, { fn: prev, key: prevKey });
    const su = this.uniforms;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      if (shader.fragmentShader.includes('uSnowMat')) return;
      const fs = shader.fragmentShader;
      if (!fs.includes('#include <emissivemap_fragment>') || !fs.includes('#include <lights_fragment_end>')) {
        console.warn(`[snow] cannot patch ${mat.name || mat.type}: anchors missing`);
        return;
      }
      Object.assign(shader.uniforms, su);
      shader.uniforms.uSnowMat = u;
      shader.fragmentShader = fs
        .replace('#include <common>', `#include <common>\n${PATCH_COMMON}`)
        .replace('#include <emissivemap_fragment>', PATCH_SURFACE)
        .replace('#include <lights_physical_fragment>', PATCH_CLEARCOAT)
        .replace('#include <lights_fragment_maps>', PATCH_DIRECT)
        .replace('#include <lights_fragment_end>', PATCH_INDIRECT);
    };
    mat.customProgramCacheKey = () => `${ownKey ? prevKey.call(mat) : prevSrc}|fox-snow`;
    mat.needsUpdate = true;
  }

  /**
   * One-time sweep: patch every standard material under `root`. The amount is
   * `userData.snow` of the nearest ancestor (or the object itself), else
   * `material.userData.snow`, else `amount`. A material met with several
   * amounts is cloned per amount (the clone keeps its patches).
   */
  sweep(root: THREE.Object3D, amount = 1): number {
    let count = 0;
    const visit = (o: THREE.Object3D, inherited: number) => {
      const own = o.userData.snow;
      const a = typeof own === 'number' ? own : inherited;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(o as unknown as THREE.Points).isPoints && !(o as unknown as THREE.Line).isLine) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => this.apply(m, a, () => count++));
        } else if (mesh.material) {
          mesh.material = this.apply(mesh.material, a, () => count++);
        }
      }
      for (const c of o.children) visit(c, a);
    };
    visit(root, typeof root.userData.snow === 'number' ? root.userData.snow : amount);
    return count;
  }

  private apply(mat: THREE.Material, amount: number, onPatch: () => void): THREE.Material {
    const std = mat as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial || this.excluded.has(mat)) return mat;
    const a = typeof mat.userData.snow === 'number' ? mat.userData.snow : amount;
    if (a <= 0) return mat;
    if (mat.transparent && typeof mat.userData.snow !== 'number') return mat;
    const have = this.patched.get(mat);
    if (!have) {
      this.patch(std, a);
      onPatch();
      return mat;
    }
    if (Math.abs(have.value.x - a) < 1e-3 || have.value.y > 0.5) return mat;
    // same material, another amount: one clone per (material, amount)
    const key = `${mat.uuid}:${a.toFixed(2)}`;
    let c = this.clones.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!c) {
      c = std.clone();
      c.userData = { ...std.userData };
      const pre = this.pre.get(mat);
      if (pre) {
        c.onBeforeCompile = pre.fn;
        c.customProgramCacheKey = pre.key;
      }
      this.clones.set(key, c);
      this.patch(c, a);
      onPatch();
    }
    return c;
  }

  /**
   * Bake the shelter map: a top-down height render of everything under
   * `roots` (except particles, transparent effects and objects marked
   * `userData.shelter = false`) into an atlas of square regions.
   */
  bakeShelter(renderer: THREE.WebGLRenderer, scene: THREE.Scene, roots: THREE.Object3D[], regions = defaultShelterRegions(), tile = 1024): void {
    regions = regions.slice(0, SNOW_REGIONS);
    const cols = Math.min(3, regions.length);
    const rows = Math.ceil(regions.length / cols);
    const W = cols * tile;
    const H = rows * tile;
    if (!this.shelterTarget || this.shelterTarget.width !== W || this.shelterTarget.height !== H) {
      this.shelterTarget?.dispose();
      this.shelterTarget = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.HalfFloatType,
        format: THREE.RedFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        generateMipmaps: false,
      });
      this.shelterTarget.texture.name = 'fox-snow-shelter';
    }
    const baseU = { value: 0 };
    const mat = new THREE.ShaderMaterial({ name: 'fox-snow-shelter', vertexShader: SHELTER_VERT, fragmentShader: SHELTER_FRAG, uniforms: { uBaseY: baseU }, side: THREE.DoubleSide });

    // which objects shelter: meshes under the roots, minus effects
    const include = new Set<THREE.Object3D>();
    const walk = (o: THREE.Object3D, off: boolean) => {
      const no = off || o.userData.shelter === false;
      const m = o as THREE.Mesh;
      if (!no && m.isMesh && !(o as unknown as THREE.Points).isPoints && !(o as unknown as THREE.Line).isLine && !(o as unknown as THREE.Sprite).isSprite) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const ok = mats.some((x) => x && x.visible !== false && (!x.transparent || x.name === 'fresnelGlass' || x.name === 'frostedGlass') && (x.depthWrite || x.name === 'fresnelGlass'));
        if (ok) include.add(o);
      }
      for (const c of o.children) walk(c, no);
    };
    for (const r of roots) walk(r, false);

    // hide everything else for the bake
    const hidden: THREE.Object3D[] = [];
    const shown: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as unknown as THREE.Points).isPoints || (o as unknown as THREE.Line).isLine || (o as unknown as THREE.Sprite).isSprite)) return;
      if (include.has(o)) {
        if (!o.visible) {
          shown.push(o);
          o.visible = true;
        }
      } else if (o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    // ancestors of included objects must be visible too
    const shownParents: THREE.Object3D[] = [];
    for (const o of include) {
      let p = o.parent;
      while (p && p !== scene) {
        if (!p.visible) {
          p.visible = true;
          shownParents.push(p);
        }
        p = p.parent;
      }
    }

    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const target = this.shelterTarget;
    scene.overrideMaterial = mat;
    scene.background = null;
    scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    target.viewport.set(0, 0, W, H);
    target.scissor.set(0, 0, W, H);
    target.scissorTest = false;
    renderer.setRenderTarget(target);
    // "nothing above": far below any surface
    renderer.setClearColor(new THREE.Color(-1000, 0, 0), 1);
    renderer.clear(true, true, false);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    const rect = this.uniforms.uSnowRect.value;
    const atlas = this.uniforms.uSnowAtlas.value;
    regions.forEach((r, i) => {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      const half = r.size / 2;
      // looking straight down with screen up = world +z and the x axis mirrored, so texture u grows
      // with world x and v with world z (the shader samples (xz - min) / size)
      cam.left = half;
      cam.right = -half;
      cam.top = half;
      cam.bottom = -half;
      cam.position.set(r.minX + half, 2000, r.minZ + half);
      cam.up.set(0, 0, 1);
      cam.lookAt(r.minX + half, 0, r.minZ + half);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      baseU.value = r.baseY;
      target.viewport.set(cx * tile, cy * tile, tile, tile);
      target.scissor.set(cx * tile, cy * tile, tile, tile);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      rect[i].set(r.minX, r.minZ, 1 / r.size, r.baseY);
      atlas[i].set(cx / cols, cy / rows, 1 / cols, 1 / rows);
    });
    target.viewport.set(0, 0, W, H);
    target.scissor.set(0, 0, W, H);
    target.scissorTest = false;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    scene.fog = prevFog;
    for (const o of hidden) o.visible = true;
    for (const o of shown) o.visible = false;
    for (const o of shownParents) o.visible = false;
    mat.dispose();
    this.uniforms.uSnowShelter.value = target.texture;
    this.uniforms.uSnowRegionCount.value = regions.length;
  }

  /**
   * Sweep the loaded features (skipping terrain, ocean, grass and flora unless
   * their root sets `userData.snow`) and bake the shelter map. Call once after
   * the features load, before the shaders are precompiled.
   */
  snowifyFeatures(renderer: THREE.WebGLRenderer, scene: THREE.Scene, features: Map<string, { object: THREE.Object3D }>, tile = 1024): number {
    let n = 0;
    const roots: THREE.Object3D[] = [];
    for (const [id, f] of features) {
      const skip = DEFAULT_SKIP.has(id) && typeof f.object.userData.snow !== 'number';
      if (!skip) {
        n += this.sweep(f.object, 1);
        roots.push(f.object);
      }
    }
    try {
      this.bakeShelter(renderer, scene, roots, defaultShelterRegions(), tile);
    } catch (err) {
      console.warn('[snow] shelter bake failed', err);
    }
    return n;
  }
}

/** The snow uniforms a custom ShaderMaterial needs (alias of `SnowSystem.uniforms`). */
export type SnowUniforms = SnowSystem['uniforms'];
