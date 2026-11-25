# Mechanics catalogue

This workspace re-implements, from scratch, mechanics from published research as an
engine-agnostic library that other games can reuse. Parts 1 and 2 come from two
research games by Oleksandra Keehl and colleagues; Part 3 comes from a writing tutor
by Paul Taele and colleagues:

- **Radical Tunes**: kanji stroke tracing in which every radical owns a melody.
  Keehl & Melcer, FDG 2019 (DOI 10.1145/3337722.3337764); extended in "Music to My
  Ears", *Multimodal Technologies and Interaction* 5(12):83, 2021 (DOI
  10.3390/mti5120083).
- **Zen Hanzi**: assembling hanzi from look-alike component tiles. Keehl, Kao &
  Melcer, FDG 2022 (DOI 10.1145/3555858.3555875).
- Both are chapters of Keehl's 2023 UC Santa Cruz dissertation, *Evidence-based
  gamification and mnemonics for logographic writing systems* (eScholarship 57z2740k).
- **Kanji Workbook**: a writing tutor that scores handwriting the way instructors do.
  Taele, Koh & Hammond, AAAI/IAAI 2020 (arXiv 2504.13888).

Nothing of the original games is copied: no names, art, audio, level data or code. The
two games in `apps/` are original games built on the same mechanics.

## How reliable this catalogue is

The three parts rest on sources of different quality:

- **Part 1 (Radical Tunes) is unchecked.** Its papers and the dissertation could not be
  opened when it was written, and they still cannot be read from here. Every statement
  in it was reconstructed from search-engine excerpts of the indexed PDFs, cross-checked
  between independent passes. The rules marked *stated* there were returned as
  near-verbatim quotations by several differently worded queries and agree with each
  other, but wording, numbers and figure references have not been checked against the
  PDFs. Before citing anything from Part 1 in a publication, check it against the source.
- **Part 2 (Zen Hanzi) has been checked against the paper.** It was first reconstructed
  the same way; in November 2026 every rule was checked against the full text and the
  figures of the paper. Its quotations are verbatim and carry page numbers.
- **Part 3 (Kanji Workbook)** was written from the full text of its paper.

Each rule carries one of these labels:

| Label | Meaning |
|---|---|
| **stated** | Part 1: returned as a quotation from the paper or dissertation by a search engine. Parts 2 and 3: read in the paper, in its text or a figure caption. |
| **shown** | Part 2: visible in a figure of the paper (a screenshot), not said in its text. A screenshot shows one moment of play, so this is evidence, not a rule. |
| **inferred** | Follows from what the source says or shows, but the source does not say it outright. |
| **ours** | Not in the sources (or left open by them). A design decision made here. |

## Design principles the sources set

The Zen Hanzi paper lists six principles (*stated*, pp. 5 and 6). That they also
describe Radical Tunes is not in the Zen Hanzi paper; it may come from the dissertation,
which could not be read, so treat it as unchecked.

1. "Intrinsic pleasure is a must": appealing graphics and sound, plentiful feedback.
2. Short rounds that fit "micro-leisure intervals of contemporary life".
3. The learning content is "endogenously integrated" into the game: no Math
   Blaster-like "add two numbers to shoot at asteroid".
4. No orthogonal mechanics: "Every action should serve to reinforce or increase
   knowledge."
5. Scalable in authoring burden: no exercises written by hand for each character.
6. Raise the learner's awareness of the components of a character.

Principle 5 shaped this library most: the melodies, the structures, the look-alikes and
the malformed variants are all **generated from stroke data** instead of authored by
hand, which is where it goes beyond what the papers built.

---

## Part 1. Stroke writing with melodic signatures (from Radical Tunes)

**Status: unchecked.** Reconstructed from search-engine excerpts (see "How reliable this
catalogue is"). The Radical Tunes papers (FDG 2019; *Multimodal Technologies and
Interaction*, 2021) and the dissertation still cannot be read from here, so the
quotations, numbers and labels below have not been checked against them.

### RT-1 Melodic signature per component — *stated*

Every radical is assigned its own melody; each stroke of the radical is one element of
that melody, in stroke order. Writing a character correctly performs its tune.

- Code: `melody/melodist.ts` (`createMelodist`, `Melodist.motif`, `Melodist.melody`).
- A character's melody is the motifs of its components in writing order — *inferred*
  (the papers describe per-stroke sound and a replayable "kanji melody").
