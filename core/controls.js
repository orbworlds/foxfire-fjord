/**
 * Camera rig of Foxfire Fjord: orbit (explore), first-person walk on the
 * snow, and cinematic fly-to arcs between places.
 *
 *  - Orbit: drag to rotate, right-drag / two-finger to pan, wheel to zoom, WASD to glide.
 *  - Walk:  click to capture the mouse (or drag to look), WASD / arrows to move, Shift to run,
 *           F toggles modes. Every footfall emits 'walk:step' { surface, speed } for the sound.
 *  - flyTo / goToViewpoint: eased camera flights (arcs over long distances).
 *
 * It also names where the camera is (emits 'location' { id, label }): the
 * cabin's rooms, the deck, Mirror Lake, the hot spring, Lysvik, Fox Peak…
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { events } from './events.js';
import { HOUSE, SPRING, SAUNA, FOX_PEAK, VIEWPOINTS, VILLAGE, BEACH, LAKE, PATHS, SEA_LEVEL, houseZoneAt, roofHeightLocal, } from '../world/layout.js';
import { heightAt } from '../world/terrain-height.js';
import { samplePath } from '../world/paths.js';
/** location id → label; ids that match a viewpoint id light up that place in the Places list */
const LOCATION_LABELS = {
    overview: 'Over the island',
    living: 'By the stove',
    glasswing: 'Glass wing',
    deck: 'The deck',
    cabin: 'Aurora Cabin',
    spring: 'Hot spring',
    sauna: 'Lake sauna',
    lake: 'Mirror Lake',
    summit: 'Fox Peak',
    village: 'Lysvik',
    harbor: 'Lysvik harbour',
    beach: 'Ice Beach',
    fjord: 'The fjord',
    sea: 'Open sea',
    road: 'The shore road',
    trail: 'Fox Peak trail',
    path: 'On the trail',
    fells: 'High fells',
    shore: 'The shore',
    snowfield: 'Snowfields',
};
/** path centrelines, sampled once (x, z, half width, kind index) for footsteps and location names */
let pathCache = null;
function pathSamples() {
    if (pathCache)
        return pathCache;
    const xs = [];
    const zs = [];
    const hws = [];
    const kinds = [];
    for (const p of PATHS) {
        for (const q of samplePath(p, 3)) {
            xs.push(q.x);
            zs.push(q.z);
            hws.push(p.width / 2);
            kinds.push(p.kind);
        }
    }
    pathCache = { x: Float32Array.from(xs), z: Float32Array.from(zs), hw: Float32Array.from(hws), kind: kinds };
    return pathCache;
}
/** the kind of path under (x, z) when within its walking width + `pad`, else null */
function pathAt(x, z, pad) {
    const c = pathSamples();
    let best = Infinity;
    let kind = null;
    for (let i = 0; i < c.x.length; i++) {
        const dx = c.x[i] - x;
        const dz = c.z[i] - z;
        const d = dx * dx + dz * dz;
        if (d < best) {
            const r = c.hw[i] + pad;
            if (d < r * r) {
                best = d;
                kind = c.kind[i];
            }
        }
    }
    return kind;
}
/** inside Mirror Lake's shoreline ellipse grown by `pad` metres */
function onLake(x, z, pad = 0) {
    const dx = x - LAKE.x;
    const dz = z - LAKE.z;
    const c = Math.cos(LAKE.rot);
    const s = Math.sin(LAKE.rot);
    const u = (dx * c + dz * s) / (LAKE.rx + pad);
    const v = (-dx * s + dz * c) / (LAKE.rz + pad);
    return u * u + v * v < 1;
}
function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export class CameraRig {
    engine;
    colliders;
    canvas;
    orbit;
    eyeHeight = 1.62;
    walkSpeed = 1.45;
    runMultiplier = 3.2;
    enabled = true;
    flight = null;
    yaw = 0;
    pitch = 0;
    keys = new Set();
    feet = new THREE.Vector3();
    seen = new THREE.Vector3();
    look = new THREE.Vector3();
    vel = new THREE.Vector3();
    bob = 0;
    dragLook = null;
    moveInput = new THREE.Vector2();
    locTimer = 0;
    location = { id: 'overview', label: LOCATION_LABELS.overview };
    /** pointer lock is unavailable (sandboxed frame) or was refused: walk mode looks by dragging */
    pointerLockFailed = false;
    constructor(engine, colliders, canvas) {
        this.engine = engine;
        this.colliders = colliders;
        this.canvas = canvas;
        const cam = engine.camera;
        this.orbit = new OrbitControls(cam, canvas);
        this.orbit.enableDamping = true;
        this.orbit.dampingFactor = 0.075;
        this.orbit.screenSpacePanning = false;
        this.orbit.minDistance = 0.35;
        this.orbit.maxDistance = 4000;
        this.orbit.zoomSpeed = 0.9;
        this.orbit.rotateSpeed = 0.55;
        this.orbit.keys = { LEFT: '', UP: '', RIGHT: '', BOTTOM: '' };
        window.addEventListener('keydown', (e) => {
            if (isTyping(e))
                return;
            this.keys.add(e.code);
            if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey)
                this.setMode(state.mode === 'walk' ? 'orbit' : 'walk');
        });
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
        canvas.addEventListener('click', () => {
            if (state.mode === 'walk' && !document.pointerLockElement && !this.pointerLockFailed)
                this.lockPointer();
        });
        document.addEventListener('pointerlockerror', () => this.onLockFailed());
        document.addEventListener('mousemove', (e) => {
            if (state.mode !== 'walk' || !this.enabled)
                return;
            if (document.pointerLockElement === canvas)
                this.addLook(e.movementX, e.movementY);
        });
        canvas.addEventListener('pointerdown', (e) => {
            // keyboard shortcuts need focus inside an embedding frame
            if (document.activeElement !== canvas)
                canvas.focus({ preventScroll: true });
            if (state.mode === 'walk' && !document.pointerLockElement && !this.dragLook)
                this.dragLook = { x: e.clientX, y: e.clientY, id: e.pointerId };
        });
        window.addEventListener('pointermove', (e) => {
            if (!this.dragLook || state.mode !== 'walk' || e.pointerId !== this.dragLook.id)
                return;
            this.addLook((e.clientX - this.dragLook.x) * 1.4, (e.clientY - this.dragLook.y) * 1.4);
            this.dragLook.x = e.clientX;
            this.dragLook.y = e.clientY;
        });
        const endDrag = (e) => {
            if (this.dragLook && e.pointerId === this.dragLook.id)
                this.dragLook = null;
        };
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
    }
    lockPointer() {
        const canvas = this.canvas;
        if (!canvas.requestPointerLock)
            return this.onLockFailed();
        try {
            const r = canvas.requestPointerLock();
            if (r && typeof r.catch === 'function')
                r.catch(() => this.onLockFailed());
        }
        catch {
            this.onLockFailed();
        }
    }
    onLockFailed() {
        if (this.pointerLockFailed)
            return;
        this.pointerLockFailed = true;
        events.emit('pointerlock-unavailable', {});
    }
    get mode() {
        return state.mode;
    }
    get isFlying() {
        return this.flight !== null;
    }
    /** Where the walker stands and which way they face (+z forward), or null when not walking. */
    walkerPose() {
        if (state.mode !== 'walk' || this.flight)
            return null;
        return { x: this.feet.x, y: this.feet.y, z: this.feet.z, ry: this.yaw + Math.PI };
    }
    /** Where others on Orb see you: walking, where you stand; exploring or in a flight, where the camera flies (fly: true). */
    visitorPose() {
        const walker = this.walkerPose();
        if (walker)
            return walker;
        const cam = this.engine.camera;
        cam.getWorldPosition(this.seen);
        cam.getWorldDirection(this.look);
        return { x: this.seen.x, y: this.seen.y, z: this.seen.z, ry: Math.atan2(this.look.x, this.look.z), fly: true };
    }
    /** Disable all camera input (e.g. while drawing on glass). */
    setEnabled(on) {
        this.enabled = on;
        this.orbit.enabled = on && state.mode === 'orbit' && !this.flight;
    }
    /** Virtual joystick input for touch devices, x = strafe, y = forward, in [-1, 1]. */
    setMoveInput(x, y) {
        this.moveInput.set(x, y);
    }
    addLook(dx, dy) {
        this.yaw -= dx * 0.0022;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
    }
    setMode(mode) {
        const cam = this.engine.camera;
        if (mode === 'walk') {
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            this.yaw = Math.atan2(-dir.x, -dir.z);
            this.pitch = THREE.MathUtils.clamp(Math.asin(dir.y), -0.6, 0.6);
            this.feet.set(cam.position.x, 0, cam.position.z);
            // if we are far above ground (aerial orbit), drop onto the ground under the orbit target
            const g = this.colliders.groundAt(this.feet.x, this.feet.z);
            if (cam.position.y - g > 6) {
                const t = this.orbit.target;
                this.feet.set(t.x, 0, t.z);
            }
            this.feet.y = this.colliders.groundAt(this.feet.x, this.feet.z, Infinity);
            this.orbit.enabled = false;
        }
        else {
            document.exitPointerLock?.();
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            this.orbit.target.copy(cam.position).addScaledVector(dir, 3);
            this.orbit.enabled = this.enabled;
        }
        state.setMode(mode);
    }
    /** Immediately place the camera. */
    teleport(pos, target) {
        this.flight = null;
        const cam = this.engine.camera;
        cam.position.copy(pos);
        cam.lookAt(target);
        this.orbit.target.copy(target);
        // orbit's polar clamp would pull upward views down; walk mode keeps the exact look
        if (state.mode === 'orbit')
            this.orbit.update();
        this.syncWalkFromCamera(target);
    }
    syncWalkFromCamera(target) {
        const cam = this.engine.camera;
        const dir = target.clone().sub(cam.position).normalize();
        this.yaw = Math.atan2(-dir.x, -dir.z);
        this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        this.feet.set(cam.position.x, cam.position.y - this.eyeHeight, cam.position.z);
        this.feet.y = this.colliders.groundAt(this.feet.x, this.feet.z, this.feet.y + 0.3);
    }
    /** Smoothly fly to a position/target. */
    flyTo(pos, target, opts = {}) {
        const cam = this.engine.camera;
        const dist = cam.position.distanceTo(pos);
        const duration = opts.duration ?? THREE.MathUtils.clamp(1.3 + dist / 420, 1.3, 4.8);
        // long hops arc up over the terrain; callers may ask for a flatter glide
        const arc = opts.arc ?? (dist > 120 ? Math.min(dist * 0.32, 420) : 0);
        const fromTarget = this.orbit.target.clone();
        if (state.mode === 'walk') {
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            fromTarget.copy(cam.position).addScaledVector(dir, 4);
        }
        return new Promise((resolve) => {
            this.flight?.resolve();
            this.flight = {
                fromPos: cam.position.clone(),
                fromTarget,
                toPos: pos.clone(),
                toTarget: target.clone(),
                t: 0,
                duration,
                arc,
                resolve,
            };
            this.orbit.enabled = false;
        });
    }
    resolveViewpoint(vp) {
        const pos = new THREE.Vector3(...vp.pos);
        const target = new THREE.Vector3(...vp.target);
        if (vp.terrainRelative) {
            pos.y += heightAt(pos.x, pos.z);
            if (!vp.targetAbsolute)
                target.y += heightAt(target.x, target.z);
        }
        return { pos, target };
    }
    goToViewpoint(id, opts = {}) {
        const vp = VIEWPOINTS.find((v) => v.id === id);
        if (!vp)
            return Promise.resolve();
        const { pos, target } = this.resolveViewpoint(vp);
        events.emit('viewpoint', { id });
        if (opts.instant) {
            this.teleport(pos, target);
            return Promise.resolve();
        }
        return this.flyTo(pos, target);
    }
    getLocation() {
        return this.location;
    }
    update(dt) {
        const cam = this.engine.camera;
        if (this.flight) {
            this.updateFlight(dt);
        }
        else if (state.mode === 'walk') {
            this.updateWalk(dt);
        }
        else {
            this.updateOrbit(dt);
        }
        // focus point for shadows / LOD
        if (state.mode === 'walk' || this.flight) {
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            this.engine.focus.copy(cam.position).addScaledVector(dir, state.inside ? 3 : 8);
        }
        else {
            this.engine.focus.copy(this.orbit.target);
        }
        this.updateInside();
        this.updateNear();
        this.locTimer -= dt;
        if (this.locTimer <= 0) {
            this.locTimer = 0.25;
            this.updateLocation();
        }
    }
    updateFlight(dt) {
        const f = this.flight;
        const cam = this.engine.camera;
        f.t = Math.min(1, f.t + dt / f.duration);
        const e = easeInOut(f.t);
        cam.position.lerpVectors(f.fromPos, f.toPos, e);
        cam.position.y += Math.sin(Math.PI * e) * f.arc;
        const tgt = new THREE.Vector3().lerpVectors(f.fromTarget, f.toTarget, THREE.MathUtils.smoothstep(e, 0.0, 0.85));
        cam.lookAt(tgt);
        if (f.t >= 1) {
            this.flight = null;
            this.orbit.target.copy(f.toTarget);
            this.syncWalkFromCamera(f.toTarget);
            if (state.mode === 'orbit') {
                this.orbit.enabled = this.enabled;
                this.orbit.update();
            }
            f.resolve();
        }
    }
    moveVector() {
        const v = new THREE.Vector2(this.moveInput.x, this.moveInput.y);
        const k = this.keys;
        if (k.has('KeyW') || k.has('ArrowUp'))
            v.y += 1;
        if (k.has('KeyS') || k.has('ArrowDown'))
            v.y -= 1;
        if (k.has('KeyA') || k.has('ArrowLeft'))
            v.x -= 1;
        if (k.has('KeyD') || k.has('ArrowRight'))
            v.x += 1;
        if (v.lengthSq() > 1)
            v.normalize();
        return v;
    }
    updateOrbit(dt) {
        const cam = this.engine.camera;
        const t = this.orbit.target;
        const inside = this.isInsideHouse(t);
        // outdoors the views may look up to ~60° (the aurora climbs high over the Teeth)
        this.orbit.maxPolarAngle = inside ? Math.PI * 0.92 : Math.PI * 0.83;
        this.orbit.minDistance = inside ? 0.25 : 0.6;
        if (this.enabled) {
            const mv = this.moveVector();
            if (mv.lengthSq() > 0) {
                const dist = cam.position.distanceTo(t);
                const speed = THREE.MathUtils.clamp(dist * 0.7, 1.5, 600) * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1);
                const fwd = new THREE.Vector3();
                cam.getWorldDirection(fwd);
                fwd.y = 0;
                fwd.normalize();
                const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
                const delta = fwd.multiplyScalar(mv.y * speed * dt).addScaledVector(right, mv.x * speed * dt);
                t.add(delta);
                cam.position.add(delta);
            }
        }
        this.orbit.update();
        // never dip below the ground
        const g = this.colliders.groundAt(cam.position.x, cam.position.z, cam.position.y + 0.5);
        if (cam.position.y < g + 0.35)
            cam.position.y = g + 0.35;
    }
    updateWalk(dt) {
        const cam = this.engine.camera;
        const mv = this.enabled ? this.moveVector() : new THREE.Vector2();
        const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
        const fromHouse = Math.hypot(this.feet.x - HOUSE.x, this.feet.z - HOUSE.z);
        const hike = 1 + THREE.MathUtils.clamp((fromHouse - 60) / 180, 0, 3);
        const speed = this.walkSpeed * (run ? this.runMultiplier * hike : 1);
        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const desired = fwd.multiplyScalar(mv.y * speed).addScaledVector(right, mv.x * speed);
        this.vel.lerp(desired, Math.min(1, dt * 10));
        const next = this.feet.clone().addScaledVector(this.vel, dt);
        this.colliders.resolve(next, 0.28, 1.7);
        const ground = this.colliders.groundAt(next.x, next.z, this.feet.y);
        if (ground - this.feet.y > this.colliders.stepUp || ground < SEA_LEVEL - 0.25) {
            // too high to step onto, or open water: stay put horizontally
            next.x = this.feet.x;
            next.z = this.feet.z;
            next.y = this.feet.y;
        }
        else {
            next.y = ground;
        }
        // smooth vertical motion (stairs, terrain)
        const moved = Math.hypot(next.x - this.feet.x, next.z - this.feet.z) / Math.max(dt, 1e-4);
        this.feet.x = next.x;
        this.feet.z = next.z;
        this.feet.y += (next.y - this.feet.y) * Math.min(1, dt * 14);
        // footfalls: ~2 steps/s walking, up to ~3.4 running; the bob is one step per half period
        const moving = Math.min(this.vel.length(), moved);
        const rate = moving < 0.25 ? 0 : THREE.MathUtils.clamp(1.15 + moving * 0.6, 1.7, 3.4);
        const prev = this.bob;
        this.bob += rate * dt;
        if (rate > 0 && Math.floor(this.bob) !== Math.floor(prev)) {
            events.emit('walk:step', { surface: this.surfaceAt(this.feet.x, this.feet.z, this.feet.y), speed: moving, left: Math.floor(this.bob) % 2 === 0 });
        }
        const snow = state.inside ? 0.014 : 0.024;
        const bobY = Math.sin(this.bob * Math.PI) * snow * Math.min(1, moving / 1.5);
        cam.position.set(this.feet.x, this.feet.y + this.eyeHeight + bobY, this.feet.z);
        const look = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        cam.quaternion.setFromEuler(look);
    }
    /** What the ground at (x, z) is made of, for a walker with feet at `feetY`. */
    surfaceAt(x, z, feetY) {
        if (state.inside)
            return 'wood';
        const lx = x - HOUSE.x;
        const lz = z - HOUSE.z;
        const d = HOUSE.deck;
        if (lx >= d.minX && lx <= d.maxX && lz >= d.minZ - 0.6 && lz <= d.maxZ && feetY > HOUSE.floorY - 0.8)
            return 'wood';
        const terrain = heightAt(x, z);
        // boardwalks, jetties, the sauna deck: a walkable floor above the terrain
        if (feetY - terrain > 0.12 && Math.abs(this.colliders.groundAt(x, z, feetY) - feetY) < 0.3)
            return 'wood';
        if (onLake(x, z, -2) && feetY < LAKE.y + 0.4)
            return 'ice';
        const path = pathAt(x, z, 0.3);
        if (path === 'boardwalk')
            return 'wood';
        if (path)
            return 'packed';
        if (Math.hypot(x - VILLAGE.center.x, z - VILLAGE.center.z) < VILLAGE.radius * 0.7)
            return 'packed';
        return 'snow';
    }
    /** Inside the cabin or its glass wing (between the floor and the roof). */
    isInsideHouse(p) {
        const lx = p.x - HOUSE.x;
        const lz = p.z - HOUSE.z;
        if (houseZoneAt(lx, lz) === null)
            return false;
        const ly = p.y - HOUSE.floorY;
        return ly > -0.6 && ly < roofHeightLocal(lx, lz);
    }
    updateInside() {
        const p = this.engine.camera.position;
        const inside = this.isInsideHouse(p);
        if (inside !== state.inside)
            state.inside = inside;
        state.room = inside ? houseZoneAt(p.x - HOUSE.x, p.z - HOUSE.z) : null;
    }
    updateNear() {
        const cam = this.engine.camera;
        let near;
        if (state.inside)
            near = 0.05;
        else if (state.mode === 'walk' && !this.flight)
            near = 0.22;
        else {
            const ground = this.colliders.groundAt(cam.position.x, cam.position.z);
            const alt = Math.max(0, cam.position.y - ground);
            const dist = this.flight ? alt : cam.position.distanceTo(this.orbit.target);
            near = THREE.MathUtils.clamp(Math.min(dist, alt + 1) * 0.004, 0.05, 6);
            if (this.isInsideHouse(this.orbit.target) && !this.flight)
                near = Math.min(near, 0.05);
        }
        if (Math.abs(cam.near - near) > 1e-3) {
            cam.near = near;
            cam.updateProjectionMatrix();
        }
    }
    updateLocation() {
        const p = this.engine.camera.position;
        let id = 'overview';
        if (state.inside) {
            id = state.room === 'glasswing' ? 'glasswing' : 'living';
        }
        else {
            const g = heightAt(p.x, p.z);
            const alt = p.y - Math.max(g, SEA_LEVEL);
            const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
            const lx = p.x - HOUSE.x;
            const lz = p.z - HOUSE.z;
            const deck = HOUSE.deck;
            if (alt > 140)
                id = 'overview';
            else if (lx >= deck.minX - 0.4 && lx <= deck.maxX && lz >= deck.minZ - 0.6 && lz <= deck.maxZ && p.y - HOUSE.floorY < 5)
                id = 'deck';
            else if (near(HOUSE.x, HOUSE.z, 34))
                id = 'cabin';
            else if (near(SPRING.x, SPRING.z, 45))
                id = 'spring';
            else if (near(SAUNA.x, SAUNA.z, 34))
                id = 'sauna';
            else if (onLake(p.x, p.z, 30))
                id = 'lake';
            else if (near(FOX_PEAK.x, FOX_PEAK.z, 130))
                id = 'summit';
            else if (near(VILLAGE.harbor.x, VILLAGE.harbor.z, 95) && p.y < 30)
                id = 'harbor';
            else if (near(VILLAGE.center.x, VILLAGE.center.z, VILLAGE.radius + 60))
                id = 'village';
            else if (near(BEACH.center.x, BEACH.center.z, BEACH.halfLength + 90))
                id = 'beach';
            else if (g < SEA_LEVEL - 0.5)
                id = p.x > -1300 && p.z < -80 ? 'fjord' : 'sea';
            else {
                const path = pathAt(p.x, p.z, 4);
                if (path === 'plowed')
                    id = 'road';
                else if (path === 'trail')
                    id = 'trail';
                else if (path)
                    id = 'path';
                else if (g > 320)
                    id = 'fells';
                else if (g < 10)
                    id = 'shore';
                else
                    id = 'snowfield';
            }
        }
        if (id !== this.location.id) {
            this.location = { id, label: LOCATION_LABELS[id] ?? id };
            state.location = id;
            events.emit('location', this.location);
        }
    }
}
function isTyping(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
