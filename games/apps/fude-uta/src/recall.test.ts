import { RECALL_CUE_PLAIN, RECALL_CUE_WITH_MELODY, recallListened, startRecallItem } from "@kankyouken/mechanics/scaffold";
import { scoreFreeWriting } from "@kankyouken/mechanics/stroke";
import { describe, expect, it } from "vitest";
import { glyphOf, loadContent } from "./content";
import { isPerfectRecall, recallCueFor, recallResultData, recallRow } from "./recall";

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
    expect(recallResultData(score, state, 5432.2, "melody")).toEqual({
      correct: true,
      response_time_ms: 5432,
      stroke_count: 4,
      drawn_count: 4,
      order_correct: 4,
      direction_correct: 4,
      order_relative: 4,
      melody_listens: 2,
      audio_mode: "melody",
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
    const data = recallResultData(score, startRecallItem("木", RECALL_CUE_PLAIN), 900, "silent");
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
    });
  });
});
