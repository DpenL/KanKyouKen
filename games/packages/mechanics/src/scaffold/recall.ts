import type { RecallCue, RecallItemState } from "./types";

/** Start a recall item. With a required melody cue, writing stays locked until it has been heard once. */
export function startRecallItem(item: string, cue: RecallCue): RecallItemState {
  return { item, listens: 0, canWrite: cue.melody !== "required", strokesDrawn: 0, submitted: false };
}

/** The melody cue was played (again). Unlocks writing. */
export function recallListened(state: RecallItemState): RecallItemState {
  return state.submitted ? state : { ...state, listens: state.listens + 1, canWrite: true };
}

/** One more stroke was written. Throws while writing is locked or after submission. */
export function recallStrokeDrawn(state: RecallItemState): RecallItemState {
  if (state.submitted) throw new Error("recall: already submitted");
  if (!state.canWrite) throw new Error("recall: the melody must be heard before writing");
  return { ...state, strokesDrawn: state.strokesDrawn + 1 };
}

/** The last stroke was taken back. No-op with nothing written or after submission. */
export function recallUndo(state: RecallItemState): RecallItemState {
  return state.submitted || state.strokesDrawn === 0 ? state : { ...state, strokesDrawn: state.strokesDrawn - 1 };
}

/** Hand the writing in. No feedback is part of this mechanic: scoring happens elsewhere. */
export function submitRecall(state: RecallItemState): RecallItemState {
  return { ...state, submitted: true };
}
