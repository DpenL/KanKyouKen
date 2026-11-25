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
  /**
   * Max ratio drawn length / reference length, the drawn length taken without its fine
   * detail (`MatchMetrics.coarseLengthRatio`). Guards against scribbles: a dense zigzag
   * over a stroke starts and ends in the right places, stays near the spine and, once
   * resampled, can even look straight; its length gives it away. Widens with leniency,
   * and for short strokes.
   */
  readonly maxLengthRatio: number;
  /**
   * Max `MatchMetrics.backtrackRatio`. Guards against going over a stroke there and back
   * again, which on a short stroke stays within the widened length limit. The same at
   * every leniency.
   */
  readonly maxBacktrackRatio: number;
  /**
   * Max `MatchMetrics.extraTurning`, radians. Guards against a spring or loops along a
   * long stroke, which add too little length to be told by it. The same at every
   * leniency.
   */
  readonly maxExtraTurning: number;
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
  /**
   * The same ratio with the drawing's fine detail ironed out: the drawing is cut down to
   * its corners, dropping every point within `SCRIBBLE_GRAIN` of the glyph size of the
   * straight run around it, and that is measured. A trembling hand or a noisy pointer
   * adds to `lengthRatio` but not to this; a scribble adds to both. Like the two below,
   * it does not depend on how densely the pointer reported positions.
   */
  readonly coarseLengthRatio: number;
  /**
   * How far the drawing, cut down to its corners as for `coarseLengthRatio`, goes back over
   * the reference: the length it runs against the reference's writing direction (each
   * segment against the direction of the reference where the segment's middle lies),
   * taken in whichever direction of drawing makes it least, beyond what the reference cut
   * down the same way does, as a fraction of the reference's length. 0 for a faithful
   * trace, drawn either way; about 1 for going over the stroke there, back and there again.
   */
  readonly backtrackRatio: number;
  /**
   * How much more the drawing, cut down to its corners, turns than the reference cut down
   * the same way: the sums of the angles of all their changes of direction, the
   * difference in radians, at least 0. About 2 pi for each loop of a spring.
   */
  readonly extraTurning: number;
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
 * strokes costs two order points. A missing stroke costs its own point on each axis and,
 * on the order axis, the point of every stroke after it (they are all drawn one position
 * early); only a missing last stroke costs a single order point.
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
 * A stroke's position is the rank of the moment most of its touches were in (stray
 * early touches from a pen crossing it are ignored); its direction is "forward" when
 * most moves between consecutive touches go towards later dots.
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

// ---------------------------------------------------------------------------
// 4. Writing assessment (instructor-style metrics)
// ---------------------------------------------------------------------------
//
// Ten metrics in three groups, after Kanji Workbook (Taele, Koh & Hammond, AAAI/IAAI
// 2020), which derived them from interviews with writing instructors:
//   structure: stroke match, stroke valid (exposes missing strokes), stroke exist
//              (exposes extraneous strokes);
//   technique: stroke order, stroke direction;
//   precision: stroke edit, stroke length, stroke closeness, stroke speed, symbol speed.
// From the paper: the metrics and their grouping, comparing the writing with a model
// after bringing both to a common size and position, and a three-star score per metric.
// Ours: how strokes are matched (the paper uses Hausdorff and Euclidean template
// matching), every threshold (the paper derived its own from an expert's recordings and
// gives no numbers), the reference timing when no expert recording exists, and the
// overall score.

export type AssessmentMetricId =
  | "stroke-match"
  | "stroke-valid"
  | "stroke-exist"
  | "stroke-order"
  | "stroke-direction"
  | "stroke-edit"
  | "stroke-length"
  | "stroke-closeness"
  | "stroke-speed"
  | "symbol-speed";

export type AssessmentGroup = "structure" | "technique" | "precision";

export type Stars = 0 | 1 | 2 | 3;

