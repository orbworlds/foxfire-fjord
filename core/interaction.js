/**
 * Hover / click picking for registered objects (the stove, the blinds, the
 * hot-tub lid, the sauna door…).
 *
 *   const off = ctx.interaction.register({
 *     object: stoveProxy,                    // raycast against this subtree
 *     label: 'Wood stove',
 *     action: 'Open the door',               // verb shown in the tooltip
 *     card: { kicker: 'In the cabin', title: 'The wood stove', body: '<p>…</p>' },
 *     onClick: (hit) => toggle(),
 *   });
 *
 * Solid things that should block picking behind them (walls, furniture)
 * should be added with `addOccluder`. Glass is NOT an occluder. Keep pick
 * targets simple (use hitBox proxies for complex meshes).
 *
 * Touch: a still tap picks where the finger landed; there is no hover
 * tooltip for fingers (`pointerType` tells the HUD which kind of pointer is
 * in use).
 */
import * as THREE from 'three';
import { state } from './state.js';
export class Interaction {
    engine;
    canvas;
    hovered = null;
    hoverHit = null;
    enabled = true;
    /** UI hooks */
    onHoverChange = () => { };
    onActivate = () => { };
    roots = [];
    owner = new Map();
    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    client = { x: 0, y: 0 };
    dirty = false;
    lastCam = [0, 0, 0, 0];
    down = null;
    /** the kind of pointer last used on the canvas ('mouse' | 'pen' | 'touch') */
    pointerType = 'mouse';
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;
        const at = (e) => {
            this.pointerType = e.pointerType || 'mouse';
            this.client.x = e.clientX;
            this.client.y = e.clientY;
            const r = canvas.getBoundingClientRect();
            this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            this.dirty = true;
        };
        canvas.addEventListener('pointermove', at);
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0)
                return;
            // a still tap picks where the finger landed, not where the last touch ended
            at(e);
            this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
        });
        canvas.addEventListener('pointerup', (e) => {
            if (e.button !== 0 || !this.down)
                return;
            const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
            const dt = performance.now() - this.down.t;
            this.down = null;
            if (moved < (e.pointerType === 'touch' ? 12 : 6) && dt < 600) {
                at(e);
                this.click();
            }
        });
        canvas.addEventListener('pointerleave', () => this.setHovered(null, null));
    }
    register(i) {
        this.roots.push(i.object);
        this.owner.set(i.object, i);
        return () => {
            const k = this.roots.indexOf(i.object);
            if (k >= 0)
                this.roots.splice(k, 1);
            this.owner.delete(i.object);
            if (this.hovered === i)
                this.setHovered(null, null);
        };
    }
    addOccluder(obj) {
        this.roots.push(obj);
        this.owner.set(obj, null);
        return () => {
            const k = this.roots.indexOf(obj);
            if (k >= 0)
                this.roots.splice(k, 1);
            this.owner.delete(obj);
        };
    }
    /** Pick at normalized device coordinates. */
    pick(ndc) {
        if (!this.roots.length)
            return null;
        this.raycaster.setFromCamera(ndc, this.engine.camera);
        this.raycaster.far = 60;
        const hits = this.raycaster.intersectObjects(this.roots, true);
        for (const hit of hits) {
            let o = hit.object;
            if (o.userData.noPick)
                continue;
            while (o && !this.owner.has(o))
                o = o.parent;
            if (!o)
                continue;
            const it = this.owner.get(o);
            if (!it)
                return null; // occluder
            if (it.enabled && !it.enabled())
                continue;
            if (hit.distance > (it.maxDistance ?? 16))
                return null;
            return { interactable: it, hit };
        }
        return null;
    }
    setHovered(i, hit) {
        if (this.hovered !== i) {
            this.hovered?.onHover?.(false);
            this.hovered = i;
            i?.onHover?.(true, hit ?? undefined);
            this.canvas.style.cursor = i ? 'pointer' : '';
        }
        this.hoverHit = hit;
        this.onHoverChange(i, this.client.x, this.client.y);
    }
    click() {
        if (!this.enabled)
            return;
        const ndc = state.mode === 'walk' && document.pointerLockElement ? new THREE.Vector2(0, 0) : this.ndc;
        const res = this.pick(ndc);
        if (!res)
            return;
        const { interactable: it, hit } = res;
        try {
            it.onClick?.(hit);
        }
        catch (err) {
            console.error('[interaction] onClick failed', err);
        }
        const card = typeof it.card === 'function' ? it.card() : (it.card ?? null);
        this.onActivate(it, card);
    }
    /** Called every frame. */
    update() {
        // walk mode picks at the crosshair when the mouse is captured, and for fingers (taps still pick where they land)
        const centre = state.mode === 'walk' && (!!document.pointerLockElement || this.pointerType === 'touch');
        // fingers have no hover outside walk mode
        if (!this.enabled || (this.pointerType === 'touch' && state.mode !== 'walk')) {
            if (this.hovered)
                this.setHovered(null, null);
            return;
        }
        // re-pick when the camera moved under a still pointer (e.g. after a flight)
        const m = this.engine.camera.matrixWorld.elements;
        if (m[12] !== this.lastCam[0] || m[13] !== this.lastCam[1] || m[14] !== this.lastCam[2] || m[8] !== this.lastCam[3]) {
            this.lastCam = [m[12], m[13], m[14], m[8]];
            if (this.hovered || this.client.x > 0)
                this.dirty = true;
        }
        if (!this.dirty && !centre)
            return;
        this.dirty = false;
        const res = this.pick(centre ? new THREE.Vector2(0, 0) : this.ndc);
        if (centre) {
            this.client.x = window.innerWidth / 2;
            this.client.y = window.innerHeight / 2;
        }
        this.setHovered(res?.interactable ?? null, res?.hit ?? null);
    }
}
