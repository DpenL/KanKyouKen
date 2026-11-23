# KanKyouKen games

Reusable mechanics for character-learning games, and two games built on them. Game
clients for the KanKyouKen platform: they can report every scored action to the
platform's event collector, and they run offline without it.

| Path | What |
|---|---|
| `packages/mechanics` | Engine-agnostic TypeScript library: glyph model, stroke judging, melodic signatures, scaffolding, component assembly, telemetry events. No DOM, no Web Audio. |
| `packages/web-kit` | Browser adapters: Web Audio voices, pointer capture, SVG glyph view, event-collector sink, launch parameters. |
| `data` | KanjiVG converter, the starter character set, and the generated glyph file. |
| `apps/fude-uta` | *Fude Uta*: write kanji stroke by stroke; every component has its own melody. |
| `apps/kumiki` | *Kumiki*: assemble kanji from look-alike component tiles. |
| `docs/MECHANICS.md` | The mechanics, where each rule comes from, and what is our own design. |

The mechanics are re-implemented from published research on two games by Oleksandra
Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022). The
games here are independent, original games and are not affiliated with the authors.
`docs/MECHANICS.md` states how the rules were reconstructed and how far to trust them.

## Commands

Run from this directory (Node 22.12 or newer).

```bash
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run lint
npm run build       # builds both games into apps/*/dist
npm run e2e         # builds, then plays both games in a browser (Playwright)

npm run dev -w @kankyouken/fude-uta     # develop a game
npm run dev -w @kankyouken/kumiki
npm run data        # rebuild data/generated from KanjiVG
```

`npm run e2e` needs a Chromium for Playwright (`npx playwright install chromium`), or
set `KK_CHROMIUM` to the path of an existing Chromium binary.

## Reporting to the platform

A game reports events when its link carries a study, a participant, the functions URL
and an access token; without them it keeps events in memory only.

```
https://<host>/fude-uta/?study=<study id>&participant=<participant id>&api=https://<project>.supabase.co/functions/v1#token=<JWT>
```

Optional: `session=<session id>`, `condition=<label>` (Fude Uta maps `melody`,
`changing-melody`, `sfx`, `silent` to its sound mode), `seed=<text>` for a reproducible
session, `debug` for developer aids. Put the token in the fragment (`#token=`), which
browsers do not send to servers.

Each scored action becomes one event with `event_type`, `item_id` (the character),
`task_id` (the stage) and a payload that always includes `correct` and
`response_time_ms`; see `packages/mechanics/src/telemetry/types.ts`.

## Data and licenses

Code and the authored set definitions (`data/sets`) are MIT, like the rest of the
repository. The glyph shapes in `data/generated` are converted from
[KanjiVG](https://kanjivg.tagaini.net) (© Ulrich Apel and contributors) and remain
under CC BY-SA 3.0; see `data/generated/NOTICE.md`. Both games show the attribution in
their About dialog. Meanings and readings in the starter set were written for this
project and have not been checked against a dictionary.

## Using the mechanics elsewhere

`@kankyouken/mechanics` has no dependencies and no browser code. A host provides glyph
data (`glyph/types.ts`), pen positions in glyph space, and an `AudioPort` for sound.
See the last section of `docs/MECHANICS.md`.
