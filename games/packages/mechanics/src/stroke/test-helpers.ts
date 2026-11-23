/** Shared by the stroke tests only; not part of the public API. */
import type { Glyph } from "../glyph/types";
import { pointAt, polylineLength, type Point } from "../util/geometry";
import type { Rng } from "../util/rng";

export interface PenOptions {
  /** Number of pen samples. Default 24. */
  readonly count?: number;
  /** Draw from the end of the line to its start. */
  readonly reverse?: boolean;
  /** Shift every sample. */
  readonly dx?: number;
  readonly dy?: number;
  /**
   * How imprecise the hand is, in glyph units; needs `rng`. The stroke is shifted as a
   * whole by up to half of it per axis, sways smoothly by about as much, starts late and
   * stops early by up to the full amount, and carries two units of sensor noise.
   */
  readonly sloppiness?: number;
  readonly rng?: Rng;
}

/** Pen samples a player might produce when writing the stroke whose spine is `line`. */
export function penAlong(line: readonly Point[], options: PenOptions = {}): Point[] {
  const { count = 24, reverse = false, dx = 0, dy = 0, sloppiness = 0, rng } = options;
  const sloppy = rng !== undefined && sloppiness > 0;
  const signed = (): number => (sloppy ? rng.next() * 2 - 1 : 0);
  const length = polylineLength(line);
  const trim = (): number => (length > 0 ? Math.max(0, (signed() * sloppiness) / length) : 0);
  const from = trim();
  const to = 1 - trim();
  const shift = { x: (signed() * sloppiness) / 2, y: (signed() * sloppiness) / 2 };
  const phase = sloppy ? rng.next() * Math.PI * 2 : 0;
  const noise = sloppy ? 2 : 0;

  const samples: Point[] = [];
  for (let i = 0; i < count; i++) {
    const f = from + ((to - from) * i) / (count - 1);
    const p = pointAt(line, f);
    const sway = Math.sin(phase + f * Math.PI * 2) * sloppiness * 0.35;
    samples.push({
      x: p.x + dx + shift.x + sway + signed() * noise,
      y: p.y + dy + shift.y + sway + signed() * noise,
    });
  }
  return reverse ? samples.reverse() : samples;
}

/** A flat glyph in a square of side `size` whose strokes are the given polylines. */
export function glyphOf(size: number, ...medians: (readonly (readonly [number, number])[])[]): Glyph {
  return {
    char: "x",
    script: "ja",
    size,
    pathKind: "centerline",
    strokes: medians.map((median) => ({
      path: median.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(""),
      median: median.map(([x, y]) => ({ x, y })),
    })),
    root: { id: "r", element: "x", strokes: medians.map((_, i) => i), children: [] },
    source: { name: "test", license: "MIT" },
  };
}
