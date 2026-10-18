import { el, store, isTouchFirst, ICON } from './dom.js';
const STICK_R = 46;
export class WalkUX {
    ctx;
    crosshair;
    hint;
    prompt;
    zone;
    stick;
    knob;
    touch;
    hintTimer = 0;
    active = null;
    origin = { x: 0, y: 0 };
    downAt = 0;
    maxMove = 0;
    running = false;
    canvas;
    onTouchModeChange = () => { };
    constructor(ctx, forceTouch) {
        this.ctx = ctx;
        this.canvas = ctx.renderer.domElement;
        this.touch = forceTouch || isTouchFirst();
        this.crosshair = el('div', 'crosshair', '<i></i>');
        this.prompt = el('div', 'walk-prompt');
        this.renderPrompt();
        ctx.events.on('pointerlock-unavailable', () => {
            this.renderPrompt();
            this.renderHint();
        });
        this.hint = el('div', 'walk-hint');
        this.zone = el('div', 'stick-zone');
        this.stick = el('div', 'stick');
        this.knob = el('div', 'stick__knob');
        this.stick.appendChild(this.knob);
        this.zone.appendChild(this.stick);
        this.renderHint();
        this.bindStick();
        ctx.events.on('mode-changed', () => this.sync(true));
        document.addEventListener('pointerlockchange', () => this.sync(false));
        // hybrid devices: switch to the touch interface the first time a finger is used
        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' && !this.touch) {
                this.touch = true;
                this.renderHint();
                this.sync(false);
            }
        });
        window.addEventListener('keydown', (e) => {
            if (this.hint.classList.contains('is-on') && /^(Key[WASD]|Arrow)/.test(e.code))
                this.hideHint(1200);
        });
        this.sync(false);
    }
    get isTouch() {
        return this.touch;
    }
    renderPrompt() {
        this.prompt.innerHTML = this.ctx.controls.pointerLockFailed
            ? `${ICON.footprints}<span><b>Drag</b> to look around</span><i></i><span><b>F</b> to stop walking</span>`
            : `${ICON.footprints}<span><b>Click</b> to look around</span><i></i><span><b>F</b> to stop walking</span>`;
    }
    renderHint() {
        const look = this.ctx.controls.pointerLockFailed ? 'Drag' : 'Click';
        this.hint.innerHTML = this.touch
            ? `<div class="walk-hint__title">${ICON.footprints}<span>Out on the snow</span></div>
         <div class="walk-hint__keys">
           <span><i class="walk-hint__glyph walk-hint__glyph--stick"></i>Left thumb to walk — push past the rim to run</span>
           <span><i class="walk-hint__glyph">${ICON.eye}</i>Drag on the right to look</span>
           <span><i class="walk-hint__glyph">${ICON.compass}</i>Tap Explore to fly again</span>
         </div>`
            : `<div class="walk-hint__title">${ICON.footprints}<span>Out on the snow</span></div>
         <div class="walk-hint__keys">
           <span><kbd class="wide">${look}</kbd>to look</span>
           <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>to walk</span>
           <span><kbd class="wide">Shift</kbd>to run</span>
           <span><kbd>F</kbd>to fly again</span>
         </div>`;
    }
    showHint(ms = 7000) {
        this.hint.classList.add('is-on');
        clearTimeout(this.hintTimer);
        this.hintTimer = window.setTimeout(() => this.endHint(), ms);
    }
    hideHint(delay = 0) {
        clearTimeout(this.hintTimer);
        this.hintTimer = window.setTimeout(() => this.endHint(), delay);
    }
    /** The hint goes; the quieter "click to look" prompt takes over if it still applies. */
    endHint() {
        if (!this.hint.classList.contains('is-on'))
            return;
        this.hint.classList.remove('is-on');
        const walk = this.ctx.state.mode === 'walk';
        this.prompt.classList.toggle('is-on', walk && !document.pointerLockElement && !this.touch);
    }
    setHover(on) {
        this.crosshair.classList.toggle('is-hover', on);
    }
    sync(modeChanged) {
        const walk = this.ctx.state.mode === 'walk';
        const locked = !!document.pointerLockElement;
        const touchWalk = walk && this.touch;
        this.crosshair.classList.toggle('is-on', walk && (locked || this.touch));
        this.prompt.classList.toggle('is-on', walk && !locked && !this.touch && !this.hint.classList.contains('is-on'));
        this.zone.classList.toggle('is-on', touchWalk);
        if (!touchWalk)
            this.release();
        if (modeChanged && walk && store.get('walk-hint') !== 'seen') {
            store.set('walk-hint', 'seen');
            this.showHint();
            this.prompt.classList.remove('is-on');
        }
        if (!walk)
            this.hideHint();
        if (walk && locked)
            window.setTimeout(() => this.hideHint(), 3500);
        this.onTouchModeChange(touchWalk);
    }
    bindStick() {
        const z = this.zone;
        z.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (this.active !== null)
                return;
            this.active = e.pointerId;
            try {
                z.setPointerCapture(e.pointerId);
            }
            catch {
                // synthetic or already-released pointers cannot be captured
            }
            this.origin = { x: e.clientX, y: e.clientY };
            this.downAt = performance.now();
            this.maxMove = 0;
            this.stick.style.left = `${e.clientX}px`;
            this.stick.style.top = `${e.clientY}px`;
            this.knob.style.transform = 'translate(-50%, -50%)';
            this.stick.classList.add('is-on');
            this.hideHint(600);
        });
        z.addEventListener('pointermove', (e) => {
            e.stopPropagation();
            if (e.pointerId !== this.active)
                return;
            const dx = e.clientX - this.origin.x;
            const dy = e.clientY - this.origin.y;
            const len = Math.hypot(dx, dy);
            this.maxMove = Math.max(this.maxMove, len);
            const k = len > 0 ? Math.min(1, len / STICK_R) / len : 0;
            const nx = dx * k;
            const ny = dy * k;
            this.knob.style.transform = `translate(calc(-50% + ${(nx * STICK_R).toFixed(1)}px), calc(-50% + ${(ny * STICK_R).toFixed(1)}px))`;
            this.ctx.controls.setMoveInput(nx, -ny);
            this.setRun(len > STICK_R * 1.3);
        });
        const end = (e) => {
            e.stopPropagation();
            if (e.pointerId !== this.active)
                return;
            const tap = this.maxMove < 8 && performance.now() - this.downAt < 320;
            this.release();
            if (tap && e.type === 'pointerup')
                this.forwardTap(e.clientX, e.clientY);
        };
        z.addEventListener('pointerup', end);
        z.addEventListener('pointercancel', end);
    }
    release() {
        if (this.active === null && !this.running)
            return;
        this.active = null;
        this.ctx.controls.setMoveInput(0, 0);
        this.setRun(false);
        this.stick.classList.remove('is-on');
    }
    /** Running is the rig's Shift key; the stick pushed past its rim holds it. */
    setRun(on) {
        if (on === this.running)
            return;
        this.running = on;
        this.knob.classList.toggle('is-run', on);
        window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
    }
    /** A tap inside the joystick zone still clicks things in the scene. */
    forwardTap(x, y) {
        const opts = { clientX: x, clientY: y, bubbles: true, pointerId: 9999, pointerType: 'touch', button: 0, isPrimary: true };
        this.canvas.dispatchEvent(new PointerEvent('pointermove', opts));
        this.canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
        this.canvas.dispatchEvent(new PointerEvent('pointerup', opts));
    }
}
