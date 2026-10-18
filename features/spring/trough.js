/**
 * The hot water's way in: a split-log trough (a spruce log halved and
 * hollowed, silvered by the weather) laid from between the source boulders
 * over the rim, propped on a stack of flat stones. Water runs down its
 * channel and pours off the end in a thin stream (a tube on a ballistic arc
 * with a scrolling streak shader); drips that froze under it hang as
 * icicles.
 */
import * as THREE from 'three';
import { applyBoxUV, icicles } from '../../core/geometry.js';
import { flatStoneGeometry, noise3, paintVertices } from '../paths/kit/rocks.js';
import { GROUND_Y, POOL, TROUGH } from './layout.js';
/** A split, hollowed log along +x from 0 to len: outer radius R, channel radius r, flat sawn faces at the top. */
function splitLog(len, R, r) {
    const shape = new THREE.Shape();
    const seg = 12;
    // outer half circle (bottom), from the left rim round under to the right rim
    shape.moveTo(-R, 0);
    for (let i = 1; i <= seg; i++) {
        const a = Math.PI + (i / seg) * Math.PI;
        shape.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    // across the right rim, then the channel back (top), across the left rim
    shape.lineTo(r, 0);
    for (let i = 1; i <= seg; i++) {
        const a = -(i / seg) * Math.PI;
        shape.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.85);
    }
    shape.lineTo(-R, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
    // profile in xy, length along z -> length along +x
    g.rotateY(Math.PI / 2);
    g.deleteAttribute('uv');
    return applyBoxUV(g.index ? g.toNonIndexed() : g, { grain: 'x' });
}
export function buildTrough(ctx) {
    const wood = ctx.materials.get('weatheredTimber');
    const stoneMat = ctx.materials.get('fieldstone');
    const iceMat = ctx.materials.get('ice');
    const group = new THREE.Group();
    group.name = 'spring-trough';
    const from = new THREE.Vector3(TROUGH.from.x, TROUGH.from.y, TROUGH.from.z);
    const tip = new THREE.Vector3(TROUGH.to.x, TROUGH.to.y, TROUGH.to.z);
    const back = from.clone().addScaledVector(from.clone().sub(tip).normalize(), 0.4);
    const len = back.distanceTo(tip);
    const R = 0.13;
    const r = 0.085;
    const dir = tip.clone().sub(back).normalize();
    const yaw = Math.atan2(-dir.z, dir.x);
    const pitch = Math.asin(dir.y);
    const frame = new THREE.Matrix4().compose(back, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, pitch, 'YZX')), new THREE.Vector3(1, 1, 1));
    const log = splitLog(len, R, r);
    // knock the sawn end square and the back end rough: nothing to do, the rocks hide it
    log.applyMatrix4(frame);
    const logMesh = new THREE.Mesh(log, wood);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;
    group.add(logMesh);
    // a stack of flat stones under the tip end, standing in the rim rocks
    const prop = tip.clone().addScaledVector(dir, -0.7);
    const ground = GROUND_Y;
    const stoneGeos = [];
    let y = ground - 0.05;
    const top = prop.y - R - 0.005;
    for (let k = 0; y < top - 0.02 && k < 6; k++) {
        const th = Math.min(0.11, top - y);
        const g = flatStoneGeometry(700 + k, 0.2 - k * 0.012, th, 0.17 - k * 0.01, 0.4, 14);
        g.rotateY(k * 1.3);
        g.translate(prop.x + Math.sin(k * 2.1) * 0.02, y, prop.z + Math.cos(k * 1.7) * 0.02);
        paintVertices(g, (p, _n, c) => c.setRGB(0.55, 0.55, 0.57).multiplyScalar(0.85 + 0.25 * noise3(p.x * 4, p.y * 4, p.z * 4)));
        stoneGeos.push(g);
        y += th;
    }
    for (const g of stoneGeos) {
        const m = new THREE.Mesh(g, stoneMat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
    }
    // frozen drips under the log's sides
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const edges = [];
    for (const s of [-1, 1]) {
        const a = back.clone().addScaledVector(dir, len * 0.35).addScaledVector(side, s * R * 0.75);
        const b = tip.clone().addScaledVector(dir, -0.08).addScaledVector(side, s * R * 0.75);
        a.y -= R * 0.65;
        b.y -= R * 0.65;
        edges.push([a, b]);
    }
    const ic = icicles(edges, { spacing: 0.06, maxLength: 0.22, radius: 0.012, density: 0.6, seed: 77 });
    if (ic)
        group.add(new THREE.Mesh(ic, iceMat));
    /* ---------- flowing water ---------- */
    const streamMat = new THREE.ShaderMaterial({
        name: 'springStream',
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNoise: { value: ctx.materials.noise } }]),
        vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
        fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uNoise;
      uniform float uTime;
      uniform vec3 uSkyColor;
      uniform vec3 uLightColor;
      uniform vec3 uLightDir;
      uniform vec3 uAuroraLight;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWPos;
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
        float streak = texture2D(uNoise, vec2(vUv.y * 0.35, vUv.x * 2.2 - uTime * 2.2)).r;
        float a = 0.42 + 0.45 * fres + 0.35 * (streak - 0.5);
        a *= smoothstep(1.0, 0.86, vUv.x) * smoothstep(0.0, 0.04, vUv.x);
        float spec = pow(max(dot(reflect(-V, normalize(vN)), uLightDir), 0.0), 40.0);
        vec3 col = uSkyColor * 0.9 + vec3(0.45, 0.75, 0.72) * 0.2 + uAuroraLight * 0.6 + uLightColor * (0.1 + spec * 0.8);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
        #include <fog_fragment>
      }`,
        transparent: true,
        depthWrite: false,
        fog: true,
    });
    const u = streamMat.uniforms;
    u.uTime = ctx.shared.uTime;
    u.uSkyColor = ctx.shared.uSkyColor;
    u.uLightColor = ctx.shared.uLightColor;
    u.uLightDir = ctx.shared.uLightDir;
    u.uAuroraLight = ctx.shared.uAuroraLight;
    const stream = new THREE.Group();
    stream.name = 'spring-stream';
    stream.userData.snow = 0;
    // water in the channel: a strip just under the rims, u along the trough
    {
        const n = 16;
        const pos = [];
        const uv = [];
        const idx = [];
        for (let i = 0; i <= n; i++) {
            const t = 0.12 + (i / n) * 0.88;
            const c = back.clone().addScaledVector(dir, len * t);
            c.y -= r * 0.45;
            for (const s of [-1, 1]) {
                const p = c.clone().addScaledVector(side, s * r * 0.82);
                pos.push(p.x, p.y, p.z);
                uv.push(t, s > 0 ? 1 : 0);
            }
        }
        for (let i = 0; i < n; i++) {
            const a = i * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, streamMat);
        m.renderOrder = 4;
        m.userData.noMerge = true;
        m.raycast = () => { };
        stream.add(m);
    }
    // the falling stream: ballistic arc from the tip into the pool
    const v0 = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(0.6);
    const grav = 9.81;
    const drop = tip.y - POOL.water;
    const tFall = Math.sqrt((2 * drop) / grav);
    const pts = [];
    const nSeg = 14;
    for (let i = 0; i <= nSeg; i++) {
        const t = (i / nSeg) * tFall * 1.04;
        pts.push(new THREE.Vector3(tip.x + v0.x * t, tip.y - r * 0.4 - 0.5 * grav * t * t, tip.z + v0.z * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 24, 0.022, 7, false);
    const pos = tube.getAttribute('position');
    const tuv = tube.getAttribute('uv');
    const centre = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        const uu = tuv.getX(i);
        curve.getPointAt(Math.min(1, uu), centre);
        // a flat ribbon leaving the trough, narrowing as it falls
        p.fromBufferAttribute(pos, i).sub(centre);
        const along = p.dot(side);
        p.addScaledVector(side, along * (1.6 - uu)).multiplyScalar(1 - 0.4 * uu).add(centre);
        pos.setXYZ(i, p.x, p.y, p.z);
    }
    tube.computeVertexNormals();
    const fall = new THREE.Mesh(tube, streamMat);
    fall.name = 'spring-fall';
    fall.renderOrder = 4;
    fall.userData.noMerge = true;
    fall.raycast = () => { };
    stream.add(fall);
    const impactP = pts[pts.length - 1];
    return { group, stream, impact: new THREE.Vector2(impactP.x, impactP.z) };
}
