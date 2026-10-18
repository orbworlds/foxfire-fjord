/**
 * Foxfire Fjord — a glass cabin under the northern lights.
 *
 * Bootstrap: pick a quality preset, build the engine, bake the island, start
 * the polar sky (with the aurora) at 21:45, then load the features one by one
 * with a progress bar; each fails on its own without taking the world down.
 * window.foxfire exposes the feature context for debugging.
 */

import * as THREE from 'three';
import { params } from './core/params.js';
import { Engine } from './core/engine.js';
import { detectDefaultQuality, qualityPreset, QUALITY_ORDER } from './core/quality.js';
import { World } from './world/world.js';
import { SkySystem } from './core/sky.js';
import { MaterialLibrary } from './core/materials.js';
import { texturePool } from './core/texture-pool.js';
import { Interaction } from './core/interaction.js';
import { Colliders } from './core/colliders.js';
import { CameraRig } from './core/controls.js';
import { LodManager } from './core/lod.js';
import { events } from './core/events.js';
import { state } from './core/state.js';
import { shared } from './core/shared.js';
import { Hud } from './ui/hud.js';
import { loadFeatures } from './core/loader.js';
import { FEATURE_REGISTRY } from './features/index.js';
/** 21:45 on a late-February night: the aurora is up, the moon high in the south-west */
const DEFAULT_TIME = 21.75;
/**
 * Compile every material, including objects hidden by LOD or by state (interiors, toggled props),
 * for the target the scene is really drawn into (the composer's linear HDR buffer: compiled for the
 * canvas, every program would differ in its output colour space and be built again, blocking, on the
 * first frame). With KHR_parallel_shader_compile the browser links them in the background and the
 * promise resolves once all are ready, so the main thread never waits on the driver.
 */
