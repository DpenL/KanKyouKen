# Mechanics catalogue

This workspace re-implements, from scratch, the mechanics of two research games by
Oleksandra Keehl and colleagues, as an engine-agnostic library that other games can
reuse:

- **Radical Tunes**: kanji stroke tracing in which every radical owns a melody.
  Keehl & Melcer, FDG 2019 (DOI 10.1145/3337722.3337764); extended in "Music to My
  Ears", *Multimodal Technologies and Interaction* 5(12):83, 2021 (DOI
  10.3390/mti5120083).
- **Zen Hanzi**: assembling hanzi from look-alike component tiles. Keehl, Kao &
  Melcer, FDG 2022 (DOI 10.1145/3555858.3555875).
- Both are chapters of Keehl's 2023 UC Santa Cruz dissertation, *Evidence-based
  gamification and mnemonics for logographic writing systems* (eScholarship 57z2740k).

Nothing of the original games is copied: no names, art, audio, level data or code. The
two games in `apps/` are original games built on the same mechanics.

## How reliable this catalogue is

**The papers could not be opened while this was written.** Every statement about them
below was reconstructed from search-engine excerpts of the indexed PDFs, cross-checked
between independent passes. The rules marked *stated* were returned as near-verbatim
quotations by several differently worded queries and agree with each other, but wording,
numbers and figure references have not been checked against the PDFs. Before citing
anything here in a publication, check it against the source.

Each rule carries one of three labels:

| Label | Meaning |
|---|---|
| **stated** | Returned as a quotation from the paper or dissertation. |
| **inferred** | Follows from stated rules, but no excerpt says it outright. |
| **ours** | Not in the sources (or left open by them). A design decision made here. |

## Design principles the sources set

The Zen Hanzi paper lists six principles, which also describe Radical Tunes (*stated*):

1. Intrinsic pleasure is a must: appealing graphics and sound, plentiful feedback.
2. Short rounds that fit micro-leisure intervals.
3. The learning content is integrated into the game (no "answer a quiz to shoot").
4. No orthogonal mechanics: every action serves the learning goal.
5. Scalable in authoring burden: no hand-authored level per character.
6. Raise the learner's awareness of the components of a character.

Principle 5 shaped this library most: the melodies, the structures, the look-alikes and
the malformed variants are all **generated from stroke data** instead of authored by
hand, which is where it goes beyond what the papers built.

---

## Part 1. Stroke writing with melodic signatures (from Radical Tunes)

### RT-1 Melodic signature per component — *stated*

Every radical is assigned its own melody; each stroke of the radical is one element of
that melody, in stroke order. Writing a character correctly performs its tune.

- Code: `melody/melodist.ts` (`createMelodist`, `Melodist.motif`, `Melodist.melody`).
- A character's melody is the motifs of its components in writing order — *inferred*
  (the papers describe per-stroke sound and a replayable "kanji melody").
- Which groups count as components: the deepest named groups of the glyph's component
  tree (`glyph/tree.ts`, `segmentUnits`) — *ours*.

### RT-2 Composite reuse — *stated*

"The melody of the 'tree' radical 木 consists of the melody for the 'ten' radical 十
with the additional two stroke tunes."

- Code: `melody/prefix.ts` (`detectPrefixes`), applied in `Melodist.motif`.
- Detecting which component starts with which, from stroke types and shapes — *ours*.
  The papers' melodies were hand-authored; they name algorithmic composition "with
  pitch adjustment where needed" as future work only.

### RT-3 Pitch follows stroke direction — *stated*

"A horizontal stroke is represented by a steady note. A long downward stroke is
accompanied by a significant drop in pitch, while a shorter upward stroke is matched by
a moderate rise in pitch."

- Code: `melody/generate.ts` (`elementForStroke`).
- The generalisation is *ours*: pitch is the stroke's height inside its component's
  frame, quantised to a scale. That yields exactly the three stated cases and extends to
  hooks and turning strokes. Scale (major pentatonic), range, note lengths from stroke
  length, and stereo position from horizontal position are all *ours*; the sources give
  no scale, key, tempo or rhythm rule.

### RT-4 The melody advances only on correct strokes — *stated*

"The melody unfolds with each stroke the player draws correctly." A wrong stroke gives
"a soft ping" and "they would have to draw the latest stroke again". No other penalty
is described.

- Code: `stroke/attempt.ts` (`judgeAttempt`), `scaffold/learn.ts` (`applyAttempt`),
  cue `"error"` in the `AudioPort` contract.
- How a stroke is recognised is not described in any excerpt. The matcher
  (`stroke/match.ts`: endpoint distance, mean distance to the spine, shape by Frechet
  distance, length, direction) and the four verdicts *correct / wrong-direction /
  wrong-order / miss* are *ours*.

### RT-5 Sound source: sustained voice or clip — *stated*

The 2019 build played a pre-recorded element per stroke, with "different instruments
for each radical". The 2021 build generated a tone that "could last for as long as the
player's finger touched the screen", which fixed drawing and audio drifting apart, at
the price of "a single type of melodic sound". Informal feedback then found the
melodies "too similar".

