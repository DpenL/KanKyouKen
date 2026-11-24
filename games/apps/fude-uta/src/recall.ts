import type { StrokeAudioMode } from "@kankyouken/mechanics/melody";
import type { RecallCue, RecallItemState } from "@kankyouken/mechanics/scaffold";
import { RECALL_CUE_PLAIN, RECALL_CUE_WITH_MELODY } from "@kankyouken/mechanics/scaffold";
import type { FreeWritingScore } from "@kankyouken/mechanics/stroke";
import type { RecallResultData } from "@kankyouken/mechanics/telemetry";

/** The melody is part of the recall prompt only where melodies carry information about the character. */
export function recallCueFor(mode: StrokeAudioMode): RecallCue {
  return mode === "melody" ? RECALL_CUE_WITH_MELODY : RECALL_CUE_PLAIN;
}

/** Every stroke present, in the right order and direction, and nothing else on the page. */
export function isPerfectRecall(score: FreeWritingScore): boolean {
  return score.orderCorrect === score.strokeCount && score.directionCorrect === score.strokeCount && score.extra.length === 0;
}

export function recallResultData(
  score: FreeWritingScore,
  state: RecallItemState,
  responseMs: number,
  audioMode: StrokeAudioMode,
): RecallResultData {
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
  };
}

/** One line of the summary shown after the whole round. */
export interface RecallRow {
  readonly char: string;
  readonly meaning: string;
  readonly strokeCount: number;
  readonly orderCorrect: number;
  readonly directionCorrect: number;
}

export function recallRow(char: string, meaning: string, score: FreeWritingScore): RecallRow {
  return {
    char,
    meaning,
    strokeCount: score.strokeCount,
    orderCorrect: score.orderCorrect,
    directionCorrect: score.directionCorrect,
  };
}
