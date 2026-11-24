import { judgeAttempt } from "@kankyouken/mechanics/stroke";
import type { AttemptResult } from "@kankyouken/mechanics/stroke";
import { describe, expect, it } from "vitest";
import type { AttemptContext } from "./attempts";
import { isStrayTap, openForWriting, recordAttempt, startItemClock } from "./attempts";
import { glyphOf, loadContent } from "./content";
import { LENIENCY } from "./settings";

const content = loadContent();
const tree = glyphOf(content, "木");

const judged = (stroke: number, expected: number, backwards = false): AttemptResult => {
  const median = tree.strokes[stroke]?.median ?? [];
  return judgeAttempt(backwards ? [...median].reverse() : median, tree, expected);
};

const context = (now: number, result: AttemptResult, drawMs = 300): AttemptContext => ({
  now,
  drawMs,
  result,
  hintLevel: 0,
  component: "木",
  guide: "dotted",
  audioMode: "melody",
});

describe("recordAttempt", () => {
  it("describes a first correct stroke", () => {
    const { clock, data } = recordAttempt(startItemClock(1000), context(1800, judged(0, 0), 412.6));
    expect(data).toEqual({
      correct: true,
      response_time_ms: 800,
      verdict: "correct",
      stroke_index: 0,
      resembles: 0,
      attempt: 1,
      draw_ms: 413,
      hint_level: 0,
      component: "木",
      guide: "dotted",
      audio_mode: "melody",
    });
    expect(clock).toEqual({ startedAt: 1000, awaitedSince: 1800, attemptsOnStroke: 0, mistakes: 0 });
  });

  it("numbers repeated attempts and measures them from the last accepted stroke", () => {
    let clock = startItemClock(0);
    clock = recordAttempt(clock, context(500, judged(0, 0))).clock;
    const wrong = recordAttempt(clock, context(900, judged(1, 1, true)));
    expect(wrong.data).toMatchObject({ correct: false, verdict: "wrong-direction", attempt: 1, response_time_ms: 400, stroke_index: 1 });
    const early = recordAttempt(wrong.clock, context(1300, judged(3, 1)));
    expect(early.data).toMatchObject({ correct: false, verdict: "wrong-order", attempt: 2, response_time_ms: 800, resembles: 3 });
    const right = recordAttempt(early.clock, context(2000, judged(1, 1)));
    expect(right.data).toMatchObject({ correct: true, attempt: 3, response_time_ms: 1500 });
    expect(right.clock).toEqual({ startedAt: 0, awaitedSince: 2000, attemptsOnStroke: 0, mistakes: 2 });
  });

  it("measures the first stroke from the moment the board opened, not from the start of the character", () => {
    // A 6 s demonstration, then the stroke 200 ms after the board opened.
    const afterDemo = openForWriting(startItemClock(0), 6000);
    const first = recordAttempt(afterDemo, context(6200, judged(0, 0)));
    expect(first.data.response_time_ms).toBe(200);
    expect(first.clock.startedAt).toBe(0);
    // The pause after a repetition is not the player's either; mistakes and the item start stay.
    const wrong = recordAttempt(first.clock, context(6500, judged(1, 1, true)));
    const afterPause = openForWriting(wrong.clock, 7150);
    expect(afterPause).toEqual({ startedAt: 0, awaitedSince: 7150, attemptsOnStroke: 1, mistakes: 1 });
    expect(recordAttempt(afterPause, context(7330, judged(1, 1))).data).toMatchObject({ response_time_ms: 180, attempt: 2 });
  });

  it("carries the hint level, guide and sound mode it is given", () => {
    const { data } = recordAttempt(startItemClock(0), {
      ...context(10, judged(0, 0)),
      hintLevel: 2,
      component: null,
      guide: "none",
      audioMode: "sfx",
    });
    expect(data).toMatchObject({ hint_level: 2, component: null, guide: "none", audio_mode: "sfx" });
  });
});

describe("isStrayTap", () => {
  it("ignores taps and tiny smudges", () => {
    expect(isStrayTap([{ x: 500, y: 500 }], 1000)).toBe(true);
    expect(isStrayTap([{ x: 500, y: 500 }, { x: 505, y: 503 }], 1000)).toBe(true);
  });

  it("lets every real stroke of the lesson characters through", () => {
    for (const lesson of content.lessons) {
      for (const char of lesson.chars) {
        const glyph = glyphOf(content, char);
        for (const stroke of glyph.strokes) expect(isStrayTap(stroke.median, glyph.size)).toBe(false);
      }
    }
  });
});

describe("judging the lesson characters", () => {
  it("accepts every stroke traced along its median, even when judging strictly", () => {
    for (const lesson of content.lessons) {
      for (const char of lesson.chars) {
        const glyph = glyphOf(content, char);
        glyph.strokes.forEach((stroke, index) => {
          const verdict = judgeAttempt(stroke.median, glyph, index, { match: { leniency: LENIENCY.strict } }).verdict;
          expect(verdict, `${char} stroke ${index + 1}`).toBe("correct");
        });
      }
    }
  });
});
