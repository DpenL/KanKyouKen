import { describe, expect, it } from "vitest";
import { minCostAssignment } from "./assignment";
import { createRng } from "./rng";

function bruteForce(cost: number[][]): number {
  const rows = cost.length;
  const cols = cost[0]!.length;
  let best = Infinity;
  const used = new Array<boolean>(cols).fill(false);
  const go = (r: number, total: number, left: number): void => {
    if (r === rows) {
      if (left === 0) best = Math.min(best, total);
      return;
    }
    if (rows - r > left) go(r + 1, total, left); // leave this row out (more rows than columns)
    for (let c = 0; c < cols; c++) {
      if (used[c]) continue;
      used[c] = true;
      go(r + 1, total + cost[r]![c]!, left - 1);
      used[c] = false;
    }
  };
  go(0, 0, Math.min(rows, cols));
  return best;
}

describe("minCostAssignment", () => {
  it("solves a known square case", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    expect(minCostAssignment(cost)).toEqual([1, 0, 2]);
  });

  it("handles empty and rectangular matrices", () => {
    expect(minCostAssignment([])).toEqual([]);
    expect(minCostAssignment([[], []])).toEqual([-1, -1]);
    expect(minCostAssignment([[5, 1, 9]])).toEqual([1]);
    expect(minCostAssignment([[5], [1], [9]])).toEqual([-1, 0, -1]);
  });

  it("refuses costs it cannot rank and ragged matrices instead of searching forever", () => {
    expect(() => minCostAssignment([[Number.NaN]])).toThrow(RangeError);
    expect(() => minCostAssignment([[Infinity, 1], [Infinity, Infinity]])).toThrow(RangeError);
    expect(() => minCostAssignment([[1, -Infinity]])).toThrow(RangeError);
    expect(() => minCostAssignment([[1, 2], [3]])).toThrow(RangeError);
    expect(() => minCostAssignment([[1], [3, 0]])).toThrow(RangeError);
  });

  it("matches brute force on random matrices", () => {
    const rng = createRng("assignment");
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + rng.int(5);
      const cols = 1 + rng.int(5);
      const cost = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(rng.next() * 20)));
      const pairing = minCostAssignment(cost);
      const usedCols = pairing.filter((c) => c >= 0);
      expect(new Set(usedCols).size).toBe(usedCols.length);
      expect(usedCols.length).toBe(Math.min(rows, cols));
      const total = pairing.reduce((sum, c, r) => (c >= 0 ? sum + cost[r]![c]! : sum), 0);
      expect(total).toBe(bruteForce(cost));
    }
  });
});
