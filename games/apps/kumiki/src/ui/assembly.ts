/** The assembly screen: prompt, structures, tray, check and hint, and the staged feedback. */

import type { ComponentTile } from "@kankyouken/mechanics/components";
import { TONE_ICON, feedbackCounts, feedbackLines, type FeedbackLine } from "../feedback";
import {
  canCheck,
  check,
  checksItself,
  isOver,
  moveTile,
  potentialScore,
  returnTile,
  takeHint,
  type CheckData,
  type Round,
} from "../round";
import type { RuleChoices } from "../rules";
import type { App } from "./app";
import { createBoardView } from "./board-view";
import { backButton, button, h } from "./dom";
import { createGlyphBoard, type GlyphBoard } from "./glyph-board";

/** How long the hint keeps the character on show. */
const HINT_MS = 2500;
/** Pause between the final check and the reveal, so the last feedback can be read. */
const OUTCOME_DELAY_MS = 900;
/** Under automatic checking, how long the last tile is seen in its slot before the board is judged. */
const AUTO_CHECK_MS = 350;

/** The choices of the rules that change how the screen looks and behaves. */
export type AssemblyLook = Pick<RuleChoices, "check" | "feedback">;

export interface AssemblyOptions {
  readonly round: Round;
  readonly look: AssemblyLook;
  /** e.g. "Temple · 2 / 6". */
  readonly progress: string;
  /** Points earned in the deck before this round. */
  readonly banked: number;
  quit(): void;
  /** A check was made; `data` is the payload of its event. */
  checked(data: CheckData): void;
  hinted(round: Round): void;
  /** The round has just been solved or failed; its last feedback is on screen. */
  over(round: Round): void;
  /** Some time after `over`, when the last feedback has been read. Not called if the player leaves first. */
  done(round: Round): void;
}

