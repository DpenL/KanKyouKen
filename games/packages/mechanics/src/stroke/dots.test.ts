import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { distance, type Point } from "../util/geometry";
import { createRng } from "../util/rng";
import {
  createDotTrace,
  DEFAULT_DOT_RADIUS,
  DEFAULT_DOT_SPACING,
  DEFAULT_MIN_COVERAGE,
  feedDotSegment,
  feedDotTrace,
  layoutDots,
  liftDotTrace,
  scoreDotCoverage,
} from "./dots";
import { glyphOf, penAlong } from "./test-helpers";
import type { DotHit, DotTraceOptions, DotTraceState, DotTrack, StrokeSample } from "./types";

const SIZE = 1000;
const ORDERED: DotTraceOptions = { mode: "ordered" };
const FREE: DotTraceOptions = { mode: "free" };

const tree = fixture("木");
const treeTracks = layoutDots(tree);
const ends = (stroke: number): [Point, Point] => {
  const median = tree.strokes[stroke]!.median;
  return [median[0]!, median[median.length - 1]!];
};

/** Feed a whole pen gesture, segment by segment, and merge what happened. */
function sweep(
  state: DotTraceState,
  tracks: readonly DotTrack[],
  pen: readonly StrokeSample[],
  options: DotTraceOptions,
  size = SIZE,
): { state: DotTraceState; hits: DotHit[]; completedStrokes: number[] } {
  let current = state;
  const hits: DotHit[] = [];
  const completedStrokes: number[] = [];
  for (let i = 1; i < pen.length; i++) {
    const step = feedDotSegment(current, tracks, pen[i - 1]!, pen[i]!, size, options);
    current = step.state;
    hits.push(...step.hits);
    completedStrokes.push(...step.completedStrokes);
  }
  return { state: current, hits, completedStrokes };
}

/** A free pass over a glyph: strokes in the given order, some of them backwards. */
function freePass(
  char: string,
  order: readonly number[],
  options: { reversed?: readonly number[]; sloppiness?: number; radius?: number; seed?: string } = {},
): { state: DotTraceState; tracks: DotTrack[] } {
  const glyph = fixture(char);
  const tracks = layoutDots(glyph);
  const rng = createRng(options.seed ?? char);
  let state = createDotTrace(tracks);
  for (const stroke of order) {
    const pen = penAlong(glyph.strokes[stroke]!.median, {
      sloppiness: options.sloppiness ?? 0,
      rng,
      reverse: options.reversed?.includes(stroke) ?? false,
    });
    state = sweep(state, tracks, pen, { mode: "free", radius: options.radius }, glyph.size).state;
  }
  return { state, tracks };
}

function deepFreeze(state: DotTraceState): DotTraceState {
  state.touched.forEach((row) => Object.freeze(row));
  Object.freeze(state.touched);
  Object.freeze(state.log);
  return Object.freeze(state);
}

