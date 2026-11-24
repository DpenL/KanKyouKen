import { describe, expect, it, vi } from "vitest";
import type { DrawnStroke, StrokeSample } from "@kankyouken/mechanics/stroke";
import { clientToGlyph, createStrokeCapture } from "./capture";

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  inverse(): Matrix;
}

function matrix(a: number, b: number, c: number, d: number, e: number, f: number): Matrix {
  return {
    a,
    b,
    c,
    d,
    e,
    f,
    inverse() {
      const det = a * d - b * c;
      if (det === 0) throw new Error("matrix is not invertible");
      return matrix(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
    },
  };
}

/** A 1000-unit glyph square shown at half size, 20 px from the left and 40 px from the top. */
const HALF_SCALE = matrix(0.5, 0, 0, 0.5, 20, 40);

type Handler = (event: unknown) => void;

function createTarget(ctm: Matrix | null = HALF_SCALE) {
  const listeners = new Map<string, Set<Handler>>();
  const captured = new Set<number>();
  const target = {
    style: { touchAction: "pan-y" },
    ctm,
    addEventListener(type: string, handler: Handler): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: Handler): void {
      listeners.get(type)?.delete(handler);
    },
    setPointerCapture: vi.fn((id: number) => void captured.add(id)),
    releasePointerCapture: vi.fn((id: number) => void captured.delete(id)),
    hasPointerCapture: (id: number): boolean => captured.has(id),
    getScreenCTM(): Matrix | null {
      return this.ctm;
    },
  };
  let clock = 100;
  const dispatch = (type: string, init: Record<string, unknown> = {}) => {
    const event = {
      type,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 40,
      timeStamp: (clock += 8),
      preventDefault: vi.fn(),
      ...init,
    };
    for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    return event;
  };
  const listenerCount = (): number => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { svg: target as unknown as SVGSVGElement, target, captured, dispatch, listenerCount };
}

/** Client position of a glyph-space point under HALF_SCALE. */
const at = (x: number, y: number) => ({ clientX: 20 + x / 2, clientY: 40 + y / 2 });

function record() {
  const log: string[] = [];
  const starts: StrokeSample[] = [];
  const moves: { sample: StrokeSample; stroke: DrawnStroke }[] = [];
  const ends: DrawnStroke[] = [];
  return {
    log,
    starts,
    moves,
    ends,
    handlers: {
      onStart(sample: StrokeSample) {
        log.push("start");
        starts.push(sample);
      },
      onMove(sample: StrokeSample, stroke: DrawnStroke) {
        log.push("move");
        moves.push({ sample, stroke });
      },
      onEnd(stroke: DrawnStroke) {
        log.push("end");
        ends.push(stroke);
      },
      onCancel() {
        log.push("cancel");
      },
    },
  };
}

describe("clientToGlyph", () => {
  it("inverts the screen matrix", () => {
    const { svg } = createTarget();
    expect(clientToGlyph(svg, 20, 40)).toEqual({ x: 0, y: 0 });
    expect(clientToGlyph(svg, 270, 290)).toEqual({ x: 500, y: 500 });
    expect(clientToGlyph(svg, 520, 540)).toEqual({ x: 1000, y: 1000 });
  });

  it("handles a rotated and skewed view", () => {
    const { svg } = createTarget(matrix(0, 2, -2, 0, 300, 10));
    const p = clientToGlyph(svg, 300 - 2 * 40, 10 + 2 * 15);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(40);
  });

  it("gives NaN when the SVG is not rendered or has no area", () => {
    expect(clientToGlyph(createTarget(null).svg, 5, 5)).toEqual({ x: Number.NaN, y: Number.NaN });
    expect(clientToGlyph(createTarget(matrix(0, 0, 0, 0, 0, 0)).svg, 5, 5)).toEqual({
      x: Number.NaN,
      y: Number.NaN,
    });
  });
});

