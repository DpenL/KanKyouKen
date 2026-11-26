/** End of a deck: the totals and the best score. */

import type { Deck } from "../content";
import type { Session } from "../session";
import { summarize } from "../session";
import type { App } from "./app";
import { button, h } from "./dom";
import { drawnChar } from "./shapes";

export interface SummaryOptions {
  readonly deck: Deck;
  readonly session: Session;
  /** Under the scoring that keeps a best score: the best before this run (null for a first run). Null when none is kept. */
  readonly best: { readonly previous: number | null } | null;
  /** Show how many characters count as mastered (hints that cost that). */
  readonly countsMastered: boolean;
  again(): void;
  home(): void;
}

function total(label: string, value: string, id: string): HTMLElement {
  return h("div", { class: "total", "data-total": id }, h("dt", {}, label), h("dd", {}, value));
}

export function summaryScreen(app: App, options: SummaryOptions): HTMLElement {
  const { session } = options;
  const summary = summarize(session);
  const previousBest = options.best?.previous ?? null;
  const best =
    options.best === null
      ? null
      : summary.outOfLives
        ? previousBest === null
          ? "A run that ends early sets no best score."
          : `Best so far: ${previousBest}.`
        : previousBest === null
          ? "First run of this deck."
          : summary.score > previousBest
            ? `New best. Before: ${previousBest}.`
            : `Best so far: ${previousBest}.`;
  const played = session.mode === "learn" ? "Learn" : "Review";
  const rows = [...new Map(session.results.map((result) => [result.char, result])).values()];
  return h(
    "main",
    { class: "screen summary", "data-ended": summary.outOfLives ? "out-of-lives" : "complete" },
    h("p", { class: "eyebrow" }, summary.outOfLives ? `Out of lives · ${played}` : `Deck complete · ${played}`),
    h("h1", {}, options.deck.title),
    h(
      "dl",
      { class: "totals" },
      total("Score", String(summary.score), "score"),
      summary.outOfLives ? total("Solved", `${summary.solved} of ${session.queue.length}`, "solved") : null,
      total("Solved first try", `${summary.firstTry} of ${summary.chars}`, "first-try"),
      options.countsMastered ? total("Mastered", `${summary.mastered} of ${summary.chars}`, "mastered") : null,
      total("Hints used", String(summary.hints), "hints"),
    ),
    best === null ? null : h("p", { class: "best-line" }, best),
    h(
      "ul",
      { class: "result-list" },
      ...rows.map((result) =>
        h(
          "li",
          { class: "result", "data-solved": result.solved ? "true" : "false" },
          drawnChar(app.content.glyphs.get(result.char), result.char, "result-char"),
          h("span", { class: "result-meaning" }, app.content.lexicon.get(result.char)?.meaning ?? ""),
          h("span", { class: "result-score" }, `${result.solved ? "✓" : "✕"} ${result.score}`),
        ),
      ),
    ),
    h(
      "div",
      { class: "actions" },
      button("Decks", { class: "ghost", "data-action": "home" }, options.home),
      button(summary.outOfLives ? "Try again" : "Play again", { class: "primary", "data-action": "again" }, options.again),
    ),
  );
}
