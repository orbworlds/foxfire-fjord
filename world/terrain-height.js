/**
 * Foxfire Fjord elevation model: a Lofoten-style alpine island cut by a
 * long, steep fjord.
 *
 *   - an outer coast around ISLAND (radial, with headlands, coves and the
 *     Ice Beach cove on the west coast), sea all round, snowy skerries,
 *   - mountains built from an art-directed ridge network: the Teeth north of
 *     the fjord (a serrated main crest with horn peaks of 650-900 m, spurs
 *     running down to the fjord and the north coast, hanging cirques between
 *     them, couloirs down every face) and the lower fells of the south with
 *     Fox Peak,
 *   - the fjord: a glacial trough from the open sea in the west, bending
 *     north-east into the island's heart, carved through everything,
 *   - the hanging valley of Mirror Lake (ice exactly flat at LAKE.y),
 *   - the cabin knoll, the hot-spring shelf, Lysvik's quay and terraces as
 *     exact-flat pads (see SITES in layout.ts),
 *   - wind-blown snow drifts, then every path carved in with its snowbanks.
 *
 * `heightAt` is the exact analytic function (deterministic, a few
 * microseconds), shared by workers, placement, walking and colliders. It must
 * never import three. Keep relief at wavelengths of 6 m or more: finer detail
 * belongs in the terrain shader.
 */
