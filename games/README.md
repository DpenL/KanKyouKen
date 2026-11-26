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
| `apps/kumiki` | *Kumiki*: assemble kanji from look-alike component tiles. Its rules come in presets (see "Kumiki: rules and presets"). |
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
`changing-melody`, `sfx`, `silent` to its sound mode; Kumiki takes the id of a rule
preset), `rules=<preset and changes>` (Kumiki, see "Kumiki: rules and presets"),
`seed=<text>` for a reproducible session, `debug` for developer aids. Put the token in the fragment (`#token=`), which
browsers do not send to servers.

Each scored action becomes one event with `event_type`, `item_id` (the character),
`task_id` (the stage) and a payload that always includes `correct` and
`response_time_ms`; see `packages/mechanics/src/telemetry/types.ts`.

### What happens when reporting does not work

- **A link with only some of the four values** (typically the `#token=...` fragment was
  lost on the way) still lets the participant play, but nothing can be recorded. Both
  games then show a notice across the top of the page for the whole session: "Not
  being recorded: the study link is incomplete (no token)". It takes its own room
  there, above the game, so it hides no control (its height is in the CSS property
  `--kk-recording-notice-height` on the root element, for a game that sizes itself to
  the screen, as Kumiki does). A link with none of the values is plain offline play
  and shows nothing.
- **No connection, no answer within 30 seconds, a server error, throttling or a wrong
  `api` address** (network failure, 5xx, 429, 408, 404, 405): events are kept, in
  `localStorage` too, and sent again with a growing delay (1 s doubling up to 60 s) for
  as long as the page is open, and at the next launch of the same study and participant
  in that browser. The notice says that results are kept on the device and sent later
  while the browser's storage holds all of them; when it is full or turned off, the
  notice says that the device cannot keep them and asks to keep the page open until they
  are sent (`CollectorStatus.stored` tells how many are stored).
- **A token the collector refuses** (401, 403): nothing more is sent with it, the notice
  says that the session is not being recorded, and the events stay stored for a launch
  with a token that works.
- **An event the collector refuses as it is** (any other 4xx) is dropped at once.
- **An event the collector cannot store** (it answers 500 whenever its insert fails, for
  example for a session id it does not know) does not hold up the others: after two
  server errors in a row a later event is tried in between, and once a later event was
  accepted while this one was still refused, it is set aside. It stays stored, is tried
  again only while nothing else is waiting and at most every 10 minutes (across launches
  too), and is dropped, and counted, after 5 more server errors, counting only those
  that came after some other event was accepted since its previous try. In an outage,
  where every event is refused, nothing is lost, also when a single request gets
  through: events then set aside wait for the collector to come back. Events can then
  arrive out of recording order, so order by `ts`.
- At most 500 events are held. Beyond that, single actions (stroke and choice attempts,
  hints, listens) are dropped before results, and those before `session_start` and
  `session_end`; the notice then says how many events could not be kept, and the gap
  shows in the delivered data (see "lost events" below).

### Reading the data: duplicates

Delivery is **at-least-once**. An event can arrive more than once: when a request
succeeds but its answer does not come back in time, for whatever was on the wire
when the page closed, which is `session_end` in practice, sent again at the next launch,
and when a participant has two tabs open and the newer one takes over the backlog the
older one still holds.
The collector inserts every request it gets. Every event therefore carries a
client-generated id in its payload, `payload.client_event_id` (a UUID, the same across
every attempt and page load): rows that share it are one event. Keep one row per id
before counting anything, and every row that has no id (recorded by an older build) as
it is, for example

```sql
select distinct on (coalesce(payload->>'client_event_id', id::text)) *
from events
order by coalesce(payload->>'client_event_id', id::text), created_at;
```

### Reading the data: lost events

Every event also carries its running number within its page load,
`payload.client_event_seq`: 1, 2, 3, ... in the order the game recorded the events,
including those that were then dropped (at the 500-event bound, as unstorable, or
refused). After removing duplicates, a gap in the numbers of one page load is that many
lost events. A page load starts again at 1, so a session launched twice has two runs
that each begin at 1 (with its `session_start`); events stored and sent at a later
launch keep the number of the page load that recorded them. Order by `ts` within a
session to see the runs.

### Shared devices

With a link that names a study and a participant, complete or not, Kumiki keeps its
settings and best scores under a storage key of their own per study and participant
(`kk.kumiki.v1:<study>:<participant>`, from `participantStoreKey` in
`@kankyouken/web-kit/app`), so a participant does not start from the previous
participant's choices. Plain play keeps the plain key. The unsent-event
backlog is kept per study and participant as well
(`kankyouken:events:<study>:<participant>`). Both games, and several tabs, of one
participant share that backlog: each keeps what the others stored and takes out only
what it delivered or dropped itself, and the next launch sends whatever earlier tabs
left.

Fude Uta does the same with its settings and stars
(`kk.fude-uta.v1:<study>:<participant>`). A study `condition` still fixes only the sound
mode: judging, learning plan, instruments and volume start from the defaults for every
participant and stay theirs to change (each change is a `settings_change` event).

