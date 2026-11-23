import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { createRng } from "../util/rng";
import { judgeAttempt, WRONG_ORDER_MARGIN } from "./attempt";
import { matchStroke } from "./match";
import { glyphOf, penAlong } from "./test-helpers";

const tree = fixture("木");
const trace = (stroke: number, reverse = false) => penAlong(tree.strokes[stroke]!.median, { reverse });

/** Two horizontals 0.08 of the glyph apart: close enough that a drawing can lie on both. */
const rails = glyphOf(1000, [[200, 400], [800, 400]], [[200, 480], [800, 480]]);
const railAt = (y: number, reverse = false) => penAlong([{ x: 200, y }, { x: 800, y }], { reverse });

describe("judgeAttempt", () => {
  it("accepts each stroke when it is its turn", () => {
    tree.strokes.forEach((_, index) => {
      const result = judgeAttempt(trace(index), tree, index);
      expect(result).toMatchObject({ verdict: "correct", expected: index, resembles: index });
      expect(result.match.matched).toBe(true);
    });
  });

  it("reports the comparison with the expected stroke whatever the verdict", () => {
    const pen = trace(2);
    const result = judgeAttempt(pen, tree, 0);
    expect(result.verdict).toBe("wrong-order");
    expect(result.match).toEqual(matchStroke(pen, tree.strokes[0]!.median, tree.size));
  });

  it("calls the right stroke drawn backwards a wrong direction", () => {
    const result = judgeAttempt(trace(1, true), tree, 1);
    expect(result).toMatchObject({ verdict: "wrong-direction", expected: 1, resembles: 1 });
    expect(result.match).toMatchObject({ onStroke: true, directionOk: false, matched: false });
  });

  it("accepts a backwards stroke when direction is not enforced, and still reports it", () => {
    const result = judgeAttempt(trace(1, true), tree, 1, { enforceDirection: false });
    expect(result).toMatchObject({ verdict: "correct", resembles: 1 });
    expect(result.match.directionOk).toBe(false);
    expect(judgeAttempt(trace(1, true), tree, 1, { enforceDirection: true }).verdict).toBe("wrong-direction");
  });

  it("calls a later stroke drawn too early a wrong order, in either direction", () => {
    expect(judgeAttempt(trace(3), tree, 1)).toMatchObject({ verdict: "wrong-order", expected: 1, resembles: 3 });
    expect(judgeAttempt(trace(3, true), tree, 1)).toMatchObject({ verdict: "wrong-order", resembles: 3 });
  });

  it("calls a stroke that is already written a miss, and says which one it resembles", () => {
    expect(judgeAttempt(trace(0), tree, 2)).toMatchObject({ verdict: "miss", expected: 2, resembles: 0 });
  });

  it("calls a drawing that lies on no stroke a miss resembling nothing", () => {
    const scribble = penAlong([{ x: 850, y: 80 }, { x: 950, y: 60 }, { x: 900, y: 150 }]);
    expect(judgeAttempt(scribble, tree, 0)).toMatchObject({ verdict: "miss", resembles: null });
    expect(judgeAttempt([], tree, 0)).toMatchObject({ verdict: "miss", resembles: null });
    expect(judgeAttempt([{ x: 500, y: 350 }], tree, 0)).toMatchObject({ verdict: "miss", resembles: null });
  });

  describe("written", () => {
    it("defaults to every stroke before the expected one", () => {
      expect(judgeAttempt(trace(0), tree, 1).verdict).toBe("miss");
      expect(judgeAttempt(trace(2), tree, 1).verdict).toBe("wrong-order");
    });

    it("can be given explicitly for games that allow any order", () => {
      expect(judgeAttempt(trace(0), tree, 1, { written: [] })).toMatchObject({ verdict: "wrong-order", resembles: 0 });
      expect(judgeAttempt(trace(3), tree, 1, { written: [0, 3] })).toMatchObject({ verdict: "miss", resembles: 3 });
    });

    it("does not stop the expected stroke from being judged when it is listed, and ignores stray indices", () => {
      expect(judgeAttempt(trace(1), tree, 1, { written: [1, 99, -1] }).verdict).toBe("correct");
    });
  });

  describe("a drawing that lies on two strokes", () => {
    it("goes to the expected stroke while the other is not clearly better", () => {
      expect(judgeAttempt(railAt(400), rails, 0)).toMatchObject({ verdict: "correct", resembles: 0 });
      expect(judgeAttempt(railAt(440), rails, 0)).toMatchObject({ verdict: "correct", resembles: 0 });

      // Nearer to the other rail, but by less than the margin.
      const leaning = railAt(455);
      const own = matchStroke(leaning, rails.strokes[0]!.median, rails.size);
      const other = matchStroke(leaning, rails.strokes[1]!.median, rails.size);
      expect(other.score).toBeGreaterThan(own.score);
      expect(other.score - own.score).toBeLessThan(WRONG_ORDER_MARGIN);
      expect(judgeAttempt(leaning, rails, 0)).toMatchObject({ verdict: "correct", resembles: 0 });
    });

    it("goes to an unwritten stroke that fits better by more than the margin", () => {
      const onOther = railAt(480);
      const own = matchStroke(onOther, rails.strokes[0]!.median, rails.size);
      expect(own.matched).toBe(true);
      expect(1 - own.score).toBeGreaterThan(WRONG_ORDER_MARGIN);
      expect(judgeAttempt(onOther, rails, 0)).toMatchObject({ verdict: "wrong-order", expected: 0, resembles: 1 });
      expect(judgeAttempt(railAt(460), rails, 0).verdict).toBe("wrong-order");
    });

    it("stays with the expected stroke when the better fit is already written", () => {
      expect(judgeAttempt(railAt(400), rails, 1)).toMatchObject({ verdict: "correct", resembles: 1 });
      expect(judgeAttempt(railAt(480), rails, 0, { written: [1] })).toMatchObject({ verdict: "correct", resembles: 0 });
    });

    it("applies the same rule to a backwards drawing", () => {
      expect(judgeAttempt(railAt(400, true), rails, 0)).toMatchObject({ verdict: "wrong-direction", resembles: 0 });
      expect(judgeAttempt(railAt(480, true), rails, 0)).toMatchObject({ verdict: "wrong-order", resembles: 1 });
      expect(judgeAttempt(railAt(480, true), rails, 0, { enforceDirection: false }).verdict).toBe("wrong-order");
    });

    it("prefers an unwritten stroke over a written one that fits exactly as well", () => {
      const twins = glyphOf(1000, [[200, 300], [800, 300]], [[200, 300], [800, 300]], [[500, 600], [500, 900]]);
      const pen = penAlong(twins.strokes[0]!.median);
      expect(judgeAttempt(pen, twins, 2, { written: [0] })).toMatchObject({ verdict: "wrong-order", resembles: 1 });
      expect(judgeAttempt(pen, twins, 2, { written: [1] })).toMatchObject({ verdict: "wrong-order", resembles: 0 });
      expect(judgeAttempt(pen, twins, 2, { written: [0, 1] })).toMatchObject({ verdict: "miss", resembles: 0 });
    });
  });

  it("passes the match options through", () => {
    const pen = penAlong(tree.strokes[0]!.median, { dy: 150 });
    expect(judgeAttempt(pen, tree, 0).verdict).toBe("miss");
    expect(judgeAttempt(pen, tree, 0, { match: { leniency: 2 } }).verdict).toBe("correct");
  });

  it("throws when the expected stroke does not exist", () => {
    for (const expected of [-1, 4, 1.5, NaN, Infinity]) {
      expect(() => judgeAttempt(trace(0), tree, expected)).toThrow(RangeError);
    }
    expect(() => judgeAttempt(trace(0), glyphOf(1000), 0)).toThrow(RangeError);
  });

  it("judges a whole practice session on every fixture written by a human-looking hand", () => {
    for (const glyph of FIXTURES.values()) {
      const rng = createRng(`attempt:${glyph.char}`);
      glyph.strokes.forEach((stroke, index) => {
        const pen = penAlong(stroke.median, { sloppiness: 40, rng });
        expect(judgeAttempt(pen, glyph, index).verdict, `${glyph.char} stroke ${index}`).toBe("correct");
        expect(judgeAttempt([...pen].reverse(), glyph, index).verdict, `${glyph.char} stroke ${index} reversed`).toBe(
          "wrong-direction",
        );
      });
    }
  });

  it("follows a learner through 胡 with the usual mistakes", () => {
    const hu = fixture("胡");
    const rng = createRng("learner");
    const draw = (stroke: number, reverse = false) =>
      penAlong(hu.strokes[stroke]!.median, { sloppiness: 30, rng, reverse });

    expect(judgeAttempt(draw(0), hu, 0).verdict).toBe("correct");
    // Jumps ahead to the 口 before finishing 十.
    expect(judgeAttempt(draw(2), hu, 1)).toMatchObject({ verdict: "wrong-order", resembles: 2 });
    expect(judgeAttempt(draw(1), hu, 1).verdict).toBe("correct");
    // Draws the left side of 口 from the bottom up.
    expect(judgeAttempt(draw(2, true), hu, 2)).toMatchObject({ verdict: "wrong-direction", resembles: 2 });
    expect(judgeAttempt(draw(2), hu, 2).verdict).toBe("correct");
    // Goes over the first stroke again instead of continuing.
    expect(judgeAttempt(draw(0), hu, 3)).toMatchObject({ verdict: "miss", resembles: 0 });
    // Starts the 月 before closing the 口.
    expect(judgeAttempt(draw(5), hu, 3)).toMatchObject({ verdict: "wrong-order", resembles: 5 });
    for (let stroke = 3; stroke < hu.strokes.length; stroke++) {
      expect(judgeAttempt(draw(stroke), hu, stroke), `stroke ${stroke}`).toMatchObject({
        verdict: "correct",
        resembles: stroke,
      });
    }
  });
});
