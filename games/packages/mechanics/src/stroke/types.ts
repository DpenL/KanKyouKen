/**
 * Stroke input contracts: what a drawn stroke is, how it is compared with a reference
 * stroke, and the three ways a game can use that comparison.
 *
 *  1. `judgeAttempt`     - sequential practice: "the player must now write stroke k".
 *  2. `scoreFreeWriting` - production from memory: the whole character is written with no
 *                          feedback, then scored for ORDER and DIRECTION separately.
 *  3. dot tracing        - checkpoint dots along each stroke that light up when touched;
 *                          either ordered (guided tracing) or free (a judgement-free
 *                          coverage test whose log is scored afterwards).
 *
 * All positions are in glyph space (see glyph/types.ts). Hosts convert pointer positions
 * before calling in. Nothing here knows about pointers, canvases or time sources.
 */

import type { Point } from "../util/geometry";

/** One sampled pen position. `t` (milliseconds on any monotonic clock) is optional. */
export interface StrokeSample extends Point {
  readonly t?: number;
}

/** A single pen-down to pen-up gesture, in the order it was drawn. */
export type DrawnStroke = readonly StrokeSample[];

// ---------------------------------------------------------------------------
// Comparing one drawn stroke with one reference stroke
// ---------------------------------------------------------------------------

/**
 * Tolerances. Distances are fractions of the glyph size, so the same options work for
 * any data source. `leniency` multiplies every tolerance at once (1 = defaults,
 * 2 = twice as forgiving); games typically raise it for beginners and touch screens.
 */
export interface MatchOptions {
  readonly leniency: number;
  /** Max distance between the drawn start and the reference start, and likewise for the ends. */
  readonly endpointTolerance: number;
  /** Max mean distance from the drawn points to the reference spine. */
  readonly averageDistanceTolerance: number;
  /**
   * Min mean cosine between corresponding direction vectors of the drawn and reference
   * strokes (1 = same heading everywhere, -1 = opposite).
   */
  readonly minDirectionCosine: number;
  /**
   * Max discrete Frechet distance between the two strokes after each has been
   * translated to its own start and scaled to unit length (pure shape, no position).
   */
  readonly shapeTolerance: number;
  /** Min ratio drawn length / reference length. Guards against taps and stubs. */
  readonly minLengthRatio: number;
  /** Number of points both strokes are resampled to before comparison. */
  readonly resampleCount: number;
}

/** Every measurement behind a match decision, for tuning, debugging and telemetry. */
export interface MatchMetrics {
  /** Distance between starts / ends, as fractions of glyph size. */
  readonly startDistance: number;
  readonly endDistance: number;
  /** Mean distance of drawn points to the reference spine (fraction of glyph size). */
  readonly averageDistance: number;
  /** Mean direction cosine, -1..1. */
  readonly directionCosine: number;
  /** Normalised-shape Frechet distance. */
  readonly shapeDistance: number;
  /** drawn length / reference length. */
  readonly lengthRatio: number;
}

export interface StrokeMatch {
  /**
   * The drawn stroke lies on the reference stroke when writing direction is ignored
   * (it passes the position, shape and length tests either forwards or backwards).
   */
  readonly onStroke: boolean;
  /** The drawn stroke runs from the reference start towards the reference end. Only meaningful when `onStroke`. */
  readonly directionOk: boolean;
  /** `onStroke && directionOk`. */
  readonly matched: boolean;
  /**
   * 0..1 closeness used to rank candidate reference strokes against each other
   * (1 = identical). Computed in the better of the two directions.
   */
  readonly score: number;
  /** Metrics in the direction that was drawn (not flipped). */
  readonly metrics: MatchMetrics;
}

// ---------------------------------------------------------------------------
// 1. Sequential practice
// ---------------------------------------------------------------------------

/**
 * What the player did relative to the stroke they were supposed to write.
 *  - "correct":         right stroke, right direction.
 *  - "wrong-direction": right stroke, drawn from its end to its start.
 *  - "wrong-order":     not the expected stroke, but it matches another stroke of the
 *                       character that has not been written yet.
 *  - "miss":            matches nothing useful.
 */
export type AttemptVerdict = "correct" | "wrong-direction" | "wrong-order" | "miss";

export interface AttemptResult {
  readonly verdict: AttemptVerdict;
  /** Index of the stroke the player was asked for. */
  readonly expected: number;
  /** Index of the reference stroke the drawing resembles most, or null when it resembles none. */
  readonly resembles: number | null;
  /** Comparison with the expected stroke. */
  readonly match: StrokeMatch;
}

