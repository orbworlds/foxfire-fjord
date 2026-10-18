/**
 * Canvas textures for Lysvik: one atlas of alpha-cut cards (bare birch and
 * rowan crowns, a white picket fence, rows of stockfish hanging on a rack)
 * and the lettered signs of the general store and the fish landing.
 */
import { mulberry32 } from '../../world/noise.js';
import { SERIF } from '../paths/kit/text.js';
/** Atlas rectangles [u0, v0, u1, v1] (v up, as sampled with flipY). */
export const CARD = {
    birch: [0, 0.5, 0.5, 1],
    rowan: [0.5, 0.5, 1, 1],
    /** 2.4 m of fence, 1.2 m high */
    fence: [0, 0.25, 0.5, 0.5],
    /** a dense band of fish 1.6 m wide, 0.8 m deep (top edge at the pole) */
    fish: [0, 0, 0.5, 0.25],
    /** a second band of fish (heads) */
    fish2: [0.5, 0.25, 1, 0.5],
    /** a heap of fish crates / ropes? (spare) */
    spare: [0.5, 0, 1, 0.25],
};
export function cardAtlas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const px = (r) => ({ x: r[0] * size, y: (1 - r[3]) * size, w: (r[2] - r[0]) * size, h: (r[3] - r[1]) * size });
    crown(g, px(CARD.birch), 11, 'birch');
    crown(g, px(CARD.rowan), 23, 'rowan');
    fence(g, px(CARD.fence));
    fish(g, px(CARD.fish), 5, false);
    fish(g, px(CARD.fish2), 9, true);
    return c;
}
/** A bare crown: forked branches from the bottom centre to a dense haze of fine twigs. */
function crown(g, r, seed, kind) {
    const rnd = mulberry32(seed);
    g.save();
    g.beginPath();
    g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    g.clip();
    g.lineCap = 'round';
    const S = r.w / 256;
    const ends = [];
    const branch = (x, y, ang, len, wid, depth) => {
        const droop = kind === 'birch' ? 0.18 * (5 - depth) * 0.12 : -0.02;
        let cx = x;
        let cy = y;
        const steps = 4;
        for (let i = 0; i < steps; i++) {
            const a = ang + (rnd() - 0.5) * 0.35 + droop * i;
            const nx = cx + Math.sin(a) * (len / steps);
            const ny = cy - Math.cos(a) * (len / steps);
            const w = wid * (1 - (i / steps) * 0.35);
            const t = Math.min(1, depth / 4);
            // birch: white limbs going dark purple-brown in the twigs; rowan: grey-brown throughout
            const col = kind === 'birch' ? mix([232, 228, 218], [128, 96, 100], Math.pow(t, 0.6)) : mix([150, 138, 124], [118, 96, 86], t);
            g.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
            g.lineWidth = Math.max(0.6, w * S);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(nx, ny);
            g.stroke();
            // snow lying along the upper side of the thicker, flatter branches
            if (depth >= 1 && depth <= 3 && Math.abs(Math.sin(a)) > 0.45 && rnd() < 0.7) {
                g.strokeStyle = 'rgb(246,248,252)';
                g.lineWidth = Math.max(0.7, w * S * 0.45);
                g.beginPath();
                g.moveTo(cx, cy - w * S * 0.4);
                g.lineTo(nx, ny - w * S * 0.4);
                g.stroke();
            }
            cx = nx;
            cy = ny;
            ang = a;
        }
        if (depth >= 4 || len < 7) {
            ends.push([cx, cy]);
            return;
        }
        const kids = depth < 2 ? 3 : 2 + (rnd() < 0.5 ? 1 : 0);
        for (let k = 0; k < kids; k++) {
            const spread = (kind === 'birch' ? 0.75 : 0.55) * (k - (kids - 1) / 2) + (rnd() - 0.5) * 0.4;
            branch(cx, cy, ang + spread, len * (0.66 + rnd() * 0.14), wid * 0.62, depth + 1);
        }
    };
    const x0 = r.x + r.w / 2;
    const y0 = r.y + r.h;
    const limbs = kind === 'birch' ? 4 : 5;
    for (let i = 0; i < limbs; i++) {
        const a = (i - (limbs - 1) / 2) * (kind === 'birch' ? 0.42 : 0.36) + (rnd() - 0.5) * 0.2;
        branch(x0 + (rnd() - 0.5) * 6 * S, y0, a, r.h * (0.3 + rnd() * 0.06), 9, 0);
    }
    // a fine haze of twigs at the ends so the crown keeps its body from afar
    g.lineWidth = Math.max(0.5, 0.7 * S);
    g.strokeStyle = kind === 'birch' ? 'rgba(120,88,96,0.95)' : 'rgba(118,96,86,0.95)';
    for (const [ex, ey] of ends) {
        for (let k = 0; k < 3; k++) {
            const a = (rnd() - 0.5) * 2.4 + (kind === 'birch' ? Math.PI * 0.85 * (rnd() < 0.5 ? 1 : 0) : 0);
            const l = (4 + rnd() * 9) * S;
            g.beginPath();
            g.moveTo(ex, ey);
            g.lineTo(ex + Math.sin(a) * l, ey - Math.cos(a) * l);
            g.stroke();
        }
    }
    if (kind === 'rowan') {
        // clusters of red berries that last into the winter
        for (const [ex, ey] of ends) {
            if (rnd() < 0.55)
                continue;
            const n = 5 + Math.floor(rnd() * 7);
            for (let k = 0; k < n; k++) {
                const bx = ex + (rnd() - 0.5) * 7 * S;
                const by = ey + (rnd() * 6 - 1) * S;
                g.fillStyle = rnd() < 0.7 ? 'rgb(196,38,22)' : 'rgb(232,72,30)';
                g.beginPath();
                g.arc(bx, by, (1.4 + rnd()) * S, 0, Math.PI * 2);
                g.fill();
            }
        }
    }
    g.restore();
}
/** White pickets with pointed tops on two rails, 2.4 m wide (the card spans the full cell). */
function fence(g, r) {
    const m = r.w / 2.4; // px per metre (cell height = 1.2 m)
    g.save();
    g.fillStyle = 'rgb(236,234,226)';
    // rails
    for (const y of [0.32, 0.86])
        g.fillRect(r.x, r.y + r.h - y * m - 0.035 * m, r.w, 0.07 * m);
    const pw = 0.085;
    const gap = 0.065;
    const n = Math.round(2.4 / (pw + gap));
    const step = 2.4 / n;
    for (let i = 0; i < n; i++) {
        const x = r.x + (i * step + (step - pw) / 2) * m;
        const top = r.y + r.h - 1.08 * m;
        g.beginPath();
        g.moveTo(x, r.y + r.h);
        g.lineTo(x, top + 0.06 * m);
        g.lineTo(x + (pw / 2) * m, top);
        g.lineTo(x + pw * m, top + 0.06 * m);
        g.lineTo(x + pw * m, r.y + r.h);
        g.closePath();
        g.fill();
    }
    g.restore();
}
/**
 * Stockfish: headless cod tied in pairs at the tail and hung over a pole, one
 * fish on each side. From either face a row of fish with gaps between them:
 * a fanned tail at the pole, a mottled grey-olive back, a pale belly, and the
 * partners on the far side darker in the gaps. The heads hang on their own
 * racks, strung on cords.
 */
