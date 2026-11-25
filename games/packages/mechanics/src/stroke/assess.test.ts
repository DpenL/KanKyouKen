import { describe, expect, it } from "vitest";
import { handGlyph } from "../components/test-glyphs";
import { fixture } from "../glyph/fixtures";
import type { Glyph } from "../glyph/types";
import { polylineLength, resample } from "../util/geometry";
import { assessWriting, DEFAULT_REFERENCE_PACE } from "./assess";
import type { DrawnStroke, StrokeSample } from "./types";

interface Writing {
  /** Reference strokes in the order they are written. Default: canonical order. */
  readonly order?: readonly number[];
  readonly reversed?: readonly number[];
  /** Give samples timestamps, writing each stroke in `pace` times its reference duration. */
  readonly pace?: number;
  /** Change one stroke's points after it has been laid out. */
  readonly bend?: (stroke: number, points: StrokeSample[]) => StrokeSample[];
}

const GAP_MS = 350;

/** A tidy writing of the glyph along its own medians, with optional deviations. */
function write(glyph: Glyph, options: Writing = {}): DrawnStroke[] {
  const order = options.order ?? glyph.strokes.map((_, s) => s);
  let clock = 0;
  return order.map((s) => {
    const median = glyph.strokes[s]!.median;
    let points: StrokeSample[] = resample(median, 16);
    if (options.reversed?.includes(s)) points = [...points].reverse();
    if (options.pace !== undefined) {
      const duration = (polylineLength(median) / glyph.size / DEFAULT_REFERENCE_PACE) * 1000 * options.pace;
      points = points.map((p, i) => ({ x: p.x, y: p.y, t: clock + (duration * i) / (points.length - 1) }));
      clock += duration + GAP_MS;
    }
    return options.bend ? options.bend(s, points) : points;
  });
}

const hu = fixture("胡"); // nine strokes: 十 (0-1), 口 (2-4), 月 (5-8)
const stars = (a: ReturnType<typeof assessWriting>): Record<string, number> =>
  Object.fromEntries(Object.values(a.metrics).map((m) => [m.id, m.stars]));