- Which groups count as components: the deepest named groups of the glyph's component
  tree (`glyph/tree.ts`, `segmentUnits`) — *ours*. A component written in separate runs
  (囗 before and after 木 in 困) is one component whose melody continues across the
  runs; a run that the source files away from its partners (`splitRuns`) is not taken
  for the component.

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
  wrong-order / miss* are *ours*. A stub is too short (`minLengthRatio`). A scribble is
  refused however well its ends and its resampled points sit, by three measures taken on
  the drawing cut down to its corners: every pen position within 2.5 % of the glyph
  (`SCRIBBLE_GRAIN`) of the straight run around it is dropped, so tremor, a resting pen
  and pointer noise do not count, and the verdict does not depend on how densely the
  pointer reported positions. It is a scribble when, so measured, it is more than
  `maxLengthRatio` (1.6) times as long as the stroke (a zigzag); when it runs back
  against the stroke's direction, taken the way round that makes this least, by more
  than half the stroke's length (`maxBacktrackRatio`: going over it there and back);
  or when it turns by more than two full turns beyond the stroke's own turning
  (`maxExtraTurning`, 4 pi: a spring, loops). The lower and the upper length limit
  widen with `leniency`, and the upper one, like the shape tolerance, for strokes
  shorter than 15 % of the glyph; the other two are the same at every level. A hook or
  a lead-in tick at an end, an overshoot, a hesitation that goes back over the last
  part of the stroke and on again, and a hand that sways a little all stay within
  them. What still passes: a gentle zigzag (eight turns of up to about 10 % of the
  glyph to either side along the longest strokes) and a wave of three wide swings
  along a long stroke, which do not stand apart from a swaying hand by these measures.

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

**Status: checked against the paper (November 2026).** Source: Oleksandra G. Keehl,
Dominic Kao and Edward F. Melcer, "Zen Hanzi: A Game for Raising Hanzi Component
Awareness", FDG ’22, 11 pages, DOI 10.1145/3555858.3555875. This part was first
reconstructed from search-engine excerpts; every rule has since been checked against the
paper's full text and its figures. Page numbers are the paper's own (1 to 11).
Quotations are verbatim, the paper's spelling included; words read off a screenshot are
given without quotation marks or are marked as such. The playable original was not
consulted: what the paper leaves open is listed under "Open questions".

### What the figures show — *shown*

Figure 6 (p. 4) is the play screen, laid out for a phone held upright. Its caption: "The
player must drag the components from three rows at the bottom into one of the four
structures above to assemble the hanzi indicated by the English translation and pinyin
pronunciation at the top of the screen." From top to bottom:

- A status bar: a trophy with the score (000), three hearts, and a 字 icon with the
  progress 1/10.
- A banner with the pinyin and the meaning (bāng, to help) between two buttons, a
  musical note on the left and a light bulb on the right. The text names a “Hint” button
  but not its icon and never mentions the note; that the bulb is the hint and the note
  plays the character's sound is *inferred* (each hanzi entry names sound files, ZH-11).
- Four structure frames in a two-by-two grid, each divided into equal slots: three
  stacked rows; two side by side over one; a column of two beside one tall slot; one
  tall slot beside a column of two. Every frame has three slots, as many as 帮 has
  components.
- The tray: three rows of six tiles, 18 for a three-part character. Besides the parts of
  帮 and look-alikes of them it holds tiles such as 木, 讠, 身, 彳, 夕 and 失, which look
  like parts of the other nine study characters or look-alikes of those parts
  (*inferred*; the paper does not say how such tiles are chosen).
- No Check or Submit button.

Figure 8 (p. 5), Learn mode: a panel with the character on a tile, its pinyin and its
meaning, and a Continue button.

Figure 9 (p. 5), feedback, in two screenshots:

- Left: a panel over the board repeats the attempt inside the chosen structure, each
  tile coloured: the right part in its right slot green, the two parts that do not
  belong orange. Beside it: **Structure:** Correct / **Components:** 1/3 Correct /
  1/3 Correct Position, the two count lines in red. A Continue button closes the panel.
- Right: the board after attempts. The right structure is filled green; a wrong
  structure that was tried is filled a brownish orange (the caption calls the colour
  red); the two untried frames are unchanged. In the right structure the correctly
  placed tile stays in its slot, and each part that was tried in a wrong slot is drawn
  small and red in a corner of that slot. In the tray, tiles of the character's parts
  are green, even those tried in the wrong slot; tried tiles that are not parts are
  orange; untried tiles keep their colour.

Figure 7 (p. 5) shows look-alikes (ZH-3), Figure 10 (p. 6) component variants (ZH-10),
Figure 11 (p. 6) the four-part split of 路 (ZH-4), Figure 13 (p. 8) the test (ZH-9).

### ZH-1 Assemble the character from components — *stated* (pp. 4, 5)

In Zen Hanzi "the player must assemble a given hanzi by selecting correct components and
placing them into correct slots in a correct hanzi structure" (p. 5). The prompt is the
English meaning and the pinyin; four structures are offered above three rows of
component tiles; tiles are dragged into a structure (Figure 6 caption, p. 4).

- Code: `components/puzzle.ts` (`createAssemblyPuzzle`), `components/assembly.ts`.
- What makes an attempt is not in the paper. Figure 6 has no Check button, so the
  original probably judges a structure as soon as its last slot is filled (*inferred*).
- *Ours*: an explicit Check action, tap-to-place, and how tiles move between slots.

### ZH-2 Structure is part of the answer — *stated* (pp. 5, 6, 10)

The feedback tells the player "whether they used the correct structure" (Figure 9
caption, p. 5), on a line of its own, apart from the components.

- Code: `components/layout.ts`; `AssemblyFeedback.structureCorrect`.
- In the original each hanzi's entry names its structure (ZH-11), so a character always
  comes in the same structure (*inferred* from the encoding); the authors call laying
  out "hanzi structure frames" by hand for each hanzi "very impractical" (p. 6). Four
  structures are offered (Figure 6 caption); in the figure all four have as many slots
  as the target has parts (*shown*). How the three wrong ones are chosen is not said. In
  its current form the game "supports only a subset of possible hanzi structures"
  (p. 10); no figure shows an enclosure.
