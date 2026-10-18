/**
 * Opening sequence of Foxfire Fjord: the loading veil lifts onto the island
 * at night with the aurora up, the title card breathes in and out over a slow
 * push-in toward the Teeth, then the camera glides down the fjord to the
 * cabin while a line of the fox-fire legend passes. Any click, key, wheel or
 * touch skips it.
 *
 * The timeline runs on frame time (like the camera flights it is paired with),
 * so slow first frames never leave the title or the returning interface out
 * of step with the camera.
 */
import * as THREE from 'three';
import { VIEWPOINTS } from '../world/layout.js';
import { el, brandMark, isTouchFirst, prefersReducedMotion } from './dom.js';
/** the intro opens at 21:45, the aurora up and climbing toward its 22:30 peak */
export const AURORA_HOUR = 21.75;
export class Intro {
    ctx;
    time;
    root;
    active = false;
    clock = 0;
    queue = [];
    token = 0;
    unbind = null;
    onStateChange = () => { };
    onEnd = () => { };
    constructor(ctx, time) {
        this.ctx = ctx;
        this.time = time;
        this.root = el('div', 'intro', `<div class="intro__veil"></div>
       <div class="intro__title">
         ${brandMark('intro__mark')}
         <h1 class="intro__name">Foxfire Fjord</h1>
         <div class="intro__rule"><i></i><b></b><i></i></div>
         <p class="intro__tag">a glass cabin under the northern lights</p>
         <p class="intro__meta">69° N · late February · the long blue night</p>
       </div>
       <p class="intro__legend">In Finnish the northern lights are <em>revontulet</em> — fox fires: an arctic fox running over the fells, sweeping sparks into the sky with its tail.</p>
       <div class="intro__skip">${isTouchFirst() ? 'tap to skip' : 'click or press any key to skip'}</div>`);
    }
    get isActive() {
        return this.active;
    }
    /** Before the first frame: the aurora hour (unless the URL fixed a time), interface held back. */
    arm() {
        this.active = true;
        if (this.ctx.params.time === null)
            this.time.set(AURORA_HOUR);
        this.onStateChange(true);
    }
    /** Starts as the loading screen fades. */
    play() {
        if (!this.active)
            this.arm();
        const token = ++this.token;
        const { controls, camera } = this.ctx;
        const quick = prefersReducedMotion();
        this.clock = 0;
        this.root.classList.add('is-on');
        this.bindSkip();
        // slow push-in toward the fjord while the title is up
        const target = controls.orbit.target.clone();
        const dir = target.clone().sub(camera.position);
        const push = Math.min(120, dir.length() * 0.12);
        const pushPos = camera.position.clone().addScaledVector(dir.normalize(), push);
        if (!quick)
            controls.flyTo(pushPos, target, { duration: 8.5 });
        this.later(() => this.root.classList.add('is-title'), quick ? 200 : 900);
        this.later(() => this.root.classList.remove('is-title'), quick ? 2600 : 5900);
        this.later(() => {
            const vp = VIEWPOINTS.find((v) => v.id === 'cabin');
            if (!vp)
                return this.finish(false);
            const { pos, target: t } = controls.resolveViewpoint(vp);
            // a long glide down over the fjord to the cabin (a low arc keeps the Teeth and the aurora in view)
            controls.flyTo(pos, t, { duration: quick ? 2.2 : 7.4, arc: 70 }).then(() => {
                if (token === this.token)
                    this.finish(false);
            });
            if (!quick) {
                this.later(() => this.root.classList.add('is-legend'), 900);
                this.later(() => this.root.classList.remove('is-legend'), 5600);
            }
            // the interface starts to come back during the final approach
            this.later(() => this.onStateChange(false), quick ? 900 : 5900);
        }, quick ? 2800 : 6500);
    }
    skip() {
        if (!this.active)
            return;
        this.token++;
        this.clearTimers();
        const vp = VIEWPOINTS.find((v) => v.id === 'cabin');
        if (vp) {
            const { pos, target } = this.ctx.controls.resolveViewpoint(vp);
            const far = this.ctx.camera.position.distanceTo(pos) > 400;
            if (far)
                this.ctx.controls.teleport(pos.clone().add(new THREE.Vector3(-14, 7, 10)), target);
            this.ctx.controls.flyTo(pos, target, { duration: 1.6 });
        }
        this.finish(true);
    }
    finish(skipped) {
        if (!this.active)
            return;
        this.active = false;
        this.clearTimers();
        this.unbind?.();
        this.unbind = null;
        this.root.classList.remove('is-title', 'is-legend');
        this.root.classList.add('is-leaving');
        window.setTimeout(() => this.root.classList.remove('is-on', 'is-leaving'), 1000);
        this.onStateChange(false);
        this.onEnd(skipped);
        this.ctx.events.emit('intro:end', { skipped });
    }
    /** Advance the timeline; called every frame by the HUD. */
    update(dt) {
        if (!this.queue.length)
            return;
        this.clock += dt;
        for (let i = 0; i < this.queue.length;) {
            const e = this.queue[i];
            if (e.at <= this.clock) {
                this.queue.splice(i, 1);
                e.fn();
            }
            else
                i++;
        }
    }
    later(fn, ms) {
        this.queue.push({ at: this.clock + ms / 1000, fn });
    }
    clearTimers() {
        this.queue.length = 0;
    }
    bindSkip() {
        const onAny = (e) => {
            if (!this.active)
                return;
            if (e instanceof KeyboardEvent && (e.metaKey || e.ctrlKey || e.altKey))
                return;
            e.preventDefault();
            e.stopPropagation();
            this.skip();
        };
        const opts = { capture: true };
        // give the loading veil a moment so a stray click while loading doesn't skip
        const t = window.setTimeout(() => {
            window.addEventListener('pointerdown', onAny, opts);
            window.addEventListener('keydown', onAny, opts);
            window.addEventListener('wheel', onAny, { capture: true, passive: false });
        }, 350);
        this.unbind = () => {
            clearTimeout(t);
            window.removeEventListener('pointerdown', onAny, opts);
            window.removeEventListener('keydown', onAny, opts);
            window.removeEventListener('wheel', onAny, opts);
        };
    }
}
