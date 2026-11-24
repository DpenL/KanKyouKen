# KanKyouKen games

Reusable mechanics for character-learning games, and two games built on them. Game
clients for the KanKyouKen platform: they can report every scored action to the
platform's event collector, and they run offline without it.

| Path | What |
|---|---|
| `packages/mechanics` | Engine-agnostic TypeScript library: glyph model, stroke judging, instructor-style writing assessment, melodic signatures, scaffolding, component assembly, telemetry events. No DOM, no Web Audio. |
| `packages/web-kit` | Browser adapters: Web Audio voices, pointer capture, SVG glyph view, event-collector sink, launch parameters, the "not being recorded" notice. |
| `data` | KanjiVG converter, the starter character set, and the generated glyph file. |
| `apps/fude-uta` | *Fude Uta*: write kanji stroke by stroke; every component has its own melody. |
| `apps/kumiki` | *Kumiki*: assemble kanji from look-alike component tiles. |
| `docs/MECHANICS.md` | The mechanics, where each rule comes from, and what is our own design. |

The mechanics are re-implemented from published research: two games by Oleksandra
Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022) and a
writing tutor by Paul Taele, Jung In Koh and Tracy Hammond (Kanji Workbook, 2020),
whose ten-metric writing assessment is in the library but not yet shown by a game. The
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
npm run data        # regenerate data/generated from KanjiVG (the only command that may use the network)
```

`npm run e2e` needs a Chromium for Playwright (`npx playwright install chromium`), or
set `KK_CHROMIUM` to the path of an existing Chromium binary.

Building, testing and playing need no network: the glyph file in `data/generated` is
committed, and `npm run build` does not regenerate it. `npm run data` does (it runs the
`generate` script of `@kankyouken/glyph-data`). It converts the pinned KanjiVG revision,
downloading each file once from GitHub into `.cache/kanjivg/`; set `KANJIVG_DIR` to the
`kanji` folder of a local KanjiVG checkout to run it offline.

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

### What happens when reporting does not work

- **A link with only some of the four values** (typically the `#token=...` fragment was
  lost on the way) still lets the participant play, but nothing can be recorded. Both
  games then show a notice along the top of the screen for the whole session: "Not
  being recorded: the study link is incomplete (no token)". A link with none of the
  values is plain offline play and shows nothing.
- **No connection, no answer within 30 seconds, a server error, throttling or a wrong
  `api` address** (network failure, 5xx, 429, 408, 404, 405): events are kept, in
  `localStorage` too, and sent again with a growing delay (1 s doubling up to 60 s) for
  as long as the page is open, and at the next launch of the same study and participant
  in that browser. The notice says that results are kept on the device and sent later.
- **A token the collector refuses** (401, 403): nothing more is sent with it, the notice
  says that the session is not being recorded, and the events stay stored for a launch
  with a token that works.
- **An event the collector refuses as it is** (any other 4xx) is the only kind that is
  dropped because of an answer.
- At most 500 events are held. Beyond that, single actions (stroke and choice attempts,
  hints, listens) are dropped before results, and those before `session_start` and
  `session_end`; the notice then says how many events could not be kept.

### Reading the data: duplicates

Delivery is **at-least-once**. An event can arrive more than once: when a request
succeeds but its answer does not come back in time, and for whatever was on the wire
when the page closed, which is `session_end` in practice, sent again at the next launch.
The collector inserts every request it gets. Every event therefore carries a
client-generated id in its payload, `payload.client_event_id` (a UUID, the same across
every attempt and page load): rows that share it are one event. Keep one row per id
before counting anything, for example

```sql
select distinct on (payload->>'client_event_id') * from events order by payload->>'client_event_id', created_at;
```

### Shared devices

With a complete study link Kumiki keeps its settings and best scores under a storage
key of their own per study and participant (`kk.kumiki.v1:<study>:<participant>`, from
`storeKeyFor` in `@kankyouken/web-kit/app`), so a participant does not start from the
previous participant's choices. Plain play keeps the plain key. The unsent-event
backlog is kept per study and participant as well
(`kankyouken:events:<study>:<participant>`).

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
