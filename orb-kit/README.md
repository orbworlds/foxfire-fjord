# Orb kit

Run [Orb](https://orbworlds.com) worlds on your own machine, exactly as Orb runs them.

Orb is a place where you make games and worlds by talking, play them together in the browser, and
remix anyone's. Every world is a small web project: an `index.html` and the files it loads. Inside
Orb, a world gets `window.orb`: saves that follow the player, shared state for everyone
(leaderboards, guestbooks), realtime rooms, shops. This kit gives a world all of that on
`localhost`, so you can work on it in your own editor.

```bash
npx github:orbworlds/kit dev path/to/world     # or, inside a world's repository: npm start
```

Open http://127.0.0.1:4242 and press **+ Player** (or open a second tab): every tab is another
player, and they play together.

## What runs where

| On Orb | With the kit |
|---|---|
| The world runs in a sandboxed frame with Orb's runtime | The same frame and the same runtime (built from Orb's source) |
| `localStorage` saved per player, synced to their account | Saved per player in this browser |
| `orb.store`: shared state on Orb's servers | Shared by every tab of this browser |
| `orb.room`, `orb.visitors`: realtime with everyone in the world | Between the tabs of this browser |
| `orb.shop`: players buy with Orb credits; the maker earns 70% | The page's own shop list; buying asks, and charges nothing |
| `orb.me`: the player's Orb name, colour and looks | `Player 1`, `Player 2`… (`?player=2`, `?name=Ada`) |

The page reloads itself when a file changes. Errors from the world show at the top and in the
console with their file and line. `?bare` hides the kit's little bar, `?room=<name>` opens the
world in a named room (what `orb.room.invite` links do).

## Commands

```bash
orb dev [folder] [--port 4242] [--host 127.0.0.1]   # play the world in that folder
orb share                                          # the links that open this repository on Orb
```

`orb share` in a fork of an Orb world's repository prints a link that opens **your version** on
Orb as a world of your own, credited as a remix of the original (Orb reads `orb.json`'s `world`).

## `orb.json`

```json
{
  "name": "Bed Wars",
  "world": "orb-bedwars",
  "url": "https://orbworlds.com/orb/bed-wars",
  "repo": "orbworlds/bedwars"
}
```

`world` is the Orb world this code is (or was forked from); `url` its page on Orb; `repo` the
GitHub repository it lives in.

## Types

`orb.d.ts` types `window.orb`. In a JavaScript file:

```js
/// <reference path="./orb-kit/orb.d.ts" />
const orb = window.orb; // undefined outside Orb: keep the world playable on its own (orb?.store)
```

## License

MIT. `lib/runtime.js` is Orb's world runtime, built from Orb's source.
