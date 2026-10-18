import { clamp, easeInOutCubic, hourDelta } from './dom.js';
/** in-game minutes per real second */
export const SPEEDS = [2, 10, 40];
/**
 * Smooth control of the time of day.
 *
 * Instead of calling sky.setTime() every frame (which re-renders the
 * environment map each call), transitions drive `sky.speed` for exactly one
 * frame at a time, so the sky advances through its normal per-frame path
 * (eased exposure and fog, throttled environment refresh). Runs as an engine
 * updater just before the sky (order 5).
 */
export class TimeDirector {
    sky;
    /** speed used when time is set playing (in-game minutes per real second) */
    selectedSpeed = SPEEDS[1];
    anim = null;
    scrubTarget = null;
    resumeSpeed = 0;
    driving = false;
    listeners = new Set();
    constructor(sky) {
        this.sky = sky;
    }
    get hours() {
        return this.sky.hours;
    }
    get playing() {
        return (this.driving ? this.resumeSpeed : this.sky.speed) !== 0;
    }
    get speed() {
        return this.driving ? this.resumeSpeed : this.sky.speed;
    }
    get busy() {
        return this.driving;
    }
    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    notify() {
        for (const fn of this.listeners)
            fn();
    }
    play(speed = this.selectedSpeed) {
        this.selectedSpeed = speed;
        if (this.driving)
            this.resumeSpeed = speed;
        else
            this.sky.speed = speed;
        this.notify();
    }
    pause() {
        if (this.driving)
            this.resumeSpeed = 0;
        else
            this.sky.speed = 0;
        this.notify();
    }
    toggle() {
        if (this.playing)
            this.pause();
        else
            this.play();
    }
    cycleSpeed() {
        const i = SPEEDS.indexOf(this.selectedSpeed);
        const next = SPEEDS[(i + 1) % SPEEDS.length];
        if (this.playing)
            this.play(next);
        else {
            this.selectedSpeed = next;
            this.notify();
        }
    }
    /** Adopt a speed set from outside (URL parameter, other code). */
    syncFromSky() {
        if (this.driving)
            return;
        if (this.sky.speed > 0)
            this.selectedSpeed = this.sky.speed;
        this.notify();
    }
    /** Jump without animation. */
    set(hours) {
        this.stopDriving();
        this.sky.setTime(hours);
    }
    /**
     * Animate to a time of day. `direction`: 'shortest' around the clock,
     * 'forward' always moves time ahead (through midnight if needed).
     */
    goTo(hours, opts = {}) {
        const from = this.sky.hours;
        let d = hourDelta(from, hours);
        if (opts.direction === 'forward' && d < 0)
            d += 24;
        if (Math.abs(d) < 1 / 240) {
            this.set(hours);
            return;
        }
        const duration = opts.duration ?? clamp(0.7 + Math.abs(d) * 0.16, 0.8, 2.6);
        this.beginDriving();
        this.scrubTarget = null;
        this.anim = { from, to: from + d, t: 0, duration: Math.max(0.05, duration) };
    }
    /** Follow a slider: eases toward the value over a few frames. */
    scrub(hours) {
        this.beginDriving();
        this.anim = null;
        this.scrubTarget = clamp(hours, 0, 24);
    }
    beginDriving() {
        if (!this.driving) {
            this.resumeSpeed = this.sky.speed;
            this.driving = true;
        }
    }
    stopDriving() {
        this.anim = null;
        this.scrubTarget = null;
        if (this.driving) {
            this.driving = false;
            this.sky.speed = this.resumeSpeed;
            this.notify();
        }
    }
    update(dt) {
        if (!this.driving || dt <= 0)
            return;
        const cur = this.sky.hours;
        let target;
        let done = false;
        if (this.anim) {
            const a = this.anim;
            a.t = Math.min(1, a.t + dt / a.duration);
            target = a.from + (a.to - a.from) * easeInOutCubic(a.t);
            done = a.t >= 1;
            const step = hourDelta(cur, target);
            if (done) {
                this.anim = null;
                const final = ((a.to % 24) + 24) % 24;
                this.driving = false;
                this.sky.setTime(final);
                this.sky.speed = this.resumeSpeed;
                this.notify();
                return;
            }
            this.sky.speed = (step * 60) / dt;
            return;
        }
        if (this.scrubTarget !== null) {
            const goal = this.scrubTarget;
            const delta = goal - cur;
            if (Math.abs(delta) < 0.004) {
                this.scrubTarget = null;
                this.driving = false;
                this.sky.setTime(goal >= 24 ? 23.999 : goal);
                this.sky.speed = this.resumeSpeed;
                this.notify();
                return;
            }
            const step = delta * (1 - Math.exp(-dt * 16));
            this.sky.speed = (step * 60) / dt;
            return;
        }
        this.stopDriving();
    }
}