- *Ours*: deriving the right structure from stroke data (`layoutFromBoxes`), the
  catalogue of structures (rows, columns and seven shapes of enclosure) and how wrong
  ones are chosen (`alternativeLayouts`: near misses first, then others with the same
  number of slots).
- The derivation does not always succeed. Parts that fit neither a row, a column nor
  an enclosure are lined up by their centres as a last resort, and the result says so:
  `Decomposition.layoutGuessed` (from `layoutFromBoxes(...).guessed`). 原 comes out as
  厂, 白 and 小 in a column, for example; of 440 school-grade 1 to 3 kanji converted
  from KanjiVG, 58 are marked with the default options, and none of the 38 characters
  in Kumiki's decks. A part counts as the outer slot of an enclosure when the source
  labels it as one (`tare`, `nyo`) or its own strokes run along at least two adjoining
  sides. A part whose strokes show neither may still be a hanging or sweeping wrap
  whose side is a slanted or curved stroke (厂 in 反, 𠂇 in 友, 气 in 気, 弋 in 式):
  it is taken for one only when where the other parts sit reads as such a wrap (top
  left, bottom left or top right), never as "full" or any other shape. So a stroke that
  crosses another part (亅 through 二 in 于) or a block beside a dot (王 and 丶 in 玉)
  is not an enclosure, and such characters are marked as guesses. So are top-right
  wraps whose strokes cover only the top and whose contents sit clear of every side,
  which reads as "full" (勹 in 句 and 局). A host that asks for the structure must
  leave marked characters out, as Kumiki does when it builds its decks.

### ZH-3 A look-alike for every correct component — *stated* (pp. 5, 6)

"Zen Hanzi also makes sure to include look-alike options for each correct component,
ensuring the students are aware of some of the possible mistakes they could make when
writing" (p. 5). They come from the authors' "own mini-database of hanzi components and
their look-alikes", so that "the game can randomly include at least one look-alike for
each component within the hanzi" (p. 6). Figure 7 (p. 5) gives examples in three rows
(矢 天 禾 木; 正 止 上 土 士; 夂 夕 and two forms of 身): "Some differ by a single extra
stroke, some by comparative length of two strokes, some by whether a stroke crosses
another stroke." The database also holds variants (ZH-10) and "some of the common wrong
versions of components" (p. 6), which "are useful in highlighting mistakes a novice
learner might make" (p. 6).

- Code: `components/lookalike.ts` (`shapeDistance`, `buildLookAlikeTable`),
  `components/mutate.ts` (`mutateGlyph`: drop a stroke, double a stroke, swap two
  lengths).
- How many: the paper says at least one per component; Figures 6 and 9 show 18 tiles
  for three parts (*shown*).
- *Ours*: measuring resemblance by pairing strokes, and generating wrong versions by
  rule (the original picked both by hand). Hand-picked pairs are still supported and
  take precedence (`curated`). A look-alike that differs only in whether a stroke
  crosses another is not generated yet.
- *Ours*: a tile must be something a player can tell apart. A generated wrong version
  is only used when it differs visibly from every other tile in the tray, the right one
  included (`visibleDifference`, `MIN_MALFORMED_DIFFERENCE`): a doubled stroke that lands
  on an existing one, or a dropped stroke that turns 氵 into 冫 next to a real 冫, is
  discarded. Real components may be closer to each other (`MIN_TILE_DIFFERENCE`),
  because genuine near-twins such as 夂 and 攵 are the point of the exercise. Pairs that
  are one shape at two sizes (口 and 囗) cannot be told apart on tiles at all and are
  listed by hand (`sameShape` in the set file); they never share a tray. Both
  thresholds are our judgment, checked by eye on the starter set only.

### ZH-4 Fine-grained decomposition — *stated* (pp. 2, 6, 7)

The paper defines a component as "any part of a hanzi that could be cleanly separated
from the rest of the hanzi" and calls one "‘basic’ if it can’t be further broken down"
(p. 2). Rather than "the conventional hanzi structure classification methods which split
hanzi into 1-3 major parts", Zen Hanzi breaks characters "into their more basic
components" (pp. 6, 7), because "each small component holds its own potential for
errors and is therefore worthy of attention" (p. 7). Two more reasons (p. 7): with
complex components the database "would have to hold exponentially more components in
order to achieve the same granularity of possible errors and their combinations", and
the player would have "fewer incorrect options to eliminate at each stage". The three
Chinese language professors who saw the prototype all "expressed their surprise over how
we divided hanzi into components" (p. 6). Which parts count was decided with Fordham's
list "and our best judgement" (footnote 11, p. 7).

Figure 11 (p. 6): 路 is conventionally 足 beside 各; Zen Hanzi uses four parts in a
two-by-two frame, 口 over 止 on the left and 夂 over 口 on the right. The caption adds
that the two-part split "results in the transformation of the lower-left component into
a different variant of itself, which may confuse the student about the proper shape
within the original hanzi".

- The paper sets no upper limit; four, in Figure 11, is the most any figure shows. The
  ten study characters have 29 parts in all, the maximum score of the composition test
  (p. 9), so about three each (*inferred*).
