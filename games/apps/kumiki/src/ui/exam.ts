/** The exam: fill the right structure from memory, with no feedback until the deck is done. */

import type { AssemblyPuzzle } from "@kankyouken/mechanics/components";
import { boardOn, placeTile, removeTile, type Board } from "../board";
import type { Deck } from "../content";
import { examTotals, type Exam } from "../exam";
import type { App } from "./app";
import { createBoardView } from "./board-view";
import { backButton, button, h } from "./dom";
import { drawnChar } from "./shapes";

export interface ExamItemOptions {
  readonly puzzle: AssemblyPuzzle;
  readonly progress: string;
  readonly last: boolean;
  quit(): void;
  next(board: Board): void;
}

export function examScreen(app: App, options: ExamItemOptions): { screen: HTMLElement; leave(): void } {
  const { puzzle } = options;
  const slotCount = puzzle.solution.length;
  let board = boardOn(puzzle.correctLayout, slotCount);
  const entry = app.content.lexicon.get(puzzle.target);
  const screen = h("main", { class: "screen assembly exam" });
  const view = createBoardView(screen, {
    puzzle,
    layouts: [puzzle.correctLayout],
    board: () => board,
    memory: () => null,
    locked: () => false,
    place(layout, slot, tileId) {
      board = placeTile(board, layout, slotCount, slot, tileId);
      app.probe.board = board;
    },
    remove(tileId) {
      board = removeTile(board, tileId);
      app.probe.board = board;
    },
    touched: (tile) => app.sound.tile(tile.shows),
  });
  app.probe.board = board;
  screen.append(
    h(
      "header",
      { class: "bar" },
      backButton(options.quit),
      h("span", { class: "bar-progress" }, options.progress),
    ),
    h(
      "section",
      { class: "prompt" },
      h("h1", { class: "meaning" }, entry?.meaning ?? ""),
      h("p", { class: "reading", lang: "ja" }, entry?.reading ?? ""),
    ),
    h("div", { class: "frames-wrap" }, view.frames),
    h("p", { class: "feedback feedback-idle" }, "Fill the structure from memory. Nothing is marked until the end."),
    view.tray,
    h(
      "div",
      { class: "actions" },
      button(options.last ? "Finish" : "Next", { class: "primary", "data-action": "next" }, () => options.next(board)),
    ),
  );
  return { screen, leave: () => view.dispose() };
}

export interface ExamResultsOptions {
  readonly deck: Deck;
  readonly exam: Exam;
  home(): void;
}

export function examResultsScreen(app: App, options: ExamResultsOptions): HTMLElement {
  const totals = examTotals(options.exam);
  return h(
    "main",
    { class: "screen summary exam-results" },
    h("p", { class: "eyebrow" }, "Exam complete"),
    h("h1", {}, options.deck.title),
    h(
      "dl",
      { class: "totals" },
      h("div", { class: "total", "data-total": "exam" }, h("dt", {}, "Slots right"), h("dd", {}, `${totals.score} of ${totals.slots}`)),
    ),
    h(
      "ul",
      { class: "result-list" },
      ...options.exam.results.map((result) =>
        h(
          "li",
          { class: "result", "data-solved": result.score === result.slots ? "true" : "false" },
          drawnChar(app.content.glyphs.get(result.char), result.char, "result-char"),
          h("span", { class: "result-meaning" }, app.content.lexicon.get(result.char)?.meaning ?? ""),
          h("span", { class: "result-score" }, `${result.score === result.slots ? "✓" : "✕"} ${result.score} of ${result.slots}`),
        ),
      ),
    ),
    h("div", { class: "actions" }, button("Decks", { class: "primary", "data-action": "home" }, options.home)),
  );
}
