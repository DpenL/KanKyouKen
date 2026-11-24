import { RECALL_CUE_PLAIN, RECALL_CUE_WITH_MELODY, recallListened, startRecallItem } from "@kankyouken/mechanics/scaffold";
import { judgeAttempt, scoreFreeWriting } from "@kankyouken/mechanics/stroke";
import { describe, expect, it } from "vitest";
import { glyphOf, loadContent } from "./content";
import { isPerfectRecall, recallCueFor, recallResultData, recallRow, scoreRecall } from "./recall";
import { LENIENCY } from "./settings";

const content = loadContent();
const tree = glyphOf(content, "木");
const medians = tree.strokes.map((stroke) => stroke.median);

describe("recallCueFor", () => {
  it("requires the melody only in the melody condition", () => {
    expect(recallCueFor("melody")).toBe(RECALL_CUE_WITH_MELODY);
    for (const mode of ["changing-melody", "sfx", "silent"] as const) expect(recallCueFor(mode)).toBe(RECALL_CUE_PLAIN);
  });
});

describe("scoring a recalled character", () => {
  it("is perfect when every stroke is there in order and direction", () => {
    const score = scoreFreeWriting(medians, tree);
    expect(isPerfectRecall(score)).toBe(true);
    const state = recallListened(recallListened(startRecallItem("木", RECALL_CUE_WITH_MELODY)));
    expect(recallResultData(score, state, 5432.2, "melody", "normal")).toEqual({
      correct: true,
      response_time_ms: 5432,
      stroke_count: 4,
      drawn_count: 4,
      order_correct: 4,
      direction_correct: 4,
      order_relative: 4,
      melody_listens: 2,
      audio_mode: "melody",
      judging: "normal",
      leniency: 1.3,
    });
  });

  it("is not perfect with a stroke missing, reversed or added", () => {
    const missing = scoreFreeWriting(medians.slice(0, 3), tree);
    expect(isPerfectRecall(missing)).toBe(false);
    const reversed = scoreFreeWriting([[...(medians[0] ?? [])].reverse(), ...medians.slice(1)], tree);
    expect(isPerfectRecall(reversed)).toBe(false);
    expect(reversed.directionCorrect).toBe(3);
    const extra = scoreFreeWriting([...medians, [{ x: 40, y: 40 }, { x: 90, y: 60 }]], tree);
    expect(isPerfectRecall(extra)).toBe(false);
  });

  it("reports an incomplete character as incorrect, with what was right", () => {
    const score = scoreFreeWriting(medians.slice(0, 2), tree);
    const data = recallResultData(score, startRecallItem("木", RECALL_CUE_PLAIN), 900, "silent", "strict");
    expect(data).toMatchObject({ correct: false, stroke_count: 4, drawn_count: 2, order_correct: 2, melody_listens: 0, audio_mode: "silent" });
  });

  it("summarises a character for the end-of-round table", () => {
    const score = scoreFreeWriting(medians.slice(0, 3), tree);
    expect(recallRow("木", "tree, wood", score)).toEqual({
      char: "木",
      meaning: "tree, wood",
      strokeCount: 4,
      orderCorrect: 3,
      directionCorrect: 3,
      extra: 0,
    });
  });

  it("tells the summary how many strokes were extra", () => {
    const stray = [
      { x: 40, y: 40 },
      { x: 90, y: 60 },
    ];
    const score = scoreFreeWriting([...medians, stray, stray.map((p) => ({ x: p.x + 800, y: p.y }))], tree);
    expect(recallRow("木", "tree, wood", score)).toMatchObject({ orderCorrect: 4, directionCorrect: 4, extra: 2 });
  });
});

describe("the judging level in the from-memory round", () => {
  const old = glyphOf(content, "古");
  /** Every stroke on its median, the whole character 15% of the square lower. */
  const low = old.strokes.map((stroke) => stroke.median.map((p) => ({ x: p.x, y: p.y + 0.15 * old.size })));

  it("accepts at Normal and Gentle what the learning stages accept there", () => {
    for (const judging of ["normal", "gentle"] as const) {
      low.forEach((drawn, index) => {
        expect(judgeAttempt(drawn, old, index, { match: { leniency: LENIENCY[judging] } }).verdict, `${judging} stroke ${index}`).toBe("correct");
      });
      const score = scoreRecall(low, old, judging);
      expect(score).toMatchObject({ orderCorrect: 5, directionCorrect: 5, extra: [], missing: [] });
      expect(isPerfectRecall(score)).toBe(true);
    }
  });

  it("is as strict as the learning stages at Strict", () => {
    const refused = low.filter((drawn, index) => judgeAttempt(drawn, old, index, { match: { leniency: LENIENCY.strict } }).verdict !== "correct");
    expect(refused.length).toBeGreaterThan(0);
    expect(isPerfectRecall(scoreRecall(low, old, "strict"))).toBe(false);
  });

  it("is recorded with the result", () => {
    const data = recallResultData(scoreRecall(low, old, "gentle"), startRecallItem("古", RECALL_CUE_PLAIN), 1200, "sfx", "gentle");
    expect(data).toMatchObject({ correct: true, judging: "gentle", leniency: LENIENCY.gentle });
  });
});