- Code: `components/decompose.ts` (`decompose`, `maxSlots`, `known`).
- *Ours*: at most four parts by default (`maxSlots`), and splitting top-down along the
  dataset's component tree, largest part first.
  The character's top-level parts are always used, whether the learner knows them or
  not; `known` only limits splitting below that level, where a part is divided further
  only when every piece is listed. With `known` set to the lexicon of the starter set,
  as Kumiki does, 11 of the 38 deck characters therefore still contain a part that is
  not in the lexicon (特 is 牛, 土 and 寸; 開 is 門 and 开, which has no entry and no
  glyph of its own). A component whose runs the source files in different places (it
  shares a stroke with a neighbour, and the source files that stroke under the
  neighbour) is named by such a run only in the split of the character itself, and only
  when nothing inside the run is named and it holds more strokes than its other runs
  filed inside the named group it belongs to: 羊 in 業 (its last two strokes are filed
  under 木), 尸 in 局, ⺍ in 図, 衣 in 袁, and 十 in 重, whose other run is filed with the
  second run of 千 under 里, outside the first. A run with named pieces gives those
  pieces instead (主 is 丶 and 王, not 亠 and 王). A run no larger than the rest of its
  component is the component cut in two, not one missing a stroke (匸 in 亡, beside its
  other half under 亠; 二 in 井; 虫 in 禹), and a smaller one is a stray stroke: the group
  either sits in is not split, because splitting would leave a stroke nobody can name
  (in 泗 the closing stroke of 四 is filed beside 四 as a second run of its 囗). A named
  component of the character is split further only along runs the source keeps
  together, never by such a run, so 禹 stays whole in 属, 亡 in 望 and 忘, 井 in 囲 and
  耕, 制 in 製, 戉 in 鉞, 局 in 跼. What still does not split: of all 6611 KanjiVG kanji,
  26 that the first version of `decompose` split, each into a part named after a
  component it only partly holds, come out in one piece, none of them in school grades
  1 to 3: 丗 乘 井 亡 冓 刄 卸 壷 尺 彦 應 戉 挿 泗 滿 牽 産 瞞 禹 竒 繊 蔵 蹣 駟 鷹 黎.
  They are a single slot, not marked as guesses.
  The other way round, a few characters that the first version kept whole are now split
  by such a run at their own level and come out as guesses: 制 (grade 5; 牛, 巾 and 刂),
  亙, 懴 and 籖; 執 is a guess as it was in the first version. None is in a Kumiki deck,
  and a host that asks for them gets `layoutGuessed` set.

### ZH-5 Partial, staged feedback — *stated* (p. 5)

After each attempt the player learns "whether they used the correct structure, how many
components are correct, and whether any of the components were in the correct
position". "Once the correct structure is identified, the game also marks which
components were incorrectly tried in each slot." (Figure 9 caption, p. 5.) The panel in
Figure 9 counts both, 1/3 Correct and 1/3 Correct Position, so the original tells how
many parts are in place, not only whether any is; and the panel stays over the board
until the player presses Continue (*shown*).

- Code: `evaluateAttempt` → `AssemblyFeedback` (`correctPositions` is the count,
  `anyInCorrectPosition` the yes or no); `AssemblyMemory.slotMisses`.
- *Ours*: counting with multiplicity, and judging positions only once the structure is
  right. The paper shows feedback for a right structure only, so what the original says
  about positions after a wrong one is unknown.

### ZH-6 Memory of tried options — *stated* (p. 5)

"The game helps the player remember which options they tried by coloring incorrect
components and structures red, and correct ones green." (Figure 9 caption.) The text
speaks of "changing the color of the components after each attempt based on their
correctness" (p. 5). In Figure 9 a part tried in the wrong slot still turns green,
because it belongs to the character, and the red is a brownish orange (*shown*).

- Code: `AssemblyMemory.layouts`, `AssemblyMemory.tiles` (a tile is "right" when it
  belongs to the target, wherever it was tried, as in the figure).

### ZH-7 Learn and Review modes, glyph hint — *stated* (p. 5)

"In “Learn” mode, the player is shown a picture of the hanzi before assembling it"
(Figure 8: the character, its pinyin and meaning, and Continue), "while in review mode
they are guided only by the English meaning and Chinese pronunciation of the
hanzi—requiring players to recall the structure of the hanzi without guidance.
Additionally, the “Hint” button allows the player to view the hanzi one more time if
they are stuck." (p. 5)

- Code: `AssemblyMode`, `useHint`.
- *Ours*: what a hint costs, how long the character stays on show, and Kumiki's
  unlimited tries in Learn mode. The paper names no cost and ties no rule to a mode.

### ZH-8 Score and lives — *stated* to exist (p. 5); three lives *shown* (Figure 6)

"Finally, the game has scoring and “lives” mechanics. While those aren’t universally
effective motivators, they are known to provide motivation for some of the more
competitive players" (p. 5). Figure 6 shows three hearts and a score of 000 beside the
progress 1/10. The paper does not say what costs a life, what happens when the last one
is gone, how points are earned, or whether lives last for one character or for the
whole run; that they share the status bar with the run's progress suggests the run
(*inferred*).