export interface MetricResult {
  readonly id: AssessmentMetricId;
  readonly group: AssessmentGroup;
  /** False when the inputs the metric needs are missing (no timestamps, no edit count). */
  readonly available: boolean;
  /** A count for count metrics, the number of edits for stroke-edit, a duration ratio for symbol-speed. */
  readonly value: number;
  /** What a count is out of; null for metrics that are not counts. */
  readonly outOf: number | null;
  readonly stars: Stars;
  /** Why the metric is unavailable, when it is. */
  readonly note?: string;
}

/** What was found for one REFERENCE stroke. */
export interface AssessedStroke {
  readonly stroke: number;
  /** Index of the drawn stroke attributed to it, or null if it is missing. */
  readonly drawnIndex: number | null;
  /**
   * Written, and part of the longest run of written strokes that are in the right order
   * relative to each other (the strokes the stroke-order metric counts). When several
   * runs are equally long, one is chosen and stays the same for the same writing.
   */
  readonly orderOk: boolean;
  readonly directionOk: boolean;
  /** Drawn length / reference length, or null if missing. */
  readonly lengthRatio: number | null;
  /** Mean distance of the drawn stroke to the reference, as a fraction of glyph size; null if missing. */
  readonly closeness: number | null;
  /** Drawn duration / reference duration; null if missing or untimed. */
  readonly durationRatio: number | null;
}

/** Every number here is our own choice; see the note at the top of this section. */
export interface AssessmentThresholds {
  /** Share of a count needed for three, two and one star. */
  readonly countShares: readonly [number, number, number];
  /** Most edits that still earn three, two and one star. */
  readonly maxEdits: readonly [number, number, number];
  /** A matched stroke's length is fine when drawn / reference lies in this range. */
  readonly lengthRatio: readonly [number, number];
  /** A matched stroke is close enough when its mean distance to the reference is at most this fraction of glyph size. */
  readonly closeness: number;
  /** A matched stroke's speed is fine when drawn / reference duration lies in this range. */
  readonly strokeSpeedRatio: readonly [number, number];
  /** Ranges of total duration ratio that earn three, two and one star. */
  readonly symbolSpeedRatio: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  /** Pause assumed between strokes when the reference total time is derived, in milliseconds. */
  readonly strokeGapMs: number;
}

export interface WritingAssessmentOptions {
  readonly match?: Partial<MatchOptions>;
  /** As in `FreeWritingOptions`. */
  readonly minScore?: number;
  /**
   * Scale and move the drawn character onto the reference before comparing, so writing
   * that is smaller or off-centre is judged on its shape. Default true. With false,
   * positions are compared as drawn.
   *
   * The fit lands the bounding box of the writing on that of the reference. When that
   * leaves strokes unpaired, it is retried as drawn, without each drawn stroke (a stray
   * mark) and without each reference stroke (a stroke not written), and the placement
   * that pairs the most strokes is used: one missing stroke or one stray mark does not
   * spoil the judgement of the rest, and the fit never pairs fewer strokes than the
   * comparison as drawn. Several missing strokes in a small or off-centre writing can
   * still defeat it. The retries cost several attributions instead of one (about ten
   * for a character of fifteen strokes); a complete writing needs none.
   */
  readonly fitToReference?: boolean;
  /** How many times the writer used undo or clear; the host counts this. Omit to leave stroke-edit unavailable. */
  readonly edits?: number;
  /** Reference duration of each reference stroke in milliseconds, e.g. from an expert recording. */
  readonly referenceDurationsMs?: readonly number[];
  /** Used when no reference durations are given: writing speed in glyph sizes per second. Default 1.5. */
  readonly referencePace?: number;
  readonly thresholds?: Partial<AssessmentThresholds>;
}

export interface WritingAssessment {
  readonly metrics: Readonly<Record<AssessmentMetricId, MetricResult>>;
  /** One entry per reference stroke. */
  readonly strokes: readonly AssessedStroke[];
  /** Reference strokes nobody drew. */
  readonly missing: readonly number[];
  /** Drawn strokes that match no reference stroke. */
  readonly extra: readonly number[];
  /** Mean of stars / 3 over the available metrics, 0..1. */
  readonly score: number;
}
