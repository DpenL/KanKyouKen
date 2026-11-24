import type { StrokeAudioMode } from "@kankyouken/mechanics/melody";
import type { RecallCue, RecallItemState } from "@kankyouken/mechanics/scaffold";
import { RECALL_CUE_PLAIN, RECALL_CUE_WITH_MELODY } from "@kankyouken/mechanics/scaffold";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { DrawnStroke, FreeWritingScore } from "@kankyouken/mechanics/stroke";
import { scoreFreeWriting } from "@kankyouken/mechanics/stroke";
import type { RecallResultData } from "@kankyouken/mechanics/telemetry";
import type { Judging } from "./settings";
import { LENIENCY } from "./settings";

/** The melody is part of the recall prompt only where melodies carry information about the character. */
export function recallCueFor(mode: StrokeAudioMode): RecallCue {
  return mode === "melody" ? RECALL_CUE_WITH_MELODY : RECALL_CUE_PLAIN;
}

/**
 * Score a character written from memory with the judging level the player chose: a
 * stroke the learning stages accept at that level counts as written here too.
 */
export function scoreRecall(drawn: readonly DrawnStroke[], glyph: Glyph, judging: Judging): FreeWritingScore {
  return scoreFreeWriting(drawn, glyph, { match: { leniency: LENIENCY[judging] } });
}

/** Every stroke present, in the right order and direction, and nothing else on the page. */
export function isPerfectRecall(score: FreeWritingScore): boolean {
  return score.orderCorrect === score.strokeCount && score.directionCorrect === score.strokeCount && score.extra.length === 0;
}

/** A `recall_result` payload with the judging level the character was scored at (see `scoreRecall`). */
export type RecallResult = RecallResultData & { readonly judging: Judging; readonly leniency: number };

export function recallResultData(
  score: FreeWritingScore,
  state: RecallItemState,
  responseMs: number,
  audioMode: StrokeAudioMode,
  judging: Judging,
): RecallResult {
  return {
    correct: isPerfectRecall(score),
    response_time_ms: Math.max(0, Math.round(responseMs)),
    stroke_count: score.strokeCount,
    drawn_count: score.drawnCount,
    order_correct: score.orderCorrect,
    direction_correct: score.directionCorrect,
    order_relative: score.orderRelative,
    melody_listens: state.listens,
    audio_mode: audioMode,
    judging,
    leniency: LENIENCY[judging],
  };
}

/** One line of the summary shown after the whole round. */
export interface RecallRow {
  readonly char: string;
  readonly meaning: string;
  readonly strokeCount: number;
  readonly orderCorrect: number;
  readonly directionCorrect: number;
  /** Strokes drawn that belong to no stroke of the character; with any of them the answer is not a perfect recall. */
  readonly extra: number;
}

export function recallRow(char: string, meaning: string, score: FreeWritingScore): RecallRow {
  return {
    char,
    meaning,
    strokeCount: score.strokeCount,
    orderCorrect: score.orderCorrect,
    directionCorrect: score.directionCorrect,
    extra: score.extra.length,
  };
}
