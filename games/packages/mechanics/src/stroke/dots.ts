/**
 * Dot tracing: checkpoint dots along every stroke that light up when the pen passes.
 *
 * Two uses share one state shape (see types.ts). "ordered" is guided tracing: one
 * stroke at a time, from its start dot to its end dot, in one go. "free" is a
 * judgement-free coverage pass: every dot is live, nothing is ever wrong, and the touch
 * log is scored afterwards for order and direction (`scoreDotCoverage`). The numbers
 * (spacing, radius, coverage threshold) and the rules that recover order and direction
 * from a touch log are our own design.
 *
 * Stroke numbers in the state, the hits and the scores are POSITIONS IN THE `tracks`
 * ARRAY. For tracks made by `layoutDots` these are the glyph's stroke indices. A game
 * that traces only part of a character should lay out dots for an extracted glyph
 * (`extractStrokes`) or translate through `tracks[k].stroke` itself.
 *
 * All functions are pure: states are never modified, a changed state is a new object,
 * and an unchanged state is returned as the same object.
 */

import type { Glyph } from "../glyph/types";
import { distance, polylineLength, resample } from "../util/geometry";
import type {
  DotCoverageScore,
  DotHit,
  DotLayoutOptions,
  DotTraceOptions,
  DotTraceState,
  DotTraceStep,
  DotTrack,
  StrokeSample,
} from "./types";

/** Default `DotLayoutOptions.spacing`. */
export const DEFAULT_DOT_SPACING = 0.07;
/** Default `DotTraceOptions.radius`. */
export const DEFAULT_DOT_RADIUS = 0.06;
/** Default `DotCoverageOptions.minCoverage`. */
export const DEFAULT_MIN_COVERAGE = 0.6;

/** Upper bound on the interpolation steps of one `feedDotSegment` call. */
const MAX_SEGMENT_STEPS = 1024;

/**
 * A stroke's place in the drawn order is taken at the touch that completes this share
 * of all the touches it received (see `scoreDotCoverage`).
 */
const SETTLED_SHARE = 0.8;

export interface DotLiftResult {
  readonly state: DotTraceState;
  /** The stroke whose partial progress was thrown away, or null when nothing was. */
  readonly abandonedStroke: number | null;
}

export interface DotCoverageOptions {
  /** Fraction of a stroke's dots that must be touched for the stroke to count as covered. Default 0.6. */
  readonly minCoverage?: number;
}

/**
 * Place checkpoint dots along every stroke of a glyph, one track per stroke in stroke
 * order. Dots are evenly spaced along the median; the first is the stroke's start and
 * the last its end. A stroke gets `round(length / (spacing * size)) + 1` dots, and at
 * least `minDots` (itself at least 2).
 *
 * A median without length yields `minDots` dots on the same spot. Throws a RangeError
 * when `spacing` or the glyph size is not a positive finite number, and an Error when a
 * stroke has an empty median (which the glyph contract rules out).
 */
export function layoutDots(glyph: Glyph, options: DotLayoutOptions = {}): DotTrack[] {
  const gap = (options.spacing ?? DEFAULT_DOT_SPACING) * glyph.size;
  if (!(gap > 0) || !Number.isFinite(gap)) {
    throw new RangeError("layoutDots: spacing and glyph size must be positive finite numbers");
  }
  const requested = options.minDots ?? 2;
  const minDots = Number.isFinite(requested) ? Math.max(2, Math.floor(requested)) : 2;
  return glyph.strokes.map((stroke, index) => {
    const count = Math.max(minDots, Math.round(polylineLength(stroke.median) / gap) + 1);
    return { stroke: index, dots: resample(stroke.median, count) };
  });
}

/** Lowest stroke that still has an untouched dot, or the stroke count when there is none. */
function firstOpenStroke(touched: readonly (readonly boolean[])[]): number {
  const index = touched.findIndex((row) => row.includes(false));
  return index === -1 ? touched.length : index;
}

function assertSameShape(state: DotTraceState, tracks: readonly DotTrack[]): void {
  const same =
    state.touched.length === tracks.length &&
    tracks.every((track, k) => state.touched[k]!.length === track.dots.length);
  if (!same) throw new RangeError("dot trace: the state was not created for these tracks");
}

