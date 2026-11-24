import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import type { Point } from "../util/geometry";
import { createRng } from "../util/rng";
import { DEFAULT_MATCH_OPTIONS, resolveMatchOptions } from "./defaults";
import { matchStroke, MATCH_SCORE_WEIGHTS } from "./match";
import { penAlong } from "./test-helpers";

const SIZE = 1000;
/** (100,450) -> (900,450) */
const horizontal = fixture("十").strokes[0]!.median;
const line = (...xy: number[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i]!, y: xy[i + 1]! });
  return out;
};

describe("resolveMatchOptions", () => {
  it("returns the documented defaults", () => {
    const expected = {
      leniency: 1,
      endpointTolerance: 0.2,
      averageDistanceTolerance: 0.12,
      minDirectionCosine: 0,
      shapeTolerance: 0.4,
      minLengthRatio: 0.4,
      maxLengthRatio: 1.6,
      resampleCount: 24,
    };
    expect(DEFAULT_MATCH_OPTIONS).toEqual(expected);
    expect(resolveMatchOptions()).toEqual(expected);
    expect(resolveMatchOptions({})).toEqual(expected);
  });

  it("overrides only the fields that are given and skips undefined ones", () => {
    const resolved = resolveMatchOptions({ leniency: 2, shapeTolerance: undefined });
    expect(resolved.leniency).toBe(2);
    expect(resolved.shapeTolerance).toBe(0.4);
    expect(resolved.endpointTolerance).toBe(0.2);
  });

  it("returns a new object and leaves the defaults alone", () => {
    const resolved = resolveMatchOptions({ leniency: 3 });
    expect(resolved).not.toBe(DEFAULT_MATCH_OPTIONS);
    expect(DEFAULT_MATCH_OPTIONS.leniency).toBe(1);
    expect(Object.isFrozen(DEFAULT_MATCH_OPTIONS)).toBe(true);
  });

  it("rounds resampleCount and keeps it at two or more", () => {
    expect(resolveMatchOptions({ resampleCount: 7.6 }).resampleCount).toBe(8);
    expect(resolveMatchOptions({ resampleCount: 1 }).resampleCount).toBe(2);
    expect(resolveMatchOptions({ resampleCount: -5 }).resampleCount).toBe(2);
  });

  it("accepts its own output", () => {
    const once = resolveMatchOptions({ leniency: 1.5, resampleCount: 10 });
    expect(resolveMatchOptions(once)).toEqual(once);
  });

  it("rejects a leniency that is not positive and finite, and values that are not numbers", () => {
    for (const leniency of [0, -1, Infinity, NaN]) {
      expect(() => resolveMatchOptions({ leniency })).toThrow(RangeError);
    }
    expect(() => resolveMatchOptions({ endpointTolerance: NaN })).toThrow(RangeError);
    expect(() => resolveMatchOptions({ resampleCount: Infinity })).toThrow(RangeError);
    expect(() => resolveMatchOptions({ shapeTolerance: "0.4" as unknown as number })).toThrow(RangeError);
  });
});