/** Two short collinear strokes in a 100-unit square; the second starts where the first ends. */
const chain: DotTrack[] = [
  { stroke: 0, dots: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  { stroke: 1, dots: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
];

describe("layoutDots", () => {
  it("spaces dots evenly from the start of each stroke to its end", () => {
    expect(DEFAULT_DOT_SPACING).toBe(0.07);
    expect(treeTracks.map((t) => t.stroke)).toEqual([0, 1, 2, 3]);
    // 800 / 70 rounds to 11 gaps; the 570-long diagonals get 8.
    expect(treeTracks.map((t) => t.dots.length)).toEqual([12, 12, 9, 9]);
    treeTracks.forEach((track, stroke) => {
      const [start, end] = ends(stroke);
      expect(track.dots[0]).toEqual(start);
      expect(track.dots[track.dots.length - 1]).toEqual(end);
      const gaps = track.dots.slice(1).map((dot, i) => distance(dot, track.dots[i]!));
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6);
    });
    expect(distance(treeTracks[0]!.dots[0]!, treeTracks[0]!.dots[1]!)).toBeCloseTo(800 / 11, 6);
  });

  it("follows corners", () => {
    const corner = layoutDots(fixture("口"))[1]!;
    expect(corner.dots).toHaveLength(18);
    expect(corner.dots[0]).toEqual({ x: 200, y: 200 });
    expect(corner.dots[17]).toEqual({ x: 800, y: 800 });
    for (const dot of corner.dots) expect(Math.min(Math.abs(dot.y - 200), Math.abs(dot.x - 800))).toBeCloseTo(0, 6);
  });

  it("honours spacing and minDots, and never gives fewer than two dots", () => {
    const ten = fixture("十");
    expect(layoutDots(ten, { spacing: 0.2 })[0]!.dots).toHaveLength(5);
    expect(layoutDots(ten, { spacing: 2 })[0]!.dots).toEqual([{ x: 100, y: 450 }, { x: 900, y: 450 }]);
    expect(layoutDots(ten, { spacing: 0.2, minDots: 6 })[0]!.dots).toHaveLength(6);
    expect(layoutDots(ten, { spacing: 0.2, minDots: 3 })[0]!.dots).toHaveLength(5);
    expect(layoutDots(ten, { spacing: 2, minDots: 1 })[0]!.dots).toHaveLength(2);
    expect(layoutDots(ten, { spacing: 2, minDots: 3.7 })[0]!.dots).toHaveLength(3);
    expect(layoutDots(ten, { spacing: 2, minDots: NaN })[0]!.dots).toHaveLength(2);
  });

  it("scales with the glyph size", () => {
    const small = glyphOf(109, [[10, 50], [90, 50]]);
    expect(layoutDots(small)[0]!.dots).toHaveLength(Math.round(80 / (0.07 * 109)) + 1);
  });

  it("handles a glyph without strokes and a stroke without length", () => {
    expect(layoutDots(glyphOf(1000))).toEqual([]);
    expect(layoutDots(glyphOf(1000, [[5, 5], [5, 5]]))).toEqual([{ stroke: 0, dots: [{ x: 5, y: 5 }, { x: 5, y: 5 }] }]);
  });

  it("rejects a spacing or glyph size that is not positive and finite", () => {
    for (const spacing of [0, -0.1, NaN, Infinity]) expect(() => layoutDots(tree, { spacing })).toThrow(RangeError);
    expect(() => layoutDots(glyphOf(0, [[0, 0], [1, 1]]))).toThrow(RangeError);
  });
});

describe("createDotTrace", () => {
  it("starts with nothing touched and the first stroke current", () => {
    const state = createDotTrace(treeTracks);
    expect(state.touched.map((row) => row.length)).toEqual([12, 12, 9, 9]);
    expect(state.touched.flat().some(Boolean)).toBe(false);
    expect(state).toMatchObject({ currentStroke: 0, log: [], complete: false });
  });

  it("is complete from the start when there is nothing to trace", () => {
    expect(createDotTrace([])).toEqual({ touched: [], currentStroke: 0, log: [], complete: true });
    expect(createDotTrace([{ stroke: 0, dots: [] }])).toMatchObject({ currentStroke: 1, complete: true });
  });

  it("skips tracks without dots", () => {
    const state = createDotTrace([{ stroke: 0, dots: [] }, { stroke: 1, dots: [{ x: 1, y: 1 }] }]);
    expect(state).toMatchObject({ currentStroke: 1, complete: false });
  });

  it("survives a JSON round trip", () => {
    const [start, end] = ends(0);
    const state = sweep(createDotTrace(treeTracks), treeTracks, [start, { x: 500, y: 350, t: 5 }, end], ORDERED).state;
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("ordered tracing", () => {
  it("touches the start dot first and returns a new state", () => {
    const before = deepFreeze(createDotTrace(treeTracks));
    const step = feedDotTrace(before, treeTracks, { x: 110, y: 345 }, SIZE, ORDERED);
    expect(step.hits).toEqual([{ stroke: 0, dot: 0 }]);
    expect(step.completedStrokes).toEqual([]);
    expect(step.state).not.toBe(before);
    expect(step.state.touched[0]![0]).toBe(true);
    expect(step.state.log).toEqual([{ stroke: 0, dot: 0 }]);
    expect(step.state.currentStroke).toBe(0);
    expect(before.touched[0]![0]).toBe(false);
    expect(before.log).toEqual([]);
    // Rows that did not change are shared, not copied.
    expect(step.state.touched[1]).toBe(before.touched[1]);
  });

  it("uses a default radius of 0.06 of the glyph", () => {
    expect(DEFAULT_DOT_RADIUS).toBe(0.06);
    const state = createDotTrace(treeTracks);
    expect(feedDotTrace(state, treeTracks, { x: 100, y: 405 }, SIZE, ORDERED).hits).toHaveLength(1);
    expect(feedDotTrace(state, treeTracks, { x: 100, y: 415 }, SIZE, ORDERED).hits).toHaveLength(0);
    expect(feedDotTrace(state, treeTracks, { x: 100, y: 415 }, SIZE, { mode: "ordered", radius: 0.07 }).hits).toHaveLength(1);
  });

  it("counts a pen exactly on the edge of the radius", () => {
    const state = createDotTrace(chain);
    const options: DotTraceOptions = { mode: "ordered", radius: 0.5 };
    expect(feedDotTrace(state, chain, { x: 0, y: 50 }, 100, options).hits).toEqual([{ stroke: 0, dot: 0 }]);
    expect(feedDotTrace(state, chain, { x: 0, y: 50.001 }, 100, options).hits).toEqual([]);
  });

  it("ignores a pen on a later dot, on another stroke, or far away", () => {
    const state = createDotTrace(treeTracks);
    for (const sample of [treeTracks[0]!.dots[3]!, treeTracks[0]!.dots[11]!, treeTracks[1]!.dots[0]!, { x: 950, y: 950 }]) {
      const step = feedDotTrace(state, treeTracks, sample, SIZE, ORDERED);
      expect(step.hits).toEqual([]);
      expect(step.state).toBe(state);
    }
  });

  it("touches several consecutive dots with one sample when all are in reach", () => {
    const step = feedDotTrace(createDotTrace(treeTracks), treeTracks, { x: 100, y: 350 }, SIZE, {
      mode: "ordered",
      radius: 0.2,
    });
    expect(step.hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 0, dot: 1 },
      { stroke: 0, dot: 2 },
    ]);
    expect(step.state.touched[0]!.slice(0, 4)).toEqual([true, true, true, false]);
  });

  it("stamps hits with the time of the sample", () => {
    const step = feedDotTrace(createDotTrace(treeTracks), treeTracks, { x: 100, y: 350, t: 1234 }, SIZE, ORDERED);
    expect(step.hits).toEqual([{ stroke: 0, dot: 0, t: 1234 }]);
    expect(step.state.log).toEqual([{ stroke: 0, dot: 0, t: 1234 }]);
  });

  it("completes a stroke at its last dot and moves on to the next", () => {
    let state = createDotTrace(treeTracks);
    const counts = [12, 12, 9, 9];
    for (let stroke = 0; stroke < 4; stroke++) {
      const [start, end] = ends(stroke);
      const step = feedDotSegment(state, treeTracks, start, end, SIZE, ORDERED);
      expect(step.hits.map((h) => h.dot)).toEqual(Array.from({ length: counts[stroke]! }, (_, d) => d));
      expect(step.hits.every((h) => h.stroke === stroke)).toBe(true);
      expect(step.completedStrokes).toEqual([stroke]);
      expect(step.state.currentStroke).toBe(stroke + 1);
      expect(step.state.complete).toBe(stroke === 3);
      state = step.state;
    }
    expect(state.touched.flat().every(Boolean)).toBe(true);
    expect(state.log).toHaveLength(42);
    expect(state.currentStroke).toBe(treeTracks.length);
  });

  it("does nothing once the trace is complete", () => {
    let state = createDotTrace(treeTracks);
    for (let stroke = 0; stroke < 4; stroke++) state = feedDotSegment(state, treeTracks, ...ends(stroke), SIZE, ORDERED).state;
    const step = feedDotSegment(state, treeTracks, ...ends(0), SIZE, ORDERED);
    expect(step).toEqual({ state, hits: [], completedStrokes: [] });
    expect(step.state).toBe(state);
    expect(feedDotTrace(state, treeTracks, ends(0)[0], SIZE, ORDERED).state).toBe(state);
  });

  it("does not let a stroke be traced from its end", () => {
    const [start, end] = ends(0);
    const step = feedDotSegment(createDotTrace(treeTracks), treeTracks, end, start, SIZE, ORDERED);
    // Nothing lights until the pen arrives at the start dot; the second dot is then
    // also in reach. The stroke is left unfinished and the lift clears it.
    expect(step.hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 0, dot: 1 },
    ]);
    expect(step.completedStrokes).toEqual([]);
    expect(liftDotTrace(step.state, treeTracks).abandonedStroke).toBe(0);
  });

  it("never reaches into the next stroke with the sample that completes one", () => {
    const options: DotTraceOptions = { mode: "ordered", radius: 0.5 };
    const step = feedDotTrace(createDotTrace(chain), chain, { x: 10, y: 0 }, 100, options);
    expect(step.hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 0, dot: 1 },
    ]);
    expect(step.completedStrokes).toEqual([0]);
    expect(step.state.currentStroke).toBe(1);
    expect(step.state.touched[1]).toEqual([false, false]);
  });

  it("copes with a state whose current stroke already has later dots lit", () => {
    const state: DotTraceState = { touched: [[false, true, false]], currentStroke: 0, log: [], complete: false };
    const track: DotTrack[] = [{ stroke: 0, dots: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }];
    const step = feedDotTrace(state, track, { x: 10, y: 0 }, 100, { mode: "ordered", radius: 0.15 });
    expect(step.hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 0, dot: 2 },
    ]);
    expect(step.completedStrokes).toEqual([0]);
    expect(step.state.complete).toBe(true);
  });

  it("rejects a state that was made for other tracks", () => {
    const state = createDotTrace(treeTracks);
    expect(() => feedDotTrace(state, chain, { x: 0, y: 0 }, 100, ORDERED)).toThrow(RangeError);
    expect(() => feedDotTrace(createDotTrace(chain), [chain[0]!, { stroke: 1, dots: [] }], { x: 0, y: 0 }, 100, FREE)).toThrow(
      RangeError,
    );
    expect(() => liftDotTrace(state, chain)).toThrow(RangeError);
    expect(() => scoreDotCoverage(state, chain)).toThrow(RangeError);
  });

  it("touches nothing with a radius or size that is not positive", () => {
    const state = createDotTrace(treeTracks);
    const onDot = { x: 100, y: 350 };
    expect(feedDotTrace(state, treeTracks, onDot, SIZE, { mode: "ordered", radius: -1 }).hits).toEqual([]);
    expect(feedDotTrace(state, treeTracks, onDot, SIZE, { mode: "ordered", radius: NaN }).hits).toEqual([]);
    expect(feedDotTrace(state, treeTracks, { x: 101, y: 350 }, 0, ORDERED).hits).toEqual([]);
    // A radius of zero still accepts an exact hit.
    expect(feedDotTrace(state, treeTracks, onDot, SIZE, { mode: "ordered", radius: 0 }).hits).toHaveLength(1);
  });
});

