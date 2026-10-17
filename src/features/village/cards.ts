/**
 * Info cards for Lysvik: the village, the harbour, the church, the store,
 * the fish landing, the stockfish racks, the boats and the buildings.
 */
import type { InfoCard } from '../../core/interaction';
import type { BuildingInfo } from './houses';

/** a card with a small italic line under the title */
function card(title: string, sub: string, body: string): InfoCard {
  return { title, body: `<p><i>${sub}</i></p>${body}` };
}

export interface VillageStats {
  houses: number;
  rorbuer: number;
  boats: number;
  graves: number;
  candles: number;
  racks: number;
}

export function villageCard(s: VillageStats): InfoCard {
  return card(
    'Lysvik',
    'the fishing village at the fjord mouth',
      `<p><b>About 300 people, ${s.houses} houses, ${s.rorbuer} rorbuer and one shop.</b> Lysvik — "the bay of light" — sits on the south shore where the fjord opens to the sea: painted houses on the terraces above the quay, red fishermen's cabins on stilts at the water, a white church on the top terrace.</p>` +
      '<p>In February the sun clears the southern hills for a few hours around noon. The rest of the day belongs to the windows: every house keeps a lamp on the sill, and the street lamps along the plowed lanes come on by three in the afternoon.</p>' +
      '<p>The skrei — the spawning cod from the Barents Sea — are running now. The boats go out in the dark and come back to the landing before noon; by evening the racks on the rocks are hung with fresh fish.</p>',
  );
}

export function harborCard(boats: number): InfoCard {
  return card(
    'Lysvik harbour',
    'quay, breakwaters and the open berth',
      `<p><b>${boats} boats tonight.</b> The basin froze in January, but the boats keep a berth along the quay and a channel out to the fjord open: you can follow the black water through the ice to the gap between the breakwaters.</p>` +
      '<p>Red light on the west breakwater, green on the east — red to port coming in. The breakwaters are rock piled on rock; in a northerly gale the spray freezes on them in a white crust.</p>',
  );
}

export function churchCard(graves: number, candles: number): InfoCard {
  return card(
    'Lysvik church',
    'white timber church, 1867',
      '<p><b>A long church of white weatherboard with a slate roof and a spire you can see from the fjord.</b> The windows are lit through the evening; the door is never locked.</p>' +
      `<p>${candles} candles are burning in the churchyard tonight, in little glass lanterns among ${graves} graves — through the dark months people keep a light on the graves of their own.</p>`,
  );
}

export function storeCard(): InfoCard {
  return card(
    'Lysvik Handel',
    'the general store',
      '<p><b>Groceries, the post office, fishing gear, wool socks and coffee.</b> Open from half past seven until half past eight, Sundays excepted. The bench by the door is where the village news gets made.</p>' +
      '<p>The kick-sleds outside belong to whoever is shopping: a chair on two long runners that you push along the icy lanes, and take home the shopping in.</p>',
  );
}

export function plantCard(): InfoCard {
  return card(
    'Lysvik Fisk',
    'the fish landing',
      '<p><b>Where the boats land the catch.</b> Cod in the season, haddock and saithe the rest of the year. The fish are gutted and headed here, then tied in pairs by the tail and hung on the racks to dry.</p>' +
      '<p>The floodlights on the harbour side stay on all through the working day — which in February is mostly dark.</p>',
  );
}

export function rackCard(): InfoCard {
  return card(
    'Stockfish racks',
    'hjell',
      '<p><b>Cod drying in the frost and the wind, from February until June.</b> Too cold for flies, too mild to freeze solid: the fish dry slowly to a hard, light stockfish that keeps for years. The heads hang on their own racks.</p>' +
      '<p>The racks stand on the rocks where the wind blows through. On a still night you can hear the fish knock gently against each other.</p>',
  );
}

export function boatCard(state: 'afloat' | 'frozen' | 'land'): InfoCard {
  const body =
    state === 'frozen'
      ? '<p><b>Frozen in for the winter.</b> A small boat moored off the rorbuer, the ice has closed round her. She will be free again in April.</p>'
      : state === 'land'
        ? '<p><b>Hauled up for the winter.</b> A clinker-built skiff on trestles beside the boathouse, upturned keel to the snow.</p>'
        : '<p><b>A sjark — a coastal fishing boat.</b> One or two people, lines and nets, out before dawn in the cod season. Moored alongside the quay in the open berth; the rubber fenders squeak against the stone.</p>';
  return card(state === 'afloat' ? 'Fishing boat' : 'Boat in the ice', 'Lysvik harbour', body);
}

const NOTES: Record<string, string[]> = {
  house: [
    'Built after the war, when half the village was rebuilt in a single summer.',
    'The lamp in the window is on from three in the afternoon until bedtime.',
    'Firewood stacked under the eaves, skis in the snowbank by the door.',
    'A fisherman lives here; the light comes on again at half past four.',
    'The snow is shovelled off the roof twice a winter, usually in March.',
  ],
  rorbu: [
    'A fishermen’s cabin: in the old days twelve men slept here through the cod season.',
    'Built on stilts so the boat could be tied up at the door.',
    'Now let to visitors who come for the northern lights.',
  ],
  naust: ['A boathouse: the slipway runs from the big door down into the water.', 'Tarred against the salt; the smell of tar carries in the cold.'],
  stabbur: ['A storehouse raised on posts so the mice cannot climb in: meat, flour and dried fish for the winter.'],
  shed: ['A woodshed full of birch logs, cut and stacked in the summer.'],
  school: ['The old school, now the village hall: dances, the choir on Thursdays, the 17 May breakfast.'],
  warehouse: ['A warehouse on piles over the water: salt, barrels, nets and lines on three lofts, hauled up by the hoist.'],
  plant: ['The fish landing.'],
  store: ['The general store.'],
};

export function buildingCard(b: BuildingInfo, index: number): InfoCard {
  const notes = NOTES[b.kind] ?? NOTES.house;
  const title = b.name ?? (b.kind === 'rorbu' ? 'Rorbu' : b.kind === 'naust' ? 'Boathouse' : b.kind === 'stabbur' ? 'Stabbur' : b.kind === 'shed' ? 'Woodshed' : 'House');
  return card(title, 'Lysvik', `<p><b>A ${b.desc}.</b> ${notes[index % notes.length]}</p>`);
}