async function precompileAll(engine) {
    const hidden = [];
    engine.scene.traverse((o) => {
        // a light switched on here would change the light count every program is compiled for
        if (!o.visible && !o.isLight) {
            hidden.push(o);
            o.visible = true;
        }
    });
    const r = engine.renderer;
    const prev = r.getRenderTarget();
    let ready = Promise.resolve();
    try {
        r.setRenderTarget(engine.composer.inputBuffer);
        ready = r.compileAsync(engine.scene, engine.camera);
    }
    catch (err) {
        console.warn('[foxfire] precompile failed', err);
    }
    finally {
        r.setRenderTarget(prev);
        for (const o of hidden)
            o.visible = false;
    }
    // never hang the start on a driver that does not report completion
    await Promise.race([ready, new Promise((res) => setTimeout(res, 45000))]);
}
async function main() {
    const canvas = document.getElementById('scene');
    const uiHost = document.getElementById('ui');
    const qualityName = params.quality && QUALITY_ORDER.includes(params.quality) ? params.quality : detectDefaultQuality();
    const quality = qualityPreset(qualityName);
    // boot phases (ms since main() started) for window.__LOAD_REPORT__.phases
    const phases = { start: Math.round(performance.now()) };
    const t0 = performance.now();
    const mark = (name) => (phases[name] = Math.round(performance.now() - t0));
    // the material library's textures start generating in background workers while the world is baked
    // (?texworkers=0 generates them on the main thread as they are needed, for comparison)
    const texWorkers = !/[?&]texworkers=0(&|$)/.test(location.search);
    const texturesReady = (texWorkers ? MaterialLibrary.prefetch(quality) : Promise.resolve()).then(() => mark('texturesDone'));
    const hud = new Hud(uiHost, params.ui);
    hud.setQualityName(qualityName);
    hud.setLoading(0.02, 'lighting the stove');
    const engine = new Engine(canvas, quality);
    hud.setLoading(0.05, 'raising the fells');
    const world = await World.create(quality, (f) => hud.setLoading(0.05 + f * 0.22, 'raising the fells'));
    mark('world');
    const sky = new SkySystem(engine, quality);
    sky.setTime(params.time ?? DEFAULT_TIME, false);
    sky.speed = params.speed ?? 0;
    hud.syncSpeed(sky.speed);
    mark('sky');
    const materials = new MaterialLibrary(engine.renderer, quality);
    const interaction = new Interaction(engine, canvas);
    const colliders = new Colliders();
    const controls = new CameraRig(engine, colliders, canvas);
    const lod = new LodManager();
    const features = new Map();
    const ctx = {
        engine,
        renderer: engine.renderer,
        scene: engine.scene,
        camera: engine.camera,
        world,
        sky,
        materials,
        interaction,
        colliders,
        controls,
        lod,
        ui: hud,
        events,
        state,
        quality,
        shared,
        params,
        getFeature: (id) => features.get(id),
    };
    window.foxfire = { ctx, features };
    hud.rig = controls;
    hud.sky = sky;
    hud.syncTime(sky.hours);
    hud.attach(ctx);
    interaction.onHoverChange = (i, x, y) => hud.onHover(i, x, y);
    interaction.onActivate = (_i, card) => {
        if (card)
            hud.showCard(card);
    };
    let lastQualitySwitch = -Infinity;
    hud.onQualityChange = (name) => {
        Object.assign(quality, qualityPreset(name));
        engine.setQuality(quality);
        sky.setQuality(quality);
        events.emit('quality-changed', { quality: name });
        hud.toast(`Quality: ${name}`);
        // the rebuild hitch must not count against the new preset
        lastQualitySwitch = performance.now();
        engine.resetFps();
    };
    engine.onUpdate((dt) => controls.update(dt), 0);
    engine.onUpdate((dt, t) => sky.update(dt, t), 10);
    engine.onUpdate(() => materials.update(engine.scene), 20);
    engine.onUpdate(() => interaction.update(), 30);
    engine.onUpdate((dt) => lod.update(dt, engine.camera.position), 40);
    // initial camera so features that read the camera get something sensible
    if (params.cam && params.cam.length >= 6) {
        const [x, y, z, tx, ty, tz] = params.cam;
        controls.teleport(new THREE.Vector3(x, y, z), new THREE.Vector3(tx, ty, tz));
    }
    else {
        controls.goToViewpoint(params.view ?? 'overview', { instant: true });
    }
    // let the texture workers finish before the first feature builds (the main thread stays free meanwhile; building
    // alongside them only slows both down on a busy CPU), unless only features without library textures load
    const plain = ['terrain', 'ocean', 'flora', 'grass', 'weather'];
    const needTextures = !params.solo || params.solo.some((id) => !plain.includes(id));
    let texWait = null;
    const beforeFeature = () => {
        if (!needTextures)
            return;
        texWait ??= Promise.race([texturesReady, new Promise((res) => setTimeout(res, 12000))]).then(() => mark('texturesWait'));
        return texWait;
    };
    const report = await loadFeatures(ctx, FEATURE_REGISTRY, features, (f, label) => hud.setLoading(0.28 + f * 0.7, label.toLowerCase()), beforeFeature);
    mark('features');
    phases.texturesWorkerMs = Math.round(texturePool.stats.ms);
    phases.texturesUsed = texturePool.stats.used;
    report.phases = phases;
    window.__LOAD_REPORT__ = report;
    if (report.failed.length)
        console.warn('[foxfire] features failed:', report.failed.map((f) => f.id).join(', '));
    events.emit('features-ready', {});
    materials.releasePrefetch();
    // snow on every roof, rail and rock the features built, and the shelter map under the eaves (before the precompile)
    materials.snowifyFeatures(engine.scene, features);
    mark('snowify');
    if (params.mode === 'walk')
        controls.setMode('walk');
    // the sky's first frame is drawn with the final camera (aurora observer offset, shadow frustum)
    sky.update(0, 0);
    hud.setLoading(0.985, 'polishing the ice');
    await precompileAll(engine);
    mark('precompile');
    lod.update(0, engine.camera.position, true);
    engine.start();
    hud.hideLoading();
    // On Orb: everyone else on the island right now shows up with their name over them: walkers as
    // themselves, and people exploring from the air as glowing orbs where their camera is.
    const orb = window.orb;
    orb?.visitors?.show({ THREE, scene: engine.scene, camera: engine.camera, pose: () => controls.visitorPose(), height: 1.75 });
    if (params.debug)
        hud.enableStats();
    let frames = 0;
    const readyCheck = engine.onUpdate(() => {
        frames++;
        if (frames > 4) {
            mark('ready');
            window.__SCENE_READY__ = true;
            readyCheck();
        }
    }, 1000);
    // adaptive quality: step down once or twice if the first seconds are slow (unless forced by URL)
    if (!params.quality && !params.shot) {
        let checks = 0;
        const timer = setInterval(() => {
            // give a fresh preset a few seconds to settle before judging it
            if (performance.now() - lastQualitySwitch < 4000)
                return;
            checks++;
            const idx = QUALITY_ORDER.indexOf(quality.name);
            if (engine.fps < 34 && idx > 0) {
                hud.onQualityChange(QUALITY_ORDER[idx - 1]);
                hud.setQualityName(quality.name);
            }
            if (checks >= 3)
                clearInterval(timer);
        }, 5000);
    }
}
main().catch((err) => {
    console.error(err);
    const pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;inset:20px;color:#f4f7fb;background:#0b1324;padding:20px;white-space:pre-wrap;z-index:99;font:12px monospace';
    pre.textContent = `Foxfire Fjord failed to start:\n${err?.stack ?? err}`;
    document.body.appendChild(pre);
});
