/** Which screen follows which: home, a run through a deck, the exam. */

import { drawDeck, type Deck } from "../content";
import { examChar, examTotals, startExam, submitExamItem } from "../exam";
import { buildPuzzle, startRound, type Mode, type Round } from "../round";
import { assemblyRules, formatRuleSpec, puzzleOptions, runRules } from "../rules";
import { bestScore, withScore } from "../saved";
import { canReturn, currentChar, finishRound, roundEnd, startSession, summarize, summaryData, type SessionSummary } from "../session";
import { choiceAttemptEvent, gameEvent } from "@kankyouken/mechanics/telemetry";
import { nextRoundStart, roundOutcome, type AssemblyPuzzle } from "@kankyouken/mechanics/components";
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
  const isRunEntry = (state: unknown): boolean =>
    typeof state === "object" && state !== null && (state as { kumiki?: unknown }).kumiki === "run";
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
  window.addEventListener("popstate", (event) => {
    if (ownSteps > 0) {
      ownSteps--;
      return;
    }
    if (!inRun) {
      // Forward onto the entry of a run that was left: there is no run to go back to, and
      // standing on its entry would leave the next Back with nothing to do. Step off it.
      if (isRunEntry(event.state)) {
        ownSteps++;
        history.back();
      }
      return;
    }
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
        settings: (changed) => openSettings(app, changed),
        about: () => openAbout(app),
      }),
    );
  };

  const playDeck = (deck: Deck, mode: Mode): void => {
    const rng = app.rng.fork(`run:${++runs}`);
    const task = `assembly:${mode}`;
    // A run keeps the rules it started with; a change in Settings applies from the next one.
    const choices = app.rules.choices();
    /** A best score is compared with runs under the same rules only. */
    const rulesKey = formatRuleSpec(app.rules.spec());
    const rules = assemblyRules(choices, mode);
    const run = runRules(choices);
    const options = puzzleOptions(choices, app.content.frames);
    let session = startSession(deck.id, mode, drawDeck(deck, rng.fork("order")));
    const at = (item: string): { ts: number; item: string; task: string } => ({ ts: Date.now(), item, task });
    const progress = (): string => `${deck.title} · ${session.index + 1} / ${session.queue.length}`;
    enterRun(() => {
      const char = currentChar(session);
      if (char === null) {
        // Nothing is left to play: the last character is settled, or the lives ran out.
        // The run is over, and only its summary was not looked at.
        complete();
        return;
      }
      app.record(gameEvent("deck_abandoned", at(char), { deck: deck.id, position: session.index, ...summaryData(summarize(session)) }));
    });

    const next = (): void => {
      const char = currentChar(session);
      if (char === null) {
        finish();
        return;
      }
      const puzzle = buildPuzzle(char, app.content, rng.fork(`puzzle:${session.index}`), options);
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
      // Hearts and hint tokens come from the round before, as the rules of the run say.
      const round = startRound(char, mode, puzzle, Date.now(), rules, session.carry);
      const view = assemblyScreen(app, {
        round,
        look: { check: choices.check, feedback: choices.feedback, hintStays: choices.hintStays, board: choices.board },
        progress: progress(),
        banked: summarize(session).score,
        quit: home,
        checked: (data) => app.record(choiceAttemptEvent(at(char), data)),
        hinted: (_current, data) => app.record(gameEvent("hint_shown", at(char), { ...data })),
        over: settle,
        done: reveal,
      });
      app.show("assembly", view.screen, view.leave);
    };

    /** What the reveal of the round just settled needs to know about the deck as it was. */
    let settled: { readonly label: string; readonly returns: boolean; readonly endsRun: boolean; readonly mastered: boolean } | null = null;

    /** Count the round the moment it ends, so that leaving during the pause before the reveal loses nothing. */
    const settle = (round: Round): void => {
      const { solved, attempts, hintsUsed: hints, score, livesLeft, livesMax, hintTokens } = round.state;
      const outcome = roundOutcome(round.state, rules, run);
      // A character comes back once only.
      const returns = outcome.returns && !outcome.endsRun && canReturn(session, round.char);
      app.record(
        gameEvent("item_complete", at(round.char), {
          solved,
          attempts,
          hints,
          score,
          mastered: outcome.mastered,
          returns,
          ends_run: outcome.endsRun,
          hint_policy: rules.hint,
          lives_left: livesLeft,
          lives_max: livesMax,
          lives_rule: rules.lives === null ? "none" : rules.livesRule,
          tokens_left: hintTokens,
        }),
      );
      settled = { label: progress(), returns, endsRun: outcome.endsRun, mastered: outcome.mastered };
      session = finishRound(
        session,
        { char: round.char, solved, attempts, hints, score, mastered: outcome.mastered },
        roundEnd(outcome, nextRoundStart(round.state, rules, run)),
      );
    };

    const reveal = (round: Round): void => {
      const view = revealScreen(app, {
        round,
        progress: settled?.label ?? progress(),
        returns: settled?.returns ?? false,
        endsRun: settled?.endsRun ?? false,
        mastered: settled?.mastered ?? round.state.solved,
        next,
      });
      app.show("reveal", view.screen, view.leave);
    };

    /** Count the finished run: its best score and its event. Returns what the summary shows. */
    const complete = (): { summary: SessionSummary; keepsBest: boolean; previousBest: number | null } => {
      const summary = summarize(session);
      const saved = app.store.get();
      // Best scores belong to the classic scoring; the demo's has a running total and nothing to beat.
      const keepsBest = choices.scoring === "classic";
      const previousBest = bestScore(saved, deck.id, mode, rulesKey);
      if (keepsBest && !summary.outOfLives) app.store.patch({ best: withScore(saved, deck.id, mode, summary.score, rulesKey) });
      app.record(gameEvent("deck_complete", { ts: Date.now(), task }, { deck: deck.id, ...summaryData(summary) }));
      return { summary, keepsBest, previousBest };
    };

    const finish = (): void => {
      endRun();
      clearProbe();
      const { summary, keepsBest, previousBest } = complete();
      app.sound.cue(summary.outOfLives ? "error" : "complete");
      app.show(
        "summary",
        summaryScreen(app, {
          deck,
          session,
          best: keepsBest ? { previous: previousBest } : null,
          countsMastered: rules.hint === "unmastered",
          again: () => playDeck(deck, mode),
          home,
        }),
      );
    };

    next();
  };

  const runExam = (deck: Deck): void => {
    const rng = app.rng.fork(`run:${++runs}`);
    const task = "exam";
    const options = puzzleOptions(app.rules.choices(), app.content.frames);
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
      const puzzle = buildPuzzle(char, app.content, rng.fork(`puzzle:${exam.index}`), options);
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
