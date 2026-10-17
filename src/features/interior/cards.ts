/**
 * Info cards for the cabin's rooms: short, warm notes on the things you can
 * touch, how they are made and how they are used through a polar winter.
 */
import type { InfoCard } from '../../core/interaction';

export type InteriorCardId =
  | 'stove'
  | 'stoveDoor'
  | 'kettle'
  | 'basket'
  | 'tools'
  | 'sofa'
  | 'sheepskin'
  | 'plaid'
  | 'rug'
  | 'hide'
  | 'table'
  | 'chair'
  | 'shelf'
  | 'books'
  | 'sideboard'
  | 'antlers'
  | 'lamp'
  | 'candles'
  | 'kitchen'
  | 'sink'
  | 'cooker'
  | 'enamel'
  | 'grinder'
  | 'mugs'
  | 'pantry'
  | 'dining'
  | 'skis'
  | 'poles'
  | 'snowshoes'
  | 'boots'
  | 'pegs'
  | 'bench'
  | 'mat'
  | 'bed'
  | 'duvet'
  | 'lantern'
  | 'nook';

export const INTERIOR_CARDS: Record<InteriorCardId, InfoCard> = {
  stove: {
    title: 'The wood stove',
    body: `<p>Cast iron, squat and heavy: two hundred kilos of it, so it keeps giving off heat for hours after the fire
      has sunk to embers. A spruce stands in relief on each side panel.</p>
      <p>It burns split birch, which lights easily and burns hot and clean, with a smell of resin and tar from the bark.
      Three logs at a time is plenty; the flue into the fieldstone breast warms the whole chimney on the way up.</p>`,
  },
  stoveDoor: {
    title: 'The stove door',
    body: `<p>Ceramic glass in a cast frame, so the fire is company even with the door shut. Open it and the draught
      roars, the flames stand up tall and the room fills with orange light and a few escaping sparks.</p>
      <p>The coiled steel handle stays cool enough to hold bare-handed. The soot on the glass is honest: a hot fire burns
      it clean again.</p>`,
  },
  kettle: {
    title: 'Copper kettle',
    body: `<p>Always on the stove, never quite boiling: hot water for coffee, for washing up, for the hot-water bottle at
      the foot of the bed. When it starts to sing, someone gets up and makes coffee.</p>`,
  },
  basket: {
    title: 'Birch logs',
    body: `<p>Split last spring, stacked under the eaves all summer and brought in a basket at a time, so they are dry and
      warm when they go in. The white bark is the best fire-lighter there is: it is full of oil and burns even damp.</p>`,
  },
  tools: {
    title: 'Fire irons',
    body: '<p>Poker, shovel and brush on their stand: rake the embers forward before adding wood, sweep the hearth after.</p>',
  },
  sofa: {
    title: 'The low sofa',
    body: `<p>Low and deep, so you sink into it with your feet toward the fire. Charcoal wool upholstery: it does not show
      soot or wet dogs, and it smells faintly of sheep when it is warm.</p>
      <p>From here the stove's window is at eye level. On the longest nights nobody bothers with the lamps.</p>`,
  },
  sheepskin: {
    title: 'Sheepskins',
    body: `<p>Thrown over every seat and laid by every bed. Wool is warm even when it is cold to the touch, and nothing is
      nicer to step onto from a warm bed onto a cold floor.</p>`,
  },
  plaid: {
    title: 'Wool throws',
    body: '<p>Woven wool plaids, one over every arm and bed-end, so there is always one within reach when the fire burns low.</p>',
  },
  rug: {
    title: 'Rag rug',
    body: `<p>Woven from strips of old shirts, sheets and work clothes on a cotton warp: every band is somebody's old
      favourite. Rag rugs are washed in the snow in late winter: lay them face down, beat them, sweep the snow off.</p>`,
  },
  hide: {
    title: 'Reindeer hide',
    body: `<p>A reindeer's coat is made of hollow hairs, filled with air: one of the best insulators in nature. Laid in front
      of the hearth it is warm underfoot and sheds the odd hair on everything.</p>
      <p>The herds graze the lichen on the plateaus above the fjord; you may meet some on the way to Fox Peak.</p>`,
  },
  table: {
    title: 'Low table',
    body: '<p>Oiled pine, ringed by mugs. A candle, a bowl of pine cones from the woods behind the cabin, a book left face down at the good part.</p>',
  },
  chair: {
    title: 'Reading chair',
    body: '<p>Angled to the fire, with the reading lamp at its shoulder and the south windows behind: the best seat in the house by day, when the low sun comes in flat across the floor.</p>',
  },
  shelf: {
    title: 'Bookshelf',
    body: `<p>Stained pine, floor to beam, and slowly filling with what guests have left behind: field guides to birds and
      lichens, star charts, thick novels for snowed-in weeks.</p>`,
  },
  books: {
    title: 'Books',
    body: '<p>Cloth spines faded by the summer light that never quite sets, a little warped by the winter that never quite ends.</p>',
  },
  sideboard: {
    title: 'Sideboard',
    body: '<p>Painted in the soft grey-blue of old farmhouse furniture, it holds candles, matches, spare wool socks and the good coffee cups.</p>',
  },
  antlers: {
    title: 'Antlers',
    body: '<p>Shed in spring and found on the plateau: reindeer drop and regrow their antlers every year, both bulls and cows.</p>',
  },
  lamp: {
    title: 'Lamps',
    body: `<p>Linen shades and white enamel, warm bulbs, never overhead light: in a winter this dark the room is lit in pools,
      so the windows stay black and the aurora outside stays bright. Click a lamp to switch it.</p>`,
  },
  candles: {
    title: 'Candles',
    body: `<p>Stearin candles on every deep sill: from outside they make the cabin's windows glow, and from inside they keep
      the dark glass from becoming a mirror. Click to light or snuff them.</p>`,
  },
  kitchen: {
    title: 'Kitchen nook',
    body: `<p>Small and complete: painted cupboards, a slate worktop, a two-plate cooker, open shelves. Everything within
      one step, because in winter the warmest place to cook is the corner nearest the stove.</p>`,
  },
  sink: {
    title: 'Farmhouse sink',
    body: '<p>Fireclay, deep enough to bath a baby or rinse a pot of cloudberries. The water comes from a drilled well and is very, very cold.</p>',
  },
  cooker: {
    title: 'Cooker',
    body: '<p>Two cast plates, a heavy iron pan and the coffee kettle, which hardly ever leaves the left-hand plate.</p>',
  },
  enamel: {
    title: 'Enamel coffee kettle',
    body: `<p>Coffee boiled the old way: bring the water to the boil, take it off, stir in coarse coffee, let it settle,
      pour carefully. Red enamel, chipped at the spout, and never washed with soap.</p>`,
  },
  grinder: {
    title: 'Coffee grinder',
    body: '<p>A box grinder with a brass hopper and a little drawer. Two minutes of cranking for a pot: the sound of every morning here.</p>',
  },
  mugs: {
    title: 'Mugs',
    body: '<p>Stoneware and white enamel, hung on hooks and lined up on the shelf, enough for the whole village to come up for coffee.</p>',
  },
  pantry: {
    title: 'Pantry cupboard',
    body: '<p>Flour, oats, crispbread, jars of lingonberries and cloudberry jam, dried fish from the racks in Lysvik. The north wall keeps it cool.</p>',
  },
  dining: {
    title: 'Table by the window',
    body: `<p>A table for four under the west window, where the short day's last light comes in. Candles at every meal:
      from November to January the sun does not rise at all, and even now it barely clears the mountains.</p>`,
  },
  skis: {
    title: 'Wooden skis',
    body: `<p>Touring skis of laminated pine with bent tips and leather bindings, waxed with tar on the running surface.
      The red pair is the fast pair, reportedly.</p>`,
  },
  poles: {
    title: 'Ski poles',
    body: '<p>Bamboo shafts with cane-and-leather baskets: light, springy, and easy to mend with a bit of tape.</p>',
  },
  snowshoes: {
    title: 'Snowshoes',
    body: `<p>Ash frames bent into a teardrop with a tail, laced with rawhide. On deep fresh snow they get you where skis
      cannot: up through the birch wood to the lake, or out to see where the fox has been.</p>`,
  },
  boots: {
    title: 'Winter boots',
    body: '<p>Rubber feet, leather legs, thick felt liners and a sheepskin cuff. They dry by the door overnight, never by the stove: leather cracks.</p>',
  },
  pegs: {
    title: 'Peg rail',
    body: '<p>Hats, scarves, mittens and the bag for the shop in Lysvik. Mittens always in pairs, at least in principle.</p>',
  },
  bench: {
    title: 'Boot bench',
    body: '<p>Sit, unlace, swap boots for felt slippers. The sheepskin on top is there because the bench is by the door and the door lets in the cold.</p>',
  },
  mat: {
    title: 'Door mat',
    body: '<p>A rag mat for snow from boots: it gets taken out and beaten on the snow every morning.</p>',
  },
  bed: {
    title: 'Beds under the glass',
    body: `<p>Low beds with their heads to the cabin and their feet to the north glass, so you fall asleep looking up into
      the sky. When the aurora breaks up overhead it fills the whole glass roof.</p>
      <p>Turn the lamps off for the best view: the HUD's Lamps switch, or click the lanterns one by one.</p>`,
  },
  duvet: {
    title: 'Duvets',
    body: '<p>Down duvets, thick as a snowdrift, in linen covers. The glass wing is a few degrees cooler than the cabin: that is the point.</p>',
  },
  nook: {
    title: 'Sky-watching corner',
    body: `<p>A fleece and two big cushions right against the north glass, a flask of hot blackcurrant and two mugs:
      the place to sit when the forecast says the lights will come. Turn the lanterns down so your eyes adjust; after
      ten minutes you see twice as much.</p>`,
  },
  lantern: {
    title: 'Storm lanterns',
    body: `<p>Candles in glass, on the gable's sill and by the pillows: enough light to find the bed, not enough to spoil the
      sky. Click one to light or put it out.</p>`,
  },
};
