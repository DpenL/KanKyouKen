import type { Lesson } from "@kankyouken/glyph-data";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { GlyphMelody } from "@kankyouken/mechanics/melody";
import type { HintLevel, LearnEffect, LearnState, TraceStage } from "@kankyouken/mechanics/scaffold";
import { applyAttempt, currentStage, finishDemo, requestHint, startLearning } from "@kankyouken/mechanics/scaffold";
import type { AttemptResult } from "@kankyouken/mechanics/stroke";
import { gameEvent, strokeAttemptEvent } from "@kankyouken/mechanics/telemetry";
import type { ItemClock } from "../attempts";
import { recordAttempt, startItemClock } from "../attempts";
import { glossOf, glyphOf } from "../content";
import type { Env, Mode } from "../env";
import { planPips, stageLabel, stageTask } from "../progress";
import { PLANS } from "../settings";
import { button, createTimers, prefersReducedMotion } from "./dom";
import { createTracer } from "./tracer";
import type { WritingUi } from "./writing-ui";

/** The demonstration is played a little slower than a melody is listened to. */
const DEMO_TEMPO = 96;
const AFTER_DEMO_MS = 700;
/** How long a finished repetition stays on the board before the next one starts. */
const AFTER_REP_MS = 650;

interface Item {
  readonly char: string;
  readonly glyph: Glyph;
  readonly melody: GlyphMelody;
}