describe("createStrokeCapture", () => {
  it("turns touch-action off and puts the old value back on dispose", () => {
    const { svg, target, listenerCount } = createTarget();
    const capture = createStrokeCapture(svg, {});
    expect(target.style.touchAction).toBe("none");
    expect(listenerCount()).toBe(5);
    capture.dispose();
    capture.dispose();
    expect(target.style.touchAction).toBe("pan-y");
    expect(listenerCount()).toBe(0);
  });

  it("reports a horizontal stroke in glyph space with event times", () => {
    const { svg, target, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);

    const down = dispatch("pointerdown", { ...at(100, 450), timeStamp: 1000 });
    expect(target.setPointerCapture).toHaveBeenCalledWith(1);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(rec.starts).toEqual([{ x: 100, y: 450, t: 1000 }]);

    dispatch("pointermove", { ...at(102, 450), timeStamp: 1008 });
    dispatch("pointermove", { ...at(300, 452), timeStamp: 1016 });
    dispatch("pointermove", { ...at(600, 448), timeStamp: 1024 });
    dispatch("pointerup", { ...at(901, 450), timeStamp: 1032 });

    expect(rec.log).toEqual(["start", "move", "move", "end"]);
    expect(rec.moves[0]!.sample).toEqual({ x: 300, y: 452, t: 1016 });
    expect(rec.moves[0]!.stroke).toHaveLength(2);
    expect(rec.moves[1]!.stroke).toHaveLength(3);
    expect(rec.moves[1]!.stroke).not.toBe(rec.moves[0]!.stroke);
    expect(rec.ends).toEqual([
      [
        { x: 100, y: 450, t: 1000 },
        { x: 300, y: 452, t: 1016 },
        { x: 600, y: 448, t: 1024 },
        { x: 901, y: 450, t: 1032 },
      ],
    ]);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("always ends on the pen-up position, even inside the thinning distance", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers, { minDistance: 50 });
    dispatch("pointerdown", at(100, 100));
    dispatch("pointermove", at(200, 100));
    dispatch("pointermove", at(230, 100));
    dispatch("pointerup", at(240, 100));
    expect(rec.ends[0]!.map((s) => s.x)).toEqual([100, 200, 240]);
  });

  it("reports a tap as a one-sample stroke", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", { ...at(500, 500), timeStamp: 10 });
    dispatch("pointerup", { ...at(500, 500), timeStamp: 90 });
    expect(rec.ends).toEqual([[{ x: 500, y: 500, t: 10 }]]);
  });

  it("uses coalesced events when the browser provides them", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", { ...at(0, 0), timeStamp: 10 });
    dispatch("pointermove", {
      ...at(300, 0),
      timeStamp: 40,
      getCoalescedEvents: () => [
        { ...at(100, 0), timeStamp: 20 },
        { ...at(200, 0), timeStamp: 30 },
        { ...at(300, 0), timeStamp: 0 },
      ],
    });
    dispatch("pointermove", { ...at(400, 0), timeStamp: 50, getCoalescedEvents: () => [] });
    dispatch("pointerup", { ...at(400, 0), timeStamp: 60 });
    expect(rec.ends[0]).toEqual([
      { x: 0, y: 0, t: 10 },
      { x: 100, y: 0, t: 20 },
      { x: 200, y: 0, t: 30 },
      { x: 300, y: 0, t: 40 },
      { x: 400, y: 0, t: 50 },
    ]);
  });

  it("ignores other buttons and every other pointer during a stroke", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);

    dispatch("pointerdown", { button: 2 });
    expect(rec.log).toEqual([]);

    dispatch("pointerdown", { ...at(100, 100), pointerId: 4, pointerType: "touch" });
    dispatch("pointerdown", { ...at(900, 900), pointerId: 1, pointerType: "mouse" });
    dispatch("pointermove", { ...at(900, 800), pointerId: 1, pointerType: "mouse" });
    dispatch("pointerup", { ...at(900, 800), pointerId: 1, pointerType: "mouse" });
    // A second finger landing on the square while the first one writes.
    dispatch("pointerdown", { ...at(700, 700), isPrimary: false, pointerId: 9, pointerType: "touch" });
    dispatch("pointermove", { ...at(700, 600), isPrimary: false, pointerId: 9, pointerType: "touch" });
    dispatch("pointerup", { ...at(700, 600), isPrimary: false, pointerId: 9, pointerType: "touch" });
    dispatch("pointermove", { ...at(100, 300), pointerId: 4, pointerType: "touch" });
    dispatch("pointerup", { ...at(100, 500), pointerId: 4, pointerType: "touch" });

    expect(rec.log).toEqual(["start", "move", "end"]);
    expect(rec.ends[0]!.map((s) => [s.x, s.y])).toEqual([
      [100, 100],
      [100, 300],
      [100, 500],
    ]);
  });

  it("lets a finger write while a thumb or palm rests elsewhere on the page", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);

    // The resting touch went down outside the SVG, so the target never heard of it; the browser
    // made it the primary pointer, and the finger that writes is therefore not primary.
    const finger = { isPrimary: false, pointerId: 7, pointerType: "touch" };
    for (const y of [200, 600]) {
      dispatch("pointerdown", { ...at(100, y), ...finger });
      dispatch("pointermove", { ...at(500, y), ...finger });
      dispatch("pointerup", { ...at(900, y), ...finger });
    }
    expect(rec.log).toEqual(["start", "move", "end", "start", "move", "end"]);
    expect(rec.ends.map((stroke) => stroke.map((s) => [s.x, s.y]))).toEqual([
      [
        [100, 200],
        [500, 200],
        [900, 200],
      ],
      [
        [100, 600],
        [500, 600],
        [900, 600],
      ],
    ]);
  });

  it("does not take the resting hand coming down again for a missed pen-up", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);

    dispatch("pointerdown", { ...at(100, 100), isPrimary: false, pointerId: 7, pointerType: "touch" });
    // The palm lifts and lands on the square: a new primary touch while the finger is still writing.
    dispatch("pointerdown", { ...at(800, 900), isPrimary: true, pointerId: 8, pointerType: "touch" });
    dispatch("pointermove", { ...at(100, 500), isPrimary: false, pointerId: 7, pointerType: "touch" });
    dispatch("pointerup", { ...at(100, 900), isPrimary: false, pointerId: 7, pointerType: "touch" });
    expect(rec.log).toEqual(["start", "move", "end"]);
    expect(rec.ends[0]!.map((s) => s.y)).toEqual([100, 500, 900]);
  });

  it("asks `enabled` on pen-down only", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    let enabled = false;
    createStrokeCapture(svg, rec.handlers, { enabled: () => enabled });

    const ignored = dispatch("pointerdown", at(0, 0));
    dispatch("pointermove", at(100, 0));
    dispatch("pointerup", at(100, 0));
    expect(rec.log).toEqual([]);
    expect(ignored.preventDefault).not.toHaveBeenCalled();

    enabled = true;
    dispatch("pointerdown", at(0, 0));
    enabled = false;
    dispatch("pointermove", at(100, 0));
    dispatch("pointerup", at(200, 0));
    expect(rec.log).toEqual(["start", "move", "end"]);
  });

  it("cancels on pointercancel and is ready for the next stroke", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", at(0, 0));
    dispatch("pointermove", at(100, 0));
    dispatch("pointercancel");
    dispatch("pointermove", at(200, 0));
    dispatch("pointerup", at(200, 0));
    expect(rec.log).toEqual(["start", "move", "cancel"]);

    dispatch("pointerdown", at(10, 10));
    dispatch("pointerup", at(60, 10));
    expect(rec.log).toEqual(["start", "move", "cancel", "start", "end"]);
    expect(rec.ends[0]!.map((s) => s.x)).toEqual([10, 60]);
  });

  it("cancels when pointer capture is lost mid-stroke but not after a normal pen-up", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", at(0, 0));
    dispatch("lostpointercapture");
    expect(rec.log).toEqual(["start", "cancel"]);

    dispatch("pointerdown", at(0, 0));
    dispatch("pointerup", at(50, 0));
    dispatch("lostpointercapture");
    expect(rec.log).toEqual(["start", "cancel", "start", "end"]);
  });

  it("recovers from a missed pen-up when the same kind of pointer goes down again", () => {
    const { svg, dispatch } = createTarget();
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", { ...at(0, 0), pointerId: 11, pointerType: "touch" });
    dispatch("pointerdown", { ...at(500, 500), pointerId: 12, pointerType: "touch" });
    dispatch("pointerup", { ...at(600, 500), pointerId: 12, pointerType: "touch" });
    expect(rec.log).toEqual(["start", "cancel", "start", "end"]);
    expect(rec.ends[0]!.map((s) => s.x)).toEqual([500, 600]);
  });

  it("ignores gestures while the SVG cannot be measured and skips unmeasurable positions", () => {
    const { svg, target, dispatch } = createTarget(null);
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", at(0, 0));
    dispatch("pointerup", at(10, 0));
    expect(rec.log).toEqual([]);

    target.ctm = HALF_SCALE;
    dispatch("pointerdown", at(0, 0));
    target.ctm = null;
    dispatch("pointermove", at(100, 0));
    target.ctm = HALF_SCALE;
    dispatch("pointermove", at(200, 0));
    target.ctm = null;
    dispatch("pointerup", at(300, 0));
    expect(rec.ends[0]!.map((s) => s.x)).toEqual([0, 200]);
  });

  it("still draws when pointer capture is refused", () => {
    const { svg, target, dispatch } = createTarget();
    target.setPointerCapture.mockImplementation(() => {
      throw new Error("NotFoundError");
    });
    const rec = record();
    createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", at(0, 0));
    dispatch("pointerup", at(100, 0));
    expect(rec.log).toEqual(["start", "end"]);
  });

  it("cancel() abandons the stroke in progress and does nothing otherwise", () => {
    const { svg, captured, dispatch } = createTarget();
    const rec = record();
    const capture = createStrokeCapture(svg, rec.handlers);
    capture.cancel();
    expect(rec.log).toEqual([]);

    dispatch("pointerdown", at(0, 0));
    expect(captured.has(1)).toBe(true);
    capture.cancel();
    expect(captured.has(1)).toBe(false);
    dispatch("pointermove", at(100, 0));
    dispatch("pointerup", at(100, 0));
    expect(rec.log).toEqual(["start", "cancel"]);
  });

  it("stops reporting when a move handler cancels the stroke", () => {
    const { svg, dispatch } = createTarget();
    const log: string[] = [];
    const capture = createStrokeCapture(svg, {
      onMove: () => {
        log.push("move");
        capture.cancel();
      },
      onCancel: () => log.push("cancel"),
    });
    dispatch("pointerdown", at(0, 0));
    dispatch("pointermove", {
      ...at(200, 0),
      getCoalescedEvents: () => [at(100, 0), at(200, 0)].map((p) => ({ ...p, timeStamp: 5 })),
    });
    expect(log).toEqual(["move", "cancel"]);
  });

  it("abandons a stroke silently on dispose and hears nothing afterwards", () => {
    const { svg, captured, dispatch } = createTarget();
    const rec = record();
    const capture = createStrokeCapture(svg, rec.handlers);
    dispatch("pointerdown", at(0, 0));
    capture.dispose();
    expect(captured.size).toBe(0);
    dispatch("pointermove", at(100, 0));
    dispatch("pointerup", at(100, 0));
    dispatch("pointerdown", at(0, 0));
    expect(rec.log).toEqual(["start"]);
  });

  it("works with no handlers at all", () => {
    const { svg, dispatch } = createTarget();
    createStrokeCapture(svg, {});
    expect(() => {
      dispatch("pointerdown", at(0, 0));
      dispatch("pointermove", at(100, 0));
      dispatch("pointerup", at(100, 0));
      dispatch("pointerdown", at(0, 0));
      dispatch("pointercancel");
    }).not.toThrow();
  });
});