- Code: `AssemblyRules`, `DEFAULT_RULES`. Every number is *ours*.

### ZH-9 Composition test — *stated* (pp. 8, 9; study instrument)

The pre-test, and the identical post-test, were run in Qualtrics and consisted of
"matching 10 hanzi with their English meaning, and identifying correct individual
components and their placement in each of the 10 hanzi" (p. 8). The scores were "the
number of hanzi they correctly matched to their English meaning (max score of 10), as
well as the total number of components correctly placed into the hanzi structures (max
score of 29)" (p. 9). Figure 13 (p. 8) shows a composition item: a picture of the right
structure with numbered slots, the meaning (flower) instead of the character, one drop
box per slot, and a column of part tiles with look-alikes among them (亻 and 彳, 目 and
日). The question on the screenshot asks which components go into each of the three
slots of this structure, one component per slot.

- Code: `scoreComposition`; Kumiki's exam (`apps/kumiki/src/exam.ts`).

### ZH-10 Component variants — *stated* (p. 6)

Figure 10 (p. 6) shows 水 and 永, 丰 and 邦. Its caption: "The ‘water’ component (A) is
written with a vertical line at the top in some of the hanzi (B). It’s still considered
the same component according to databases we examined, but it would be incorrect to omit
that line or add it where it isn’t needed. Similarly, the ‘great’ component (C) is
occasionally written in a slanted form (D). In Zen Hanzi, we include both versions of
each component to draw the player’s attention to the possible mistakes they could make."
Published look-alike lists "typically don’t address component variations, as in Figure
10, or include incorrect versions of components", and "the hanzi database would also
have to be checked to replace components with their variants where necessary" (p. 6).
In Figures 6 and 9 the tile for the top left of 帮 is the slanted 丰: a tile shows a part
as it is written in that character (*shown*).

- Code: none. A Kumiki tile shows the component's stand-alone glyph when the set has one
  with as many strokes as the part, and otherwise the part's strokes cut out of the
  target (`createAssemblyPuzzle`); variants are not told apart (*ours*).

### ZH-11 Hanzi encoding and component database — *stated* (pp. 6, 10)

So that nothing has to be authored per level, the authors "designed a succinct way to
encode all the necessary information about each hanzi, including it’s structure and
composition" (p. 6). The example entry, for 想, has the fields `pinyin` (xiǎng),
`hanzi`, `pinyin_sound` (xiang3), `english` (to want), `english_sound` (to_want),
`layout` and `components`:

- `layout`: type `s_H`, `part_1` `s_V`, `part_2` `s_none`.
- `components`: a list of name and position pairs, here the component ids 113, 208 and
  115 at positions 0, 1 and 2.

想 is 相 over 心, and 相 is 木 beside 目; so `s_H` reads as a split into top and bottom,
`s_V` as one into left and right, `s_none` as no split, and the positions number the
slots in reading order, the order Kumiki's slots follow too (*inferred*: the paper
explains neither the codes nor which id is which component). Figure 6's three-row frame
shows that a frame can also be split into three equal parts (*shown*).

The component database maps a component id to the ids of its look-alikes; the two
entries printed (p. 6) map `113` to `211` and `179`, and `pie_h_7_7_7r` to `7_7_7r` and
`115` (ids are numbers or descriptive names). The authors "used Fordham’s list of 800
most common components" as its foundation, but "we only used the basic components that
couldn’t be easily broken up into smaller components, and added some of our own, to
account both for slight but important variations in some components; and some of the
common wrong versions of components" (p. 6). Much of the hanzi data "can be scraped from
free databases online, such as the Chinese Character Decomposition" (on Wikimedia
Commons), and the sounds come from "free online datasets, like the Mandarin Voice
Soundset" (p. 6). The component database "has to be assembled largely from scratch"
(p. 6), and "the images for each component currently need to be drawn by hand" (p. 10);
once those exist, "adding new hanzi with the scalable component and hanzi databases is
relatively easy" (p. 10).

- Code: none of this format. *Ours*: shapes and component trees from KanjiVG,
  structures derived (`layoutFromBoxes`), look-alikes measured (`buildLookAlikeTable`)
  with curated pairs on top, meanings and readings from the set file's lexicon.

### What the study found — *stated* (pp. 7 to 10)

What the game is for: "it is a supplemental activity intended specifically to minimize
component substitution mistakes in writing" (p. 7).

Design. Between subjects, Zen Hanzi against Quizlet (flashcards, plus its two gamified
quizzes). A convenience sample recruited online; 73 people completed the study, and 10
who "received 25 or more points out of 29 on the pre-test" were excluded, leaving 63: 36
with the game and 27 with Quizlet (assignment was slightly weighted towards the game,
footnote 12). Ages 18 to 74 (mean 40.2, median 30); nobody was paid. Steps: a video on
the survey tool, consent, demographics and the pre-test; a 2-minute video tutorial of the
assigned app; 10 minutes with the app on ten characters (到, 路, 帮, 菜, 花, 想, 思, 对,
短, 谢, "chosen for their multi-component structure", p. 9); right after, the post-test,
identical to the pre-test, and 48 questionnaire items from PENS, Situational Interest and
a modified GEQ (Table 1, p. 8). Analysis: ANCOVA with the pre-test scores as covariates.

