# Foxfire Fjord — design

A glass cabin on a snowy Arctic island, under the northern lights. You arrive at night: the aurora
is rippling green over jagged peaks across a frozen fjord, the cabin windows glow amber, smoke
curls from the chimney, and the snow sparkles in the moonlight. Walk down to the frozen lake,
soak in the steaming hot spring, visit the red fishing village, follow the fox's tracks, climb
Fox Peak, or scrub the clock to a short pink polar day.

> In Finnish the northern lights are *revontulet*, "fox fires": an arctic fox running over the
> fells sweeps snow into the sky with its tail, and the sparks become the lights. An arctic fox
> lives on this island.

Everything is procedural (no downloaded models or textures), built with three.js r186,
postprocessing and n8ao, written in TypeScript and shipped as plain ES modules
(`tools/package.mjs`).

## Pillars (in priority order)

1. **The aurora is the hero.** Physically inspired curtains (green 557.7 nm core, red 630 nm tops,
   pink/purple lower fringe at high activity), field-aligned rays that shimmer and drift, folds,
   slow breathing plus an occasional substorm breakup into a corona overhead. It lights the world:
   a green wash on snow, reflections on the ice, the glass and the sea, glow through the clouds.
2. **Snow that reads as snow.** Albedo ~0.9 with blue shadows and cavities, subsurface softness,
   wind-carved drifts and sastrugi, sparkle glints in sun and moonlight, rime on rocks, snow caps
   on every roof, rail, branch and rock. Never flat grey-white.
3. **Warmth against cold.** Amber windows, lanterns, a wood stove with real flicker, steam over
   the hot spring and the hot tub, chimney smoke. Interiors are lamp-lit (unlike daylight-only
   houses) and cosy.
4. **Polar light.** About 69°N in late February: the sun only skims ~10° above the southern
   horizon, the day is a short pink-gold window inside long blue hours, nights are long, dark and
   moonlit. Alpenglow on the peaks, long low shadows, sun dogs and 22° halos.
5. **Feels alive.** The fox trots its rounds and leaves tracks; village windows light up and go
   dark on a schedule; smoke and steam drift with the wind; ice creaks; the kettle steams.
6. **Runs everywhere.** Phones start on low quality; nothing should take seconds of main-thread
   time; features load one by one with a progress bar and fail independently.

## Style rules

- Everything in English; Norwegian/Sámi-flavoured place names are fine.
- Debug global is `window.foxfire`; custom shader program cache keys start with `fox-`.
- Everything belongs to an Arctic winter: no tropical plants, beaches or summer sports.
- Every file starts with a short header comment saying what it does in this world.

## The island

World units are metres. +X = east, −Z = north, +Z = south. Sea level y = 0. The aurora is in the
**north**, so the main views look north (−Z).

A Lofoten-style alpine island, roughly 3 × 3.5 km, cut by a long, steep **fjord** that opens to
the sea in the west and runs east into the island's heart. The outer coast stays sea all round,
so the ocean, its horizon fade and the far distance keep working.

| Place | Where (approx.) | What |
|---|---|---|
| **The Teeth** | north of the fjord | jagged granite/gneiss peaks 650–900 m, snow-plastered, steep couloirs, cornices. The backdrop of every northward view. |
| **Aurora Cabin** | south shore of the fjord, on a knoll ~60–80 m above the water (house origin) | the hero house, facing north across the fjord to the Teeth. |
| **Mirror Lake** | hanging valley east/south-east of the cabin, ~100–120 m, ~350 × 200 m | frozen lake: black ice, snow streaks, cracks, a cleared skating rink, an ice-fishing hut, a lakeside sauna with an ice hole. |
| **Hot spring** | a shelf on the fjord's south wall west of the cabin, ~120–150 m | a steaming natural rock pool with a view down the fjord; a melt ring of wet rock and green moss in the snow, rime-crusted rocks, a small changing hut. |
| **Lysvik** | fjord mouth, south shore, at sea level (~700–1000 m west) | red/ochre/white fishing village: cabins on stilts at the quay, boats in the partly frozen harbour, fish-drying racks, a white church, warm windows, street lamps. |
| **Ice Beach** | outer coast near the fjord mouth | black sand with stranded glassy ice chunks, snowed driftwood, a light swell. |
| **Fox Peak** | south massif, reachable by a switchback trail from the lake | summit ~500–600 m with a cairn, a wind-scoured lookout and a bench — the best aurora view. |
| **Skerries** | offshore | small snowy rock islets. |

