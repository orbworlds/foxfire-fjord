/**
 * Foxfire Fjord's renderer, scene, camera, image pipeline and frame loop.
 *
 * Image pipeline (HDR, half float): render → N8AO (blue-tinted for snow) → one
 * merged effect pass with bloom (threshold relative to the exposure, so warm
 * windows, lanterns and aurora cores glow at night while sunlit snow does not)
 * and the winter grade (exposure, Purkinje night shift, Khronos Neutral tone
 * curve with adjustable desaturation, cold-shadow / warm-highlight split tone,
 * vignette, night grain) → SMAA with dithering. `?tm=aces|agx|neutral` swaps
 * the grade for a stock tone mapper.
 *
 * Updaters run every frame in ascending `order` (controls → time → sky →
 * materials → features → …).
 */
import * as THREE from 'three';
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect, } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { params } from './params.js';
import { shared } from './shared.js';
const GRADE_FRAG = /* glsl */ `
uniform float uExposure;
uniform float uDesat;
uniform float uPurkinje;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSplit;
uniform float uVignette;
uniform float uVigOffset;
uniform float uGrain;

// Khronos PBR Neutral with an adjustable highlight desaturation
vec3 neutralTone(vec3 color, float desat) {
  const float startCompression = 0.8 - 0.04;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

float gradeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0)) * uExposure;
  // Purkinje shift: in dim light the rods take over and grey tones drift toward blue-green;
  // saturated light (aurora, windows) keeps its colour
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float sat = mx > 1e-5 ? (mx - min(c.r, min(c.g, c.b))) / mx : 0.0;
  float rod = uPurkinje * (1.0 - smoothstep(0.0, 0.18, L)) * (1.0 - smoothstep(0.2, 0.6, sat));
  c = mix(c, L * vec3(0.8, 0.98, 1.2), rod * 0.5);

  c = neutralTone(c, uDesat);

  // split tone: cold shadows, warm highlights (multiplicative, so black stays black)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.04, 0.65, l));
  c *= mix(vec3(1.0), tint, uSplit);

  // vignette
  float dv = distance(uv, vec2(0.5));
  c *= 1.0 - smoothstep(uVigOffset * 0.799, 0.8, dv * (uVignette + uVigOffset));

  // grain, strongest in the mid-darks like a long exposure
  float n = gradeHash(gl_FragCoord.xy + fract(time * 7.13) * 431.0) + gradeHash(gl_FragCoord.yx * 1.37 + fract(time * 3.71) * 173.0) - 1.0;
  c += n * uGrain * (0.02 + 0.6 * sqrt(max(l, 0.0)) * (1.0 - l));

  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}
`;
/** exposure, tone curve, split tone, Purkinje shift, vignette and grain in one pass */
class WinterGradeEffect extends Effect {
    constructor() {
        super('WinterGradeEffect', GRADE_FRAG, {
            blendFunction: BlendFunction.SRC,
            uniforms: new Map([
                ['uExposure', new THREE.Uniform(1)],
                ['uDesat', new THREE.Uniform(0.15)],
                ['uPurkinje', new THREE.Uniform(0)],
                // tints normalised to unit luminance
                ['uShadowTint', new THREE.Uniform(new THREE.Vector3(0.93, 1.0, 1.12))],
                ['uHighTint', new THREE.Uniform(new THREE.Vector3(1.06, 1.0, 0.9))],
                ['uSplit', new THREE.Uniform(0.5)],
                ['uVignette', new THREE.Uniform(0.3)],
                ['uVigOffset', new THREE.Uniform(0.3)],
                ['uGrain', new THREE.Uniform(0.01)],
            ]),
        });
    }
    set(name, value) {
        this.uniforms.get(name).value = value;
    }
}
/**
 * Owns the renderer, scene, camera, post-processing chain and the frame loop.
 * Updaters run every frame in ascending `order` (controls → sky → features → …).
 */
