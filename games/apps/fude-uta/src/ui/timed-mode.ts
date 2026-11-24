import type { Lesson } from "@kankyouken/glyph-data";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { GlyphMelody } from "@kankyouken/mechanics/melody";
import type { TimedRoundConfig, TimedRoundState } from "@kankyouken/mechanics/scaffold";
import { DEFAULT_TIMED_SCORING, completeTimedItem, currentTimedItem, startTimedRound } from "@kankyouken/mechanics/scaffold";
import type { AttemptResult } from "@kankyouken/mechanics/stroke";
import { gameEvent, strokeAttemptEvent } from "@kankyouken/mechanics/telemetry";
import type { ItemClock } from "../attempts";
import { recordAttempt, startItemClock } from "../attempts";
import { glossOf, glyphOf } from "../content";
import type { Env, Mode } from "../env";
import { IDLE_PROBE } from "../env";
import { countMistakes, formatDuration, starsFor } from "../progress";
import { button, createTimers, el } from "./dom";
import { createTracer } from "./tracer";
import type { WritingUi } from "./writing-ui";

const TASK = "timed";
const BETWEEN_ITEMS_MS = 450;
const TICK_MS = 100;

function statusItem(label: string, value: HTMLElement): HTMLElement {
  return el("div", { class: "status-item" }, el("span", { class: "status-label" }, label), value);
}

/** The timed round: every character of the lesson twice, shuffled, traced over its outline for points. */
export function startTimedMode(env: Env, ui: WritingUi, lesson: Lesson, onDone: (round: TimedRoundState) => void): Mode {
  const config: TimedRoundConfig = { items: lesson.chars, repeats: 2, shuffle: true, scoring: DEFAULT_TIMED_SCORING };
  const timers = createTimers();
  const { board } = ui;
  const time = el("span", { class: "status-value" });
  const score = el("span", { class: "status-value" });
  let round = startTimedRound(config, env.rng);
  let current: { readonly char: string; readonly glyph: Glyph; readonly melody: GlyphMelody } | null = null;
  let clock: ItemClock = startItemClock(Date.now());
  let expected = 0;
  let ticker: number | null = null;

  const showStatus = (): void => {
    const running = current === null ? 0 : Date.now() - clock.startedAt;
    time.textContent = formatDuration(round.elapsedMs + running);
    score.textContent = String(round.score);
  };

  const probe = (): void => {
    Object.assign(env.probe, {
      screen: "timed",
      stage: current === null ? null : TASK,
      char: current?.char ?? null,
      rep: null,
      expected: current === null ? null : expected,
      medians: current?.glyph.strokes.map((stroke) => stroke.median) ?? null,
      glyphSize: current?.glyph.size ?? null,
    });
  };

  const finishRound = (): void => {
    if (ticker !== null) window.clearInterval(ticker);
    const mistakes = countMistakes(round.results);
    env.emit(
      gameEvent("timed_round_result", { ts: Date.now(), task: TASK }, {
        correct: mistakes === 0,
        response_time_ms: round.elapsedMs,
        lesson: lesson.id,
        score: round.score,
        elapsed_ms: round.elapsedMs,
        mistakes,
        stars: starsFor(round.results),
        results: round.results.map((result) => ({
          item: result.item,
          stroke_count: result.strokeCount,
          mistakes: result.mistakes,
          duration_ms: result.durationMs,
          points: result.points,
        })),
      }),
    );
    onDone(round);
  };

  const tracer = createTracer(env, ui, (result, drawMs) => onJudged(result, drawMs));

  const nextItem = (): void => {
    const char = currentTimedItem(round);
    if (char === null) {
      finishRound();
      return;
    }
    const glyph = glyphOf(env.content, char);
    current = { char, glyph, melody: env.melodist().melody(glyph) };
    expected = 0;
    clock = startItemClock(Date.now());
    ui.setGloss(glossOf(env.content, char));
    ui.setChips(current.melody);
    ui.setStage(`Character ${round.index + 1} of ${round.queue.length}`);
    ui.setMessage("");
    env.emit(gameEvent("item_start", { ts: clock.startedAt, item: char, task: TASK }, { position: round.index, stroke_count: glyph.strokes.length }));
    tracer.begin({ glyph, melody: current.melody, guide: "outline" }, 0, 0);
    board.enabled = true;
    probe();
  };

  const onJudged = (result: AttemptResult, drawMs: number): void => {
    if (current === null) return;
    const { char, glyph, melody } = current;
    const now = Date.now();
    const recorded = recordAttempt(clock, {
      now,
      drawMs,
      result,
      hintLevel: 0,
      component: melody.strokes[expected]?.component ?? null,
      guide: "outline",
      audioMode: env.audioMode(),
    });
    clock = recorded.clock;
    env.emit(strokeAttemptEvent({ ts: now, item: char, task: TASK }, recorded.data));
    if (result.verdict !== "correct") {
      tracer.reject(result.verdict);
      tracer.expect(expected, 0);
      return;
    }
    tracer.accept(expected);
    expected += 1;
    if (expected < glyph.strokes.length) {
      tracer.expect(expected, 0);
      probe();
      return;
    }
    const durationMs = now - clock.startedAt;
    round = completeTimedItem(round, config, { strokeCount: glyph.strokes.length, mistakes: clock.mistakes, durationMs });
    env.emit(
      gameEvent("item_complete", { ts: now, item: char, task: TASK }, {
        mistakes: clock.mistakes,
        duration_ms: durationMs,
        points: round.results.at(-1)?.points ?? 0,
      }),
    );
    board.enabled = false;
    tracer.end();
    current = null;
    ui.highlightUnit(null);
    showStatus();
    probe();
    timers.after(BETWEEN_ITEMS_MS, nextItem);
  };

  ui.setHeading(lesson.title, "Timed round");
  ui.setStatus(statusItem("Time", time), statusItem("Score", score));
  ui.setGloss({ meaning: "", reading: "" });
  ui.setChips(null);
  ui.setStage("");
  ui.setMessage("");
  ui.setActions();
  board.enabled = false;
  board.view.setGlyph(null);
  showStatus();
  Object.assign(env.probe, { screen: "timed", ...IDLE_PROBE });
  ui.setOverlay(
    el(
      "div",
      { class: "overlay-card" },
      el("h2", { class: "overlay-title" }, "Timed round"),
      el(
        "p",
        { class: "overlay-text" },
        "Each character comes up twice. Trace it over its outline as quickly and as cleanly as you can.",
      ),
      button(
        "Start",
        () => {
          ui.setOverlay(null);
          ticker = window.setInterval(showStatus, TICK_MS);
          nextItem();
        },
        "primary",
      ),
    ),
  );

  return {
    stop() {
      timers.clear();
      if (ticker !== null) window.clearInterval(ticker);
      tracer.end();
      board.enabled = false;
    },
  };
}
