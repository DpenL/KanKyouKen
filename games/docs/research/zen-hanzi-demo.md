# Zen Hanzi: the public demo, as observed

Observed on 2026-11-25 by playing the public web demo of *Zen Hanzi* (Keehl, Kao & Melcer, FDG 2022;
Unity WebGL build on itch.io) in a headless browser, by mouse only: Learn twice, Review three times.
Only the running game was looked at; no game files were downloaded or unpacked, and no art, audio or
data was copied. Screenshots were kept outside the repository. Each finding says how sure it is.
These are observations of one public build; the paper (MECHANICS.md Part 2) is the citable source.

## Summary

- A fixed set of 10 characters (帮 想 短 路 思 谢 花 到 对 菜), shuffled every session.
- Each board has 4 structure frames in a 2×2 arrangement: one right, three distractors, all changing each time a character is shown. The right structure for a character never changes.
- Below the frames is a tray of 18 tiles (3×6): the right parts, identical copies of them, made-up stroke variants, real look-alikes, and parts of other characters in the set.
- You drag tiles into a frame. When one frame is full a "Check?" button appears, and only then is the attempt judged.

Lives: 3 hearts lost in half steps. Each wrong attempt and each hint costs half a heart. A solve gives back one heart, up to 3. At 0 hearts the whole session ends.

Score: a running total for the session, out of 8900. Wrong attempts still earn partial points. A solve earns less with each attempt and gets a bonus on the first try. Hints and time cost no points. There is no high score anywhere.

## 1. Is there a Check button, or is an attempt judged as soon as the slots are filled or as soon as one tile is placed? What does the feedback panel say, and what happens on Continue?

*Certainty: seen-several-times.*

There is a Check button, and nothing is judged until you click it.
- When every slot of one frame is filled, a yellow "Check?" button appears beside that frame, over the neighbouring frame, and the other frames dim.
- While building you can put tiles into several frames at once, move a tile between frames, or drop it on an occupied slot (the old tile goes back to its own place in the tray). A plain click on a tile does nothing; tiles are dragged.

Wrong-attempt panel. On the left is the frame you tried, with its tiles coloured. On the right:
- "Structure:" then "Correct" (black) or "Incorrect" (red).
- "Components:" then "a/b Correct" and "c/b Correct Position". A line is black at full marks and red otherwise.
- b is the number of slots in the frame you chose. Example: 路 (4 parts) tried in a 3-slot frame showed 3/3 Correct, 0/3 Correct Position.
- Button "Continue".

Tile colours:
- green = right part, right slot
- yellow = part of the character in the wrong slot
- orange = not part of the character
- tan = a look-alike or variant of the part that belongs in that slot (身 variant, ⺍ for 爫, 厶 for the top of 至)
- Inside a wrong frame the colours did not always match the panel text; this is the one unclear area.

Continue after a wrong attempt:
- Tiles in the right slot stay in the frame. They are not locked and can be dragged out again.
- All other tiles go back to their original tray positions, tinted with their colour. All copies of the same part share the colour.
- The tried frame stays tinted: green if the structure was right, orange if it was wrong.
- Each slot shows a small red mark of the tile that was tried there.

Right attempt: the panel reads "You got it!" with the pinyin, the English meaning and Continue, and the pieces merge into the whole character. A first-try solve also gets a large "1st Try BONUS" splash. Continue goes to the next intro card in Learn, or straight to the next board in Review.

## 2. Lives: how many, what costs one, what happens when they run out, and do they come back per character or per session?

*Certainty: seen-several-times.*

There are 3 hearts, lost half a heart at a time (6 halves in all).

Costs half a heart:
- Every wrong attempt of any kind: wrong frame, wrong tiles, only swapped positions, or one wrong tile out of three.
- Repeating the exact same wrong answer charges again: 6 identical checks emptied all hearts.
- Every use of the hint.

Costs nothing: placing or moving tiles, and time (a 60-second wait made no difference).

