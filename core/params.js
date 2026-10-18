const sp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
function list(name) {
    const v = sp.get(name);
    if (!v)
        return null;
    return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function num(name) {
    const v = sp.get(name);
    if (v === null || v === '')
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function nums(name) {
    const v = sp.get(name);
    if (!v)
        return null;
    const arr = v.split(',').map(Number);
    return arr.every(Number.isFinite) ? arr : null;
}
const shot = sp.has('shot');
const weather = sp.get('weather');
export const params = {
    solo: list('solo'),
    skip: list('skip'),
    view: sp.get('view'),
    cam: nums('cam'),
    time: num('time'),
    speed: num('speed') ?? (shot ? 0 : null),
    quality: sp.get('quality') ?? null,
    ui: sp.get('ui') === '1' || (sp.get('ui') !== '0' && !shot),
    debug: sp.has('debug'),
    shot,
    intro: !(shot || sp.has('nointro') || sp.has('view') || sp.has('cam')),
    fov: num('fov'),
    mode: sp.get('mode'),
    /** tone mapping operator override: neutral | aces | agx (default: the winter grade) */
    toneMapping: sp.get('tm'),
    /** exposure bias in stops */
    ev: num('ev') ?? 0,
    /** forced aurora activity 0..1 (null = follow the clock) */
    aurora: num('aurora'),
    /** aurora clock in seconds (null = start fresh) */
    auroraT: num('auroraT'),
    /** initial weather */
    weather: (weather === 'clear' || weather === 'bank' || weather === 'snow' ? weather : null),
};
