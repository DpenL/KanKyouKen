/**
 * Free writing: a whole character written from memory with no feedback, scored afterwards.
 *
 * The two axes, stroke order and stroke direction, each counted per reference stroke,
 * follow the scoring of the Radical Tunes studies. How drawn strokes are attributed to
 * reference strokes (an optimal one-to-one assignment over match scores) and the gentler
 * `orderRelative` measure are our own design.
 */

import type { Glyph } from "../glyph/types";
import { resolveMatchOptions } from "./defaults";
import { matchStroke } from "./match";
import type { DrawnStroke, FreeWritingOptions, FreeWritingScore, FreeWritingStrokeScore } from "./types";

/** Default `FreeWritingOptions.minScore`. */
export const DEFAULT_MIN_ATTRIBUTION_SCORE = 0.35;

/**
 * Optimal one-to-one assignment of rows to columns (Hungarian algorithm, potentials
 * form, O(min(r,c)^2 * max(r,c))). Returns, for each row, the column it is paired with,
 * or null when the row stays unpaired; min(rows, columns) pairs are always made.
 * `goal` "max" (default) maximises the sum of the chosen entries, "min" minimises it.
 *
 * The matrix may be rectangular. An empty matrix gives an empty result; a matrix whose
 * rows are empty pairs nothing. Ties are broken deterministically but arbitrarily.
 * Throws a RangeError when rows differ in length or an entry is not a finite number.
 */
export function hungarian(matrix: readonly (readonly number[])[], goal: "max" | "min" = "max"): (number | null)[] {
  const rows = matrix.length;
  const cols = rows === 0 ? 0 : matrix[0]!.length;
  for (const row of matrix) {
    if (row.length !== cols) throw new RangeError("hungarian: rows differ in length");
    for (const value of row) {
      if (!Number.isFinite(value)) throw new RangeError("hungarian: entries must be finite numbers");
    }
  }
  const result = new Array<number | null>(rows).fill(null);
  if (rows === 0 || cols === 0) return result;

  // The algorithm wants at least as many columns as rows, and minimises.
  const transposed = rows > cols;
  const n = transposed ? cols : rows;
  const m = transposed ? rows : cols;
  const sign = goal === "max" ? -1 : 1;
  const cost = (i: number, j: number): number => sign * (transposed ? matrix[j]![i]! : matrix[i]![j]!);

  // Index 0 is a sentinel; real rows and columns are 1-based.
  const rowPotential = new Array<number>(n + 1).fill(0);
  const colPotential = new Array<number>(m + 1).fill(0);
  const rowOfCol = new Array<number>(m + 1).fill(0);
  const previousCol = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    rowOfCol[0] = i;
    let col = 0;
    const slack = new Array<number>(m + 1).fill(Infinity);
    const visited = new Array<boolean>(m + 1).fill(false);
    do {
      visited[col] = true;
      const row = rowOfCol[col]!;
      let delta = Infinity;
      let nextCol = 0;
      for (let j = 1; j <= m; j++) {
        if (visited[j]) continue;
        const reduced = cost(row - 1, j - 1) - rowPotential[row]! - colPotential[j]!;
        if (reduced < slack[j]!) {
          slack[j] = reduced;
          previousCol[j] = col;
        }
        if (slack[j]! < delta) {
          delta = slack[j]!;
          nextCol = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (visited[j]) {
          rowPotential[rowOfCol[j]!]! += delta;
          colPotential[j]! -= delta;
        } else {
          slack[j]! -= delta;
        }
      }
      col = nextCol;
    } while (rowOfCol[col] !== 0);
    do {
      const prev = previousCol[col]!;
      rowOfCol[col] = rowOfCol[prev]!;
      col = prev;
    } while (col !== 0);
  }

  for (let j = 1; j <= m; j++) {
    const i = rowOfCol[j]!;
    if (i === 0) continue;
    if (transposed) result[j - 1] = i - 1;
    else result[i - 1] = j - 1;
  }
  return result;
}

