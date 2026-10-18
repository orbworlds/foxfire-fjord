import * as THREE from 'three';
/**
 * The shader contract of Foxfire Fjord: uniform objects shared by every custom
 * shader. Reference these objects directly in your ShaderMaterial /
 * onBeforeCompile uniforms (do not copy the values) — the sky system and the
 * aurora update them once per frame (engine updater order 10, before features).
 *
 * Light scale: a zenith sun gives ~3.3 units of illuminance; the polar sun here
 * peaks ~10° high, moonlight is ~0.1, the aurora's fill is ~0.002–0.03. Exposure
 * (post) brings each to screen: emissive windows and lanterns around 0.3–3.
 */
export const shared = {
    /** seconds since start */
    uTime: { value: 0 },
    /** unit vector toward the sun (world). Below the horizon at night. */
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
    /** unit vector toward the moon (world) */
    uMoonDir: { value: new THREE.Vector3(-0.3, 0.6, 0.5).normalize() },
    /** direction of the active key light (sun by day, moon by night) */
    uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
    /** linear color × intensity of the active key light */
    uLightColor: { value: new THREE.Color(3, 2.9, 2.7) },
    /** 0 at night … 1 in full daylight (smooth through twilight; the ~10° polar noon counts as full day) */
    uDay: { value: 1 },
    /** 0 by day … 1 at full night */
    uNight: { value: 0 },
    /** wind direction (xz, unit) */
    uWindDir: { value: new THREE.Vector2(0.85, 0.53) },
    /** 0..1 gusty wind strength (varies slowly over time) */
    uWindStrength: { value: 0.5 },
    /** linear sky color near the zenith (for cheap ambient terms) */
    uSkyColor: { value: new THREE.Color(0.35, 0.5, 0.75) },
    /** linear horizon / fog color */
    uHorizonColor: { value: new THREE.Color(0.7, 0.75, 0.82) },
    /** raw (not prefiltered) sky cubemap — sample with a world-space direction for reflections (shows the aurora) */
    uSkyCube: { value: null },
    /** visible aurora strength, 0 (none / daylight / overcast) … ~1 (a bright storm); pulses with the substorms */
    uAurora: { value: 0 },
    /**
     * The part of the aurora's light that the environment map (scene.environment) does not hold yet:
     * the IBL already contains the aurora but refreshes only every ~0.5–2.5 s, so IBL-lit materials add
     * `albedo * uAuroraFill * (0.5 + 0.5 * N.y) / PI` to their indirect diffuse and the green wash on
     * snow, ice and roofs pulses with the curtains every frame. Small; may be slightly negative.
     */
    uAuroraFill: { value: new THREE.Color(0, 0, 0) },
    /**
     * Full linear irradiance the aurora casts on an up-facing surface right now (× strength). For shaders
     * that do NOT use scene.environment (custom unlit/stylised materials, particles, steam, fog glow).
     */
    uAuroraLight: { value: new THREE.Color(0, 0, 0) },
    /** unit direction toward the brightest part of the aurora (for glints and sheen on ice and glass) */
    uAuroraDir: { value: new THREE.Vector3(0, 0.45, -0.89) },
    /** 0 clear … 1 overcast with falling snow (the sky's weather state, eased) */
    uOvercast: { value: 0 },
    /** 0..1 intensity of falling snow (particles and soft light), from the weather */
    uSnowfall: { value: 0 },
    /** current post exposure (scene-linear × exposure = display); for effects that must look the same at any exposure */
    uExposure: { value: 1 },
    /** 0..1 how much settled snow lies on roofs, rails and rocks (core/snow.ts multiplies every object's cover by it) */
    uSnowCover: { value: 1 },
    /**
     * Linear irradiance of the cabin's lamps and stove on its interior surfaces right now (warm, flickering
     * with the fire; written by the material library from the room-light state). For custom interior shaders.
     */
    uLampFill: { value: new THREE.Color(0, 0, 0) },
    /** stove-fire flicker around 1 (≈0.8..1.15), for anything lit by the fire (embers, glow on the floor, window light) */
    uFireFlicker: { value: 1 },
};
