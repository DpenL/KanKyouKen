import type { AttemptVerdict } from "../stroke/types";
import type { HintLevel, LearnEffect, LearnPlan, LearnStage, LearnState, LearnStep } from "./types";

/** The stage the learner is in, or null when the plan is finished. */
export function currentStage(state: LearnState, plan: LearnPlan): LearnStage | null {
  return state.done ? null : (plan.stages[state.stage] ?? null);
}

/** First stage at or after `from` that has something to do (trace stages with no repetitions are skipped). */
function nextPlayableStage(plan: LearnPlan, from: number): number {
  let i = from;
  while (i < plan.stages.length) {
    const stage = plan.stages[i]!;
    if (stage.kind === "demo" || stage.reps > 0) break;
    i++;
  }
  return i;
}

function enter(plan: LearnPlan, stage: number, totalMistakes: number): LearnStep {
  const index = nextPlayableStage(plan, stage);
  const done = index >= plan.stages.length;
  const state: LearnState = {
    stage: index,
    rep: 0,
    expected: 0,
    consecutiveErrors: 0,
    hint: 0,
    repMistakes: 0,
    totalMistakes,
    done,
  };
  const effects: LearnEffect[] = done ? [{ type: "done", totalMistakes }] : [{ type: "stage-enter", stage: index }];
  return { state, effects };
}

/** Begin learning one character. An empty plan is finished immediately. */
export function startLearning(plan: LearnPlan): LearnStep {
  return enter(plan, 0, 0);
}

/** Report that the demonstration has been watched. Only valid while the current stage is a demo. */
export function finishDemo(state: LearnState, plan: LearnPlan): LearnStep {
  if (currentStage(state, plan)?.kind !== "demo") throw new Error("finishDemo: the current stage is not a demo");
  return enter(plan, state.stage + 1, state.totalMistakes);
}

/**
 * Feed the verdict of one stroke attempt into the plan.
 *
 * A correct stroke advances; finishing the last stroke completes a repetition, and the
 * last repetition completes the stage. Any other verdict leaves the learner on the same
 * stroke (wrong strokes are simply tried again, with no other penalty). When the stage
 * sets `hintAfterErrors`, the hint follows the run of wrong attempts at this stroke:
 * level 1 once that many in a row were wrong, level 2 at twice as many. A hint the
 * learner asked for is never lowered and does not shorten the run: after a requested
 * level 1, level 2 still comes at twice `hintAfterErrors`. The hint is cleared by the
 * next correct stroke.
 *
 * Only valid while the current stage is a trace stage; `strokeCount` must be positive.
 */
export function applyAttempt(state: LearnState, plan: LearnPlan, strokeCount: number, verdict: AttemptVerdict): LearnStep {
  const stage = currentStage(state, plan);
  if (stage?.kind !== "trace") throw new Error("applyAttempt: the current stage is not a trace stage");
  if (!Number.isInteger(strokeCount) || strokeCount <= 0) throw new RangeError("applyAttempt: strokeCount must be a positive integer");

  if (verdict !== "correct") {
    const consecutiveErrors = state.consecutiveErrors + 1;
    const effects: LearnEffect[] = [{ type: "stroke-rejected", stroke: state.expected, verdict }];
    let hint = state.hint;
    if (stage.hintAfterErrors !== undefined && stage.hintAfterErrors > 0 && consecutiveErrors % stage.hintAfterErrors === 0) {
      const level = Math.min(2, consecutiveErrors / stage.hintAfterErrors) as HintLevel;
      if (level > hint) {
        hint = level;
        effects.push({ type: "hint", stroke: state.expected, level });
      }
    }
    return {
      state: {
        ...state,
        consecutiveErrors,
        hint,
        repMistakes: state.repMistakes + 1,
        totalMistakes: state.totalMistakes + 1,
      },
      effects,
    };
  }

  const effects: LearnEffect[] = [{ type: "stroke-accepted", stroke: state.expected }];
  const expected = state.expected + 1;
  if (expected < strokeCount) {
    return { state: { ...state, expected, consecutiveErrors: 0, hint: 0 }, effects };
  }
  effects.push({ type: "rep-complete", stage: state.stage, rep: state.rep, mistakes: state.repMistakes });
  const rep = state.rep + 1;
  if (rep < stage.reps) {
    return {
      state: { ...state, rep, expected: 0, consecutiveErrors: 0, hint: 0, repMistakes: 0 },
      effects,
    };
  }
  const next = enter(plan, state.stage + 1, state.totalMistakes);
  return { state: next.state, effects: [...effects, ...next.effects] };
}

/**
 * The learner asks for help: raises the hint level by one (to at most 2).
 * Does nothing outside a trace stage or when the hint is already at its maximum.
 */
export function requestHint(state: LearnState, plan: LearnPlan): LearnStep {
  if (currentStage(state, plan)?.kind !== "trace" || state.hint >= 2) return { state, effects: [] };
  const level = (state.hint + 1) as HintLevel;
  return { state: { ...state, hint: level }, effects: [{ type: "hint", stroke: state.expected, level }] };
}
