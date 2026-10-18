import { events } from '../core/events.js';
import { state } from '../core/state.js';
import { params } from '../core/params.js';
import { HOUSE, VIEWPOINTS } from '../world/layout.js';
import { el, button, ICON, brandMark, iconFor, isTypingTarget, isTouchFirst, isCompact, store, fmtTemp, clamp } from './dom.js';
import { TimeDirector } from './time-director.js';
import { TimeBar } from './timebar.js';
import { IslandMap } from './minimap.js';
import { Tour, findFox } from './tour.js';
import { Intro } from './intro.js';
import { WalkUX } from './walk.js';
import { Ambience } from './sound.js';
import { Settings, Help } from './panels.js';
import { uiParams } from './ui-params.js';
import { airTemperature, auroraWords } from './sun-model.js';
/** CameraRig location id → the Places entry it lights up */
const LOCATION_VIEW = {
    overview: 'overview',
    cabin: 'cabin',
    living: 'living',
    glasswing: 'glasswing',
    deck: 'deck',
    lake: 'lake',
    sauna: 'sauna',
    spring: 'spring',
    village: 'village',
    harbor: 'harbor',
    beach: 'beach',
    summit: 'summit',
};
/** an icon for each place in the list */
const PLACE_ICON = {
    overview: 'mountain',
    cabin: 'cabin',
    living: 'flame',
    glasswing: 'bed',
    deck: 'tub',
    lake: 'lake',
    sauna: 'sauna',
    spring: 'spring',
    village: 'village',
    harbor: 'harbor',
    beach: 'beach',
    summit: 'peak',
};
/** shorter or clearer names in the list than the viewpoint labels */
const PLACE_LABEL = { overview: 'The whole island' };
/** places menu sections: the island, the cabin's rooms, out and about (indices keep the 1–9 shortcuts in order) */
const PLACE_BREAKS = new Set(['living', 'lake']);
const GROUP_ORDER = ['house', 'feature'];
/** the cabin controls stay in the dock within this distance of the cabin (yard, fire pit, deck) */
const NEAR_HOUSE = 130;
/** minimum seconds between "the aurora is breaking up" notes */
const BREAKUP_NOTE_GAP = 240;
export class Hud {
    root;
    rig = null;
    sky = null;
    onQualityChange = () => { };
    time = null;
    timebar = null;
    map = null;
    tour = null;
    intro = null;
    walk = null;
    sound = null;
    settings;
    help;
    host;
    ctx = null;
    loading;
    loadBar;
    loadLabel;
    tooltip;
    card;
    cardTick = null;
    toastEl;
    restoreBtn;
    locName;
    locMeta;
    locWrap;
    places;
    placeBtns = new Map();
    toolbar;
    tourBtn;
    mapBtn;
    soundBtn;
    settingsBtn;
    controlsHost;
    modeBtns;
    timeSlot;
    mapSlot;
    controls = [];
    stats = null;
    toastTimer = 0;
    locTimer = 0;
    pendingSpeed = null;
    quality = 'medium';
    visible;
    day = false;
    inside = false;
    near = false;
    slowTimer = 0;
    hoverLabel = null;
    locationId = 'overview';
    lastPhase = '';
    lastBreakupNote = -Infinity;
    breakupNotes = 0;
    clock = 0;
    captured = false;
    /** phones: the cabin's controls fold behind one button */
    cabinOpen = false;
    constructor(host, visible) {
        this.host = host;
        this.visible = visible;
        this.root = el('div', 'hud');
        if (!visible) {
            this.root.classList.add('hud--hidden');
            // screenshots without ?ui=1 must show the scene only
            host.classList.add(params.shot ? 'ui--shot' : 'ui--bare');
            state.uiVisible = false;
        }
        host.appendChild(this.root);
        this.loading = el('div', 'loading', `<div class="loading__sky" aria-hidden="true"><i class="loading__stars"></i><i class="loading__ribbon"></i><i class="loading__ribbon loading__ribbon--b"></i><i class="loading__rays"></i></div>
       <div class="loading__inner">
         ${brandMark('loading__mark')}
         <h1 class="loading__title">Foxfire Fjord</h1>
         <p class="loading__sub">a glass cabin under the northern lights</p>
         <div class="loading__bar" role="progressbar" aria-label="Loading"><i></i></div>
         <div class="loading__label" aria-live="polite">lighting the stove</div>
       </div>`);
        host.appendChild(this.loading);
        this.loadBar = this.loading.querySelector('.loading__bar i');
        this.loadLabel = this.loading.querySelector('.loading__label');
        this.tooltip = el('div', 'tooltip');
        host.appendChild(this.tooltip);
        this.toastEl = el('div', 'toast');
        this.toastEl.setAttribute('role', 'status');
        host.appendChild(this.toastEl);
        this.restoreBtn = button('hud-restore', `${ICON.eye}<span>Show interface</span>`, 'Show the interface (H)', () => this.setVisible(true));
        host.appendChild(this.restoreBtn);
        this.card = el('aside', 'card');
        this.card.setAttribute('aria-live', 'polite');
        this.help = new Help();
        host.appendChild(this.help.root);
        this.settings = new Settings({
            quality: () => this.quality,
            setQuality: (q) => {
                this.onQualityChange(q);
                this.setQualityName(q);
            },
            sound: () => !!this.sound?.enabled,
            soundSupported: () => this.sound?.supported ?? false,
            toggleSound: () => this.toggleSound(),
            volume: () => this.sound?.volume ?? 0.8,
            setVolume: (v) => this.sound?.setVolume(v),
            minimap: () => !!this.map?.isVisible,
            toggleMinimap: () => this.map?.toggleMini(),
            hideUI: () => this.setVisible(false),
            showHelp: () => this.help.show(),
        });
        this.buildTop();
        this.buildPlaces();
        this.buildBottom();
        this.root.appendChild(this.card);
        this.root.appendChild(this.settings.root);
        this.bindKeys();
        events.on('location', (l) => this.setLocation(l));
        events.on('time-changed', ({ hours }) => this.syncTime(hours));
        events.on('mode-changed', () => this.syncMode());
        document.addEventListener('pointerlockchange', () => this.syncMode());
        this.settings.onOpenChange = (o) => {
            this.settingsBtn.classList.toggle('is-active', o);
            this.root.classList.toggle('hud--settings', o);
        };
        this.help.onOpenChange = (o) => this.root.classList.toggle('hud--help', o);
    }
    /* ---------------- loading ---------------- */
    setLoading(fraction, label) {
        this.loadBar.style.transform = `scaleX(${clamp(fraction, 0, 1).toFixed(3)})`;
        this.loadLabel.textContent = label;
    }
    hideLoading() {
        if (params.shot)
            this.loading.remove();
        else {
            this.loading.classList.add('loading--done');
            setTimeout(() => this.loading.remove(), 1800);
        }
        this.afterLoad();
    }
    /* ---------------- wiring ---------------- */
    /** Connect the interface to the running world (called once by main after the context exists). */
    attach(ctx) {
        if (this.ctx)
            return;
        this.ctx = ctx;
        this.rig = this.rig ?? ctx.controls;
        this.sky = this.sky ?? ctx.sky;
        const time = new TimeDirector(ctx.sky);
        this.time = time;
        if (this.pendingSpeed !== null)
            time.syncFromSky();
        this.timebar = new TimeBar(time, ctx.sky, (t, ms, icon) => this.toast(t, ms, icon));
        this.timeSlot.appendChild(this.timebar.root);
        this.timebar.sync(ctx.sky.hours);
        this.timebar.onSheetChange = (o) => this.root.classList.toggle('hud--timesheet', o);
        this.map = new IslandMap(ctx, (t, ms) => this.toast(t, ms));
        this.mapSlot.appendChild(this.map.mini);
        this.root.appendChild(this.map.overlay);
        this.map.onOpenChange = (o) => {
            this.root.classList.toggle('hud--mapopen', o);
            this.mapBtn.classList.toggle('is-active', o);
        };
        this.tour = new Tour(ctx, time);
        this.root.appendChild(this.tour.root);
        this.tour.onActiveChange = (a) => {
            this.root.classList.toggle('hud--tour', a);
            this.tourBtn.classList.toggle('is-active', a);
            if (a) {
                this.hideCard();
                this.map?.close();
                this.settings.close();
                this.timebar?.closeSheet();
            }
        };
        this.intro = new Intro(ctx, time);
        this.root.appendChild(this.intro.root);
        this.intro.onStateChange = (a) => this.root.classList.toggle('hud--intro', a);
        this.intro.onEnd = (skipped) => {
            this.scheduleCapture(skipped ? 2.5 : 3.5);
            if (store.get('visited') !== '1') {
                store.set('visited', '1');
                const touch = isTouchFirst();
                window.setTimeout(() => this.toast(touch ? 'Drag to look around · tap things to read about them · the compass starts a guided tour' : 'Drag to look around · click things to read about them · G starts a guided tour', 7000), 900);
            }
        };
        this.walk = new WalkUX(ctx, uiParams.touch);
        this.host.appendChild(this.walk.crosshair);
        this.root.append(this.walk.prompt, this.walk.hint, this.walk.zone);
        this.walk.onTouchModeChange = (tw) => this.root.classList.toggle('hud--touchwalk', tw);
        this.sound = new Ambience(ctx, { controlActive: (id) => this.controlActive(id) });
        this.sound.onChange = (on) => {
            this.soundBtn.classList.toggle('is-active', on);
            this.soundBtn.setAttribute('aria-pressed', String(on));
            this.soundBtn.querySelector('.tool-btn__glyph').innerHTML = on ? ICON.sound : ICON.mute;
            this.settings.sync();
        };
        if (!this.sound.supported)
            this.soundBtn.disabled = true;
        events.on('mode-changed', ({ mode }) => {
            if (mode === 'walk' && this.tour?.isActive)
                this.tour.stop();
        });
        events.on('quality-changed', ({ quality }) => this.setQualityName(quality));
        ctx.engine.onUpdate((dt) => time.update(dt), 5);
        ctx.engine.onUpdate((dt) => this.frame(dt), 1100);
        if ((params.intro || uiParams.intro) && uiParams.tour === null && this.visible)
            this.intro.arm();
        this.syncMode();
    }
    afterLoad() {
        const ctx = this.ctx;
        if (!ctx)
            return;
        if (this.intro?.isActive)
            this.intro.play();
        else {
            if (uiParams.tour !== null && this.tour) {
                const i = Math.max(1, uiParams.tour) - 1;
                if (params.shot)
                    this.tour.start(i, { instant: true, autoAdvance: false });
                else
                    window.setTimeout(() => this.tour?.start(i), 600);
            }
            if (!params.shot)
                this.scheduleCapture(4);
        }
        if (uiParams.map === 2)
            this.map?.openLarge();
        else if (uiParams.map === 1)
            this.map?.toggleMini(true);
        else if (uiParams.map === 0)
            this.map?.toggleMini(false);
        if (uiParams.help)
            this.help.show();
        if (uiParams.settings)
            this.settings.show();
        const demo = uiParams.demo;
        if (demo.includes('card') || demo.includes('about'))
            this.showAbout();
        if (demo.includes('places'))
            this.places.classList.remove('is-collapsed');
        if (demo.includes('sky'))
            this.timebar?.openSky();
        if (demo.includes('sheet'))
            this.timebar?.openSheet();
        if (demo.includes('walkhint'))
            this.walk?.showHint(600000);
        if (demo.includes('toast'))
            this.toast('Time flowing · 10 min/s — a polar day in under three minutes', 600000);
        if (demo.includes('tooltip'))
            this.demoTooltip();
    }
    /**
     * Inside Orb: hand it a thumbnail once the first view has settled — and, if the
     * aurora is about to break up, wait (a little) for the brightest moment.
     */
    scheduleCapture(delay) {
        const orb = window.orb;
        if (this.captured || !orb?.capture || params.shot)
            return;
        this.captured = true;
        const t0 = this.clock;
        const tick = this.ctx.engine.onUpdate(() => {
            const waited = this.clock - t0;
            if (waited < delay)
                return;
            const info = this.ctx.sky.aurora.info;
            const peak = info.phase === 'breakup' || info.phase === 'expansion' || info.visible < 0.2;
            if (!peak && waited < delay + 9)
                return;
            tick();
            try {
                orb.capture?.();
            }
            catch {
                /* thumbnails are optional */
            }
        }, 1200);
    }
    /* ---------------- per frame ---------------- */
    frame(dt) {
        const ctx = this.ctx;
        this.clock += dt;
        this.intro?.update(dt);
        this.tour?.update(dt);
        this.map?.update();
        this.sound?.update(dt);
        const day = ctx.sky.sunDir.y > -0.05;
        if (day !== this.day) {
            this.day = day;
            this.host.classList.toggle('ui--day', day);
        }
        const p = ctx.camera.position;
        const inside = ctx.state.inside;
        const near = inside || (Math.hypot(p.x - HOUSE.x, p.z - HOUSE.z) < NEAR_HOUSE && p.y - HOUSE.floorY < 90);
        if (inside !== this.inside) {
            this.inside = inside;
            this.root.classList.toggle('hud--inside', inside);
        }
        if (near !== this.near) {
            this.near = near;
            this.root.classList.toggle('hud--near', near);
        }
        this.slowTimer -= dt;
        if (this.slowTimer <= 0) {
            this.slowTimer = 0.5;
            this.updateLocationMeta();
            if (this.time && !this.time.busy)
                this.timebar?.sync(ctx.sky.hours);
            this.timebar?.syncSky();
            this.cardTick?.();
            this.watchAurora();
        }
    }
    /** The aurora's strength drives a CSS variable (the brand's rays glow with it) and a note at breakups. */
    watchAurora() {
        const ctx = this.ctx;
        const a = ctx.sky.aurora;
        this.host.style.setProperty('--aur', a.info.visible.toFixed(2));
        const phase = a.info.phase;
        if (phase !== this.lastPhase) {
            const prev = this.lastPhase;
            this.lastPhase = phase;
            const busy = this.intro?.isActive || this.tour?.isActive || !this.visible || params.shot;
            if (phase === 'breakup' && prev && a.info.visible > 0.35 && !busy && this.breakupNotes < 3 && this.clock - this.lastBreakupNote > BREAKUP_NOTE_GAP) {
                this.lastBreakupNote = this.clock;
                this.breakupNotes++;
                this.toast(state.inside ? 'The aurora is breaking up — look up through the glass' : 'The aurora is breaking up overhead — look up', 4200, 'aurora');
            }
        }
    }
    updateLocationMeta() {
        const ctx = this.ctx;
        const p = ctx.camera.position;
        if (ctx.state.inside) {
            this.locMeta.textContent = fmtTemp(ctx.state.room === 'glasswing' ? 19 : 21);
            return;
        }
        const g = ctx.world.heightAt(p.x, p.z);
        const high = p.y - g > 140;
        const t = airTemperature(ctx.sky.hours, Math.max(0, high ? p.y : g), ctx.sky.weather);
        const parts = [];
        if (!high && g > -1)
            parts.push(`${Math.max(0, Math.round(g))} m`);
        parts.push(fmtTemp(t));
        if (this.locationId === 'spring')
            parts.push('pool 39 °C');
        this.locMeta.textContent = parts.join(' · ');
    }
    /* ---------------- layout ---------------- */
    buildTop() {
        const brand = el('header', 'brand');
        const mark = button('brand__mark', `${brandMark('brand__logo')}<span class="brand__name">Foxfire Fjord</span>`, 'About Foxfire Fjord', () => this.showAbout());
        this.locWrap = el('div', 'brand__loc', `${ICON.pin}<span class="loc-name">Over the island</span><span class="loc-meta"></span>`);
        this.locName = this.locWrap.querySelector('.loc-name');
        this.locMeta = this.locWrap.querySelector('.loc-meta');
        brand.append(mark, this.locWrap);
        this.root.appendChild(brand);
        this.toolbar = el('div', 'toolbar');
        this.tourBtn = button('tool-btn tool-btn--tour', `<span class="tool-btn__glyph">${ICON.compass}</span><span class="tool-btn__label">Tour</span>`, 'Guided tour (G)', () => this.toggleTour());
        this.mapBtn = button('tool-btn', `<span class="tool-btn__glyph">${ICON.map}</span>`, 'Island map (M)', () => {
            if (this.map?.isOpen)
                this.map.close();
            else
                this.map?.openLarge();
        });
        this.soundBtn = button('tool-btn tool-btn--sound', `<span class="tool-btn__glyph">${ICON.mute}</span><span class="tool-btn__eq" aria-hidden="true"><i></i><i></i><i></i></span>`, 'Sound — wind, snow and the stove (O)', () => this.toggleSound());
        this.soundBtn.setAttribute('aria-pressed', 'false');
        this.settingsBtn = button('tool-btn', `<span class="tool-btn__glyph">${ICON.gear}</span>`, 'Settings', () => {
            this.help.close();
            this.settings.toggle();
        });
        const helpBtn = button('tool-btn tool-btn--help', `<span class="tool-btn__glyph">${ICON.help}</span>`, 'Controls (?)', () => {
            this.settings.close();
            this.help.toggle();
        });
        this.toolbar.append(this.tourBtn, this.mapBtn, this.soundBtn, this.settingsBtn, helpBtn);
        this.root.appendChild(this.toolbar);
    }
    buildPlaces() {
        const nav = el('nav', 'places');
        nav.setAttribute('aria-label', 'Places');
        const saved = store.get('places');
        // open by default where there is room for it beside the view
        if (saved === 'closed' || (saved === null && (isCompact() || window.innerHeight < 820)))
            nav.classList.add('is-collapsed');
        const head = button('places__head', `${ICON.pin}<span class="places__title">Places</span><span class="places__chev">${ICON.chevronDown}</span>`, 'Show or hide places', () => {
            nav.classList.toggle('is-collapsed');
            store.set('places', nav.classList.contains('is-collapsed') ? 'closed' : 'open');
        });
        const list = el('div', 'places__list');
        VIEWPOINTS.forEach((vp, i) => {
            if (PLACE_BREAKS.has(vp.id))
                list.appendChild(el('div', 'places__rule'));
            const label = PLACE_LABEL[vp.id] ?? vp.label;
            const b = button('places__item', `<span class="places__icon">${ICON[PLACE_ICON[vp.id] ?? 'pin'] ?? ICON.pin}</span><span class="places__name">${label}</span>${i < 9 ? `<kbd>${i + 1}</kbd>` : '<kbd></kbd>'}`, `${label}${i < 9 ? ` (${i + 1})` : ''}`, () => this.goTo(vp.id));
            this.placeBtns.set(vp.id, b);
            list.appendChild(b);
        });
        // the fox has no fixed place: find it wherever it is on its rounds
        const fox = button('places__item places__item--fox', `<span class="places__icon">${ICON.fox}</span><span class="places__name">Find the fox</span><kbd></kbd>`, 'Find the arctic fox', () => {
            this.tour?.stop();
            this.map?.close();
            if (isCompact())
                this.places.classList.add('is-collapsed');
            this.findFox();
        });
        list.append(el('div', 'places__rule'), fox);
        const more = () => list.classList.toggle('places__list--more', list.scrollTop + list.clientHeight < list.scrollHeight - 2);
        list.addEventListener('scroll', more, { passive: true });
        new ResizeObserver(more).observe(list);
        nav.append(head, list);
        this.places = nav;
        this.root.appendChild(nav);
    }
    buildBottom() {
        this.mapSlot = el('div', 'map-slot');
        this.timeSlot = el('div', 'time-slot');
        const dock = el('div', 'dock');
        this.controlsHost = el('div', 'dock__controls');
        const sw = el('div', 'mode-switch');
        sw.setAttribute('role', 'group');
        sw.setAttribute('aria-label', 'Camera mode');
        const orbit = button('mode-switch__item', `${ICON.eye}<span>Explore</span>`, 'Explore — fly and orbit freely (F)', () => this.rig?.setMode('orbit'));
        const walk = button('mode-switch__item', `${ICON.footprints}<span>Walk</span>`, 'Walk — on foot through the snow (F)', () => {
            this.tour?.stop();
            this.rig?.setMode('walk');
        });
        this.modeBtns = { orbit, walk };
        sw.append(orbit, walk);
        dock.append(this.controlsHost, sw);
        this.root.append(this.mapSlot, this.timeSlot, dock);
        // the places list ends above the dock, however many control rows it has right now
        new ResizeObserver(() => this.root.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);
        this.syncMode();
    }
    setQualityName(name) {
        this.quality = name;
        this.root.classList.toggle('hud--lite', name === 'low');
        this.settings?.sync();
    }
    /* ---------------- actions ---------------- */
    goTo(id) {
        this.tour?.stop();
        this.stopFollowing();
        this.map?.close();
        if (isCompact())
            this.places.classList.add('is-collapsed');
        this.rig?.goToViewpoint(id);
    }
    stopFollowing() {
        try {
            this.ctx?.getFeature('fox')?.api?.follow?.(false);
        }
        catch {
            /* no fox */
        }
    }
    findFox() {
        if (!this.ctx)
            return;
        this.tour?.stop();
        const ok = findFox(this.ctx, () => this.toast('Following the arctic fox — pick any place to let her go', 3600, 'fox'));
        if (!ok)
            this.toast('The fox is out of sight just now', 2400, 'fox');
    }
    toggleTour() {
        if (!this.tour)
            return;
        if (this.tour.isActive)
            this.tour.stop();
        else
            this.tour.start(0);
    }
    toggleSound() {
        if (!this.sound)
            return;
        const on = !this.sound.enabled;
        this.sound.toggle();
        this.toast(on ? 'Sound on — wind over the snow, the stove, the ice on the lake' : 'Sound off', 2600, on ? 'sound' : 'mute');
    }
    showAbout() {
        const ctx = this.ctx;
        const card = {
            kicker: '69° N · late February',
            title: 'Foxfire Fjord',
            body: `<p>A black-tarred timber cabin on a knoll above a frozen fjord, with a glass gable wing where two low beds face north: lie down and watch the aurora through the roof.</p>
        <p>The stove ticks, the hot tub steams on the deck, and along the shore road the windows of Lysvik light up one by one. An arctic fox makes its rounds — in Finnish the northern lights are <em>revontulet</em>, “fox fires”, sparks swept into the sky by its tail.</p>
        <p class="card__muted">Press <kbd>G</kbd> for the guided tour, <kbd>T</kbd> to let time run, <kbd>?</kbd> for every control.</p>`,
        };
        if (ctx) {
            const { element, tick } = this.forecastElement(ctx);
            card.element = element;
            this.showCard(card);
            this.cardTick = tick;
            tick();
        }
        else
            this.showCard(card);
    }
    /** A live "tonight" readout for the about card: aurora activity, phase, sky, air, moon. */
    forecastElement(ctx) {
        const e = el('div', 'forecast', `<div class="forecast__head">${ICON.aurora}<span>Tonight over the fjord</span></div>
       <div class="forecast__meter"><i></i></div>
       <dl class="forecast__rows">
         <div><dt>Aurora</dt><dd data-k="aurora"></dd></div>
         <div><dt>Kp</dt><dd data-k="kp"></dd></div>
         <div><dt>Sky</dt><dd data-k="sky"></dd></div>
         <div><dt>Air</dt><dd data-k="air"></dd></div>
       </dl>`);
        const meter = e.querySelector('.forecast__meter i');
        const field = (k) => e.querySelector(`[data-k="${k}"]`);
        const tick = () => {
            const sky = ctx.sky;
            const info = sky.aurora.info;
            meter.style.transform = `scaleX(${clamp(info.visible, 0.02, 1).toFixed(3)})`;
            field('aurora').textContent = auroraWords(info.phase, info.visible, Math.asin(clamp(sky.sunDir.y, -1, 1)));
            field('kp').textContent = String(Math.max(0, Math.round(info.activity * 8 * sky.aurora.forecast)));
            field('sky').textContent = sky.weather === 'snow' ? 'Snowfall' : sky.weather === 'bank' ? 'Clear · cloud bank' : 'Clear';
            field('air').textContent = fmtTemp(airTemperature(sky.hours, HOUSE.groundY, sky.weather));
        };
        return { element: e, tick };
    }
    setVisible(v) {
        this.visible = v;
        state.uiVisible = v;
        this.root.classList.toggle('hud--hidden', !v);
        this.host.classList.toggle('ui--bare', !v);
        this.host.classList.remove('ui--shot');
        if (!v) {
            this.tooltip.classList.remove('tooltip--on');
            this.toast('Interface hidden — press H or tap the eye to bring it back', 2800);
        }
        events.emit('ui:visibility', { visible: v });
    }
    bindKeys() {
        // capture phase: tour keys must win over the camera's arrow-key glide
        window.addEventListener('keydown', (e) => {
            if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey)
                return;
            if (this.tour?.isActive) {
                if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (e.code === 'ArrowRight')
                        this.tour.next();
                    else
                        this.tour.prev();
                    return;
                }
                if (e.code === 'Space') {
                    e.preventDefault();
                    this.tour.togglePause();
                    return;
                }
            }
        }, { capture: true });
        window.addEventListener('keydown', (e) => {
            if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey)
                return;
            if (e.repeat && e.code !== 'BracketLeft' && e.code !== 'BracketRight')
                return;
            switch (e.code) {
                case 'KeyH':
                    this.setVisible(!this.visible);
                    return;
                case 'KeyT':
                    if (e.shiftKey)
                        this.time?.cycleSpeed();
                    else
                        this.time?.toggle();
                    if (this.time)
                        this.toast(this.time.playing ? `Time flowing · ${this.time.speed} min/s` : 'Time paused', 1600);
                    return;
                case 'BracketLeft':
                case 'BracketRight':
                    if (this.time)
                        this.time.goTo(this.time.hours + (e.code === 'BracketRight' ? 0.25 : -0.25), { duration: 0.3 });
                    return;
                case 'KeyM':
                    if (this.map?.isOpen)
                        this.map.close();
                    else
                        this.map?.toggleMini();
                    return;
                case 'KeyG':
                    this.toggleTour();
                    return;
                case 'KeyO':
                    this.toggleSound();
                    return;
                case 'KeyX':
                    this.findFox();
                    return;
                case 'Escape':
                    this.escape();
                    return;
            }
            if (e.key === '?') {
                this.settings.close();
                this.help.toggle();
                return;
            }
            const n = Number(e.key);
            if (Number.isInteger(n) && n >= 1 && n <= 9 && VIEWPOINTS[n - 1] && !e.shiftKey)
                this.goTo(VIEWPOINTS[n - 1].id);
        });
    }
    escape() {
        if (this.help.isOpen)
            return this.help.close();
        if (this.settings.isOpen)
            return this.settings.close();
        if (this.timebar?.closePopups())
            return;
        if (this.map?.isOpen)
            return this.map.close();
        if (this.tour?.isActive)
            return this.tour.stop();
        if (this.card.classList.contains('card--open'))
            return this.hideCard();
        if (this.places.matches('.places:not(.is-collapsed)') && isCompact())
            this.places.classList.add('is-collapsed');
    }
    /* ---------------- time ---------------- */
    syncSpeed(speed) {
        this.pendingSpeed = speed;
        this.time?.syncFromSky();
    }
    syncTime(hours) {
        this.timebar?.sync(hours);
    }
    /* ---------------- location / mode ---------------- */
    setLocation(l) {
        this.locationId = l.id;
        clearTimeout(this.locTimer);
        this.locWrap.classList.add('is-swap');
        this.locTimer = window.setTimeout(() => {
            this.locName.textContent = l.label;
            if (this.ctx)
                this.updateLocationMeta();
            this.locWrap.classList.remove('is-swap');
        }, 220);
        const vp = LOCATION_VIEW[l.id];
        for (const [id, b] of this.placeBtns)
            b.classList.toggle('is-here', id === vp);
    }
    syncMode() {
        const walk = state.mode === 'walk';
        if (!this.modeBtns)
            return;
        this.modeBtns.orbit.classList.toggle('is-active', !walk);
        this.modeBtns.walk.classList.toggle('is-active', walk);
        this.modeBtns.orbit.setAttribute('aria-pressed', String(!walk));
        this.modeBtns.walk.setAttribute('aria-pressed', String(walk));
        this.root.classList.toggle('hud--walk', walk);
    }
    /* ---------------- interaction ---------------- */
    onHover(i, x, y) {
        this.walk?.setHover(!!i);
        if (!i || !this.visible) {
            this.tooltip.classList.remove('tooltip--on');
            this.hoverLabel = null;
            return;
        }
        const key = `${i.label}|${i.action ?? ''}`;
        if (key !== this.hoverLabel) {
            this.hoverLabel = key;
            this.tooltip.innerHTML = `<strong>${i.label}</strong>${i.action ? `<span>${i.action}</span>` : ''}`;
        }
        const centred = !!document.pointerLockElement || (state.mode === 'walk' && this.walk?.isTouch);
        const w = this.tooltip.offsetWidth || 160;
        const h = this.tooltip.offsetHeight || 40;
        let tx = centred ? x - w / 2 : x + 16;
        let ty = centred ? y + 22 : y + 16;
        if (tx + w > window.innerWidth - 8)
            tx = x - w - 12;
        if (ty + h > window.innerHeight - 8)
            ty = y - h - 12;
        this.tooltip.style.transform = `translate(${Math.max(8, tx).toFixed(0)}px, ${Math.max(8, ty).toFixed(0)}px)`;
        this.tooltip.classList.add('tooltip--on');
    }
    demoTooltip() {
        this.tooltip.innerHTML = '<strong>Wood stove</strong><span>Open the door</span>';
        this.tooltip.style.transform = `translate(${Math.round(window.innerWidth * 0.52)}px, ${Math.round(window.innerHeight * 0.48)}px)`;
        this.tooltip.classList.add('tooltip--on');
    }
    showCard(card) {
        this.cardTick = null;
        this.card.innerHTML = '';
        const close = button('icon-btn card__close', ICON.close, 'Close (Esc)', () => this.hideCard());
        const head = el('header', 'card__head', `${card.kicker ? `<div class="card__kicker">${card.kicker}</div>` : ''}<h2>${card.title}</h2>`);
        this.card.append(close, head);
        if (card.body)
            this.card.appendChild(el('div', 'card__body', card.body));
        if (card.element) {
            const wrap = el('div', 'card__custom');
            wrap.appendChild(card.element);
            this.card.appendChild(wrap);
        }
        if (card.actions?.length) {
            const row = el('div', 'card__actions');
            card.actions.forEach((a, k) => {
                const b = button(`btn${k === 0 ? ' btn--primary' : ''}`, a.label, undefined, () => {
                    try {
                        a.onClick();
                    }
                    catch (err) {
                        console.error('[hud] card action failed', err);
                    }
                });
                row.appendChild(b);
            });
            this.card.appendChild(row);
        }
        this.card.scrollTop = 0;
        this.card.classList.remove('card--open');
        void this.card.offsetWidth;
        this.card.classList.add('card--open');
        this.root.classList.add('hud--card');
    }
    hideCard() {
        this.cardTick = null;
        this.card.classList.remove('card--open');
        this.root.classList.remove('hud--card');
    }
    toast(text, ms = 2200, icon) {
        this.toastEl.innerHTML = `${icon && ICON[icon] ? `<span class="toast__icon">${ICON[icon]}</span>` : ''}<span></span>`;
        this.toastEl.lastElementChild.textContent = text;
        this.toastEl.classList.toggle('toast--aurora', icon === 'aurora');
        this.toastEl.classList.add('toast--on');
        clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('toast--on'), ms);
    }
    addControl(spec) {
        this.controls = this.controls.filter((c) => c.id !== spec.id);
        this.controls.push(spec);
        this.renderControls();
        return () => {
            this.controls = this.controls.filter((c) => c !== spec);
            this.renderControls();
        };
    }
    refreshControls() {
        this.renderControls();
    }
    /** The state of a dock control (e.g. the cabin's 'cabin-fire'), or null if there is none. */
    controlActive(id) {
        const c = this.controls.find((k) => k.id === id);
        if (!c?.active)
            return null;
        try {
            return !!c.active();
        }
        catch {
            return null;
        }
    }
    renderControls() {
        this.controlsHost.innerHTML = '';
        const groups = new Map();
        for (const c of this.controls) {
            if (!groups.has(c.group))
                groups.set(c.group, []);
            groups.get(c.group).push(c);
        }
        const order = [...GROUP_ORDER, ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g))];
        for (const group of order) {
            const list = groups.get(group);
            if (!list?.length)
                continue;
            const g = el('div', `dock__group dock__group--${group}`);
            if (group === 'house') {
                g.appendChild(el('span', 'dock__label', 'Cabin'));
                const t = button('chip dock__toggle', ICON.cabin, this.cabinOpen ? 'Hide the cabin controls' : 'Cabin controls: lamps, stove, blinds, tub, fire', () => {
                    this.cabinOpen = !this.cabinOpen;
                    this.renderControls();
                });
                t.classList.toggle('is-open', this.cabinOpen);
                t.setAttribute('aria-expanded', String(this.cabinOpen));
                g.classList.toggle('is-open', this.cabinOpen);
                g.appendChild(t);
            }
            // mutually exclusive presets (e.g. the blinds) sit together in one small segmented chip
            const sets = this.controlSets(list);
            const done = new Set();
            for (const c of list) {
                const key = sets.get(c.id);
                if (key) {
                    if (done.has(key))
                        continue;
                    done.add(key);
                    const box = el('div', 'chip-set', `<span class="chip-set__label">${key.split('-').pop().replace(/^./, (m) => m.toUpperCase())}</span>`);
                    box.setAttribute('role', 'group');
                    for (const m of list)
                        if (sets.get(m.id) === key)
                            box.appendChild(this.chip(m, 'chip-set__item'));
                    g.appendChild(box);
                }
                else
                    g.appendChild(this.chip(c, 'chip'));
            }
            this.controlsHost.appendChild(g);
        }
        this.root.classList.toggle('hud--controls', this.controls.length > 0);
    }
    /** A control's button (a chip, or one item of a preset set). */
    chip(c, cls) {
        let active = false;
        try {
            active = !!c.active?.();
        }
        catch {
            active = false;
        }
        const icon = c.icon && ICON[c.icon] ? ICON[c.icon] : iconFor(c.id);
        const b = button(cls, `${icon}<span class="chip__label">${c.label}</span>`, c.label, () => {
            try {
                c.onClick();
            }
            catch (err) {
                console.error(`[hud] control "${c.id}" failed`, err);
            }
            this.renderControls();
            // icon-only on phones (and in preset sets): say what changed
            if (isCompact() || cls !== 'chip') {
                let on = false;
                try {
                    on = !!c.active?.();
                }
                catch {
                    on = false;
                }
                this.toast(c.kind === 'toggle' || c.active ? `${c.label} · ${on ? 'on' : 'off'}` : c.label, 1400, c.icon && ICON[c.icon] ? c.icon : undefined);
            }
        });
        if (c.kind === 'toggle' || c.active)
            b.setAttribute('aria-pressed', String(active));
        if (active)
            b.classList.add('is-active');
        b.dataset.id = c.id;
        return b;
    }
    /**
     * Preset sets among a group's controls: an explicit `set`, or ids that share a
     * two-part prefix (cabin-blinds-aurora, cabin-blinds-privacy …). id → set key.
     */
    controlSets(list) {
        const byKey = new Map();
        for (const c of list) {
            const parts = c.id.split('-');
            const key = c.set ?? (parts.length >= 3 ? parts.slice(0, -1).join('-') : null);
            if (!key)
                continue;
            if (!byKey.has(key))
                byKey.set(key, []);
            byKey.get(key).push(c.id);
        }
        const out = new Map();
        for (const [key, ids] of byKey)
            if (ids.length >= 2)
                for (const id of ids)
                    out.set(id, key);
        return out;
    }
    /* ---------------- debug ---------------- */
    enableStats() {
        this.stats = el('pre', 'stats');
        document.body.appendChild(this.stats);
        const tick = () => {
            const s = window.__STATS__;
            if (s && this.stats)
                this.stats.textContent = Object.entries(s).map(([k, v]) => `${k.padEnd(10)} ${v}`).join('\n');
            requestAnimationFrame(tick);
        };
        tick();
    }
}
