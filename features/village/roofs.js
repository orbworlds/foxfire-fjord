import { STYLE } from './materials.js';
import { vnoise } from './kit.js';
const T = 0.16;
export function gableRoof(k, F, r) {
    const s = r.pitch;
    const kS = Math.sqrt(1 + s * s);
    const yW = r.y + 0.18;
    const ZE = r.d / 2 + r.eave;
    const yE = yW - r.eave * s;
    const yR = yW + (r.d / 2) * s;
    const XV = r.w / 2 + r.verge;
    const closed = r.closed ?? '';
    /* ---- cover ---- */
    const C = k.facade;
    C.frame = F;
    k.style(C, r.coverStyle, 0, 0, r.seed);
    C.setColor(r.cover);
    for (const sd of [1, -1]) {
        const pts = [
            [-XV * sd, yE, ZE * sd],
            [XV * sd, yE, ZE * sd],
            [XV * sd, yR, 0],
            [-XV * sd, yR, 0],
        ];
        // u along the eave, v up the slope (m)
        const uv = pts.map((p) => [p[0] * sd, (ZE - Math.abs(p[2])) * kS]);
        C.polyN(pts, uv, [0, 1, sd * s]);
    }
    // ridge flashing
    C.box(0, yR + 0.02, 0, XV * 2 + 0.04, 0.06, 0.2, 'y');
    /* ---- fascia, barge boards, soffits ---- */
    const B = k.facade;
    B.frame = F;
    k.style(B, STYLE.paint, 0, 0, r.seed);
    B.setColor(r.trim);
    for (const sd of [1, -1]) {
        B.polyN([
            [-XV, yE - T, ZE * sd],
            [XV, yE - T, ZE * sd],
            [XV, yE + 0.02, ZE * sd],
            [-XV, yE + 0.02, ZE * sd],
        ], null, [0, 0, sd]);
    }
    for (const sx of [1, -1]) {
        if (closed.includes(sx > 0 ? '+x' : '-x'))
            continue;
        const x = XV * sx + 0.025 * sx;
        for (const sd of [1, -1]) {
            // barge board: proud of the roof, a hand's width deep, both faces
            const a = [x, yE + 0.05, (ZE + 0.03) * sd];
            const b = [x, yR + 0.07, 0];
            B.polyN([a, b, [x, yR - 0.21, 0], [x, yE - 0.21, (ZE + 0.03) * sd]], null, [sx, 0, 0]);
            B.polyN([
                [a[0] - 0.05 * sx, a[1], a[2]],
                [b[0] - 0.05 * sx, b[1], b[2]],
                [b[0] - 0.05 * sx, b[1] - 0.28, b[2]],
                [a[0] - 0.05 * sx, a[1] - 0.26, a[2]],
            ], null, [-sx, 0, 0]);
            B.polyN([
                [x - 0.05 * sx, yE + 0.05, (ZE + 0.03) * sd],
                [x, yE + 0.05, (ZE + 0.03) * sd],
                [x, yR + 0.07, 0],
                [x - 0.05 * sx, yR + 0.07, 0],
            ], null, [0, 1, 0]);
        }
    }
    const So = k.facade;
    So.frame = F;
    k.style(So, STYLE.paint, 0, 0, r.seed);
    So.setColor(r.soffit);
    for (const sd of [1, -1]) {
        So.polyN([
            [-XV, yE - T, ZE * sd],
            [XV, yE - T, ZE * sd],
            [XV, yW - T, (r.d / 2) * sd],
            [-XV, yW - T, (r.d / 2) * sd],
        ], null, [0, -1, 0]);
        for (const sx of [1, -1]) {
            if (closed.includes(sx > 0 ? '+x' : '-x'))
                continue;
            const x0 = (r.w / 2) * sx;
            const x1 = XV * sx;
            if (Math.abs(x1 - x0) < 0.02)
                continue;
            So.polyN([
                [x0, yW - T, (r.d / 2) * sd],
                [x1, yW - T, (r.d / 2) * sd],
                [x1, yR - T, 0],
                [x0, yR - T, 0],
            ], null, [0, -1, 0]);
        }
    }
    /* ---- gable triangles ---- */
    if (r.gable) {
        const g = r.gable;
        for (const sx of [1, -1]) {
            if (closed.includes(sx > 0 ? '+x' : '-x'))
                continue;
            const x0 = (sx * r.w) / 2;
            const hd = r.d / 2;
            const G = k.facade;
            G.frame = F;
            k.style(G, g.st, g.variant, 0, g.seed);
            G.setColor(g.tint);
            const pts = [
                [x0, r.y - 0.001, hd * sx],
                [x0, r.y - 0.001, -hd * sx],
                [x0, yW - T, -hd * sx],
                [x0, yR - T, 0],
                [x0, yW - T, hd * sx],
            ];
            const uv = pts.map((p) => [hd - p[2] * sx, p[1]]);
            G.polyN(pts, uv, [sx, 0, 0]);
        }
    }
    /* ---- snow ---- */
    const shed = [false, false];
    const tS = r.snow;
    const slid = r.slid ?? [0, 0];
    if (tS > 0.02) {
        const S = k.snow;
        S.frame = F;
        const tv = tS * kS;
        const nX = Math.max(3, Math.ceil((XV * 2) / 1.0));
        const xs = [];
        xs.push(-XV - 0.05);
        for (let i = 0; i <= nX; i++)
            xs.push(-XV + 0.04 + ((XV * 2 - 0.08) * i) / nX);
        xs.push(XV + 0.05);
        const edgeF = (x) => {
            const e = XV + 0.05 - Math.abs(x);
            return e <= 0.011 ? 0.03 : Math.sqrt(Math.min(1, e / 0.42));
        };
        const lumpy = (x, rr) => 1 + 0.12 * vnoise(x * 0.28 + r.seed * 0.01, rr * 0.35);
        sides.forEach((sd, si) => {
            const cut = Math.min(0.92, slid[si]);
            const reach = ZE * (1 - cut);
            const full = cut < 0.02;
            if (full)
                shed[si] = true;
            const ov = 0.12 + 0.16 * (0.5 + 0.5 * vnoise(r.seed * 0.37 + si, 1.3));
            const droop = 0.06 + 0.12 * (0.5 + 0.5 * vnoise(r.seed * 0.71 + si, 4.1));
            // rows: [r (horizontal distance from the ridge), dy above the roof surface at r]
            const rows = [];
            const along = [0, 0.3, 0.6, 0.86];
            for (const f of along) {
                const rr = f * reach;
                rows.push({ r: rr, dy: (x) => tv * edgeF(x) * lumpy(x, rr) });
            }
            if (full) {
                rows.push({ r: ZE - 0.1, dy: (x) => tv * edgeF(x) * lumpy(x, ZE) });
                const lips = [
                    [0.0, 0.97],
                    [0.45, 0.88],
                    [0.8, 0.62],
                    [1.0, 0.27],
                ];
                for (const [a, b] of lips)
                    rows.push({ r: ZE + ov * a, dy: (x) => tv * b * edgeF(x) * lumpy(x, ZE), lip: [a, b] });
                rows.push({ r: ZE + ov * 0.9, dy: (x) => -droop * 0.45 * edgeF(x), lip: [0.9, 0] });
                rows.push({ r: ZE + ov * 0.55, dy: (x) => -droop * edgeF(x), lip: [0.55, 0] });
                rows.push({ r: ZE + 0.03, dy: () => -0.05, lip: [0, 0] });
            }
            else {
                // a ragged lower edge where the rest has slid off
                rows.push({ r: reach + 0.12, dy: (x) => tv * 0.55 * edgeF(x) * lumpy(x, reach) });
                rows.push({ r: reach + 0.22, dy: () => 0.015 });
            }
            const P = [];
            for (const row of rows) {
                for (const x of xs) {
                    let rr = row.r;
                    if (!full && row.r > reach)
                        rr = row.r + 0.35 * vnoise(x * 0.8 + r.seed, si * 7.0);
                    const yRoof = rr <= ZE ? yR - rr * s : yE;
                    P.push([x, yRoof + row.dy(x), rr * sd]);
                }
            }
            const base = S.vertexCount;
            k.gridMesh(S, P, xs.length, rows.length, base, sd > 0);
        });
        // icicles under the cornices of heated houses
        if (r.icicles && r.icicles > 0) {
            sides.forEach((sd, si) => {
                if (!shed[si])
                    return;
                k.icicles(F, [-XV + 0.1, yE - T + 0.02, (ZE + 0.04) * sd], [XV - 0.1, yE - T + 0.02, (ZE + 0.04) * sd], r.icicles, 0.25 + 0.55 * (0.5 + 0.5 * vnoise(r.seed * 0.13, si * 3.3)), r.seed + si * 17);
            });
        }
    }
    const topAt = (x, z) => {
        const rr = Math.abs(z);
        const yRoof = rr <= ZE ? yR - rr * s : yE;
        return yRoof + (tS > 0.02 && Math.abs(x) < XV ? tS * kS : 0);
    };
    return { ridgeY: yR, eaveY: yE, eaveOut: r.eave, topAt, shed };
}
const sides = [1, -1];
/** A chimney through the roof at local (x, z): brick or rendered, with a cap; returns the smoke point (local). */
export function chimney(k, F, x, z, sz, yBase, yTop, brick, seed) {
    const C = k.facade;
    C.frame = F;
    const H = yTop - yBase;
    if (brick) {
        k.style(C, STYLE.brick, H, 0, seed);
        C.setColor([0.42, 0.17, 0.11]);
    }
    else {
        k.style(C, STYLE.concrete, 0, 0, seed);
        C.setColor([0.5, 0.5, 0.49]);
    }
    C.box(x, yBase + H / 2, z, sz, H, sz, 'y', 0);
    k.style(C, STYLE.paint, 0, 0, seed);
    C.setColor([0.16, 0.16, 0.17]);
    C.box(x, yTop + 0.04, z, sz + 0.12, 0.08, sz + 0.12, '');
    // a ring of snow on the cap edge (the flue keeps the middle clear)
    const S = k.nearSnow;
    S.frame = F;
    for (const [ox, oz, sx, szz] of [
        [0, (sz + 0.12) / 2 - 0.05, sz + 0.12, 0.1],
        [0, -(sz + 0.12) / 2 + 0.05, sz + 0.12, 0.1],
    ]) {
        k.pillow(S, x + ox, yTop + 0.08, z + oz, sx, szz, 0.05, seed + oz * 10, 4, 1);
    }
    return [x, yTop + 0.25, z];
}
