import { describe, expect, it } from "vitest";
import { createRng } from "../util/rng";
import { applyAttempt, currentStage, finishDemo, requestHint, startLearning } from "./learn";
import { DEFAULT_LADDER, DEFAULT_TIMED_SCORING, PLAN_GUIDED_FADE, RECALL_CUE_PLAIN, RECALL_CUE_WITH_MELODY } from "./presets";
import { recallListened, recallStrokeDrawn, recallUndo, startRecallItem, submitRecall } from "./recall";
import { dueItems, introduceItem, reviewItem } from "./review";
import { completeTimedItem, currentTimedItem, scoreTimedItem, startTimedRound } from "./timed";
import type { LearnPlan, LearnState } from "./types";

describe("learning plan", () => {
  it("walks demo, guided and unguided stages", () => {
    let step = startLearning(PLAN_GUIDED_FADE);
    expect(step.effects).toEqual([{ type: "stage-enter", stage: 0 }]);
    expect(currentStage(step.state, PLAN_GUIDED_FADE)).toEqual({ kind: "demo", withAudio: true });
    step = finishDemo(step.state, PLAN_GUIDED_FADE);
    expect(step.state.stage).toBe(1);

    const strokes = 2;
    const seen: string[] = [];
    let state: LearnState = step.state;
    while (!state.done) {
      const next = applyAttempt(state, PLAN_GUIDED_FADE, strokes, "correct");
      seen.push(...next.effects.map((e) => e.type));
      state = next.state;
    }
    // 2 guided + 3 unguided repetitions of a 2-stroke character
    expect(seen.filter((t) => t === "stroke-accepted")).toHaveLength(10);
    expect(seen.filter((t) => t === "rep-complete")).toHaveLength(5);
    expect(seen.filter((t) => t === "stage-enter")).toHaveLength(1);
    expect(seen.at(-1)).toBe("done");
    expect(state.totalMistakes).toBe(0);
  });

  it("keeps the learner on a wrong stroke and escalates hints", () => {
    const plan: LearnPlan = { id: "t", stages: [{ kind: "trace", guide: "none", reps: 1, hintAfterErrors: 2 }] };
    let state = startLearning(plan).state;
    const types: string[] = [];
    for (const verdict of ["miss", "wrong-order", "wrong-direction", "miss", "miss", "miss"] as const) {
      const step = applyAttempt(state, plan, 3, verdict);
      types.push(step.effects.map((e) => (e.type === "hint" ? `hint${e.level}` : e.type)).join("+"));
      state = step.state;
    }
    expect(types).toEqual([
      "stroke-rejected",
      "stroke-rejected+hint1",
      "stroke-rejected",
      "stroke-rejected+hint2",
      "stroke-rejected",
      "stroke-rejected",
    ]);
    expect(state.expected).toBe(0);
    expect(state.hint).toBe(2);
    expect(state.repMistakes).toBe(6);
    const ok = applyAttempt(state, plan, 3, "correct");
    expect(ok.state.expected).toBe(1);
    expect(ok.state.hint).toBe(0);
    expect(ok.state.consecutiveErrors).toBe(0);
    expect(ok.state.totalMistakes).toBe(6);
  });

  it("reports mistakes per repetition and resets them", () => {
    const plan: LearnPlan = { id: "t", stages: [{ kind: "trace", guide: "dotted", reps: 2 }] };
    let state = startLearning(plan).state;
    state = applyAttempt(state, plan, 1, "miss").state;
    const first = applyAttempt(state, plan, 1, "correct");
    expect(first.effects).toContainEqual({ type: "rep-complete", stage: 0, rep: 0, mistakes: 1 });
    expect(first.state.repMistakes).toBe(0);
    const second = applyAttempt(first.state, plan, 1, "correct");
    expect(second.effects.at(-1)).toEqual({ type: "done", totalMistakes: 1 });
    expect(second.state.done).toBe(true);
  });

  it("handles empty plans, empty stages and misuse", () => {
    expect(startLearning({ id: "empty", stages: [] }).state.done).toBe(true);
    const skip: LearnPlan = { id: "skip", stages: [{ kind: "trace", guide: "none", reps: 0 }, { kind: "demo", withAudio: false }] };
    const start = startLearning(skip);
    expect(start.state.stage).toBe(1);
    expect(() => applyAttempt(start.state, skip, 3, "correct")).toThrow(/not a trace/);
    expect(finishDemo(start.state, skip).state.done).toBe(true);
    const plan: LearnPlan = { id: "t", stages: [{ kind: "trace", guide: "none", reps: 1 }] };
    const s = startLearning(plan).state;
    expect(() => finishDemo(s, plan)).toThrow(/not a demo/);
    expect(() => applyAttempt(s, plan, 0, "correct")).toThrow(RangeError);
  });

  it("gives manual hints up to level 2", () => {
    const plan: LearnPlan = { id: "t", stages: [{ kind: "trace", guide: "none", reps: 1 }] };
    let step = requestHint(startLearning(plan).state, plan);
    expect(step.effects).toEqual([{ type: "hint", stroke: 0, level: 1 }]);
    step = requestHint(step.state, plan);
    expect(step.state.hint).toBe(2);
    expect(requestHint(step.state, plan).effects).toEqual([]);
  });
});