Results (Tables 2 and 3, p. 9):

- Composition post-test, out of 29: 21.06 (SD 5.52) with the game against 15.81 (SD
  5.99) with Quizlet, p = 0.0006, 95 % CI 1.97 to 6.89; pre-tests 8.78 and 7.19
  (p = 0.28). The abstract gives "p<0.004" and the text "p < .001" for this result.
- Meaning post-test, out of 10: no significant difference (p = 0.17, CI -2.64 to 0.06),
  pre-tests 3.14 and 3. Table 2 prints post-test means of 4.33 for the game and 8.48 for
  Quizlet, a gap that does not fit that interval; one of the numbers is probably
  misprinted, so do not quote these means.
- Pre-test composition scores predicted post-test composition scores (p = 0.002).
- Experience: novelty was higher with the game (13.14 against 11.19, p = 0.03) and
  felt competence lower (GEQ competence 14.44 against 16.67, p = 0.04, although the
  interval printed, -4.53 to 0.53, includes zero; PENS competence 11.67 against 13.07,
  p = 0.08). Enjoyment, exploration, attention, challenge, affect, flow and intuitive
  controls did not differ.

What the authors take from it (p. 10): adopters "should be aware of the possible
competence penalty that comes with increased awareness of hanzi components, at least at
the early stages of learning"; they speculate that players "got the answer wrong more
frequently than the Quizlet users, and therefore felt less competent". Some players
reported "feeling frustrated at having to differentiate between components that differed
by a single stroke or even relative length of a single stroke"; some Quizlet users said
they would memorize one or two components and look for those to identify a character.
The result holds "at least in the short term and with visual clues" (p. 9). Future work
(p. 10): a larger sample, more content, longitudinal tests, testing "participants’
ability to produce hanzi unassisted", ways to counter the loss of felt competence, and
juicier feedback for more enjoyment.

The paper says Zen Hanzi teaches "traditional Chinese characters" (p. 4), yet the study
characters and the screenshots are simplified forms (帮, 对, 谢, 讠).

### Differences between the paper and Kumiki

