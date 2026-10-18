/** Foxfire Fjord's winter sea (see the factory below). */
import * as THREE from 'three';
import { buildOceanGrid } from './grid.js';
import { buildCoastTexture, buildIceTexture, gridUvTransform } from './coast.js';
import { WAVES, makeWaveUniforms, updateWaveUniforms, surfaceHeight } from './waves.js';
import { OCEAN_FRAG, OCEAN_VERT } from './shader.js';
import { SkyMirror } from './mirror.js';
/**
 * The winter sea round Foxfire Fjord: one camera-following mesh (dense lattice
 * near the camera, geometric rings out to ~25 km), a low swell outside that
 * dies away in the sheltered fjord, black-sand and rock shallows under
 * near-black water, the sky, the aurora and the mirrored mountains in the calm
 * water, grease ice and slush along the shores, shore-fast ice in the fjord
 * head, the coves and Lysvik harbour (a channel kept open to the quay), and
 * drifting floes and pancake ice. One draw call, plus a small render of the
 * sky dome from a mirrored camera each frame (mirror.ts) so the aurora's
 * curtains stay sharp in the water.
 */
const create = (ctx) => {
    const { world, shared, quality } = ctx;
    const fancy = quality.fancy;
    const waves = fancy ? WAVES : WAVES.slice(0, 5);
    const cell = fancy ? 1 : 2;
    const geo = buildOceanGrid({
        cell,
        inner: fancy ? 48 : 32,
        outer: 25000,
        growth: fancy ? 1.03 : 1.05,
        farGrowth: 1.32,
        rampFrom: 280,
        rampTo: 4500,
    });
    const coast = buildCoastTexture(world);
    const ice = buildIceTexture(coast);
    const heightXf = gridUvTransform(world.bounds, world.gridNX, world.gridNZ);
    const waveU = makeWaveUniforms(waves);
    updateWaveUniforms(waves, shared.uWindDir.value, waveU);
    const lastWind = shared.uWindDir.value.clone();
    const scene = ctx.engine.scene;
    // the sky (and the aurora) mirrored in the calm water, rendered once a frame at reduced size
    const mirror = ctx.sky?.sky ? new SkyMirror(ctx.sky.sky, quality.name) : null;
    const defines = {
        // parallax ice tops and side walls, broken floes, fast-ice cracks (off on phones)
        ICE_DETAIL: fancy ? 1 : 0,
        WAVES: waves.length,
        RIPPLES: fancy ? 3 : 2,
        // reflected-ray march over the height grid (mirrored land): steps and step growth
        MIRROR_STEPS: fancy ? 24 : 16,
        MIRROR_GROWTH: fancy ? '1.25' : '1.36',
    };
    if (mirror)
        defines.SKY_MIRROR = 1;
    const material = new THREE.ShaderMaterial({
        name: 'ocean',
        defines,
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uWaveA: { value: [] },
                uWaveB: { value: [] },
                uHeightTex: { value: null },
                uHeightXf: { value: heightXf },
                uCoastTex: { value: null },
                uCoastXf: { value: coast.xf },
                uIceTex: { value: null },
                uNoise: { value: null },
                uSurfAmp: { value: 0.1 },
                // near-black arctic water over black sand and dark gneiss
                uDeep: { value: new THREE.Color(0.0007, 0.0028, 0.0045) },
                uSand: { value: new THREE.Color(0.03, 0.029, 0.028) },
                uRock: { value: new THREE.Color(0.02, 0.022, 0.025) },
                uAbsorb: { value: new THREE.Vector3(0.42, 0.15, 0.1) },
                uNear: { value: 0.1 },
                uDrift: { value: new THREE.Vector2() },
                uEnvMap: { value: null },
                uEnvIntensity: { value: 1 },
                uMirror: { value: null },
                uVegTex: { value: null },
                uVegInfo: { value: new THREE.Vector4(0, 0, 0, 0) },
                uMirrorVP: { value: new THREE.Matrix4() },
            },
        ]),
        vertexShader: OCEAN_VERT,
        fragmentShader: OCEAN_FRAG,
        fog: true,
    });
    const u = material.uniforms;
    // textures, wave arrays and shared uniforms by reference (UniformsUtils.merge clones values)
    u.uWaveA.value = waveU.a;
    u.uWaveB.value = waveU.b;
    u.uHeightTex.value = world.heightTexture;
    u.uCoastTex.value = coast.texture;
    u.uIceTex.value = ice.texture;
    u.uNoise.value = ctx.materials.noise;
    u.uMirror.value = mirror ? mirror.target.texture : null;
    // the terrain's tree cover, so the woods mirrored in the water are dark (a blank texture without it)
    const terrainApi = ctx.getFeature('terrain')?.api;
    const blankVeg = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blankVeg.needsUpdate = true;
    u.uVegTex.value = terrainApi?.vegTexture ?? blankVeg;
    if (terrainApi?.vegInfo)
        u.uVegInfo.value.copy(terrainApi.vegInfo);
    if (mirror)
        u.uMirrorVP.value = mirror.viewProj;
    Object.assign(u, ctx.materials.snow.uniforms);
    u.uTime = shared.uTime;
    u.uSkyCube = shared.uSkyCube;
    u.uLightDir = shared.uLightDir;
    u.uLightColor = shared.uLightColor;
    u.uSkyColor = shared.uSkyColor;
    u.uHorizonColor = shared.uHorizonColor;
    u.uAuroraLight = shared.uAuroraLight;
    u.uWindDir = shared.uWindDir;
    u.uNight = shared.uNight;
    // sample the sky's prefiltered environment (PMREM) the way three.js does for standard materials
    let envHeight = -1;
    const syncEnvironment = () => {
        const env = scene.environment;
        const h = env && env.mapping === THREE.CubeUVReflectionMapping ? env.image.height : 0;
        u.uEnvMap.value = env;
        u.uEnvIntensity.value = scene.environmentIntensity;
        if (h === envHeight)
            return;
        envHeight = h;
        const d = material.defines;
        delete d.ENVMAP_TYPE_CUBE_UV;
        delete d.CUBEUV_TEXEL_WIDTH;
        delete d.CUBEUV_TEXEL_HEIGHT;
        delete d.CUBEUV_MAX_MIP;
        if (h > 0) {
            const maxMip = Math.log2(h) - 2;
            d.ENVMAP_TYPE_CUBE_UV = '';
            d.CUBEUV_TEXEL_WIDTH = 1 / (3 * Math.max(2 ** maxMip, 7 * 16));
            d.CUBEUV_TEXEL_HEIGHT = 1 / h;
            d.CUBEUV_MAX_MIP = `${maxMip}.0`;
        }
        material.needsUpdate = true;
    };
    syncEnvironment();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'ocean';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // after the opaque world so terrain covering the sea is rejected by early depth test
    mesh.renderOrder = 1;
    const api = {
        surfaceHeight: (x, z) => {
            const i = ice.sample(x, z);
            const k = (1 - i.fast) * (1 - 0.84 * THREE.MathUtils.smoothstep(i.shelter, 0.45, 0.8));
            return surfaceHeight(waveU, x, z, shared.uTime.value) * k;
        },
        depthAt: (x, z) => -world.heightAt(x, z),
        iceAt: (x, z) => ice.sample(x, z),
        material,
    };
    return {
        id: 'ocean',
        object: mesh,
        api,
        update() {
            const p = ctx.camera.position;
            mesh.position.set(Math.round(p.x / cell) * cell, 0, Math.round(p.z / cell) * cell);
            u.uNear.value = ctx.camera.near;
            mirror?.render(ctx.renderer, ctx.camera, ctx.engine.frame);
            // drift ice moves slowly out of the fjord (westward), nudged by the wind
            const t = shared.uTime.value;
            const wd = shared.uWindDir.value;
            u.uDrift.value.set(0.035 * t - wd.x * 0.012 * t, -0.006 * t - wd.y * 0.012 * t);
            syncEnvironment();
            const wind = shared.uWindDir.value;
            if (!wind.equals(lastWind)) {
                lastWind.copy(wind);
                updateWaveUniforms(waves, wind, waveU);
            }
        },
        dispose() {
            geo.dispose();
            material.dispose();
            coast.texture.dispose();
            ice.texture.dispose();
            mirror?.dispose();
            blankVeg.dispose();
        },
    };
};
export default create;