export interface AttemptOptions {
  readonly match?: Partial<MatchOptions>;
  /**
   * When false, a correctly placed stroke drawn backwards is accepted as "correct"
   * (direction is then only reported through `match.directionOk`). Default true.
   */
  readonly enforceDirection?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Free writing (production from memory)
// ---------------------------------------------------------------------------

export interface FreeWritingStrokeScore {
  /** Reference stroke index. */
  readonly stroke: number;
  /** Position (0-based) at which the player drew it, or null if it was never drawn. */
  readonly drawnAt: number | null;
  /** Drawn at exactly its canonical position in the sequence. */
  readonly orderOk: boolean;
  /** Drawn in the canonical direction. */
  readonly directionOk: boolean;
}

/**
 * Result of scoring a whole character written without guidance.
 *
 * `orderCorrect` and `directionCorrect` follow the two-axis scoring of the Radical Tunes
 * studies: each is a count of reference strokes, out of `strokeCount`. A stroke counts
 * for order when it was drawn at its canonical position, so swapping two neighbouring
 * strokes costs two order points and a missing stroke costs one point on each axis.
 * `orderRelative` is a gentler alternative: the size of the longest run of strokes whose
 * relative order is right (a single early omission does not sink everything after it).
 */
export interface FreeWritingScore {
  readonly strokeCount: number;
  readonly drawnCount: number;
  /** For each drawn stroke, the reference stroke it was attributed to (null = no plausible match). */
  readonly assignment: readonly (number | null)[];
  readonly orderCorrect: number;
  readonly directionCorrect: number;
  readonly orderRelative: number;
  readonly strokes: readonly FreeWritingStrokeScore[];
  /** Reference strokes nobody drew. */
  readonly missing: readonly number[];
  /** Drawn strokes that match no reference stroke. */
  readonly extra: readonly number[];
}

export interface FreeWritingOptions {
  readonly match?: Partial<MatchOptions>;
  /**
   * Attribution threshold: a drawn stroke is only attributed to a reference stroke when
   * their `StrokeMatch.score` is at least this. Default 0.35.
   */
  readonly minScore?: number;
}

// ---------------------------------------------------------------------------
// 3. Dot tracing
// ---------------------------------------------------------------------------

/** Checkpoint dots for one stroke. `dots[0]` is the start dot (games draw it larger: it shows direction). */
export interface DotTrack {
  readonly stroke: number;
  readonly dots: readonly Point[];
}

export interface DotLayoutOptions {
  /** Target distance between neighbouring dots, as a fraction of glyph size. Default 0.07. */
  readonly spacing?: number;
  /** Minimum dots per stroke (start and end are always present). Default 2. */
  readonly minDots?: number;
}

export interface DotTraceOptions {
  /** A dot counts as touched when the pen comes within this distance (fraction of glyph size). Default 0.06. */
  readonly radius?: number;
  /**
   * "ordered": only the current stroke is live and its dots must be touched in sequence
   *            starting from the start dot (guided tracing; enforces order and direction).
   * "free":    every dot of every stroke is live at all times; nothing is ever marked wrong.
   */
  readonly mode: "ordered" | "free";
}

/** Serializable progress of a dot-tracing pass. */
export interface DotTraceState {
  /** touched[s][d]: has dot d of stroke s been touched. */
  readonly touched: readonly (readonly boolean[])[];
  /** Ordered mode: stroke currently being traced (== stroke count when finished). */
  readonly currentStroke: number;
  /** Every dot touch in the order it happened; the raw material for scoring a free pass. */
  readonly log: readonly DotHit[];
  readonly complete: boolean;
}

export interface DotHit {
  readonly stroke: number;
  readonly dot: number;
  readonly t?: number;
}

export interface DotTraceStep {
  readonly state: DotTraceState;
  /** Dots newly touched by this sample. */
  readonly hits: readonly DotHit[];
  /** Strokes whose last missing dot was touched by this sample. */
  readonly completedStrokes: readonly number[];
}

/**
 * Order and direction recovered from a free dot-tracing log, per stroke.
 * A stroke's position is the rank of its first touch; its direction is "forward" when
 * the start-side dots were touched before the end-side dots.
 */
export interface DotCoverageScore {
  readonly strokeCount: number;
  /** Strokes with at least `minCoverage` of their dots touched. */
  readonly covered: number;
  readonly orderCorrect: number;
  readonly directionCorrect: number;
  readonly strokes: readonly {
    readonly stroke: number;
    readonly coverage: number;
    readonly rank: number | null;
    readonly orderOk: boolean;
    readonly directionOk: boolean;
  }[];
}
