/**
 * Settings popover (rendering quality, sound and volume, the island map,
 * fullscreen, hide the interface) and the controls overlay of Foxfire Fjord.
 */
import { QUALITY_ORDER } from '../core/quality.js';
import { el, button, ICON } from './dom.js';
const QUALITY_NOTE = {
    low: 'Phones',
    medium: 'Laptops',
    high: 'Desktops',
    ultra: 'Big GPUs',
};
function toggle(icon, label, sub, key, on) {
    return `<span class="set-row__icon">${ICON[icon]}</span><span class="set-row__label">${label}<small>${sub}</small></span>${key ? `<kbd>${key}</kbd>` : ''}<span class="switch${on ? ' is-on' : ''}" aria-hidden="true"><i></i></span>`;
}
/** Settings popover: quality, sound, minimap, fullscreen, hide interface, controls. */
export class Settings {
    hooks;
    root;
    qualityBtns = new Map();
    soundRow;
    volume;
    mapRow;
    fsRow = null;
    open = false;
    onOpenChange = () => { };
    constructor(hooks) {
        this.hooks = hooks;
        this.root = el('div', 'settings');
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-label', 'Settings');
        const head = el('div', 'settings__head', '<span class="settings__title">Settings</span>');
        head.appendChild(button('icon-btn settings__close', ICON.close, 'Close settings', () => this.close()));
        const q = el('div', 'set-block');
        q.appendChild(el('div', 'set-block__label', `${ICON.layers}<span>Rendering quality</span>`));
        const seg = el('div', 'segmented segmented--quality');
        for (const name of QUALITY_ORDER) {
            const b = button('segmented__item', `<b>${name}</b><small>${QUALITY_NOTE[name]}</small>`, `Quality: ${name}`, () => {
                hooks.setQuality(name);
                this.sync();
            });
            this.qualityBtns.set(name, b);
            seg.appendChild(b);
        }
        q.appendChild(seg);
        q.appendChild(el('p', 'set-note', 'Higher settings add soft shadows, ambient occlusion, bloom on the windows and a finer aurora. The first seconds adapt to your device.'));
        this.soundRow = button('set-row', '', 'Sound (O)', () => {
            hooks.toggleSound();
            this.sync();
        });
        this.volume = el('input', 'set-volume');
        this.volume.type = 'range';
        this.volume.min = '0';
        this.volume.max = '1';
        this.volume.step = '0.01';
        this.volume.setAttribute('aria-label', 'Volume');
        this.volume.addEventListener('input', () => hooks.setVolume(Number(this.volume.value)));
        this.volume.addEventListener('pointerup', () => this.volume.blur());
        this.mapRow = button('set-row', '', 'Island map (M)', () => {
            hooks.toggleMinimap();
            this.sync();
        });
        const rows = el('div', 'set-rows');
        rows.append(this.soundRow, this.volume, this.mapRow);
        if (document.fullscreenEnabled) {
            this.fsRow = button('set-row', '', 'Fullscreen', () => {
                if (document.fullscreenElement)
                    document.exitFullscreen?.();
                else
                    document.documentElement.requestFullscreen?.().catch(() => { });
            });
            rows.appendChild(this.fsRow);
            document.addEventListener('fullscreenchange', () => this.sync());
        }
        const actions = el('div', 'set-actions');
        actions.append(button('set-action', `${ICON.hide}<span>Hide interface</span>`, 'Hide the interface (H)', () => {
            this.close();
            hooks.hideUI();
        }), button('set-action', `${ICON.keyboard}<span>All controls</span>`, 'Show all controls (?)', () => {
            this.close();
            hooks.showHelp();
        }));
        this.root.append(head, q, rows, actions);
        this.sync();
    }
    get isOpen() {
        return this.open;
    }
    sync() {
        const q = this.hooks.quality();
        for (const [name, b] of this.qualityBtns)
            b.classList.toggle('is-active', name === q);
        const snd = this.hooks.sound();
        this.soundRow.innerHTML = toggle(snd ? 'sound' : 'mute', 'Sound', 'Wind, snow underfoot, the stove, the ice', 'O', snd);
        this.soundRow.disabled = !this.hooks.soundSupported();
        this.volume.value = String(this.hooks.volume());
        this.volume.classList.toggle('is-dim', !snd);
        this.mapRow.innerHTML = toggle('map', 'Corner map', 'Where you are and where the fox is', 'M', this.hooks.minimap());
        if (this.fsRow)
            this.fsRow.innerHTML = toggle('fullscreen', 'Fullscreen', 'The whole screen for the sky', null, !!document.fullscreenElement);
    }
    toggle() {
        if (this.open)
            this.close();
        else
            this.show();
    }
    show() {
        this.sync();
        this.open = true;
        this.root.classList.add('is-open');
        this.onOpenChange(true);
    }
    close() {
        if (!this.open)
            return;
        this.open = false;
        this.root.classList.remove('is-open');
        this.onOpenChange(false);
    }
}
/** `[W][A][S][D]`-style key caps; plain words (Drag, Wheel …) stay as text. */
function keys(...k) {
    return k.map((s) => `<kbd>${s}</kbd>`).join('');
}
const WASD = keys('W', 'A', 'S', 'D');
const HELP_SECTIONS = [
    {
        icon: 'eye',
        title: 'Explore',
        rows: [
            ['Drag', 'look around'],
            ['Right-drag · two fingers', 'pan'],
            ['Wheel · pinch', 'zoom'],
            [`${WASD} · arrows`, 'glide (Shift: faster)'],
            ['Click · tap', 'read about things, open lids and doors'],
            [`${keys('1')} – ${keys('9')}`, 'jump to places'],
        ],
    },
    {
        icon: 'footprints',
        title: 'Walk',
        rows: [
            [keys('F'), 'walk mode on / off'],
            ['Click', 'capture the mouse to look (or drag)'],
            [`${WASD} · arrows`, 'walk through the snow'],
            [keys('Shift'), 'run — faster out on the fells'],
            [keys('Esc'), 'release the mouse'],
            ['Touch', 'left thumb walks · drag right to look'],
        ],
    },
    {
        icon: 'aurora',
        title: 'Light & sky',
        rows: [
            [keys('T'), 'play / pause time'],
            [`${keys('Shift')} ${keys('T')}`, 'change speed'],
            [keys('[', ']'), 'back / ahead 15 minutes'],
            ['Light band', 'drag to scrub · presets under it'],
            ['Sky button', 'weather, aurora forecast, wake the lights'],
        ],
    },
    {
        icon: 'compass',
        title: 'More',
        rows: [
            [keys('G'), 'guided tour · ← → Space Esc'],
            [keys('M'), 'corner map · click it to enlarge'],
            [keys('X'), 'find the arctic fox'],
            [keys('O'), 'sound'],
            [keys('H'), 'hide the interface'],
            [keys('Esc'), 'close cards and panels'],
        ],
    },
];
/** Overlay listing every control. */
export class Help {
    root;
    open = false;
    onOpenChange = () => { };
    constructor() {
        this.root = el('div', 'help');
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-label', 'Controls');
        const sheet = el('div', 'help__sheet');
        const head = el('div', 'help__head', '<span class="help__kicker">Foxfire Fjord</span><span class="help__title">Controls</span>');
        head.appendChild(button('icon-btn help__close', ICON.close, 'Close (Esc)', () => this.close()));
        const grid = el('div', 'help__grid');
        for (const s of HELP_SECTIONS) {
            const sec = el('section', 'help__sec');
            sec.innerHTML = `<h4>${ICON[s.icon]}<span>${s.title}</span></h4><dl>${s.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
            grid.appendChild(sec);
        }
        const foot = el('p', 'help__foot', `${ICON.aurora}<span>The aurora peaks around 22:30 — scrub the light band to the night, or press <kbd>T</kbd> and let the polar day go by.</span>`);
        sheet.append(head, grid, foot);
        this.root.appendChild(sheet);
        this.root.addEventListener('click', (e) => {
            if (e.target === this.root)
                this.close();
        });
    }
    get isOpen() {
        return this.open;
    }
    toggle() {
        if (this.open)
            this.close();
        else
            this.show();
    }
    show() {
        this.open = true;
        document.exitPointerLock?.();
        this.root.classList.add('is-open');
        this.onOpenChange(true);
    }
    close() {
        if (!this.open)
            return;
        this.open = false;
        this.root.classList.remove('is-open');
        this.onOpenChange(false);
    }
}
