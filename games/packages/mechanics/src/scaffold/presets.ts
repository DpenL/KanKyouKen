import type { LearnPlan, RecallCue, ReviewLadder, TimedScoring } from "./types";

/**
 * Demo with sound, two traces over a dotted guide, three traces on a blank area, with an
 * automatic hint after repeated mistakes. The sequence and the 2 + 3 repetitions follow
 * the second Radical Tunes study; the hint threshold of 3 is our choice (the paper says
 * only "several times in a row").
 */
export const PLAN_GUIDED_FADE: LearnPlan = {
  id: "guided-fade",
  stages: [
    { kind: "demo", withAudio: true },
    { kind: "trace", guide: "dotted", reps: 2 },
    { kind: "trace", guide: "none", reps: 3, hintAfterErrors: 3 },
  ],
};

/**
 * Demo, then tracing the visible character with numbered arrows, then without them.
 * The sequence follows the first Radical Tunes study; one repetition per stage is our
 * choice (the paper does not give counts).
 */
export const PLAN_ARROWS: LearnPlan = {
  id: "arrows-then-outline",
  stages: [
    { kind: "demo", withAudio: true },
    { kind: "trace", guide: "arrows", reps: 1 },
    { kind: "trace", guide: "outline", reps: 1 },
  ],
};

/** A short plan of our own for quick rounds: demo, one guided trace, one from memory. */
export const PLAN_QUICK: LearnPlan = {
  id: "quick",
  stages: [
    { kind: "demo", withAudio: true },
    { kind: "trace", guide: "dotted", reps: 1 },
    { kind: "trace", guide: "none", reps: 1, hintAfterErrors: 2 },
  ],
};

/** Our own numbers: the sources say only that speed and correctness earn points. */
export const DEFAULT_TIMED_SCORING: TimedScoring = {
  strokePoints: 10,
  mistakePenalty: 5,
  parSecondsPerStroke: 2.5,
  maxSpeedBonusPerStroke: 10,
};

/** Recall prompt of the melody condition: meaning, stroke count, and the melody heard first. */
export const RECALL_CUE_WITH_MELODY: RecallCue = { showMeaning: true, showStrokeCount: true, melody: "required" };

/** Recall prompt of the control condition: meaning and stroke count only. */
export const RECALL_CUE_PLAIN: RecallCue = { showMeaning: true, showStrokeCount: true, melody: "off" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Review right after learning, then after about 3 minutes, 10 minutes and an hour (from
 * the 2019 classroom manual); the longer steps are ours. No mistakes moves an item up,
 * more than one mistake moves it down.
 */
export const DEFAULT_LADDER: ReviewLadder = {
  intervalsMs: [0, 3 * MINUTE, 10 * MINUTE, HOUR, 5 * HOUR, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY],
  promoteAtMost: 0,
  demoteAbove: 1,
};