/**
 * Length of the longest strictly increasing subsequence (not necessarily contiguous).
 * Empty input gives 0; equal neighbours do not extend a run.
 */
export function longestIncreasingRun(values: readonly number[]): number {
  // tails[k] is the smallest value that can end an increasing subsequence of length k + 1.
  const tails: number[] = [];
  for (const value of values) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
  }
  return tails.length;
}

/**
 * Score a character written without guidance: `drawn` holds the pen gestures in the
 * order they were made.
 *
 * Attribution: every drawn stroke is compared with every reference stroke. A pair is
 * eligible when the drawing lies on the stroke (either direction) with a score of at
 * least `minScore`; among eligible pairs the one-to-one assignment with the highest
 * total score is taken. Ineligible pairs are excluded before the assignment rather
 * than dropped after it, so a weak pair can never push out a good one. Drawn strokes
 * left without a partner are `extra`; reference strokes left without one are `missing`.
 *
 * Scoring, per reference stroke:
 *  - `drawnAt` is the rank of its drawn stroke among the attributed drawn strokes only
 *    (a stray extra mark does not shift everything after it).
 *  - `orderOk` when `drawnAt` equals the stroke's own index. Swapping two neighbours
 *    costs two points; one missing stroke costs every later stroke its point.
 *  - `directionOk` when it was drawn and that drawing runs the canonical way.
 * `orderRelative` is the longest increasing subsequence of the reference indices taken
 * in drawn order: how many strokes are in the right order relative to each other.
 *
 * Edge cases: nothing drawn gives all strokes missing and zero on every count; a glyph
 * without strokes makes every drawn stroke extra; empty gestures and taps are extra.
 */
export function scoreFreeWriting(
  drawn: readonly DrawnStroke[],
  glyph: Glyph,
  options: FreeWritingOptions = {},
): FreeWritingScore {
  const minScore = options.minScore ?? DEFAULT_MIN_ATTRIBUTION_SCORE;
  const matchOptions = resolveMatchOptions(options.match);
  const strokeCount = glyph.strokes.length;

  const matches = drawn.map((pen) =>
    glyph.strokes.map((reference) => matchStroke(pen, reference.median, glyph.size, matchOptions)),
  );
  // Eligible pairs stay strictly positive so that they can be told apart from excluded ones.
  const scores = matches.map((row) =>
    row.map((match) => (match.onStroke && match.score >= minScore ? Math.max(match.score, Number.MIN_VALUE) : 0)),
  );
  const assignment = hungarian(scores).map((stroke, pen) =>
    stroke !== null && scores[pen]![stroke]! > 0 ? stroke : null,
  );

  const drawnBy = new Array<number | null>(strokeCount).fill(null);
  const rankOf = new Array<number | null>(strokeCount).fill(null);
  const sequence: number[] = [];
  const extra: number[] = [];
  assignment.forEach((stroke, pen) => {
    if (stroke === null) {
      extra.push(pen);
      return;
    }
    drawnBy[stroke] = pen;
    rankOf[stroke] = sequence.length;
    sequence.push(stroke);
  });

  const strokes: FreeWritingStrokeScore[] = [];
  const missing: number[] = [];
  for (let stroke = 0; stroke < strokeCount; stroke++) {
    const pen = drawnBy[stroke] ?? null;
    const drawnAt = rankOf[stroke] ?? null;
    if (pen === null) missing.push(stroke);
    strokes.push({
      stroke,
      drawnAt,
      orderOk: drawnAt === stroke,
      directionOk: pen !== null && matches[pen]![stroke]!.directionOk,
    });
  }

  return {
    strokeCount,
    drawnCount: drawn.length,
    assignment,
    orderCorrect: strokes.filter((s) => s.orderOk).length,
    directionCorrect: strokes.filter((s) => s.directionOk).length,
    orderRelative: longestIncreasingRun(sequence),
    strokes,
    missing,
    extra,
  };
}