Coming back:
- Hearts carry over from character to character within a session; they are not refilled for each new character.
- Solving a character gives back one heart, up to 3: 1.5→2.5, 2→3, 2.5→3.

Running out:
- At 0 hearts the whole session ends, in both modes.
- The panel reads "You scored: X/8900. You ran out of lives :( Try again for a better score?" with a "Try again" button.
- Try again goes back to the mode menu with the score at 0 and 3 hearts.
- A hint can still be bought with the last half heart, and it ends the session.

## 3. Score: what a solved character is worth, what attempts and hints take off, and whether the trophy number is a running total or a high score.

*Certainty: seen-several-times.*

The trophy number is a running total for the current session. It starts at 0 each session, and no best score is shown anywhere. The end panel says "You scored: X/8900" and then either "Would you like to try and improve your score?" or the out-of-lives text.

Wrong attempts still add points when checked: 100 for the right frame, plus 10 for each placed part that belongs to the character, plus 10 for each part in its right slot. Observed: +140, +160, +130, +120, +100, +30, +10, +0. Every case fits this rule.

A solve is worth less with each attempt. With n = number of parts:
- 1st try (with the "1st Try Bonus"): n=2 → 800, n=3 → 900, n=4 → 1000
- 2nd try: n=2 → 460, n=3 → 540
- 3rd try: n=3 → 280
- 4th try: n=3 → 220

One formula fits all of these: 100 + n×(120 − 20k) + a bonus of 500 on try 1, 200 on try 2 and 0 after (k = attempt number).

The maximum, the sum of the ten first-try values, is 2×800 + 7×900 + 1000 = 8900, which matches the denominator on screen.

Hints and time take nothing off the score. 短 with 2 hints before solving still got +900 and the first-try bonus, and a 60-second wait still got +900.

## 4. Hint: what it shows, for how long, what it costs, how often it can be used, and whether it is in both modes.

*Certainty: seen-several-times.*

- Where: the lightbulb button at the top right, in both Learn and Review.
- What it shows: the intro card, i.e. the whole character on a large tile with pinyin, English meaning and a Continue button, over a dimmed board. In Learn this is the same card shown before each character.
- How long: until you press Continue. It was still up after 10 seconds.
- Cost: half a heart per use, no points.
- How often: unlimited apart from hearts. I used it twice in a row on 短, and four times on 路, the last at half a heart, which ended the run.
- It never marks or places any tile or frame.

## 5. The tray: how many tiles, in how many rows and columns, what is on them, whether a tile can be used twice, and whether it changes between attempts.

*Certainty: seen-several-times.*

Always 18 tiles in 3 rows of 6, all the same size. A placed tile stretches to fill its slot, whether the slot is wide or tall.

What is on the tiles:
- Every needed part, one tile per occurrence (路 needs two 口).
- Identical copies of a right part, any of which is accepted: three 寸 tiles all turned green after 对 was solved.
- Made-up stroke variants of the right parts, which count as wrong: 身 with a long or short last stroke, several 卩/阝/卪 forms, 𡗗/手-like forms, two 匕 forms.
- Real look-alikes: 日/目/自, 土/士, 止/正/上, 矢/失, 木/禾, 心/必, 夂/夕, ⺍/爫, 云/厶.
- Parts of the other characters in the set.

Use: each tile can be used once. It leaves its tray spot when placed and returns there when removed or rejected.

Changes:
- Between attempts on the same character the tray stays the same: same tiles, same positions, only recoloured.
- A new showing of the same character, in another session, gets a different tray.

## 6. The structures: how many frames, their shapes, whether the same set is offered for every character, the frame set for each of the ten characters, and whether a character always gets the same structure.

*Certainty: seen-several-times.*

Every board has 4 frames in a 2×2 arrangement, and exactly one is right. I saw 9 shapes (the names are mine):
- H2: two rows
- V2: two columns
- H3: three rows
- V3: three columns
- G4: 2×2 grid
- T21: two cells over one wide cell
- T12: one wide cell over two cells
- L21: two stacked cells on the left, one tall cell on the right
- R12: one tall cell on the left, two stacked cells on the right