function fish(g, r, seed, heads) {
    const rnd = mulberry32(seed);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    const m = r.w / 1.6;
    const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
    for (let layer = 0; layer < 2; layer++) {
        const far = layer === 0;
        let x = r.x + (far ? 0.06 : 0) * m;
        while (x < r.x + r.w) {
            const len = (heads ? 0.24 + rnd() * 0.08 : 0.56 + rnd() * 0.2) * m;
            const wid = (heads ? 0.11 + rnd() * 0.03 : 0.085 + rnd() * 0.03) * m;
            const top = r.y + (0.02 + rnd() * 0.03) * m;
            const sway = (rnd() - 0.5) * 0.1;
            const base = 150 + rnd() * 45;
            const body = [base * 1.02, base * 0.98, base * 0.86];
            const k = far ? 0.62 : 1;
            const cx = x + wid / 2;
            const bx = cx + sway * len;
            g.fillStyle = rgb(body, k);
            g.beginPath();
            if (heads) {
                // heads strung two or three to a cord: pointed wedges, mouth down, a gill cover and a dark eye
                g.fillStyle = 'rgb(60,52,44)';
                const n = rnd() < 0.5 ? 2 : 3;
                g.fillRect(cx - 0.006 * m, top - 0.03 * m, 0.012 * m, len * (n - 0.6));
                for (let j = 0; j < n; j++) {
                    const y0 = top + j * len * 0.82;
                    const dx = (rnd() - 0.5) * wid * 0.3;
                    g.fillStyle = rgb(body, k * (0.9 + rnd() * 0.15));
                    g.beginPath();
                    g.moveTo(cx + dx - wid * 0.5, y0);
                    g.quadraticCurveTo(cx + dx, y0 - len * 0.12, cx + dx + wid * 0.5, y0);
                    g.quadraticCurveTo(cx + dx + wid * 0.42, y0 + len * 0.7, cx + dx + wid * 0.05, y0 + len);
                    g.quadraticCurveTo(cx + dx - wid * 0.42, y0 + len * 0.7, cx + dx - wid * 0.5, y0);
                    g.fill();
                    if (!far) {
                        g.fillStyle = 'rgba(70,60,50,0.5)';
                        g.fillRect(cx + dx - wid * 0.35, y0 + len * 0.3, wid * 0.7, len * 0.08);
                        g.fillStyle = 'rgb(25,22,20)';
                        g.beginPath();
                        g.arc(cx + dx + wid * 0.15, y0 + len * 0.55, wid * 0.08, 0, Math.PI * 2);
                        g.fill();
                    }
                }
            }
            else {
                // tail fanned at the pole, a narrow wrist, the body swelling to the cut neck
                g.moveTo(cx - wid * 0.62, top);
                g.lineTo(cx + wid * 0.62, top);
                g.lineTo(cx + wid * 0.12, top + len * 0.13);
                g.quadraticCurveTo(cx + wid * 0.66 + sway * len * 0.5, top + len * 0.55, bx + wid * 0.48, top + len);
                g.lineTo(bx - wid * 0.48, top + len * 0.96);
                g.quadraticCurveTo(cx - wid * 0.66 + sway * len * 0.5, top + len * 0.55, cx - wid * 0.12, top + len * 0.13);
                g.closePath();
                g.fill();
                if (!far) {
                    // the dark back down one side, the pale split belly down the other, a darker cut at the neck
                    const flip = rnd() < 0.5 ? -1 : 1;
                    g.fillStyle = 'rgba(70,64,52,0.55)';
                    g.beginPath();
                    g.moveTo(cx + flip * wid * 0.08, top + len * 0.16);
                    g.quadraticCurveTo(cx + flip * wid * 0.6 + sway * len * 0.5, top + len * 0.55, bx + flip * wid * 0.46, top + len * 0.97);
                    g.lineTo(bx + flip * wid * 0.12, top + len * 0.97);
                    g.quadraticCurveTo(cx + flip * wid * 0.2, top + len * 0.5, cx + flip * wid * 0.08, top + len * 0.16);
                    g.fill();
                    g.fillStyle = 'rgba(240,236,224,0.5)';
                    g.beginPath();
                    g.moveTo(cx - flip * wid * 0.05, top + len * 0.25);
                    g.quadraticCurveTo(cx - flip * wid * 0.45 + sway * len * 0.5, top + len * 0.6, bx - flip * wid * 0.32, top + len * 0.94);
                    g.lineTo(bx - flip * wid * 0.08, top + len * 0.94);
                    g.quadraticCurveTo(cx - flip * wid * 0.12, top + len * 0.55, cx - flip * wid * 0.05, top + len * 0.25);
                    g.fill();
                    g.fillStyle = 'rgba(120,70,55,0.6)';
                    g.fillRect(bx - wid * 0.45, top + len * 0.93, wid * 0.9, len * 0.04);
                }
            }
            x += wid + (heads ? 0.02 + rnd() * 0.04 : 0.035 + rnd() * 0.05) * m;
        }
    }
    // the pole and the twine
    g.fillStyle = 'rgb(70,60,50)';
    g.fillRect(r.x, r.y, r.w, 0.025 * m);
    g.restore();
}
function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
/** A painted sign board: dark letters on a cream board, or the reverse. */
export function signCanvas(text, sub, w, h, light) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = light ? '#efe9da' : '#1d2a33';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = light ? '#7c2a1e' : '#d9c79c';
    g.lineWidth = h * 0.05;
    g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
    g.fillStyle = light ? '#7c2a1e' : '#efe2c0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * (sub ? 0.5 : 0.62);
    g.font = `700 ${size}px ${SERIF}`;
    while (g.measureText(text).width > w * 0.86 && size > 8) {
        size -= 2;
        g.font = `700 ${size}px ${SERIF}`;
    }
    g.fillText(text, w / 2, sub ? h * 0.42 : h * 0.53);
    if (sub) {
        g.font = `500 ${h * 0.2}px ${SERIF}`;
        g.fillText(sub, w / 2, h * 0.76);
    }
    return c;
}