describe("feedDotSegment", () => {
  it("catches the dots a fast swipe would jump over", () => {
    const [start, end] = ends(0);
    const state = createDotTrace(treeTracks);
    const jumped = feedDotTrace(feedDotTrace(state, treeTracks, start, SIZE, ORDERED).state, treeTracks, end, SIZE, ORDERED);
    expect(jumped.state.touched[0]!.filter(Boolean)).toHaveLength(1);

    const swiped = feedDotSegment(state, treeTracks, start, end, SIZE, ORDERED);
    expect(swiped.hits).toHaveLength(12);
    expect(swiped.completedStrokes).toEqual([0]);
  });

  it("merges the steps: hits and completions in order, and the final state", () => {
    const step = feedDotSegment(createDotTrace(chain), chain, { x: 0, y: 0 }, { x: 20, y: 0 }, 100, { mode: "free", radius: 0.05 });
    expect(step.hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 0, dot: 1 },
      { stroke: 1, dot: 0 },
      { stroke: 1, dot: 1 },
    ]);
    expect(step.completedStrokes).toEqual([0, 1]);
    expect(step.state.complete).toBe(true);
    expect(step.state.log).toEqual(step.hits);
  });

  it("stops at the first completed stroke in ordered mode", () => {
    const options: DotTraceOptions = { mode: "ordered", radius: 0.05 };
    const first = feedDotSegment(createDotTrace(chain), chain, { x: 0, y: 0 }, { x: 20, y: 0 }, 100, options);
    expect(first.completedStrokes).toEqual([0]);
    expect(first.state.touched[1]).toEqual([false, false]);
    expect(first.state.currentStroke).toBe(1);
    // The next gesture traces the second stroke.
    const second = feedDotSegment(first.state, chain, { x: 10, y: 0 }, { x: 20, y: 0 }, 100, options);
    expect(second.completedStrokes).toEqual([1]);
    expect(second.state.complete).toBe(true);
  });

  it("interpolates the time stamps", () => {
    const from = { x: 0, y: 0, t: 100 };
    const to = { x: 20, y: 0, t: 300 };
    // Radius 5: eight steps of 2.5; the dot at x = 10 comes into reach at x = 5.
    const step = feedDotSegment(createDotTrace(chain), chain, from, to, 100, { mode: "free", radius: 0.05 });
    expect(step.hits.map((h) => h.t)).toEqual([100, 150, 150, 250]);
  });

  it("uses whichever time stamp exists when only one sample has one", () => {
    const options: DotTraceOptions = { mode: "free", radius: 0.05 };
    const late = feedDotSegment(createDotTrace(chain), chain, { x: 0, y: 0 }, { x: 20, y: 0, t: 300 }, 100, options);
    expect(late.hits.map((h) => h.t)).toEqual([undefined, 300, 300, 300]);
    const none = feedDotSegment(createDotTrace(chain), chain, { x: 0, y: 0 }, { x: 20, y: 0 }, 100, options);
    expect(none.hits.every((h) => !("t" in h))).toBe(true);
  });

  it("handles a pen that did not move, and feeding the same sample twice", () => {
    const state = createDotTrace(treeTracks);
    const [start] = ends(0);
    const still = feedDotSegment(state, treeTracks, start, start, SIZE, ORDERED);
    expect(still.hits).toEqual([{ stroke: 0, dot: 0 }]);
    const again = feedDotSegment(still.state, treeTracks, start, start, SIZE, ORDERED);
    expect(again.hits).toEqual([]);
    expect(again.state).toBe(still.state);
  });

  it("stays finite for absurd input", () => {
    const state = createDotTrace(chain);
    const options: DotTraceOptions = { mode: "free", radius: 0.05 };
    expect(feedDotSegment(state, chain, { x: 0, y: 0 }, { x: 1e12, y: 0 }, 100, options).hits.length).toBeGreaterThan(0);
    expect(feedDotSegment(state, chain, { x: 0, y: 0 }, { x: NaN, y: 0 }, 100, options).hits).toEqual([{ stroke: 0, dot: 0 }]);
    expect(feedDotSegment(state, chain, { x: 0, y: 0 }, { x: 20, y: 0 }, 100, { mode: "free", radius: 0 }).hits).toEqual([
      { stroke: 0, dot: 0 },
      { stroke: 1, dot: 1 },
    ]);
  });
});