### Reading the data: Fude Uta

- **`stroke_attempt.response_time_ms`** counts from the moment the stroke could first be
  written: the end of the demonstration or of the pause after a repetition for a first
  stroke, the acceptance of the stroke before for the others. It never includes time in
  which the square took no strokes. In the timed round that holds for its time too: the
  first character's clock (its first response time and `duration_ms`) and the round's
  time (`elapsed_ms`, `round_elapsed_ms`) start when the square first takes a stroke,
  half a second after Start, while that character's `item_start` is when it appears, at
  Start. `recall_result.response_time_ms` is the whole time from the prompt to Done,
  listening included (the half second after Listen in which the square takes no stroke
  as well).
- **`recall_result`** is scored with the judging level the player has set, as the
  learning stages are, and carries it: `judging` (`gentle`, `normal`, `strict`) and the
  matcher's `leniency`. `drawn_count` above `stroke_count` means extra strokes; the
  summary on screen marks them ("+2 extra").
- **`lesson_abandoned`** is recorded when a lesson is left before its end, by the Back
  button, the browser's Back, or closing the page: `mode` (`learn`, `timed`, `recall`),
  `left_by` (`back`, `page-closed`), `lesson`, `position` of the character on screen in
  that part's order, `of`, `completed` characters, `strokes_done` of `stroke_count`,
  `elapsed_ms` on that character, plus `stage_index`, `rep`, `mistakes` (learning),
  `score`, `round_elapsed_ms`, `mistakes` (timed round) or `melody_listens` (from
  memory). `task_id` is the stage that was left; `item_id` is missing when no character
  was on screen. After `page-closed` the browser may bring the page back as it was, so
  more events of that lesson can follow. A demonstration cut short by leaving has no
  `demo_watched`.
- **Whether anything was heard.** `session_start` carries `sound_on` (a sound mode other
  than silent at a volume above zero), `volume` and `audio_available` (the browser has
  Web Audio). Every `settings_change` carries the changed setting and `sound_on` after
  it. `audio_unavailable` is recorded once if the audio layer fails during the session;
  from then on the session is silent whatever `audio_mode` says.
- **`hint_shown`** is not recorded in "Trace the dotted stroke": Hint is not offered
  there, because the dotted stroke already shows all a hint could.
- A control that a click has just brought on screen is disabled until half a second after
  the last tap on it, so neither a double click nor a longer burst of taps hands in a
  character, skips a demonstration or starts a lesson; for that half second the writing
  square takes no pen-down where Listen ("Listen first") or Start uncovered it. Only what
  is new under the pointer is held: a button whose press only redraws its own row (Undo,
  Hint, Listen again) takes a quick second press, a sheet (Settings, About) holds only the
  control that opens under the pointer, and its backdrop ignores only the clicks of the
  one that opened it. From memory, the melody stops once a stroke is written, not at a tap
  on the square. The browser's Back returns to the lesson list.

## Kumiki: rules and presets

Kumiki plays by a named preset and any single rules changed from it. The default
follows the public Zen Hanzi demo as it was seen to play
(`docs/research/zen-hanzi-demo.md`); what Kumiki did before is kept whole as the preset
`classic`. Only rules and numbers are taken from the demo: art, colours, names and
wording are Kumiki's own.

| Preset | Title in Settings | What it plays |
|---|---|---|
| `zen-hanzi` (default) | Close to the paper | A Check button beside the full structure; a feedback panel with counts; tiles in their right slot stay; 3 lives for the whole run, half lost per wrong check and per hint, one back per solved character; out of lives the run ends; the hint stays until Continue; a running total with points for what was right; 18 tiles in 3 rows of 6 with copies of right parts; 4 frames, the right one among decoys from a catalogue. |
| `classic` | Kumiki classic | Check below the board; three lines of feedback; every tile stays; 5 lives per character in Review, unlimited tries in Learn; a lost character returns at the end of the deck; a hint for 25 points, shown for 2.5 s; 100 points per character less 15 per wrong check, and a best score; 12 tiles; near-miss structures with as many slots as the character has parts. |
| `gentle` | Gentle | For young children: no lives, free hints that stay, a full structure is judged by itself, 8 tiles without copies, the same four frames for nearly every character (see `structures`). |
| `study-no-hints` | Study: no hints | `zen-hanzi` without the Hint button. Learn still shows the character before each board; only Review keeps it out of sight, and a link cannot fix the mode yet. |

**Choosing.** A player picks a preset in Settings and can change every single rule
under "Single rules"; the choice is stored (per study participant when the link names
one) and applies from the next deck. A study fixes the rules in the link:

```
https://<host>/kumiki/?rules=<preset>[,<rule>:<value>...]      e.g. ?rules=zen-hanzi,hint:free,lives:5
```