Trees: dark Norway spruce in sheltered valleys and lower slopes (treeline ~150–200 m), mountain
birch on margins and up to ~300 m, bare snow and rock above. No trees on the lake or the fjord
ice. Keep view corridors from the cabin, the hot spring and the summit to the north.

Paths (snow-packed or plowed; carved into the terrain with snowbank shoulders): cabin ↔ lake,
cabin ↔ hot spring, cabin ↔ Lysvik (plowed road), Lysvik ↔ Ice Beach, lake ↔ Fox Peak
(switchbacks), plus short footpaths around the cabin and village.

## Aurora Cabin (the hero house)

A Nordic timber cabin with a glass aurora room — clearly a different building type from any
glass pavilion: a **long, low cabin of dark tarred (near-black) board-and-batten with a steep
snow-loaded gable roof and a fieldstone chimney**, plus a **glass gable wing** whose roof and
north end are glazed (an A-frame of glass) so you can lie in bed and watch the aurora.

- Main cabin (~12 × 7 m): entry with skis, boots, snowshoes; a living room around a cast-iron
  wood stove (real flickering fire light, glowing embers, sparks, a kettle); sheepskins, wool
  throws, a low sofa, a rag rug, a bookshelf, a small kitchen nook with an enamel kettle and
  mugs; warm lamps and candles; deep window sills with frost on the panes.
- Glass wing (~7 × 6 m): two low beds facing the north glass, reindeer hides, lanterns, frost
  creeping from the pane edges, snow piled on the glass ridge.
- Outside: a north-facing deck with a wood-fired hot tub (steaming), firewood stacks under the
  eaves, a sled, a lantern string, a fire pit with log benches, icicles, snow drifts against the
  walls, footprint trails.
- Interactions (cards with short, warm design notes; English): lamps on/off, stove door, hot tub
  lid, curtains on the glass wing.

## Sky, light and weather

- Latitude ~69.3° N, ~21 February: sunrise ~08:15 in the south-east, noon sun ~10°, sunset
  ~15:45, long blue hours, full dark ~18:30–05:00. A waxing gibbous moon high in the evening.
- Aurora activity by hour: none by day, faint arcs at the end of blue hour, peaking around 22:30,
  substorm breakups every few minutes of real time at night.
- Default start time: ~21:45 (aurora on). Time presets: Dawn 08:00, Noon 12:00, Golden 14:45,
  Blue hour 16:30, Aurora 22:00, Late night 02:00.
- Winter star field (Orion in the south, the Plough high, Polaris ~69° up).
- Weather: mostly clear at night; a cloud bank toward the open sea; optional light snowfall
  (particles around the camera) and diamond dust sparkles on cold clear nights.
- Grade: exposure tuned for snow, exposure-relative bloom (windows, lanterns, aurora cores glow
  at night), cold shadows / warm highlights, gentle night grain, dithering.

## Interface

Name **Foxfire Fjord**; subtitle "a glass cabin under the northern lights". Colours: night navy
`#0b1324`, aurora green `#6ef2b0`, warm amber `#ffb866`, snow `#f4f7fb`. Fonts: Inter Variable for
UI, Fraunces Variable for titles (both via `@fontsource-variable` on cdn.jsdelivr.net, linked from
index.html). Places list, guided tour, island map, time bar (a polar light band: a short day
inside long blue and dark hours, with the aurora activity curve), quality settings, sound
(wind, snow crunch, stove crackle indoors, ice creaks on the lake, distant sea), touch controls.

## Technical contract

- `src/world/layout.ts` is the single source of truth for positions and dimensions. Features
  sample `heightAt(x, z)`; never hardcode terrain heights outside declared pads.
- Each feature lives in `src/features/<id>/index.ts`, default-exports a factory taking the shared
  context (`src/core/types.ts`) and returns `{ object, update?, … }`. Register it in
  `src/features/index.ts`.
- Shared shader uniforms live in `src/core/shared.ts` (bind by reference). Snow and aurora
  uniforms are added there.
- Every relative import must resolve to `x.ts` or `x/index.ts` (the packager rewrites them to
  `.js`). No Vite-only imports (`?url`, `?raw`, CSS or JSON imports). Workers are created through
  `src/world/spawn-worker.ts` (falls back to a `data:` URL module worker inside opaque-origin
  frames).
- three is pinned to 0.186.1: `onBeforeCompile` patches depend on its chunk text.
- Glass uses `depthWrite: false` (AO and transparency).
- URL params for testing: `view=<place>`, `time=<hours>`, `quality=low|medium|high|ultra`,
  `cam=x,y,z,tx,ty,tz`, `solo=`/`skip=` feature ids, `shot=1`, `debug`.