What the paper does, what Kumiki does, and a recommendation: *keep ours*, *follow the
paper* (make the paper's way the default), or *offer both* (a setting, default named).
Defaults stay close to the original wherever the paper states or shows it. Where the
paper's side is only *inferred*, the recommendation waits for a look at the playable
original before changing a default.

1. **What makes an attempt.** Paper: no Check button in Figure 6; a full frame is
   probably judged at once (*inferred*). Kumiki: a Check button; each arrangement can
   be checked once. *Offer both*; keep Check as the default until the original is seen
   to judge a full frame by itself, then follow it.
2. **Number of lives.** Paper: three hearts (Figure 6); what costs one is unknown.
   Kumiki: five per character in Review, unlimited in Learn; every failed check costs
   one. *Follow the paper*: three by default, the count (or none) configurable.
3. **What the lives belong to.** Paper: shown beside the run's progress, so probably the
   whole run (*inferred*). Kumiki: each character. *Offer both*; per character until
   the original is checked.
4. **Score.** Paper: a running total under a trophy, rule unknown. Kumiki: per
   character 100, minus 15 per failed check and 25 per hint, at least 10; best result
   per deck and mode. *Keep ours* as one scheme and *offer others* (a high score that
   costs something to chase; no score at all for young players).
5. **Hint.** Paper: shows the character again, cost unknown. Kumiki: shows it for
   2.5 s and costs 25 points. *Keep ours*, the cost configurable (points, a life, or
   free).
6. **Feedback panel.** Paper: a panel over the board repeats the attempt with coloured
   tiles, gives counts (1/3 Correct, 1/3 Correct Position) and is closed with Continue.
   Kumiki: three lines between the structures and the tray, with icons, and no panel to
   close; the position line says only whether any part is in place, and "cannot be
   judged yet" after a wrong structure. *Offer both*: the paper's panel and counts as
   the default look, the yes-or-no position line (the caption's wording) as a harder
   setting.
7. **The board after a check.** Paper: the correctly placed tile stays and the others
   are back in the tray (*shown* in one screenshot, Figure 9; as a rule *inferred*).
   Kumiki: every tile stays where the player put it. *Offer both*; the paper's way
   becomes the default once the original confirms it.
8. **Colours.** Paper: whole tiles and frames filled green or red (orange in the
   screenshot). Kumiki: green and red outlines, not fills, with ✓ and ✕ badges; a wrong
   structure gets a dashed border and a wrong tile is hatched. *Offer both*: the
   paper's fills as the default look, keeping our badges and hatching with them so
   that the mark does not rest on colour alone.
9. **Tray size.** Paper: 18 tiles in three rows of six for three parts; at least one
   look-alike per part; the other tiles look like parts of the other characters in the
   set. Kumiki: 12 tiles in three rows, two look-alikes per part, fillers from the parts
   used in the deck. *Follow the paper*: 18 tiles in rows of six by default, the size
   configurable.
10. **Structures on offer.** Paper: four, each with as many slots as the target (Figure
    6), chosen by a rule the paper does not give, from "only a subset" of structures,
    no enclosure in any figure. Kumiki: four, with the same slot count, near misses
    first, rows, columns and enclosures. *Keep ours.*
11. **Where the right structure comes from.** Paper: written into each character's
    entry, so fixed per character (ZH-11). Kumiki: derived from stroke data, which is
    also fixed per character; characters whose structure is only a guess are left out
    of the decks. *Keep ours, and offer the paper's way as an override*: a structure
    written into the set file for a character takes precedence, so that guessed
    characters become playable.
12. **How far characters are split.** Paper: into basic components, those that cannot
    be broken down further, with no stated limit. Kumiki: along KanjiVG's tree, at most
    four slots, and below the top level only into parts the deck's lexicon lists.
    *Offer both*: the paper's way (basic parts, still at most four slots) as the
    default if the decks still yield clean structures with it; the lexicon limit for
    decks that teach named parts first.
13. **Shape of a tile.** Paper: a tile shows the part as written in the character (the
    slanted 丰 of 帮), and variants are separate components (ZH-10). Kumiki: the part's
    stand-alone glyph when the set has one. *Follow the paper*, with the stand-alone
    glyph as an option. Look-alikes then have to be drawn in the same positional form,
    or the right tile gives itself away by its shape (*ours*).
14. **Look-alikes and wrong versions.** Paper: chosen by hand from a database,
    including common wrong versions and pairs that differ in whether a stroke crosses
    another. Kumiki: measured by shape and generated by rule (drop, double, swap
    lengths), hand-picked pairs first. *Keep ours* (principle 5), and *follow the paper*
    by adding a crossing-or-not mutation.
15. **Prompt and sound.** Paper: pinyin and English, a recording for each (ZH-11), and a
    sound button (*inferred*). Kumiki: meaning and Japanese reading as text, and a
    melody per component (Part 1). *Keep ours*; a spoken reading can be offered where
    recordings under a suitable licence exist, never the original's.
16. **Learn mode.** Paper: the character first, with pinyin, meaning and Continue; no
    rule tied to a mode. Kumiki: the same, with unlimited tries. *Offer both*;
    unlimited tries stays the Learn default.
17. **Composition test.** Paper: a separate Qualtrics test; the structure drawn with
    numbered slots, the meaning as prompt, a list of parts with look-alikes, and a
    meaning-matching task beside it. Kumiki: an in-game exam with only the right
    structure, filled from the puzzle's tray, results at the end of the deck, no meaning
    task. *Keep ours*; add the meaning task as an option if Kumiki is used to repeat the
    study.
18. **Content.** Paper: Chinese characters (simplified in the study, see above).
    Kumiki: Japanese kanji from KanjiVG. *Keep ours.*

---

## Part 3. Instructor-style writing assessment (from Kanji Workbook)

Source: Paul Taele, Jung In Koh, Tracy Hammond, "Kanji Workbook: A Writing-Based
Intelligent Tutoring System for Learning Proper Japanese Kanji Writing Technique with
Instructor-Emulated Assessment", AAAI/IAAI 2020, arXiv 2504.13888. **This part was
written from the paper's full text**, so *stated* here means read in the paper, and the
quotations are verbatim.

Code for all of it: `stroke/assess.ts` (`assessWriting`), contract in section 4 of
`stroke/types.ts`.

### KW-1 Ten metrics in three groups — *stated*

The paper expands the usual order-and-direction checks "to a total of ten metrics",
derived from instructor interviews and classroom observations, "grouped together into
the following types: structure, technique, and precision".

- Structure: "stroke match, stroke valid, and stroke exist".
- Technique: "stroke order and stroke direction".
- Precision: "stroke edit, stroke speed, stroke length, stroke closeness, and symbol
  speed".
- Code: `AssessmentMetricId`, `AssessmentGroup`; one `MetricResult` per metric.

### KW-2 Structure: matched, missing and extraneous strokes — *stated*

- Stroke match "assesses how many correct matches exist between the user's input
  strokes and the expert's model strokes".
- Stroke valid "assesses how many model strokes correctly match to the user's
  corresponding input strokes", which shows "whether a student has missing correct
  strokes".
- Stroke exist "assesses how many input strokes correctly match to the expert's
  corresponding model strokes", which shows "whether a student has extraneous strokes".
- *Ours*: how strokes are paired. The paper pairs them with a Hausdorff-distance
  template matcher in the manner of the $P recogniser; this library reuses its own
  one-to-one attribution (`scoreFreeWriting`). The counts and what each is out of are
  ours too.

### KW-3 Technique: order and direction — *stated*

Stroke order "assesses how many of the user's input strokes are written in temporal
correct order"; stroke direction likewise for direction. The paper decides which end of
a stroke is which by the distance error over the whole stroke rather than the endpoints
alone, because "both endpoints of a user's stroke may have similar distances to an
endpoint of the corresponding expert stroke (e.g., small strokes, long strokes with
close endpoints)".

- Code: `stroke-order` counts the written strokes that are in the right order relative
  to each other (the longest such run: `orderRelative` of `scoreFreeWriting`), out of
  the reference strokes; `AssessedStroke.orderOk` marks them. A stroke that was left
  out costs one point and leaves the strokes after it in order, and so does one stroke
  written too early or too late. This is not the positional count of RT-9
  (`orderCorrect`), where a missing first stroke makes every later stroke wrong;
  `scoreFreeWriting` keeps that one for the Radical Tunes scoring.
- Code: `stroke-direction` is taken from `scoreFreeWriting`. The paper's concern about
  endpoints is why `matchStroke` lets the direction test decide for tiny strokes.

### KW-4 Precision: edits, length, closeness, speed — *stated*

- Stroke edit "assesses how many times the student edits their input strokes during
  their character writing session".
- Stroke length and closeness "assess the stroke length and spatial distances,
  respectively, between each matched pair of input and model strokes".
- Stroke and symbol speed "assess the differences in relative writing time duration
  between the input and models' strokes and characters, respectively".
- Thresholds were "empirically derived from the expert model templates"; the paper
  gives no numbers. Every threshold in `DEFAULT_ASSESSMENT_THRESHOLDS` is *ours*.
- *Ours*: the edit count is supplied by the host (`edits`). Speed needs a model's
  timing; the paper's models were recorded from an expert, this library's glyph data
  has no timing, so the reference is stroke length at a fixed pace (`referencePace`)
  unless recorded durations are passed in (`referenceDurationsMs`).

### KW-5 Bring writing and model to a common size and place first — *stated*

Model templates are normalised by resampling each stroke "into 64 equally-spaced
points", scaling "the template's bounding box to a size of 250 pixels" and translating
it "to the origin"; the input gets "the same transformation algorithms".

- Code: `fitToReference` (default on) maps the drawn character's bounding box onto the
  reference's before comparing. *Ours*: an axis is centred rather than stretched when
  the reference is nearly flat on it (under 15 % of the glyph, as for 一), or when the
  drawing, against its own longer side, is less than 15 % as thick on it as the
  reference is against its longer side (only the horizontal of 十 written). A flat or
  narrow component written flatter or narrower than the reference (灬, 宀, 亻, 氵 at a
  third of their height or width) is still stretched onto it.
- *Ours*: the bounding boxes only agree when the character is complete. A stroke that
  was not written, or a stray mark beside the character, moves a box edge and with it
  every stroke, which would hide exactly what stroke-valid and stroke-exist are there
  to show. So when the plain fit leaves strokes unpaired, the writing is also compared
  as drawn, fitted without each drawn stroke in turn, and fitted onto the reference
  without each of its strokes in turn; the placement that pairs the most strokes (the
  closest among equals) is used and then re-fitted from the paired strokes alone. One
  missing stroke or one stray mark does not spoil the judgement of the rest; several
  missing strokes in a small or off-centre writing still can.

### KW-6 A three-star score per metric, plus an overall score — *stated*

The results view shows, per metric, an animation button and "three stars for providing
a three-point score", and the process ends with "calculate the input data's
performance score".

- Code: `MetricResult.stars`, `WritingAssessment.score`. The star rules and the score
  formula (mean of stars over the available metrics) are *ours*.

### KW-7 Practice and quiz modes — *stated*, not implemented here

Practice mode: trace over "a semi-transparent visualization" of the character, with
Demo and Steps animations, Clear, Undo and Assess. Quiz mode: forward only, no
supplementary information, and "a comprehensive assessment of their lesson-wide
character writing performance at the end of the lesson".

- The pieces exist elsewhere in this library (demo and outline guide in `scaffold`,
  the from-memory round in Fude Uta), but no game here shows the ten metrics yet.

### What this library does not do

- No expert-recorded templates: shapes come from KanjiVG, timing is assumed.
- No per-metric feedback animations or colour key.
- No lesson-wide quiz summary.

### What the study found

Deployed for nine months in first- and second-year university Japanese courses, 94
students (44 using the tutor, 50 not). Mean test scores on a 100-point scale were 92.70
for the tutor group and 86.48 for the control group (two-tailed t-test, p = .046); the
first-year tutor group was ahead by 9.10 points (p = .048), the second-year groups
differed by 0.51. The paper does not say how students were assigned to the two groups,
and the tests had a "strong emphasis on vocabulary and sentence writing", so this is
evidence about course grades, not directly about handwriting. In the interaction study students
found the star ratings useful but less intuitive: some "felt that the ratings were
overly strict", and the ratings for stroke speed, order, closeness and length were the
least intuitive. Worth remembering before putting ten star rows in front of a learner.

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
| Writing assessment | fit to reference, edit count, reference timing, thresholds | `stroke` → `WritingAssessmentOptions` |

## Open questions

Only the PDFs or hands-on play can settle these:

- Radical Tunes (PDFs not read): the stroke recognition rule and tolerances; whether a
  backwards stroke was rejected in play; score formula and time limit of the timed
  round; the hint threshold; scale, tempo and instruments; how the control melodies were
  generated.
- Zen Hanzi. The paper settles the component database format (ZH-11) and shows four
  structures, 18 tiles and three lives (Figures 6 and 9). It leaves open, for play with
  the original: what makes an attempt (no Check button is visible); what costs a life,
  what happens without one, and whether lives last a character or the run; how points
  are earned; what a hint costs; how the wrong structures and the other tiles are
  chosen; whether correctly placed tiles always stay after a check; what the position
  line says after a wrong structure; the full set of structures.

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
