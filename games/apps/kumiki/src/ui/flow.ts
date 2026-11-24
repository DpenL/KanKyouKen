/** Which screen follows which: home, a run through a deck, the exam. */

import { drawDeck, type Deck } from "../content";
import { examChar, examTotals, startExam, submitExamItem } from "../exam";
import { buildPuzzle, startRound, type Mode, type Round } from "../round";
import { bestScore, withScore } from "../saved";
import { currentChar, finishRound, startSession, summarize } from "../session";
import { choiceAttemptEvent, gameEvent } from "@kankyouken/mechanics/telemetry";
import type { AssemblyPuzzle } from "@kankyouken/mechanics/components";
import type { App } from "./app";
import { assemblyScreen } from "./assembly";
import { openAbout, openExamChooser, openSettings } from "./dialogs";
import { examResultsScreen, examScreen } from "./exam";
import { homeScreen } from "./home";
import { previewScreen } from "./preview";
import { revealScreen } from "./reveal";
import { summaryScreen } from "./summary";

export function startFlow(app: App): void {
  /** Runs started so far; each gets random numbers of its own, so replays of a seed match. */
  let runs = 0;

  const clearProbe = (): void => {
    app.probe.puzzle = null;
    app.probe.state = null;
    app.probe.board = null;
  };

  /**
   * A run (a deck or an exam) adds one entry to the browser history, so that the
   * browser's Back, or the back gesture on a phone, returns to the deck list instead of
   * leaving the game. `abandon` records that the run was left unfinished.
   */
  let inRun = false;
  let abandon: (() => void) | null = null;
  /** Steps back in history that the game asked for itself and must not act on. */
  let ownSteps = 0;
  const enterRun = (onAbandon: () => void): void => {
    abandon = onAbandon;
    if (inRun) return;
    inRun = true;
    try {
      history.pushState({ kumiki: "run" }, "");
    } catch {
      // No history to add to (some embedded pages): Back then leaves the game as before.
    }
  };
  /** The run is complete: nothing is left to abandon, though its last screen is still up. */
  const endRun = (): void => {
    abandon = null;
  };
  window.addEventListener("popstate", () => {
    if (ownSteps > 0) {
      ownSteps--;
      return;
    }
    if (!inRun) return;
    inRun = false;
    abandon?.();
    abandon = null;
    showHome();
  });

  /** Back to the deck list from inside the game (the Decks button, the end of a run). */
  const home = (): void => {
    abandon?.();
    abandon = null;
    if (inRun) {
      inRun = false;
      ownSteps++;
      history.back();
    }
    showHome();
  };

  const showHome = (): void => {
    app.sound.hush();
    clearProbe();
    app.show(
      "home",
      homeScreen(app, {
        play: playDeck,
        exam: () => openExamChooser(app, runExam),
        settings: () => openSettings(app),
        about: openAbout,
      }),
    );
  };

  const playDeck = (deck: Deck, mode: Mode): void => {
    const rng = app.rng.fork(`run:${++runs}`);
    const task = `assembly:${mode}`;
    let session = startSession(deck.id, mode, drawDeck(deck, rng.fork("order")));
    const at = (item: string): { ts: number; item: string; task: string } => ({ ts: Date.now(), item, task });
    const progress = (): string => `${deck.title} · ${session.index + 1} / ${session.queue.length}`;
    enterRun(() => {
      const char = currentChar(session);
      app.record(
        gameEvent("deck_abandoned", char === null ? { ts: Date.now(), task } : at(char), {
          deck: deck.id,
          position: session.index,
          ...summarize(session),
        }),
      );
    });

    const next = (): void => {
      const char = currentChar(session);
      if (char === null) {
        finish();
        return;
      }
      const puzzle = buildPuzzle(char, app.content, rng.fork(`puzzle:${session.index}`));
      app.probe.puzzle = puzzle;
      app.probe.state = null;
      app.probe.board = null;
      app.record(gameEvent("item_start", at(char), { deck: deck.id, position: session.index }));
      if (mode === "learn") {
        const preview = previewScreen(app, { char, progress: progress(), quit: home, next: () => assemble(char, puzzle) });
        app.show("preview", preview.screen, preview.leave);
      } else {
        assemble(char, puzzle);
      }
    };

    const assemble = (char: string, puzzle: AssemblyPuzzle): void => {
      const round = startRound(char, mode, puzzle, Date.now());
      const view = assemblyScreen(app, {
        round,
        progress: progress(),
        banked: summarize(session).score,
        quit: home,
        checked: (data) => app.record(choiceAttemptEvent(at(char), data)),
        hinted: (current) => app.record(gameEvent("hint_shown", at(char), { hint: "character", hints_used: current.state.hintsUsed })),
        over: settle,
        done: reveal,
      });
      app.show("assembly", view.screen, view.leave);
    };

    /** What the reveal of the round just settled needs to know about the deck as it was. */
    let settled: { readonly label: string; readonly returns: boolean } | null = null;

    /** Count the round the moment it ends, so that leaving during the pause before the reveal loses nothing. */
    const settle = (round: Round): void => {
      const { solved, attempts, hintsUsed: hints, score } = round.state;
      app.record(gameEvent("item_complete", at(round.char), { solved, attempts, hints, score }));
      settled = { label: progress(), returns: !solved && !session.retried.includes(round.char) };
      session = finishRound(session, { char: round.char, solved, attempts, hints, score });
    };

    const reveal = (round: Round): void => {
      const view = revealScreen(app, { round, progress: settled?.label ?? progress(), returns: settled?.returns ?? false, next });
      app.show("reveal", view.screen, view.leave);
    };

    const finish = (): void => {
      endRun();
      clearProbe();
      const summary = summarize(session);
      const saved = app.store.get();
      const previousBest = bestScore(saved, deck.id, mode);
      app.store.patch({ best: withScore(saved, deck.id, mode, summary.score) });
      app.record(gameEvent("deck_complete", { ts: Date.now(), task }, { deck: deck.id, ...summary }));
      app.sound.cue("complete");
      app.show("summary", summaryScreen(app, { deck, session, previousBest, again: () => playDeck(deck, mode), home }));
    };

    next();
  };

  const runExam = (deck: Deck): void => {
    const rng = app.rng.fork(`run:${++runs}`);
    const task = "exam";
    const at = (item: string): { ts: number; item: string; task: string } => ({ ts: Date.now(), item, task });
    let exam = startExam(deck.id, drawDeck(deck, rng.fork("order")));
    const totals = (): { score: number; slots: number; items: number; answered: number } => ({
      ...examTotals(exam),
      items: exam.chars.length,
      answered: exam.results.length,
    });
    enterRun(() => {
      const char = examChar(exam);
      app.record(
        gameEvent("deck_abandoned", char === null ? { ts: Date.now(), task } : at(char), {
          deck: deck.id,
          position: exam.index,
          ...totals(),
        }),
      );
    });

    const next = (): void => {
      const char = examChar(exam);
      if (char === null) {
        endRun();
        clearProbe();
        app.record(gameEvent("exam_complete", { ts: Date.now(), task }, { deck: deck.id, ...totals() }));
        app.show("exam-results", examResultsScreen(app, { deck, exam, home }));
        return;
      }
      const puzzle = buildPuzzle(char, app.content, rng.fork(`puzzle:${exam.index}`));
      const startedAt = Date.now();
      app.probe.puzzle = puzzle;
      app.probe.state = null;
      app.record(gameEvent("item_start", at(char), { deck: deck.id, position: exam.index }));
      const view = examScreen(app, {
        puzzle,
        progress: `Exam · ${deck.title} · ${exam.index + 1} / ${exam.chars.length}`,
        last: exam.index === exam.chars.length - 1,
        quit: home,
        next(board) {
          const outcome = submitExamItem(exam, puzzle, board, Date.now() - startedAt);
          exam = outcome.exam;
          app.record(choiceAttemptEvent(at(char), outcome.data));
          app.record(
            gameEvent("item_complete", at(char), {
              solved: outcome.data.correct,
              attempts: 1,
              hints: 0,
              score: outcome.data.slots_correct,
            }),
          );
          next();
        },
      });
      app.show("exam", view.screen, view.leave);
    };

    next();
  };

  showHome();
}
