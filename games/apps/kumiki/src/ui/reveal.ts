/**
 * The end of a round: the tiles give way to the real character, written stroke by
 * stroke in time with its melody, each part in a colour of its own.
 */

import { decompose } from "@kankyouken/mechanics/components";
import type { Round } from "../round";
import type { App } from "./app";
import { button, h } from "./dom";
import { createGlyphBoard } from "./glyph-board";
import { tileShape } from "./shapes";

/** Ink colours for the parts, dark enough to read on pale wood. */
const PART_COLORS = ["#1f3a93", "#b3371f", "#1f6f4a", "#7a2f8f"] as const;
/** The audio port starts a timeline this long after `play`; the drawing waits the same. */
const AUDIO_LEAD_MS = 50;
/** Pace of the drawing when there is no melody to follow. */
const PLAIN_STROKE_MS = 320;

export interface RevealOptions {
  readonly round: Round;
  readonly progress: string;
  /** True when a failed character will come back at the end of the deck. */
  readonly returns: boolean;
  next(): void;
}

export function revealScreen(app: App, options: RevealOptions): { screen: HTMLElement; leave(): void } {
  const { round } = options;
  const glyph = app.content.glyphs.get(round.char)!;
  const entry = app.content.lexicon.get(round.char);
  const solved = round.state.solved;
  const parts = decompose(glyph, { known: app.content.context.known });
  const colorOf = (stroke: number): string => {
    const part = parts.strokes.findIndex((strokes) => strokes.includes(stroke));
    return PART_COLORS[Math.max(0, part) % PART_COLORS.length]!;
  };

  const board = createGlyphBoard(glyph, `The character for ${entry?.meaning ?? round.char}`);
  const legend = h(
    "ul",
    { class: "parts", "aria-label": "Parts" },
    ...parts.components.map((component, index) => {
      const tile = round.puzzle.tray.find((candidate) => candidate.role === "correct" && candidate.shows === component);
      const chip = h("li", { class: "part" });
      chip.style.color = PART_COLORS[index % PART_COLORS.length]!;
      if (tile !== undefined) chip.append(tileShape(tile.glyph));
      return chip;
    }),
  );

  const melody = app.sound.melody(glyph);
  const timeline =
    melody.notes.length === glyph.strokes.length
      ? melody.notes.map((note) => ({ stroke: note.stroke, startMs: note.start * 1000, durationMs: note.duration * 1000 }))
      : glyph.strokes.map((_, stroke) => ({ stroke, startMs: stroke * PLAIN_STROKE_MS, durationMs: PLAIN_STROKE_MS * 0.85 }));
  const playback = melody.play();
  const timers = timeline.map((step) =>
    window.setTimeout(() => void board.writeStroke(step.stroke, step.durationMs, colorOf(step.stroke)), AUDIO_LEAD_MS + step.startMs),
  );

  const screen = h(
    "main",
    { class: "screen reveal", "data-outcome": solved ? "solved" : "failed" },
    h("header", { class: "bar" }, h("span", { class: "bar-progress" }, options.progress)),
    h("p", { class: "eyebrow" }, solved ? "Joined" : "Out of lives"),
    board.element,
    legend,
    h("h1", { class: "meaning" }, entry?.meaning ?? ""),
    h("p", { class: "reading", lang: "ja" }, entry?.reading ?? ""),
    solved
      ? h("p", { class: "points", "data-points": round.state.score }, `+${round.state.score} points`)
      : h(
          "p",
          { class: "points points-none" },
          options.returns ? "No points this time. It comes back at the end of the deck." : "No points this time.",
        ),
    h("div", { class: "actions" }, button("Next", { class: "primary", "data-action": "next" }, options.next)),
  );

  return {
    screen,
    leave() {
      for (const timer of timers) window.clearTimeout(timer);
      playback.stop();
      board.dispose();
    },
  };
}
