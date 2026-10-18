/**
 * Island map of Foxfire Fjord: a round corner map (north up, the live camera
 * position and heading, the fox when it is about) and a large map overlay
 * where a click flies the camera there, snapping to named places. The
 * raster (snow, rock, woods, lake and fjord ice, contours) is drawn in
 * slices once the features have loaded; paths, the rink and labels are SVG
 * and DOM on top.
 */
import * as THREE from 'three';
import { PATHS, SPRING, FOX_PEAK, VILLAGE, BEACH, LAKE, HOUSE, SAUNA, RINK, VIEWPOINTS } from '../world/layout.js';
import { samplePath } from '../world/paths.js';
import { el, button, ICON, store, clamp, isCompact } from './dom.js';
import { renderMapRows, landBounds, squareRect, forestCover, finishForest } from './map-render.js';
const POIS = [
    { id: 'cabin', vp: 'cabin', x: HOUSE.x, z: HOUSE.z, label: 'Aurora Cabin', major: true, side: 'b', warm: true },
    { id: 'spring', vp: 'spring', x: SPRING.x, z: SPRING.z, label: 'Hot spring', major: true, side: 't', warm: true },
    { id: 'lake', vp: 'lake', x: LAKE.x + 40, z: LAKE.z + 10, label: 'Mirror Lake', major: true, side: 'b' },
    { id: 'sauna', vp: 'sauna', x: SAUNA.x, z: SAUNA.z, label: 'Sauna', major: false, side: 't', warm: true },
    { id: 'summit', vp: 'summit', x: FOX_PEAK.x, z: FOX_PEAK.z, label: 'Fox Peak', major: true, side: 'r' },
    { id: 'village', vp: 'village', x: VILLAGE.center.x, z: VILLAGE.center.z, label: 'Lysvik', major: true, side: 'b', warm: true },
    { id: 'harbor', vp: 'harbor', x: VILLAGE.harbor.x, z: VILLAGE.harbor.z, label: 'Harbour', major: false, side: 'l' },
    { id: 'beach', vp: 'beach', x: BEACH.center.x, z: BEACH.center.z, label: 'Ice Beach', major: true, side: 'r' },
    { id: 'fjord', x: 260, z: -560, label: 'The fjord', major: false, side: 'r', area: true },
    { id: 'teeth', x: 380, z: -2020, label: 'The Teeth', major: false, side: 'r', area: true, land: true },
    { id: 'sea', x: -1900, z: -300, label: 'Norwegian Sea', major: false, side: 'r', area: true },
];
/** signed depth inside Mirror Lake's ellipse (m, > 0 inside) */
function lakeDepth(x, z) {
    const dx = x - LAKE.x;
    const dz = z - LAKE.z;
    const c = Math.cos(LAKE.rot);
    const s = Math.sin(LAKE.rot);
    const u = (dx * c + dz * s) / LAKE.rx;
    const v = (-dx * s + dz * c) / LAKE.rz;
    return (1 - Math.sqrt(u * u + v * v)) * Math.min(LAKE.rx, LAKE.rz);
}
/** One rendering of the map (the round corner map or the large overlay map). */
class MapPane {
    view;
    frame;
    canvas;
    marker;
    fox;
    lastU = NaN;
    lastW = NaN;
    lastH = NaN;
    constructor(view, cls, large, onPoi) {
        this.view = view;
        this.frame = el('div', `map-pane ${cls}`);
        const w = view.maxX - view.minX;
        const h = view.maxZ - view.minZ;
        this.frame.style.setProperty('--map-ar', (w / h).toFixed(4));
        this.canvas = el('canvas', 'map-pane__raster');
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'map-pane__paths');
        svg.setAttribute('viewBox', `${view.minX} ${view.minZ} ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        // the cleared rink on the lake
        const rink = document.createElementNS(svgNS, 'ellipse');
        rink.setAttribute('cx', String(RINK.x));
        rink.setAttribute('cy', String(RINK.z));
        rink.setAttribute('rx', String(RINK.rx));
        rink.setAttribute('ry', String(RINK.rz));
        rink.setAttribute('transform', `rotate(${((RINK.rot * 180) / Math.PI).toFixed(2)} ${RINK.x} ${RINK.z})`);
        rink.setAttribute('class', 'map-rink');
        svg.appendChild(rink);
        for (const p of PATHS) {
            const pts = samplePath(p, 8)
                .map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`)
                .join(' ');
            const line = document.createElementNS(svgNS, 'polyline');
            line.setAttribute('points', pts);
            line.setAttribute('class', `map-path map-path--${p.kind}`);
            svg.appendChild(line);
        }
        const labels = el('div', 'map-pane__labels');
        for (const p of POIS) {
            if (!large && !p.major)
                continue;
            const tag = p.vp && large ? 'button' : 'div';
            const l = el(tag, `map-poi map-poi--${p.side}${p.major ? '' : ' map-poi--minor'}${p.vp ? '' : ' map-poi--static'}${p.area ? ' map-poi--area' : ''}${p.land ? ' map-poi--land' : ''}${p.warm ? ' map-poi--warm' : ''}`);
            l.innerHTML = `<i></i><span>${p.label}</span>`;
            l.style.left = `${((p.x - view.minX) / w) * 100}%`;
            l.style.top = `${((p.z - view.minZ) / h) * 100}%`;
            if (p.vp && large) {
                l.type = 'button';
                l.title = `Fly to ${p.label}`;
                l.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onPoi(p);
                });
            }
            labels.appendChild(l);
        }
        this.fox = el('div', 'map-fox', `${ICON.fox}`);
        this.fox.title = 'The arctic fox';
        this.marker = el('div', 'map-marker', `<svg class="map-marker__cone" viewBox="-24 -24 48 48" aria-hidden="true"><defs><radialGradient id="mmc${large ? 'L' : 'S'}" cx="0" cy="0" r="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6ef2b0" stop-opacity="0.6"/><stop offset="1" stop-color="#6ef2b0" stop-opacity="0"/></radialGradient></defs><path d="M0 0 L-12 -21 A24 24 0 0 1 12 -21 Z" fill="url(#mmc${large ? 'L' : 'S'})"/></svg><span class="map-marker__dot"></span>`);
        this.frame.append(this.canvas, svg, labels, this.fox, this.marker);
    }
    /** Copy the raster in, halving it step by step down to ~2× the pane's size (no shimmer when small). */
    setRaster(src, maxSize = Infinity) {
        let img = src;
        while (img.width / 2 >= maxSize) {
            const half = document.createElement('canvas');
            half.width = Math.round(img.width / 2);
            half.height = Math.round(img.height / 2);
            const c = half.getContext('2d');
            c.imageSmoothingQuality = 'high';
            c.drawImage(img, 0, 0, half.width, half.height);
            img = half;
        }
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.canvas.getContext('2d').drawImage(img, 0, 0);
        this.frame.classList.add('is-ready');
    }
    uv(x, z) {
        const v = this.view;
        return [clamp((x - v.minX) / (v.maxX - v.minX), -0.02, 1.02), clamp((z - v.minZ) / (v.maxZ - v.minZ), -0.02, 1.02)];
    }
    setMarker(x, z, headingDeg) {
        const [u, w] = this.uv(x, z);
        const qu = (u * 400) | 0;
        const qw = (w * 400) | 0;
        const qh = Math.round(headingDeg / 2);
        if (qu === this.lastU && qw === this.lastW && qh === this.lastH)
            return;
        this.lastU = qu;
        this.lastW = qw;
        this.lastH = qh;
        this.marker.style.left = `${u * 100}%`;
        this.marker.style.top = `${w * 100}%`;
        this.marker.style.setProperty('--rot', `${headingDeg.toFixed(1)}deg`);
    }
    setFox(p) {
        this.fox.classList.toggle('is-on', !!p);
        if (!p)
            return;
        const [u, w] = this.uv(p.x, p.z);
        this.fox.style.left = `${(u * 100).toFixed(2)}%`;
        this.fox.style.top = `${(w * 100).toFixed(2)}%`;
    }
    worldAt(clientX, clientY) {
        const r = this.frame.getBoundingClientRect();
        const v = this.view;
        const u = (clientX - r.left) / r.width;
        const w = (clientY - r.top) / r.height;
        return { x: v.minX + u * (v.maxX - v.minX), z: v.minZ + w * (v.maxZ - v.minZ), mpp: (v.maxX - v.minX) / r.width };
    }
}
export class IslandMap {
    ctx;
    toast;
    mini;
    overlay;
    view;
    small;
    large;
    readout;
    raster = null;
    visible;
    open = false;
    dir = new THREE.Vector3();
    foxTimer = 0;
    onOpenChange = () => { };
    constructor(ctx, toast) {
        this.ctx = ctx;
        this.toast = toast;
        const w = ctx.world;
        this.view = squareRect(landBounds(w.heightGrid, w.gridNX, w.gridNZ, w.bounds, 140));
        const goPoi = (p) => {
            if (p.vp) {
                this.close();
                ctx.controls.goToViewpoint(p.vp);
            }
        };
        this.small = new MapPane(this.view, 'map-pane--mini', false, goPoi);
        this.large = new MapPane(this.view, 'map-pane--large', true, goPoi);
        this.mini = el('div', 'minimap');
        const miniBtn = el('button', 'minimap__hit');
        miniBtn.type = 'button';
        miniBtn.title = 'Island map — click to enlarge (M hides)';
        miniBtn.setAttribute('aria-label', 'Open the island map');
        miniBtn.addEventListener('click', (e) => {
            this.openLarge();
            if (e.detail > 0)
                miniBtn.blur();
        });
        const ring = el('div', 'minimap__ring', '<span class="minimap__n">N</span>');
        const exp = el('span', 'minimap__expand', ICON.expand);
        this.mini.append(this.small.frame, ring, exp, miniBtn);
        this.overlay = el('div', 'mapview');
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-label', 'Island map');
        const sheet = el('div', 'mapview__sheet');
        const head = el('div', 'mapview__head', `<div class="mapview__title"><span class="mapview__kicker">69° 18′ N</span><span class="mapview__name">Island map</span></div>
       <div class="mapview__hint">${isCompact() ? 'Tap a place to fly there' : 'Click anywhere to fly there · places snap to their views'}</div>`);
        const close = button('icon-btn mapview__close', ICON.close, 'Close map (Esc)', () => this.close());
        head.appendChild(close);
        const body = el('div', 'mapview__body');
        const scaleM = 500;
        const scale = el('div', 'mapview__scale', `<i></i><span>${scaleM} m</span>`);
        const north = el('div', 'mapview__north', '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M10 2 L15 16 L10 13 L5 16 Z"/></svg><span>N</span>');
        const legend = el('div', 'mapview__legend', `<span><i class="lg lg--road"></i>Road</span><span><i class="lg lg--path"></i>Path</span><span><i class="lg lg--trail"></i>Trail</span><span><i class="lg lg--wood"></i>Spruce</span><span><i class="lg lg--ice"></i>Ice</span>`);
        this.readout = el('div', 'mapview__readout', '');
        body.append(this.large.frame, scale, north, legend, this.readout);
        sheet.append(head, body);
        this.overlay.append(sheet);
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay)
                this.close();
        });
        this.large.frame.addEventListener('click', (e) => {
            const p = this.large.worldAt(e.clientX, e.clientY);
            this.flyToWorld(p.x, p.z, p.mpp * 16);
        });
        this.large.frame.addEventListener('pointermove', (e) => {
            const p = this.large.worldAt(e.clientX, e.clientY);
            const h = ctx.world.heightAt(p.x, p.z);
            const poi = this.nearestPoi(p.x, p.z, p.mpp * 16);
            let what;
            let val;
            if (poi) {
                what = poi.label;
                val = `${Math.max(0, Math.round(h))} m`;
            }
            else if (h < 0) {
                const ice = this.iceAt(p.x, p.z);
                what = ice && ice.fast > 0.5 ? 'Fast ice' : ice && ice.drift > 0.35 ? 'Drift ice' : p.x > -1300 && p.z < -80 ? 'The fjord' : 'Open sea';
                val = `${Math.round(-h)} m deep`;
            }
            else if (Math.abs(h - LAKE.y) < 0.25 && lakeDepth(p.x, p.z) > 0) {
                what = 'Mirror Lake ice';
                val = `${Math.round(h)} m`;
            }
            else {
                what = 'Elevation';
                val = `${Math.round(h)} m`;
            }
            this.readout.innerHTML = `<span>${what}</span><b>${val}</b>`;
            this.readout.classList.add('is-on');
            const px = scaleM / p.mpp;
            scale.style.setProperty('--w', `${px.toFixed(1)}px`);
        });
        this.large.frame.addEventListener('pointerleave', () => this.readout.classList.remove('is-on'));
        const ro = new ResizeObserver(() => {
            const r = this.large.frame.getBoundingClientRect();
            if (r.width > 0)
                scale.style.setProperty('--w', `${((scaleM / (this.view.maxX - this.view.minX)) * r.width).toFixed(1)}px`);
        });
        ro.observe(this.large.frame);
        const saved = store.get('minimap');
        this.visible = saved === null ? !isCompact() : saved === '1';
        this.mini.classList.toggle('is-hidden', !this.visible);
        // the raster waits for the features (sea ice, the forest), then draws in slices
        ctx.events.once('features-ready', () => window.setTimeout(() => this.renderRaster(), 400));
    }
    iceAt(x, z) {
        const api = this.ctx.getFeature('ocean')?.api;
        try {
            return api?.iceAt ? api.iceAt(x, z) : null;
        }
        catch {
            return null;
        }
    }
    renderRaster() {
        const ctx = this.ctx;
        const w = ctx.world;
        const v = this.view;
        // phones (low quality) get a lighter raster: fewer slices right after load
        const W = ctx.quality.name === 'low' && Math.min(window.innerWidth, window.innerHeight) < 600 ? 520 : 720;
        const H = Math.round((W * (v.maxZ - v.minZ)) / (v.maxX - v.minX));
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const c2d = canvas.getContext('2d');
        const img = c2d.createImageData(W, H);
        const ocean = ctx.getFeature('ocean')?.api;
        const extras = { lake: { depth: lakeDepth, y: LAKE.y } };
        if (ocean?.iceAt) {
            const ice = ocean.iceAt.bind(ocean);
            extras.iceAt = (x, z) => {
                try {
                    return ice(x, z);
                }
                catch {
                    return { fast: 0, drift: 0 };
                }
            };
        }
        // the forest, gathered in square tiles (each tree counted once)
        const flora = ctx.getFeature('flora')?.api;
        const tiles = [];
        const T = 220;
        if (flora?.treesNear) {
            for (let z = v.minZ; z < v.maxZ; z += T)
                for (let x = v.minX; x < v.maxX; x += T)
                    tiles.push([x, z]);
        }
        const acc = tiles.length ? new Float32Array(W * H) : null;
        let tile = 0;
        let row = 0;
        const step = () => {
            if (acc && tile < tiles.length) {
                const end = Math.min(tiles.length, tile + 24);
                for (; tile < end; tile++) {
                    const [x0, z0] = tiles[tile];
                    let trees = [];
                    try {
                        trees = flora.treesNear(x0 + T / 2, z0 + T / 2, T * 0.7072).filter((t) => t.x >= x0 && t.x < x0 + T && t.z >= z0 && t.z < z0 + T);
                    }
                    catch {
                        trees = [];
                    }
                    forestCover(trees, v, W, H, acc);
                }
                if (tile >= tiles.length)
                    extras.forest = finishForest(acc, W, H);
                setTimeout(step, 0);
                return;
            }
            const end = Math.min(H, row + 64);
            renderMapRows(w.heightGrid, w.gridNX, w.gridNZ, w.bounds, v, W, H, img.data, row, end, extras);
            row = end;
            if (row < H) {
                setTimeout(step, 0);
                return;
            }
            c2d.putImageData(img, 0, 0);
            this.raster = canvas;
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
            const css = Math.max(this.mini.offsetWidth, 11.6 * rem);
            this.small.setRaster(canvas, Math.round(css * Math.min(2, window.devicePixelRatio || 1) * 1.25));
            this.large.setRaster(canvas);
        };
        setTimeout(step, 0);
    }
    get isOpen() {
        return this.open;
    }
    get isVisible() {
        return this.visible;
    }
    toggleMini(force) {
        this.visible = force ?? !this.visible;
        this.mini.classList.toggle('is-hidden', !this.visible);
        store.set('minimap', this.visible ? '1' : '0');
    }
    openLarge() {
        if (this.open)
            return;
        this.open = true;
        document.exitPointerLock?.();
        this.overlay.classList.add('is-open');
        this.foxTimer = 0;
        this.onOpenChange(true);
    }
    close() {
        if (!this.open)
            return;
        this.open = false;
        this.overlay.classList.remove('is-open');
        this.readout.classList.remove('is-on');
        this.onOpenChange(false);
    }
    nearestPoi(x, z, radius) {
        let best = null;
        let bd = radius;
        for (const p of POIS) {
            if (!p.vp)
                continue;
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < bd) {
                bd = d;
                best = p;
            }
        }
        return best;
    }
    /** Fly the camera to a world position picked on the map. */
    flyToWorld(x, z, snap = 40) {
        const { controls, world, camera, state, colliders } = this.ctx;
        // a jump on the map lets the fox go
        try {
            this.ctx.getFeature('fox')?.api?.follow?.(false);
        }
        catch {
            /* no fox */
        }
        const poi = this.nearestPoi(x, z, snap);
        if (poi?.vp && VIEWPOINTS.some((v) => v.id === poi.vp)) {
            this.close();
            controls.goToViewpoint(poi.vp);
            return;
        }
        const ground = world.heightAt(x, z);
        camera.getWorldDirection(this.dir);
        this.dir.y = 0;
        if (this.dir.lengthSq() < 1e-6)
            this.dir.set(0, 0, -1);
        this.dir.normalize();
        if (state.mode === 'walk') {
            if (ground < 0.4) {
                this.toast('That is open water — pick a spot on land to walk to', 2600);
                return;
            }
            this.close();
            const g = colliders.groundAt(x, z);
            const eye = new THREE.Vector3(x, g + 1.62, z);
            const target = eye.clone().addScaledVector(this.dir, 10);
            controls.flyTo(eye, target);
            return;
        }
        this.close();
        const target = new THREE.Vector3(x, Math.max(0, ground) + 2, z);
        const eye = target.clone().addScaledVector(this.dir, -120);
        eye.y += 70;
        eye.y = Math.max(eye.y, world.heightAt(eye.x, eye.z) + 30);
        controls.flyTo(eye, target);
    }
    update() {
        if (!this.raster || (!this.visible && !this.open))
            return;
        const cam = this.ctx.camera;
        cam.getWorldDirection(this.dir);
        const heading = (Math.atan2(this.dir.x, -this.dir.z) * 180) / Math.PI;
        if (this.visible)
            this.small.setMarker(cam.position.x, cam.position.z, heading);
        if (this.open)
            this.large.setMarker(cam.position.x, cam.position.z, heading);
        // the fox moves slowly: a few updates a second are plenty
        if (--this.foxTimer <= 0) {
            this.foxTimer = 15;
            const api = this.ctx.getFeature('fox')?.api;
            let p = null;
            try {
                p = api?.position?.() ?? null;
            }
            catch {
                p = null;
            }
            if (this.visible)
                this.small.setFox(p);
            if (this.open)
                this.large.setFox(p);
        }
    }
}
