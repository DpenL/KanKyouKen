/**
 * Sequential practice: the player is asked for one particular stroke and the drawing is
 * judged against it and against the rest of the character.
 */

import type { Glyph } from "../glyph/types";
import type { Point } from "../util/geometry";
import { resolveMatchOptions } from "./defaults";
import { matchStroke } from "./match";
import type { AttemptOptions, AttemptResult } from "./types";

/**
 * How much better (in `StrokeMatch.score`) another unwritten stroke must fit before a
 * drawing that also fits the expected stroke is read as that other stroke. Our own tuning.
 */
export const WRONG_ORDER_MARGIN = 0.15;

export interface JudgeAttemptOptions extends AttemptOptions {
  /**
   * Strokes that are already on the page. A drawing that only resembles one of these is
   * a "miss", not a "wrong-order". Default: every index below `expected`, which is what
   * strict stroke-order practice produces. Indices outside the glyph are ignored.
   */
  readonly written?: readonly number[];
}

interface Candidate {
  readonly index: number;
  readonly score: number;
  readonly written: boolean;
}

/** Higher score wins; on a tie an unwritten stroke beats a written one, then the lower index. */
function better(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  if (a.score !== b.score) return a.score > b.score;
  return !a.written && b.written;
}

/**
 * Judge one drawn stroke when the player was asked for stroke `expected` of `glyph`.
 *
 * Rules, in order:
 *  1. The drawing lies on the expected stroke. It is "correct" when the direction is
 *     right, "wrong-direction" when it was drawn end to start (or "correct" when
 *     `enforceDirection` is false; `match.directionOk` still tells). Exception: when a
 *     stroke that is not yet written also lies under the drawing and scores more than
 *     `WRONG_ORDER_MARGIN` above the expected stroke, the player evidently wrote that
 *     one: "wrong-order", resembling it. Neighbouring strokes within the margin never
 *     steal a stroke the player was asked for.
 *  2. Otherwise the best-scoring other stroke the drawing lies on decides: not yet
 *     written gives "wrong-order"; already written gives "miss" (resembling it).
 *  3. The drawing lies on no stroke: "miss", `resembles` null. This is also the verdict
 *     for an empty drawing or a tap.
 *
 * `match` is always the comparison with the expected stroke. Throws a RangeError when
 * `expected` is not an index of a stroke of the glyph (so always for a glyph without
 * strokes).
 */
export function judgeAttempt(
  drawn: readonly Point[],
  glyph: Glyph,
  expected: number,
  options: JudgeAttemptOptions = {},
): AttemptResult {
  const target = Number.isInteger(expected) ? glyph.strokes[expected] : undefined;
  if (target === undefined) {
    throw new RangeError(`judgeAttempt: ${glyph.char} has no stroke ${expected} (it has ${glyph.strokes.length})`);
  }
  const matchOptions = resolveMatchOptions(options.match);
  const writtenSet = options.written === undefined ? null : new Set(options.written);
  const isWritten = (index: number): boolean => (writtenSet === null ? index < expected : writtenSet.has(index));

  const match = matchStroke(drawn, target.median, glyph.size, matchOptions);

  let bestOther: Candidate | null = null;
  let rival: Candidate | null = null;
  for (let index = 0; index < glyph.strokes.length; index++) {
    if (index === expected) continue;
    const other = matchStroke(drawn, glyph.strokes[index]!.median, glyph.size, matchOptions);
    if (!other.onStroke) continue;
    const candidate: Candidate = { index, score: other.score, written: isWritten(index) };
    if (better(candidate, bestOther)) bestOther = candidate;
    if (!candidate.written && better(candidate, rival)) rival = candidate;
  }

  if (match.onStroke) {
    if (rival !== null && rival.score > match.score + WRONG_ORDER_MARGIN) {
      return { verdict: "wrong-order", expected, resembles: rival.index, match };
    }
    const accepted = match.directionOk || options.enforceDirection === false;
    return { verdict: accepted ? "correct" : "wrong-direction", expected, resembles: expected, match };
  }
  if (bestOther === null) return { verdict: "miss", expected, resembles: null, match };
  return { verdict: bestOther.written ? "miss" : "wrong-order", expected, resembles: bestOther.index, match };
}