/**
 * Fresh progress for a set of tracks: nothing touched, an empty log, the first stroke
 * current. Works for both modes. Tracks without dots have nothing to trace and are
 * skipped; with no tracks at all (or only such tracks) the trace starts out complete.
 */
export function createDotTrace(tracks: readonly DotTrack[]): DotTraceState {
  const touched = tracks.map((track) => track.dots.map(() => false));
  const currentStroke = firstOpenStroke(touched);
  return { touched, currentStroke, log: [], complete: currentStroke === touched.length };
}

const hitOf = (stroke: number, dot: number, sample: StrokeSample): DotHit =>
  sample.t === undefined ? { stroke, dot } : { stroke, dot, t: sample.t };

function orderedHits(
  state: DotTraceState,
  tracks: readonly DotTrack[],
  sample: StrokeSample,
  reach: number,
): DotHit[] {
  const stroke = state.currentStroke;
  const dots = tracks[stroke]?.dots;
  const row = state.touched[stroke];
  const hits: DotHit[] = [];
  if (dots === undefined || row === undefined) return hits;
  for (let dot = row.indexOf(false); dot < dots.length; dot++) {
    if (row[dot]) continue;
    if (!(distance(sample, dots[dot]!) <= reach)) break;
    hits.push(hitOf(stroke, dot, sample));
  }
  return hits;
}

function freeHits(state: DotTraceState, tracks: readonly DotTrack[], sample: StrokeSample, reach: number): DotHit[] {
  const found: { hit: DotHit; distance: number }[] = [];
  tracks.forEach((track, stroke) => {
    const row = state.touched[stroke]!;
    track.dots.forEach((dot, index) => {
      if (row[index]) return;
      const d = distance(sample, dot);
      if (d <= reach) found.push({ hit: hitOf(stroke, index, sample), distance: d });
    });
  });
  // Nearest first, so that dots caught by one sample are logged without a bias towards the stroke's start.
  return found.sort((a, b) => a.distance - b.distance).map((entry) => entry.hit);
}

function applyHits(state: DotTraceState, hits: readonly DotHit[]): DotTraceStep {
  if (hits.length === 0) return { state, hits, completedStrokes: [] };
  const touched: (readonly boolean[])[] = [...state.touched];
  const edited = new Map<number, boolean[]>();
  const completedStrokes: number[] = [];
  for (const hit of hits) {
    let row = edited.get(hit.stroke);
    if (row === undefined) {
      row = [...touched[hit.stroke]!];
      edited.set(hit.stroke, row);
      touched[hit.stroke] = row;
    }
    row[hit.dot] = true;
    if (!row.includes(false)) completedStrokes.push(hit.stroke);
  }
  const currentStroke = firstOpenStroke(touched);
  return {
    state: { touched, currentStroke, log: [...state.log, ...hits], complete: currentStroke === touched.length },
    hits,
    completedStrokes,
  };
}

/**
 * Feed one pen position. A dot is touched when the pen is within `radius * size` of it
 * (the boundary counts).
 *
 * Ordered mode: only the current stroke is live and its dots must be touched in sequence
 * from dot 0. One sample touches every consecutive dot in reach, so a large radius or a
 * dense track does not demand one sample per dot; a pen on a later dot or on another
 * stroke touches nothing, so a stroke traced from its end stays dark until the pen
 * arrives at the start. Touching the last dot completes the stroke and makes the next
 * one current; a single sample never reaches into that next stroke.
 *
 * Free mode: every untouched dot of every stroke in reach is touched, nearest first.
 * `currentStroke` is then merely the lowest stroke with untouched dots.
 *
 * Hits carry the sample's `t` when it has one. `completedStrokes` lists strokes in the
 * order their last dot fell. A sample that touches nothing, and any sample fed to a
 * complete trace, returns the same state object with no hits. A radius or size that is
 * not positive touches nothing (zero touches only an exact hit). Throws a RangeError
 * when the state does not have the shape of `tracks`.
 */
