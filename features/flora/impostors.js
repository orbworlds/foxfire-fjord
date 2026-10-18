/**
 * Far-forest impostors.
 *
 * At load every forest template is rendered (orthographic, no lighting) into
 * an albedo atlas and a view-space normal atlas: 4 elevation columns per
 * template (0° … 80°), two templates per atlas row. The albedo carries the
 * same snow the near trees show (bough tops facing the sky, caps, rime, the
 * upper side of branches), so a spruce wood reads as dark cones layered with
 * white from across the fjord. The billboard shader in material.ts picks /
 * dithers between columns and relights the baked normals, so the far forest
 * shades with the sun and the moon and keeps its volume at any time of day.
 *
 * Instances are split into a few spatial chunks (each its own InstancedMesh
 * with a real bounding sphere) so the colour and shadow passes skip chunks
 * outside their frusta. Within a chunk instances are sorted by their
 * quality key, so lowering the density is just a smaller `count`.
 */
import * as THREE from 'three';
import { IMP_COLUMNS, IMP_MAX_TEMPLATES, IMP_TOP_ELEVATION } from './material.js';
export function measureTemplate(geometry, maxDist) {
    const pos = geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    const cy = (Math.max(minY, -0.2) + maxY) * 0.5;
    let r2 = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i) - cy;
        const z = pos.getZ(i);
        const d = x * x + y * y + z * z;
        if (d > r2)
            r2 = d;
    }
    const index = geometry.getIndex();
    return {
        geometry,
        centerY: cy,
        radius: Math.sqrt(r2) * 1.01,
        triangles: (index ? index.count : pos.count) / 3,
        maxDist,
    };
}
/* ------------------------------------------------------------------ */
/* Bake                                                                */
/* ------------------------------------------------------------------ */
const BAKE_VERT = /* glsl */ `
attribute vec3 color;
attribute vec2 aSnow;
attribute float aHaze;
varying float vHaze;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vNo;
varying vec2 vSnow;
void main() {
  vUv = uv;
  vCol = color;
  vSnow = aSnow;
  vHaze = aHaze;
  vNo = normal;
  vN = normalize( normalMatrix * normal );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
const BAKE_FRAG = /* glsl */ `
// colour and normal are written premultiplied by the soft coverage (the billboard divides it back out)
uniform sampler2D map;
uniform sampler2D uFloraSnowTex;
uniform float uBarkV0;
uniform float uBarkVH;
uniform float uCoverage;
uniform int uMode;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vNo;
varying vec2 vSnow;
varying float vHaze;
void main() {
  vec2 fuv = vUv;
  vec2 fdx = dFdx( fuv );
  vec2 fdy = dFdy( fuv );
  float bark = 0.0;
  if ( fuv.y > 9.0 ) {
    bark = 1.0;
    fuv.y = uBarkV0 + fract( fuv.y ) * uBarkVH;
    fdx.y *= uBarkVH;
    fdy.y *= uBarkVH;
  }
  vec4 tex = textureGrad( map, fuv, fdx, fdy );
  vec2 ts = vec2( textureSize( map, 0 ) );
  float rho = max( dot( fdx * ts, fdx * ts ), dot( fdy * ts, fdy * ts ) );
  float lod = 0.5 * log2( max( rho, 1e-8 ) );
  // soft coverage (premultiplied below): the billboard dithers it, so bare twig crowns become a haze
  // (fine twigs keep their true, thin coverage: from afar a birch crown is a haze)
  float a = clamp( tex.a * ( 1.0 + max( lod, 0.0 ) * uCoverage * ( 1.0 - 0.6 * vHaze ) ), 0.0, 1.0 );
  if ( a < 0.12 ) discard;
  if ( uMode == 0 ) {
    // the same snow the near trees carry (material.ts SNOW_FRAGMENT)
    float snow;
    if ( bark > 0.5 ) {
      snow = smoothstep( 0.45, 0.8, normalize( vNo ).y ) * min( vSnow.x, 1.0 );
    } else {
      float face = vSnow.y > 0.5 ? 1.0 : ( gl_FrontFacing ? 1.0 : 0.0 );
      float pix = textureGrad( uFloraSnowTex, fuv, fdx, fdy ).r;
      float less = 1.0 - min( vSnow.x, 1.0 );
      float m = smoothstep( 0.1 + less * 0.5, 0.45 + less * 0.4, pix );
      snow = max( max( m * step( 0.02, vSnow.x ) * face, clamp( vSnow.x - 1.0, 0.0, 1.0 ) * ( 0.6 + 0.4 * m ) ), clamp( vSnow.x - 2.0, 0.0, 1.0 ) );
    }
    vec3 snowC = vec3( 0.86, 0.885, 0.92 ) * mix( 1.0, vCol.r, 0.45 );
    float aa = bark > 0.5 ? 1.0 : max( a, snow );
    gl_FragColor = vec4( mix( tex.rgb * vCol, snowC, snow ) * aa, aa );
  } else {
    float aa = bark > 0.5 ? 1.0 : a;
    gl_FragColor = vec4( ( normalize( vN ) * 0.5 + 0.5 ) * aa, aa );
  }
}
`;
/**
 * Render every template into the impostor atlases. Templates are drawn at
 * their own origin; column c looks down from elevation c · 80° / 3.
 */
export function bakeImpostors(renderer, templates, atlas, cellPx) {
    if (templates.length > IMP_MAX_TEMPLATES)
        throw new Error(`flora: too many impostor templates (${templates.length})`);
    const slotsX = 2;
    const cellsX = slotsX * IMP_COLUMNS;
    const cellsY = Math.ceil(templates.length / slotsX);
    const W = cellsX * cellPx;
    const H = cellsY * cellPx;
    const makeTarget = (srgb) => {
        const rt = new THREE.WebGLRenderTarget(W, H, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false,
            depthBuffer: true,
            stencilBuffer: false,
        });
        rt.texture.name = srgb ? 'flora-impostor-albedo' : 'flora-impostor-normal';
        return rt;
    };
    const albedoRT = makeTarget(true);
    const normalRT = makeTarget(false);
    const material = new THREE.ShaderMaterial({
        vertexShader: BAKE_VERT,
        fragmentShader: BAKE_FRAG,
        uniforms: {
            map: { value: atlas.texture },
            uFloraSnowTex: { value: atlas.snow },
            uBarkV0: { value: atlas.barkBand.v0 },
            uBarkVH: { value: atlas.barkBand.vh },
            uCoverage: { value: 0.3 },
            uMode: { value: 0 },
        },
        side: THREE.DoubleSide,
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(templates[0].geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    // save renderer state
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    const center = new THREE.Vector3();
    const F = new THREE.Vector3();
    for (const [mode, rt] of [
        [0, albedoRT],
        [1, normalRT],
    ]) {
        material.uniforms.uMode.value = mode;
        rt.scissorTest = false;
        rt.viewport.set(0, 0, W, H);
        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);
        rt.scissorTest = true;
        templates.forEach((t, ti) => {
            mesh.geometry = t.geometry;
            const r = t.radius;
            center.set(0, t.centerY, 0);
            cam.left = -r;
            cam.right = r;
            cam.top = r;
            cam.bottom = -r;
            cam.near = 0.5;
            cam.far = 4 * r + 2;
            cam.updateProjectionMatrix();
            const slotX = (ti % slotsX) * IMP_COLUMNS;
            const slotY = Math.floor(ti / slotsX);
            for (let c = 0; c < IMP_COLUMNS; c++) {
                const e = (c / (IMP_COLUMNS - 1)) * IMP_TOP_ELEVATION;
                F.set(0, Math.sin(e), Math.cos(e));
                cam.position.copy(center).addScaledVector(F, 2 * r + 1);
                cam.up.set(0, 1, 0);
                cam.lookAt(center);
                cam.updateMatrixWorld();
                const x = (slotX + c) * cellPx;
                const y = slotY * cellPx;
                rt.viewport.set(x, y, cellPx, cellPx);
                rt.scissor.set(x, y, cellPx, cellPx);
                renderer.setRenderTarget(rt);
                renderer.render(scene, cam);
            }
        });
        rt.scissorTest = false;
        rt.viewport.set(0, 0, W, H);
        rt.scissor.set(0, 0, W, H);
        // one mip build for the whole atlas (render() regenerates mips of the bound target)
        rt.texture.generateMipmaps = true;
        renderer.setRenderTarget(rt);
        renderer.render(new THREE.Scene(), cam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    material.dispose();
    // keep mips from being rebuilt if anything ever binds these targets again
    albedoRT.texture.generateMipmaps = false;
    normalRT.texture.generateMipmaps = false;
    return {
        albedo: albedoRT.texture,
        normal: normalRT.texture,
        cellsX,
        cellsY,
        slotsX,
        toCanvas(r, normal = false) {
            const rt = normal ? normalRT : albedoRT;
            const px = new Uint8Array(W * H * 4);
            r.readRenderTargetPixels(rt, 0, 0, W, H, px);
            const c = document.createElement('canvas');
            c.width = W;
            c.height = H;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(W, H);
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const i = ((H - 1 - y) * W + x) * 4;
                    const o = (y * W + x) * 4;
                    const a = px[i + 3] / 255;
                    // un-premultiply over a mid grey
                    for (let k = 0; k < 3; k++)
                        img.data[o + k] = a > 0 ? px[i + k] + (1 - a) * 128 : 128;
                    img.data[o + 3] = 255;
                }
            }
            ctx.putImageData(img, 0, 0);
            return c;
        },
        dispose() {
            albedoRT.dispose();
            normalRT.dispose();
        },
    };
}
/**
 * Split the forest into ~`chunks` spatial groups (z bands, then x) and build
 * one InstancedMesh per group.
 */
export function buildImpostorChunks(forest, templates, mats, chunks) {
    const n = forest.count;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++)
        order[i] = i;
    const bandsZ = chunks >= 6 ? 3 : chunks >= 4 ? 2 : 1;
    const perBand = Math.max(1, Math.round(chunks / bandsZ));
    const sorted = Array.from(order).sort((a, b) => forest.z[a] - forest.z[b]);
    const groups = [];
    for (let bz = 0; bz < bandsZ; bz++) {
        const band = sorted.slice(Math.floor((bz * n) / bandsZ), Math.floor(((bz + 1) * n) / bandsZ));
        band.sort((a, b) => forest.x[a] - forest.x[b]);
        for (let bx = 0; bx < perBand; bx++) {
            const g = band.slice(Math.floor((bx * band.length) / perBand), Math.floor(((bx + 1) * band.length) / perBand));
            if (g.length)
                groups.push(g);
        }
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const out = [];
    const p = new THREE.Vector3();
    for (const g of groups) {
        g.sort((a, b) => forest.key[a] - forest.key[b]);
        const count = g.length;
        const geo = new THREE.BufferGeometry();
        geo.index = quad.index;
        geo.setAttribute('position', quad.getAttribute('position'));
        geo.setAttribute('normal', quad.getAttribute('normal'));
        geo.setAttribute('uv', quad.getAttribute('uv'));
        const aImp = new Float32Array(count * 3);
        const keys = new Float32Array(count);
        const mesh = new THREE.InstancedMesh(geo, mats.material, count);
        const m = mesh.instanceMatrix.array;
        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        let maxR = 0;
        for (let k = 0; k < count; k++) {
            const i = g[k];
            const s = forest.scale[i];
            const t = forest.template[i];
            const o = k * 16;
            m.fill(0, o, o + 16);
            m[o] = s;
            m[o + 5] = s;
            m[o + 10] = s;
            m[o + 12] = forest.x[i];
            m[o + 13] = forest.y[i];
            m[o + 14] = forest.z[i];
            m[o + 15] = 1;
            aImp[k * 3] = t;
            aImp[k * 3 + 1] = forest.flip[i];
            aImp[k * 3 + 2] = forest.tint[i];
            keys[k] = forest.key[i];
            const info = templates[t];
            p.set(forest.x[i], forest.y[i] + info.centerY * s, forest.z[i]);
            min.min(p);
            max.max(p);
            maxR = Math.max(maxR, info.radius * s * 1.5);
        }
        geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(aImp, 3));
        mesh.instanceMatrix.needsUpdate = true;
        const sphere = new THREE.Sphere();
        sphere.center.addVectors(min, max).multiplyScalar(0.5);
        let r = 0;
        for (let k = 0; k < count; k++) {
            const i = g[k];
            r = Math.max(r, Math.hypot(forest.x[i] - sphere.center.x, forest.y[i] - sphere.center.y, forest.z[i] - sphere.center.z));
        }
        sphere.radius = r + maxR;
        mesh.boundingSphere = sphere;
        mesh.frustumCulled = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = mats.depth;
        mesh.name = 'flora-impostors';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        out.push({ mesh, keys });
    }
    return out;
}
/** Number of leading instances whose key is below `threshold`. */
export function countBelow(keys, threshold) {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] < threshold)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
