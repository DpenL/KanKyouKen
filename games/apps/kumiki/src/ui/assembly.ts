/** The assembly screen: prompt, structures, tray, check and hint, and the staged feedback. */

import type { ComponentTile } from "@kankyouken/mechanics/components";
import { TONE_ICON, feedbackLines } from "../feedback";
import { canCheck, check, isOver, moveTile, potentialScore, returnTile, takeHint, type CheckData, type Round } from "../round";
import type { App } from "./app";
import { createBoardView } from "./board-view";
import { button, h } from "./dom";
import { createGlyphBoard } from "./glyph-board";

/** How long the hint keeps the character on show. */
const HINT_MS = 2500;
/** Pause between the final check and the reveal, so the last feedback can be read. */
const OUTCOME_DELAY_MS = 900;

export interface AssemblyOptions {
  readonly round: Round;
  /** e.g. "Temple · 2 / 6". */
  readonly progress: string;
  /** Points earned in the deck before this round. */
  readonly banked: number;
  quit(): void;
  /** A check was made; `data` is the payload of its event. */
  checked(round: Round, data: CheckData): void;
  hinted(round: Round): void;
  /** The round is solved or failed and its last feedback has been shown. */
  done(round: Round): void;
}

export function assemblyScreen(app: App, options: AssemblyOptions): { screen: HTMLElement; leave(): void } {
  let round = options.round;
  let hintTimer: number | undefined;
  let doneTimer: number | undefined;
  let lostLife = false;
  const entry = app.content.lexicon.get(round.char);
  const glyph = app.content.glyphs.get(round.char)!;

  const lives = h("div", { class: "lives", role: "img" });
  const attempts = h("span", { class: "stat", "data-stat": "attempts" });
  const score = h("span", { class: "stat", "data-stat": "score" });
  const feedback = h("div", { class: "feedback", role: "status", "aria-live": "polite" });
  const checkButton = button("Check", { class: "primary", "data-action": "check" }, () => onCheck());
  const hintButton = button("Hint", { class: "ghost", "data-action": "hint" }, () => onHint());
  const hint = h("div", { class: "hint-overlay", hidden: true, "aria-hidden": "true" });

  const screen = h("main", { class: "screen assembly", "data-mode": round.mode });
  const sync = (): void => {
    app.probe.state = round.state;
    app.probe.board = round.board;
  };
  const boardView = createBoardView(screen, {
    puzzle: round.puzzle,
    layouts: round.puzzle.layouts.map((_, index) => index),
    board: () => round.board,
    memory: () => round.state.memory,
    locked: () => isOver(round),
    place(layout, slot, tileId) {
      round = moveTile(round, layout, slot, tileId);
      renderStatus();
    },
    remove(tileId) {
      round = returnTile(round, tileId);
      renderStatus();
    },
    touched: (tile: ComponentTile) => app.sound.tile(tile.shows),
  });

  function renderStatus(): void {
    sync();
    const { livesLeft } = round.state;
    if (livesLeft === null) {
      lives.replaceChildren(h("span", { class: "lives-free" }, "Unlimited tries"));
      lives.setAttribute("aria-label", "Unlimited tries");
    } else {
      const total = round.rules.lives ?? livesLeft;
      lives.replaceChildren(
        ...Array.from({ length: total }, (_, index) =>
          h("span", {
            class: "life",
            "data-left": index < livesLeft ? "true" : "false",
            "data-leaving": lostLife && index === livesLeft ? "true" : null,
          }),
        ),
      );
      lives.setAttribute("aria-label", `${livesLeft} of ${total} lives left`);
    }
    attempts.replaceChildren(h("span", { class: "stat-label" }, "Checks"), h("strong", {}, String(round.state.attempts)));
    score.replaceChildren(
      h("span", { class: "stat-label" }, "Score"),
      h("strong", {}, String(options.banked)),
      h("span", { class: "stat-note" }, round.state.solved ? `+${round.state.score}` : `this one: ${potentialScore(round)}`),
    );
    checkButton.disabled = !canCheck(round);
    hintButton.disabled = isOver(round);
  }

  function renderFeedback(): void {
    if (round.feedback === null) {
      feedback.replaceChildren(h("p", { class: "feedback-idle" }, "Pick a structure, fill every slot, then check."));
      return;
    }
    feedback.replaceChildren(
      ...feedbackLines(round.feedback).map((line) =>
        h(
          "p",
          { class: "feedback-line", "data-tone": line.tone, "data-line": line.label.toLowerCase() },
          h("span", { class: "feedback-icon", "aria-hidden": "true" }, TONE_ICON[line.tone]),
          h("strong", {}, `${line.label}: `),
          line.text,
        ),
      ),
    );
  }

  function onCheck(): void {
    const outcome = check(round, Date.now());
    if (outcome === null) return;
    lostLife = outcome.round.state.livesLeft !== round.state.livesLeft;
    round = outcome.round;
    options.checked(round, outcome.data);
    if (!round.state.solved) app.sound.cue("error");
    boardView.refresh();
    renderStatus();
    renderFeedback();
    if (isOver(round)) doneTimer = window.setTimeout(() => options.done(round), OUTCOME_DELAY_MS);
  }

  function onHint(): void {
    if (isOver(round) || !hint.hidden) return;
    round = takeHint(round);
    options.hinted(round);
    app.sound.cue("hint");
    const board = createGlyphBoard(glyph, "The character");
    board.view.setAllStrokes("done");
    hint.replaceChildren(board.element);
    hint.hidden = false;
    renderStatus();
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
      hint.replaceChildren();
      board.dispose();
    }, HINT_MS);
  }

  screen.append(
    h(
      "header",
      { class: "bar" },
      button("← Decks", { class: "ghost small", "data-action": "quit" }, options.quit),
      h("span", { class: "bar-progress" }, options.progress),
    ),
    h(
      "section",
      { class: "prompt" },
      h("h1", { class: "meaning" }, entry?.meaning ?? ""),
      h("p", { class: "reading", lang: "ja" }, entry?.reading ?? ""),
    ),
    h("div", { class: "status" }, lives, attempts, score),
    h("div", { class: "frames-wrap" }, boardView.frames, hint),
    feedback,
    boardView.tray,
    h("div", { class: "actions" }, hintButton, checkButton),
  );
  renderStatus();
  renderFeedback();

  return {
    screen,
    leave() {
      window.clearTimeout(hintTimer);
      window.clearTimeout(doneTimer);
      boardView.dispose();
    },
  };
}
