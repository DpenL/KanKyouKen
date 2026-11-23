import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import type { Point } from "../util/geometry";
import { createRng } from "../util/rng";
import { DEFAULT_MIN_ATTRIBUTION_SCORE, hungarian, longestIncreasingRun, scoreFreeWriting } from "./free";
import { matchStroke } from "./match";
import { glyphOf, penAlong } from "./test-helpers";

/** Best total over every way of pairing rows with distinct columns (min(rows, cols) pairs). */
function bruteForce(matrix: readonly (readonly number[])[], goal: "max" | "min"): number {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const pairs = Math.min(rows, cols);
  const better = goal === "max" ? Math.max : Math.min;
  const search = (row: number, used: ReadonlySet<number>, skipsLeft: number): number => {
    if (row === rows) return 0;
    let best = goal === "max" ? -Infinity : Infinity;
    if (skipsLeft > 0) best = better(best, search(row + 1, used, skipsLeft - 1));
    for (let col = 0; col < cols; col++) {
      if (used.has(col)) continue;
      best = better(best, matrix[row]![col]! + search(row + 1, new Set([...used, col]), skipsLeft));
    }
    return best;
  };
  return search(0, new Set(), rows - pairs);
}

const total = (matrix: readonly (readonly number[])[], assignment: readonly (number | null)[]): number =>
  assignment.reduce<number>((sum, col, row) => (col === null ? sum : sum + matrix[row]![col]!), 0);

describe("hungarian", () => {
  it("solves a small square problem both ways", () => {
    const matrix = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    expect(hungarian(matrix, "min")).toEqual([1, 0, 2]);
    expect(hungarian(matrix, "max")).toEqual([0, 2, 1]);
    expect(hungarian(matrix)).toEqual(hungarian(matrix, "max"));
  });

  it("leaves the weakest row out when there are more rows than columns", () => {
    const tall = [[1], [5], [3]];
    expect(hungarian(tall)).toEqual([null, 0, null]);
    expect(hungarian(tall, "min")).toEqual([0, null, null]);
  });

  it("uses the best columns when there are more columns than rows", () => {
    expect(hungarian([[1, 9, 3, 4]])).toEqual([1]);
    expect(
      hungarian([
        [7, 8, 1],
        [7, 2, 1],
      ]),
    ).toEqual([1, 0]);
  });

  it("prefers the best total over a greedy first pick", () => {
    // Greedy would give row 0 its 0.9 and leave row 1 with 0.1.
    expect(
      hungarian([
        [0.9, 0.8],
        [0.85, 0.1],
      ]),
    ).toEqual([1, 0]);
  });

  it("handles negative entries, ties and a single cell", () => {
    expect(hungarian([[-3]])).toEqual([0]);
    expect(
      hungarian(
        [
          [-1, -5],
          [-5, -1],
        ],
        "max",
      ),
    ).toEqual([0, 1]);
    const flat = hungarian([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    expect([...flat].sort()).toEqual([0, 1, 2]);
  });

  it("returns nothing to pair for empty input", () => {
    expect(hungarian([])).toEqual([]);
    expect(hungarian([[], []])).toEqual([null, null]);
  });

  it("rejects ragged rows and entries that are not finite", () => {
    expect(() => hungarian([[1, 2], [3]])).toThrow(RangeError);
    expect(() => hungarian([[1, NaN]])).toThrow(RangeError);
    expect(() => hungarian([[Infinity]])).toThrow(RangeError);
  });

  it("does not modify the matrix", () => {
    const matrix = Object.freeze([Object.freeze([3, 1]), Object.freeze([2, 4])]);
    expect(hungarian(matrix)).toEqual([0, 1]);
  });

  it("agrees with exhaustive search on random matrices of every small shape", () => {
    const rng = createRng("hungarian");
    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + rng.int(5);
      const cols = 1 + rng.int(5);
      // Coarse values make ties common.
      const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng.int(8) - 2));
      for (const goal of ["max", "min"] as const) {
        const assignment = hungarian(matrix, goal);
        const used = assignment.filter((col): col is number => col !== null);
        expect(assignment).toHaveLength(rows);
        expect(used).toHaveLength(Math.min(rows, cols));
        expect(new Set(used).size).toBe(used.length);
        expect(total(matrix, assignment), JSON.stringify({ matrix, goal })).toBe(bruteForce(matrix, goal));
      }
    }
  });
});

describe("longestIncreasingRun", () => {
  it("counts the longest increasing subsequence", () => {
    expect(longestIncreasingRun([])).toBe(0);
    expect(longestIncreasingRun([7])).toBe(1);
    expect(longestIncreasingRun([0, 1, 2, 3])).toBe(4);
    expect(longestIncreasingRun([3, 2, 1, 0])).toBe(1);
    expect(longestIncreasingRun([1, 0, 2, 3, 4, 5, 6, 7])).toBe(7);
    expect(longestIncreasingRun([4, 0, 5, 1, 6, 2, 3])).toBe(4);
  });

  it("does not count equal values as increasing", () => {
    expect(longestIncreasingRun([2, 2, 2])).toBe(1);
  });
});