A `condition` that is a preset id does the same. Rules from a link or a condition are
shown in Settings but cannot be changed there, and they are not stored as the player's
own. Upper and lower case are the same. Parts of the value that name no rule or no
value of it are passed over and reported (`rules_ignored`), and so is the earlier of
two parts that set the same rule (the later one counts). A value that does not begin
with a preset still fixes the rules: it starts from the `condition`'s preset when there
is one, else from the default, never from rules stored on the device, and a mistyped
preset is reported with the other ignored parts. Settings shows the link value of the
rules in force, ready to copy.

| Rule | Values (the default first) | What it sets |
|---|---|---|
| `check` | `frame`, `bar`, `auto` | A Check button beside the full structure (the demo), below the board (classic), or judging as soon as every slot is filled. |
| `afterCheck` | `keep-correct`, `keep`, `clear` | What stays in the structure after a wrong check: the tiles in their right slot (the demo), every tile (classic), none. |
| `feedback` | `panel`, `lines` | A panel with counts over the structures, closed with Continue (the demo), or three lines under them (classic). |
| `lives` | `3`, `5`, `2`, `1`, `parts`, `adaptive`, `none` | The number of lives; `parts`: scaled to the number of parts (3 for three parts); `adaptive`: one more after a hard character, one fewer after a first-try solve; `none`: unlimited tries. |
| `livesScope` | `run`, `character` | Lives last the whole run (the demo) or every character starts full (classic). |
| `wrongCost` | `half`, `whole`, `none` | What a wrong check costs. |
| `solveGain` | `one`, `half`, `none` | What a solved character gives back. |
| `atZero` | `end-run`, `retry-later` | Out of lives the run ends (the demo), or only the character is lost and returns at the end of the deck (classic). |
| `learnLives` | `same`, `unlimited` | Learn plays by the same lives as Review (the demo) or has unlimited tries (classic). |
| `hint` | `life`, `points`, `token`, `later`, `unmastered`, `free`, `off` | What a look at the character costs: half a life (the demo); 25 points (classic); a token, earned by first-try solves (one to start with, three at most); the character returns at the end of the deck; it does not count as mastered; nothing; or no hints at all. |
| `hintStays` | `continue`, `timed` | The hint stays until Continue (the demo) or goes away after 2.5 s (classic). |
| `scoring` | `demo`, `classic` | The demo's running total (only the first five wrong checks on a character earn points), or classic points with a best score per deck, mode and set of rules. |
| `structures` | `catalogue`, `alternatives`, `fixed`, `positions` | The frames beside the right one: drawn afresh from a catalogue, any number of slots (the demo); near misses with as many slots as the character has parts (classic); the same four frames for every character, except that a character whose structure is not among them gets it in the fourth place, which gives its structure away (閣, 返 and 落 of the starter set); or the character split in two by position (left and right, top and bottom, enclosing) with the four position classes as frames. |
| `tray` | `3x6`, `3x4`, `2x4`, `4x6` | Rows x tiles per row. |
| `copies` | `yes`, `no` | Identical copies of right parts in the tray, any of which is accepted (the demo), or every right part once (classic). |
| `board` | `compact`, `wide` | The demo's arrangement on every screen (status in the top bar, Hint beside the prompt, structures two by two over the tray), or Kumiki's wide board. |

`docs/MECHANICS.md` Part 2 says for each rule whether it comes from the paper, from the
demo or from us.

### Reading the data: Kumiki

- **`session_start`** carries the rules in force: `rules` (the link form, e.g.
  `zen-hanzi,hint:free`), `rules_from` (`player`, `link` or `condition`),
  `rules_ignored` (parts of a link value that named nothing) and `choices` (every rule
  with its value).
- **`rules_change`** is recorded when the player changes the rules in Settings: `rules`,
  `from` (the rules before) and `choices`. A deck under way keeps the rules it started
  with; the change applies from the next deck.
- **`choice_attempt`** (a check) carries, besides what was built and whether it was
  right: `lives_left`, `lives_max`, `lives_lost` and `lives_gained` (in lives, halves as
  0.5; `null` without lives), `points` earned by this check and the round's `score` so
  far.
- **`hint_shown`** carries what the look cost under the rule in force: `policy`,
  `lives_lost`, `points_lost`, `tokens_spent`, `consequence` (`returns`, `unmastered` or
  `null`), `lives_left`, `tokens_left`, and `out_of_lives` when it took the last life.
- **`item_complete`** carries `solved`, `attempts`, `hints`, `score`, `mastered` (false
  when solved with a hint under `hint:unmastered`), `returns` (the character comes back
  at the end of the deck), `ends_run`, `hint_policy`, `lives_left`, `lives_max`,
  `lives_rule` (`fixed`, `parts`, `adaptive` or `none`) and `tokens_left`.
- **`deck_complete`** and **`deck_abandoned`** carry the totals: `score`, `chars`,
  `solved`, `mastered`, `first_try`, `hints`, `out_of_lives`. The totals count finished
  characters only: what a character under way had earned for wrong checks when the deck
  was left is in its `choice_attempt` events (`score`). A run is complete when nothing
  is left to play, whether or not its summary was looked at: one that the lives ended,
  or whose last character is settled, is recorded as `deck_complete` even when the
  player leaves before the summary. `deck_abandoned` means a character was still to
  play.

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