export function feedDotTrace(
  state: DotTraceState,
  tracks: readonly DotTrack[],
  sample: StrokeSample,
  size: number,
  options: DotTraceOptions,
): DotTraceStep {
  assertSameShape(state, tracks);
  if (state.complete) return { state, hits: [], completedStrokes: [] };
  const reach = (options.radius ?? DEFAULT_DOT_RADIUS) * size;
  const hits =
    options.mode === "ordered" ? orderedHits(state, tracks, sample, reach) : freeHits(state, tracks, sample, reach);
  return applyHits(state, hits);
}

function between(from: StrokeSample, to: StrokeSample, f: number): StrokeSample {
  if (f <= 0) return from;
  if (f >= 1) return to;
  const x = from.x + (to.x - from.x) * f;
  const y = from.y + (to.y - from.y) * f;
  const t = from.t !== undefined && to.t !== undefined ? from.t + (to.t - from.t) * f : (to.t ?? from.t);
  return t === undefined ? { x, y } : { x, y, t };
}

/**
 * Feed the pen movement between two consecutive samples, so that a fast swipe cannot
 * jump over dots. The segment is walked in equal steps of at most half the radius, both
 * ends included, each step is fed like `feedDotTrace`, and the results are merged: all
 * hits and completed strokes in the order they happened, and the final state.
 *
 * Interpolated hits get an interpolated `t` when both samples carry one, otherwise the
 * `t` of whichever sample has it. Feeding `from` again after it was already fed is
 * harmless. In ordered mode the walk stops at the first completed stroke: the rest of
 * the movement belongs to the same gesture and must not start the next stroke (hosts
 * should likewise ignore input from a completion until the pen lifts). Very long
 * segments are walked in at most 1024 steps; a radius that is not positive, or
 * non-finite coordinates, reduce the walk to the two end points.
 */
export function feedDotSegment(
  state: DotTraceState,
  tracks: readonly DotTrack[],
  from: StrokeSample,
  to: StrokeSample,
  size: number,
  options: DotTraceOptions,
): DotTraceStep {
  const reach = (options.radius ?? DEFAULT_DOT_RADIUS) * size;
  const span = distance(from, to);
  const steps =
    reach > 0 && Number.isFinite(span) ? Math.min(MAX_SEGMENT_STEPS, Math.max(1, Math.ceil((2 * span) / reach))) : 1;

  let current = state;
  const hits: DotHit[] = [];
  const completedStrokes: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const step = feedDotTrace(current, tracks, between(from, to, i / steps), size, options);
    current = step.state;
    hits.push(...step.hits);
    completedStrokes.push(...step.completedStrokes);
    if (current.complete || (options.mode === "ordered" && completedStrokes.length > 0)) break;
  }
  return { state: current, hits, completedStrokes };
}

/**
 * The pen left the surface during ORDERED tracing. A stroke must be traced in one go,
 * so if the current stroke was started but not finished its dots are cleared and it is
 * reported as `abandonedStroke`. Otherwise (current stroke untouched, or trace complete)
 * nothing changes: the same state object comes back with `abandonedStroke` null.
 *
 * The log is a history and keeps the hits of the abandoned attempt. Do not call this in
 * free mode, where lifting the pen is never a mistake. Throws a RangeError when the
 * state does not have the shape of `tracks`.
 */
export function liftDotTrace(state: DotTraceState, tracks: readonly DotTrack[]): DotLiftResult {
  assertSameShape(state, tracks);
  const row = state.touched[state.currentStroke];
  if (state.complete || row === undefined || !row.includes(true)) return { state, abandonedStroke: null };
  const touched = state.touched.map((r, k) => (k === state.currentStroke ? r.map(() => false) : r));
  return { state: { ...state, touched }, abandonedStroke: state.currentStroke };
}

