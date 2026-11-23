/**
 * Hand-made glyphs for this module's tests: straight lines in a 1000-unit square, drawn
 * here and taken from no dataset. Not part of the public API (not re-exported).
 */

import { decodeGlyph } from "../glyph/codec";
import type { ComponentRecord, Glyph, PathKind } from "../glyph/types";
import type { Rng } from "../util/rng";

export type TestLine = readonly (readonly [number, number])[];

const TEST_SET = {
  script: "ja",
  size: 1000,
  source: { name: "components-tests", license: "MIT", attribution: "Synthetic test shapes", url: "about:blank" },
} as const;

/** A glyph whose strokes are the given polylines; flat tree unless one is given. */
export function handGlyph(
  char: string,
  lines: readonly TestLine[],
  tree?: ComponentRecord,
  pathKind: PathKind = "centerline",
): Glyph {
  return decodeGlyph(
    {
      char,
      strokes: lines.map((line) => [
        line.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(""),
        line.flatMap(([x, y]) => [x, y]),
      ]),
      tree: tree ?? { s: lines.map((_, i) => i) },
    },
    { ...TEST_SET, pathKind },
  );
}

/** The same glyph with the path of one stroke replaced (medians untouched). */
export function withPath(glyph: Glyph, stroke: number, path: string): Glyph {
  return { ...glyph, strokes: glyph.strokes.map((s, i) => (i === stroke ? { ...s, path } : s)) };
}

/** A box outline drawn as three strokes, like the fixture 口, at the given place. */
export function boxLines(x: number, y: number, w: number, h: number): TestLine[] {
  return [
    [
      [x, y],
      [x, y + h],
    ],
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
    ],
    [
      [x, y + h],
      [x + w, y + h],
    ],
  ];
}

/** A cross drawn as two strokes, like the fixture 十, at the given place. */
export function crossLines(x: number, y: number, w: number, h: number): TestLine[] {
  return [
    [
      [x, y + h / 2],
      [x + w, y + h / 2],
    ],
    [
      [x + w / 2, y],
      [x + w / 2, y + h],
    ],
  ];
}

/** 土-like: short bar, upright, long bar at the foot. */
export const EARTH_LINES: readonly TestLine[] = [
  [
    [300, 400],
    [700, 400],
  ],
  [
    [500, 150],
    [500, 850],
  ],
  [
    [100, 850],
    [900, 850],
  ],
];

/** 士-like: the same strokes with the bars' lengths traded. */
export const SCHOLAR_LINES: readonly TestLine[] = [
  [
    [100, 400],
    [900, 400],
  ],
  [
    [500, 150],
    [500, 850],
  ],
  [
    [300, 850],
    [700, 850],
  ],
];

/**
 * A glyph with a random component tree up to three groups deep: groups may be named
 * (from a handful of letters, so names repeat) or anonymous, may own loose strokes next
 * to their children, and overlap freely. For checking that nothing breaks on odd data.
 */
export function randomTreeGlyph(rng: Rng, char: string): Glyph {
  const lines: TestLine[] = [];
  const scribble = (count: number, reach: number): number[] => {
    const x = rng.int(1000 - reach);
    const y = rng.int(1000 - reach);
    return Array.from({ length: count }, () => {
      lines.push(Array.from({ length: 2 + rng.int(3) }, () => [x + rng.int(reach + 1), y + rng.int(reach + 1)] as const));
      return lines.length - 1;
    });
  };
  const group = (depth: number): ComponentRecord => {
    const name = rng.next() < 0.7 && depth > 0 ? { e: "abcdefgh"[rng.int(8)]! } : {};
    if (depth < 3 && rng.next() < 0.5) {
      const children = Array.from({ length: 1 + rng.int(3) }, () => group(depth + 1));
      return rng.next() < 0.3 ? { ...name, c: children, s: scribble(1 + rng.int(2), 150) } : { ...name, c: children };
    }
    return { ...name, s: scribble(1 + rng.int(4), 250) };
  };
  const tree = group(0);
  return handGlyph(char, lines, tree);
}
