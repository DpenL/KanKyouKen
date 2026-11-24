import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { GlyphMelody, VoiceHandle } from "@kankyouken/mechanics/melody";
import { strokeVoice } from "@kankyouken/mechanics/melody";
import type { HintLevel, TraceGuide } from "@kankyouken/mechanics/scaffold";
import type { AttemptResult, AttemptVerdict, DotTraceState, DotTrack, StrokeSample } from "@kankyouken/mechanics/stroke";
import { createDotTrace, feedDotSegment, judgeAttempt, layoutDots } from "@kankyouken/mechanics/stroke";
import { projectOntoPolyline } from "@kankyouken/mechanics/util";
import type { StrokeCaptureHandlers } from "@kankyouken/web-kit/input";
import { isStrayTap } from "../attempts";
import type { Env } from "../env";
import { toneOf } from "../palette";
import { LENIENCY } from "../settings";
import type { WritingUi } from "./writing-ui";

export interface TraceTarget {
  readonly glyph: Glyph;
  readonly melody: GlyphMelody;
  readonly guide: TraceGuide;
}

type Rejection = Exclude<AttemptVerdict, "correct">;

/**
 * Stroke-by-stroke writing on the board: the guide for the expected stroke, the voice
 * that sounds while the pen is down, the ink, and the judgement of every stroke. What a
 * verdict leads to is the caller's business (`onJudged`), which answers with `accept`
 * or `reject` and then `expect`.
 */
export interface Tracer {
  /** Show a character with its first `expected` strokes written, ready for the next one. */
  begin(target: TraceTarget, expected: number, hint: HintLevel): void;
  /** Ask for another stroke, or change the hint for the current one. */
  expect(expected: number, hint: HintLevel): void;
  accept(stroke: number): void;
  reject(verdict: Rejection): void;
  /** Stop listening to the pen; what is on the board stays. */
  end(): void;
}

const REASONS: Readonly<Record<Rejection, string>> = {
  "wrong-direction": "Other way round: start from the other end.",
  "wrong-order": "Not this stroke yet.",
  miss: "",
};

const penDownMs = (stroke: readonly StrokeSample[]): number => (stroke.at(-1)?.t ?? 0) - (stroke[0]?.t ?? 0);

export function createTracer(env: Env, ui: WritingUi, onJudged: (result: AttemptResult, drawMs: number) => void): Tracer {
  const { board } = ui;
  const { view } = board;
  let target: TraceTarget | null = null;
  let tracks: DotTrack[] = [];
  let expected = 0;
  let hint: HintLevel = 0;
  let voice: VoiceHandle | null = null;
  /** Dots of the expected stroke that light up under the pen (dotted guide only). */
  let trail: { readonly track: DotTrack; state: DotTraceState } | null = null;
  let previous: StrokeSample | null = null;

  const releaseVoice = (): void => {
    voice?.stop();
    voice = null;
  };

  const showGuide = (): void => {
    if (target === null) return;
    const { glyph, guide, melody } = target;
    const track = tracks[expected];
    const remaining = Array.from({ length: Math.max(0, glyph.strokes.length - expected) }, (_, i) => expected + i);
    view.showArrows(guide === "arrows" ? remaining : []);
    view.showDotted(guide === "dotted" || hint === 2 ? expected : null);
    trail = guide === "dotted" && track !== undefined ? { track, state: createDotTrace([track]) } : null;
    if (trail !== null) view.showDots(trail.track, trail.state.touched[0], { markStart: false });
    else if (hint >= 1 && track !== undefined) view.showDots({ stroke: track.stroke, dots: track.dots.slice(0, 1) });
    else view.showDots(null);
    const next = melody.strokes[expected];
    ui.highlightUnit(next?.unit ?? null);
    board.setTone(next === undefined ? null : toneOf(next.timbre));
  };

  const pen: StrokeCaptureHandlers = {
    onStart(sample) {
      if (target === null) return;
      env.performer.stop();
      ui.setMessage("");
      const stroke = target.melody.strokes[expected];
      if (stroke !== undefined) {
        voice = env.sound.startVoice(strokeVoice(env.audioMode(), stroke, env.melodist().config.tuning, env.audioRng));
      }
      previous = sample;
      view.setInk([sample]);
    },
    onMove(sample, drawn) {
      if (target === null) return;
      const median = target.glyph.strokes[expected]?.median;
      if (median !== undefined) voice?.setProgress(projectOntoPolyline(sample, median));
      view.setInk(drawn);
      if (trail !== null && previous !== null) {
        trail.state = feedDotSegment(trail.state, [trail.track], previous, sample, target.glyph.size, { mode: "free" }).state;
        view.showDots(trail.track, trail.state.touched[0], { markStart: false });
      }
      previous = sample;
    },
    onEnd(drawn) {
      releaseVoice();
      if (target === null) return;
      if (isStrayTap(drawn, target.glyph.size)) {
        view.setInk(null);
        return;
      }
      const leniency = LENIENCY[env.settings().judging];
      onJudged(judgeAttempt(drawn, target.glyph, expected, { match: { leniency } }), penDownMs(drawn));
    },
    onCancel() {
      releaseVoice();
      view.setInk(null);
      showGuide();
    },
  };

  const tracer: Tracer = {
    begin(next, from, level) {
      target = next;
      tracks = layoutDots(next.glyph);
      view.setGlyph(next.glyph);
      view.showGhost(next.guide === "arrows" || next.guide === "outline");
      for (let i = 0; i < from; i++) view.setStrokeState(i, "done");
      board.pen = pen;
      tracer.expect(from, level);
    },
    expect(next, level) {
      expected = next;
      hint = level;
      showGuide();
    },
    accept(stroke) {
      view.flashInk("ok");
      view.setStrokeState(stroke, "done");
      board.settle(stroke);
    },
    reject(verdict) {
      env.sound.cue("error");
      view.flashInk("error");
      ui.setMessage(REASONS[verdict]);
    },
    end() {
      releaseVoice();
      board.pen = null;
      target = null;
      view.showArrows([]);
      view.showDotted(null);
      view.showDots(null);
    },
  };
  return tracer;
}