/** Teach the lesson's characters one by one with the chosen learning plan, then call `onDone`. */
export function startLearnMode(env: Env, ui: WritingUi, lesson: Lesson, onDone: () => void): Mode {
  const plan = PLANS[env.settings().plan];
  const timers = createTimers();
  const { board } = ui;
  let index = 0;
  let item: Item;
  let state: LearnState;
  let clock: ItemClock;
  let task = "";

  const where = (): { ts: number; item: string; task: string } => ({ ts: Date.now(), item: item.char, task });

  const probe = (stage: string): void => {
    Object.assign(env.probe, {
      screen: "learn",
      stage,
      char: item.char,
      rep: state.rep,
      expected: state.expected,
      medians: item.glyph.strokes.map((stroke) => stroke.median),
    });
  };

  const showStage = (): void => {
    const stage = currentStage(state, plan);
    if (stage === null) return;
    const reps = stage.kind === "trace" && stage.reps > 1 ? ` · ${state.rep + 1} of ${stage.reps}` : "";
    ui.setStage(stageLabel(stage) + reps, planPips(plan, state));
    probe(task);
  };

  const unitOf = (stroke: number): number | null => item.melody.strokes[stroke]?.unit ?? null;

  /** Play the melody, or one unit of it, while its strokes pulse; afterwards the chip of the awaited stroke is lit again. */
  const sing = (unit?: number): void => {
    const strokes = unit === undefined ? undefined : item.melody.units[unit]?.strokes;
    env.performer.perform(item.melody, {
      mode: env.audioMode(),
      ...(strokes === undefined ? {} : { strokes }),
      onStroke(cue) {
        ui.highlightUnit(unitOf(cue.stroke));
        board.pulse(cue.stroke, cue.durationMs);
      },
      onEnd: () => ui.highlightUnit(state.done ? null : unitOf(state.expected)),
    });
  };

  const listen = (): void => {
    env.emit(gameEvent("melody_listen", where(), { audio_mode: env.audioMode(), part: "all" }));
    sing();
  };

  const listenToUnit = (unit: number): void => {
    const component = item.melody.units[unit]?.component ?? null;
    env.emit(gameEvent("melody_listen", where(), { audio_mode: env.audioMode(), part: "unit", unit, component }));
    sing(unit);
  };

  /** Chips play their component's motif, except where that would interrupt (the demo) or be silent. */
  const chipsPlay = (on: boolean): void => ui.setChipAction(on && env.audioMode() !== "silent" ? listenToUnit : null);

  const showHint = (effect: Extract<LearnEffect, { type: "hint" }>, auto: boolean): void => {
    env.sound.cue("hint");
    env.emit(
      gameEvent("hint_shown", where(), {
        level: effect.level,
        stroke_index: effect.stroke,
        component: item.melody.strokes[effect.stroke]?.component ?? null,
        auto,
      }),
    );
  };

  const tracer = createTracer(env, ui, (result, drawMs) => onJudged(result, drawMs));

  const traceActions = (hint: HintLevel): void => {
    const hintButton = button("Hint", () => {
      const step = requestHint(state, plan);
      state = step.state;
      for (const effect of step.effects) if (effect.type === "hint") showHint(effect, false);
      tracer.expect(state.expected, state.hint);
      traceActions(state.hint);
    });
    hintButton.disabled = hint >= 2;
    const buttons = env.audioMode() === "silent" ? [hintButton] : [button("Listen", listen), hintButton];
    ui.setActions(...buttons);
  };

  const beginRep = (stage: TraceStage): void => {
    tracer.begin({ glyph: item.glyph, melody: item.melody, guide: stage.guide }, state.expected, state.hint);
    board.enabled = true;
    chipsPlay(true);
    traceActions(state.hint);
    showStage();
  };

  const runDemo = (withAudio: boolean): void => {
    const startedAt = Date.now();
    board.enabled = false;
    tracer.end();
    board.view.setGlyph(item.glyph);
    board.view.showGhost(true);
    board.setTone(null);
    chipsPlay(false);
    showStage();

    let showing = true;
    const finish = (skipped: boolean): void => {
      showing = false;
      timers.clear();
      env.performer.stop();
      board.view.cancelAnimations();
      env.emit(gameEvent("demo_watched", where(), { skipped, duration_ms: Date.now() - startedAt, audio_mode: env.audioMode() }));
      const step = finishDemo(state, plan);
      state = step.state;
      enter(step.effects);
    };

    ui.setActions(button("Skip", () => finish(true), "quiet"));
    env.performer.perform(item.melody, {
      mode: withAudio ? env.audioMode() : "silent",
      tempo: DEMO_TEMPO,
      onStroke(cue) {
        ui.highlightUnit(unitOf(cue.stroke));
        const drawn = prefersReducedMotion() ? Promise.resolve() : board.view.animateStroke(cue.stroke, cue.durationMs);
        // A cancelled animation resolves too; by then the board may already show the next stage.
        void drawn.then(() => {
          if (showing) board.view.setStrokeState(cue.stroke, "done");
        });
      },
      onEnd: () => timers.after(AFTER_DEMO_MS, () => finish(false)),
    });
  };

  const celebrate = (): void => {
    const durationMs = Date.now() - clock.startedAt;
    task = "learn";
    env.emit(gameEvent("item_complete", where(), { mistakes: state.totalMistakes, duration_ms: durationMs }));
    board.enabled = false;
    tracer.end();
    board.view.showGhost(false);
    board.view.setAllStrokes("done");
    board.tint(item.melody);
    board.setTone(null);
    ui.setSeal(true);
    ui.setGloss(glossOf(env.content, item.char), "large");
    ui.setStage("Well written", planPips(plan, state));
    ui.setMessage("");
    probe("complete");
    chipsPlay(true);
    sing();
    const last = index === lesson.chars.length - 1;
    ui.setActions(
      button(
        last ? "On to the timed round" : "Next character",
        () => {
          env.performer.stop();
          ui.setSeal(false);
          index += 1;
          if (last) onDone();
          else startItem();
        },
        "primary",
      ),
    );
  };

  /** Act on the effects of a transition that put the learner somewhere new. */
  const enter = (effects: readonly LearnEffect[]): void => {
    if (effects.some((effect) => effect.type === "done")) {
      celebrate();
      return;
    }
    const stage = currentStage(state, plan);
    if (stage === null || !effects.some((effect) => effect.type === "stage-enter")) return;
    task = stageTask(stage);
    env.emit(gameEvent("stage_enter", where(), { stage_index: state.stage, reps: stage.kind === "trace" ? stage.reps : 1 }));
    if (stage.kind === "demo") runDemo(stage.withAudio);
    else beginRep(stage);
  };

  const onJudged = (result: AttemptResult, drawMs: number): void => {
    const stage = currentStage(state, plan);
    if (stage?.kind !== "trace") return;
    const recorded = recordAttempt(clock, {
      now: Date.now(),
      drawMs,
      result,
      hintLevel: state.hint,
      component: item.melody.strokes[state.expected]?.component ?? null,
      guide: stage.guide,
      audioMode: env.audioMode(),
    });
    clock = recorded.clock;
    env.emit(strokeAttemptEvent(where(), recorded.data));

    const step = applyAttempt(state, plan, item.glyph.strokes.length, result.verdict);
    state = step.state;
    let repComplete = false;
    for (const effect of step.effects) {
      if (effect.type === "stroke-accepted") tracer.accept(effect.stroke);
      else if (effect.type === "stroke-rejected") tracer.reject(effect.verdict);
      else if (effect.type === "hint") showHint(effect, true);
      else if (effect.type === "rep-complete") repComplete = true;
    }
    if (!repComplete) {
      tracer.expect(state.expected, state.hint);
      traceActions(state.hint);
      probe(task);
      return;
    }
    // The finished character rests on the board for a moment before the next step.
    board.enabled = false;
    tracer.end();
    ui.highlightUnit(null);
    chipsPlay(false);
    probe("rest");
    timers.after(AFTER_REP_MS, () => {
      const next = currentStage(state, plan);
      if (next?.kind === "trace" && !step.effects.some((effect) => effect.type === "stage-enter")) beginRep(next);
      else enter(step.effects);
    });
  };

  const startItem = (): void => {
    const char = lesson.chars[index];
    if (char === undefined) return;
    const glyph = glyphOf(env.content, char);
    item = { char, glyph, melody: env.melodist().melody(glyph) };
    clock = startItemClock(Date.now());
    const step = startLearning(plan);
    state = step.state;
    task = "learn";
    ui.setHeading(lesson.title, `${index + 1} / ${lesson.chars.length}`);
    ui.setStatus();
    ui.setGloss(glossOf(env.content, char));
    ui.setChips(item.melody);
    ui.setMessage("");
    env.emit(gameEvent("item_start", where(), { lesson: lesson.id, plan: plan.id, stroke_count: glyph.strokes.length }));
    enter(step.effects);
  };

  startItem();

  return {
    stop() {
      timers.clear();
      env.performer.stop();
      tracer.end();
      board.enabled = false;
    },
  };
}
