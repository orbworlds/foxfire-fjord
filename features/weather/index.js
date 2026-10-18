/**
 * Weather and atmosphere close to the ground: falling snow round the camera
 * when the sky's weather turns to snow (snowfall.ts), diamond dust glittering
 * in the clear cold air (dust.ts), spindrift banners streaming off the
 * summits of the Teeth and Fox Peak in the wind (plumes.ts), ice fog settling
 * on Mirror Lake on still nights and sea smoke rising off the fjord's open
 * water at dawn (a carpet of mist on the ice or the water, layer.ts, with
 * drifting banks and columns standing in it, mist.ts). Warm lamps near the
 * camera light the flakes and the crystals (lamps.ts). Everything follows the
 * sky's eased weather (`sky.weatherLook`), the clock and the gusts in
 * `shared.uWindStrength`, and costs nothing while it is switched off.
 *
 * URL: ?wx=snow:1,dust:1,plumes:1,fog:1,smoke:1 forces levels (0..1) for testing.
 * API (ctx.getFeature<WeatherApi>('weather').api): levels(), force(name, level | null).
 */
import * as THREE from 'three';
import { LAKE, HOUSE, VILLAGE } from '../../world/layout.js';
import { mulberry32 } from '../../world/noise.js';
import { pixelScale } from './common.js';
import { LampSet } from './lamps.js';
import { Snowfall } from './snowfall.js';
import { DiamondDust } from './dust.js';
import { Plumes } from './plumes.js';
import { Mist } from './mist.js';
import { MistLayer } from './layer.js';
const smooth = THREE.MathUtils.smoothstep;
const bump = (h, a, b, c, d) => smooth(h, a, b) * (1 - smooth(h, c, d));
const ICE_FOG = {
    name: 'ice-fog',
    life: [40, 70],
    width: [50, 90],
    height: [4, 14],
    drift: 0.5,
    rise: 0,
    jitter: 24,
    opacity: 2.2,
    wisps: 0,
    flatten: true,
    soft: 4,
    near: [3, 14],
};
const SEA_SMOKE = {
    name: 'sea-smoke',
    life: [14, 26],
    width: [7, 16],
    height: [8, 20],
    drift: 2.2,
    rise: 0.25,
    jitter: 40,
    opacity: 0.9,
    wisps: 1,
    flatten: false,
    soft: 5,
    near: [8, 30],
};
function lakeBases(ctx, n) {
    const rnd = mulberry32(777);
    const out = [];
    const cr = Math.cos(LAKE.rot);
    const sr = Math.sin(LAKE.rot);
    for (let tries = 0; out.length < n && tries < n * 40; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.92;
        const u = Math.cos(a) * r * LAKE.rx;
        const v = Math.sin(a) * r * LAKE.rz;
        const x = LAKE.x + u * cr - v * sr;
        const z = LAKE.z + u * sr + v * cr;
        if (Math.abs(ctx.world.heightAtFast(x, z) - LAKE.y) > 0.4)
            continue;
        out.push({ x, y: LAKE.y, z, k: 0.75 + 0.25 * rnd() });
    }
    return out;
}
function seaBases(ctx, n) {
    const ocean = ctx.getFeature('ocean')?.api;
    const rnd = mulberry32(9071);
    const cand = [];
    const views = [
        { x: HOUSE.x, z: HOUSE.z - 300, s: 900, w: 1 },
        { x: VILLAGE.harbor.x, z: VILLAGE.harbor.z, s: 450, w: 0.6 },
    ];
    for (let z = -1500; z <= -60; z += 30) {
        for (let x = -1700; x <= 1300; x += 30) {
            const jx = x + (rnd() - 0.5) * 26;
            const jz = z + (rnd() - 0.5) * 26;
            if (ctx.world.heightAtFast(jx, jz) > -2.5)
                continue;
            let open = 1;
            if (ocean) {
                const ice = ocean.iceAt(jx, jz);
                open = (1 - ice.fast) * (1 - 0.75 * ice.drift) * (1 - 0.5 * ice.slush);
            }
            if (open < 0.3)
                continue;
            let w = 0;
            for (const v of views)
                w += v.w * Math.exp(-Math.hypot(jx - v.x, jz - v.z) / v.s);
            cand.push({ x: jx, z: jz, k: open, w: w * open });
        }
    }
    // weighted picks without replacement (Efraimidis-Spirakis keys)
    const keyed = cand.map((c) => ({ c, key: Math.pow(rnd(), 1 / Math.max(c.w, 1e-6)) }));
    keyed.sort((a, b) => b.key - a.key);
    return keyed.slice(0, n).map(({ c }) => ({ x: c.x, y: 0, z: c.z, k: 0.6 + 0.4 * c.k }));
}
function parseForce() {
    const out = {};
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('wx') : null;
    if (!v)
        return out;
    for (const part of v.split(',')) {
        const [k, val] = part.split(':');
        const n = Number(val ?? '1');
        if (['snow', 'dust', 'plumes', 'fog', 'smoke'].includes(k) && Number.isFinite(n))
            out[k] = n;
    }
    return out;
}
const create = (ctx) => {
    const t0 = performance.now();
    const root = new THREE.Group();
    root.name = 'weather';
    // particles neither carry snow nor shelter the ground under them
    root.userData.snow = 0;
    root.userData.shelter = false;
    const q = ctx.quality;
    const lamps = new LampSet(ctx);
    const dustCount = (s) => Math.round(Math.min(6000, Math.max(800, s * 0.6)));
    const snowfall = new Snowfall(ctx, lamps, q.snowfall);
    const dust = new DiamondDust(ctx, lamps, dustCount(q.snowfall));
    const plumes = new Plumes(ctx, q.name === 'low' ? 10 : q.name === 'medium' ? 14 : 18);
    const tier = q.name === 'low' ? 0 : q.name === 'medium' ? 1 : 2;
    const fog = new Mist(ctx, ICE_FOG, lakeBases(ctx, [14, 22, 30][tier]), 31);
    const smoke = new Mist(ctx, SEA_SMOKE, seaBases(ctx, [40, 70, 100][tier]), 47);
    const ocean = ctx.getFeature('ocean')?.api;
    const world = ctx.world;
    // the carpets the banks and columns stand in
    const lakeCarpet = new MistLayer(ctx, {
        name: 'ice-fog-carpet',
        box: { minX: LAKE.x - LAKE.rx - 30, maxX: LAKE.x + LAKE.rx + 30, minZ: LAKE.z - LAKE.rz - 50, maxZ: LAKE.z + LAKE.rz + 50 },
        y0: LAKE.y,
        thick: 5,
        density: 0.012,
        floor: 0.25,
        res: [96, 64],
        mask: (x, z) => (Math.abs(world.heightAtFast(x, z) - LAKE.y) < 0.35 ? 1 : 0),
        drift: 0.6,
        scales: [512, 128],
    });
    const seaCarpet = new MistLayer(ctx, {
        name: 'sea-smoke-carpet',
        box: { minX: -1700, maxX: 1300, minZ: -1500, maxZ: -60 },
        y0: 0.3,
        thick: 5,
        density: 0.0032,
        floor: 0,
        res: [192, 96],
        mask: (x, z) => {
            if (world.heightAtFast(x, z) > -1.5)
                return 0;
            if (!ocean)
                return 1;
            const i = ocean.iceAt(x, z);
            return (1 - i.fast) * (1 - 0.75 * i.drift) * (1 - 0.5 * i.slush);
        },
        drift: 2.0,
        scales: [512, 128],
    });
    root.add(plumes.mesh, lakeCarpet.mesh, seaCarpet.mesh, fog.mesh, smoke.mesh, snowfall.mesh, dust.mesh);
    const offQuality = ctx.events.on('quality-changed', () => {
        snowfall.setCount(ctx.quality.snowfall);
        dust.setCount(dustCount(ctx.quality.snowfall));
    });
    const forced = parseForce();
    const levels = { snow: 0, dust: 0, plumes: 0, fog: 0, smoke: 0 };
    const timings = { build: Math.round(performance.now() - t0), crests: plumes.crests.length, fog: fog.count, smoke: smoke.count };
    root.userData.timings = timings;
    const api = {
        levels: () => ({ ...levels }),
        force(layer, level) {
            if (level === null)
                delete forced[layer];
            else
                forced[layer] = level;
        },
    };
    return {
        id: 'weather',
        object: root,
        api,
        update(dt) {
            const sh = ctx.shared;
            const W = ctx.sky.weatherLook;
            const h = ctx.sky.hours;
            const night = sh.uNight.value;
            const wind = sh.uWindStrength.value;
            const clear = 1 - W.overcast;
            const snow = sh.uSnowfall.value;
            const calm = 1 - smooth(wind, 0.45, 0.95);
            const morning = bump(h, 4.5, 6.5, 10, 12.5);
            levels.snow = snow;
            // ice crystals in clear, cold, still air: the halo weather, best at night
            levels.dust = THREE.MathUtils.clamp(W.ice / 0.75, 0, 1) * clear * (1 - snow) * (0.25 + 0.75 * night) * (0.5 + 0.5 * calm);
            // the wind aloft tears snow off the crests; cloud hides them when it snows
            levels.plumes = clear * (0.35 + 0.65 * smooth(wind, 0.25, 0.75));
            // ice fog: still, clear nights and the early morning over the lake
            levels.fog = (0.3 + 0.7 * clear) * Math.max(night, 0.85 * morning) * (0.4 + 0.6 * calm);
            // sea smoke: coldest at dawn, a little all night
            levels.smoke = (0.12 * night + 0.88 * bump(h, 5, 7, 10.5, 13)) * (1 - 0.5 * W.overcast);
            for (const k of Object.keys(forced))
                levels[k] = forced[k];
            const px = pixelScale(ctx);
            const cam = ctx.camera.position;
            if (levels.snow > 0.004 || levels.dust > 0.004)
                lamps.update(dt, cam);
            snowfall.update(dt, levels.snow, px);
            dust.update(dt, levels.dust, px);
            plumes.update(dt, levels.plumes, wind);
            fog.update(levels.fog);
            smoke.update(levels.smoke);
            lakeCarpet.update(dt, levels.fog);
            seaCarpet.update(dt, levels.smoke);
        },
        dispose() {
            offQuality();
            snowfall.dispose();
            dust.dispose();
            plumes.dispose();
            fog.dispose();
            smoke.dispose();
            lakeCarpet.dispose();
            seaCarpet.dispose();
        },
    };
};
export default create;