export function assemblyScreen(app: App, options: AssemblyOptions): { screen: HTMLElement; leave(): void } {
  let round = options.round;
  let hintTimer: number | undefined;
  let hintBoard: GlyphBoard | null = null;
  let doneTimer: number | undefined;
  let autoTimer: number | undefined;
  let lostLife = false;
  /** The feedback panel is up (look.feedback "panel"); the board waits until it is closed. */
  let panelUp = false;
  const { look } = options;
  const entry = app.content.lexicon.get(round.char);
  const glyph = app.content.glyphs.get(round.char)!;

  const lives = h("div", { class: "lives", role: "img" });
  const attempts = h("span", { class: "stat", "data-stat": "attempts" });
  const score = h("span", { class: "stat", "data-stat": "score" });
  const feedback = h("div", { class: "feedback", role: "status", "aria-live": "polite" });
  // Below the board ("bar"), or drawn by the structure in play once it is full ("frame"); none when checks happen by themselves.
  const checkButton = button("Check", { class: "primary", "data-action": "check" }, () => onCheck());
  const frameCheck = (layout: number): Node | null =>
    look.check === "frame" && round.board.layout === layout && canCheck(round) && !panelUp && hintBoard === null
      ? button("Check", { class: "primary frame-check", "data-action": "check" }, () => onCheck())
      : null;
  const hintButton = button("Hint", { class: "ghost", "data-action": "hint" }, () => onHint());
  const hint = h("div", { class: "hint-overlay", hidden: true, "aria-hidden": "true" });
  const panel = h("div", { class: "feedback-panel", hidden: true, role: "dialog", "aria-modal": "false", "aria-label": "Result" });

  const screen = h("main", { class: "screen assembly", "data-mode": round.mode, "data-check": look.check, "data-feedback": look.feedback });
  const sync = (): void => {
    app.probe.state = round.state;
    app.probe.board = round.board;
  };
  const boardView = createBoardView(screen, {
    puzzle: round.puzzle,
    layouts: round.puzzle.layouts.map((_, index) => index),
    board: () => round.board,
    memory: () => round.state.memory,
    // While the hint or the feedback panel covers the structures nothing can be placed under it.
    locked: () => isOver(round) || hintBoard !== null || panelUp,
    place(layout, slot, tileId) {
      round = moveTile(round, layout, slot, tileId);
      renderStatus();
      // The last tile is seen in its slot before the board is judged (and perhaps sent back).
      window.clearTimeout(autoTimer);
      scheduleAutoCheck();
    },
    remove(tileId) {
      round = returnTile(round, tileId);
      renderStatus();
    },
    touched: (tile: ComponentTile) => app.sound.tile(tile.shows),
    extra: frameCheck,
    dimmed: (layout) => look.check === "frame" && canCheck(round) && round.board.layout !== layout,
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
      // What solving is worth right now; it drops with every check and hint.
      h(
        "span",
        { class: "stat-note", "data-stat": "worth" },
        ...(round.state.solved
          ? [`+${round.state.score}`]
          : [h("span", { class: "stat-note-label" }, "this one: "), `+${potentialScore(round)}`]),
      ),
    );
    checkButton.disabled = !canCheck(round) || panelUp;
    hintButton.disabled = isOver(round) || panelUp;
  }

  const lineElement = (line: FeedbackLine): HTMLElement =>
    h(
      "p",
      { class: "feedback-line", "data-tone": line.tone, "data-line": line.label.toLowerCase() },
      h("span", { class: "feedback-icon", "aria-hidden": "true" }, TONE_ICON[line.tone]),
      h("strong", {}, `${line.label}: `),
      line.text,
    );

  function renderFeedback(): void {
    if (look.feedback === "panel") {
      // The panel says it all; the strip under the board keeps the instructions.
      feedback.replaceChildren(h("p", { class: "feedback-idle" }, look.check === "auto" ? "Fill every slot of a structure." : "Fill every slot of a structure, then check."));
      return;
    }
    if (round.feedback === null) {
      feedback.replaceChildren(
        h("p", { class: "feedback-idle" }, look.check === "auto" ? "Pick a structure and fill every slot." : "Pick a structure, fill every slot, then check."),
      );
      return;
    }
    feedback.replaceChildren(...feedbackLines(round.feedback).map(lineElement));
  }

  /** The panel over the structures with the result of the check just made, until Continue. */
  function showPanel(byItself: boolean): void {
    const result = round.feedback;
    if (result === null) return;
    const solved = round.state.solved;
    const lines = solved
      ? [h("p", { class: "panel-title" }, "Joined!"), h("p", { class: "panel-meaning" }, entry?.meaning ?? "")]
      : [
          h("p", { class: "panel-title" }, round.state.failed ? "Out of lives" : "Not yet"),
          ...feedbackCounts(result).map(lineElement),
        ];
    const proceed = button("Continue", { class: "primary", "data-action": "continue" }, () => closePanel());
    panel.replaceChildren(...lines, h("div", { class: "actions" }, proceed));
    panel.setAttribute("data-outcome", solved ? "solved" : round.state.failed ? "failed" : "wrong");
    panel.hidden = false;
    panelUp = true;
    boardView.refresh();
    renderStatus();
    // The rest of a double tap on Check, or on the slot that filled the board, would land on Continue.
    if (byItself) app.arming.clicked();
    app.arming.hold([proceed]);
    proceed.focus({ preventScroll: true });
  }

  function closePanel(): void {
    if (!panelUp) return;
    panelUp = false;
    panel.hidden = true;
    panel.replaceChildren();
    if (isOver(round)) {
      options.done(round);
      return;
    }
    boardView.refresh();
    renderStatus();
    screen.focus({ preventScroll: true });
  }

  function onCheck(byItself = false): void {
    if (panelUp) return;
    const outcome = check(round, Date.now());
    if (outcome === null) return;
    lostLife = outcome.round.state.livesLeft !== round.state.livesLeft;
    round = outcome.round;
    // The screen first: whatever follows (events, sound) must not keep the answer back.
    boardView.refresh();
    renderStatus();
    renderFeedback();
    if (look.feedback === "panel") showPanel(byItself);
    options.checked(outcome.data);
    if (isOver(round)) {
      options.over(round);
      // With the panel the player moves on with Continue; otherwise after a pause to read the lines.
      if (look.feedback !== "panel") doneTimer = window.setTimeout(() => options.done(round), OUTCOME_DELAY_MS);
    }
    if (!round.state.solved) app.sound.cue("error");
  }

  /** Under automatic checking, judge a full board shortly (not while the hint covers it: then once it is gone). */
  function scheduleAutoCheck(): void {
    window.clearTimeout(autoTimer);
    if (!checksItself(round)) return;
    autoTimer = window.setTimeout(() => {
      if (hintBoard === null && checksItself(round)) onCheck(true);
    }, AUTO_CHECK_MS);
  }

  function hideHint(): void {
    window.clearTimeout(hintTimer);
    hint.hidden = true;
    hint.replaceChildren();
    hintBoard?.dispose();
    const shown = hintBoard !== null;
    hintBoard = null;
    if (shown) {
      boardView.refresh();
      scheduleAutoCheck();
    }
  }

  function onHint(): void {
    if (isOver(round) || hintBoard !== null) return;
    round = takeHint(round);
    hintBoard = createGlyphBoard(glyph, "The character");
    hintBoard.view.setAllStrokes("done");
    hint.replaceChildren(hintBoard.element);
    hint.hidden = false;
    boardView.refresh();
    renderStatus();
    hintTimer = window.setTimeout(hideHint, HINT_MS);
    options.hinted(round);
    app.sound.cue("hint");
  }

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
    h("div", { class: "status" }, lives, attempts, score),
    h("div", { class: "frames-wrap" }, boardView.frames, hint, panel),
    feedback,
    boardView.tray,
    h("div", { class: "actions" }, hintButton, look.check === "bar" ? checkButton : null),
  );
  renderStatus();
  renderFeedback();

  return {
    screen,
    leave() {
      hideHint();
      window.clearTimeout(doneTimer);
      window.clearTimeout(autoTimer);
      boardView.dispose();
    },
  };
}
