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
  /** Best score before this run, or null for a first run. */
  readonly previousBest: number | null;
  again(): void;
  home(): void;
}

function total(label: string, value: string, id: string): HTMLElement {
  return h("div", { class: "total", "data-total": id }, h("dt", {}, label), h("dd", {}, value));
}

export function summaryScreen(app: App, options: SummaryOptions): HTMLElement {
  const { session, previousBest } = options;
  const summary = summarize(session);
  const best =
    previousBest === null
      ? "First run of this deck."
      : summary.score > previousBest
        ? `New best. Before: ${previousBest}.`
        : `Best so far: ${previousBest}.`;
  const rows = [...new Map(session.results.map((result) => [result.char, result])).values()];
  return h(
    "main",
    { class: "screen summary" },
    h("p", { class: "eyebrow" }, `Deck complete · ${session.mode === "learn" ? "Learn" : "Review"}`),
    h("h1", {}, options.deck.title),
    h(
      "dl",
      { class: "totals" },
      total("Score", String(summary.score), "score"),
      total("Solved first try", `${summary.firstTry} of ${summary.chars}`, "first-try"),
      total("Hints used", String(summary.hints), "hints"),
    ),
    h("p", { class: "best-line" }, best),
    h(
      "ul",
      { class: "result-list" },
      ...rows.map((result) =>
        h(
          "li",
          { class: "result", "data-solved": result.solved ? "true" : "false" },
          drawnChar(app.content.glyphs.get(result.char), result.char, "result-char"),
          h("span", { class: "result-meaning" }, app.content.lexicon.get(result.char)?.meaning ?? ""),
          h("span", { class: "result-score" }, result.solved ? `✓ ${result.score}` : "✕ 0"),
        ),
      ),
    ),
    h(
      "div",
      { class: "actions" },
      button("Decks", { class: "ghost", "data-action": "home" }, options.home),
      button("Play again", { class: "primary", "data-action": "again" }, options.again),
    ),
  );
}