describe("timed round", () => {
  const config = { items: ["木", "口", "日"], repeats: 2, shuffle: true, scoring: DEFAULT_TIMED_SCORING };

  it("plays every item the requested number of times without back-to-back repeats", () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = startTimedRound(config, createRng(seed));
      expect(state.queue).toHaveLength(6);
      expect([...state.queue].sort()).toEqual(["口", "口", "日", "日", "木", "木"]);
      for (let i = 1; i < state.queue.length; i++) expect(state.queue[i]).not.toBe(state.queue[i - 1]);
    }
    expect(startTimedRound({ ...config, shuffle: false }, createRng(1)).queue).toEqual(["木", "口", "日", "木", "口", "日"]);
    expect(startTimedRound({ ...config, items: [] }, createRng(1)).done).toBe(true);
  });

  it("scores speed and accuracy", () => {
    expect(scoreTimedItem(4, 0, 0)).toBe(80);
    expect(scoreTimedItem(4, 0, 10_000)).toBe(40);
    expect(scoreTimedItem(4, 0, 5_000)).toBe(60);
    expect(scoreTimedItem(4, 2, 10_000)).toBe(30);
    expect(scoreTimedItem(4, 20, 0)).toBe(0);
  });

  it("accumulates results until the queue is done", () => {
    let state = startTimedRound({ ...config, repeats: 1, shuffle: false }, createRng(1));
    expect(currentTimedItem(state)).toBe("木");
    state = completeTimedItem(state, config, { strokeCount: 4, mistakes: 0, durationMs: 10_000 });
    state = completeTimedItem(state, config, { strokeCount: 3, mistakes: 1, durationMs: 7_500 });
    state = completeTimedItem(state, config, { strokeCount: 4, mistakes: 0, durationMs: 5_000 });
    expect(state.done).toBe(true);
    expect(state.score).toBe(40 + 25 + 60);
    expect(state.elapsedMs).toBe(22_500);
    expect(currentTimedItem(state)).toBeNull();
    expect(() => completeTimedItem(state, config, { strokeCount: 1, mistakes: 0, durationMs: 1 })).toThrow();
  });
});

describe("recall item", () => {
  it("locks writing until a required melody has been heard", () => {
    let state = startRecallItem("胡", RECALL_CUE_WITH_MELODY);
    expect(state.canWrite).toBe(false);
    expect(() => recallStrokeDrawn(state)).toThrow(/melody/);
    state = recallListened(recallListened(state));
    expect(state.listens).toBe(2);
    state = recallStrokeDrawn(recallStrokeDrawn(state));
    state = recallUndo(state);
    expect(state.strokesDrawn).toBe(1);
    state = submitRecall(state);
    expect(() => recallStrokeDrawn(state)).toThrow(/submitted/);
    expect(recallUndo(state)).toBe(state);
  });

  it("allows writing straight away without a melody cue", () => {
    expect(startRecallItem("胡", RECALL_CUE_PLAIN).canWrite).toBe(true);
    expect(recallUndo(startRecallItem("胡", RECALL_CUE_PLAIN)).strokesDrawn).toBe(0);
  });
});

describe("review ladder", () => {
  it("promotes, keeps and demotes", () => {
    const start = introduceItem("木", 1000);
    expect(start).toEqual({ item: "木", level: 0, dueAt: 1000 });
    const up = reviewItem(start, 0, 2000);
    expect(up).toEqual({ item: "木", level: 1, dueAt: 2000 + 180_000 });
    expect(reviewItem(up, 1, 0).level).toBe(1);
    expect(reviewItem(up, 2, 0).level).toBe(0);
    expect(reviewItem(start, 5, 0).level).toBe(0);
    const top = { item: "木", level: DEFAULT_LADDER.intervalsMs.length - 1, dueAt: 0 };
    expect(reviewItem(top, 0, 0).level).toBe(top.level);
  });

  it("brings a level from outside the ladder back onto it", () => {
    const top = DEFAULT_LADDER.intervalsMs.length - 1;
    // One mistake keeps the rung, so only the clamp can move these.
    expect(reviewItem({ item: "木", level: 42, dueAt: 0 }, 1, 1000)).toEqual({
      item: "木",
      level: top,
      dueAt: 1000 + DEFAULT_LADDER.intervalsMs[top]!,
    });
    expect(reviewItem({ item: "木", level: -3, dueAt: 0 }, 1, 1000).level).toBe(0);
    expect(reviewItem({ item: "木", level: Number.NaN, dueAt: 0 }, 1, 1000).level).toBe(0);
    expect(reviewItem({ item: "木", level: 42, dueAt: 0 }, 5, 1000).level).toBe(top - 1);
  });

  it("lists due items, most overdue first", () => {
    const items = [
      { item: "a", level: 0, dueAt: 50 },
      { item: "b", level: 0, dueAt: 10 },
      { item: "c", level: 0, dueAt: 500 },
    ];
    expect(dueItems(items, 100).map((i) => i.item)).toEqual(["b", "a"]);
  });
});