describe("assessWriting", () => {
  it("gives a clean, well-paced, unedited writing full marks", () => {
    const a = assessWriting(write(hu, { pace: 1 }), hu, { edits: 0 });
    expect(Object.values(a.metrics).every((m) => m.available)).toBe(true);
    expect(stars(a)).toEqual({
      "stroke-match": 3,
      "stroke-valid": 3,
      "stroke-exist": 3,
      "stroke-order": 3,
      "stroke-direction": 3,
      "stroke-edit": 3,
      "stroke-length": 3,
      "stroke-closeness": 3,
      "stroke-speed": 3,
      "symbol-speed": 3,
    });
    expect(a.score).toBe(1);
    expect(a.metrics["stroke-match"]).toMatchObject({ group: "structure", value: 9, outOf: 9 });
    expect(a.metrics["symbol-speed"].value).toBeCloseTo(1, 5);
    expect(a.strokes.every((s) => s.orderOk && s.directionOk && s.drawnIndex === s.stroke)).toBe(true);
  });

  it("a missing stroke lowers stroke-valid but not stroke-exist", () => {
    const a = assessWriting(write(hu, { order: [0, 1, 2, 3, 4, 5, 6, 7] }), hu);
    expect(a.missing).toEqual([8]);
    expect(a.metrics["stroke-valid"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(a.metrics["stroke-exist"]).toMatchObject({ value: 8, outOf: 8, stars: 3 });
    expect(a.metrics["stroke-match"]).toMatchObject({ value: 8, outOf: 9 });
  });

  it("an extra scribble lowers stroke-exist but not stroke-valid", () => {
    const scribble: DrawnStroke = [
      { x: 120, y: 880 },
      { x: 160, y: 960 },
      { x: 110, y: 990 },
    ];
    const a = assessWriting([...write(hu), scribble], hu, { fitToReference: false });
    expect(a.extra).toEqual([9]);
    expect(a.metrics["stroke-exist"]).toMatchObject({ value: 9, outOf: 10, stars: 2 });
    expect(a.metrics["stroke-valid"]).toMatchObject({ value: 9, outOf: 9, stars: 3 });
    expect(a.metrics["stroke-match"]).toMatchObject({ value: 9, outOf: 10 });
  });

  it("swapped strokes cost order only, a reversed stroke costs direction only", () => {
    const swapped = assessWriting(write(hu, { order: [1, 0, 2, 3, 4, 5, 6, 7, 8] }), hu);
    // Eight strokes are in the right order relative to each other; one was written too early.
    expect(swapped.metrics["stroke-order"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(swapped.strokes.filter((s) => !s.orderOk).map((s) => s.stroke)).toEqual([1]);
    expect(swapped.metrics["stroke-direction"]).toMatchObject({ value: 9, stars: 3 });
    expect(swapped.metrics["stroke-valid"].stars).toBe(3);

    const reversed = assessWriting(write(hu, { reversed: [5] }), hu);
    expect(reversed.metrics["stroke-direction"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(reversed.metrics["stroke-order"]).toMatchObject({ value: 9, stars: 3 });
    expect(reversed.strokes[5]).toMatchObject({ directionOk: false, orderOk: true });
  });

  it("counts the written strokes that are in the right relative order", () => {
    // Only the first stroke is left out: the other eight follow each other correctly.
    const a = assessWriting(write(hu, { order: [1, 2, 3, 4, 5, 6, 7, 8] }), hu);
    expect(a.missing).toEqual([0]);
    expect(a.metrics["stroke-order"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(a.strokes.map((s) => s.orderOk)).toEqual([false, true, true, true, true, true, true, true, true]);

    // One stroke written far too late costs one point, not one for every stroke it was moved past.
    const late = assessWriting(write(hu, { order: [1, 2, 3, 4, 5, 6, 7, 8, 0] }), hu);
    expect(late.metrics["stroke-order"]).toMatchObject({ value: 8, outOf: 9 });
    expect(late.strokes[0]!.orderOk).toBe(false);

    const backwards = assessWriting(write(hu, { order: [8, 7, 6, 5, 4, 3, 2, 1, 0] }), hu);
    expect(backwards.metrics["stroke-order"]).toMatchObject({ value: 1, outOf: 9, stars: 0 });
  });

  it("keeps the fit when a stroke is missing", () => {
    const shrink = (strokes: DrawnStroke[]): DrawnStroke[] =>
      strokes.map((stroke) => stroke.map((p) => ({ x: 40 + p.x * 0.45, y: 60 + p.y * 0.45 })));

    // 古 without the long horizontal that gives the character its width, written small and off-centre.
    const gu = fixture("古");
    const narrow = assessWriting(shrink(write(gu, { order: [1, 2, 3, 4] })), gu);
    expect(narrow.missing).toEqual([0]);
    expect(narrow.extra).toEqual([]);
    expect(narrow.metrics["stroke-valid"]).toMatchObject({ value: 4, outOf: 5 });
    expect(narrow.metrics["stroke-closeness"]).toMatchObject({ value: 4, outOf: 4, stars: 3 });

    // 十 with only its horizontal: a flat drawing is not stretched over the whole character.
    const ten = fixture("十");
    const flat = assessWriting(write(ten, { order: [0] }), ten);
    expect(flat.missing).toEqual([1]);
    expect(flat.extra).toEqual([]);
    const wobbly = write(ten, { order: [0], bend: (_, points) => points.map((p, i) => ({ x: p.x, y: p.y + (i % 2 === 0 ? 5 : -5) })) });
    expect(assessWriting(wobbly, ten).missing).toEqual([1]);

    // Two strokes missing, one of them on the edge: the fit is redone from the strokes that were found.
    const two = assessWriting(shrink(write(hu, { order: [1, 2, 3, 4, 5, 7, 8] })), hu);
    expect(two.missing).toEqual([0, 6]);
    expect(two.extra).toEqual([]);
  });

  it("keeps the fit when there is a stray mark beside the character", () => {
    const tree = fixture("木");
    const far: DrawnStroke = [
      { x: -600, y: -600 },
      { x: -500, y: -500 },
    ];
    const withStray = assessWriting([...write(tree), far], tree);
    expect(withStray.missing).toEqual([]);
    expect(withStray.extra).toEqual([4]);
    expect(withStray.metrics["stroke-valid"]).toMatchObject({ value: 4, outOf: 4, stars: 3 });
    expect(withStray.metrics["stroke-exist"]).toMatchObject({ value: 4, outOf: 5 });

    // A tick just beside the box squeezes the plain fit only a little; precision is still judged without it.
    const tick: DrawnStroke = [
      { x: 1000, y: 100 },
      { x: 1040, y: 150 },
    ];
    const withTick = assessWriting([...write(tree), tick], tree);
    expect(withTick.extra).toEqual([4]);
    expect(withTick.strokes.every((s) => s.closeness !== null && s.closeness < 1e-6)).toBe(true);
    expect(withTick.metrics["stroke-length"]).toMatchObject({ value: 4, outOf: 4, stars: 3 });
  });

  it("never pairs fewer strokes than the writing as drawn", () => {
    // In place and at full size, but with half of the character missing.
    const half = write(hu, { order: [0, 1, 2, 3, 4] });
    const fitted = assessWriting(half, hu);
    const asDrawn = assessWriting(half, hu, { fitToReference: false });
    expect(asDrawn.missing).toEqual([5, 6, 7, 8]);
    expect(fitted.missing).toEqual([5, 6, 7, 8]);
    expect(fitted.extra).toEqual([]);
  });

  it("judges shape, not size or place, when fitted to the reference", () => {
    const small = write(hu).map((stroke) => stroke.map((p) => ({ x: 40 + p.x * 0.45, y: 60 + p.y * 0.45 })));
    const fitted = assessWriting(small, hu);
    expect(fitted.metrics["stroke-match"]).toMatchObject({ value: 9, outOf: 9, stars: 3 });
    expect(fitted.metrics["stroke-closeness"].stars).toBe(3);
    const asDrawn = assessWriting(small, hu, { fitToReference: false });
    expect(asDrawn.metrics["stroke-match"].value).toBeLessThan(5);
  });

  it("recognises a narrow or flat component written narrower or flatter than the reference", () => {
    const squash = (strokes: DrawnStroke[], kx: number, ky: number): DrawnStroke[] =>
      strokes.map((stroke) => stroke.map((p) => ({ x: 500 + (p.x - 500) * kx, y: 500 + (p.y - 500) * ky })));
    const water = fixture("氵");
    expect(assessWriting(squash(write(water), 0.3, 1), water).missing).toEqual([]);
    // 灬: four dots in a row, a component that is flat already.
    const dots = handGlyph(
      "灬",
      [150, 350, 550, 750].map((x, i) => [
        [x + (i === 0 ? 60 : 0), 650],
        [x + (i === 0 ? 0 : 60), 850],
      ]),
    );
    for (const ky of [0.4, 0.3]) expect(assessWriting(squash(write(dots), 1, ky), dots).missing, `height x${ky}`).toEqual([]);
  });

  it("flags strokes that are too long or too far off", () => {
    const stretched = write(hu, {
      bend: (s, points) => {
        if (s !== 7) return points;
        const mid = points[Math.floor(points.length / 2)]!;
        return points.map((p) => ({ x: mid.x + (p.x - mid.x) * 1.5, y: p.y }));
      },
    });
    const long = assessWriting(stretched, hu);
    expect(long.strokes[7]!.lengthRatio).toBeGreaterThan(1.33);
    expect(long.metrics["stroke-length"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(long.metrics["stroke-valid"].stars).toBe(3);

    const shifted = write(hu, { bend: (s, points) => (s === 7 ? points.map((p) => ({ x: p.x, y: p.y + 75 })) : points) });
    const far = assessWriting(shifted, hu);
    expect(far.strokes[7]!.drawnIndex).toBe(7);
    expect(far.strokes[7]!.closeness).toBeGreaterThan(0.06);
    expect(far.metrics["stroke-closeness"]).toMatchObject({ value: 8, outOf: 9, stars: 2 });
    expect(far.metrics["stroke-length"].stars).toBe(3);
  });

  it("needs timestamps for the speed metrics and marks slow writing down", () => {
    const untimed = assessWriting(write(hu), hu);
    expect(untimed.metrics["stroke-speed"]).toMatchObject({ available: false, stars: 0 });
    expect(untimed.metrics["symbol-speed"].available).toBe(false);
    expect(untimed.metrics["stroke-speed"].note).toMatch(/timestamps/);
    expect(untimed.score).toBe(1); // unavailable metrics do not count against the writer

    const slow = assessWriting(write(hu, { pace: 4 }), hu);
    expect(slow.metrics["stroke-speed"]).toMatchObject({ available: true, value: 0, outOf: 9, stars: 0 });
    expect(slow.metrics["symbol-speed"].value).toBeGreaterThan(2);
    expect(slow.metrics["symbol-speed"].stars).toBeLessThan(3);
    expect(slow.strokes[0]!.durationRatio).toBeCloseTo(4, 5);

    const recorded = assessWriting(write(hu, { pace: 4 }), hu, {
      referenceDurationsMs: hu.strokes.map((s) => (polylineLength(s.median) / hu.size / DEFAULT_REFERENCE_PACE) * 4000),
    });
    expect(recorded.metrics["stroke-speed"].stars).toBe(3);

    const partly = write(hu, { pace: 1 }).map((stroke, i) => (i === 3 ? stroke.map((p) => ({ x: p.x, y: p.y })) : stroke));
    expect(assessWriting(partly, hu).metrics["symbol-speed"].available).toBe(false);
  });

  it("maps the edit count to stars and leaves the metric out when it is not reported", () => {
    const writing = write(hu);
    expect(assessWriting(writing, hu).metrics["stroke-edit"]).toMatchObject({ available: false, stars: 0 });
    expect([0, 1, 2, 3, 5, 6].map((edits) => assessWriting(writing, hu, { edits }).metrics["stroke-edit"].stars)).toEqual([3, 2, 2, 1, 1, 0]);
    expect(assessWriting(writing, hu, { edits: 3, thresholds: { maxEdits: [3, 4, 5] } }).metrics["stroke-edit"].stars).toBe(3);
  });

  it("handles nothing drawn, single points and flat characters", () => {
    const empty = assessWriting([], hu, { edits: 0 });
    expect(empty.score).toBe(0);
    expect(empty.missing).toHaveLength(9);
    expect(empty.metrics["stroke-exist"]).toMatchObject({ value: 0, outOf: 0, stars: 0 });
    expect(empty.metrics["stroke-edit"].stars).toBe(0);
    expect(empty.metrics["symbol-speed"]).toMatchObject({ available: false, note: "nothing was written" });

    const tap = assessWriting([[{ x: 500, y: 500 }]], hu);
    expect(tap.extra).toEqual([0]);
    expect(tap.metrics["stroke-match"].value).toBe(0);

    // A one-stroke horizontal character has no height to fit to: it is centred, not stretched.
    const flat: Glyph = { ...fixture("十"), strokes: [fixture("十").strokes[0]!], root: { id: "r", element: "一", strokes: [0], children: [] } };
    const wobbly = [resample(flat.strokes[0]!.median, 16).map((p, i) => ({ x: p.x, y: p.y + (i % 2 === 0 ? 6 : -6) }))];
    expect(assessWriting(wobbly, flat).metrics["stroke-match"]).toMatchObject({ value: 1, outOf: 1, stars: 3 });
  });

  it("is deterministic", () => {
    const writing = write(hu, { order: [1, 0, 2, 3, 4, 5, 6, 8, 7], reversed: [2], pace: 1.5 });
    expect(assessWriting(writing, hu, { edits: 1 })).toEqual(assessWriting(writing, hu, { edits: 1 }));
  });
});