describe("scoreFreeWriting", () => {
  const hu = fixture("胡");
  const exact = hu.strokes.map((s) => penAlong(s.median));
  const inOrder = (order: readonly number[]): Point[][] => order.map((i) => exact[i]!);

  it("gives full marks to a character written correctly", () => {
    const score = scoreFreeWriting(exact, hu);
    expect(score).toMatchObject({
      strokeCount: 9,
      drawnCount: 9,
      assignment: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      orderCorrect: 9,
      directionCorrect: 9,
      orderRelative: 9,
      missing: [],
      extra: [],
    });
    expect(score.strokes[4]).toEqual({ stroke: 4, drawnAt: 4, orderOk: true, directionOk: true });
  });

  it("scores the first two strokes swapped and the last one missing as 6 / 8 / 7", () => {
    const score = scoreFreeWriting(inOrder([1, 0, 2, 3, 4, 5, 6, 7]), hu);
    expect(score.assignment).toEqual([1, 0, 2, 3, 4, 5, 6, 7]);
    expect(score.orderCorrect).toBe(6);
    expect(score.directionCorrect).toBe(8);
    expect(score.orderRelative).toBe(7);
    expect(score.missing).toEqual([8]);
    expect(score.extra).toEqual([]);
    expect(score.strokes[0]).toEqual({ stroke: 0, drawnAt: 1, orderOk: false, directionOk: true });
    expect(score.strokes[1]).toEqual({ stroke: 1, drawnAt: 0, orderOk: false, directionOk: true });
    expect(score.strokes[8]).toEqual({ stroke: 8, drawnAt: null, orderOk: false, directionOk: false });
  });

  it("scores all nine in order with one drawn backwards as 9 / 8", () => {
    const drawn = exact.map((pen, i) => (i === 4 ? [...pen].reverse() : pen));
    const score = scoreFreeWriting(drawn, hu);
    expect(score.orderCorrect).toBe(9);
    expect(score.directionCorrect).toBe(8);
    expect(score.orderRelative).toBe(9);
    expect(score.strokes[4]).toEqual({ stroke: 4, drawnAt: 4, orderOk: true, directionOk: false });
    expect(score.missing).toEqual([]);
  });

  it("charges every later stroke for one omitted early, but keeps the relative order", () => {
    const score = scoreFreeWriting(inOrder([0, 2, 3, 4, 5, 6, 7, 8]), hu);
    expect(score.missing).toEqual([1]);
    expect(score.orderCorrect).toBe(1);
    expect(score.directionCorrect).toBe(8);
    expect(score.orderRelative).toBe(8);
  });

  it("measures a character written back to front", () => {
    const score = scoreFreeWriting(inOrder([8, 7, 6, 5, 4, 3, 2, 1, 0]), hu);
    expect(score.orderCorrect).toBe(1);
    expect(score.directionCorrect).toBe(9);
    expect(score.orderRelative).toBe(1);
  });

  it("sets stray marks aside without shifting the strokes after them", () => {
    const scribble: Point[] = [{ x: 20, y: 950 }, { x: 60, y: 990 }, { x: 30, y: 970 }];
    const tap: Point[] = [{ x: 250, y: 300 }];
    const drawn = [exact[0]!, scribble, exact[1]!, tap, [], ...exact.slice(2)];
    const score = scoreFreeWriting(drawn, hu);
    expect(score.drawnCount).toBe(12);
    expect(score.assignment).toEqual([0, null, 1, null, null, 2, 3, 4, 5, 6, 7, 8]);
    expect(score.extra).toEqual([1, 3, 4]);
    expect(score.orderCorrect).toBe(9);
    expect(score.directionCorrect).toBe(9);
    expect(score.strokes[2]!.drawnAt).toBe(2);
  });

  it("counts a stroke written twice once, and the weaker copy as extra", () => {
    const tree = fixture("木");
    const pens = tree.strokes.map((s) => penAlong(s.median));
    const wobbly = penAlong(tree.strokes[0]!.median, { dy: 40 });
    const score = scoreFreeWriting([wobbly, pens[0]!, pens[1]!, pens[2]!, pens[3]!], tree);
    expect(score.assignment).toEqual([null, 0, 1, 2, 3]);
    expect(score.extra).toEqual([0]);
    expect(score.orderCorrect).toBe(4);
  });

  it("returns zeros when nothing was drawn", () => {
    const score = scoreFreeWriting([], hu);
    expect(score).toMatchObject({
      strokeCount: 9,
      drawnCount: 0,
      assignment: [],
      orderCorrect: 0,
      directionCorrect: 0,
      orderRelative: 0,
      missing: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      extra: [],
    });
    expect(score.strokes).toHaveLength(9);
    expect(score.strokes.every((s) => s.drawnAt === null && !s.orderOk && !s.directionOk)).toBe(true);
  });

  it("makes every drawn stroke extra for a glyph without strokes", () => {
    const score = scoreFreeWriting([exact[0]!, exact[1]!], glyphOf(1000));
    expect(score).toMatchObject({ strokeCount: 0, drawnCount: 2, assignment: [null, null], extra: [0, 1], missing: [] });
    expect(score.strokes).toEqual([]);
  });

  describe("minScore", () => {
    const tree = fixture("木");
    const pens = tree.strokes.map((s) => penAlong(s.median));
    const loose = penAlong(tree.strokes[0]!.median, { dy: 60 });

    it("defaults to 0.35", () => {
      expect(DEFAULT_MIN_ATTRIBUTION_SCORE).toBe(0.35);
      const looseScore = matchStroke(loose, tree.strokes[0]!.median, tree.size).score;
      expect(looseScore).toBeGreaterThan(0.35);
      expect(looseScore).toBeLessThan(0.9);
      expect(scoreFreeWriting([loose, ...pens.slice(1)], tree).assignment).toEqual([0, 1, 2, 3]);
    });

    it("leaves a drawing unattributed when its best score is below the threshold", () => {
      const score = scoreFreeWriting([loose, ...pens.slice(1)], tree, { minScore: 0.9 });
      expect(score.assignment).toEqual([null, 1, 2, 3]);
      expect(score.missing).toEqual([0]);
      expect(score.extra).toEqual([0]);
      // Ranks ignore the extra stroke, so the rest sits one place early.
      expect(score.orderCorrect).toBe(0);
      expect(score.orderRelative).toBe(3);
    });

    it("never attributes a drawing to a stroke it does not lie on, even at zero", () => {
      const far = penAlong(tree.strokes[0]!.median, { dy: 150 });
      expect(matchStroke(far, tree.strokes[0]!.median, tree.size).score).toBeGreaterThan(0);
      const score = scoreFreeWriting([far], tree, { minScore: 0 });
      expect(score.assignment).toEqual([null]);
    });

    it("is applied before pairing, so two weak pairs cannot displace a good one", () => {
      // pen 0 is good for stroke 0 (0.70) and weak for stroke 1 (0.50); pen 1 is weak for
      // stroke 0 (0.50) and nowhere near stroke 1. The two weak pairs total more than the
      // good one, yet with a threshold of 0.6 only the good pair is eligible.
      const glyph = glyphOf(1000, [[200, 400], [800, 400]], [[200, 565], [800, 565]]);
      const rail = (y: number): Point[] => penAlong([{ x: 200, y }, { x: 800, y }]);
      const drawn = [rail(462), rail(297)];
      const score00 = matchStroke(drawn[0]!, glyph.strokes[0]!.median, 1000).score;
      const score01 = matchStroke(drawn[0]!, glyph.strokes[1]!.median, 1000).score;
      const score10 = matchStroke(drawn[1]!, glyph.strokes[0]!.median, 1000).score;
      expect(score00).toBeGreaterThan(0.6);
      expect(score01).toBeLessThan(0.6);
      expect(score10).toBeLessThan(0.6);
      expect(score01 + score10).toBeGreaterThan(score00);

      expect(scoreFreeWriting(drawn, glyph, { minScore: 0.6 }).assignment).toEqual([0, null]);
      expect(scoreFreeWriting(drawn, glyph).assignment).toEqual([1, 0]);
    });
  });

  it("passes the match options through", () => {
    const tree = fixture("木");
    const shifted = tree.strokes.map((s) => penAlong(s.median, { dx: 140 }));
    expect(scoreFreeWriting(shifted, tree).orderCorrect).toBeLessThan(4);
    expect(scoreFreeWriting(shifted, tree, { match: { leniency: 2 } })).toMatchObject({
      orderCorrect: 4,
      directionCorrect: 4,
    });
  });

  it("attributes by fit, not by drawing order, between twin components", () => {
    // 林 is 木 twice: the right tree written first must not be taken for the left one.
    const woods = fixture("林");
    const pens = woods.strokes.map((s) => penAlong(s.median));
    const score = scoreFreeWriting([...pens.slice(4), ...pens.slice(0, 4)], woods);
    expect(score.assignment).toEqual([4, 5, 6, 7, 0, 1, 2, 3]);
    expect(score.orderCorrect).toBe(0);
    expect(score.directionCorrect).toBe(8);
    expect(score.orderRelative).toBe(4);
  });

  it("scores every fixture written by a human-looking hand, with one stroke reversed", () => {
    for (const glyph of FIXTURES.values()) {
      const rng = createRng(`free:${glyph.char}`);
      const reversed = rng.int(glyph.strokes.length);
      const drawn = glyph.strokes.map((s, i) => penAlong(s.median, { sloppiness: 40, rng, reverse: i === reversed }));
      const score = scoreFreeWriting(drawn, glyph);
      const count = glyph.strokes.length;
      expect(score.orderCorrect, glyph.char).toBe(count);
      expect(score.orderRelative, glyph.char).toBe(count);
      expect(score.directionCorrect, glyph.char).toBe(count - 1);
      expect(score.strokes[reversed]!.directionOk, glyph.char).toBe(false);
      expect(score.missing).toEqual([]);
      expect(score.extra).toEqual([]);
    }
  });
});