describe("liftDotTrace", () => {
  const [start, end] = ends(0);
  const halfway = { x: 500, y: 350 };

  it("clears a stroke that was started but not finished", () => {
    const partial = deepFreeze(feedDotSegment(createDotTrace(treeTracks), treeTracks, start, halfway, SIZE, ORDERED).state);
    expect(partial.touched[0]!.filter(Boolean).length).toBeGreaterThan(3);

    const lifted = liftDotTrace(partial, treeTracks);
    expect(lifted.abandonedStroke).toBe(0);
    expect(lifted.state).not.toBe(partial);
    expect(lifted.state.touched[0]!.some(Boolean)).toBe(false);
    expect(lifted.state.currentStroke).toBe(0);
    expect(lifted.state.complete).toBe(false);
    // The log is history: the abandoned touches stay in it.
    expect(lifted.state.log).toEqual(partial.log);
    expect(partial.touched[0]!.some(Boolean)).toBe(true);
  });

  it("makes the player start the stroke again from its first dot", () => {
    const lifted = liftDotTrace(
      feedDotSegment(createDotTrace(treeTracks), treeTracks, start, halfway, SIZE, ORDERED).state,
      treeTracks,
    ).state;
    expect(feedDotSegment(lifted, treeTracks, halfway, end, SIZE, ORDERED).hits).toEqual([]);
    const retry = feedDotSegment(lifted, treeTracks, start, end, SIZE, ORDERED);
    expect(retry.completedStrokes).toEqual([0]);
    expect(retry.hits).toHaveLength(12);
  });

  it("changes nothing when the current stroke is untouched", () => {
    const fresh = createDotTrace(treeTracks);
    expect(liftDotTrace(fresh, treeTracks)).toEqual({ state: fresh, abandonedStroke: null });
    expect(liftDotTrace(fresh, treeTracks).state).toBe(fresh);

    const between = feedDotSegment(fresh, treeTracks, start, end, SIZE, ORDERED).state;
    const lifted = liftDotTrace(between, treeTracks);
    expect(lifted.abandonedStroke).toBeNull();
    expect(lifted.state).toBe(between);
    expect(lifted.state.touched[0]!.every(Boolean)).toBe(true);
  });

  it("changes nothing when the trace is complete or empty", () => {
    let state = createDotTrace(treeTracks);
    for (let stroke = 0; stroke < 4; stroke++) state = feedDotSegment(state, treeTracks, ...ends(stroke), SIZE, ORDERED).state;
    expect(liftDotTrace(state, treeTracks)).toEqual({ state, abandonedStroke: null });
    const empty = createDotTrace([]);
    expect(liftDotTrace(empty, []).state).toBe(empty);
  });
});