describe("matchStroke", () => {
  it("matches an exact trace with a score of one", () => {
    const match = matchStroke(penAlong(horizontal), horizontal, SIZE);
    expect(match).toMatchObject({ onStroke: true, directionOk: true, matched: true });
    expect(match.score).toBeCloseTo(1, 9);
    expect(match.metrics.startDistance).toBeCloseTo(0, 9);
    expect(match.metrics.endDistance).toBeCloseTo(0, 9);
    expect(match.metrics.averageDistance).toBeCloseTo(0, 9);
    expect(match.metrics.directionCosine).toBeCloseTo(1, 9);
    expect(match.metrics.shapeDistance).toBeCloseTo(0, 9);
    expect(match.metrics.lengthRatio).toBeCloseTo(1, 9);
  });

  it("sees a backwards stroke as on the stroke but in the wrong direction", () => {
    const match = matchStroke(penAlong(horizontal, { reverse: true }), horizontal, SIZE);
    expect(match).toMatchObject({ onStroke: true, directionOk: false, matched: false });
    expect(match.score).toBeCloseTo(1, 9);
  });

  it("reports the metrics of the stroke as drawn, not of the flipped one", () => {
    const { metrics } = matchStroke(penAlong(horizontal, { reverse: true }), horizontal, SIZE);
    expect(metrics.startDistance).toBeCloseTo(0.8, 9);
    expect(metrics.endDistance).toBeCloseTo(0.8, 9);
    expect(metrics.averageDistance).toBeCloseTo(0, 9);
    expect(metrics.directionCosine).toBeCloseTo(-1, 9);
    expect(metrics.shapeDistance).toBeCloseTo(2, 9);
    expect(metrics.lengthRatio).toBeCloseTo(1, 9);
  });

  it("applies the average distance tolerance to a parallel stroke", () => {
    const near = matchStroke(penAlong(horizontal, { dy: 100 }), horizontal, SIZE);
    expect(near.matched).toBe(true);
    expect(near.metrics.averageDistance).toBeCloseTo(0.1, 9);

    const far = matchStroke(penAlong(horizontal, { dy: 150 }), horizontal, SIZE);
    expect(far).toMatchObject({ onStroke: false, directionOk: false, matched: false });
    expect(far.metrics.averageDistance).toBeCloseTo(0.15, 9);
  });

  it("applies the endpoint tolerance to a stroke that stops early", () => {
    // Ends 0.12 short of the end: fine. Ends 0.24 short: not this stroke.
    const most = matchStroke(line(100, 450, 780, 450), horizontal, SIZE);
    expect(most.matched).toBe(true);
    expect(most.metrics.endDistance).toBeCloseTo(0.12, 9);

    const partial = matchStroke(line(100, 450, 660, 450), horizontal, SIZE);
    expect(partial.onStroke).toBe(false);
    expect(partial.metrics.endDistance).toBeCloseTo(0.24, 9);
    expect(partial.metrics.averageDistance).toBeCloseTo(0, 9);
  });

  it("rejects a stub by its length even when every position test passes", () => {
    const reference = line(300, 500, 600, 500);
    const stub = matchStroke(line(405, 500, 495, 500), reference, SIZE);
    expect(stub.metrics.lengthRatio).toBeCloseTo(0.3, 9);
    expect(stub.metrics.startDistance).toBeLessThan(0.2);
    expect(stub.metrics.endDistance).toBeLessThan(0.2);
    expect(stub.onStroke).toBe(false);
  });

  it("rejects a different shape drawn between the right end points", () => {
    const reference = line(400, 500, 600, 500);
    const peak = matchStroke(line(400, 500, 500, 300, 600, 500), reference, SIZE);
    expect(peak.metrics.startDistance).toBeCloseTo(0, 9);
    expect(peak.metrics.endDistance).toBeCloseTo(0, 9);
    expect(peak.metrics.averageDistance).toBeLessThan(0.12);
    expect(peak.metrics.shapeDistance).toBeGreaterThan(0.4);
    expect(peak.onStroke).toBe(false);
    // The peak is also 2.2 times as long as the stroke, so the length limit is lifted to see the shape test alone.
    const shapeOnly = { shapeTolerance: 0.6, maxLengthRatio: 3 };
    expect(matchStroke(line(400, 500, 500, 300, 600, 500), reference, SIZE, shapeOnly).matched).toBe(true);
  });

  /** A zigzag along the line: `turns` points, every other one `amplitude` to either side, ends on the line. */
  const zigzag = (along: readonly Point[], turns: number, amplitude: number): Point[] =>
    penAlong(along, { count: turns }).map((p, i) => ({
      x: p.x,
      y: p.y + (i === 0 || i === turns - 1 ? 0 : i % 2 === 0 ? -amplitude : amplitude),
    }));

  it("rejects a scribble over the stroke by its length", () => {
    // Two dozen turns reaching 15 % of the square to either side: nearly nine times the stroke's length.
    // Resampled to 24 points along its own length it looks like a straight line, so every other test passes.
    const scribble = zigzag(horizontal, 25, 150);
    for (const leniency of [1, 1.3, 1.6]) {
      const match = matchStroke(scribble, horizontal, SIZE, { leniency });
      expect(match.metrics.coarseLengthRatio, `leniency ${leniency}`).toBeGreaterThan(8);
      expect(match.onStroke, `leniency ${leniency}`).toBe(false);
      expect(matchStroke(scribble, horizontal, SIZE, { leniency, maxLengthRatio: Infinity }).matched).toBe(true);
    }
    // Other densities that pass every other test at the most forgiving of those levels.
    for (const [turns, amplitude] of [[12, 100], [36, 100], [47, 150], [48, 100], [71, 200], [96, 150]] as const) {
      const other = zigzag(horizontal, turns, amplitude);
      expect(matchStroke(other, horizontal, SIZE, { leniency: 1.6, maxLengthRatio: Infinity }).matched, `${turns} turns`).toBe(true);
      expect(matchStroke(other, horizontal, SIZE, { leniency: 1.6 }).onStroke, `${turns} turns`).toBe(false);
    }
  });

  it("does not take a trembling hand for a scribble", () => {
    // 160 turns of 1.2 % of the square: more than twice the stroke's length on paper, a thick line to the eye.
    const tremor = matchStroke(zigzag(horizontal, 160, 12), horizontal, SIZE);
    expect(tremor.metrics.lengthRatio).toBeGreaterThan(2);
    expect(tremor.metrics.coarseLengthRatio).toBeLessThan(1.2);
    expect(tremor.matched).toBe(true);
  });

  it("applies the length limit to a stroke drawn far too long, wider for short strokes", () => {
    // 0.3 long, drawn 0.54 long (1.8 times): each end is only 0.12 out, well inside the endpoint tolerance.
    const reference = line(350, 500, 650, 500);
    const long = line(230, 500, 770, 500);
    const strict = matchStroke(long, reference, SIZE);
    expect(strict.metrics.coarseLengthRatio).toBeCloseTo(1.8, 9);
    expect(strict.metrics.startDistance).toBeCloseTo(0.12, 9);
    expect(strict.onStroke).toBe(false);
    // Leniency widens the limit like every other tolerance: 1.6 * 1.3 = 2.08.
    expect(matchStroke(long, reference, SIZE, { leniency: 1.3 }).matched).toBe(true);

    // A dot 0.05 long may be drawn three times as long: its limit is 1.6 * 0.15 / 0.05 = 4.8.
    const dot = line(500, 500, 540, 530);
    const dab = line(460, 470, 580, 560);
    const match = matchStroke(dab, dot, SIZE);
    expect(match.metrics.coarseLengthRatio).toBeCloseTo(3, 9);
    expect(match.matched).toBe(true);
  });

  it("scales every tolerance with leniency", () => {
    const far = penAlong(horizontal, { dy: 150 });
    expect(matchStroke(far, horizontal, SIZE, { leniency: 2 }).matched).toBe(true);
    expect(matchStroke(penAlong(horizontal, { dy: 100 }), horizontal, SIZE, { leniency: 0.5 }).onStroke).toBe(false);

    // minLengthRatio is divided: 0.3 of the length passes once the bar drops to 0.4 / 1.5.
    const reference = line(300, 500, 600, 500);
    expect(matchStroke(line(405, 500, 495, 500), reference, SIZE, { leniency: 1.5 }).matched).toBe(true);

    // The shape tolerance too: the peak of the previous test passes at 0.4 * 1.5.
    const peak = line(400, 500, 500, 300, 600, 500);
    expect(matchStroke(peak, line(400, 500, 600, 500), SIZE, { leniency: 1.5 }).onStroke).toBe(true);
  });

  it("lets the direction cosine decide when a stroke fits both ways", () => {
    // A dot shorter than the endpoint tolerance; the shape test is disabled so that the
    // reversed drawing passes every position test in both directions.
    const dot = line(500, 500, 540, 530);
    const loose = { shapeTolerance: 10 };
    const forward = matchStroke(penAlong(dot, { count: 5 }), dot, SIZE, loose);
    expect(forward).toMatchObject({ onStroke: true, directionOk: true, matched: true });

    const backward = matchStroke(penAlong(dot, { count: 5, reverse: true }), dot, SIZE, loose);
    expect(backward.metrics.directionCosine).toBeCloseTo(-1, 9);
    expect(backward).toMatchObject({ onStroke: true, directionOk: false, matched: false });

    expect(matchStroke(penAlong(dot, { count: 5, reverse: true }), dot, SIZE, { ...loose, minDirectionCosine: -1 })).toMatchObject({
      onStroke: true,
      directionOk: true,
    });
  });

  it("still tells the direction of a dot with default options, through its shape", () => {
    const dot = line(500, 500, 540, 530);
    const backward = matchStroke(penAlong(dot, { count: 5, reverse: true }), dot, SIZE);
    expect(backward).toMatchObject({ onStroke: true, directionOk: false });
  });

  describe("score", () => {
    it("follows the documented formula", () => {
      const match = matchStroke(penAlong(horizontal, { dy: 100 }), horizontal, SIZE);
      const expected = 1 - (MATCH_SCORE_WEIGHTS.averageDistance * (0.1 / 0.12) + MATCH_SCORE_WEIGHTS.endpoints * (0.1 / 0.2));
      expect(match.score).toBeCloseTo(expected, 9);
    });

    it("has weights that sum to one, so a stroke on every tolerance scores zero", () => {
      expect(MATCH_SCORE_WEIGHTS.averageDistance + MATCH_SCORE_WEIGHTS.endpoints + MATCH_SCORE_WEIGHTS.shape).toBeCloseTo(1, 12);
    });

    it("falls as the drawing moves away and bottoms out at zero", () => {
      const scores = [0, 50, 100, 150, 400].map((dy) => matchStroke(penAlong(horizontal, { dy }), horizontal, SIZE).score);
      for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThan(scores[i - 1]!);
      expect(scores[scores.length - 1]).toBe(0);
    });

    it("is scaled down for a stroke shorter than required", () => {
      const reference = line(300, 500, 600, 500);
      const stub = matchStroke(line(405, 500, 495, 500), reference, SIZE);
      const closeness = 1 - MATCH_SCORE_WEIGHTS.endpoints * (0.105 / 0.2);
      expect(stub.score).toBeCloseTo(closeness * (0.3 / 0.4), 9);
    });

    it("is kept, not zeroed, for a stroke that misses narrowly", () => {
      const far = matchStroke(penAlong(horizontal, { dy: 150 }), horizontal, SIZE);
      expect(far.onStroke).toBe(false);
      expect(far.score).toBeGreaterThan(0);
    });

    it("grows with leniency for the same drawing", () => {
      const pen = penAlong(horizontal, { dy: 100 });
      expect(matchStroke(pen, horizontal, SIZE, { leniency: 2 }).score).toBeGreaterThan(
        matchStroke(pen, horizontal, SIZE).score,
      );
    });

    it("ranks the stroke that was drawn above its neighbours", () => {
      for (const glyph of FIXTURES.values()) {
        glyph.strokes.forEach((drawn, index) => {
          const scores = glyph.strokes.map((s) => matchStroke(penAlong(drawn.median), s.median, glyph.size).score);
          const best = scores.indexOf(Math.max(...scores));
          expect(best, `${glyph.char} stroke ${index}`).toBe(index);
        });
      }
    });
  });

  describe("degenerate input", () => {
    it("treats an empty drawing as unmeasurable", () => {
      const match = matchStroke([], horizontal, SIZE);
      expect(match).toMatchObject({ onStroke: false, directionOk: false, matched: false, score: 0 });
      expect(match.metrics).toEqual({
        startDistance: Infinity,
        endDistance: Infinity,
        averageDistance: Infinity,
        directionCosine: 0,
        shapeDistance: Infinity,
        lengthRatio: 0,
        coarseLengthRatio: 0,
      });
    });

    it("measures a single point from that point but never matches it", () => {
      const match = matchStroke([{ x: 100, y: 550 }], horizontal, SIZE);
      expect(match).toMatchObject({ onStroke: false, directionOk: false, matched: false, score: 0 });
      expect(match.metrics.startDistance).toBeCloseTo(0.1, 9);
      expect(match.metrics.endDistance).toBeCloseTo(Math.hypot(0.8, 0.1), 9);
      expect(match.metrics.averageDistance).toBeCloseTo(0.1, 9);
      expect(match.metrics.directionCosine).toBe(0);
      expect(match.metrics.lengthRatio).toBe(0);
      expect(Number.isFinite(match.metrics.shapeDistance)).toBe(true);
    });

    it("treats a pen that never moved like a single point, even on a dot", () => {
      const dot = line(500, 500, 540, 530);
      const tap = matchStroke([{ x: 520, y: 515 }, { x: 520, y: 515 }, { x: 520, y: 515 }], dot, SIZE);
      expect(tap).toMatchObject({ onStroke: false, matched: false, score: 0 });
      expect(tap.metrics.lengthRatio).toBe(0);
      expect(tap.metrics.averageDistance).toBeCloseTo(0, 9);
    });

    it("ignores pen positions that are not finite", () => {
      const pen = penAlong(horizontal);
      const dirty = [{ x: NaN, y: 450 }, ...pen.slice(0, 10), { x: 500, y: Infinity }, ...pen.slice(10)];
      expect(matchStroke(dirty, horizontal, SIZE)).toEqual(matchStroke(pen, horizontal, SIZE));
      expect(matchStroke([{ x: NaN, y: NaN }], horizontal, SIZE).metrics.startDistance).toBe(Infinity);
    });

    it("lets the position tests decide for a reference without length", () => {
      const point = line(500, 500, 500, 500);
      const near = matchStroke(line(490, 500, 510, 500), point, SIZE);
      expect(near.metrics.lengthRatio).toBe(1);
      expect(near.metrics.shapeDistance).toBe(0);
      expect(near).toMatchObject({ onStroke: true, directionOk: true, matched: true });
      expect(matchStroke(line(100, 100, 120, 100), point, SIZE).onStroke).toBe(false);
      expect(matchStroke(line(490, 500, 510, 500), [{ x: 500, y: 500 }], SIZE).matched).toBe(true);
    });

    it("throws for an empty reference, a bad size or bad options", () => {
      const pen = penAlong(horizontal);
      expect(() => matchStroke(pen, [], SIZE)).toThrow(RangeError);
      for (const size of [0, -1000, NaN, Infinity]) {
        expect(() => matchStroke(pen, horizontal, size)).toThrow(RangeError);
      }
      expect(() => matchStroke(pen, horizontal, SIZE, { leniency: 0 })).toThrow(RangeError);
    });

    it("works with two resample points and does not modify its input", () => {
      const pen = Object.freeze(penAlong(horizontal).map((p) => Object.freeze(p)));
      const reference = Object.freeze(horizontal.map((p) => Object.freeze({ ...p })));
      expect(matchStroke(pen, reference, SIZE, { resampleCount: 2 }).matched).toBe(true);
      expect(matchStroke(pen, reference, SIZE, { resampleCount: 1 }).matched).toBe(true);
    });
  });

  it("gives the same answer in any glyph size", () => {
    const scale = 109 / 1000;
    const shrink = (points: readonly Point[]): Point[] => points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const corner = fixture("口").strokes[1]!.median;
    const pen = penAlong(corner, { dx: 30, dy: -20 });
    const large = matchStroke(pen, corner, SIZE);
    const small = matchStroke(shrink(pen), shrink(corner), 109);
    expect(small.matched).toBe(large.matched);
    expect(small.score).toBeCloseTo(large.score, 9);
    expect(small.metrics.averageDistance).toBeCloseTo(large.metrics.averageDistance, 9);
    expect(small.metrics.shapeDistance).toBeCloseTo(large.metrics.shapeDistance, 9);
  });

  it("accepts a human-looking trace of every stroke of every fixture, forwards only", () => {
    for (const glyph of FIXTURES.values()) {
      const rng = createRng(`match:${glyph.char}`);
      glyph.strokes.forEach((stroke, index) => {
        const pen = penAlong(stroke.median, { sloppiness: 40, rng });
        const forward = matchStroke(pen, stroke.median, glyph.size);
        expect(forward.matched, `${glyph.char} stroke ${index}`).toBe(true);
        expect(forward.score).toBeGreaterThan(0.5);

        const backward = matchStroke([...pen].reverse(), stroke.median, glyph.size);
        expect(backward, `${glyph.char} stroke ${index} reversed`).toMatchObject({ onStroke: true, directionOk: false });
        expect(backward.score).toBeCloseTo(forward.score, 9);
      });
    }
  });

  it("does not confuse the hooked stroke of 月 with its neighbours", () => {
    const moon = fixture("月");
    const rng = createRng("moon");
    const pen = penAlong(moon.strokes[1]!.median, { count: 40, sloppiness: 30, rng });
    const results = moon.strokes.map((s) => matchStroke(pen, s.median, moon.size));
    expect(results.map((r) => r.onStroke)).toEqual([false, true, false, false]);
    expect(results[1]!.metrics.lengthRatio).toBeGreaterThan(0.85);
    expect(results[1]!.metrics.directionCosine).toBeGreaterThan(0.8);
  });
});
