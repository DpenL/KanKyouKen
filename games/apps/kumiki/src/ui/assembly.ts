/** The assembly screen: prompt, structures, tray, check and hint, and the staged feedback. */

import type { ComponentTile } from "@kankyouken/mechanics/components";
import { TONE_ICON, feedbackCounts, feedbackLines, heartsText, hintCostNote, type FeedbackLine } from "../feedback";
import {
  canCheck,
  canTakeHint,
  check,
  checksItself,
  hintCharge,
  isOver,
  lookAtCharacter,
  moveTile,
  potentialScore,
  returnTile,
  type CheckData,
  type HintData,
  type Round,
} from "../round";
import type { RuleChoices } from "../rules";
import type { App } from "./app";
import { createBoardView } from "./board-view";
import { backButton, button, h } from "./dom";
import { createGlyphBoard, type GlyphBoard } from "./glyph-board";

/** How long the hint keeps the character on show when it goes away by itself. */
const HINT_MS = 2500;
/** Pause between the final check and the reveal, so the last feedback can be read. */
const OUTCOME_DELAY_MS = 900;
/** Under automatic checking, how long the last tile is seen in its slot before the board is judged. */
const AUTO_CHECK_MS = 350;

/** The choices of the rules that change how the screen looks and behaves. */
export type AssemblyLook = Pick<RuleChoices, "check" | "feedback" | "hintStays" | "board">;

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
  /** A hint was taken; `data` is the payload of its event. */
  hinted(round: Round, data: HintData): void;
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
  /** The round was lost to a hint that took the last of the hearts; the reveal follows once the hint is put away. */
  let lostToHint = false;
  /** The feedback panel is up (look.feedback "panel"); the board waits until it is closed. */
  let panelUp = false;
  /** What the latest check reported, for the panel. */
  let lastCheck: CheckData | null = null;
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
  const hintCost = h("span", { class: "hint-cost" });
  const hintButton = button("Hint", { class: "ghost hint-button", "data-action": "hint" }, () => onHint());
  hintButton.append(hintCost);
  const hasHints = round.rules.hint !== "off";
  const hint = h("div", { class: "hint-overlay", hidden: true, "aria-hidden": "true" });
  const panel = h("div", { class: "feedback-panel", hidden: true, role: "dialog", "aria-modal": "false", "aria-label": "Result" });

  const screen = h("main", {
    class: "screen assembly",
    "data-mode": round.mode,
    "data-check": look.check,
    "data-feedback": look.feedback,
    "data-board": look.board,
  });
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
    const { livesLeft, livesMax } = round.state;
    if (livesLeft === null) {
      lives.replaceChildren(h("span", { class: "lives-free" }, "Unlimited tries"));
      lives.setAttribute("aria-label", "Unlimited tries");
    } else {
      const total = livesMax ?? livesLeft;
      lives.replaceChildren(
        ...Array.from({ length: Math.ceil(total) }, (_, index) =>
          h("span", {
            class: "life",
            // Hearts are lost and won in halves under some rules.
            "data-left": livesLeft >= index + 1 ? "true" : livesLeft > index ? "half" : "false",
            "data-leaving": lostLife && index === Math.min(Math.ceil(total) - 1, Math.floor(livesLeft)) ? "true" : null,
          }),
        ),
      );
      lives.setAttribute("aria-label", `${heartsText(livesLeft)} of ${heartsText(total)} lives left`);
    }
    attempts.replaceChildren(h("span", { class: "stat-label" }, "Checks"), h("strong", {}, String(round.state.attempts)));
    score.replaceChildren(
      h("span", { class: "stat-label" }, "Score"),
      // Under the demo's scoring a wrong check earns points too; they show at once.
      h("strong", {}, String(options.banked + (round.state.solved ? 0 : round.state.score))),
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
    hintButton.disabled = !canTakeHint(round) || panelUp || hintBoard !== null;
    hintCost.textContent = hasHints ? hintCostNote(hintCharge(round), round.state.hintTokens) : "";
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
    const earned = lastCheck?.points ?? 0;
    const points = earned > 0 ? [h("p", { class: "panel-points", "data-points": earned }, `+${earned} points`)] : [];
    const lines = solved
      ? [h("p", { class: "panel-title" }, "Joined!"), h("p", { class: "panel-meaning" }, entry?.meaning ?? ""), ...points]
      : [
          h("p", { class: "panel-title" }, round.state.failed ? "Out of lives" : "Not yet"),
          ...feedbackCounts(result).map(lineElement),
          ...points,
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
    lostLife = (outcome.round.state.livesLeft ?? 0) < (round.state.livesLeft ?? 0);
    round = outcome.round;
    lastCheck = outcome.data;
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

  /** Put the hint away. `proceed` false when the screen is being left. */
  function hideHint(proceed = true): void {
    window.clearTimeout(hintTimer);
    hint.hidden = true;
    hint.replaceChildren();
    hintBoard?.dispose();
    const shown = hintBoard !== null;
    hintBoard = null;
    if (!shown || !proceed) return;
    if (lostToHint) {
      options.done(round);
      return;
    }
    boardView.refresh();
    renderStatus();
    scheduleAutoCheck();
  }

  function onHint(): void {
    if (hintBoard !== null || panelUp) return;
    const outcome = lookAtCharacter(round);
    if (outcome === null) return;
    lostLife = (outcome.round.state.livesLeft ?? 0) < (round.state.livesLeft ?? 0);
    round = outcome.round;
    lostToHint = isOver(round);
    hintBoard = createGlyphBoard(glyph, "The character");
    hintBoard.view.setAllStrokes("done");
    const stays = look.hintStays === "continue";
    const proceed = stays ? button("Continue", { class: "primary", "data-action": "hint-continue" }, () => hideHint()) : null;
    hint.replaceChildren(
      hintBoard.element,
      ...(lostToHint ? [h("p", { class: "hint-note" }, "That was the last of your lives.")] : []),
      ...(proceed === null ? [] : [proceed]),
    );
    hint.setAttribute("data-stays", look.hintStays);
    hint.setAttribute("aria-hidden", stays ? "false" : "true");
    hint.hidden = false;
    boardView.refresh();
    renderStatus();
    if (proceed === null) hintTimer = window.setTimeout(() => hideHint(), HINT_MS);
    else proceed.focus({ preventScroll: true });
    options.hinted(round, outcome.data);
    // Counted the moment it ends, like a round lost to a check.
    if (lostToHint) options.over(round);
    app.sound.cue(lostToHint ? "error" : "hint");
  }

  // "compact" (the demo's arrangement): the status in the top bar and Hint beside the prompt, so
  // that nothing but a Check bar, when the rules have one, lies below the tray.
  const compact = look.board === "compact";
  const status = h("div", { class: "status" }, lives, attempts, score);
  const prompt = h(
    "section",
    { class: "prompt" },
    h("h1", { class: "meaning" }, entry?.meaning ?? ""),
    h("p", { class: "reading", lang: "ja" }, entry?.reading ?? ""),
  );
  const below = [compact || !hasHints ? null : hintButton, look.check === "bar" ? checkButton : null].filter((control) => control !== null);
  screen.append(
    h(
      "header",
      { class: "bar" },
      backButton(options.quit),
      compact ? status : null,
      h("span", { class: "bar-progress" }, options.progress),
    ),
    compact ? h("div", { class: "prompt-row" }, prompt, hasHints ? hintButton : null) : prompt,
  );
  if (!compact) screen.append(status);
  screen.append(h("div", { class: "frames-wrap" }, boardView.frames, hint, panel), feedback, boardView.tray);
  if (below.length > 0) screen.append(h("div", { class: "actions" }, ...below));
  renderStatus();
  renderFeedback();

  return {
    screen,
    leave() {
      hideHint(false);
      window.clearTimeout(doneTimer);
      window.clearTimeout(autoTimer);
      boardView.dispose();
    },
  };
}
