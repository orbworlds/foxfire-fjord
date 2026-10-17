import type { InfoCard } from '../../core/interaction';
import type { HeroKind } from './hero';

/** Short notes on the island's trees (shown when a hero tree is clicked). */
export const CARDS: Record<HeroKind, InfoCard> = {
  spruce: {
    title: 'Norway spruce',
    body: `<p><i>Picea abies</i> grows here near its northern limit: narrow, dark spires with boughs that sweep down and turn up at the tips, so the snow slides off before it can break them.</p>
<ul>
<li>Branchlets hang in curtains below each bough; the whole crown sheds snow like a roof.</li>
<li>Beard lichen hangs from the oldest lower branches, a sign of clean, humid air.</li>
<li>In the shelter of these trees the snow lies shallow, and the forest floor stays a few degrees warmer.</li>
</ul>`,
  },
  ghost: {
    title: 'Snow ghost',
    body: `<p>A spruce on the brink of the knoll, bent by the storms that blow up the fjord from the open sea. Rime and wind-driven snow build up on its windward side until the whole tree is cased in white.</p>
<ul>
<li>Its branches grow only to the lee; the windward side is pruned by ice crystals in the wind.</li>
<li>On clear nights the casing glows green under the aurora.</li>
</ul>`,
  },
  birch: {
    title: 'Mountain birch',
    body: `<p><i>Betula pubescens</i> subsp. <i>czerepanovii</i>: the birch of the treeline, low and many-stemmed, its white bark kept clean by the sun on the snow.</p>
<ul>
<li>Several crooked stems from one base: snow breaks the leaders, and the tree regrows from its roots.</li>
<li>The steam from the hot pool freezes on its twigs as hoarfrost, so this one stands white all winter.</li>
<li>Bare in winter, its fine twigs turn the slopes a soft purple-brown.</li>
</ul>`,
  },
  rowan: {
    title: 'Rowan',
    body: `<p><i>Sorbus aucuparia</i>, planted by every old farm and fishing village in the north for luck and for the birds.</p>
<ul>
<li>The red berry clusters hang on through the winter under caps of snow.</li>
<li>Waxwings and fieldfares strip a tree in a few days when the frost has softened the fruit.</li>
<li>Its grey bark stays smooth and lichen-flecked for decades.</li>
</ul>`,
  },
};