export class Engine {
    renderer;
    scene = new THREE.Scene();
    camera;
    composer;
    quality;
    elapsed = 0;
    frame = 0;
    fps = 60;
    /** point of interest (orbit target / walker look point); drives shadow frustum and LOD */
    focus = new THREE.Vector3();
    /** set to false to pause simulation updates (rendering continues) */
    running = true;
    /** exposure set by the sky (eye adaptation), before the bias */
    exposure = 1;
    /** exposure multiplier from ?ev= (stops) */
    exposureBias = Math.pow(2, params.ev);
    updaters = [];
    timer = new THREE.Timer();
    aoPass = null;
    bloom = null;
    grade = null;
    vignette = null;
    fpsAccum = 0;
    fpsFrames = 0;
    constructor(canvas, quality) {
        this.quality = quality;
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: false,
            alpha: false,
            stencil: false,
            depth: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: params.shot,
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.info.autoReset = false;
        this.camera = new THREE.PerspectiveCamera(params.fov ?? 55, 1, 0.1, 30000);
        this.camera.position.set(0, 60, 80);
        this.scene.add(this.camera);
        this.timer.connect(document);
        this.buildComposer();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    onUpdate(fn, order = 0) {
        const entry = { fn, order };
        this.updaters.push(entry);
        this.updaters.sort((a, b) => a.order - b.order);
        return () => {
            const i = this.updaters.indexOf(entry);
            if (i >= 0)
                this.updaters.splice(i, 1);
        };
    }
    setQuality(q) {
        this.quality = q;
        this.buildComposer();
        this.resize();
    }
    setExposure(e) {
        this.exposure = e;
        this.renderer.toneMappingExposure = e * this.exposureBias;
    }
    buildComposer() {
        const q = this.quality;
        if (this.composer)
            this.composer.dispose();
        const composer = new EffectComposer(this.renderer, {
            frameBufferType: THREE.HalfFloatType,
            multisampling: 0,
        });
        composer.addPass(new RenderPass(this.scene, this.camera));
        this.aoPass = null;
        if (q.ao !== 'off') {
            const ao = new N8AOPostPass(this.scene, this.camera, 512, 512);
            ao.setQualityMode(q.ao);
            // snow: wide, soft and blue (occluded snow keeps the colour of the sky it still sees, never grey-black)
            ao.configuration.aoRadius = 1.4;
            ao.configuration.distanceFalloff = 1.0;
            ao.configuration.intensity = 1.7;
            ao.configuration.color = new THREE.Color().setRGB(0.16, 0.24, 0.45);
            ao.configuration.halfRes = q.aoHalfRes;
            ao.configuration.gammaCorrection = false;
            // otherwise N8AO re-renders every transparent mesh (all the glass) each frame
            ao.autoDetectTransparency = false;
            ao.configuration.transparencyAware = false;
            if (params.shot)
                ao.configuration.accumulate = true;
            composer.addPass(ao);
            this.aoPass = ao;
        }
        const effects = [];
        this.bloom = null;
        if (q.bloom) {
            this.bloom = new BloomEffect({
                blendFunction: BlendFunction.ADD,
                mipmapBlur: true,
                luminanceThreshold: 1.1,
                luminanceSmoothing: 0.25,
                intensity: 0.55,
                radius: 0.7,
                levels: q.bloomLevels,
            });
            effects.push(this.bloom);
        }
        this.grade = null;
        this.vignette = null;
        const modes = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL };
        if (params.toneMapping && modes[params.toneMapping] !== undefined) {
            this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.4 });
            effects.push(this.vignette, new ToneMappingEffect({ mode: modes[params.toneMapping] }));
        }
        else {
            this.grade = new WinterGradeEffect();
            effects.push(this.grade);
        }
        const gradePass = new EffectPass(this.camera, ...effects);
        composer.addPass(gradePass);
        if (q.smaa) {
            const smaa = new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
            smaa.dithering = true;
            composer.addPass(smaa);
        }
        else {
            gradePass.dithering = true;
        }
        this.composer = composer;
        this.updateGrade();
    }
    /** Day/night post parameters; bloom threshold relative to the exposure. Runs every frame before rendering. */
    updateGrade() {
        const night = shared.uNight.value;
        const exposure = Math.max(this.renderer.toneMappingExposure, 1e-3);
        const smooth = THREE.MathUtils.smoothstep;
        const lerp = THREE.MathUtils.lerp;
        if (this.bloom) {
            // display-referred threshold: by day only sun glints and speculars bloom, not sunlit snow;
            // at night windows, lanterns, the moon and the aurora's bright lower borders get soft halos
            const tPost = lerp(1.6, 0.62, night);
            const sPost = lerp(0.2, 0.45, night);
            const lm = this.bloom.luminanceMaterial;
            lm.threshold = Math.max(tPost / exposure, 1e-4);
            lm.smoothing = Math.max(sPost / exposure, 1e-4);
            this.bloom.intensity = lerp(0.32, 0.85, night);
            this.bloom.mipmapBlurPass.radius = lerp(0.62, 0.82, night);
        }
        if (this.grade) {
            const g = this.grade;
            g.set('uExposure', exposure);
            // snow highlights roll off to white by day; at night the aurora's greens and magentas keep their colour
            g.set('uDesat', lerp(0.16, 0.12, night));
            g.set('uPurkinje', smooth(night, 0.4, 1.0));
            g.set('uSplit', lerp(0.55, 0.85, night));
            // heavy vignetting on white snow reads as dirty corners; at night it frames the sky
            g.set('uVignette', lerp(0.22, 0.42, night));
            g.set('uVigOffset', lerp(0.36, 0.3, night));
            g.set('uGrain', lerp(0.008, 0.03, night));
        }
        if (this.vignette)
            this.vignette.darkness = lerp(0.22, 0.42, night);
    }
    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h, false);
        this.composer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
    start() {
        this.timer.reset();
        this.renderer.setAnimationLoop((t) => this.tick(t));
    }
    stop() {
        this.renderer.setAnimationLoop(null);
    }
    /** Restart the frame-rate measurement (after a quality switch hitch). */
    resetFps() {
        this.fpsAccum = 0;
        this.fpsFrames = 0;
        this.fps = 60;
    }
    /** Render a single frame immediately (useful for screenshots / warmup). */
    tick(timestamp) {
        this.timer.update(timestamp);
        // clamp at 0 too: a manual tick() and the animation loop use different clocks, and a negative step runs everything backwards
        const dt = Math.min(Math.max(this.timer.getDelta(), 0), 0.1);
        if (this.running) {
            this.elapsed += dt;
            for (const u of this.updaters) {
                try {
                    u.fn(dt, this.elapsed);
                }
                catch (err) {
                    console.error('[engine] updater failed', err);
                }
            }
        }
        this.updateGrade();
        this.renderer.info.reset();
        this.composer.render(dt);
        this.frame++;
        this.fpsAccum += dt;
        this.fpsFrames++;
        const w = window;
        w.__FRAMES__ = this.frame;
        if (this.fpsAccum >= 0.5) {
            this.fps = this.fpsFrames / this.fpsAccum;
            this.fpsAccum = 0;
            this.fpsFrames = 0;
            if (params.debug) {
                const info = this.renderer.info;
                w.__STATS__ = {
                    fps: Math.round(this.fps),
                    calls: info.render.calls,
                    triangles: info.render.triangles,
                    points: info.render.points,
                    lines: info.render.lines,
                    geometries: info.memory.geometries,
                    textures: info.memory.textures,
                    programs: info.programs?.length ?? 0,
                };
            }
        }
    }
}
