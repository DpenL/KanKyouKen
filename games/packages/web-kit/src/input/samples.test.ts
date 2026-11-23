import { describe, expect, it } from "vitest";
import type { DrawnStroke } from "@kankyouken/mechanics/stroke";
import { DEFAULT_MIN_DISTANCE, appendSample, finishStroke } from "./samples";

describe("appendSample", () => {
  it("always keeps the first sample", () => {
    expect(appendSample([], { x: 5, y: 6, t: 1 }, 100)).toEqual([{ x: 5, y: 6, t: 1 }]);
  });

  it("keeps a sample that moved far enough and returns a new array", () => {
    const stroke: DrawnStroke = [{ x: 0, y: 0, t: 0 }];
    const next = appendSample(stroke, { x: 3, y: 4, t: 8 }, 5);
    expect(next).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 3, y: 4, t: 8 },
    ]);
    expect(next).not.toBe(stroke);
    expect(stroke).toHaveLength(1);
  });

  it("returns the same array when the pen barely moved", () => {
    const stroke: DrawnStroke = [{ x: 0, y: 0 }];
    expect(appendSample(stroke, { x: 3, y: 3.9 }, 5)).toBe(stroke);
    expect(appendSample(stroke, { x: 0, y: 0 }, 5)).toBe(stroke);
  });

  it("measures from the last KEPT sample, so slow movement still adds up", () => {
    let stroke: DrawnStroke = [{ x: 0, y: 0 }];
    for (let x = 1; x <= 10; x++) stroke = appendSample(stroke, { x, y: 0 }, 4);
    expect(stroke.map((s) => s.x)).toEqual([0, 4, 8]);
  });

  it("keeps everything when the distance is zero, negative or NaN", () => {
    const stroke: DrawnStroke = [{ x: 1, y: 1 }];
    expect(appendSample(stroke, { x: 1, y: 1 }, 0)).toHaveLength(2);
    expect(appendSample(stroke, { x: 1, y: 1 }, -3)).toHaveLength(2);
    expect(appendSample(stroke, { x: 1, y: 1 }, Number.NaN)).toHaveLength(2);
  });

  it("never keeps a position that is not finite", () => {
    const stroke: DrawnStroke = [{ x: 1, y: 1 }];
    expect(appendSample(stroke, { x: Number.NaN, y: 2 }, 0)).toBe(stroke);
    expect(appendSample([], { x: 2, y: Number.POSITIVE_INFINITY }, 0)).toEqual([]);
  });

  it("thins a densely sampled diagonal to the default spacing", () => {
    let stroke: DrawnStroke = [];
    for (let i = 0; i <= 100; i++) stroke = appendSample(stroke, { x: i, y: i, t: i }, DEFAULT_MIN_DISTANCE);
    expect(stroke[0]).toEqual({ x: 0, y: 0, t: 0 });
    for (let i = 1; i < stroke.length; i++) {
      const step = Math.hypot(stroke[i]!.x - stroke[i - 1]!.x, stroke[i]!.y - stroke[i - 1]!.y);
      expect(step).toBeGreaterThanOrEqual(DEFAULT_MIN_DISTANCE);
    }
    expect(stroke.length).toBeLessThan(40);
    expect(stroke.length).toBeGreaterThan(30);
  });
});

describe("finishStroke", () => {
  it("adds the final position however close it is", () => {
    const stroke: DrawnStroke = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 5 },
    ];
    const finished = finishStroke(stroke, { x: 10.5, y: 0, t: 9 });
    expect(finished[finished.length - 1]).toEqual({ x: 10.5, y: 0, t: 9 });
    expect(finished).toHaveLength(3);
    expect(stroke).toHaveLength(2);
  });

  it("does not repeat a final position the stroke already ends on", () => {
    const stroke: DrawnStroke = [{ x: 7, y: 7, t: 1 }];
    expect(finishStroke(stroke, { x: 7, y: 7, t: 30 })).toBe(stroke);
  });

  it("starts a stroke that has no samples yet", () => {
    expect(finishStroke([], { x: 1, y: 2 })).toEqual([{ x: 1, y: 2 }]);
  });

  it("ignores a final position that is not finite", () => {
    const stroke: DrawnStroke = [{ x: 7, y: 7 }];
    expect(finishStroke(stroke, { x: Number.NaN, y: Number.NaN })).toBe(stroke);
  });
});
