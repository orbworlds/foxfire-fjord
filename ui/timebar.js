/**
 * The polar light band: Foxfire Fjord's clock. A 24-hour strip coloured by
 * the light itself — a short pink-gold day inside long blue hours and a deep
 * navy night — with the aurora's activity curve glowing along its foot, a
 * needle for now (a sun or a moon), preset times under it, play / speed, and
 * a small sky panel for the weather and the aurora forecast.
 *
 * On phones it folds into a clock chip in the bottom-left corner that opens
 * the whole thing as a sheet (the bottom centre stays clear).
 */
import { el, button, fmtTime, ICON, clamp, hourDelta, isCompact } from './dom.js';
import { sunAltitude, moonAltitude, phaseOf, lightColor, auroraActivityAt, auroraWords, TIME_PRESETS } from './sun-model.js';
const VB_W = 240;
const VB_H = 24;
const DEG = Math.PI / 180;
/** the aurora forecast choices: multipliers of the hourly activity curve */
const FORECASTS = [
    { id: 'quiet', label: 'Quiet', value: 0.55 },
    { id: 'active', label: 'Active', value: 1 },
    { id: 'storm', label: 'Storm', value: 1.4 },
];
const WEATHERS = [
    { id: 'clear', label: 'Clear', icon: 'clear' },
    { id: 'bank', label: 'Cloud bank', icon: 'cloud' },
    { id: 'snow', label: 'Snowfall', icon: 'snow' },
];
function speedLabel(s) {
    return `${s} min/s`;
}
function dayLength(s) {
    const secs = (24 * 60) / s;
    return secs >= 120 ? `${Math.round(secs / 60)} min` : `${Math.round(secs)} s`;
}
function hex(c) {
    return `rgb(${c.map((v) => Math.round(v)).join(',')})`;
}
/** The aurora curve along the foot of the band (top line and filled area), scaled by the forecast. */
function auroraPaths(forecast) {
    const n = 192;
    let top = '';
    for (let i = 0; i <= n; i++) {
        const h = (i / n) * 24;
        const a = Math.min(1, auroraActivityAt(h) * forecast);
        const y = VB_H - a * 15.5;
        top += `${i === 0 ? 'M' : 'L'}${((h / 24) * VB_W).toFixed(2)} ${y.toFixed(2)}`;
    }
    return { top, area: `${top}L${VB_W} ${VB_H}L0 ${VB_H}Z` };
}
/** SVG for the band: the light gradient, the aurora curve, quiet hour ticks. */
function bandSvg(uid) {
    let stops = '';
    for (let i = 0; i <= 96; i++) {
        const h = (i / 96) * 24;
        stops += `<stop offset="${(i / 96).toFixed(4)}" stop-color="${hex(lightColor(sunAltitude(h) / DEG))}"/>`;
    }
    const { top, area } = auroraPaths(1);
    // minor ticks between the hour numerals (06, 12, 18 are labelled in HTML over the band)
    const ticks = [3, 9, 15, 21]
        .map((h) => {
        const x = (h / 24) * VB_W;
        return `<line class="tb-tick" x1="${x}" x2="${x}" y1="0" y2="2.2"/>`;
    })
        .join('');
    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="tbLight${uid}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
      <linearGradient id="tbAur${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7cf7bd" stop-opacity="0.85"/>
        <stop offset="0.5" stop-color="#3fcf9a" stop-opacity="0.42"/>
        <stop offset="1" stop-color="#1c8f74" stop-opacity="0.1"/>
      </linearGradient>
      <linearGradient id="tbShade${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.16"/>
        <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect class="tb-light" width="${VB_W}" height="${VB_H}" fill="url(#tbLight${uid})"/>
    <path class="tb-aurora" d="${area}" fill="url(#tbAur${uid})"/>
    <path class="tb-aurora-line" d="${top}"/>
    <rect width="${VB_W}" height="${VB_H}" fill="url(#tbShade${uid})"/>
    ${ticks}
  </svg>`;
}
let seq = 0;
export class TimeBar {
    time;
    sky;
    toast;
    root;
    onSheetChange = () => { };
    playBtn;
    speedBtn;
    skyBtn;
    chip;
    timeEl;
    phaseEl;
    chipTime;
    chipIcon;
    range;
    needle;
    bubble;
    skyPanel;
    presetBtns = [];
    weatherBtns = new Map();
    forecastBtns = new Map();
    lastPhase = '';
    lastKey = '';
    lastAur = '';
    scrubbing = false;
    shownHours = -1;
    sheet = false;
    skyOpen = false;
    shownForecast = 1;
    aurArea = null;
    aurLine = null;
    constructor(time, sky, toast) {
        this.time = time;
        this.sky = sky;
        this.toast = toast;
        const uid = String(seq++);
        this.root = el('footer', 'timebar');
        this.root.setAttribute('aria-label', 'Time of day');
        // phone: the folded clock
        this.chip = button('tb-chip', '<span class="tb-chip__icon"></span><span class="tb-chip__time">21:45</span>', 'Time of day and sky', () => this.toggleSheet());
        this.chipTime = this.chip.querySelector('.tb-chip__time');
        this.chipIcon = this.chip.querySelector('.tb-chip__icon');
        const sheetHead = el('div', 'tb-sheet-head', '<span>Light &amp; sky</span>');
        sheetHead.appendChild(button('icon-btn', ICON.close, 'Close', () => this.closeSheet()));
        this.playBtn = button('tb-play', ICON.play, 'Play time (T)', () => this.time.toggle());
        this.speedBtn = button('tb-speed', speedLabel(time.selectedSpeed), 'Time speed (Shift+T)', () => this.time.cycleSpeed());
        this.skyBtn = button('tb-skybtn', ICON.aurora, 'Weather and aurora forecast', () => this.toggleSky());
        const clock = el('div', 'tb-clock');
        this.timeEl = el('div', 'tb-time', '21:45');
        this.phaseEl = el('div', 'tb-phase', '');
        clock.append(this.timeEl, this.phaseEl);
        const track = el('div', 'tb-track');
        const band = el('div', 'tb-band');
        band.innerHTML = bandSvg(uid);
        this.aurArea = band.querySelector('.tb-aurora');
        this.aurLine = band.querySelector('.tb-aurora-line');
        this.needle = el('div', 'tb-needle', '<i class="tb-needle__line"></i><i class="tb-needle__body"></i><i class="tb-needle__aur"></i>');
        this.bubble = el('div', 'tb-bubble', '12:00');
        this.range = el('input', 'tb-range');
        this.range.type = 'range';
        this.range.min = '0';
        this.range.max = '24';
        this.range.step = String(1 / 60);
        this.range.setAttribute('aria-label', 'Time of day');
        const hours = el('div', 'tb-hours', [6, 12, 18].map((h) => `<span style="--x:${(h / 24) * 100}%">${String(h).padStart(2, '0')}</span>`).join(''));
        hours.setAttribute('aria-hidden', 'true');
        band.append(hours, this.needle, this.bubble, this.range);
        const presets = el('div', 'tb-presets');
        for (const p of TIME_PRESETS) {
            const b = button('tb-preset', `${ICON[p.icon]}<span>${p.short}</span>`, `${p.en} · ${fmtTime(p.hours)}`, () => {
                this.time.goTo(p.hours, { direction: 'shortest' });
            });
            b.dataset.id = p.id;
            b.dataset.hours = String(p.hours);
            b.removeAttribute('title');
            // desktop: the preset's name floats over the band where it would take you
            b.addEventListener('pointerenter', (e) => {
                if (e.pointerType !== 'mouse' || this.scrubbing)
                    return;
                this.bubble.textContent = `${p.en} · ${fmtTime(p.hours)}`;
                this.bubble.style.setProperty('--x', `${(p.hours / 24) * 100}%`);
                this.bubble.classList.add('is-on');
            });
            b.addEventListener('pointerleave', () => {
                if (!this.scrubbing)
                    this.bubble.classList.remove('is-on');
            });
            b.style.setProperty('--x', `${(p.hours / 24) * 100}%`);
            presets.appendChild(b);
            this.presetBtns.push(b);
        }
        track.append(band, presets);
        this.skyPanel = this.buildSky();
        this.root.append(this.chip, sheetHead, this.playBtn, clock, track, this.speedBtn, this.skyBtn, this.skyPanel);
        this.bindRange(band);
        time.onChange(() => this.syncPlay());
        this.syncPlay();
        this.syncSky();
        // a tap outside the sky panel or the sheet closes it
        document.addEventListener('pointerdown', (e) => {
            const t = e.target;
            if (this.skyOpen && !this.skyPanel.contains(t) && !this.skyBtn.contains(t))
                this.setSky(false);
            if (this.sheet && !this.root.contains(t))
                this.closeSheet();
        });
    }
    buildSky() {
        const panel = el('div', 'tb-sky');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Sky');
        const wRow = el('div', 'tb-sky__row', '<div class="tb-sky__label">Weather</div>');
        const wSeg = el('div', 'segmented segmented--icons');
        for (const w of WEATHERS) {
            const b = button('segmented__item', `${ICON[w.icon]}<span>${w.label}</span>`, w.label, () => {
                this.sky.setWeather(w.id);
                this.syncSky();
                this.toast(w.id === 'snow' ? 'Snow is coming in from the sea' : w.id === 'clear' ? 'The sky is clearing' : 'A cloud bank lies out at sea', 2400, w.icon);
            });
            this.weatherBtns.set(w.id, b);
            wSeg.appendChild(b);
        }
        wRow.appendChild(wSeg);
        const aRow = el('div', 'tb-sky__row', '<div class="tb-sky__label">Aurora forecast</div>');
        const aSeg = el('div', 'segmented');
        for (const f of FORECASTS) {
            const b = button('segmented__item', f.label, `Aurora: ${f.label.toLowerCase()}`, () => {
                this.sky.setAuroraActivity(null);
                this.sky.aurora.forecast = f.value;
                this.syncSky();
            });
            this.forecastBtns.set(f.id, b);
            aSeg.appendChild(b);
        }
        aRow.appendChild(aSeg);
        const wake = button('btn btn--aurora tb-sky__wake', `${ICON.aurora}<span>Wake the lights</span>`, 'Start a substorm: the aurora brightens and breaks up', () => this.wakeAurora());
        const note = el('p', 'tb-sky__note', 'The lights rise at the end of the blue hour and peak around 22:30; every few minutes a substorm breaks them up overhead.');
        panel.append(wRow, aRow, wake, note);
        return panel;
    }
    /** Jump the aurora to the end of a growth phase: it breaks up a few seconds later. */
    wakeAurora() {
        const a = this.sky.aurora;
        if (Math.asin(clamp(this.sky.sunDir.y, -1, 1)) > -7 * DEG) {
            this.toast('The aurora only shows after dark — try the Aurora time', 2800, 'aurora');
            return;
        }
        if (a.info.activity < 0.35 && a.activityOverride === null)
            a.forecast = Math.max(a.forecast, 1);
        a.seek(74);
        this.toast('The arcs are brightening… watch the sky', 2800, 'aurora');
        this.setSky(false);
        if (isCompact())
            this.closeSheet();
    }
    bindRange(band) {
        const r = this.range;
        const valueAt = (clientX) => {
            const rect = band.getBoundingClientRect();
            return clamp(((clientX - rect.left) / rect.width) * 24, 0, 24);
        };
        r.addEventListener('input', () => {
            this.scrubbing = true;
            this.time.scrub(Number(r.value));
            this.showBubble(Number(r.value));
        });
        r.addEventListener('change', () => {
            this.scrubbing = false;
        });
        r.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse' && !this.scrubbing)
                this.showBubble(valueAt(e.clientX));
        });
        r.addEventListener('pointerleave', () => {
            if (!this.scrubbing)
                this.bubble.classList.remove('is-on');
        });
        r.addEventListener('pointerup', () => {
            this.scrubbing = false;
            this.bubble.classList.remove('is-on');
            // give keyboard shortcuts back to the page
            r.blur();
        });
        r.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const step = (e.shiftKey ? 60 : 15) / 60;
                this.time.goTo(this.time.hours + (e.key === 'ArrowRight' ? step : -step), { duration: 0.35 });
            }
        });
    }
    showBubble(h) {
        this.bubble.textContent = `${fmtTime(h)} · ${phaseOf(h).short}`;
        this.bubble.style.setProperty('--x', `${(h / 24) * 100}%`);
        this.bubble.classList.add('is-on');
    }
    syncPlay() {
        const playing = this.time.playing;
        this.playBtn.innerHTML = playing ? ICON.pause : ICON.play;
        this.playBtn.classList.toggle('is-active', playing);
        const t = playing ? 'Pause time (T)' : 'Play time (T)';
        this.playBtn.title = t;
        this.playBtn.setAttribute('aria-label', t);
        const s = playing ? this.time.speed : this.time.selectedSpeed;
        this.speedBtn.textContent = speedLabel(s);
        this.speedBtn.title = `Time speed: ${s} in-game minutes per second — a day in ${dayLength(s)} (Shift+T)`;
        this.speedBtn.classList.toggle('is-dim', !playing);
        this.root.classList.toggle('is-playing', playing);
    }
    /* ---------------- sky panel / sheet ---------------- */
    toggleSky() {
        this.setSky(!this.skyOpen);
    }
    openSky() {
        this.setSky(true);
    }
    setSky(open) {
        this.skyOpen = open;
        this.skyPanel.classList.toggle('is-open', open);
        this.skyBtn.classList.toggle('is-active', open);
        if (open)
            this.syncSky();
    }
    toggleSheet() {
        if (this.sheet)
            this.closeSheet();
        else
            this.openSheet();
    }
    openSheet() {
        this.sheet = true;
        this.root.classList.add('is-sheet');
        this.onSheetChange(true);
    }
    closeSheet() {
        if (!this.sheet)
            return;
        this.sheet = false;
        this.root.classList.remove('is-sheet');
        this.setSky(false);
        this.onSheetChange(false);
    }
    /** Close the sky panel or the sheet; true if something was open (Esc). */
    closePopups() {
        if (this.skyOpen) {
            this.setSky(false);
            return true;
        }
        if (this.sheet) {
            this.closeSheet();
            return true;
        }
        return false;
    }
    /** Live sky state: weather and forecast buttons, the aurora words under the clock. */
    syncSky() {
        const sky = this.sky;
        for (const [id, b] of this.weatherBtns)
            b.classList.toggle('is-active', id === sky.weather);
        const a = sky.aurora;
        const f = a.activityOverride === null ? a.forecast : null;
        let best = '';
        let bd = Infinity;
        if (f !== null) {
            for (const c of FORECASTS) {
                const d = Math.abs(c.value - f);
                if (d < bd) {
                    bd = d;
                    best = c.id;
                }
            }
        }
        for (const [id, b] of this.forecastBtns)
            b.classList.toggle('is-active', id === best);
        // the curve on the band follows the forecast (an override flattens it to that level by night)
        const scale = a.activityOverride !== null ? 1 : a.forecast;
        if (Math.abs(scale - this.shownForecast) > 0.01 && this.aurArea && this.aurLine) {
            this.shownForecast = scale;
            const p = auroraPaths(scale);
            this.aurArea.setAttribute('d', p.area);
            this.aurLine.setAttribute('d', p.top);
        }
        const info = a.info;
        const sunAlt = Math.asin(clamp(sky.sunDir.y, -1, 1));
        const vis = info.visible;
        const words = vis >= 0.04 ? auroraWords(info.phase, vis, sunAlt) : '';
        const key = `${words}|${Math.round(vis * 20)}`;
        if (key !== this.lastAur) {
            this.lastAur = key;
            this.root.style.setProperty('--aur-now', vis.toFixed(2));
            this.root.classList.toggle('is-aurora', vis >= 0.04);
            this.root.classList.toggle('is-storm', info.phase === 'breakup' || (info.phase === 'expansion' && vis > 0.45));
            this.renderPhase(words);
        }
    }
    renderPhase(aurora) {
        const ph = phaseOf(this.shownHours < 0 ? this.time.hours : this.shownHours);
        this.phaseEl.innerHTML = aurora
            ? `<span class="tb-phase__light">${ph.short}</span><span class="tb-phase__aur"><i></i>${aurora}</span>`
            : `<span class="tb-phase__light">${ph.en}</span>`;
    }
    /** Called on every time change; cheap when nothing visible changed. */
    sync(hours) {
        if (Math.abs(hours - this.shownHours) < 1 / 600)
            return;
        this.shownHours = hours;
        const t = fmtTime(hours);
        this.timeEl.textContent = t;
        this.chipTime.textContent = t;
        const x = (hours / 24) * 100;
        const sun = sunAltitude(hours);
        const night = sun < -0.03;
        this.needle.style.setProperty('--x', `${x}%`);
        this.needle.style.setProperty('--a', auroraActivityAt(hours).toFixed(3));
        this.needle.classList.toggle('is-moon', night);
        this.needle.classList.toggle('is-moonless', night && moonAltitude(hours) < 0);
        if (!this.scrubbing && document.activeElement !== this.range)
            this.range.value = String(hours);
        this.range.setAttribute('aria-valuetext', `${t}, ${phaseOf(hours).en}`);
        const ph = phaseOf(hours);
        if (ph.en !== this.lastPhase) {
            this.lastPhase = ph.en;
            this.lastAur = '';
            this.root.dataset.phase = ph.key;
            this.chipIcon.innerHTML = ICON[ph.key === 'lowsun' ? 'sun' : ph.key === 'pink' ? 'lowsun' : ph.key === 'blue' ? 'bluehour' : 'moon'];
            this.syncSky();
        }
        let key = '';
        let best = 0.34;
        for (const b of this.presetBtns) {
            const d = Math.abs(hourDelta(Number(b.dataset.hours), hours));
            if (d < best) {
                best = d;
                key = b.dataset.id ?? '';
            }
        }
        if (key !== this.lastKey) {
            this.lastKey = key;
            for (const b of this.presetBtns)
                b.classList.toggle('is-active', b.dataset.id === key);
        }
    }
}
