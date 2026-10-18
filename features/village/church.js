/**
 * Lysvik church on the top terrace: a small white wooden church with a steep
 * slate roof under snow, tall round-headed windows that glow through the
 * evening, a lower chancel, and a west-front tower (here facing the village)
 * with clock dials lit after dark (the feature turns the hands to the world's
 * time), louvred belfry openings and an octagonal spire. Around it the
 * churchyard: a white picket fence, rows of grave markers humped with snow,
 * candles in little lanterns on many graves, a cleared path from the gate,
 * lamps on the gate posts and a stone stair up from the lane.
 */
import { Frame, IDENTITY } from './builder.js';
import { mulberry32 } from '../../world/noise.js';
import { STYLE, GLOW, SCHED, snapSeed } from './materials.js';
import { wallFrames, WHITE } from './kit.js';
import { gableRoof } from './roofs.js';
import { CARD } from './textures.js';
const SLATE = [0.035, 0.038, 0.045];
export function buildChurch(k, plan) {
    const cy = plan.churchyard;
    const lot = cy.church;
    const r = mulberry32(lot.seed);
    // B: the nave's long axis along local x, +x toward the tower and the stair
    const F = Frame.facing(lot.x, lot.y, lot.z, lot.fx, lot.fz);
    const B = F.child(0, 0, 0, -Math.PI / 2);
    const L = lot.d;
    const W = lot.w;
    const wallH = 5.8;
    const seed = 0.37;
    const white = [0.82, 0.81, 0.77];
    const churchGlow = (i) => ({ threshold: 0.05, warmth: 0.85, intensity: 0.5 + 0.08 * Math.sin(i * 3.1), seed: 0.2 + i * 0.07, sched: SCHED.church });
    /* ---- nave ---- */
    k.plinth(B, L + 0.1, W + 0.1, 0.02, cy.pad.y - lot.y, seed, true);
    const walls = wallFrames(B, L, W);
    for (const wf of walls)
        k.wall(wf, 0, wallH, STYLE.clap, 1, white, seed);
    cornerTrim(k, B, L, W, wallH);
    const nWin = 4;
    for (const i of [0, 2]) {
        const wf = walls[i];
        for (let j = 0; j < nWin; j++) {
            const x = wf.L * ((j + 0.75) / (nWin + 0.5));
            k.opening(wf, x - 0.55, 1.7, 1.1, 2.9, GLOW.church, WHITE, churchGlow(j + i), { trim: WHITE, pool: 0.25, ground: cy.pad.y, minPx: 2.4, gain: 2.4 });
        }
    }
    const navRoof = {
        w: L,
        d: W,
        y: wallH,
        pitch: 1.08,
        eave: 0.5,
        verge: 0.35,
        cover: SLATE,
        coverStyle: STYLE.roofTile,
        trim: WHITE,
        soffit: WHITE,
        gable: { st: STYLE.clap, variant: 1, tint: white, seed },
        snow: 0.4,
        icicles: 0.35,
        seed: 4141,
    };
    const roof = gableRoof(k, B, navRoof);
    /* ---- chancel (away from the village) ---- */
    const cD = 5.2;
    const cW = 6.2;
    const C = B.child(-L / 2 - cD / 2 + 0.05, 0, 0, 0);
    k.plinth(C, cD + 0.1, cW + 0.1, 0.02, cy.pad.y - lot.y, seed, true);
    const cWalls = wallFrames(C, cD, cW);
    for (const i of [0, 2, 3])
        k.wall(cWalls[i], 0, 4.6, STYLE.clap, 1, white, seed);
    cornerTrim(k, C, cD, cW, 4.6);
    for (const i of [0, 2])
        k.opening(cWalls[i], cD / 2 - 0.5, 1.6, 1.0, 2.3, GLOW.church, WHITE, churchGlow(7 + i), { trim: WHITE, minPx: 2.2 });
    k.opening(cWalls[3], cW / 2 - 0.35, 2.4, 0.7, 1.4, GLOW.church, WHITE, churchGlow(9), { trim: WHITE });
    gableRoof(k, C, { ...navRoof, w: cD + 0.4, d: cW, y: 4.6, eave: 0.4, verge: 0.3, closed: '+x', seed: 4242 });
    /* ---- tower ---- */
    const tS = 4.6;
    const T = B.child(L / 2 + tS / 2 - 0.05, 0, 0, 0);
    const tH = 15.2;
    k.plinth(T, tS + 0.1, tS + 0.1, 0.02, cy.stairTop[1] - lot.y - 0.2, seed, true);
    const tWalls = wallFrames(T, tS, tS);
    for (const wf of tWalls)
        k.wall(wf, 0, tH, STYLE.clap, 1, white, seed);
    cornerTrim(k, T, tS, tS, tH);
    const Fa = k.facade;
    // cornices between the stages
    for (const [y, h] of [
        [wallH + 0.25, 0.18],
        [tH - 2.4, 0.16],
        [tH, 0.26],
    ]) {
        Fa.frame = T;
        k.style(Fa, STYLE.paint, 0, 0, seed);
        Fa.setColor(WHITE);
        Fa.box(0, y, 0, tS + 0.24, h, tS + 0.24, '');
        k.nearSnow.frame = T;
        for (const [ox, oz, sx, sz] of [
            [0, tS / 2 + 0.06, tS + 0.24, 0.13],
            [0, -tS / 2 - 0.06, tS + 0.24, 0.13],
            [tS / 2 + 0.06, 0, 0.13, tS],
            [-tS / 2 - 0.06, 0, 0.13, tS],
        ])
            k.pillow(k.nearSnow, ox, y + h / 2, oz, sx, sz, 0.05, y * 3 + ox, 4, 1);
    }
    // the door in the tower front, a round window above it, a lamp over the door
    const front = tWalls[1];
    Fa.frame = front.f;
    k.style(Fa, STYLE.panel, 1, 0, seed);
    Fa.setColor([0.24, 0.05, 0.03]);
    Fa.box(tS / 2, 1.3, 0.03, 1.6, 2.6, 0.06, 'z');
    k.style(Fa, STYLE.paint, 0, 0, seed);
    Fa.setColor(WHITE);
    Fa.box(tS / 2, 1.3, 0.05, 0.05, 2.6, 0.05, 'z');
    Fa.box(tS / 2 - 0.86, 1.36, 0.06, 0.14, 2.75, 0.1, 'z');
    Fa.box(tS / 2 + 0.86, 1.36, 0.06, 0.14, 2.75, 0.1, 'z');
    // pediment over the door
    Fa.polyN([
        [tS / 2 - 1.1, 2.75, 0.14],
        [tS / 2 + 1.1, 2.75, 0.14],
        [tS / 2, 3.35, 0.14],
    ], null, [0, 0, 1]);
    Fa.box(tS / 2, 2.73, 0.08, 2.3, 0.08, 0.2, '');
    k.opening(front, tS / 2 - 0.45, 6.6, 0.9, 1.6, GLOW.church, WHITE, churchGlow(11), { trim: WHITE });
    const doorLampG = { threshold: 0.04, warmth: 0.7, intensity: 1.8, seed: 0.4, sched: SCHED.street };
    k.lampGlass(k.glow, front.f, tS / 2, 3.65, 0.22, 0.18, 0.28, 0.18, doorLampG, { size: 0.4, minPx: 2, gain: 1.6 });
    k.groundPool(front.f.wx(tS / 2, 2.5), front.f.wz(tS / 2, 2.5), 4, doorLampG, 0.6, cy.pad.y);
    // belfry: louvred openings on all four sides
    for (const wf of tWalls) {
        Fa.frame = wf.f;
        k.style(Fa, STYLE.paint, 0, 0, seed);
        Fa.setColor([0.05, 0.05, 0.055]);
        const y0 = tH - 2.1;
        Fa.box(tS / 2, y0 + 0.85, 0.01, 1.3, 1.7, 0.02, 'z');
        Fa.setColor(WHITE);
        for (let i = 0; i < 6; i++)
            Fa.box(tS / 2, y0 + 0.2 + i * 0.27, 0.05, 1.3, 0.05, 0.1, 'z');
        Fa.box(tS / 2 - 0.71, y0 + 0.85, 0.05, 0.12, 1.9, 0.1, 'z');
        Fa.box(tS / 2 + 0.71, y0 + 0.85, 0.05, 0.12, 1.9, 0.1, 'z');
    }
    // the octagonal spire, a ball and a cross
    Fa.frame = T;
    k.style(Fa, STYLE.roofMetal, 0, 0, seed);
    Fa.setColor([0.075, 0.08, 0.09]);
    const spireH = 10.5;
    Fa.cylinder(0, tH + 0.13, 0, tS * 0.6, tS * 0.42, 0.7, 8, false);
    Fa.cylinder(0, tH + 0.83, 0, tS * 0.42, 0.04, spireH, 8, false);
    // snow lying on the spire's bell-cast foot
    k.snow.frame = T;
    k.snow.cylinder(0, tH + 0.16, 0, tS * 0.6 + 0.05, tS * 0.42 + 0.06, 0.62, 8, false);
    // clock faces on three sides of the tower, the dials lit after dark (the hands are drawn by the feature)
    const clocks = [];
    const yC = tH - 3.75;
    const rC = 0.62;
    for (const wi of [0, 1, 2]) {
        const wf = tWalls[wi];
        const G = k.glow;
        G.frame = wf.f;
        G.setColor([1, 0.97, 0.9]);
        const g = { threshold: 0.05, warmth: 0.85, intensity: 0.55, seed: 0.3 + wi * 0.1, sched: SCHED.street };
        G.set('aGlow', g.threshold, g.warmth, g.intensity, snapSeed(g.seed));
        G.set('aKind', GLOW.lamp, SCHED.street, 1, 1);
        const dial = [];
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            dial.push([tS / 2 + Math.cos(a) * rC, yC + Math.sin(a) * rC, 0.035]);
        }
        G.polyN(dial, null, [0, 0, 1]);
        k.light(wf.f.wx(tS / 2, 0.2), lot.y + yC, wf.f.wz(tS / 2, 0.2), g, 1.0, 1.6, 1.2, [wf.f.ezx, 0, wf.f.ezz]);
        // a dark rim and the hour marks
        Fa.frame = wf.f;
        k.style(Fa, STYLE.paint, 0, 0, seed);
        Fa.setColor([0.035, 0.035, 0.04]);
        for (let i = 0; i < 24; i++) {
            const a0 = (i / 24) * Math.PI * 2;
            const a1 = ((i + 1) / 24) * Math.PI * 2;
            Fa.beam([tS / 2 + Math.cos(a0) * (rC + 0.03), yC + Math.sin(a0) * (rC + 0.03), 0.04], [tS / 2 + Math.cos(a1) * (rC + 0.03), yC + Math.sin(a1) * (rC + 0.03), 0.04], 0.07, 0.04);
        }
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const len = i % 3 === 0 ? 0.13 : 0.08;
            const rr = rC - 0.05 - len / 2;
            Fa.beam([tS / 2 + Math.cos(a) * (rr - len / 2), yC + Math.sin(a) * (rr - len / 2), 0.045], [tS / 2 + Math.cos(a) * (rr + len / 2), yC + Math.sin(a) * (rr + len / 2), 0.045], 0.035, 0.01);
        }
        clocks.push({ x: wf.f.wx(tS / 2, 0.06), y: lot.y + yC, z: wf.f.wz(tS / 2, 0.06), nx: wf.f.ezx, nz: wf.f.ezz, r: rC });
    }
    const tip = tH + 0.83 + spireH;
    k.style(Fa, STYLE.paint, 0, 0, seed);
    Fa.setColor([0.55, 0.42, 0.18]);
    Fa.blob(0, tip + 0.1, 0, 0.16, 0.16, 0.16, 0, 3, 1);
    Fa.box(0, tip + 0.9, 0, 0.07, 1.4, 0.07, '');
    Fa.box(0, tip + 1.15, 0, 0.6, 0.07, 0.07, '');
    /* ---- churchyard ---- */
    const pad = cy.pad;
    const inset = 1.6;
    const fx0 = pad.minX + inset;
    const fx1 = pad.maxX - inset;
    const fz0 = pad.minZ + inset;
    const fz1 = pad.maxZ - inset;
    const gateX = cy.stairTop[0];
    const fence = [
        [gateX - 1.8, fz0],
        [fx0, fz0],
        [fx0, fz1],
        [fx1, fz1],
        [fx1, fz0],
        [gateX + 1.8, fz0],
    ];
    pickets(k, fence, pad.y);
    // gate posts with lamps
    for (const sx of [-1, 1]) {
        const x = gateX + sx * 1.8;
        // rendered white gate pillars with a cap
        const Fa2 = k.facade;
        Fa2.frame = IDENTITY;
        k.style(Fa2, STYLE.concrete, 0, 0, x);
        Fa2.setColor([0.8, 0.8, 0.77]);
        Fa2.box(x, pad.y + 0.6, fz0, 0.5, 1.4, 0.5, 'y', 0.6);
        k.style(Fa2, STYLE.paint, 0, 0, x);
        Fa2.setColor([0.62, 0.62, 0.6]);
        Fa2.box(x, pad.y + 1.33, fz0, 0.62, 0.07, 0.62, '');
        k.nearSnow.frame = IDENTITY;
        k.pillow(k.nearSnow, x, pad.y + 1.36, fz0, 0.64, 0.64, 0.12, x, 3, 3, 0.02);
        const g = { threshold: 0.04, warmth: 0.75, intensity: 1.6, seed: 0.5 + sx * 0.1, sched: SCHED.street };
        k.lampGlass(k.glow, IDENTITY, x, pad.y + 1.6, fz0, 0.2, 0.32, 0.2, g, { size: 0.4, minPx: 2, gain: 1.6 });
        k.groundPool(x, fz0 + 1.5, 3.2, g, 0.45, pad.y);
    }
    // the cleared path from the gate to the door
    {
        const P = k.paving;
        P.frame = IDENTITY;
        P.setColor([1, 1, 1]);
        const zA = fz0 - 0.2;
        const zB = front.f.wz(tS / 2, 0.4);
        const hw = 1.1;
        P.set('aLane', 0, 0, hw, 0);
        P.polyN([
            [gateX - hw, pad.y + 0.03, zA],
            [gateX + hw, pad.y + 0.03, zA],
            [gateX + hw, pad.y + 0.03, zB],
            [gateX - hw, pad.y + 0.03, zB],
        ], null, [0, 1, 0]);
        k.bank(k.snow, sampleLine(gateX - hw - 0.5, zA + 0.5, gateX - hw - 0.5, zB - 0.3, 1.2), 0.9, 0.35, 5, () => pad.y);
        k.bank(k.snow, sampleLine(gateX + hw + 0.5, zA + 0.5, gateX + hw + 0.5, zB - 0.3, 1.2), 0.9, 0.35, 6, () => pad.y);
    }
    // graves in rows either side of the church
    let graves = 0;
    let candles = 0;
    const keepOut = (x, z) => {
        const lx = x - lot.x;
        const lz = z - lot.z;
        // church + tower + chancel (axis along z here)
        if (Math.abs(lx) < W / 2 + 2.2 && lz > -(L / 2 + tS + 2.5) && lz < L / 2 + cD + 2)
            return true;
        if (Math.abs(x - gateX) < 2.2 && z < fz0 + 6)
            return true;
        return false;
    };
    const N = k.nearFacade;
    const gx0 = Math.max(fx0 + 1.4, lot.x - 31);
    const gx1 = Math.min(fx1 - 1.2, lot.x + 31);
    for (let z = fz0 + 3.5; z < fz1 - 1.2; z += 2.7) {
        const rowShift = (r() - 0.5) * 0.8;
        for (let x = gx0; x < gx1; x += 1.5 + r() * 0.5) {
            const jx = x + rowShift + (r() - 0.5) * 0.3;
            const jz = z + (r() - 0.5) * 0.35;
            // family plots in clusters, gaps between them
            const plot = Math.sin(jx * 0.35 + 1.3) * Math.sin(jz * 0.5 + 0.7);
            // the older plots near the church are full; the newer rows toward the fence thin out
            const outer = Math.min(1, Math.max(0, (Math.abs(jx - lot.x) - 18) / 13));
            if (keepOut(jx, jz) || r() < 0.35 + 0.3 * Math.max(0, -plot) + 0.3 * outer)
                continue;
            graves++;
            const y = pad.y;
            const kind = r();
            if (kind < 0.42) {
                // a granite headstone: polished black, grey or pale, some with a shaped top
                N.frame = IDENTITY;
                k.style(N, STYLE.concrete, 0, 0, jx);
                const tone = r();
                const sc = tone < 0.2 ? [0.05, 0.05, 0.055] : tone < 0.6 ? [0.4, 0.4, 0.41] : [0.64, 0.62, 0.58];
                N.setColor(sc);
                const h = 0.5 + r() * 0.4;
                const wS = 0.5 + r() * 0.25;
                N.box(jx, y + h / 2 - 0.15, jz, wS, h, 0.14, 'y');
                if (r() < 0.5)
                    N.box(jx, y + h - 0.15 + 0.05, jz, wS * 0.62, 0.1, 0.14, 'y');
                // a plinth at the foot
                N.box(jx, y - 0.05, jz, wS + 0.12, 0.2, 0.26, 'y');
                // a cushion of snow on top, overhanging a little: from above each stone reads white
                k.nearSnow.frame = IDENTITY;
                k.pillow(k.nearSnow, jx, y + h - 0.15, jz, wS + 0.08, 0.24, 0.1 + r() * 0.06, jx * 3 + jz, 4, 2, 0.03);
            }
            else {
                // white wooden cross
                N.frame = IDENTITY;
                k.style(N, STYLE.paint, 0, 0, seed);
                N.setColor(WHITE);
                N.box(jx, y + 0.45, jz, 0.07, 1.0, 0.07, '');
                N.box(jx, y + 0.72, jz, 0.5, 0.07, 0.07, '');
                // snow on the arms and the post top
                k.nearSnow.frame = IDENTITY;
                k.pillow(k.nearSnow, jx, y + 0.755, jz, 0.54, 0.1, 0.05, jx * 5 + jz, 4, 2, 0.01);
                k.pillow(k.nearSnow, jx, y + 0.95, jz, 0.1, 0.1, 0.05, jx * 7 + jz, 2, 2, 0.01);
            }
            // the grave's mound of snow
            k.nearSnow.frame = IDENTITY;
            k.pillow(k.nearSnow, jx, y, jz + 0.95, 0.75, 1.5, 0.22, jx + jz * 7, 3, 4);
            if (r() < 0.3) {
                candles++;
                const g = { threshold: 0.12 + r() * 0.15, warmth: 0.9, intensity: 1.0, seed: r(), sched: SCHED.candle };
                const G = k.nearGlow;
                G.frame = IDENTITY;
                G.setColor([0.2, 0.2, 0.2]);
                G.set('aGlow', g.threshold, g.warmth, g.intensity, snapSeed(g.seed));
                G.set('aKind', GLOW.candle, SCHED.candle, 0.11, 0.17);
                const cx = jx + (r() - 0.5) * 0.4;
                const cz = jz + 0.28;
                for (const [nx, nz] of [
                    [0, 1],
                    [1, 0],
                    [0, -1],
                    [-1, 0],
                ]) {
                    const px = -nz;
                    const pz = nx;
                    const hw = 0.055;
                    G.polyN([
                        [cx + nx * hw - px * hw, y + 0.02, cz + nz * hw - pz * hw],
                        [cx + nx * hw + px * hw, y + 0.02, cz + nz * hw + pz * hw],
                        [cx + nx * hw + px * hw, y + 0.19, cz + nz * hw + pz * hw],
                        [cx + nx * hw - px * hw, y + 0.19, cz + nz * hw - pz * hw],
                    ], [
                        [0, 0],
                        [0.11, 0],
                        [0.11, 0.17],
                        [0, 0.17],
                    ], [nx, 0, nz]);
                }
                k.light(cx, y + 0.12, cz, g, 0.12, 1.1, 1.2);
                k.groundPool(cx, cz, 0.7, g, 0.35, y);
            }
        }
    }
    // spruces at the back corners, birches along the sides
    const tree = (x, z, kind, s) => {
        if (keepOut(x, z))
            return;
        k.trees.push({ x, y: pad.y, z, kind, s, seed: Math.floor(r() * 1e6) });
    };
    tree(fx0 + 2.2, fz1 - 2.5, 'spruce', 1.1);
    tree(fx1 - 2.2, fz1 - 2.8, 'spruce', 1.0);
    tree(fx0 + 1.6, (fz0 + fz1) / 2 + 3, 'birch', 0.9);
    tree(fx1 - 1.6, (fz0 + fz1) / 2 - 2, 'birch', 0.85);
    /* ---- the stair up from the lane ---- */
    const [ax, ay, az] = cy.stairFoot;
    const [bx, by, bz] = cy.stairTop;
    const rise = by - ay;
    const n = Math.max(3, Math.round(rise / 0.16));
    const run = bz - az;
    const hw = 1.6;
    const sxC = (ax + bx) / 2;
    const Fs = k.facade;
    Fs.frame = IDENTITY;
    const P = k.paving;
    P.frame = IDENTITY;
    P.setColor([1, 1, 1]);
    // each tread sits on the slope where the ground bulges above the straight flight
    const treadTop = (i) => {
        const z0 = az + (run * i) / n;
        const z1 = az + (run * (i + 1)) / n;
        return Math.max(ay + (rise * (i + 1)) / n, Math.max(k.h(sxC - hw, z1), k.h(sxC + hw, z1), k.h(sxC, (z0 + z1) / 2)) + 0.05);
    };
    for (let i = 0; i < n; i++) {
        const top = treadTop(i);
        const z0 = az + (run * i) / n;
        const z1 = az + (run * (i + 1)) / n + 0.03;
        const g = Math.min(k.h(sxC, z0), k.h(sxC, z1)) - 0.3;
        k.style(Fs, STYLE.concrete, 0, 0, i);
        Fs.setColor([0.6, 0.6, 0.58]);
        Fs.box(sxC, (top + g) / 2, (z0 + z1) / 2, hw * 2, top - g, z1 - z0, 'Y', 1);
        // the tread: swept snow, footprints down the middle
        P.set('aLane', 0, 0, hw, 0);
        P.polyN([
            [sxC - hw, top + 0.01, z0],
            [sxC + hw, top + 0.01, z0],
            [sxC + hw, top + 0.01, z1],
            [sxC - hw, top + 0.01, z1],
        ], null, [0, 1, 0]);
    }
    // cheek walls following the stair, snow on their copings, an iron handrail down the middle
    for (const side of [-1, 1]) {
        const x = sxC + side * (hw + 0.28);
        for (let i = 0; i < n; i += 2) {
            const i1 = Math.min(n, i + 2);
            const top = treadTop(i1 - 1) + 0.45;
            const z0 = az + (run * i) / n - 0.02;
            const z1 = az + (run * i1) / n + 0.02;
            const g = Math.min(k.h(x, z0), k.h(x, z1)) - 0.4;
            k.style(Fs, STYLE.concrete, 0, 0, x + i);
            Fs.setColor([0.74, 0.74, 0.71]);
            Fs.box(x, (top + g) / 2, (z0 + z1) / 2, 0.55, top - g, z1 - z0, '', 0.3);
            k.nearSnow.frame = IDENTITY;
            k.pillow(k.nearSnow, x, top, (z0 + z1) / 2, 0.6, z1 - z0, 0.12, x * 3 + i, 2, 2);
        }
    }
    {
        const Nr = k.nearFacade;
        Nr.frame = IDENTITY;
        k.style(Nr, STYLE.paint, 0, 0, 0.2);
        Nr.setColor([0.03, 0.03, 0.035]);
        Nr.beam([sxC, ay - 0.2, az - 0.3], [sxC, ay + 0.95, az - 0.3], 0.05, 0.05);
        Nr.beam([sxC, by - 0.2, bz - 0.4], [sxC, by + 0.95, bz - 0.4], 0.05, 0.05);
        Nr.beam([sxC, ay + 0.92, az - 0.3], [sxC, by + 0.92, bz - 0.4], 0.045, 0.045);
    }
    const yaw = Math.atan2(lot.fx, lot.fz);
    const parts = [
        { x: lot.x, z: lot.z, w: W, d: L, yaw, h: roof.ridgeY + 0.5 },
        { x: T.ox, z: T.oz, w: tS, d: tS, yaw, h: tip },
        { x: C.ox, z: C.oz, w: cW, d: cD, yaw, h: 8 },
    ];
    return {
        x: lot.x,
        y: lot.y,
        z: lot.z,
        yaw,
        h: tip + 1.6,
        parts,
        graves,
        candles,
        stair: { a: [ax, ay, az], b: [bx, by, bz], hw },
        clocks,
        fence,
        yard: { cx: (pad.minX + pad.maxX) / 2, cz: (pad.minZ + pad.maxZ) / 2, ux: 1, uz: 0, hx: (pad.maxX - pad.minX) / 2, hz: (pad.maxZ - pad.minZ) / 2 },
    };
}
function cornerTrim(k, B, w, d, H) {
    const F = k.facade;
    F.frame = B;
    k.style(F, STYLE.paint, 0, 0, 0.1);
    F.setColor(WHITE);
    const t = 0.16;
    for (const sx of [-1, 1])
        for (const sz of [-1, 1])
            F.box((sx * w) / 2 - (sx * t) / 2 + sx * 0.03, H / 2, (sz * d) / 2 - (sz * t) / 2 + sz * 0.03, t, H, t, 'y');
}
function sampleLine(ax, az, bx, bz, step) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(L / step));
    const out = [];
    for (let i = 0; i <= n; i++)
        out.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
    return out;
}
/** a white picket fence along a world polyline at ground height y (alpha-cut cards, 2.4 m each) */
export function pickets(k, pts, y) {
    const C = k.cards;
    C.frame = IDENTITY;
    C.setColor([1, 1, 1]);
    const [u0, v0, u1, v1] = CARD.fence;
    const yAt = typeof y === 'number' ? () => y : y;
    for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(L / 2.4));
        for (let j = 0; j < n; j++) {
            const t0 = j / n;
            const t1 = (j + 1) / n;
            const x0 = ax + (bx - ax) * t0;
            const z0 = az + (bz - az) * t0;
            const x1 = ax + (bx - ax) * t1;
            const z1 = az + (bz - az) * t1;
            const frac = (L / n) / 2.4;
            const y0 = yAt(x0, z0) - 0.12;
            const y1 = yAt(x1, z1) - 0.12;
            const nx = -(z1 - z0);
            const nz = x1 - x0;
            C.polyN([
                [x0, y0, z0],
                [x1, y1, z1],
                [x1, y1 + 1.2, z1],
                [x0, y0 + 1.2, z0],
            ], [
                [u0, v0],
                [u0 + (u1 - u0) * frac, v0],
                [u0 + (u1 - u0) * frac, v1],
                [u0, v1],
            ], [nx, 0, nz]);
        }
        // a drift along the foot of the fence
        k.bank(k.snow, sampleLine(ax, az, bx, bz, 1.5), 0.9, 0.32, i * 7 + ax, (x, z) => yAt(x, z));
    }
}