describe("free tracing", () => {
  it("lights any dot of any stroke, in any order and direction", () => {
    let state = createDotTrace(treeTracks);
    const [start3, end3] = ends(3);
    const step = feedDotSegment(state, treeTracks, end3, start3, SIZE, FREE);
    expect(step.completedStrokes).toContain(3);
    expect(step.state.touched[3]!.every(Boolean)).toBe(true);
    // Stroke 3 starts on the crossing, so its own gesture also lights dots of the others.
    expect(new Set(step.hits.map((h) => h.stroke)).size).toBeGreaterThan(1);
    // currentStroke is the lowest stroke that still has dark dots.
    expect(step.state.currentStroke).toBe(0);
    expect(step.state.complete).toBe(false);

    state = step.state;
    for (const stroke of [1, 0, 2]) state = feedDotSegment(state, treeTracks, ...ends(stroke), SIZE, FREE).state;
    expect(state.complete).toBe(true);
    expect(state.currentStroke).toBe(4);
    expect(state.log).toHaveLength(42);
    expect(new Set(state.log.map((h) => `${h.stroke}:${h.dot}`)).size).toBe(42);
  });

  it("never lights a dot twice", () => {
    const first = feedDotSegment(createDotTrace(treeTracks), treeTracks, ...ends(0), SIZE, FREE);
    const second = feedDotSegment(first.state, treeTracks, ...ends(0), SIZE, FREE);
    expect(second.hits).toEqual([]);
    expect(second.state).toBe(first.state);
  });

  it("logs the dots caught by one sample nearest first", () => {
    const options: DotTraceOptions = { mode: "free", radius: 0.08 };
    const nearEnd = feedDotTrace(createDotTrace(chain), chain, { x: 17, y: 0 }, 100, options);
    expect(nearEnd.hits).toEqual([
      { stroke: 1, dot: 1 },
      { stroke: 0, dot: 1 },
      { stroke: 1, dot: 0 },
    ]);
    expect(nearEnd.completedStrokes).toEqual([1]);
    expect(nearEnd.state.currentStroke).toBe(0);
  });

  it("reports the strokes completed by one sample in the order they were completed", () => {
    const step = feedDotTrace(createDotTrace(chain), chain, { x: 12, y: 0 }, 100, { mode: "free", radius: 0.5 });
    expect(step.hits).toHaveLength(4);
    expect(step.completedStrokes).toEqual([1, 0]);
    expect(step.state.complete).toBe(true);
    expect(feedDotTrace(step.state, chain, { x: 12, y: 0 }, 100, FREE).state).toBe(step.state);
  });
});

