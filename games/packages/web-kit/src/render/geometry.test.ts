import { describe, expect, it } from "vitest";
import { fixture } from "../../../mechanics/src/glyph/fixtures";
import {
  DEFAULT_PADDING,
  arrowGeometry,
  dottedDash,
  formatNumber,
  glyphViewBox,
  pointsAttribute,
  polylinePath,
  revealDash,
  viewBoxAttribute,
} from "./geometry";

describe("formatNumber", () => {
  it("keeps at most two decimals and no trailing zeros", () => {
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(12.5)).toBe("12.5");
    expect(formatNumber(12.345)).toBe("12.35");
    expect(formatNumber(1 / 3)).toBe("0.33");
    expect(formatNumber(1e-9)).toBe("0");
  });

  it("never writes -0, exponents for tiny values, or non-numbers", () => {
    expect(formatNumber(-0.001)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatNumber(-7.126)).toBe("-7.13");
  });
});

describe("glyphViewBox", () => {
  it("adds the padding on every side", () => {
    expect(glyphViewBox(1000, 0.06)).toEqual({ x: -60, y: -60, width: 1120, height: 1120 });
    expect(glyphViewBox(109, 0.1)).toEqual({ x: -10.9, y: -10.9, width: 130.8, height: 130.8 });
  });

  it("uses the default padding", () => {
    expect(glyphViewBox(1000)).toEqual(glyphViewBox(1000, DEFAULT_PADDING));
  });

  it("treats no, negative or broken padding as zero", () => {
    const tight = { x: 0, y: 0, width: 500, height: 500 };
    expect(glyphViewBox(500, 0)).toEqual(tight);
    expect(glyphViewBox(500, -0.2)).toEqual(tight);
    expect(glyphViewBox(500, Number.NaN)).toEqual(tight);
    expect(glyphViewBox(500, Number.POSITIVE_INFINITY)).toEqual(tight);
  });

  it("refuses a size that is not a positive number", () => {
    for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => glyphViewBox(size)).toThrow(RangeError);
    }
  });

  it("serialises to a viewBox attribute", () => {
    expect(viewBoxAttribute(glyphViewBox(1000, 0.06))).toBe("-60 -60 1120 1120");
    expect(viewBoxAttribute(glyphViewBox(109, 0.1))).toBe("-10.9 -10.9 130.8 130.8");
    expect(viewBoxAttribute(glyphViewBox(500, 0))).toBe("0 0 500 500");
  });
});

describe("pointsAttribute / polylinePath", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10.456, y: 20 },
    { x: 30, y: -5 },
  ];

  it("writes a polyline", () => {
    expect(pointsAttribute(line)).toBe("0,0 10.46,20 30,-5");
    expect(polylinePath(line)).toBe("M0,0 L10.46,20 L30,-5");
  });

  it("is empty for no points", () => {
    expect(pointsAttribute([])).toBe("");
    expect(polylinePath([])).toBe("");
  });

  it("doubles a single point so that round caps paint a dot", () => {
    expect(pointsAttribute([{ x: 5, y: 6 }])).toBe("5,6 5,6");
    expect(polylinePath([{ x: 5, y: 6 }])).toBe("M5,6 L5,6");
  });

  it("skips points that are not finite", () => {
    const dirty = [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 4, y: Number.POSITIVE_INFINITY }, { x: 9, y: 9 }];
    expect(pointsAttribute(dirty)).toBe("0,0 9,9");
    expect(polylinePath(dirty)).toBe("M0,0 L9,9");
    expect(pointsAttribute([{ x: Number.NaN, y: Number.NaN }])).toBe("");
  });

  it("traces a fixture stroke's median", () => {
    expect(polylinePath(fixture("口").strokes[1]!.median)).toBe("M200,200 L800,200 L800,800");
  });
});

describe("revealDash", () => {
  it("hides the whole path at `from` and shows all of it at `to`", () => {
    expect(revealDash(800)).toEqual({ dasharray: "800 800", from: 800, to: 0 });
  });

  it("starts a cap radius early so a round cap does not show before the animation", () => {
    const dash = revealDash(800, 22.5);
    expect(dash).toEqual({ dasharray: "800 845", from: 822.5, to: 0 });
    const [line, gap] = dash.dasharray.split(" ").map(Number) as [number, number];
    // At `from` the dash ends one cap radius before the path; the next dash starts beyond its end.
    expect(line - dash.from).toBe(-22.5);
    expect(line + gap - dash.from).toBeGreaterThanOrEqual(800 + 22.5);
  });

  it("treats a missing or broken length or cap as zero", () => {
    expect(revealDash(0)).toEqual({ dasharray: "0 0", from: 0, to: 0 });
    expect(revealDash(-10, 5)).toEqual({ dasharray: "0 10", from: 5, to: 0 });
    expect(revealDash(Number.NaN, Number.NaN)).toEqual({ dasharray: "0 0", from: 0, to: 0 });
    expect(revealDash(100, -3)).toEqual({ dasharray: "100 100", from: 100, to: 0 });
  });
});

