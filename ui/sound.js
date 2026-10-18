import { HOUSE, SPRING, LAKE, SAUNA, VILLAGE, BEACH } from '../world/layout.js';
import { mulberry32 } from '../world/noise.js';
import { smoothstep, clamp } from './dom.js';
const DEG = Math.PI / 180;
const rnd = mulberry32(0x0f0f1e);
function rand(a, b) {
    return a + rnd() * (b - a);
}
/** Pink noise (Paul Kellet's filter), looped by every noise-based layer at different offsets. */
function pinkNoise(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
    }
    // crossfade the loop seam
    const fade = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[i] = d[i] * t + d[len - fade + i] * (1 - t);
    }
    return buf;
}
/** A mono buffer filled by `fn(data, sampleRate)`, normalised to `peak`. */
function render(ac, seconds, peak, fn) {
    const sr = ac.sampleRate;
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(sr * seconds)), sr);
    const d = buf.getChannelData(0);
    fn(d, sr);
    let m = 0;
    for (let i = 0; i < d.length; i++)
        m = Math.max(m, Math.abs(d[i]));
    if (m > 0) {
        const k = peak / m;
        for (let i = 0; i < d.length; i++)
            d[i] *= k;
    }
    return buf;
}
/** Add one noise grain (sharp attack, quick decay) at sample `at`. */
function grain(d, at, len, amp) {
    for (let i = 0; i < len && at + i < d.length; i++) {
        const e = 1 - i / len;
        d[at + i] += (rnd() * 2 - 1) * amp * e * e;
    }
}
/** One-pole highpass in place (removes the thump below `hz`). */
function highpass(d, sr, hz) {
    const rc = 1 / (2 * Math.PI * hz);
    const a = rc / (rc + 1 / sr);
    let y = 0;
    let px = 0;
    for (let i = 0; i < d.length; i++) {
        const x = d[i];
        y = a * (y + x - px);
        px = x;
        d[i] = y;
    }
}
/** Two-pole resonator in place (a bright click gets a body at `hz`). */
function resonate(d, sr, hz, q, mix) {
    const w = (2 * Math.PI * hz) / sr;
    const r = Math.exp(-w / (2 * q));
    const a1 = -2 * r * Math.cos(w);
    const a2 = r * r;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < d.length; i++) {
        const y = (1 - r) * d[i] - a1 * y1 - a2 * y2;
        y2 = y1;
        y1 = y;
        d[i] = d[i] * (1 - mix) + y * mix * 6;
    }
}
/** A damped sine added in place (thuds, rings). */
function tone(d, sr, at, f0, f1, decay, amp) {
    let ph = 0;
    const n = Math.min(d.length - at, Math.floor(sr * decay * 6));
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.6));
        ph += (2 * Math.PI * f) / sr;
        const env = Math.min(1, t / 0.002) * Math.exp(-t / decay);
        d[at + i] += Math.sin(ph) * env * amp;
    }
}
/** The squeak of cold dry snow: a rough, wavering tone during the roll of the foot. */
function squeak(d, sr, at, dur, f, amp) {
    let ph = 0;
    const n = Math.min(d.length - at, Math.floor(sr * dur));
    let wob = 0;
    for (let i = 0; i < n; i++) {
        const x = i / n;
        wob += (rnd() - 0.5) * 0.02;
        wob *= 0.995;
        ph += (2 * Math.PI * f * (1 + wob + 0.06 * Math.sin(x * 40))) / sr;
        const env = Math.sin(Math.PI * x) * (0.6 + 0.4 * rnd());
        d[at + i] += Math.sin(ph) * (0.6 + 0.4 * Math.sign(Math.sin(ph * 0.5))) * env * amp;
    }
}
function snowStep(ac, packed) {
    return render(ac, packed ? 0.2 : 0.3, 0.85, (d, sr) => {
        const heel = Math.floor(sr * rand(0, 0.01));
        const toe = Math.floor(sr * (packed ? rand(0.075, 0.095) : rand(0.1, 0.13)));
        const grains = packed ? Math.floor(rand(14, 24)) : Math.floor(rand(32, 58));
        for (let k = 0; k < grains; k++) {
            const atHeel = rnd() < 0.58;
            const span = atHeel ? (packed ? 0.05 : 0.085) : packed ? 0.07 : 0.11;
            const t = (atHeel ? heel : toe) + Math.floor(sr * span * Math.pow(rnd(), 1.6));
            const len = Math.floor(sr * rand(0.0015, packed ? 0.004 : 0.006));
            const amp = rand(0.25, 1) * (atHeel ? 1 : 0.75);
            grain(d, t, len, amp);
        }
        highpass(d, sr, packed ? 1300 : 700);
        // cold snow squeaks (more on packed paths)
        squeak(d, sr, heel + Math.floor(sr * 0.02), rand(0.05, 0.1), rand(1350, 2100), packed ? 0.32 : 0.12);
        // the soft weight of the foot settling
        tone(d, sr, heel, 90, 60, 0.04, packed ? 0.15 : 0.25);
    });
}
function woodStep(ac) {
    return render(ac, 0.3, 0.8, (d, sr) => {
        tone(d, sr, 0, rand(120, 150), rand(85, 100), 0.055, 1);
        tone(d, sr, 0, rand(230, 280), 210, 0.03, 0.3);
        grain(d, 0, Math.floor(sr * 0.002), 0.7);
        const toe = Math.floor(sr * rand(0.09, 0.12));
        tone(d, sr, toe, rand(140, 170), 110, 0.035, 0.45);
        grain(d, toe, Math.floor(sr * 0.0015), 0.35);
        // snow on the boots
        for (let k = 0; k < 8; k++)
            grain(d, Math.floor(sr * rand(0, 0.15)), Math.floor(sr * rand(0.001, 0.003)), rand(0.05, 0.15));
    });
}
function iceStep(ac) {
    return render(ac, 0.34, 0.8, (d, sr) => {
        grain(d, 0, Math.floor(sr * 0.0025), 1);
        tone(d, sr, 0, rand(290, 340), rand(270, 300), 0.09, 0.55);
        tone(d, sr, 0, rand(2300, 2900), 2200, 0.03, 0.12);
        const toe = Math.floor(sr * rand(0.09, 0.11));
        grain(d, toe, Math.floor(sr * 0.002), 0.5);
        tone(d, sr, toe, 320, 300, 0.05, 0.25);
        // a little skid of loose snow on the ice
        for (let k = 0; k < 10; k++)
            grain(d, toe + Math.floor(sr * rand(0, 0.08)), Math.floor(sr * 0.0015), rand(0.05, 0.12));
        highpass(d, sr, 120);
    });
}
function fireClick(ac) {
    return render(ac, 0.03, 0.9, (d, sr) => {
        grain(d, 0, Math.floor(sr * rand(0.002, 0.007)), 1);
        if (rnd() < 0.5)
            grain(d, Math.floor(sr * rand(0.003, 0.012)), Math.floor(sr * 0.002), rand(0.3, 0.7));
        resonate(d, sr, rand(1400, 4200), rand(2, 6), 0.6);
        highpass(d, sr, 500);
    });
}
function firePop(ac) {
    return render(ac, 0.22, 0.9, (d, sr) => {
        grain(d, 0, Math.floor(sr * rand(0.012, 0.025)), 1);
        resonate(d, sr, rand(600, 1300), 3, 0.7);
        // the hiss of escaping sap
        const n = Math.floor(sr * 0.18);
        for (let i = 0; i < n; i++) {
            const x = i / n;
            d[i] += (rnd() * 2 - 1) * 0.12 * (1 - x) * (1 - x);
        }
        highpass(d, sr, 300);
    });
}
function iceClink(ac) {
    return render(ac, 0.5, 0.7, (d, sr) => {
        const base = rand(1900, 3600);
        for (const k of [1, 1.47, 2.09, 2.76])
            tone(d, sr, 0, base * k, base * k, rand(0.04, 0.12), rand(0.2, 0.6));
        grain(d, 0, Math.floor(sr * 0.0015), 0.5);
    });
}
/** at most this many one-shot voices at once */
const MAX_VOICES = 24;
export class Ambience {
    ctx;
    hooks;
    ac = null;
    master;
    glass;
    outdoor;
    indoor;
    feet;
    seaBus;
    waves = [];
    bed;
    windGain;
    windFilter;
    roarGain;
    hissGain;
    whistleGain;
    whistleFilter;
    fireBus;
    fireBreath;
    pitBus;
    bubbleBus;
    trickleGain;
    trickleFilter;
    iceBus;
    iceEcho;
    iceDelay;
    villageBus;
    beachBus;
    roomTone;
    noise;
    steps = { snow: [], packed: [], wood: [], ice: [] };
    clicks = [];
    pops = [];
    clinks = [];
    voices = 0;
    nextWave = 0;
    waveIdx = 0;
    nextPop = 0;
    nextBubble = 0;
    nextIce = 0;
    nextKnock = 0;
    nextDog = 0;
    nextFox = 0;
    nextClink = 0;
    lastHour = -1;
    acc = 1;
    gust = 0.5;
    stepPan = 1;
    env = { sea: 0, wind: 0, night: 0, lake: 0, spring: 0, tub: 0, fire: 0, pit: 0, village: 0, harbor: 0, beach: 0, fox: 0 };
    enabled = false;
    volume = 0.8;
    onChange = () => { };
    constructor(ctx, hooks = {}) {
        this.ctx = ctx;
        this.hooks = hooks;
        document.addEventListener('visibilitychange', () => {
            if (!this.ac)
                return;
            if (document.hidden)
                this.ac.suspend();
            else if (this.enabled)
                this.ac.resume();
        });
        ctx.events.on('walk:step', (s) => this.step(s.surface, s.speed));
    }
    get supported() {
        return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    }
    /** Must be called from a user gesture the first time. */
    async setEnabled(on) {
        if (on === this.enabled)
            return;
        if (on && !this.supported)
            return;
        this.enabled = on;
        this.onChange(on);
        if (on) {
            if (!this.ac) {
                try {
                    this.build();
                }
                catch (err) {
                    console.warn('[sound] could not start', err);
                    this.enabled = false;
                    this.onChange(false);
                    return;
                }
            }
            const ac = this.ac;
            try {
                await ac.resume();
            }
            catch {
                /* resumed on the next gesture */
            }
            this.acc = 1;
            this.update(0.3);
            this.master.gain.cancelScheduledValues(ac.currentTime);
            this.master.gain.setTargetAtTime(this.volume, ac.currentTime, 0.6);
        }
        else if (this.ac) {
            const ac = this.ac;
            this.master.gain.cancelScheduledValues(ac.currentTime);
            this.master.gain.setTargetAtTime(0, ac.currentTime, 0.15);
            window.setTimeout(() => {
                if (!this.enabled)
                    ac.suspend();
            }, 700);
        }
    }
    toggle() {
        void this.setEnabled(!this.enabled);
    }
    setVolume(v) {
        this.volume = clamp(v, 0, 1);
        if (this.ac && this.enabled)
            this.master.gain.setTargetAtTime(this.volume, this.ac.currentTime, 0.1);
    }
    build() {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        const ac = new Ctor({ latencyHint: 'playback' });
        this.ac = ac;
        this.noise = pinkNoise(ac, 6);
        for (let i = 0; i < 6; i++) {
            this.steps.snow.push(snowStep(ac, false));
            this.steps.packed.push(snowStep(ac, true));
        }
        for (let i = 0; i < 4; i++) {
            this.steps.wood.push(woodStep(ac));
            this.steps.ice.push(iceStep(ac));
        }
        for (let i = 0; i < 10; i++)
            this.clicks.push(fireClick(ac));
        for (let i = 0; i < 3; i++)
            this.pops.push(firePop(ac));
        for (let i = 0; i < 5; i++)
            this.clinks.push(iceClink(ac));
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 10;
        comp.ratio.value = 3;
        comp.attack.value = 0.01;
        comp.release.value = 0.3;
        comp.connect(ac.destination);
        // a little make-up gain into the compressor: the beds are mostly quiet noise
        const trim = ac.createGain();
        trim.gain.value = 1.9;
        trim.connect(comp);
        this.master = ac.createGain();
        this.master.gain.value = 0;
        this.master.connect(trim);
        // everything outdoors passes through "the glass": a lowpass that closes inside the cabin
        this.glass = ac.createBiquadFilter();
        this.glass.type = 'lowpass';
        this.glass.frequency.value = 16000;
        this.glass.Q.value = 0.5;
        this.glass.connect(this.master);
        this.outdoor = ac.createGain();
        this.outdoor.connect(this.glass);
        this.indoor = this.gainTo(this.master, 0);
        // footsteps: close and dry, the very top rolled off
        const feetTone = ac.createBiquadFilter();
        feetTone.type = 'lowpass';
        feetTone.frequency.value = 7500;
        feetTone.connect(this.master);
        this.feet = this.gainTo(feetTone, 0.95);
        // --- the fjord: two alternating swell voices over a low murmur
        this.seaBus = this.gainTo(this.outdoor, 0);
        for (let i = 0; i < 2; i++) {
            const pan = ac.createStereoPanner();
            pan.pan.value = i === 0 ? -0.4 : 0.4;
            pan.connect(this.seaBus);
            const gain = ac.createGain();
            gain.gain.value = 0.0001;
            gain.connect(pan);
            const filter = ac.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400;
            filter.Q.value = 0.4;
            filter.connect(gain);
            this.loopNoise(filter);
            this.waves.push({ filter, gain });
        }
        const bedFilter = ac.createBiquadFilter();
        bedFilter.type = 'lowpass';
        bedFilter.frequency.value = 240;
        this.bed = this.gainTo(this.seaBus, 0.2);
        bedFilter.connect(this.bed);
        this.loopNoise(bedFilter);
        this.beachBus = this.gainTo(this.outdoor, 0);
        // --- wind: a wandering band, a low roar in the gusts, spindrift hiss, a thin whistle
        this.windFilter = ac.createBiquadFilter();
        this.windFilter.type = 'bandpass';
        this.windFilter.frequency.value = 480;
        this.windFilter.Q.value = 0.6;
        this.windGain = this.gainTo(this.outdoor, 0);
        this.windFilter.connect(this.windGain);
        this.loopNoise(this.windFilter);
        const roar = ac.createBiquadFilter();
        roar.type = 'lowpass';
        roar.frequency.value = 210;
        roar.Q.value = 0.7;
        this.roarGain = this.gainTo(this.outdoor, 0);
        roar.connect(this.roarGain);
        this.loopNoise(roar);
        const hiss = ac.createBiquadFilter();
        hiss.type = 'highpass';
        hiss.frequency.value = 4800;
        this.hissGain = this.gainTo(this.outdoor, 0);
        hiss.connect(this.hissGain);
        this.loopNoise(hiss);
        this.whistleFilter = ac.createBiquadFilter();
        this.whistleFilter.type = 'bandpass';
        this.whistleFilter.frequency.value = 1500;
        this.whistleFilter.Q.value = 8;
        this.whistleGain = this.gainTo(this.outdoor, 0);
        this.whistleFilter.connect(this.whistleGain);
        this.loopNoise(this.whistleFilter);
        // --- the stove (indoors) and the fires outdoors (pit, sauna)
        this.fireBus = this.gainTo(this.indoor, 0);
        const breath = ac.createBiquadFilter();
        breath.type = 'lowpass';
        breath.frequency.value = 170;
        this.fireBreath = this.gainTo(this.indoor, 0);
        breath.connect(this.fireBreath);
        this.loopNoise(breath);
        this.roomTone = this.gainTo(this.indoor, 0);
        const room = ac.createBiquadFilter();
        room.type = 'lowpass';
        room.frequency.value = 110;
        room.connect(this.roomTone);
        this.loopNoise(room);
        this.pitBus = this.gainTo(this.outdoor, 0);
        // --- water: the hot spring and the tub
        this.bubbleBus = this.gainTo(this.outdoor, 0);
        this.trickleFilter = ac.createBiquadFilter();
        this.trickleFilter.type = 'bandpass';
        this.trickleFilter.frequency.value = 2200;
        this.trickleFilter.Q.value = 1.2;
        this.trickleGain = this.gainTo(this.bubbleBus, 0.3);
        this.trickleFilter.connect(this.trickleGain);
        this.loopNoise(this.trickleFilter);
        // --- the lake ice: chirps ring through a short feedback echo (the ice sheet's dispersion)
        this.iceBus = this.gainTo(this.outdoor, 0);
        this.iceEcho = ac.createGain();
        this.iceEcho.gain.value = 1;
        this.iceDelay = ac.createDelay(0.5);
        this.iceDelay.delayTime.value = 0.085;
        const fb = ac.createGain();
        fb.gain.value = 0.42;
        const damp = ac.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = 2600;
        this.iceEcho.connect(this.iceDelay);
        this.iceDelay.connect(damp).connect(fb).connect(this.iceDelay);
        damp.connect(this.iceBus);
        this.iceEcho.connect(this.iceBus);
        // --- Lysvik: bells, knocks and a dog, far off
        this.villageBus = this.gainTo(this.outdoor, 0);
        const now = ac.currentTime;
        this.nextWave = now + 0.2;
        this.nextPop = now + 1;
        this.nextBubble = now + 0.3;
        this.nextIce = now + rand(3, 8);
        this.nextKnock = now + rand(2, 6);
        this.nextDog = now + rand(20, 50);
        this.nextFox = now + rand(15, 40);
        this.nextClink = now + 1;
    }
    gainTo(dest, value) {
        const g = this.ac.createGain();
        g.gain.value = value;
        g.connect(dest);
        return g;
    }
    loopNoise(dest) {
        const src = this.ac.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.connect(dest);
        src.start(0, rnd() * this.noise.duration);
    }
    set(param, value, tc = 0.6) {
        param.setTargetAtTime(value, this.ac.currentTime, tc);
    }
    /** Play a pre-rendered buffer once (capped voices). */
    play(buf, dest, t, gain, rate = 1, pan = 0) {
        if (this.voices >= MAX_VOICES)
            return false;
        const ac = this.ac;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const g = ac.createGain();
        g.gain.value = gain;
        let out = g;
        let p = null;
        if (pan !== 0) {
            p = ac.createStereoPanner();
            p.pan.value = clamp(pan, -1, 1);
            g.connect(p);
            out = p;
        }
        out.connect(dest);
        src.connect(g);
        this.voices++;
        src.onended = () => {
            this.voices--;
            src.disconnect();
            g.disconnect();
            p?.disconnect();
        };
        src.start(t);
        return true;
    }
    /** A footfall in walk mode. */
    step(surface, speed) {
        if (!this.enabled || !this.ac || this.ac.state !== 'running')
            return;
        const list = this.steps[surface] ?? this.steps.snow;
        const buf = list[Math.floor(rnd() * list.length)];
        this.stepPan = -this.stepPan;
        const run = smoothstep(speed, 2, 5);
        const gain = (surface === 'wood' ? 0.5 : surface === 'ice' ? 0.42 : 0.55) * (0.75 + 0.45 * run);
        this.play(buf, this.feet, this.ac.currentTime + 0.01, gain, rand(0.92, 1.1) * (1 + 0.08 * run), this.stepPan * 0.12);
    }
    isOn(id, fallback) {
        try {
            const v = this.hooks.controlActive?.(id);
            return v === null || v === undefined ? fallback : v;
        }
        catch {
            return fallback;
        }
    }
    /** Per frame; environment sampling and event scheduling run at 4 Hz. */
    update(dt) {
        if (!this.enabled || !this.ac || this.ac.state !== 'running')
            return;
        this.acc += dt;
        if (this.acc < 0.25)
            return;
        const tick = this.acc;
        this.acc = 0;
        const { camera, world, sky, state, shared, quality } = this.ctx;
        const p = camera.position;
        const ground = world.heightAt(p.x, p.z);
        const coast = world.coastDistance(p.x, p.z);
        const agl = Math.max(0, p.y - Math.max(0, ground));
        const inside = state.inside;
        const sunAlt = Math.asin(clamp(sky.sunDir.y, -1, 1));
        const night = 1 - smoothstep(sunAlt, -9 * DEG, -2 * DEG);
        const lite = quality.name === 'low' ? 0.5 : 1;
        const t = this.ac.currentTime;
        const dist = (x, z, y) => Math.hypot(p.x - x, p.z - z, y === undefined ? 0 : (p.y - y) * 0.6);
        // ---- where we are
        const nearCoast = 1 - smoothstep(coast, 10, 520);
        const height = smoothstep(p.y, 80, 560);
        let fastIce = 0;
        const ocean = this.ctx.getFeature('ocean')?.api;
        if (ocean?.iceAt && coast < 300) {
            try {
                fastIce = ocean.iceAt(p.x, p.z).fast;
            }
            catch {
                fastIce = 0;
            }
        }
        const beach = 1 - smoothstep(dist(BEACH.center.x, BEACH.center.z), 60, 420);
        const sea = (0.04 + 0.7 * nearCoast * (1 - 0.7 * height)) * (1 - 0.55 * fastIce) + 0.6 * beach;
        const dx = p.x - LAKE.x;
        const dz = p.z - LAKE.z;
        const c = Math.cos(LAKE.rot);
        const s = Math.sin(LAKE.rot);
        const lu = (dx * c + dz * s) / LAKE.rx;
        const lv = (-dx * s + dz * c) / LAKE.rz;
        const lakeOut = (Math.sqrt(lu * lu + lv * lv) - 1) * Math.min(LAKE.rx, LAKE.rz);
        const lake = (1 - smoothstep(lakeOut, 0, 220)) * (1 - smoothstep(Math.abs(p.y - LAKE.y), 40, 260));
        const spring = 1 - smoothstep(dist(SPRING.x, SPRING.z, SPRING.y), 4, 70);
        const tubX = HOUSE.x + HOUSE.hotTub.x;
        const tubZ = HOUSE.z + HOUSE.hotTub.z;
        const tub = (1 - smoothstep(dist(tubX, tubZ, HOUSE.floorY), 1.5, 22)) * (this.isOn('cabin-tub', true) ? 1 : 0.15);
        const pitX = HOUSE.x + HOUSE.firePit.x;
        const pitZ = HOUSE.z + HOUSE.firePit.z;
        const pit = (1 - smoothstep(dist(pitX, pitZ, HOUSE.groundY), 2, 28)) * (this.isOn('cabin-fire', true) ? 1 : 0);
        const sauna = (1 - smoothstep(dist(SAUNA.x, SAUNA.z, SAUNA.y), 3, 26)) * night;
        // the stove: loud by it, through the door in the glass wing; an open stove door lets the crackle out
        const lit = this.isOn('cabin-stove', true);
        const door = this.isOn('cabin-stove-door', false) ? 1.45 : 1;
        const stove = (inside && state.room === 'living' ? (lit ? 1 : 0.1) : inside ? (lit ? 0.35 : 0.05) : 0) * door;
        const village = 1 - smoothstep(dist(VILLAGE.center.x, VILLAGE.center.z), 120, 1100);
        const harbor = 1 - smoothstep(dist(VILLAGE.harbor.x, VILLAGE.harbor.z), 40, 320);
        let fox = 0;
        const foxApi = this.ctx.getFeature('fox')?.api;
        if (foxApi?.position) {
            try {
                const f = foxApi.position();
                fox = (1 - smoothstep(Math.hypot(p.x - f.x, p.z - f.z), 20, 260)) * night;
            }
            catch {
                fox = 0;
            }
        }
        // ---- wind: gusts from the shared wind strength, with our own breath on top
        this.gust += (clamp(shared.uWindStrength.value, 0, 1.5) * (0.7 + 0.6 * rnd()) - this.gust) * 0.35;
        const gust = this.gust;
        const exposed = 0.35 + 0.65 * Math.max(height, smoothstep(agl, 20, 260), 0.4 * nearCoast);
        const wind = (0.12 + 0.36 * exposed) * (0.5 + 0.8 * gust) * (sky.weather === 'snow' ? 1.25 : 1);
        this.env = { sea, wind, night, lake, spring, tub, fire: stove, pit, village, harbor, beach, fox };
        const room = state.room;
        this.set(this.glass.frequency, inside ? (room === 'glasswing' ? 1700 : 900) : 16000, 0.25);
        this.set(this.outdoor.gain, inside ? (room === 'glasswing' ? 0.62 : 0.45) : 1, 0.3);
        this.set(this.indoor.gain, inside ? 1 : 0, 0.3);
        this.set(this.seaBus.gain, sea * 0.5, 1.4);
        this.set(this.beachBus.gain, beach * 0.9, 1);
        this.set(this.windGain.gain, wind * 0.6, 0.7);
        this.set(this.windFilter.frequency, 320 + 560 * gust + 260 * height + rand(-70, 70), 0.8);
        this.set(this.roarGain.gain, wind * smoothstep(gust, 0.45, 1.1) * 0.75, 0.5);
        this.set(this.hissGain.gain, wind * smoothstep(gust, 0.55, 1.1) * (inside ? 0 : 0.09), 0.4);
        this.set(this.whistleGain.gain, (height * height + 0.25 * (inside ? 1 : 0)) * smoothstep(gust, 0.5, 1.2) * 0.05, 0.9);
        this.set(this.whistleFilter.frequency, 1100 + 900 * gust + rand(-90, 90), 0.5);
        this.set(this.fireBus.gain, stove * 0.55, 0.6);
        this.set(this.fireBreath.gain, stove * 0.16 * (0.7 + 0.5 * rnd()), 0.3);
        this.set(this.roomTone.gain, inside ? 0.05 : 0, 0.6);
        this.set(this.pitBus.gain, Math.max(pit, sauna * 0.45, tub * 0.2) * 0.6, 0.6);
        const water = Math.max(spring, tub * 0.8);
        this.set(this.bubbleBus.gain, water * 0.42, 0.7);
        this.set(this.trickleGain.gain, (spring * 0.5 + tub * 0.15) * (0.3 + rnd() * 0.7), 0.06);
        this.set(this.trickleFilter.frequency, rand(1500, 3200), 0.1);
        this.set(this.iceBus.gain, lake * 0.85, 1);
        this.set(this.villageBus.gain, village * 0.8, 1);
        // ---- events
        if (t >= this.nextWave)
            this.wave(t, beach);
        if (stove > 0.05 || pit > 0.05 || sauna > 0.05 || tub > 0.3) {
            // the crackle: Poisson clicks for the next tick (indoors on the stove bus, outdoors on the pit bus)
            const indoorFire = stove > 0.05;
            const bus = indoorFire ? this.fireBus : this.pitBus;
            const rate = rand(6, 14) * lite;
            let k = t;
            const end = t + tick;
            while (true) {
                k += -Math.log(1 - rnd()) / rate;
                if (k >= end)
                    break;
                this.play(this.clicks[Math.floor(rnd() * this.clicks.length)], bus, k, rand(0.08, 0.55), rand(0.8, 1.25), rand(-0.3, 0.3));
            }
            if (t >= this.nextPop) {
                this.play(this.pops[Math.floor(rnd() * this.pops.length)], bus, t + rand(0, 0.2), rand(0.4, 0.8), rand(0.85, 1.15), rand(-0.2, 0.2));
                this.nextPop = t + rand(2, 6) / lite;
            }
        }
        if (t >= this.nextBubble) {
            if (water > 0.05)
                this.bubble(t);
            this.nextBubble = t + rand(0.08, 0.45) / (0.4 + water) / lite;
        }
        if (t >= this.nextIce) {
            if (lake > 0.05)
                this.iceSound(t, p.x, p.z);
            // the ice is loudest in the evening as it cools
            const cold = 0.5 + 0.5 * night;
            this.nextIce = t + rand(5, 20) / (0.3 + cold) / lite;
        }
        if (t >= this.nextClink) {
            if (beach > 0.1)
                this.play(this.clinks[Math.floor(rnd() * this.clinks.length)], this.beachBus, t + rand(0, 0.3), rand(0.05, 0.22) * beach, rand(0.85, 1.2), rand(-0.7, 0.7));
            this.nextClink = t + rand(0.6, 2.8) / lite;
        }
        if (t >= this.nextKnock) {
            if (harbor > 0.05)
                this.knock(t, harbor);
            this.nextKnock = t + rand(2.5, 9);
        }
        if (t >= this.nextDog) {
            if (village * night > 0.1)
                this.dog(t, village);
            this.nextDog = t + rand(35, 90);
        }
        if (t >= this.nextFox) {
            if (fox > 0.08)
                this.foxCall(t, fox);
            this.nextFox = t + rand(30, 80);
        }
        // the church bell counts the hours within earshot of Lysvik
        // (only on a natural crossing of the hour; one toll when time runs fast, none for jumps)
        const hour = Math.floor(sky.hours);
        if (hour !== this.lastHour) {
            const natural = this.lastHour >= 0 && (hour - this.lastHour + 24) % 24 === 1 && sky.speed > 0 && sky.speed <= 12;
            if (natural && village > 0.08)
                this.bell(t, sky.speed <= 2.5 ? ((hour + 11) % 12) + 1 : 1, village);
            this.lastHour = hour;
        }
    }
    /** One long swell: builds, breaks dully under the ice-edge, drains back. At the beach it breaks bright. */
    wave(now, beach) {
        const v = this.waves[this.waveIdx];
        this.waveIdx = (this.waveIdx + 1) % this.waves.length;
        const t = now + 0.05;
        const rise = rand(2.6, 4.2);
        const fall = rand(4.5, 7.5);
        const peak = rand(0.5, 1);
        const g = v.gain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.linearRampToValueAtTime(peak * 0.35, t + rise * 0.75);
        g.linearRampToValueAtTime(peak, t + rise);
        g.exponentialRampToValueAtTime(0.03, t + rise + fall);
        const f = v.filter.frequency;
        const bright = 300 + 1800 * beach;
        f.cancelScheduledValues(t);
        f.setValueAtTime(Math.max(160, f.value), t);
        f.linearRampToValueAtTime(380 + bright * 0.4 * peak, t + rise * 0.8);
        f.linearRampToValueAtTime(520 + bright * peak, t + rise);
        f.exponentialRampToValueAtTime(260, t + rise + fall);
        this.nextWave = t + rise + fall * rand(0.45, 0.7);
    }
    /** A Minnaert bubble: a short sine that rises as the bubble closes. */
    bubble(now) {
        if (this.voices >= MAX_VOICES)
            return;
        const ac = this.ac;
        const t = now + rand(0, 0.2);
        const o = ac.createOscillator();
        const g = ac.createGain();
        const f = rand(260, 820);
        const d = rand(0.04, 0.09);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * rand(1.4, 2), t + d);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(rand(0.04, 0.12), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0005, t + d);
        o.connect(g).connect(this.bubbleBus);
        this.voices++;
        o.start(t);
        o.stop(t + d + 0.02);
        o.onended = () => {
            this.voices--;
            o.disconnect();
            g.disconnect();
        };
    }
    /** Mirror Lake: a singing chirp through the echo, a deep boom, or a stick-slip creak. */
    iceSound(now, cx, cz) {
        if (this.voices >= MAX_VOICES - 2)
            return;
        const ac = this.ac;
        const t = now + rand(0, 0.3);
        const pan = ac.createStereoPanner();
        // somewhere out on the ice, panned by its direction from the camera
        const ang = Math.atan2(LAKE.x + rand(-150, 150) - cx, -(LAKE.z + rand(-80, 80) - cz));
        const cam = this.ctx.camera;
        const yaw = Math.atan2(-cam.matrixWorld.elements[8], cam.matrixWorld.elements[10]);
        pan.pan.value = clamp(Math.sin(ang - yaw) * 0.8, -0.85, 0.85);
        const kind = rnd();
        const nodes = [pan];
        let end = t;
        if (kind < 0.55) {
            // the famous "pew": a falling chirp, dispersed by the ice sheet
            this.iceDelay.delayTime.setValueAtTime(rand(0.05, 0.12), t);
            pan.connect(this.iceEcho);
            const o = ac.createOscillator();
            const g = ac.createGain();
            const d = rand(0.35, 1.1);
            o.frequency.setValueAtTime(rand(2600, 4800), t);
            o.frequency.exponentialRampToValueAtTime(rand(140, 260), t + d);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(rand(0.05, 0.11), t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0006, t + d);
            o.connect(g).connect(pan);
            o.start(t);
            o.stop(t + d + 0.05);
            nodes.push(o, g);
            end = t + d + 1.2;
        }
        else if (kind < 0.8) {
            // a boom far under the ice
            pan.connect(this.iceBus);
            const o = ac.createOscillator();
            const g = ac.createGain();
            const lp = ac.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 180;
            const f = rand(55, 95);
            o.frequency.setValueAtTime(f, t);
            o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.9);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(rand(0.25, 0.45), t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0008, t + rand(0.8, 1.4));
            o.type = 'triangle';
            o.connect(lp).connect(g).connect(pan);
            o.start(t);
            o.stop(t + 1.6);
            nodes.push(o, g, lp);
            end = t + 1.7;
        }
        else {
            // a creak: stick-slip friction of plates
            pan.connect(this.iceBus);
            const o = ac.createOscillator();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(rand(32, 60), t);
            const bp = ac.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = rand(450, 900);
            bp.Q.value = 6;
            const g = ac.createGain();
            const d = rand(0.4, 1);
            const curve = new Float32Array(24);
            for (let i = 0; i < curve.length; i++)
                curve[i] = Math.sin((Math.PI * i) / (curve.length - 1)) * (0.4 + 0.6 * rnd()) * 0.12;
            g.gain.setValueAtTime(0, t);
            g.gain.setValueCurveAtTime(curve, t + 0.001, d);
            o.frequency.linearRampToValueAtTime(rand(28, 70), t + d);
            o.connect(bp).connect(g).connect(pan);
            o.start(t);
            o.stop(t + d + 0.05);
            nodes.push(o, g, bp);
            end = t + d + 0.1;
        }
        this.voices++;
        window.setTimeout(() => {
            this.voices--;
            for (const n of nodes)
                n.disconnect();
        }, (end - now) * 1000 + 300);
    }
    /** Boats nudging the quay: a hollow wooden knock. */
    knock(now, near) {
        if (this.voices >= MAX_VOICES)
            return;
        const ac = this.ac;
        const t = now + rand(0, 0.4);
        const o = ac.createOscillator();
        const g = ac.createGain();
        const f = rand(150, 240);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(rand(0.05, 0.14) * near, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
        o.connect(g).connect(this.villageBus);
        this.voices++;
        o.start(t);
        o.stop(t + 0.2);
        o.onended = () => {
            this.voices--;
            o.disconnect();
            g.disconnect();
        };
    }
    /** A dog somewhere in Lysvik: two or three barks, far and muffled. */
    dog(now, near) {
        const ac = this.ac;
        const n = 2 + Math.floor(rnd() * 2);
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900 + 1200 * near;
        lp.connect(this.villageBus);
        let t = now + rand(0.1, 0.5);
        const nodes = [lp];
        for (let i = 0; i < n; i++) {
            const o = ac.createOscillator();
            o.type = 'sawtooth';
            const bp = ac.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = rand(500, 750);
            bp.Q.value = 2.5;
            const g = ac.createGain();
            const f = rand(260, 340);
            o.frequency.setValueAtTime(f, t);
            o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.04);
            o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.16);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.09 * near, t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
            o.connect(bp).connect(g).connect(lp);
            o.start(t);
            o.stop(t + 0.2);
            nodes.push(o, bp, g);
            t += rand(0.28, 0.5);
        }
        window.setTimeout(() => nodes.forEach((x) => x.disconnect()), (t - now) * 1000 + 600);
    }
    /** The arctic fox's call: a few high, hoarse yaps. */
    foxCall(now, near) {
        const ac = this.ac;
        const n = 2 + Math.floor(rnd() * 3);
        let t = now + rand(0.1, 0.6);
        const pan = ac.createStereoPanner();
        pan.pan.value = rand(-0.6, 0.6);
        pan.connect(this.outdoor);
        const nodes = [pan];
        for (let i = 0; i < n; i++) {
            const o = ac.createOscillator();
            o.type = 'sawtooth';
            const bp = ac.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = rand(1100, 1600);
            bp.Q.value = 3;
            const g = ac.createGain();
            const f = rand(780, 1050);
            o.frequency.setValueAtTime(f * 0.9, t);
            o.frequency.linearRampToValueAtTime(f * 1.15, t + 0.03);
            o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.13);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.07 * near, t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
            o.connect(bp).connect(g).connect(pan);
            o.start(t);
            o.stop(t + 0.17);
            nodes.push(o, bp, g);
            t += rand(0.2, 0.34);
        }
        window.setTimeout(() => nodes.forEach((x) => x.disconnect()), (t - now) * 1000 + 600);
    }
    /** Lysvik's church bell striking the hour: inharmonic partials with their own decays. */
    bell(now, count, near) {
        const ac = this.ac;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400 + 2600 * near;
        lp.connect(this.villageBus);
        const nodes = [lp];
        const f0 = 311;
        const partials = [
            [0.5, 0.5, 5],
            [1, 0.8, 3.6],
            [1.19, 0.45, 2.6],
            [1.5, 0.3, 2.2],
            [2, 0.28, 1.8],
            [2.66, 0.14, 1.2],
        ];
        const strikes = Math.min(count, 12);
        for (let s = 0; s < strikes; s++) {
            const t = now + 0.3 + s * 2.4;
            for (const [k, a, d] of partials) {
                const o = ac.createOscillator();
                const g = ac.createGain();
                o.frequency.value = f0 * k * (1 + rand(-0.002, 0.002));
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(a * 0.06 * near, t + 0.006);
                g.gain.exponentialRampToValueAtTime(0.0004, t + d);
                o.connect(g).connect(lp);
                o.start(t);
                o.stop(t + d + 0.05);
                nodes.push(o, g);
            }
        }
        window.setTimeout(() => nodes.forEach((x) => x.disconnect()), (strikes * 2.4 + 6) * 1000);
    }
    /** Debugging: a MediaStream of the whole mix (e.g. to record it). */
    tap() {
        if (!this.ac)
            return null;
        const d = this.ac.createMediaStreamDestination();
        this.master.connect(d);
        return d.stream;
    }
    /** Current mix factors (debugging / UI). */
    get mix() {
        return { ...this.env, voices: this.voices };
    }
}