/**
 * Recover order and direction from a dot-tracing pass, normally a free one.
 *
 * Per stroke, `coverage` is the fraction of its dots that are touched in the state. A
 * stroke is covered when at least one dot is touched and the coverage reaches
 * `minCoverage` (default 0.6). Uncovered strokes have rank null and fail both tests.
 *
 * In a free pass every dot is live, so a pen that crosses another stroke, or starts where
 * another stroke starts, lights a few of that stroke's dots in passing, and a dot the
 * player stopped short of may be lit later by a neighbour. Read naively, the log
 * misleads: ranking by first touch gets the order of a correctly written 木 wrong, and
 * comparing when the two halves of a stroke were lit misses backwards strokes that
 * begin on a crossing. Both rules are therefore built to shrug off a minority of stray
 * touches:
 *  - `rank`: covered strokes are ranked by the moment they SETTLED: the log position of
 *    the touch that completed four fifths of the touches the stroke received. Early
 *    stray touches and a single late one both fall outside it.
 *    `orderOk` when the rank equals the stroke's own index: the same strict rule as
 *    `FreeWritingScore.orderCorrect`, so an uncovered early stroke costs every later one.
 *  - `directionOk`: reading the stroke's touches in log order, more moves go from a dot
 *    to a later dot than to an earlier one. On a tie the latest move decides, because
 *    stray touches mostly come before the stroke's own gesture. A stroke with a single
 *    logged touch has no direction and counts as not ok.
 * What no rule can recover: a short stroke whose dots were nearly all lit in passing
 * (a three-dot bar between two uprights, say) keeps too little of its own gesture, and
 * may even count as covered without having been written. A radius well below the dot
 * spacing reduces stray touches, at the price of demanding a more accurate hand.
 *
 * Only touches that are still standing in the state count, each at its latest place in
 * the log, so attempts cleared by `liftDotTrace` are ignored. A track without dots has
 * coverage 0. An untouched state scores zero everywhere. Throws a RangeError when the
 * state does not have the shape of `tracks`.
 */
export function scoreDotCoverage(
  state: DotTraceState,
  tracks: readonly DotTrack[],
  options: DotCoverageOptions = {},
): DotCoverageScore {
  assertSameShape(state, tracks);
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;

  // touchedAt[stroke][dot]: log position of the touch that stands, if any.
  const touchedAt = tracks.map((track) => new Array<number | undefined>(track.dots.length).fill(undefined));
  state.log.forEach((hit, position) => {
    if (state.touched[hit.stroke]?.[hit.dot]) touchedAt[hit.stroke]![hit.dot] = position;
  });

  const measured = tracks.map((track, stroke) => {
    const count = track.dots.length;
    const touched = state.touched[stroke]!.filter(Boolean).length;
    const coverage = count === 0 ? 0 : touched / count;
    const covered = touched > 0 && coverage >= minCoverage;

    const sequence: { dot: number; position: number }[] = [];
    touchedAt[stroke]!.forEach((position, dot) => {
      if (position !== undefined) sequence.push({ dot, position });
    });
    sequence.sort((a, b) => a.position - b.position);

    const settling = Math.ceil(sequence.length * SETTLED_SHARE - 1e-9) - 1;
    let towardsEnd = 0;
    let towardsStart = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i]!.dot > sequence[i - 1]!.dot) towardsEnd++;
      else towardsStart++;
    }
    const lastMoveForward =
      sequence.length > 1 && sequence[sequence.length - 1]!.dot > sequence[sequence.length - 2]!.dot;
    return {
      stroke,
      coverage,
      covered,
      settledAt: covered && sequence.length > 0 ? sequence[settling]!.position : null,
      forward: towardsEnd > towardsStart || (towardsEnd === towardsStart && lastMoveForward),
    };
  });

  const ranks = new Map<number, number>();
  measured
    .filter((m) => m.settledAt !== null)
    .sort((a, b) => a.settledAt! - b.settledAt!)
    .forEach((m, rank) => ranks.set(m.stroke, rank));

  const strokes = measured.map((m) => {
    const rank = ranks.get(m.stroke) ?? null;
    return {
      stroke: m.stroke,
      coverage: m.coverage,
      rank,
      orderOk: rank !== null && rank === m.stroke,
      directionOk: m.covered && m.forward,
    };
  });
  return {
    strokeCount: tracks.length,
    covered: measured.filter((m) => m.covered).length,
    orderCorrect: strokes.filter((s) => s.orderOk).length,
    directionCorrect: strokes.filter((s) => s.directionOk).length,
    strokes,
  };
}
