import type { LearnPlan, LearnStage, LearnState, TimedItemResult, TraceGuide } from "@kankyouken/mechanics/scaffold";

export type Stars = 1 | 2 | 3;

export function countMistakes(results: readonly TimedItemResult[]): number {
  return results.reduce((sum, result) => sum + result.mistakes, 0);
}

/**
 * Stars for a timed round: three for a clean round, two when mistakes average at most
 * one per character written, otherwise one.
 */
export function starsFor(results: readonly TimedItemResult[]): Stars {
  const mistakes = countMistakes(results);
  if (mistakes === 0) return 3;
  return mistakes <= results.length ? 2 : 1;
}

/** Stars per lesson read back from storage; anything that is not 1, 2 or 3 is dropped, and a list is not a table of lessons. */
export function sanitizeStars(raw: unknown): Record<string, Stars> {
  const out: Record<string, Stars> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [lesson, value] of Object.entries(raw)) {
    if (value === 1 || value === 2 || value === 3) out[lesson] = value;
  }
  return out;
}

/** Record a lesson's stars, keeping the best result so far. */
export function withStars(stars: Readonly<Record<string, Stars>>, lesson: string, earned: Stars): Record<string, Stars> {
  return { ...stars, [lesson]: Math.max(stars[lesson] ?? 0, earned) as Stars };
}

/**
 * Whether a hint can show anything in a trace stage with this guide. A hint shows where
 * the expected stroke starts, then the stroke itself as a dotted line; the dotted guide
 * shows both all along, so there Hint is not offered.
 */
export function hintAdds(guide: TraceGuide): boolean {
  return guide !== "dotted";
}

/** Task name of a learning stage in telemetry: "demo" or "trace:<guide>". */
export function stageTask(stage: LearnStage): string {
  return stage.kind === "demo" ? "demo" : `trace:${stage.guide}`;
}

const STAGE_LABELS: Readonly<Record<string, string>> = {
  demo: "Watch and listen",
  "trace:arrows": "Follow the arrows",
  "trace:dotted": "Trace the dotted stroke",
  "trace:outline": "Trace over the outline",
  "trace:none": "Write it on your own",
};

export function stageLabel(stage: LearnStage): string {
  return STAGE_LABELS[stageTask(stage)] ?? "";
}

export interface Pip {
  readonly state: "done" | "current" | "todo";
  /** True for the first step of a stage, so the indicator can group steps by stage. */
  readonly startsStage: boolean;
}

/** One step per demo and per repetition of every trace stage, marked against the learner's position. */
export function planPips(plan: LearnPlan, state: LearnState): Pip[] {
  const pips: Pip[] = [];
  plan.stages.forEach((stage, s) => {
    const steps = stage.kind === "demo" ? 1 : stage.reps;
    for (let rep = 0; rep < steps; rep++) {
      const before = state.done || s < state.stage || (s === state.stage && rep < state.rep);
      const current = !state.done && s === state.stage && rep === state.rep;
      pips.push({ state: before ? "done" : current ? "current" : "todo", startsStage: rep === 0 });
    }
  });
  return pips;
}

/** A duration as minutes, seconds and tenths: "1:07.4". */
export function formatDuration(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}
