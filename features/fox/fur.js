/**
 * The fox's winter fur: the skinned body drawn once as an opaque undercoat,
 * then again as a stack of shells pushed out along the (skinned) normals and
 * combed back toward the tail and down. Each shell keeps only the strands
 * taller than its height (a fine 3D strand pattern fixed to the body's rest
 * shape, so it moves with the fox), darker toward the roots, so the edges go
 * soft and fluffy and the light catches the tips. Standard materials, so the
 * moon, the sky, the aurora and the snow's glow all light it.
 */
import * as THREE from 'three';
const TERRAIN_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uFurShadowH;
uniform vec4 uFurWorld;
uniform vec3 uFurLightDir;
varying float vFurSun;
float furTerrainShadow(vec3 P) {
  vec3 L = uFurLightDir;
  if (L.y <= 0.0 || L.y > 0.78) return 1.0;
  float sh = 1.0;
  float t = 3.0;
  for (int i = 0; i < 18; i++) {
    vec3 q = P + L * t;
    if (q.y > 1000.0) break;
    float hq = textureLod(uFurShadowH, (q.xz - uFurWorld.xy) * uFurWorld.zw, 0.0).r;
    sh = min(sh, clamp((q.y + 1.0 - hq) / (0.06 * t + 0.5), 0.0, 1.0));
    t *= 1.45;
  }
  return mix(1.0, sh, clamp((0.78 - L.y) * 8.0, 0.0, 1.0));
}
`;
/** The directional-light loop with the terrain shadow spliced in (as the terrain does). */
function shadowedLightLoop() {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const key = 'getDirectionalLightInfo( directionalLight, directLight );';
    const i0 = chunk.indexOf(key);
    if (i0 < 0)
        return chunk;
    return chunk.slice(0, i0) + `${key}\n\t\tdirectLight.color *= furSun;` + chunk.slice(i0 + key.length);
}
/** The base geometry repeated `n` times with aShell = (i + 1) / n, in drawing order (inner first). */
export function shellGeometry(base, n) {
    const g = new THREE.BufferGeometry();
    const nv = base.getAttribute('position').count;
    const index = base.index.array;
    for (const name of Object.keys(base.attributes)) {
        const src = base.getAttribute(name);
        const Arr = src.array.constructor;
        const arr = new Arr(src.array.length * n);
        for (let i = 0; i < n; i++)
            arr.set(src.array, i * src.array.length);
        g.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }
    const shell = new Float32Array(nv * n);
    for (let i = 0; i < n; i++)
        shell.fill((i + 1) / n, i * nv, (i + 1) * nv);
    g.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
    const idx = new Uint32Array(index.length * n);
    for (let i = 0; i < n; i++)
        for (let k = 0; k < index.length; k++)
            idx[i * index.length + k] = index[k] + i * nv;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = base.boundingSphere?.clone() ?? null;
    return g;
}
const STRAND_GLSL = /* glsl */ `
uniform sampler2D uFurNoise;
varying vec3 vRest;
varying vec3 vRestN;
varying float vShell;
varying float vFur;
// strand height 0..1 at a point on the body (rest space), triplanar
float furStrand(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float s = 11.0;
  float a = texture2D(uFurNoise, p.zy * s).a * w.x + texture2D(uFurNoise, p.xz * s + 0.37).a * w.y + texture2D(uFurNoise, p.xy * s + 0.71).a * w.z;
  // locks: strands clump into tufts
  float c = texture2D(uFurNoise, p.zy * 2.6).b * w.x + texture2D(uFurNoise, p.xz * 2.6 + 0.37).b * w.y + texture2D(uFurNoise, p.xy * 2.6 + 0.71).b * w.z;
  return clamp(a * 0.75 + c * 0.45 - 0.08, 0.0, 1.0);
}
`;
function patch(mat, noise, comb, length, shell, ts) {
    const uniforms = { uFurNoise: { value: noise }, uFurComb: { value: comb }, uFurLen: length };
    if (ts) {
        uniforms.uFurShadowH = { value: ts.heightTex };
        uniforms.uFurWorld = { value: ts.worldInfo };
        uniforms.uFurLightDir = ts.lightDir;
    }
    mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, uniforms);
        if (ts) {
            // per vertex: the terrain's shadow is broad and soft, and the shells would multiply a per-pixel march
            s.vertexShader = s.vertexShader
                .replace('#include <common>', `#include <common>\n${TERRAIN_SHADOW_GLSL}`)
                .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFurSun = furTerrainShadow((modelMatrix * vec4(transformed, 1.0)).xyz);');
            s.fragmentShader = s.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vFurSun;')
                .replace('#include <lights_fragment_begin>', `float furSun = vFurSun;\n${shadowedLightLoop()}`);
        }
        s.vertexShader = s.vertexShader
            .replace('#include <common>', `#include <common>
attribute float aFur;
${shell ? 'attribute float aShell;' : ''}
uniform vec3 uFurComb;
uniform float uFurLen;
varying vec3 vRest;
varying vec3 vRestN;
varying float vShell;
varying float vFur;`)
            .replace('#include <skinning_vertex>', `#include <skinning_vertex>
vRest = position;
vRestN = normal;
vFur = aFur * uFurLen;
${shell
            ? `vShell = aShell;
{
  float h = aShell;
  float L = aFur * uFurLen;
  vec3 n = normalize(objectNormal);
  #ifdef USE_SKINNING
    vec3 comb = (skinMatrix * vec4(uFurComb, 0.0)).xyz;
  #else
    vec3 comb = uFurComb;
  #endif
  // the fur stands off the skin and lies back toward the tail, more at the tips
  transformed += n * (L * h) + comb * (L * h * h * 0.9);
}`
            : 'vShell = 0.0;'}`);
        s.fragmentShader = s.fragmentShader
            .replace('#include <common>', `#include <common>\n${STRAND_GLSL}\nfloat furH = 0.0;`)
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  // fur is translucent at its tips: the moon or the low sun behind the animal lights up its outline
  vec3 fV = normalize(vViewPosition);
  vec3 fL = directionalLights[0].direction;
  float back = pow(saturate(dot(-fV, fL)), 3.0);
  float rim = pow(1.0 - saturate(abs(dot(normal, fV))), 1.5);
  // and wraps light round into the side turned away (soft, deep coat)
  float wrap = saturate((dot(normal, fL) + 0.45) / 1.45) - saturate(dot(normal, fL));
  reflectedLight.indirectDiffuse += directionalLights[0].color * FUR_SUN * diffuseColor.rgb * (back * rim * (0.35 + 0.9 * furH) * 0.9 + wrap * 0.35) * RECIPROCAL_PI * 3.0;
}
#endif`)
            .replace('FUR_SUN', ts ? 'furSun' : '1.0')
            .replace('#include <color_fragment>', `#include <color_fragment>
{
  float strand = furStrand(vRest, normalize(vRestN));
  ${shell
            ? `// keep the strands that reach this shell; soft at their tips
  float a = smoothstep(vShell - 0.02, vShell + 0.16, strand);
  a *= 1.0 - smoothstep(0.75, 1.0, vShell) * 0.5;
  a *= step(0.004, vFur);
  if (a < 0.03) discard;
  diffuseAlpha = a;`
            : ''}
  // the undercoat in the roots is shaded; tips catch the light
  float h = ${shell ? 'vShell' : '0.0'};
  diffuseColor.rgb *= mix(0.84, 1.05, h) * (0.94 + 0.08 * strand);
  furH = h;
}`);
        if (shell) {
            s.fragmentShader = s.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity );\nfloat diffuseAlpha = 1.0;').replace('#include <alphatest_fragment>', `diffuseColor.a *= diffuseAlpha;
#include <alphatest_fragment>`);
        }
    };
    mat.customProgramCacheKey = () => `fox-fur-${shell ? 'shell' : 'base'}-v4${ts ? '-ts' : ''}`;
}
export function furMaterials(noise, terrainShadow) {
    const length = { value: 1 };
    // combed back along the body and a little down
    const comb = new THREE.Vector3(0, -0.35, -1).normalize();
    const base = new THREE.MeshStandardMaterial({ name: 'foxFurBase', vertexColors: true, roughness: 0.92, metalness: 0 });
    patch(base, noise, comb, length, false, terrainShadow);
    const shell = new THREE.MeshStandardMaterial({
        name: 'foxFur',
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
        transparent: true,
        depthWrite: false,
    });
    patch(shell, noise, comb, length, true, terrainShadow);
    base.userData.snow = 0;
    shell.userData.snow = 0;
    return { base, shell, length };
}
