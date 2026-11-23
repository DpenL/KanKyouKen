import { describe, expect, it } from "vitest";
import { fixture } from "../glyph/fixtures";
import { extractStrokes } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import type { Box, Point } from "../util/geometry";
import { contourTravel } from "./contour";
import { componentFrame, elementForStroke, generateElements } from "./generate";
import { DEFAULT_TUNING, stepToPitch } from "./tuning";
import type { TuningConfig } from "./types";

const FRAME: Box = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
const T = DEFAULT_TUNING;
const line = (...pts: (readonly [number, number])[]): Point[] => pts.map(([x, y]) => ({ x, y }));
const pitches = (median: Point[], tuning: TuningConfig = T, shift = 0): number[] =>
  elementForStroke(median, FRAME, tuning, shift).contour.map((c) => c.pitch);
const step = (s: number): number => stepToPitch(s, T);

describe("elementForStroke: contour", () => {
  it("gives a level stroke a steady note at its height", () => {
    const element = elementForStroke(line([0, 500], [1000, 500]), FRAME, T);
    expect(element.contour).toEqual([
      { p: 0, pitch: step(4) },
      { p: 1, pitch: step(4) },
    ]);
    expect(pitches(line([0, 0], [1000, 0]))).toEqual([step(8), step(8)]);
    expect(pitches(line([0, 1000], [1000, 1000]))).toEqual([step(0), step(0)]);
  });

  it("holds a stroke that travels less than the deadband at its mean height", () => {
    expect(pitches(line([0, 500], [1000, 400]))).toEqual([step(4), step(4)]);
  });

  it("makes a downward stroke fall and an upward stroke rise", () => {
    const down = elementForStroke(line([500, 0], [500, 1000]), FRAME, T);
    expect(down.contour).toEqual([
      { p: 0, pitch: step(8) },
      { p: 1, pitch: step(0) },
    ]);
    const up = elementForStroke(line([500, 1000], [500, 0]), FRAME, T);
    expect(up.contour).toEqual([
      { p: 0, pitch: step(0) },
      { p: 1, pitch: step(8) },
    ]);
  });

  it("spans a bigger interval for a longer vertical travel", () => {
    const short = contourTravel(elementForStroke(line([500, 400], [500, 600]), FRAME, T).contour);
    const long = contourTravel(elementForStroke(line([500, 100], [500, 900]), FRAME, T).contour);
    expect(short).toBe(step(3) - step(5));
    expect(long).toBeLessThan(short);
    expect(short).toBeLessThan(0);
  });

  it("moves everything by the register shift, in scale steps", () => {
    expect(pitches(line([0, 500], [1000, 500]), T, 2)).toEqual([step(6), step(6)]);
    expect(pitches(line([500, 0], [500, 1000]), T, 3)).toEqual([step(11), step(3)]);
    expect(pitches(line([500, 0], [500, 1000]), T, -2)).toEqual([step(6), step(-2)]);
  });

  it("keeps the corner of a bent stroke as a third vertex", () => {
    const corner = elementForStroke(line([0, 0], [1000, 0], [1000, 1000]), FRAME, T);
    expect(corner.contour).toEqual([
      { p: 0, pitch: step(8) },
      { p: 0.5, pitch: step(8) },
      { p: 1, pitch: step(0) },
    ]);
  });

  it("never keeps more vertices than maxContourPoints, and no more than the shape needs", () => {
    const zigzag = line([0, 0], [250, 1000], [500, 0], [750, 1000], [1000, 0]);
    const count = (maxContourPoints: number): number =>
      elementForStroke(zigzag, FRAME, { ...T, maxContourPoints }).contour.length;
    expect([2, 3, 4, 5, 9].map(count)).toEqual([2, 3, 4, 5, 5]);
    const full = elementForStroke(zigzag, FRAME, { ...T, maxContourPoints: 5 }).contour;
    expect(full.map((c) => c.p)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(full.map((c) => c.pitch)).toEqual([step(8), step(0), step(8), step(0), step(8)]);
    const corner = line([0, 0], [1000, 0], [1000, 1000]);
    expect(pitches(corner, { ...T, maxContourPoints: 2 })).toEqual([step(8), step(0)]);
  });

  it("produces a contour that starts at 0, ends at 1 and is sorted", () => {
    const shapes = [
      line([0, 0], [250, 1000], [500, 0], [750, 1000], [1000, 0]),
      line([100, 900], [500, 100], [900, 900]),
      line([250, 100], [750, 100], [750, 900], [650, 850]),
      line([500, 500]),
    ];
    for (const shape of shapes) {
      const { contour } = elementForStroke(shape, FRAME, T);
      expect(contour.length).toBeGreaterThanOrEqual(2);
      expect(contour[0]!.p).toBe(0);
      expect(contour[contour.length - 1]!.p).toBe(1);
      for (let i = 1; i < contour.length; i++) expect(contour[i]!.p).toBeGreaterThan(contour[i - 1]!.p);
    }
  });

  it("turns a straight stroke into a single glide whatever its slope", () => {
    for (let y0 = 0; y0 <= 1000; y0 += 53) {
      for (let y1 = 0; y1 <= 1000; y1 += 47) {
        const { contour } = elementForStroke(line([120, y0], [870, y1]), FRAME, T);
        expect(contour, `${y0} -> ${y1}`).toHaveLength(2);
      }
    }
  });

  it("does not keep a bend smaller than one step", () => {
    expect(elementForStroke(line([0, 300], [500, 540], [1000, 700]), FRAME, T).contour).toHaveLength(2);
  });

  it("returns to the starting pitch on an arch", () => {
    const arch = elementForStroke(line([0, 800], [500, 200], [1000, 800]), FRAME, T).contour;
    expect(arch).toHaveLength(3);
    expect(arch[1]!.p).toBe(0.5);
    expect(arch[1]!.pitch).toBeGreaterThan(arch[0]!.pitch);
    expect(contourTravel(arch)).toBe(0);
  });

  it("puts the vertex of a shallow arch at its apex, not at the first step change", () => {
    const shallow = elementForStroke(line([0, 500], [500, 360], [1000, 500]), FRAME, T).contour;
    expect(shallow).toEqual([
      { p: 0, pitch: step(4) },
      { p: 0.5, pitch: step(5) },
      { p: 1, pitch: step(4) },
    ]);
    const late = elementForStroke(line([0, 500], [750, 360], [1000, 500]), FRAME, T).contour;
    expect(late.map((c) => c.pitch)).toEqual([step(4), step(5), step(4)]);
    expect(late[1]!.p).toBe(0.75);
  });

  it("keeps the direction audible when both ends quantise to the same step", () => {
    expect(pitches(line([0, 560], [1000, 438]))).toEqual([step(4), step(5)]);
    expect(pitches(line([0, 438], [1000, 560]))).toEqual([step(4), step(3)]);
  });

  it("moves the first vertex instead when the last cannot leave the range", () => {
    const coarse: TuningConfig = { ...T, rangeSteps: 2 };
    expect(pitches(line([0, 240], [1000, 0]), coarse)).toEqual([step(1), step(2)]);
    expect(pitches(line([0, 760], [1000, 1000]), coarse)).toEqual([step(1), step(0)]);
  });
});

describe("elementForStroke: beats and pan", () => {
  const beats = (median: Point[], tuning: TuningConfig = T): number => elementForStroke(median, FRAME, tuning).beats;
  const pan = (median: Point[]): number => elementForStroke(median, FRAME, T).pan;

  it("scales beats with stroke length relative to the frame side, in quarter beats", () => {
    expect(beats(line([500, 500]))).toBe(0.5);
    expect(beats(line([0, 500], [1000, 500]))).toBe(1.5);
    expect(beats(line([250, 500], [750, 500]))).toBe(1);
    expect(beats(line([0, 500], [300, 500]))).toBe(0.75);
    expect(beats(line([0, 500], [1000, 500], [0, 500]))).toBe(1.5);
  });

  it("never returns less than a quarter beat", () => {
    expect(beats(line([500, 500]), { ...T, minBeats: 0.05, maxBeats: 0.1 })).toBe(0.25);
  });

  it("pans by the mean horizontal position, within -0.6..0.6", () => {
    expect(pan(line([0, 0], [0, 1000]))).toBeCloseTo(-0.6, 10);
    expect(pan(line([250, 0], [250, 1000]))).toBeCloseTo(-0.3, 10);
    expect(pan(line([500, 0], [500, 1000]))).toBe(0);
    expect(pan(line([1000, 0], [1000, 1000]))).toBeCloseTo(0.6, 10);
    expect(pan(line([1500, 0], [1500, 1000]))).toBeCloseTo(0.6, 10);
    expect(pan(line([-400, 0], [-400, 1000]))).toBeCloseTo(-0.6, 10);
    expect(pan(line([0, 500], [1000, 500]))).toBe(0);
  });
});

describe("elementForStroke: edge cases", () => {
  it("throws on an empty median", () => {
    expect(() => elementForStroke([], FRAME, T)).toThrow(/empty median/);
  });

  it("treats a single point as a short steady note", () => {
    expect(elementForStroke(line([500, 250]), FRAME, T)).toEqual({
      contour: [
        { p: 0, pitch: step(6) },
        { p: 1, pitch: step(6) },
      ],
      beats: 0.5,
      pan: 0,
    });
    expect(elementForStroke(line([500, 250], [500, 250], [500, 250]), FRAME, T).contour).toHaveLength(2);
  });

  it("clamps points outside the frame to its edges", () => {
    expect(pitches(line([0, -200], [1000, -200]))).toEqual([step(8), step(8)]);
    expect(pitches(line([0, 1300], [1000, 1300]))).toEqual([step(0), step(0)]);
    expect(elementForStroke(line([500, -500], [500, 1500]), FRAME, T).contour).toEqual([
      { p: 0, pitch: step(8) },
      { p: 0.25, pitch: step(8) },
      { p: 1, pitch: step(0) },
    ]);
  });

  it("copes with degenerate frames", () => {
    const flat = elementForStroke(line([0, 500], [1000, 800]), { minX: 0, minY: 500, maxX: 1000, maxY: 500 }, T);
    expect(flat.contour.map((c) => c.pitch)).toEqual([step(4), step(4)]);
    const thin = elementForStroke(line([500, 0], [500, 1000]), { minX: 500, minY: 0, maxX: 500, maxY: 1000 }, T);
    expect(thin.pan).toBe(0);
    const dot = elementForStroke(line([0, 0], [1000, 1000]), { minX: 5, minY: 5, maxX: 5, maxY: 5 }, T);
    expect(dot).toEqual({
      contour: [
        { p: 0, pitch: step(4) },
        { p: 1, pitch: step(4) },
      ],
      beats: 0.5,
      pan: 0,
    });
  });
});

describe("componentFrame", () => {
  it("is the square around the strokes", () => {
    expect(componentFrame(fixture("十"), [0, 1])).toEqual({ minX: 100, minY: 100, maxX: 900, maxY: 900 });
    expect(componentFrame(fixture("月"), [0, 1, 2, 3])).toEqual({ minX: 50, minY: 100, maxX: 850, maxY: 900 });
  });

  it("is at least a quarter of the glyph wide", () => {
    const dash: Glyph = extractStrokes(fixture("十"), [0], "一");
    const tiny: Glyph = {
      ...dash,
      strokes: [{ path: "M480,500L520,500", median: line([480, 500], [520, 500]) }],
    };
    expect(componentFrame(tiny, [0])).toEqual({ minX: 375, minY: 375, maxX: 625, maxY: 625 });
  });

  it("throws without strokes or for a stroke the glyph does not have", () => {
    expect(() => componentFrame(fixture("十"), [])).toThrow();
    expect(() => componentFrame(fixture("十"), [2])).toThrow(/no stroke 2/);
  });
});

describe("generateElements", () => {
  it("generates 十 as a held note followed by a fall through the whole range", () => {
    expect(generateElements(fixture("十"), [0, 1], T)).toEqual([
      {
        contour: [
          { p: 0, pitch: step(5) },
          { p: 1, pitch: step(5) },
        ],
        beats: 1.5,
        pan: 0,
      },
      {
        contour: [
          { p: 0, pitch: step(8) },
          { p: 1, pitch: step(0) },
        ],
        beats: 1.5,
        pan: 0,
      },
    ]);
  });

  it("applies the shift to every element and keeps the order asked for", () => {
    const shifted = generateElements(fixture("十"), [1, 0], T, 3);
    expect(shifted.map((e) => e.contour.map((c) => c.pitch))).toEqual([
      [step(11), step(3)],
      [step(8), step(8)],
    ]);
  });

  it("gives the three strokes of 氵 two short falls and a rise, to the left and right of centre", () => {
    const elements = generateElements(fixture("氵"), [0, 1, 2], T);
    expect(elements.map((e) => Math.sign(contourTravel(e.contour)))).toEqual([-1, -1, 1]);
    expect(elements[0]!.contour[0]!.pitch).toBeGreaterThan(elements[1]!.contour[0]!.pitch);
    expect(elements[1]!.contour[0]!.pitch).toBeGreaterThan(elements[2]!.contour[0]!.pitch);
    expect(elements[0]!.pan).toBeGreaterThan(elements[1]!.pan);
    expect(elements.every((e) => e.beats < 1.5)).toBe(true);
  });

  it("sends the two legs of 木 to opposite sides", () => {
    const [, , left, right] = generateElements(fixture("木"), [0, 1, 2, 3], T);
    expect(left!.pan).toBeCloseTo(-right!.pan, 10);
    expect(left!.pan).toBeLessThan(0);
    expect(left!.contour).toEqual(right!.contour);
  });

  it("uses the frame it is given instead of the strokes' own", () => {
    const tree = fixture("木");
    const whole = componentFrame(tree, [0, 1, 2, 3]);
    const inWhole = generateElements(tree, [2, 3], T, 0, whole);
    const inOwn = generateElements(tree, [2, 3], T);
    expect(inWhole).toEqual(generateElements(tree, [0, 1, 2, 3], T).slice(2));
    expect(inOwn[0]!.contour[0]!.pitch).toBeGreaterThan(inWhole[0]!.contour[0]!.pitch);
  });

  it("sounds a component the same wherever it is placed and however it is scaled", () => {
    const standalone = generateElements(fixture("木"), [0, 1, 2, 3], T);
    const wide = fixture("林");
    expect(generateElements(wide, [0, 1, 2, 3], T).map((e) => e.contour)).toEqual(
      generateElements(wide, [4, 5, 6, 7], T).map((e) => e.contour),
    );
    const inside = generateElements(fixture("困"), [2, 3, 4, 5], T);
    expect(inside.map((e) => e.contour)).toEqual(standalone.map((e) => e.contour));
  });

  it("returns nothing for no strokes and throws for an unknown stroke", () => {
    expect(generateElements(fixture("十"), [], T)).toEqual([]);
    expect(generateElements(fixture("十"), [], T, 0, FRAME)).toEqual([]);
    expect(() => generateElements(fixture("十"), [0, 5], T)).toThrow(/no stroke 5/);
  });
});
