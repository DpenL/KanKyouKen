import { describe, expect, it } from "vitest";
import { distanceToPolyline } from "@kankyouken/mechanics/util";
import type { Point } from "@kankyouken/mechanics/util";
import {
  flatten,
  flattenSubpaths,
  formatNumber,
  formatPath,
  parsePath,
  simplify,
  toAbsolute,
  transformPath,
} from "./svg-path";

const commands = (d: string): string => parsePath(d).map((s) => s.command).join("");
const p = (x: number, y: number): Point => ({ x, y });

describe("parsePath", () => {
  it("splits commands and their arguments", () => {
    expect(parsePath("M10,20 L30,40")).toEqual([
      { command: "M", args: [10, 20] },
      { command: "L", args: [30, 40] },
    ]);
  });

  it("knows every supported command in both cases", () => {
    const d = "M0 0H10V10h-5v-5L1 1l1 1C1 2 3 4 5 6c1 1 2 2 3 3S1 2 3 4s1 1 2 2Q1 2 3 4q1 1 2 2T5 5t1 1Zz";
    expect(commands(d)).toBe("MHVhvLlCcSsQqTtZz");
    expect(parsePath(d).map((s) => s.args.length)).toEqual([2, 1, 1, 1, 1, 2, 2, 6, 6, 4, 4, 4, 4, 2, 2, 0, 0]);
  });

  it("expands implicit repetitions, turning extra moveto pairs into linetos", () => {
    expect(commands("M0,0 10,10 20,0")).toBe("MLL");
    expect(commands("m1,1 2,2 3,3")).toBe("mll");
    expect(parsePath("M0,0l1,2 3,4")).toEqual([
      { command: "M", args: [0, 0] },
      { command: "l", args: [1, 2] },
      { command: "l", args: [3, 4] },
    ]);
    expect(commands("M0,0c1,1,2,2,3,3 4,4,5,5,6,6h1 2 3")).toBe("Mcchhh");
  });

  it("reads numbers that run together and exponents", () => {
    expect(parsePath("M1.5-2")[0]!.args).toEqual([1.5, -2]);
    expect(parsePath("M.5.5")[0]!.args).toEqual([0.5, 0.5]);
    expect(parsePath("M1.5.5")[0]!.args).toEqual([1.5, 0.5]);
    expect(parsePath("M3e-1,2E1")[0]!.args).toEqual([0.3, 20]);
    expect(parsePath("M-1e+2-.5")[0]!.args).toEqual([-100, -0.5]);
    expect(parsePath("M+4,5.")[0]!.args).toEqual([4, 5]);
  });

  it("accepts any mix of whitespace and commas", () => {
    expect(parsePath(" \n\tM 1 , 2\n L\t3,4 , ")).toEqual(parsePath("M1,2L3,4"));
  });

  it("returns nothing for empty or blank data", () => {
    expect(parsePath("")).toEqual([]);
    expect(parsePath("  \n ")).toEqual([]);
  });

  it("rejects data that does not start with a moveto", () => {
    expect(() => parsePath("L1,2")).toThrow(/must start with a moveto/);
    expect(() => parsePath("5,5")).toThrow(/stray character "5" at offset 0/);
  });

  it("rejects incomplete argument groups", () => {
    expect(() => parsePath("M1")).toThrow(/needs 2 numbers per repetition, got 1/);
    expect(() => parsePath("M1,2,3")).toThrow(/needs 2 numbers/);
    expect(() => parsePath("M0,0C1,2,3,4")).toThrow(/needs 6 numbers per repetition, got 4/);
    expect(() => parsePath("M0,0L")).toThrow(/got 0/);
  });

  it("rejects arcs and anything else it does not know", () => {
    expect(() => parsePath("M0,0A5,5,0,0,1,10,10")).toThrow(/unsupported command or stray character "A"/);
    expect(() => parsePath("M0,0 X")).toThrow(/"X" at offset 5/);
    expect(() => parsePath("M0,0Z5")).toThrow(/stray character "5"/);
    expect(() => parsePath("M1e,2")).toThrow();
  });
});