describe("scoreDotCoverage", () => {
  it("scores an untouched state as nothing covered", () => {
    expect(DEFAULT_MIN_COVERAGE).toBe(0.6);
    const score = scoreDotCoverage(createDotTrace(treeTracks), treeTracks);
    expect(score).toMatchObject({ strokeCount: 4, covered: 0, orderCorrect: 0, directionCorrect: 0 });
    expect(score.strokes).toEqual(
      [0, 1, 2, 3].map((stroke) => ({ stroke, coverage: 0, rank: null, orderOk: false, directionOk: false })),
    );
    expect(scoreDotCoverage(createDotTrace([]), [])).toEqual({
      strokeCount: 0,
      covered: 0,
      orderCorrect: 0,
      directionCorrect: 0,
      strokes: [],
    });
  });

  it("gives full marks to a free pass in canonical order, on every fixture", () => {
    for (const glyph of FIXTURES.values()) {
      const order = glyph.strokes.map((_, i) => i);
      const { state, tracks } = freePass(glyph.char, order);
      const count = glyph.strokes.length;
      expect(state.complete, glyph.char).toBe(true);
      expect(scoreDotCoverage(state, tracks), glyph.char).toMatchObject({
        strokeCount: count,
        covered: count,
        orderCorrect: count,
        directionCorrect: count,
      });
    }
  });

  it("is not fooled by dots that were lit in passing", () => {
    const { state, tracks } = freePass("木", [0, 1, 2, 3]);
    // The horizontal crosses the start of both diagonals before the vertical is drawn,
    // so the first touches come in the order 0, 2, 3, 1 ...
    const firstTouch = [0, 1, 2, 3].map((stroke) => state.log.findIndex((h) => h.stroke === stroke));
    expect(firstTouch[2]!).toBeLessThan(firstTouch[1]!);
    expect(firstTouch[3]!).toBeLessThan(firstTouch[1]!);
    // ... yet the strokes are ranked in the order they were written.
    expect(scoreDotCoverage(state, tracks).strokes.map((s) => s.rank)).toEqual([0, 1, 2, 3]);
  });

  it("recovers the order in which the strokes were written", () => {
    const { state, tracks } = freePass("木", [1, 0, 3, 2]);
    const score = scoreDotCoverage(state, tracks);
    expect(score.strokes.map((s) => s.rank)).toEqual([1, 0, 3, 2]);
    expect(score.orderCorrect).toBe(0);
    expect(score.directionCorrect).toBe(4);

    const swapped = freePass("胡", [0, 1, 2, 3, 4, 6, 5, 7, 8]);
    const swappedScore = scoreDotCoverage(swapped.state, swapped.tracks);
    expect(swappedScore.orderCorrect).toBe(7);
    expect(swappedScore.strokes.filter((s) => !s.orderOk).map((s) => s.stroke)).toEqual([5, 6]);
  });

  it("recovers the direction of each stroke, also where strokes share their start", () => {
    for (let reversed = 0; reversed < 4; reversed++) {
      const { state, tracks } = freePass("木", [0, 1, 2, 3], { reversed: [reversed] });
      const score = scoreDotCoverage(state, tracks);
      expect(score.strokes.map((s) => s.directionOk), `stroke ${reversed}`).toEqual(
        [0, 1, 2, 3].map((stroke) => stroke !== reversed),
      );
      expect(score.directionCorrect).toBe(3);
      expect(score.orderCorrect).toBe(4);
    }
  });

  it("charges every later stroke for one that was left out", () => {
    const { state, tracks } = freePass("十", [1]);
    const score = scoreDotCoverage(state, tracks);
    // The vertical lit two of the horizontal's twelve dots on its way through.
    expect(score.strokes[0]).toMatchObject({ rank: null, orderOk: false, directionOk: false });
    expect(score.strokes[0]!.coverage).toBeCloseTo(2 / 12, 9);
    expect(score.strokes[1]).toEqual({ stroke: 1, coverage: 1, rank: 0, orderOk: false, directionOk: true });
    expect(score).toMatchObject({ covered: 1, orderCorrect: 0, directionCorrect: 1 });
  });

  it("counts a stroke as covered from 60% of its dots, or from minCoverage", () => {
    const track: DotTrack[] = [{ stroke: 0, dots: Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 })) }];
    const options: DotTraceOptions = { mode: "free", radius: 0.02 };
    const upTo = (x: number): DotTraceState =>
      feedDotSegment(createDotTrace(track), track, { x: 0, y: 0 }, { x, y: 0 }, 100, options).state;

    const five = scoreDotCoverage(upTo(40), track);
    expect(five.strokes[0]).toEqual({ stroke: 0, coverage: 0.5, rank: null, orderOk: false, directionOk: false });
    expect(five.covered).toBe(0);

    const six = scoreDotCoverage(upTo(50), track);
    expect(six.strokes[0]).toEqual({ stroke: 0, coverage: 0.6, rank: 0, orderOk: true, directionOk: true });
    expect(six).toMatchObject({ covered: 1, orderCorrect: 1, directionCorrect: 1 });

    expect(scoreDotCoverage(upTo(40), track, { minCoverage: 0.5 }).covered).toBe(1);
    expect(scoreDotCoverage(upTo(50), track, { minCoverage: 0.7 }).covered).toBe(0);
    expect(scoreDotCoverage(upTo(90), track, { minCoverage: 1 }).covered).toBe(1);
    // Even at zero a stroke needs one lit dot to count.
    expect(scoreDotCoverage(createDotTrace(track), track, { minCoverage: 0 }).covered).toBe(0);
  });

  describe("direction rule", () => {
    const three: DotTrack[] = [{ stroke: 0, dots: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }];
    const logged = (...dots: number[]): DotTraceState => ({
      touched: [[0, 1, 2].map((d) => dots.includes(d))],
      currentStroke: dots.length === 3 ? 1 : 0,
      log: dots.map((dot) => ({ stroke: 0, dot })),
      complete: dots.length === 3,
    });
    const forward = (...dots: number[]): boolean =>
      scoreDotCoverage(logged(...dots), three, { minCoverage: 0.3 }).strokes[0]!.directionOk;

    it("goes with the majority of moves between consecutive touches", () => {
      expect(forward(0, 1, 2)).toBe(true);
      expect(forward(2, 1, 0)).toBe(false);
      expect(forward(0, 2)).toBe(true);
      expect(forward(2, 0)).toBe(false);
    });

    it("lets the latest move decide a tie", () => {
      // The end dot was lit in passing, then the stroke was written forwards.
      expect(forward(2, 0, 1)).toBe(true);
      // The start dot was lit in passing, then the stroke was written backwards.
      expect(forward(0, 2, 1)).toBe(false);
      expect(forward(1, 0, 2)).toBe(true);
      expect(forward(1, 2, 0)).toBe(false);
    });

    it("cannot tell the direction from a single touch", () => {
      const score = scoreDotCoverage(logged(1), three, { minCoverage: 0.3 });
      expect(score.strokes[0]).toMatchObject({ rank: 0, orderOk: true, directionOk: false });
    });
  });

  it("ranks a stroke when it settled, ignoring one dot filled in late", () => {
    // Stroke 0 is written first but stops short of its last dot; stroke 1 is written;
    // only then is the missing dot of stroke 0 lit.
    const tracks: DotTrack[] = [
      { stroke: 0, dots: Array.from({ length: 5 }, (_, i) => ({ x: i * 10, y: 0 })) },
      { stroke: 1, dots: Array.from({ length: 5 }, (_, i) => ({ x: i * 10, y: 50 })) },
    ];
    const options: DotTraceOptions = { mode: "free", radius: 0.02 };
    let state = createDotTrace(tracks);
    state = feedDotSegment(state, tracks, { x: 0, y: 0 }, { x: 30, y: 0 }, 100, options).state;
    state = feedDotSegment(state, tracks, { x: 0, y: 50 }, { x: 40, y: 50 }, 100, options).state;
    state = feedDotTrace(state, tracks, { x: 40, y: 0 }, 100, options).state;
    expect(state.complete).toBe(true);
    expect(state.log[state.log.length - 1]).toEqual({ stroke: 0, dot: 4 });
    expect(scoreDotCoverage(state, tracks)).toMatchObject({ covered: 2, orderCorrect: 2, directionCorrect: 2 });
  });

  it("scores an ordered pass as perfect, abandoned attempts included", () => {
    let state = createDotTrace(treeTracks);
    const [start, end] = ends(0);
    state = feedDotSegment(state, treeTracks, start, { x: 600, y: 350 }, SIZE, ORDERED).state;
    state = liftDotTrace(state, treeTracks).state;
    for (let stroke = 0; stroke < 4; stroke++) {
      const [from, to] = stroke === 0 ? [start, end] : ends(stroke);
      state = feedDotSegment(state, treeTracks, from, to, SIZE, ORDERED).state;
      expect(liftDotTrace(state, treeTracks).abandonedStroke).toBeNull();
    }
    expect(state.complete).toBe(true);
    expect(state.log.length).toBeGreaterThan(42);
    expect(scoreDotCoverage(state, treeTracks)).toMatchObject({ covered: 4, orderCorrect: 4, directionCorrect: 4 });
  });

  it("ignores log entries whose dot is no longer lit", () => {
    const [start] = ends(0);
    const partial = feedDotSegment(createDotTrace(treeTracks), treeTracks, start, { x: 800, y: 350 }, SIZE, ORDERED).state;
    expect(scoreDotCoverage(partial, treeTracks).covered).toBe(1);
    const lifted = liftDotTrace(partial, treeTracks).state;
    expect(lifted.log.length).toBeGreaterThan(0);
    expect(scoreDotCoverage(lifted, treeTracks)).toMatchObject({ covered: 0, orderCorrect: 0, directionCorrect: 0 });
  });

  it("does not count a track without dots, and tolerates a state without a log", () => {
    const tracks: DotTrack[] = [{ stroke: 0, dots: [] }, { stroke: 1, dots: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }];
    const state: DotTraceState = { touched: [[], [true, true]], currentStroke: 2, log: [], complete: true };
    const score = scoreDotCoverage(state, tracks);
    expect(score.strokes[0]).toEqual({ stroke: 0, coverage: 0, rank: null, orderOk: false, directionOk: false });
    expect(score.strokes[1]).toEqual({ stroke: 1, coverage: 1, rank: null, orderOk: false, directionOk: false });
    expect(score.covered).toBe(1);
  });

  it("scores a human-looking free pass with a reversed stroke and a swap", () => {
    // 沐: the 氵 is written bottom-up (strokes 2, 1, 0), then 木 with its last stroke backwards.
    const { state, tracks } = freePass("沐", [2, 1, 0, 3, 4, 5, 6], { reversed: [6], sloppiness: 20, seed: "wobbly" });
    const score = scoreDotCoverage(state, tracks);
    expect(score.covered).toBe(7);
    expect(score.strokes.map((s) => s.rank)).toEqual([2, 1, 0, 3, 4, 5, 6]);
    expect(score.orderCorrect).toBe(5);
    expect(score.strokes.map((s) => s.directionOk)).toEqual([true, true, true, true, true, true, false]);
    expect(score.directionCorrect).toBe(6);
  });

  it("scores human-looking canonical passes over the crossing-heavy fixtures", () => {
    for (const char of ["十", "木", "古", "困", "林"]) {
      const glyph = fixture(char);
      const count = glyph.strokes.length;
      const { state, tracks } = freePass(char, glyph.strokes.map((_, i) => i), { sloppiness: 20, radius: 0.045 });
      expect(scoreDotCoverage(state, tracks), char).toMatchObject({
        covered: count,
        orderCorrect: count,
        directionCorrect: count,
      });
    }
  });
});
