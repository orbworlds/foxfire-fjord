import { birchTemplate, dwarfBirchTemplate, juniperTemplate, lymeTemplate, spruceTemplate, stalksTemplate } from './trees.js';
/** max camera distance of each template's impostors (small plants vanish first) */
export const TPL_MAX_DIST = [1e9, 1e9, 1e9, 2600, 1e9, 1e9, 900, 700, 420, 520];
/** near-tier instance caps per template (small plants are cheap and many) */
export const TPL_NEAR_CAPS = [1600, 2200, 2200, 3000, 2200, 2200, 4000, 5000, 6000, 6000];
export function buildForestTemplates(atlas) {
    return [
        // lowland Norway spruce: tall, a long full skirt, beard lichen in the old ones
        spruceTemplate(atlas, 301, { height: 17, spread: 0.2, profile: 0.95, load: 0.7, whorl: 0.5, boughs: 7, lichen: 0.12 }),
        // the common mid-size spruce
        spruceTemplate(atlas, 302, { height: 11, spread: 0.22, profile: 0.85, load: 0.8, whorl: 0.45, boughs: 6 }),
        // subalpine candle spruce near the treeline: narrow, heavily loaded
        spruceTemplate(atlas, 303, { height: 7.5, spread: 0.17, profile: 0.7, load: 1, whorl: 0.4, boughs: 6 }),
        // young spruce at the stand edges and in the clearings
        spruceTemplate(atlas, 304, { height: 3.2, spread: 0.3, profile: 1.05, load: 0.6, whorl: 0.36, boughs: 5 }),
        // multi-stemmed mountain birch, white bark
        birchTemplate(atlas, 305, { height: 9, stems: 4, lean: 0.42, crook: 0.8, bark: 'birch', twigs: 'birchTwigs', twigScale: 1.35, limbs: 5 }),
        // old, crooked birch of the treeline: low, many stems, darker bark
        birchTemplate(atlas, 306, { height: 5.5, stems: 4, lean: 0.55, crook: 1.2, bark: 'birchDark', twigs: 'rowanTwigs', twigScale: 1.0, limbs: 4 }),
        juniperTemplate(atlas, 307, { height: 0.75, width: 1.6 }),
        dwarfBirchTemplate(atlas, 308, { height: 0.8 }),
        stalksTemplate(atlas, 309, { height: 1.25 }),
        lymeTemplate(atlas, 310, { height: 1.1 }),
    ].map((b) => b.build());
}
