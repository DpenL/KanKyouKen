/**
 * Scaffolding and session structure: how help fades while a character is being learned,
 * what happens after repeated mistakes, the timed performance round, the cue-then-write
 * recall test, and a simple spaced-review ladder.
 *
 * Everything is a pure state transition over serializable state, so a host in any
 * engine can drive it, persist it, and replay it from a telemetry log.
 *
 * Provenance. The stage sequences, the "wrong stroke = try that stroke again" rule, the
 * hint after several consecutive wrong attempts, the timed round (every character twice,
 * shuffled, score and time shown at the end), the recall prompt (meaning + stroke count
 * + replayable melody) and the review ladder are mined from Radical Tunes (Keehl &
 * Melcer 2019, 2021, and the 2019 classroom manual). Numbers the sources do not give
 * (the hint threshold, the score formula, ladder steps beyond one hour, repetitions in
 * the 2019 build) are our own choices and are marked as such on the presets.
 */

import type { AttemptVerdict } from "../stroke/types";

// ---------------------------------------------------------------------------
// Learning one character
// ---------------------------------------------------------------------------

/**
 * Visual help while tracing.
 *  - "arrows":  the whole character is visible with numbered direction arrows.
 *  - "dotted":  only the next stroke is shown, as a dotted line whose first, larger dot
 *               marks where to start.
 *  - "outline": the whole character is visible as a faint shape, no order or direction cues.
 *  - "none":    blank writing area.
 */
export type TraceGuide = "arrows" | "dotted" | "outline" | "none";

export interface DemoStage {
  readonly kind: "demo";
  /** Play the character's stroke sounds along with the animation. */
  readonly withAudio: boolean;
}

export interface TraceStage {
  readonly kind: "trace";
  readonly guide: TraceGuide;
  /** How many times the whole character is written in this stage. */
  readonly reps: number;
  /**
   * After this many consecutive wrong attempts at the same stroke a hint appears
   * (level 1: the start dot). After as many again it escalates (level 2: the whole
   * stroke). Omit for no automatic hints.
   */
  readonly hintAfterErrors?: number;
}

export type LearnStage = DemoStage | TraceStage;

export interface LearnPlan {
  readonly id: string;
  readonly stages: readonly LearnStage[];
}

/** 0 = no hint, 1 = start dot of the expected stroke, 2 = the whole expected stroke. */
export type HintLevel = 0 | 1 | 2;

export interface LearnState {
  /** Index into `plan.stages`; equals `plan.stages.length` when finished. */
  readonly stage: number;
  /** Repetition within the current trace stage, 0-based. */
  readonly rep: number;
  /** Stroke the player must write next. */
  readonly expected: number;
  readonly consecutiveErrors: number;
  readonly hint: HintLevel;
  /** Wrong attempts in the current repetition. */
  readonly repMistakes: number;
  /** Wrong attempts since learning this character began. */
  readonly totalMistakes: number;
  readonly done: boolean;
}

export type LearnEffect =
  | { readonly type: "stroke-accepted"; readonly stroke: number }
  | { readonly type: "stroke-rejected"; readonly stroke: number; readonly verdict: Exclude<AttemptVerdict, "correct"> }
  | { readonly type: "hint"; readonly stroke: number; readonly level: HintLevel }
  | { readonly type: "rep-complete"; readonly stage: number; readonly rep: number; readonly mistakes: number }
  | { readonly type: "stage-enter"; readonly stage: number }
  | { readonly type: "done"; readonly totalMistakes: number };

export interface LearnStep {
  readonly state: LearnState;
  /** What the host should show or play, in order. */
  readonly effects: readonly LearnEffect[];
}

// ---------------------------------------------------------------------------
// Timed performance round
// ---------------------------------------------------------------------------

export interface TimedScoring {
  /** Points for each stroke written correctly at the first attempt. */
  readonly strokePoints: number;
  /** Points lost per wrong attempt (a character's points never go below zero). */
  readonly mistakePenalty: number;
  /** Seconds allowed per stroke before the speed bonus reaches zero. */
  readonly parSecondsPerStroke: number;
  /** Bonus for finishing a character instantly; scales linearly to zero at par time. */
  readonly maxSpeedBonusPerStroke: number;
}

export interface TimedRoundConfig {
  /** Characters to play. */
  readonly items: readonly string[];
  /** How many times each character appears. */
  readonly repeats: number;
  readonly shuffle: boolean;
  readonly scoring: TimedScoring;
}

export interface TimedItemResult {
  readonly item: string;
  readonly strokeCount: number;
  readonly mistakes: number;
  readonly durationMs: number;
  readonly points: number;
}

export interface TimedRoundState {
  /** Full play order, fixed when the round starts. */
  readonly queue: readonly string[];
  /** Index of the character being written; equals `queue.length` when finished. */
  readonly index: number;
  readonly results: readonly TimedItemResult[];
  readonly score: number;
  /** Sum of the durations of finished characters. */
  readonly elapsedMs: number;
  readonly done: boolean;
}

// ---------------------------------------------------------------------------
// Recall test (cue, then write from memory)
// ---------------------------------------------------------------------------

export interface RecallCue {
  readonly showMeaning: boolean;
  /** Show "strokes written / strokes total". */
  readonly showStrokeCount: boolean;
  /**
   * "required": the melody must be heard once before writing, and can be replayed freely.
   * "optional": a listen button is offered. "off": no melody cue.
   */
  readonly melody: "required" | "optional" | "off";
}

export interface RecallItemState {
  readonly item: string;
  readonly listens: number;
  /** Writing is allowed (false while a required first listen is outstanding). */
  readonly canWrite: boolean;
  readonly strokesDrawn: number;
  readonly submitted: boolean;
}

// ---------------------------------------------------------------------------
// Spaced review ladder
// ---------------------------------------------------------------------------

export interface ReviewLadder {
  /** Waiting time before each review, in milliseconds; index = level. */
  readonly intervalsMs: readonly number[];
  /** Mistakes up to this count move the item up one level. */
  readonly promoteAtMost: number;
  /** Mistakes above this count move the item down one level. In between, the level is kept. */
  readonly demoteAbove: number;
}

export interface ReviewItem {
  readonly item: string;
  readonly level: number;
  /** Timestamp (ms) when the item becomes due. */
  readonly dueAt: number;
}