describe("toAbsolute", () => {
  const abs = (d: string) => toAbsolute(parsePath(d));

  it("resolves relative lines against the current point", () => {
    expect(abs("m10,10 l5,0 l0,5")).toEqual([
      { command: "M", to: p(10, 10) },
      { command: "L", to: p(15, 10) },
      { command: "L", to: p(15, 15) },
    ]);
  });

  it("treats a later relative moveto as relative, the first one as absolute", () => {
    expect(abs("m3,4m5,5l1,0")).toEqual([
      { command: "M", to: p(3, 4) },
      { command: "M", to: p(8, 9) },
      { command: "L", to: p(9, 9) },
    ]);
  });

  it("turns H and V into lines that keep the other coordinate", () => {
    expect(abs("M1,2H5V7h-1v-2").slice(1)).toEqual([
      { command: "L", to: p(5, 2) },
      { command: "L", to: p(5, 7) },
      { command: "L", to: p(4, 7) },
      { command: "L", to: p(4, 5) },
    ]);
  });

  it("offsets all three points of a relative cubic from the start of the curve", () => {
    expect(abs("M10,10c1,2,3,4,5,6")[1]).toEqual({ command: "C", c1: p(11, 12), c2: p(13, 14), to: p(15, 16) });
    expect(abs("M10,10C1,2,3,4,5,6")[1]).toEqual({ command: "C", c1: p(1, 2), c2: p(3, 4), to: p(5, 6) });
  });

  it("reflects the previous control point for S", () => {
    expect(abs("M0,0C0,10,10,10,10,0S20,-10,20,0")[2]).toEqual({
      command: "C",
      c1: p(10, -10),
      c2: p(20, -10),
      to: p(20, 0),
    });
    expect(abs("M0,0c0,10,10,10,10,0s10,-10,10,0")[2]).toEqual(abs("M0,0C0,10,10,10,10,0S20,-10,20,0")[2]);
  });

  it("uses the current point as first control when S does not follow a cubic", () => {
    expect(abs("M5,5s1,1,2,2")[1]).toEqual({ command: "C", c1: p(5, 5), c2: p(6, 6), to: p(7, 7) });
    expect(abs("M0,0C1,1,2,2,3,3L5,5S8,8,9,9")[3]).toMatchObject({ c1: p(5, 5) });
    expect(abs("M0,0Q1,1,2,2S8,8,9,9")[2]).toMatchObject({ c1: p(2, 2) });
  });

  it("reflects the previous control point for T, also along a chain", () => {
    const chain = abs("M0,0Q5,10,10,0T20,0T30,0");
    expect(chain[2]).toEqual({ command: "Q", c1: p(15, -10), to: p(20, 0) });
    expect(chain[3]).toEqual({ command: "Q", c1: p(25, 10), to: p(30, 0) });
    expect(abs("M0,0q5,10,10,0t10,0")[2]).toEqual(chain[2]);
  });

  it("uses the current point as control when T does not follow a quadratic", () => {
    expect(abs("M1,1T5,5")[1]).toEqual({ command: "Q", c1: p(1, 1), to: p(5, 5) });
    expect(abs("M0,0C1,1,2,2,3,3T9,9")[2]).toMatchObject({ c1: p(3, 3) });
  });

  it("returns to the start of the subpath after Z", () => {
    expect(abs("M10,10l5,0l0,5zl-1,-1")).toEqual([
      { command: "M", to: p(10, 10) },
      { command: "L", to: p(15, 10) },
      { command: "L", to: p(15, 15) },
      { command: "Z" },
      { command: "L", to: p(9, 9) },
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(toAbsolute([])).toEqual([]);
  });
});

describe("flatten", () => {
  it("keeps the vertices of straight paths in drawing order", () => {
    expect(flatten("M0,0L10,0L10,10")).toEqual([p(0, 0), p(10, 0), p(10, 10)]);
    expect(flatten("M10,10L0,0")[0]).toEqual(p(10, 10));
  });

  it("samples a cubic at equal parameter steps and ends exactly on its end point", () => {
    // Control points at thirds of a straight line make the curve linear in t.
    const line = flatten("M0,0C10,0,20,0,30,0", 3);
    expect(line).toHaveLength(4);
    line.forEach((pt, k) => {
      expect(pt.x).toBeCloseTo(10 * k, 10);
      expect(pt.y).toBeCloseTo(0, 10);
    });
    expect(line[3]).toEqual(p(30, 0));
    expect(flatten("M0,0C0,10,10,10,10,0", 2)[1]).toEqual(p(5, 7.5));
  });

  it("samples a quadratic", () => {
    expect(flatten("M0,0Q10,20,20,0", 2)).toEqual([p(0, 0), p(10, 10), p(20, 0)]);
    expect(flatten("M0,0Q10,20,20,0", 8)).toHaveLength(9);
  });

  it("uses 16 samples per curve by default and one point per curve at the minimum", () => {
    expect(flatten("M0,0C0,10,10,10,10,0")).toHaveLength(17);
    expect(flatten("M0,0C0,10,10,10,10,0", 1)).toEqual([p(0, 0), p(10, 0)]);
  });

  it("walks back to the start on Z", () => {
    expect(flatten("M0,0L10,0L10,10Z")).toEqual([p(0, 0), p(10, 0), p(10, 10), p(0, 0)]);
    expect(flatten("M0,0L10,0L0,0Z")).toEqual([p(0, 0), p(10, 0), p(0, 0)]);
  });

  it("separates subpaths in flattenSubpaths and joins them in flatten", () => {
    const d = "M0,0L5,0M20,20L25,20";
    expect(flattenSubpaths(d)).toEqual([
      [p(0, 0), p(5, 0)],
      [p(20, 20), p(25, 20)],
    ]);
    expect(flatten(d)).toEqual([p(0, 0), p(5, 0), p(20, 20), p(25, 20)]);
  });

  it("starts a new subpath at the closed subpath's start when drawing continues after Z", () => {
    expect(flattenSubpaths("M1,1L5,1L5,5ZL0,0")).toEqual([
      [p(1, 1), p(5, 1), p(5, 5), p(1, 1)],
      [p(1, 1), p(0, 0)],
    ]);
  });

  it("drops zero-length steps", () => {
    expect(flatten("M5,5L5,5l0,0h0")).toEqual([p(5, 5)]);
    expect(flatten("M0,0L3,0L3,0L6,0")).toEqual([p(0, 0), p(3, 0), p(6, 0)]);
    expect(flatten("M4,4C4,4,4,4,4,4")).toEqual([p(4, 4)]);
  });

  it("handles empty data and a lone moveto", () => {
    expect(flatten("")).toEqual([]);
    expect(flattenSubpaths("")).toEqual([]);
    expect(flatten("M7,8")).toEqual([p(7, 8)]);
  });

  it("rejects a sample count that is not a positive integer", () => {
    expect(() => flatten("M0,0L1,1", 0)).toThrow(RangeError);
    expect(() => flatten("M0,0L1,1", 2.5)).toThrow(RangeError);
    expect(() => flatten("M0,0L1,1", Number.NaN)).toThrow(RangeError);
  });

  it("follows a hooked stroke written with mixed relative commands", () => {
    // Down, then a short flick up-left, as a vertical hook would be drawn.
    const line = flatten("M50,10v70c0,6-2,9-8,9s-6-3-10-8", 8);
    expect(line[0]).toEqual(p(50, 10));
    expect(line[1]).toEqual(p(50, 80));
    expect(line[line.length - 1]).toEqual(p(32, 81));
    expect(line).toHaveLength(2 + 8 + 8);
    expect(Math.max(...line.map((pt) => pt.y))).toBeGreaterThan(88);
  });
});

describe("simplify", () => {
  it("removes points that lie on the line", () => {
    expect(simplify([p(0, 0), p(1, 0), p(5, 0), p(10, 0)], 0)).toEqual([p(0, 0), p(10, 0)]);
  });

  it("keeps a point only when it strays farther than epsilon", () => {
    const line = [p(0, 0), p(5, 2), p(10, 0)];
    expect(simplify(line, 2)).toEqual([p(0, 0), p(10, 0)]);
    expect(simplify(line, 1.99)).toEqual(line);
  });

  it("keeps the corners of a zigzag and drops its noise", () => {
    const line = [p(0, 0), p(10, 0.2), p(20, 0), p(20.1, 10), p(20, 20), p(30, 20.3), p(40, 20)];
    expect(simplify(line, 1)).toEqual([p(0, 0), p(20, 0), p(20, 20), p(40, 20)]);
  });

  it("always keeps the end points, whatever the tolerance", () => {
    const line = [p(0, 0), p(3, 9), p(6, -4), p(9, 1)];
    expect(simplify(line, 1e9)).toEqual([p(0, 0), p(9, 1)]);
  });

  it("returns a copy of lines that cannot get shorter", () => {
    const two = [p(0, 0), p(1, 1)];
    expect(simplify(two, 5)).toEqual(two);
    expect(simplify(two, 5)).not.toBe(two);
    expect(simplify([p(2, 2)], 5)).toEqual([p(2, 2)]);
    expect(simplify([], 5)).toEqual([]);
  });

  it("keeps the far side of a closed loop", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)];
    expect(simplify(square, 1)).toEqual(square);
    expect(simplify(square, 20)).toEqual([p(0, 0), p(0, 0)]);
  });

  it("rejects a negative or non-finite tolerance", () => {
    expect(() => simplify([p(0, 0), p(1, 1), p(2, 0)], -1)).toThrow(RangeError);
    expect(() => simplify([p(0, 0), p(1, 1), p(2, 0)], Number.NaN)).toThrow(RangeError);
    expect(() => simplify([p(0, 0), p(1, 1), p(2, 0)], Infinity)).toThrow(RangeError);
  });

  it("stays within epsilon of a sampled curve while shedding most of its points", () => {
    const curve = flatten("M100,900C100,400,400,100,900,100", 64);
    const epsilon = 4;
    const simple = simplify(curve, epsilon);
    expect(simple.length).toBeLessThan(curve.length / 4);
    expect(simple.length).toBeGreaterThan(2);
    expect(simple[0]).toEqual(curve[0]);
    expect(simple[simple.length - 1]).toEqual(curve[curve.length - 1]);
    for (const pt of curve) expect(distanceToPolyline(pt, simple)).toBeLessThanOrEqual(epsilon);
    // Kept points appear in their original order.
    const order = simple.map((pt) => curve.indexOf(pt));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("formatNumber", () => {
  it("rounds to the given number of decimals and trims zeros", () => {
    expect(formatNumber(1.26, 1)).toBe("1.3");
    expect(formatNumber(5, 1)).toBe("5");
    expect(formatNumber(4.96, 1)).toBe("5");
    expect(formatNumber(1234.56, 0)).toBe("1235");
    expect(formatNumber(-3.14159, 3)).toBe("-3.142");
  });

  it("never writes a negative zero", () => {
    expect(formatNumber(-0.04, 1)).toBe("0");
    expect(formatNumber(-0, 2)).toBe("0");
  });

  it("rejects bad input", () => {
    expect(() => formatNumber(1, -1)).toThrow(RangeError);
    expect(() => formatNumber(1, 0.5)).toThrow(RangeError);
    expect(() => formatNumber(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe("formatPath", () => {
  it("writes compact absolute path data", () => {
    expect(
      formatPath(
        [
          { command: "M", to: p(1, 2) },
          { command: "C", c1: p(3, 4), c2: p(5, 6), to: p(7, 8) },
          { command: "Q", c1: p(9, 10), to: p(11, 12) },
          { command: "L", to: p(-1.25, 0) },
          { command: "Z" },
        ],
        1,
      ),
    ).toBe("M1,2C3,4,5,6,7,8Q9,10,11,12L-1.2,0Z");
    expect(formatPath([], 1)).toBe("");
  });
});

describe("transformPath", () => {
  it("scales and makes everything absolute", () => {
    expect(transformPath("M10,20l5,5", 2, 0)).toBe("M20,40L30,50");
    expect(transformPath("M1,1c1,0,2,1,2,2", 10, 0)).toBe("M10,10C20,10,30,20,30,30");
  });

  it("reduces the command set to M L C Q Z", () => {
    expect(transformPath("M0,0H10V10Z", 1, 0)).toBe("M0,0L10,0L10,10Z");
    expect(transformPath("M0,0C0,10,10,10,10,0S20,-10,20,0", 1, 0)).toBe("M0,0C0,10,10,10,10,0C10,-10,20,-10,20,0");
    expect(transformPath("M0,0Q5,10,10,0T20,0", 1, 0)).toBe("M0,0Q5,10,10,0Q15,-10,20,0");
  });

  it("rounds to at most the requested decimals", () => {
    expect(transformPath("M1.234,5.678L9.999,0.04", 1, 1)).toBe("M1.2,5.7L10,0");
    expect(transformPath("M1.234,5.678L9.999,0.04", 1, 0)).toBe("M1,6L10,0");
    expect(transformPath("M1.234,5.678", 1, 3)).toBe("M1.234,5.678");
  });

  it("maps a 109-unit drawing onto 1000 units", () => {
    expect(transformPath("M0,109L54.5,27.25", 1000 / 109, 1)).toBe("M0,1000L500,250");
    expect(transformPath("M22,30v60", 1000 / 109, 1)).toBe("M201.8,275.2L201.8,825.7");
  });

  it("rounds each number from its exact position, so small relative steps do not drift", () => {
    const d = `M0,0${"l0.04,0".repeat(100)}`;
    const out = transformPath(d, 1, 1);
    expect(out.endsWith("L4,0")).toBe(true);
    expect(out.startsWith("M0,0L0,0L0.1,0")).toBe(true);
  });

  it("describes the same shape as the original", () => {
    const d = "M50,10v70c0,6-2,9-8,9s-6-3-10-8";
    const k = 1000 / 109;
    const original = flatten(d, 8);
    const copy = flatten(transformPath(d, k, 1), 8);
    expect(copy).toHaveLength(original.length);
    copy.forEach((pt, i) => {
      expect(Math.abs(pt.x - original[i]!.x * k)).toBeLessThan(0.11);
      expect(Math.abs(pt.y - original[i]!.y * k)).toBeLessThan(0.11);
    });
  });

  it("handles empty data and rejects bad arguments", () => {
    expect(transformPath("", 2, 1)).toBe("");
    expect(() => transformPath("M0,0", Number.NaN, 1)).toThrow(RangeError);
    expect(() => transformPath("M0,0", 1, -1)).toThrow(RangeError);
    expect(() => transformPath("M0,0A1,1,0,0,0,1,1", 1, 1)).toThrow(/unsupported/);
  });
});
