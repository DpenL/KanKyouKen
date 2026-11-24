import type { Lesson } from "@kankyouken/glyph-data";
import type { TimedRoundState } from "@kankyouken/mechanics/scaffold";
import type { Stars } from "../progress";
import { countMistakes, formatDuration } from "../progress";
import type { RecallRow } from "../recall";
import { button, el } from "./dom";
import { starRow } from "./home";

function stat(label: string, value: string): HTMLElement {
  return el("div", { class: "stat" }, el("dt", {}, label), el("dd", {}, value));
}

const PRAISE: Readonly<Record<Stars, string>> = {
  3: "Not a single slip. Beautifully written.",
  2: "A steady hand, with only a few slips.",
  1: "Finished. Another round will smooth out the slips.",
};

/** What the timed round came to, and the way on: the recall round, or back to the lessons. */
export function renderResults(
  lesson: Lesson,
  round: TimedRoundState,
  stars: Stars,
  handlers: { onRecall(): void; onHome(): void },
): HTMLElement {
  return el(
    "section",
    { class: "screen panel results" },
    el("p", { class: "panel-kicker" }, "Lesson complete"),
    el("h1", { class: "panel-title" }, lesson.title),
    starRow(stars),
    el("p", { class: "score", "aria-label": `Score ${round.score}` }, String(round.score)),
    el(
      "dl",
      { class: "stats" },
      stat("Time", formatDuration(round.elapsedMs)),
      stat("Mistakes", String(countMistakes(round.results))),
      stat("Characters", String(round.results.length)),
    ),
    el("p", { class: "panel-text" }, PRAISE[stars]),
    el(
      "div",
      { class: "panel-actions" },
      button("Write them from memory", handlers.onRecall, "primary"),
      button("Back to lessons", handlers.onHome),
    ),
  );
}

/** Shown once the whole recall round is over: per character, how much of order and direction was right. */
export function renderRecallSummary(lesson: Lesson, rows: readonly RecallRow[], onHome: () => void): HTMLElement {
  const body = rows.map((row) =>
    el(
      "tr",
      { "data-char": row.char },
      el("td", { class: "recall-char", lang: "ja" }, row.char),
      el("td", { class: "recall-meaning" }, row.meaning),
      el("td", { class: "num" }, `${row.orderCorrect} / ${row.strokeCount}`),
      el("td", { class: "num" }, `${row.directionCorrect} / ${row.strokeCount}`),
    ),
  );
  return el(
    "section",
    { class: "screen panel recall-summary" },
    el("p", { class: "panel-kicker" }, "From memory"),
    el("h1", { class: "panel-title" }, lesson.title),
    el("p", { class: "panel-text" }, "Strokes you wrote in the right order and in the right direction."),
    el(
      "table",
      { class: "recall-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Character"),
          el("th", { scope: "col" }, "Meaning"),
          el("th", { scope: "col", class: "num" }, "Order"),
          el("th", { scope: "col", class: "num" }, "Direction"),
        ),
      ),
      el("tbody", {}, ...body),
    ),
    el("div", { class: "panel-actions" }, button("Back to lessons", onHome, "primary")),
  );
}
