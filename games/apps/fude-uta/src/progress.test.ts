import type { LearnState, TimedItemResult } from "@kankyouken/mechanics/scaffold";
import { PLAN_ARROWS, PLAN_GUIDED_FADE, applyAttempt, finishDemo, startLearning } from "@kankyouken/mechanics/scaffold";
import { describe, expect, it } from "vitest";
import { countMistakes, formatDuration, planPips, sanitizeStars, stageLabel, stageTask, starsFor, withStars } from "./progress";

const result = (item: string, mistakes: number): TimedItemResult => ({ item, strokeCount: 3, mistakes, durationMs: 2000, points: 30 });

describe("starsFor", () => {
  it("gives three stars for a round without mistakes", () => {
    expect(starsFor([result("一", 0), result("十", 0)])).toBe(3);
  });

  it("gives two stars up to one mistake per character on average", () => {
    expect(starsFor([result("一", 1), result("十", 0)])).toBe(2);
    expect(starsFor([result("一", 2), result("十", 0)])).toBe(2);
  });

  it("gives one star beyond that", () => {
    expect(starsFor([result("一", 3), result("十", 0)])).toBe(1);
  });

  it("counts mistakes over the whole round", () => {
    expect(countMistakes([result("一", 3), result("十", 2)])).toBe(5);
    expect(countMistakes([])).toBe(0);
  });
});

describe("stored stars", () => {
  it("drops everything that is not 1, 2 or 3", () => {
    expect(sanitizeStars({ a: 3, b: 0, c: "2", d: 4, e: 1 })).toEqual({ a: 3, e: 1 });
    expect(sanitizeStars(null)).toEqual({});
    expect(sanitizeStars("x")).toEqual({});
  });

  it("keeps the best result per lesson", () => {
    expect(withStars({ a: 2 }, "a", 1)).toEqual({ a: 2 });
    expect(withStars({ a: 2 }, "a", 3)).toEqual({ a: 3 });
    expect(withStars({ a: 2 }, "b", 1)).toEqual({ a: 2, b: 1 });
  });
});

describe("stages", () => {
  it("names stages for telemetry", () => {
    expect(PLAN_GUIDED_FADE.stages.map(stageTask)).toEqual(["demo", "trace:dotted", "trace:none"]);
    expect(PLAN_ARROWS.stages.map(stageTask)).toEqual(["demo", "trace:arrows", "trace:outline"]);
  });

  it("has an instruction for every stage of every guide", () => {
    for (const stage of [...PLAN_GUIDED_FADE.stages, ...PLAN_ARROWS.stages]) expect(stageLabel(stage)).not.toBe("");
  });
});

describe("planPips", () => {
  const states = (state: LearnState): string => planPips(PLAN_GUIDED_FADE, state).map((pip) => pip.state[0]).join("");

  it("has one pip per demo and per repetition", () => {
    const pips = planPips(PLAN_GUIDED_FADE, startLearning(PLAN_GUIDED_FADE).state);
    expect(pips).toHaveLength(6);
    expect(pips.map((pip) => pip.startsStage)).toEqual([true, true, false, true, false, false]);
  });

  it("follows the learner through the plan", () => {
    let state = startLearning(PLAN_GUIDED_FADE).state;
    expect(states(state)).toBe("cttttt");
    state = finishDemo(state, PLAN_GUIDED_FADE).state;
    expect(states(state)).toBe("dctttt");
    state = applyAttempt(state, PLAN_GUIDED_FADE, 1, "correct").state;
    expect(states(state)).toBe("ddcttt");
    state = applyAttempt(state, PLAN_GUIDED_FADE, 1, "miss").state;
    expect(states(state)).toBe("ddcttt");
    for (let i = 0; i < 4; i++) state = applyAttempt(state, PLAN_GUIDED_FADE, 1, "correct").state;
    expect(state.done).toBe(true);
    expect(states(state)).toBe("dddddd");
  });
});

describe("formatDuration", () => {
  it("shows minutes, seconds and tenths", () => {
    expect(formatDuration(0)).toBe("0:00.0");
    expect(formatDuration(9_449)).toBe("0:09.4");
    expect(formatDuration(67_400)).toBe("1:07.4");
    expect(formatDuration(600_000)).toBe("10:00.0");
  });

  it("never goes below zero", () => {
    expect(formatDuration(-50)).toBe("0:00.0");
  });
});