describe("dottedDash", () => {
  it("fits a whole number of gaps so both ends get a dot", () => {
    expect(dottedDash(800, 40)).toEqual({ dasharray: "0 40", gap: 40, count: 21 });
    const fitted = dottedDash(830, 40);
    expect(fitted.count).toBe(22);
    expect(fitted.gap).toBeCloseTo(830 / 21, 1);
    expect(fitted.gap * (fitted.count - 1)).toBeLessThanOrEqual(830);
  });

  it("rounds the gap down, never up", () => {
    const dash = dottedDash(100, 33);
    expect(dash.dasharray).toBe("0 33.33");
    expect(dash.gap * (dash.count - 1)).toBeLessThanOrEqual(100);
  });

  it("gives a short line its two end dots", () => {
    expect(dottedDash(10, 40)).toEqual({ dasharray: "0 10", gap: 10, count: 2 });
  });

  it("falls back to a single dot for degenerate input", () => {
    const single = { dasharray: "0 1", gap: 0, count: 1 };
    expect(dottedDash(0, 40)).toEqual(single);
    expect(dottedDash(-5, 40)).toEqual(single);
    expect(dottedDash(100, 0)).toEqual(single);
    expect(dottedDash(Number.NaN, 40)).toEqual(single);
    expect(dottedDash(100, Number.POSITIVE_INFINITY)).toEqual(single);
    expect(dottedDash(0.001, 40)).toEqual(single);
  });
});

describe("arrowGeometry", () => {
  const tree = fixture("木");

  it("points a horizontal stroke's arrow to the right, with the number to its left", () => {
    const arrow = arrowGeometry(tree.strokes[0]!.median, 1000)!;
    expect(arrow.start).toEqual({ x: 100, y: 350 });
    expect(arrow.heading).toEqual({ x: 1, y: 0 });
    expect(arrow.head[0]).toEqual({ x: 260, y: 350 });
    expect(arrow.shaft).toEqual([
      { x: 100, y: 350 },
      { x: 205, y: 350 },
    ]);
    expect(arrow.head[1]).toEqual({ x: 205, y: 375 });
    expect(arrow.head[2]).toEqual({ x: 205, y: 325 });
    expect(arrow.label.x).toBeCloseTo(35);
    expect(arrow.label.y).toBeCloseTo(350);
  });

  it("points a vertical stroke's arrow down, with the number above", () => {
    const arrow = arrowGeometry(tree.strokes[1]!.median, 1000)!;
    expect(arrow.heading).toEqual({ x: 0, y: 1 });
    expect(arrow.head[0]).toEqual({ x: 500, y: 260 });
    expect(arrow.label).toEqual({ x: 500, y: 35 });
  });

  it("follows a diagonal and keeps the head symmetric about it", () => {
    const arrow = arrowGeometry(tree.strokes[2]!.median, 1000)!;
    expect(Math.hypot(arrow.heading.x, arrow.heading.y)).toBeCloseTo(1);
    expect(arrow.heading.x).toBeLessThan(0);
    expect(arrow.heading.y).toBeGreaterThan(0);
    const [tip, left, right] = arrow.head;
    expect(Math.hypot(tip.x - left.x, tip.y - left.y)).toBeCloseTo(Math.hypot(tip.x - right.x, tip.y - right.y));
    expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeCloseTo(50);
    // The number sits behind the start: up and to the right of it for a down-left stroke.
    expect(arrow.label.x).toBeGreaterThan(arrow.start.x);
    expect(arrow.label.y).toBeLessThan(arrow.start.y);
  });

  it("gives two strokes leaving one corner their numbers on different sides", () => {
    const mouth = fixture("口");
    const down = arrowGeometry(mouth.strokes[0]!.median, 1000)!;
    const across = arrowGeometry(mouth.strokes[1]!.median, 1000)!;
    expect(down.start).toEqual(across.start);
    expect(down.label).toEqual({ x: 200, y: 130 });
    expect(across.label).toEqual({ x: 130, y: 200 });
  });

  it("looks past a tiny hook at the start", () => {
    const hooked = [
      { x: 500, y: 100 },
      { x: 495, y: 95 },
      { x: 495, y: 900 },
    ];
    const arrow = arrowGeometry(hooked, 1000)!;
    expect(arrow.heading.y).toBeGreaterThan(0.99);
  });

  it("never draws an arrow longer than the stroke, or a head longer than the arrow", () => {
    const stub = [
      { x: 400, y: 400 },
      { x: 430, y: 400 },
    ];
    const arrow = arrowGeometry(stub, 1000)!;
    expect(arrow.head[0]).toEqual({ x: 430, y: 400 });
    expect(arrow.shaft[1]).toEqual({ x: 400, y: 400 });
  });

  it("keeps the number inside the glyph square", () => {
    const fromCorner = [
      { x: 10, y: 5 },
      { x: 500, y: 500 },
    ];
    const arrow = arrowGeometry(fromCorner, 1000)!;
    expect(arrow.label).toEqual({ x: 35, y: 35 });
    const toEdge = arrowGeometry([{ x: 990, y: 500 }, { x: 500, y: 500 }], 1000)!;
    expect(toEdge.label.x).toBe(965);
  });

  it("falls back to the first real segment when the stroke returns to its start", () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ];
    const arrow = arrowGeometry(loop, 100, { reach: 0.2 })!;
    expect(arrow.heading).toEqual({ x: 1, y: 0 });
  });

  it("honours its options and scales with the glyph size", () => {
    const line = [
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ];
    const arrow = arrowGeometry(line, 100, { reach: 0.3, headLength: 0.1, headWidth: 0.2, labelDistance: 0.05 })!;
    expect(arrow.head).toEqual([
      { x: 40, y: 50 },
      { x: 30, y: 60 },
      { x: 30, y: 40 },
    ]);
    expect(arrow.label).toEqual({ x: 5, y: 50 });
  });

  it("gives up on strokes without a direction", () => {
    expect(arrowGeometry([], 1000)).toBeNull();
    expect(arrowGeometry([{ x: 1, y: 1 }], 1000)).toBeNull();
    expect(arrowGeometry([{ x: 1, y: 1 }, { x: 1, y: 1 }], 1000)).toBeNull();
    expect(arrowGeometry([{ x: 1, y: 1 }, { x: Number.NaN, y: 1 }], 1000)).toBeNull();
  });
});