- Code: `AudioPort.startVoice` + `VoiceHandle.setProgress` (sustained),
  `AudioPort.play` (scheduled playback); `TimbreConfig.mode` = `"per-component"` or
  `"single"`.
- Combining the two (a sustained voice **and** a timbre per component) is *ours*; the
  papers never tested it. The eight timbres in `melody/timbres.ts` are *ours*.
- The pitch following the pen along the stroke (`setProgress`) is *ours*; whether the
  2021 tone glided with the finger is unknown.

### RT-6 Scaffold fade — *stated*

2019: animated demo with sound → trace with arrows → trace without arrows. 2021: demo →
"practice drawing the character twice by drawing over the dotted lines, one stroke at a
time" → three times without the dotted guide; "a hint would appear if the participant
attempted to draw the wrong stroke several times in a row". The dotted guide shows the
next stroke with "the biggest dot indicating the beginning of the stroke".

- Code: `scaffold/learn.ts`, presets `PLAN_GUIDED_FADE` and `PLAN_ARROWS` in
  `scaffold/presets.ts`; guides `"arrows" | "dotted" | "outline" | "none"`.
- *Ours*: the hint threshold (3), the two hint levels (start dot, then whole stroke),
  one repetition per stage in the 2019-style plan, and the short `PLAN_QUICK`.

### RT-7 Timed, scored round — *stated*

After learning, "they had to trace the characters appearing on the screen as quickly
and accurately as they could. Each character appeared twice during the game in a
randomized order." Final score and time are shown.

- Code: `scaffold/timed.ts` (`startTimedRound`, `completeTimedItem`).
- The score formula (`DEFAULT_TIMED_SCORING`) is *ours*; the sources give none.

### RT-8 Cue, then write from memory — *stated*

In the 2021 test the participant is told the meaning and the number of strokes; in the
melody condition they "had to listen to the kanji's melody before attempting to write
it, and they could listen to the melody as many times as they liked". No feedback.

- Code: `scaffold/recall.ts`, presets `RECALL_CUE_WITH_MELODY` and `RECALL_CUE_PLAIN`.

### RT-9 Two-axis stroke scoring — *stated*

Free writing is scored per character as "the number of strokes drawn in the correct
order and the number of strokes drawn in the correct direction". Worked example: a
9-stroke kanji with the first two strokes swapped and the last one missing scores 6/9
for order.

- Code: `stroke/free.ts` (`scoreFreeWriting`): `orderCorrect`, `directionCorrect`.
- Attributing drawn strokes to reference strokes (optimal assignment) is *ours*, as is
  the gentler `orderRelative` score. `orderCorrect` reproduces the worked example.

### RT-10 Judgement-free coverage tracing — *stated*

In the 2019 stroke-order test, dots along the lines "would turn green once touched",
with no feedback on correctness.

- Code: `stroke/dots.ts` (`layoutDots`, `feedDotTrace` in `"free"` mode,
  `scoreDotCoverage`). The ordered mode and the scoring of a coverage log are *ours*.

### RT-11 The audio layer as an experimental switch — *stated*

Study 1 compared melodies with a non-musical "chalk on a blackboard" sound; study 2
compared consistent melodies with "ever-changing melodies" so that both groups had
music.

- Code: `StrokeAudioMode` = `"melody" | "changing-melody" | "sfx" | "silent"`,
  `melody/voices.ts` (`strokeVoice`). `"silent"` was never tested by the authors.
- How the changing melodies were generated is unknown; `inventContour` is *ours*.

### RT-12 Spaced review ladder — *stated* (classroom manual, 2019)

Reviews right after learning, then after about 3 minutes, 10 minutes, an hour; no
mistakes moves an item up, more than one mistake makes it due sooner.

- Code: `scaffold/review.ts`, `DEFAULT_LADDER`. Steps beyond one hour are *ours*.

### What the studies found (for design, not as a promise)

- Music raised immersion; in the first study it did not change learning.
- In the second study consistent melodies helped stroke order and direction on
  characters with 7 or more strokes at the immediate test; simple characters showed no
  difference.
- The authors blame melodies that sounded too similar, too few characters and too
  little delay for the weak effects. Hence the emphasis here on distinct timbres.

---

## Part 2. Component assembly (from Zen Hanzi)

### ZH-1 Assemble the character from components — *stated*

"The player must assemble a given hanzi by selecting correct components and placing
them into correct slots in a correct hanzi structure." The prompt is the English
meaning and the pinyin; four structures are offered above three rows of component
tiles; tiles are dragged into slots.

- Code: `components/puzzle.ts` (`createAssemblyPuzzle`), `components/assembly.ts`.
- *Ours*: an explicit Check action (what triggers evaluation in the original is
  unknown), tap-to-place, and how tiles move between slots.

### ZH-2 Structure is part of the answer — *stated*

Structure correctness is reported separately from component correctness.

- Code: `components/layout.ts`; `AssemblyFeedback.structureCorrect`.
- *Ours*: deriving the right structure from stroke data (`layoutFromBoxes`), the
  catalogue of structures and how wrong ones are chosen (`alternativeLayouts`). The
  original's structures were laid out by hand and cover "only a subset".