import { createSimplex2D, fbm, ridged, smoothstep, clamp } from './noise.js';
import { HOUSE, LAKE, PATHS, PATH_RULES, RINK, SITES, SKERRIES, SNOW_WIND, SPRING, BEACH, VILLAGE, VILLAGE_TERRACES, villageGroundY, } from './layout.js';
import { samplePath } from './paths.js';
/** Centre of the outer coastline (radial coast model). */
export const ISLAND = { x: -40, z: -260 };
/** World bounds that contain the island plus a ring of sea floor. */
export const WORLD_BOUNDS = { minX: -2000, maxX: 2100, minZ: -3000, maxZ: 1800 };
/** Upper bound of the terrain (m): terrain shadows march up to here. */
export const TERRAIN_MAX_HEIGHT = 960;
const nCoast = createSimplex2D(11);
const nHills = createSimplex2D(23);
const nDetail = createSimplex2D(37);
const nRidge = createSimplex2D(51);
const nWarp = createSimplex2D(63);
const nGully = createSimplex2D(71);
const nSnow = createSimplex2D(83);
const nLake = createSimplex2D(97);
const nShore = createSimplex2D(109);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
function smax(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return a + (b - a) * h + k * h * (1 - h);
}
function smin(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return b + (a - b) * h - k * h * (1 - h);
}
/* ------------------------------------------------------------------ */
/* Outer coast                                                         */
/* ------------------------------------------------------------------ */
/** Coast radius control points every 22.5°, θ = atan2(dz, dx) (0 = east, 90° = south). The north reaches farther: the Teeth stand there. */
const COAST_R = [1590, 1600, 1640, 1690, 1700, 1650, 1580, 1500, 1470, 1720, 2160, 2280, 2330, 2520, 2520, 1960];
/** Headlands (+) and coves (-) shaped into the radial coastline. */
const COAST_BUMPS = [
    { theta: 164.5 * DEG, width: 3.4 * DEG, amount: -58 }, // Ice Beach cove
    { theta: 157.8 * DEG, width: 1.7 * DEG, amount: 40 }, // its southern point
    { theta: 171.0 * DEG, width: 1.9 * DEG, amount: 46 }, // its northern point
    { theta: 182 * DEG, width: 2.4 * DEG, amount: 40 }, // south head of the fjord mouth
    { theta: 213 * DEG, width: 2.6 * DEG, amount: 70 }, // north head of the fjord mouth, under the West Horn
    { theta: 224 * DEG, width: 2.6 * DEG, amount: -70 }, // a cove under the western Teeth
    { theta: 236 * DEG, width: 3 * DEG, amount: 80 }, // north-west cape
    { theta: 252 * DEG, width: 3 * DEG, amount: -95 }, // north bay
    { theta: 270 * DEG, width: 3 * DEG, amount: 75 }, // north cape
    { theta: 282 * DEG, width: 2.6 * DEG, amount: -90 }, // a cove between the Great Tooth's north spurs
    { theta: 293 * DEG, width: 2.4 * DEG, amount: 70 }, // the Great Tooth's sea cliff
    { theta: 309 * DEG, width: 3.5 * DEG, amount: -60 }, // north-east bay
    { theta: 345 * DEG, width: 5 * DEG, amount: 60 }, // east cape
    { theta: 20 * DEG, width: 4 * DEG, amount: -55 }, // east bay
    { theta: 52 * DEG, width: 6 * DEG, amount: 85 }, // south-east cape below Fox Peak
    { theta: 84 * DEG, width: 3.5 * DEG, amount: -70 }, // south bay
    { theta: 108 * DEG, width: 4 * DEG, amount: 45 }, // south point
    { theta: 132 * DEG, width: 4 * DEG, amount: -45 }, // south-west cove
    { theta: 146 * DEG, width: 3 * DEG, amount: 40 }, // south-west point
];
const BEACH_THETA = 164.5 * DEG;
function wrapAngle(a) {
    a = a % TAU;
    return a < 0 ? a + TAU : a;
}
function angleDelta(a, b) {
    let d = wrapAngle(a) - wrapAngle(b);
    if (d > Math.PI)
        d -= TAU;
    if (d < -Math.PI)
        d += TAU;
    return d;
}
function catmullPeriodic(values, t) {
    const n = values.length;
    const f = ((t % n) + n) % n;
    const i1 = Math.floor(f);
    const u = f - i1;
    const p0 = values[(i1 - 1 + n) % n];
    const p1 = values[i1];
    const p2 = values[(i1 + 1) % n];
    const p3 = values[(i1 + 2) % n];
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
function catmullClamped(values, x0, dx, x) {
    const n = values.length;
    const f = clamp((x - x0) / dx, 0, n - 1.0001);
    const i1 = Math.floor(f);
    const u = f - i1;
    const p0 = values[Math.max(0, i1 - 1)];
    const p1 = values[i1];
    const p2 = values[Math.min(n - 1, i1 + 1)];
    const p3 = values[Math.min(n - 1, i1 + 2)];
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
/** Black-sand beach factor by coast angle (1 in the Ice Beach cove). */
function beachTheta(theta) {
    return 1 - smoothstep(4.0 * DEG, 8.0 * DEG, Math.abs(angleDelta(theta, BEACH_THETA)));
}
function coastRadiusSmooth(th) {
    let r = catmullPeriodic(COAST_R, th / (22.5 * DEG));
    for (const b of COAST_BUMPS) {
        const d = angleDelta(th, b.theta) / b.width;
        r += b.amount * Math.exp(-d * d);
    }
    return r;
}
/** Outer coastline radius at angle theta (radians). */
export function coastRadius(theta) {
    const th = wrapAngle(theta);
    const calm = beachTheta(th);
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    const rough = 70 * fbm(nCoast, cx * 2.6 + 4, cz * 2.6 - 2, 5) + 18 * nCoast(cx * 21, cz * 21) + 7 * nCoast(cx * 60 + 3, cz * 60);
    return coastRadiusSmooth(th) + rough * (1 - 0.92 * calm);
}
/** Signed distance to the outer coast (positive inland), ignoring the fjord. */
function outerCoastDistance(x, z) {
    const dx = x - ISLAND.x;
    const dz = z - ISLAND.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const th = Math.atan2(dz, dx);
    const d = coastRadius(th) - r;
    if (d >= 0)
        return d;
    // offshore, fade toward the smooth coastline so the sea floor has no radial streaks
    const ds = coastRadiusSmooth(wrapAngle(th)) - r;
    const k = smoothstep(0, 260, -d);
    return d + (ds - d) * k;
}
/* ------------------------------------------------------------------ */
/* The fjord                                                           */
/* ------------------------------------------------------------------ */
/** Fjord centreline z, half width (water) and floor depth at knots every 300 m of x from FJORD_X0. */
const FJORD_X0 = -2100;
const FJORD_DX = 300;
const FJORD_Z = [-710, -675, -650, -641, -636, -616, -598, -590, -601, -639, -695, -750, -780];
const FJORD_HW = [790, 675, 570, 509, 473, 464, 462, 460, 439, 401, 325, 210, 100];
const FJORD_DEPTH = [90, 100, 110, 118, 124, 128, 130, 128, 120, 106, 84, 52, 24];
/** x of the fjord head (the trough ends in a rounded cap here). */
const FJORD_HEAD_X = 1250;
/**
 * The strandflat: a low coastal shelf at the foot of Spring Hill along the
 * fjord's south shore between Lysvik and the cabin's knoll. The shore road
 * runs along it; the hot spring's crag rises behind it.
 */
const STRAND = { x0: -960, x1: -150, width: 78 };
function strandWeight(x) {
    return smoothstep(STRAND.x0 - 80, STRAND.x0 + 40, x) * (1 - smoothstep(STRAND.x1 - 120, STRAND.x1, x));
}
function strandWidth(x) {
    return STRAND.width + 22 * nShore(x / 210 + 3.3, 1.7);
}
/**
 * Strandflat surface at shore distance u: rising gently from the water, and
 * ramping up toward the cabin's knoll in the east (the shore road climbs it).
 */
function strandShelf(x, z, u, W0) {
    const rt = clamp((x + 720) / 580, 0, 1);
    const ramp = 58 * (rt + (rt * rt * (3 - 2 * rt) - rt) * 0.3);
    return -1.2 + 0.16 * Math.min(u, W0) + ramp * smoothstep(0, W0 * 0.45, u) + 1.5 * nDetail(x / 40, z / 40) * smoothstep(5, 25, u);
}
/** Fjord geometry at (x, z). */
export function fjordAt(x, z) {
    const xc = Math.min(x, FJORD_HEAD_X);
    const zc = catmullClamped(FJORD_Z, FJORD_X0, FJORD_DX, xc);
    const hw = catmullClamped(FJORD_HW, FJORD_X0, FJORD_DX, xc);
    const depth = catmullClamped(FJORD_DEPTH, FJORD_X0, FJORD_DX, xc);
    // slope of the centreline: distance perpendicular to it
    const zc2 = catmullClamped(FJORD_Z, FJORD_X0, FJORD_DX, xc + 5);
    const sl = (zc2 - zc) / 5;
    let d = Math.abs(z - zc) / Math.sqrt(1 + sl * sl);
    if (x > FJORD_HEAD_X)
        d = Math.hypot(x - FJORD_HEAD_X, d);
    // points and coves along the shore (gentler along the strandflat shore west of the cabin)
    const wob = 34 * fbm(nShore, x / 260, z / 260, 3) + 9 * nShore(x / 55 + 7, z / 55);
    const calmShore = z >= zc ? strandWeight(x) : 0;
    const halfW = hw + wob * smoothstep(-1800, -1300, x) * (1 - 0.85 * calmShore);
    return { d, side: z >= zc ? 1 : -1, halfW, depth, shore: d - halfW };
}
const TEETH_STEEP = 0.8;
const RIDGES = [
    // the Teeth: main crest, west to east, set well back beyond the broad fjord so that from
    // the cabin they stand 14-19° high and frame the aurora instead of walling it off.
    // Peak groups with deep cols between them: the West Horn, the Twins, the Skar (a deep
    // notch), Kirkja, the Gap (a broad low saddle on the cabin's axis), the Great Tooth
    // with its shoulder (off-axis, north-north-east), the East Horn and the north-east peak.
    {
        steep: TEETH_STEEP,
        gully: 26,
        serr: 40,
        pts: [
            [-1820, -1300, 80],
            [-1700, -1470, 420],
            [-1560, -1640, 690],
            [-1340, -1760, 380],
            [-1130, -1880, 640],
            [-1010, -1925, 520],
            [-890, -1965, 660],
            [-660, -2030, 260],
            [-380, -2100, 620],
            [-180, -2150, 420],
            [40, -2190, 360],
            [240, -2220, 470],
            [480, -2255, 700],
            [760, -2280, 880],
            [980, -2250, 520],
            [1180, -2170, 760],
            [1350, -2050, 480],
            [1470, -1900, 600],
            [1580, -1720, 420],
            [1680, -1520, 260],
            [1760, -1360, 80],
        ],
    },
    // the Teeth: arêtes plunging toward the fjord as buttresses (they make the peaks pyramids)
    { steep: 0.85, gully: 22, serr: 30, pts: [[-1560, -1640, 690], [-1500, -1450, 460], [-1440, -1290, 250], [-1400, -1170, 70]] },
    { steep: 0.85, gully: 20, serr: 26, pts: [[-1130, -1880, 640], [-1200, -1660, 400], [-1240, -1480, 200], [-1260, -1380, 60]] },
    { steep: 0.85, gully: 24, serr: 30, pts: [[-890, -1965, 660], [-880, -1740, 440], [-870, -1520, 260], [-865, -1330, 120], [-860, -1180, 30]] },
    { steep: 0.85, gully: 22, serr: 30, pts: [[-380, -2100, 620], [-360, -1880, 420], [-340, -1660, 250], [-330, -1430, 110], [-325, -1250, 30]] },
    { steep: 0.85, gully: 24, serr: 34, pts: [[760, -2280, 880], [700, -2030, 600], [640, -1790, 380], [600, -1560, 210], [580, -1340, 80], [575, -1200, 20]] },
    { steep: 0.85, gully: 22, serr: 30, pts: [[760, -2280, 880], [900, -2080, 560], [1000, -1900, 330], [1060, -1760, 150]] },
    { steep: 0.85, gully: 22, serr: 30, pts: [[1180, -2170, 760], [1190, -1920, 500], [1200, -1680, 300], [1210, -1440, 140], [1210, -1230, 40]] },
    // the Teeth: short arêtes down to the north coast
    { steep: TEETH_STEEP, gully: 20, serr: 26, pts: [[-890, -1965, 660], [-930, -2200, 380], [-960, -2380, 60]] },
    { steep: TEETH_STEEP, gully: 20, serr: 26, pts: [[-380, -2100, 620], [-360, -2330, 360], [-340, -2500, 60]] },
    { steep: TEETH_STEEP, gully: 20, serr: 26, pts: [[760, -2280, 880], [800, -2490, 520], [830, -2660, 60]] },
    { steep: TEETH_STEEP, gully: 20, serr: 24, pts: [[1180, -2170, 760], [1270, -2370, 400], [1340, -2500, 60]] },
    // the highland wrapping round the fjord head
    { steep: 0.85, gully: 18, serr: 22, round: 12, pts: [[1430, -1980, 630], [1560, -1640, 470], [1590, -1300, 400], [1530, -960, 330], [1420, -620, 280], [1290, -380, 240], [1110, -190, 170]] },
    // Fox Peak: north ridge (the summit trail climbs it), west ridge falling fast to the
    // low ground south of the cabin (so the noon sun reaches the cabin), east ridge
    { steep: 0.36, gully: 3, serr: 4, round: 90, warp: 0.1, capK: 3.5, pts: [[650, 830, 568], [592, 705, 470], [562, 565, 350], [558, 425, 245], [548, 300, 160]] },
    { steep: 0.72, gully: 10, serr: 14, round: 16, warp: 0.25, pts: [[650, 830, 568], [490, 805, 410], [340, 790, 235], [170, 790, 140], [-60, 790, 95]] },
    { steep: 0.8, gully: 12, serr: 16, round: 10, warp: 0.25, pts: [[650, 830, 568], [862, 776, 480], [1062, 660, 410], [1260, 500, 250]] },
    // the ridge walling Mirror Lake's valley to the east
    { steep: 0.7, gully: 8, serr: 12, round: 30, pts: [[1062, 660, 410], [936, 430, 340], [868, 215, 290], [830, 10, 235], [812, -170, 180]] },
    // Spring Hill, between Lysvik and the cabin (the hot spring sits on its fjord face)
    { steep: 0.6, gully: 5, serr: 8, round: 50, pts: [[-660, 310, 100], [-540, 180, 168], [-470, 75, 188], [-430, 40, 172]] },
    // the spring shoulder: a spur off Spring Hill's north-east side, the hot-spring shelf
    // on its nose above the crag, falling gently east to the cabin's bench (the path climbs it)
    { steep: 0.42, gully: 2, serr: 3, round: 30, warp: 0.15, pts: [[-440, 40, 170], [-388, -24, 124], [-300, 4, 106], [-210, 40, 90], [-130, 66, 79]] },
    // the low rise south of the cabin: kept low so the winter sun clears it
    { steep: 0.45, gully: 3, serr: 4, round: 120, pts: [[-170, 400, 84], [40, 430, 98], [240, 450, 116]] },
    // south-west moor ridge
    { steep: 0.55, gully: 4, serr: 6, round: 90, pts: [[-420, 660, 130], [-700, 700, 170], [-960, 640, 125]] },
    // the knuckle behind Lysvik
    { steep: 0.55, gully: 3, serr: 4, round: 70, pts: [[-1180, 330, 70], [-1000, 230, 105], [-880, 300, 90]] },
];
/**
 * Raised benches (x, z, half axes, rotation, top height): broad shelves the
 * hanging valleys sit on, with sloping sides that the fjord then cuts.
 */
const BENCHES = [
    // Mirror Lake's hanging valley (its lip falls gently toward the cabin, so the path climbs it)
    [470, 150, 330, 230, -0.15, 118, 0.24],
    // the bench the cabin sits on, between the knoll and the low rise to the south
    [40, 140, 230, 150, 0.05, 80, 0.3],
];
/** Hanging cirques: bowls carved into the Teeth between the spurs (floor height, radius). */
const CIRQUES = [
    [-1360, -1560, 330, 140],
    [-1040, -1700, 380, 150],
    [-620, -1820, 230, 190],
    [180, -1960, 380, 200],
    [1090, -2000, 420, 130],
    // Fox Peak's north face, above Mirror Lake
    [770, 615, 330, 125],
];
const SEGS = [];
(function buildRidges() {
    RIDGES.forEach((r, ri) => {
        let s = 0;
        for (let i = 0; i < r.pts.length - 1; i++) {
            const [ax, az, ha] = r.pts[i];
            const [bx, bz, hb] = r.pts[i + 1];
            const len = Math.hypot(bx - ax, bz - az);
            // reach where the flank has dropped below sea level
            const reach = Math.pow((Math.max(ha, hb) + 60) / (7 * r.steep), 1 / 0.75);
            SEGS.push({
                ax,
                az,
                ux: (bx - ax) / len,
                uz: (bz - az) / len,
                len,
                ha,
                hb,
                s0: s,
                ridge: ri,
                capA: i > 0 ? (r.capK ?? 1) : 1,
                capB: i < r.pts.length - 2 ? (r.capK ?? 1) : 1,
                minX: Math.min(ax, bx) - reach,
                maxX: Math.max(ax, bx) + reach,
                minZ: Math.min(az, bz) - reach,
                maxZ: Math.max(az, bz) + reach,
            });
            s += len;
        }
    });
})();
/** Per-ridge scratch (best value and its local coordinates). */
const ridgeBest = new Float64Array(RIDGES.length);
const ridgeS = new Float64Array(RIDGES.length);
const ridgeD = new Float64Array(RIDGES.length);
const ridgeH = new Float64Array(RIDGES.length);
/** Mountains from the ridge network (metres above sea; very negative far from any ridge). */
function mountains(x, z) {
    // gentle domain warp so ridges wander between their knots
    const ox = 42 * nWarp(x / 360, z / 360);
    const oz = 42 * nWarp(x / 360 + 7.3, z / 360 - 2.1);
    const wx = x + ox;
    const wz = z + oz;
    ridgeBest.fill(-1e9);
    for (let i = 0; i < SEGS.length; i++) {
        const g = SEGS[i];
        if (wx < g.minX || wx > g.maxX || wz < g.minZ || wz > g.maxZ)
            continue;
        const wk = RIDGES[g.ridge].warp ?? 1;
        const px = x + ox * wk - g.ax;
        const pz = z + oz * wk - g.az;
        const tr = px * g.ux + pz * g.uz;
        const t = clamp(tr, 0, g.len);
        const qx = px - g.ux * tr;
        const qz = pz - g.uz * tr;
        const over = (tr - t) * (tr < 0 ? g.capA : g.capB);
        const d = Math.sqrt(qx * qx + qz * qz + over * over);
        const f = t / g.len;
        // crest height: eased between knots so peaks are pointed and cols saddle-shaped
        const e = f * f * (3 - 2 * f);
        const hc = g.ha + (g.hb - g.ha) * (0.35 * f + 0.65 * e);
        const r = RIDGES[g.ridge];
        const r0 = r.round ?? 3;
        const de = Math.sqrt(d * d + r0 * r0) - r0;
        const v = hc - 7 * r.steep * Math.sqrt(de * Math.sqrt(de));
        if (v > ridgeBest[g.ridge]) {
            ridgeBest[g.ridge] = v;
            ridgeS[g.ridge] = g.s0 + t;
            ridgeD[g.ridge] = d;
            ridgeH[g.ridge] = hc;
        }
    }
    let h = -1e9;
    for (let ri = 0; ri < RIDGES.length; ri++) {
        let v = ridgeBest[ri];
        if (v < -400)
            continue;
        const r = RIDGES[ri];
        const s = ridgeS[ri];
        const d = ridgeD[ri];
        // pinnacles and notches along the crest, fading down the faces
        const serr = (ridged(nRidge, s / 85 + ri * 13.1, 0.5 + ri * 3.7, 3) - 0.42) * 2 * r.serr * Math.exp(-d / 70);
        // couloirs straight down the faces: narrow gullies in along-ridge noise, stretched across it
        const face = smoothstep(25, 90, d) * (1 - smoothstep(0.75, 1.0, d / 600));
        if (face > 0) {
            const amp = r.gully * face * clamp((ridgeH[ri] - 150) / 400, 0.2, 1.2);
            const n = 1 - Math.abs(nGully(s / 46 + ri * 5.3, d / 260 + ri));
            // ribs and runnels between the couloirs
            const rib = nGully(s / 17 + ri * 2.1, d / 95 - ri);
            v -= amp * (Math.pow(n, 5) + 0.22 * rib);
        }
        v += serr;
        h = h < -1e8 ? v : smax(h, v, 38);
    }
    if (h > 150) {
        // hanging cirques: steep headwalls, flat snowy floors
        for (const [cx, cz, floor, cr] of CIRQUES) {
            const dx = wx - cx;
            const dz = wz - cz;
            const q = (dx * dx + dz * dz) / (cr * cr);
            if (q > 9)
                continue;
            const bowl = floor + 4 * fbm(nDetail, wx / 60, wz / 60, 2) + cr * 0.55 * q * Math.sqrt(q);
            h = smin(h, bowl, 30);
        }
        // sheet-jointed faces: ledges (where snow lies) between steeper risers
        const step = 30 + 10 * nDetail(wx / 700 + 3.1, wz / 700);
        const off = 30 * nDetail(wx / 230, wz / 230) + 9 * nDetail(wx / 70 + 1.7, wz / 70);
        const tt = (h + off) / step;
        const fl = Math.floor(tt);
        const fr = tt - fl;
        const ledge = (fl + fr * fr * fr) * step - off;
        // (only on the alpine massifs: the Teeth and Fox Peak)
        const alp = Math.min(1, smoothstep(-1000, -1180, wz) + smoothstep(240, 380, wz) * smoothstep(240, 400, wx));
        h += (ledge - h) * 0.17 * smoothstep(160, 320, h) * alp;
    }
    return h;
}
/** Raised benches: flat-topped shelves with sloping sides (very negative away from them). */
function benches(x, z) {
    let h = -1e9;
    for (const [cx, cz, rx, rz, rot, top, side] of BENCHES) {
        const e = sdEllipse(x, z, cx, cz, rx, rz, rot);
        if (e > 500)
            continue;
        const v = top + 3 * fbm(nHills, x / 120, z / 120, 2) - side * Math.max(0, e + 30 * nDetail(x / 150 + 9, z / 150));
        h = Math.max(h, v);
    }
    return h;
}
/* ------------------------------------------------------------------ */
/* Natural terrain                                                     */
/* ------------------------------------------------------------------ */
/**
 * Signed distance to the nearest shore of the sea (outer coast or fjord),
 * positive inland, metres. Approximate (the shoreline itself is where the
 * terrain crosses y = 0).
 */
export function coastDistance(x, z) {
    return Math.min(outerCoastDistance(x, z), fjordAt(x, z).shore);
}
/** Black-sand factor of the shore at (x, z): 1 on Ice Beach, 0 on rocky coasts. */
export function beachFactor(x, z) {
    const th = Math.atan2(z - ISLAND.z, x - ISLAND.x);
    return beachTheta(th) * (1 - smoothstep(170, 270, Math.hypot(x - BEACH.center.x, z - BEACH.center.z)));
}
/** Glacial trough wall: steep from the waterline, steepening with height. */
function fjordWall(f, x, z) {
    if (f.shore < 0) {
        const t = Math.min(1, f.d / Math.max(1, f.halfW));
        return -f.depth * (1 - t * t * t) - 2 * smoothstep(0, -12, f.shore);
    }
    const u = f.shore;
    // north wall: sheer, varying along the fjord; south wall: gentler
    const n = nWarp(x / 420 + 3.1, f.side * 2.7);
    // north shore: low banks along the foreland, cliffs where the buttresses meet the water
    let k = f.side < 0 ? 0.62 + 0.3 * n + 1.1 * smoothstep(0.15, 0.55, nWarp(x / 260 - 6.2, 4.4)) : 0.95 + 0.3 * n;
    const wall = -2 + k * u * (1 + u / 260);
    if (f.side < 0)
        return wall;
    const sw = strandWeight(x);
    if (sw <= 0)
        return wall;
    // the strandflat, then the crag of Spring Hill (steepest under the hot-spring shelf)
    const W0 = strandWidth(x);
    const v = Math.max(0, u - W0);
    k += 1.5 * Math.exp(-((x - SPRING.x) * (x - SPRING.x)) / (130 * 130));
    const crag = strandShelf(x, z, u, W0) + k * v * (1 + v / 200);
    return wall + (crag - wall) * sw;
}
/** Ridged multifractal with rounded crests (glacially smoothed knolls rather than knife edges), 0..1. */
function softRidged(noise, x, y, octaves) {
    let sum = 0;
    let amp = 0.5;
    let fx = x;
    let fy = y;
    let prev = 1;
    for (let o = 0; o < octaves; o++) {
        const v = noise(fx, fy);
        let n = 1 - Math.sqrt(v * v + 0.012);
        n *= n;
        sum += n * amp * prev;
        prev = n;
        amp *= 0.5;
        const nx = fx * 1.6 - fy * 1.2;
        const ny = fx * 1.2 + fy * 1.6;
        fx = nx + 5.7;
        fy = ny - 3.3;
    }
    return Math.min(1, sum);
}
/**
 * Where the southern fells may rise (0..1): not on the cabin's bench and its
 * view north, not in the wedge the winter sun shines through onto the cabin
 * (azimuth ~160-230°), not in Lysvik or round Mirror Lake.
 */
function fellMask(x, z) {
    const cx = x - HOUSE.x;
    const cz = z - HOUSE.z;
    const r = Math.hypot(cx, cz);
    let m = smoothstep(150, 420, r);
    if (cz > 0) {
        // the sun wedge: around azimuth 195° (direction -0.26, +0.97), widening slowly
        const c = (cx * -0.259 + cz * 0.966) / Math.max(1, r);
        const wedge = smoothstep(Math.cos(0.72), Math.cos(0.42), c) * (1 - smoothstep(1100, 1500, r));
        m *= 1 - 0.8 * wedge;
    }
    m *= smoothstep(150, 320, Math.hypot(x - VILLAGE.center.x, z - VILLAGE.center.z));
    m *= smoothstep(140, 330, Math.hypot((x - LAKE.x) * 0.7, z - LAKE.z));
    m *= smoothstep(60, 160, Math.hypot(x - SPRING.x, z - SPRING.z));
    return m;
}
/** Natural terrain before any site flattening. */
export function naturalHeight(x, z) {
    const dx = x - ISLAND.x;
    const dz = z - ISLAND.z;
    const theta = Math.atan2(dz, dx);
    const d = outerCoastDistance(x, z);
    const calm = beachTheta(theta);
    let h;
    if (d < 0) {
        // sea floor: a gentle shelf off the beach, steeper off the cliffs
        const a = -d;
        const shelf = 0.03 + (1 - calm) * 0.11;
        h = -a * shelf - Math.min(a, 60) * 0.03 - Math.max(0, a - 160) * (0.14 + 0.08 * (1 - calm));
        h = Math.max(h, -95);
        h += 1.4 * nDetail(x * 0.01, z * 0.01) * smoothstep(10, 140, a);
    }
    else {
        const A = 22 + 8 * nHills(x / 600 + 2, z / 600);
        const cliff = A * (1 - Math.exp(-d / 40));
        const gentle = A * Math.pow(smoothstep(18, 420, d), 1.15);
        h = cliff + (gentle - cliff) * calm + 0.03 * Math.min(d, 1400);
    }
    // black-sand beach: swash slope, berm, low back-beach
    h += calm * (1.2 * smoothstep(-8, 20, d) + 1.0 * smoothstep(20, 70, d));
    // rolling ground: stronger inland, calm near the beach so the waterline stays clean
    const inlandCliff = smoothstep(-40, 200, d);
    const inlandCalm = smoothstep(60, 380, d);
    const inland = inlandCliff + (inlandCalm - inlandCliff) * calm;
    h += (16 * fbm(nHills, x / 420, z / 420, 5) + 5 * fbm(nDetail, x / 95, z / 95, 3)) * inland;
    // glacially scoured fells over the southern lowland: knobbly ridges and rock knolls,
    // kept low in the sun's corridor south of the cabin and around the sites
    if (z > -320 && d > 0) {
        const m = fellMask(x, z) * inland;
        if (m > 0.01) {
            const fell = softRidged(nRidge, x / 620 + 3.3, z / 620 - 1.7, 4);
            const knob = softRidged(nGully, x / 150 - 2.1, z / 150 + 4.4, 3);
            h += m * (75 * Math.pow(smoothstep(0.3, 0.9, fell), 1.5) + 14 * smoothstep(0.35, 0.85, knob) * smoothstep(0.2, 0.6, fell));
        }
    }
    // the north shore's foreland: moraine terraces and ice-scoured knolls rising from the
    // fjord to the foot of the Teeth (low: from the cabin it stays under the peaks' feet)
    const f = fjordAt(x, z);
    if (f.side < 0 && f.shore > -40 && d > 0) {
        const u = Math.max(0, f.shore);
        // a low strand along the water (the base ground is brought down to it), the moraine behind
        const strand = 1.2 + 0.05 * u + 1.5 * nDetail(x / 50, z / 50) * smoothstep(5, 30, u);
        h = strand + (h - strand) * smoothstep(60, 520, u);
        const rise = 0.18 * Math.max(0, Math.min(u, 900) - 50) * smoothstep(50, 220, u);
        const fell = softRidged(nRidge, x / 520 - 4.1, z / 520 + 2.3, 4);
        const knob = softRidged(nGully, x / 140 + 1.3, z / 140 - 3.9, 3);
        const relief = (55 * Math.pow(smoothstep(0.3, 0.9, fell), 1.4) + 12 * smoothstep(0.35, 0.85, knob)) * smoothstep(30, 200, u);
        h += (rise + relief) * inland;
    }
    // rocky roughness on cliff coasts
    h += (1 - calm) * smoothstep(-30, 10, d) * (1 - smoothstep(60, 200, d)) * 6 * ridged(nDetail, x / 38, z / 38, 3);
    // mountains rise behind the coast (sea cliffs where they meet it)
    const m = mountains(x, z);
    if (m > -60) {
        const land = smoothstep(-120, 160, d);
        const mm = m * land - 60 * (1 - land);
        // eroded detail on the mountains, growing with height
        const rough = (fbm(nDetail, x / 140, z / 140, 4) * 0.5 + (ridged(nGully, x / 210, z / 210, 3) - 0.4)) * smoothstep(80, 500, mm) * 34;
        h = smax(h, mm + rough, 30);
    }
    const b = benches(x, z);
    if (b > h - 40)
        h = smax(h, b, 24);
    // the fjord: a glacial trough carved through everything
    if (f.shore < 900)
        h = smin(h, fjordWall(f, x, z), 18);
    // fill the strandflat up to its shelf where the ground behind the shore is lower
    if (f.side > 0 && f.shore > -20) {
        const sw = strandWeight(x);
        if (sw > 0) {
            const W0 = strandWidth(x);
            const u = Math.max(0, f.shore);
            const w = sw * smoothstep(-20, 4, f.shore) * (1 - smoothstep(W0 * 0.8, W0 * 1.25, u));
            const shelf = strandShelf(x, z, u, W0);
            if (w > 0 && shelf > h)
                h += (shelf - h) * w;
        }
    }
    // snowy skerries, offshore and in the fjord mouth
    for (const isl of SKERRIES) {
        const q = Math.hypot(x - isl.x, z - isl.z) / isl.r;
        if (q < 2.5) {
            // ice-smoothed whalebacks with plucked, craggy flanks
            const qw = q * (1 + 0.18 * nDetail(x * 0.03 + isl.x, z * 0.03));
            const rock = (isl.h + 16) * Math.exp(-Math.pow(qw, 3)) * (0.66 + 0.34 * ridged(nDetail, x * 0.07, z * 0.07, 3)) - 16;
            if (rock > h)
                h = rock;
        }
    }
    return h;
}
/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */
function sdBox(x, z, b, radius = 0) {
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const hx = (b.maxX - b.minX) * 0.5 - radius;
    const hz = (b.maxZ - b.minZ) * 0.5 - radius;
    const qx = Math.abs(x - cx) - hx;
    const qz = Math.abs(z - cz) - hz;
    const ox = Math.max(qx, 0);
    const oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - radius;
}
/** Approximate signed distance to a rotated ellipse (negative inside). */
function sdEllipse(x, z, cx, cz, rx, rz, rot) {
    const dx = x - cx;
    const dz = z - cz;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const u = dx * c + dz * s;
    const v = -dx * s + dz * c;
    const k0 = Math.hypot(u / rx, v / rz);
    const k1 = Math.hypot(u / (rx * rx), v / (rz * rz));
    if (k1 < 1e-9)
        return -Math.min(rx, rz);
    return (k0 * (k0 - 1)) / k1;
}
/** Signed distance to Mirror Lake's shoreline (negative on the ice), metres. */
export function lakeSd(x, z) {
    const e = sdEllipse(x, z, LAKE.x, LAKE.z, LAKE.rx, LAKE.rz, LAKE.rot);
    if (e > 400)
        return e;
    return e + (11 * fbm(nLake, x / 70, z / 70, 3) + 2.5 * nLake(x / 17 + 5, z / 17)) * (1 - smoothstep(260, 380, e));
}
/** Signed distance to the skating rink's cleared edge (negative inside). */
export function rinkSd(x, z) {
    return sdEllipse(x, z, RINK.x, RINK.z, RINK.rx, RINK.rz, RINK.rot) + 0.8 * nLake(x / 6, z / 6 + 3);
}
/** Exact-flat pads (y fixed). */
const PADS = [SITES.cabin, SITES.spring, SITES.sauna, SITES.quay, SITES.summit, ...VILLAGE_TERRACES];
function padWeight(x, z, p) {
    if (p.falloff <= 0)
        return 0;
    const s = sdBox(x, z, p, Math.min(4, p.falloff));
    return 1 - smoothstep(0, p.falloff, s);
}
/**
 * The cabin knoll: a level shoulder on the fjord's south wall. The ground
 * rises gently behind (south of) the cabin and breaks away north of the deck
 * in a steep, ledged slope down to the shore, so the deck looks straight out
 * over the fjord.
 */
function knollTarget(x, z) {
    const top = HOUSE.groundY;
    const lx = x - HOUSE.x;
    const lz = z - HOUSE.z;
    const alx = Math.abs(lx);
    // the brink: just north of the deck, bowing outward there, wandering east and west of the yard
    const brink = -12 - 5 * Math.exp(-(lx * lx) / 900) + (7 * nDetail(lx / 45, 4.2) + 3 * nDetail(lx / 16, 9.1)) * smoothstep(10, 40, alx);
    const north = Math.max(0, brink - lz);
    const soft = (north * north) / (north + 5);
    // a ledged, rocky slope down to the shore
    const fall = 0.85 * soft * (1 + soft / 240) - 4.5 * ridged(nDetail, x / 24, z / 24, 2) * smoothstep(3, 16, north) + 2.2 * smoothstep(3, 16, north);
    // behind the cabin: a gentle rise toward the bench
    const back = Math.max(0, lz - 16);
    const rise = 0.09 * back + 0.9 * fbm(nDetail, x / 45, z / 45, 2);
    return top + 0.15 - fall + rise - 0.0006 * lx * lx * smoothstep(10, 50, alx);
}
/** Wind-blown snow relief (metres), stretched along the prevailing wind. */
function snowDrift(x, z) {
    const u = x * SNOW_WIND.x + z * SNOW_WIND.z;
    const v = -x * SNOW_WIND.z + z * SNOW_WIND.x;
    return 0.32 * fbm(nSnow, u / 46, v / 15, 2);
}
/** Terrain with sites, lake and snow drifts, before path carving. */
export function siteHeight(x, z) {
    let h = naturalHeight(x, z);
    let flat = 0;
    // the cabin knoll
    const kx = x - HOUSE.x;
    const kz = z - HOUSE.z;
    const kr = Math.hypot(kx, kz * 1.15);
    if (kr < 190) {
        const w = 1 - smoothstep(70, 190, kr);
        h += (knollTarget(x, z) - h) * w;
    }
    // Mirror Lake: exact ice level inside the shoreline, a soft bank, the hanging valley around it
    const ls = lakeSd(x, z);
    if (ls < 220) {
        if (ls <= 0) {
            h = LAKE.y;
            flat = 1;
            // the cleared skating rink: soft shovelled snowbanks around it
            const rs = rinkSd(x, z);
            if (rs > -1 && rs < 5)
                h += 0.42 * Math.exp(-Math.pow((rs - 1.6) / 1.1, 2));
        }
        else {
            const bank = LAKE.y + 0.7 * smoothstep(0, 5, ls) + 0.09 * Math.max(0, ls - 5) + 0.8 * fbm(nDetail, x / 30, z / 30, 2) * smoothstep(2, 12, ls);
            // the valley floor holds its level and the surrounding slopes keep their shape farther
            // out; where the ground falls away (the hanging valley's lip) only a short rim is raised
            if (h > bank) {
                const w = 1 - smoothstep(30, 220, ls);
                h += (bank - h) * w * w;
            }
            else {
                h += (bank - h) * (1 - smoothstep(8, 70, ls));
            }
            flat = 1 - smoothstep(0, 4, ls);
        }
    }
    // Lysvik: the village ground is a gentle plane rising from the quay, the terraces step it
    const vdx = x - VILLAGE.center.x;
    const vdz = z - VILLAGE.center.z;
    const vr = Math.hypot(vdx, vdz * 1.15);
    if (vr < VILLAGE.radius * 2) {
        const w = (1 - smoothstep(VILLAGE.radius * 0.75, VILLAGE.radius * 2, vr)) * smoothstep(VILLAGE.quay.minZ - 4, VILLAGE.quay.minZ + 10, z);
        if (w > 0) {
            const target = villageGroundY(z) + 0.5 * fbm(nDetail, x / 40, z / 40, 2) * smoothstep(VILLAGE.quay.maxZ, VILLAGE.quay.maxZ + 10, z);
            h += (target - h) * w;
        }
    }
    for (const p of PADS) {
        const w = padWeight(x, z, p);
        if (w > 0) {
            h = h + (p.y - h) * w;
            flat = Math.max(flat, w);
        }
    }
    // hot-spring shelf: beyond a wandering brink the ground falls away (north and west,
    // down the fjord) so the pool looks out over the strandflat to the fjord mouth
    const sdx = x - SPRING.x;
    const sdz = z - SPRING.z;
    if (sdx * sdx + sdz * sdz < 160 * 160) {
        const vx = -0.8;
        const vz = -0.6;
        const v = sdx * vx + sdz * vz;
        const u = -sdx * vz + sdz * vx;
        const brink = 9 + 4 * nDetail(u / 18 + 2.2, 7.7);
        if (v > brink - 6) {
            const t = Math.max(0, v - brink);
            const cap = SPRING.y - 0.4 - 1.25 * t - 3 * smoothstep(0, 6, t) + 2.5 * ridged(nDetail, x / 14, z / 14, 2) * smoothstep(2, 10, t);
            const wu = 1 - smoothstep(30, 75, Math.abs(u));
            const w = wu * smoothstep(brink - 6, brink, v) * (1 - smoothstep(35, 80, t));
            if (cap < h)
                h = h + (cap - h) * w;
        }
    }
    // snow drifts everywhere except on pads and the ice
    if (h > 0.5 && flat < 1)
        h += snowDrift(x, z) * (1 - flat) * smoothstep(0.5, 3, h);
    return h;
}
const CARVE_CELL = 24;
const carveCols = Math.ceil((WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / CARVE_CELL);
const carveRows = Math.ceil((WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / CARVE_CELL);
const carveGrid = new Map();
const carved = [];
function smoothProfile(hs, spacing, windowM, passes) {
    let cur = hs;
    const n = hs.length;
    for (let p = 0; p < passes; p++) {
        const prefix = new Float64Array(n + 1);
        for (let i = 0; i < n; i++)
            prefix[i + 1] = prefix[i] + cur[i];
        const next = new Float32Array(n);
        const half = Math.max(1, Math.round(windowM / spacing / 2));
        for (let i = 0; i < n; i++) {
            const r = Math.min(half, i, n - 1 - i);
            next[i] = (prefix[i + r + 1] - prefix[i - r]) / (2 * r + 1);
        }
        cur = next;
    }
    return cur;
}
(function buildCarving() {
    const spacing = 2;
    PATHS.forEach((def, index) => {
        const rules = PATH_RULES[def.kind];
        const samples = samplePath(def, spacing);
        const n = samples.length;
        const xs = new Float32Array(n);
        const zs = new Float32Array(n);
        const raw = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            xs[i] = samples[i].x;
            zs[i] = samples[i].z;
            raw[i] = siteHeight(xs[i], zs[i]);
        }
        let hs = smoothProfile(raw, spacing, rules.windowM, 3);
        // pin the ends to the ground they start and finish on (pads, the lake shore)
        hs[0] = raw[0];
        hs[n - 1] = raw[n - 1];
        // cut-and-fill: limit the grade like a built path, keeping both ends pinned
        const step = rules.maxGrade * spacing;
        for (let it = 0; it < 6; it++) {
            for (let i = 1; i < n - 1; i++)
                hs[i] = clamp(hs[i], hs[i - 1] - step, hs[i - 1] + step);
            for (let i = n - 2; i > 0; i--)
                hs[i] = clamp(hs[i], hs[i + 1] - step, hs[i + 1] + step);
        }
        hs = smoothProfile(hs, spacing, 8, 1);
        hs[0] = raw[0];
        hs[n - 1] = raw[n - 1];
        for (let it = 0; it < 3; it++) {
            for (let i = 1; i < n - 1; i++)
                hs[i] = clamp(hs[i], hs[i - 1] - step, hs[i - 1] + step);
            for (let i = n - 2; i > 0; i--)
                hs[i] = clamp(hs[i], hs[i + 1] - step, hs[i + 1] + step);
        }
        const half = def.width * 0.5 + 0.35;
        const bankW = def.kind === 'plowed' ? 1.5 : 0.95;
        // cut / fill banks no steeper than ~1:1.6, smoothed along the path
        let sh = new Float32Array(n);
        for (let i = 0; i < n; i++)
            sh[i] = Math.min(32, rules.shoulder + 1.6 * Math.abs(raw[i] - hs[i]));
        sh = smoothProfile(sh, spacing, 16, 2);
        for (let i = 0; i < n; i++)
            sh[i] = Math.max(rules.shoulder, sh[i]);
        const idx = carved.length;
        carved.push({ def, index, xs, zs, hs, sh, half, shoulder: rules.shoulder, bank: rules.bank, bankAt: half + bankW * 0.9, bankW });
        for (let i = 0; i < n - 1; i++) {
            const reach = half + Math.max(sh[i], sh[i + 1]);
            const minX = Math.min(xs[i], xs[i + 1]) - reach;
            const maxX = Math.max(xs[i], xs[i + 1]) + reach;
            const minZ = Math.min(zs[i], zs[i + 1]) - reach;
            const maxZ = Math.max(zs[i], zs[i + 1]) + reach;
            const c0 = Math.floor((minX - WORLD_BOUNDS.minX) / CARVE_CELL);
            const c1 = Math.floor((maxX - WORLD_BOUNDS.minX) / CARVE_CELL);
            const r0 = Math.floor((minZ - WORLD_BOUNDS.minZ) / CARVE_CELL);
            const r1 = Math.floor((maxZ - WORLD_BOUNDS.minZ) / CARVE_CELL);
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    if (c < 0 || r < 0 || c >= carveCols || r >= carveRows)
                        continue;
                    const key = r * carveCols + c;
                    let list = carveGrid.get(key);
                    if (!list)
                        carveGrid.set(key, (list = []));
                    list.push(idx, i);
                }
            }
        }
    });
})();
const NO_PATH = { weight: 0, height: 0, core: 0, bank: 0, dist: Infinity, path: -1 };
/**
 * Path influence at (x, z): weight in [0, 1] (1 on the walking surface), the
 * carved elevation of the nearest path there and the snowbank on its shoulder.
 */
export function pathCarve(x, z) {
    const c = Math.floor((x - WORLD_BOUNDS.minX) / CARVE_CELL);
    const r = Math.floor((z - WORLD_BOUNDS.minZ) / CARVE_CELL);
    if (c < 0 || r < 0 || c >= carveCols || r >= carveRows)
        return NO_PATH;
    const list = carveGrid.get(r * carveCols + c);
    if (!list)
        return NO_PATH;
    let bestW = 0;
    let bestH = 0;
    let bestCore = 0;
    let bestD = Infinity;
    let bestBank = 0;
    let bestPath = -1;
    for (let k = 0; k < list.length; k += 2) {
        const p = carved[list[k]];
        const i = list[k + 1];
        const ax = p.xs[i];
        const az = p.zs[i];
        const abx = p.xs[i + 1] - ax;
        const abz = p.zs[i + 1] - az;
        const len2 = abx * abx + abz * abz || 1;
        const t = clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
        const dx = x - (ax + abx * t);
        const dz = z - (az + abz * t);
        const d = Math.sqrt(dx * dx + dz * dz);
        const shw = p.sh[i] + (p.sh[i + 1] - p.sh[i]) * t;
        const w = 1 - smoothstep(p.half, p.half + shw, d);
        // inside the walking surface every segment has w = 1: prefer the nearest one
        if (w > bestW || (w === bestW && w > 0 && d < bestD)) {
            bestW = w;
            bestD = d;
            bestH = p.hs[i] + (p.hs[i + 1] - p.hs[i]) * t;
            bestCore = 1 - smoothstep(p.half - 0.5, p.half, d);
            const q = (d - p.bankAt) / p.bankW;
            bestBank = d > p.half ? p.bank * Math.exp(-q * q) * smoothstep(p.half, p.half + 0.5, d) : 0;
            bestPath = p.index;
        }
    }
    if (bestW <= 0)
        return NO_PATH;
    return { weight: bestW, height: bestH, core: bestCore, bank: bestBank, dist: bestD, path: bestPath };
}
/** Final terrain elevation (meters) at world (x, z). */
export function heightAt(x, z) {
    const h = siteHeight(x, z);
    const pc = pathCarve(x, z);
    return pc.weight > 0 ? h + (pc.height - h) * pc.weight + pc.bank : h;
}
/** Central-difference surface normal (unit vector as [nx, ny, nz]). */
export function normalAt(x, z, eps = 1.0) {
    const hL = heightAt(x - eps, z);
    const hR = heightAt(x + eps, z);
    const hD = heightAt(x, z - eps);
    const hU = heightAt(x, z + eps);
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const len = Math.hypot(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
}
/** Slope as rise/run (0 = flat, 1 = 45°). */
export function slopeAt(x, z, eps = 1.0) {
    const n = normalAt(x, z, eps);
    return Math.sqrt(1 - n[1] * n[1]) / Math.max(1e-4, n[1]);
}
/** Bulk sample heights on a regular grid (row-major, z rows). */
export function sampleHeightGrid(minX, minZ, maxX, maxZ, nx, nz) {
    const out = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        const z = minZ + ((maxZ - minZ) * j) / (nz - 1);
        for (let i = 0; i < nx; i++) {
            const x = minX + ((maxX - minX) * i) / (nx - 1);
            out[j * nx + i] = heightAt(x, z);
        }
    }
    return out;
}