The right structure is fixed for each character. The three distractor frames, and where the right frame sits, change every time the character is shown, so the frame set is not the same for every character.

Frame sets in Review session 1 (order top-left, top-right, bottom-left, bottom-right; * = right):
1. 对: R12, V2*, T12, V3
2. 谢: T21, V3*, L21, V2
3. 到: G4, L21*, T21, V2
4. 菜: H2, V2, H3*, V3
5. 帮: T21*, T12, H3, G4
6. 路: H2, G4*, V3, V2
7. 想: V2, V3, T21*, H2
8. 思: L21, G4, V2, H2*
9. 花: G4, H3, V2, T12*
10. 短: H2, R12*, T21, H3

In Learn session 2 every character had different distractors in different positions but the same right shape (for example 帮: H2, V2, L21, T21*).

No frame nests another frame. Sub-parts are split flat instead: the top of 至 + 土; 一口 + 丷一 for 豆.

## 7. Learn and Review: how they differ, in what order the characters come, what happens after the tenth, and whether a failed character comes back.

*Certainty: seen-several-times.*

Menu text: "Choose the game mode:" with Learn and Review buttons, and the note "In 'Learn' mode, you'll see the hanzi before assembling it."

Learn vs Review:
- Learn shows an intro card before each board: the whole character, pinyin, meaning, Continue.
- Review skips the card; the board shows only pinyin and meaning on the scroll.
- Everything else is identical: hearts, hint, scoring, the 8900 maximum, the end panels.

Characters and order:
- Both modes use the same fixed 10 characters: 帮 想 短 路 思 谢 花 到 对 菜.
- The order is shuffled every session. Learn 1: 帮 想 短 路… Learn 2: 思 帮 想 谢 花 路 短 到 对 菜. Review 1: 对 谢 到 菜 帮 路 想 思 花 短. Review 2 began with 到, Review 3 with 花.

After the tenth: "You scored: X/8900. Would you like to try and improve your score?" and a Try again button, which returns to the mode menu with the score at 0.

Failed characters do not come back. A character can only be left by solving it: there is no skip, and attempts are unlimited while hearts last. Running out of hearts ends the whole session.

## 8. The music or sound button, and any other control or screen.

*Certainty: seen-once.*

The music button is the note icon at the top left. Clicking it swaps the icon to a crossed-out note, and clicking again restores it, so it is presumably a music on/off switch. Sound could not be heard in headless mode; the browser blocked audio until the first click.

There are no other controls: no pause, settings, back, skip, undo or reset. The screen is made up of:
- the header: trophy and score, 3 hearts in a box, and the counter "字 n/10"
- the prompt row: music button, a scroll with pinyin over English, hint button
- the 4 frames and the 18-tile tray
- pop-up panels: mode menu, intro/hint card, feedback, 1st Try Bonus splash, end panels

The Unity footer with a fullscreen button sits outside the game canvas.

## 9. Proportions of the screen: what share of the height the header, frames, feedback and tray take.

*Certainty: seen-several-times.*

The canvas is 514 × 879 px (measured by pixel scan on a review board).

Share of the height:
- header: y 0–95, about 11%
- prompt row (music, scroll, hint): y 95–200, about 12%
- frames (a 2×2 block of frames about 175 px square): y 200–598, about 45%
- gap: about 1%
- tray (3×6 tiles of about 55 px, 72.5 px apart): y 607–812, about 23%
- empty bottom margin: y 812–879, about 8%

Width: the frame block takes about 77% of the width, the tray about 81%, and one tile about 11%.

The feedback panel, intro/hint card and end panel are pop-ups of about 416 × 300 px (81% of the width, 34% of the height), centred over the frame area at y 238–545. The board behind them is dimmed, but the header stays visible and its score and hearts update while the panel is shown. The Check? button is about 230 × 70 px.