### ZH-3 A look-alike for every correct component — *stated*

"Zen Hanzi also makes sure to include look-alike options for each correct component",
picked at random from a hand-built database, including variants and "common wrong
versions". Look-alikes "differ by a single extra stroke, some by comparative length of
two strokes, some by whether a stroke crosses another stroke".

- Code: `components/lookalike.ts` (`shapeDistance`, `buildLookAlikeTable`),
  `components/mutate.ts` (`mutateGlyph`: drop a stroke, double a stroke, swap two
  lengths).
- *Ours*: measuring resemblance by pairing strokes, and generating wrong versions by
  rule. Hand-picked pairs are still supported and take precedence (`curated`).
  "Crosses or not" is not generated yet.

### ZH-4 Fine-grained decomposition — *stated*

Characters are broken into "their more basic components" (up to four parts) instead of
the conventional one to three, because every small component "holds its own potential
for errors".

- Code: `components/decompose.ts` (`decompose`, `maxSlots`, `known`).
- *Ours*: splitting top-down along the dataset's component tree, largest part first,
  and only into components the learner can be expected to know.

### ZH-5 Partial, staged feedback — *stated*

After each attempt the player learns "whether they used the correct structure, how
many components are correct, and whether any of the components were in the correct
position". "Once the correct structure is identified, the game also marks which
components were incorrectly tried in each slot."

- Code: `evaluateAttempt` → `AssemblyFeedback`; `AssemblyMemory.slotMisses`.
- *Ours*: counting with multiplicity, and judging positions only once the structure is
  right.

### ZH-6 Memory of tried options — *stated*

"Coloring incorrect components and structures red, and correct ones green."

- Code: `AssemblyMemory.layouts`, `AssemblyMemory.tiles`.

### ZH-7 Learn and Review modes, glyph hint — *stated*

In Learn mode the character is shown before assembly; in Review mode only meaning and
pronunciation guide the player; a Hint button shows the character again.

- Code: `AssemblyMode`, `useHint`.

### ZH-8 Score and lives — *stated* to exist, parameters unknown

- Code: `AssemblyRules`, `DEFAULT_RULES`. Every number is *ours*.

### ZH-9 Composition test — *stated* (study instrument)

Given the right structure, drag components into its slots; score = components placed
correctly.

- Code: `scoreComposition`.

### What the study found

Against a flashcard app (10 characters, 10 minutes), the assembly game gave clearly
better component composition and equal meaning recall, but players felt *less
competent*. The authors warn adopters about this "competence penalty" and note that
single-stroke look-alikes frustrated some players.

---

## Conditions as configuration

| Switch | Values | Where |
|---|---|---|
| Stroke audio | `melody`, `changing-melody`, `sfx`, `silent` | `melody` → `StrokeAudioMode` |
| Timbre | `per-component`, `single` | `melody` → `TimbreConfig.mode` |
| Guidance | `arrows`, `dotted`, `outline`, `none`; hint after N errors | `scaffold` → `LearnPlan` |
| Recall cue | melody `required` / `optional` / `off`; stroke count; meaning | `scaffold` → `RecallCue` |
| Timed round | repeats, shuffle, scoring | `scaffold` → `TimedRoundConfig` |
| Judging | leniency, direction enforced or not | `stroke` → `MatchOptions`, `AttemptOptions` |
| Assembly mode | `learn`, `review` | `components` → `AssemblyMode` |
| Assembly rules | lives, score, costs | `components` → `AssemblyRules` |
| Tray | look-alikes per component, malformed shapes, size | `components` → `PuzzleOptions` |
| Decomposition | max slots, known components | `components` → `DecomposeOptions` |

## Open questions

Only the PDFs or hands-on play can settle these:

- Radical Tunes: the stroke recognition rule and tolerances; whether a backwards stroke
  was rejected in play; score formula and time limit of the timed round; the hint
  threshold; scale, tempo and instruments; how the control melodies were generated.
- Zen Hanzi: what counts as an attempt; number of lives and what costs one; cost of a
  hint; how many tiles the tray holds; which structures exist and how wrong ones are
  chosen; the component database format.

## Using the mechanics in another game

Each module is independent and takes plain data:

```ts
import { createMelodist, detectPrefixes, scheduleMelody } from "@kankyouken/mechanics/melody";
import { judgeAttempt } from "@kankyouken/mechanics/stroke";

const melodist = createMelodist({ glyphs, prefixes: detectPrefixes(glyphs, components) });
const melody = melodist.melody(glyph);            // one voice description per stroke
const verdict = judgeAttempt(penPoints, glyph, nextStroke).verdict;
```

A host supplies three things: glyph data in the format of `glyph/types.ts` (see
`data/` for the KanjiVG converter), an `AudioPort` (`@kankyouken/web-kit/audio`
implements it with Web Audio; any engine can implement its three methods), and pen
positions in glyph space. `apps/kumiki` shows the melody mechanic reused in a game
that is not about stroke order at all.
