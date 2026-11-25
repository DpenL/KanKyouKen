/**
 * Instructor-style assessment of a whole written character: ten metrics in three
 * groups, each with a three-star score. See section 4 of types.ts for what comes from
 * Kanji Workbook (Taele, Koh & Hammond 2020) and what is our own design.
 */

import { strokesBox } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import { boundingBox, boxHeight, boxWidth, polylineLength, type Box } from "../util/geometry";
import { longestIncreasingPositions, scoreFreeWriting } from "./free";
import { matchStroke } from "./match";
import type {
  AssessedStroke,
  AssessmentGroup,
  AssessmentMetricId,
  AssessmentThresholds,
  DrawnStroke,
  FreeWritingScore,
  MetricResult,
  Stars,
  StrokeSample,
  WritingAssessment,
  WritingAssessmentOptions,
} from "./types";

/** All our own numbers: the paper derived its thresholds from an expert's recordings and does not give them. */
export const DEFAULT_ASSESSMENT_THRESHOLDS: AssessmentThresholds = {
  countShares: [1, 2 / 3, 1 / 3],
  maxEdits: [0, 2, 5],
  lengthRatio: [0.75, 1.33],
  closeness: 0.06,
  strokeSpeedRatio: [0.5, 2],
  symbolSpeedRatio: [
    [0.5, 2],
    [0.33, 3],
    [0.2, 5],
  ],
  strokeGapMs: 350,
};

/** Glyph sizes per second assumed for the reference when no recorded durations are given. */
export const DEFAULT_REFERENCE_PACE = 1.5;

/**
 * An axis is not used for scaling when the reference is thinner on it than this fraction
 * of the glyph (一 has no height to fit to), or when the drawing, measured against its own
 * longer side, is flatter on it than this fraction of how flat the reference is: a lone
 * horizontal stroke has no height to stretch over 十, while 灬 or 亻 written flatter or
 * narrower than the reference is still their shape.
 */
const MIN_FIT_EXTENT = 0.15;

const GROUPS: Readonly<Record<AssessmentMetricId, AssessmentGroup>> = {
  "stroke-match": "structure",
  "stroke-valid": "structure",
  "stroke-exist": "structure",
  "stroke-order": "technique",
  "stroke-direction": "technique",
  "stroke-edit": "precision",
  "stroke-length": "precision",
  "stroke-closeness": "precision",
  "stroke-speed": "precision",
  "symbol-speed": "precision",
};

const EPSILON = 1e-9;

function starsForShare(value: number, outOf: number, shares: AssessmentThresholds["countShares"]): Stars {
  if (outOf <= 0) return 0;
  const share = value / outOf;
  if (share >= shares[0] - EPSILON) return 3;
  if (share >= shares[1] - EPSILON) return 2;
  if (share >= shares[2] - EPSILON) return 1;
  return 0;
}

const within = (value: number, range: readonly [number, number]): boolean => value >= range[0] && value <= range[1];

/**
 * The move and per-axis scaling that lands the box `source` on the box `target`. An axis
 * on which either box is (nearly) flat is only centred, never scaled.
 */
function boxFit(source: Box, target: Box, size: number): (stroke: DrawnStroke) => StrokeSample[] {
  const sourceLonger = Math.max(boxWidth(source), boxHeight(source));
  const targetLonger = Math.max(boxWidth(target), boxHeight(target));
  const axis = (sourceMin: number, sourceExtent: number, targetMin: number, targetExtent: number) => {
    const scalable =
      sourceExtent > 0 &&
      targetExtent >= MIN_FIT_EXTENT * size &&
      sourceExtent / sourceLonger >= MIN_FIT_EXTENT * (targetExtent / targetLonger);
    const k = scalable ? targetExtent / sourceExtent : 1;
    const sourceMid = sourceMin + sourceExtent / 2;
    const targetMid = targetMin + targetExtent / 2;
    return (v: number): number => targetMid + (v - sourceMid) * k;
  };
  const fx = axis(source.minX, boxWidth(source), target.minX, boxWidth(target));
  const fy = axis(source.minY, boxHeight(source), target.minY, boxHeight(target));
  return (stroke) =>
    stroke.map((p): StrokeSample => (p.t === undefined ? { x: fx(p.x), y: fy(p.y) } : { x: fx(p.x), y: fy(p.y), t: p.t }));
}

const sameBox = (a: Box, b: Box): boolean => a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;

/** The drawn strokes in the position they are judged in, and how they pair with the reference there. */
interface Placement {
  readonly strokes: readonly DrawnStroke[];
  readonly free: FreeWritingScore;
  /** Reference strokes that found a drawn stroke. */
  readonly paired: number;
  /** Mean distance of the paired drawn strokes to their reference strokes (fraction of glyph size). */
  readonly distance: number;
}

/**
 * Bring the drawn character onto the reference so that size and place do not count.
 *
 * The plain fit lands the bounding box of everything drawn on the bounding box of the
 * whole reference. That is right for a complete character and wrong as soon as the two
 * boxes do not hold the same strokes: a stroke that was not written, or a stray mark
 * beside the character, moves a box edge and with it every stroke. So when the plain fit
 * leaves a stroke unpaired on either side, other placements are tried: the writing as it
 * was drawn, the fit without each drawn stroke in turn (a stray mark), and the fit onto
 * the reference without each of its strokes in turn (a stroke not written). The
 * placement that pairs the most strokes wins, the closer one among equals, and it is
 * then re-fitted from its paired strokes alone for as long as that pairs more.
 */
function placeOnReference(
  drawn: readonly DrawnStroke[],
  glyph: Glyph,
  place: (strokes: readonly DrawnStroke[]) => Placement,
): Placement {
  const usable = drawn.map((stroke) => stroke.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const everyPen = drawn.map((_, pen) => pen);
  const everyStroke = glyph.strokes.map((_, s) => s);
  const penBox = (pens: readonly number[]): Box | null => {
    const points = pens.flatMap((pen) => usable[pen]!);
    return points.length === 0 ? null : boundingBox(points);
  };
  const asDrawn = (): Placement => place(drawn.map((stroke) => [...stroke]));
  const fit = (source: Box | null, strokes: readonly number[]): Placement | null =>
    source === null || strokes.length === 0 ? null : place(drawn.map(boxFit(source, strokesBox(glyph, strokes), glyph.size)));

  const wholeDrawn = penBox(everyPen);
  const wholeReference = strokesBox(glyph, everyStroke);
  let best = fit(wholeDrawn, everyStroke) ?? asDrawn();
  if (wholeDrawn === null || (best.free.missing.length === 0 && best.free.extra.length === 0)) return best;

  const consider = (candidate: Placement | null): void => {
    if (candidate === null) return;
    if (candidate.paired > best.paired || (candidate.paired === best.paired && candidate.distance < best.distance)) best = candidate;
  };
  consider(asDrawn());
  for (const stray of everyPen) {
    const rest = penBox(everyPen.filter((pen) => pen !== stray));
    // A stroke inside the box of the others does not move the fit: nothing new to try.
    if (rest !== null && !sameBox(rest, wholeDrawn)) consider(fit(rest, everyStroke));
  }
  for (const unwritten of everyStroke) {
    const rest = everyStroke.filter((s) => s !== unwritten);
    if (rest.length > 0 && !sameBox(strokesBox(glyph, rest), wholeReference)) consider(fit(wholeDrawn, rest));
  }

  for (;;) {
    const pens: number[] = [];
    const strokes: number[] = [];
    best.free.assignment.forEach((stroke, pen) => {
      if (stroke === null) return;
      pens.push(pen);
      strokes.push(stroke);
    });
    const refined = fit(penBox(pens), strokes);
    if (refined === null || refined.paired <= best.paired) return best;
    best = refined;
  }
}

/** Pen-down to pen-up time of a stroke, or null when its first or last sample carries no timestamp. */
function strokeDuration(stroke: DrawnStroke): number | null {
  const first = stroke[0]?.t;
  const last = stroke[stroke.length - 1]?.t;
  return first === undefined || last === undefined ? null : Math.max(0, last - first);
}

/**
 * Assess a character written without guidance against its reference glyph.
 *
 * Drawn strokes are first brought onto the reference character (`placeOnReference`,
 * unless `fitToReference` is false) and attributed one to one to reference strokes
 * (`scoreFreeWriting`). The metrics:
 *  - stroke-match: attributed pairs, out of the larger of the two stroke counts.
 *  - stroke-valid: reference strokes that were drawn, out of the reference strokes
 *    (anything short of all means strokes are missing).
 *  - stroke-exist: drawn strokes that belong, out of the drawn strokes (anything short
 *    of all means extra strokes).
 *  - stroke-order: written strokes that are in the right order relative to each other
 *    (the longest such run), out of the reference strokes. A stroke that was not
 *    written costs one point and leaves the strokes after it in order; so does one
 *    stroke written too early or too late. This is `orderRelative`, not the positional
 *    `orderCorrect` of `scoreFreeWriting`.
 *  - stroke-direction: reference strokes drawn in their direction, out of the reference
 *    strokes.
 *  - stroke-edit: the number of edits the host reports. Unavailable without `edits`.
 *  - stroke-length, stroke-closeness: matched strokes whose length ratio and whose mean
 *    distance to the reference are within tolerance, out of the matched strokes.
 *  - stroke-speed: matched strokes written at a pace within tolerance of the reference,
 *    out of the matched strokes. symbol-speed: the ratio of the whole writing time
 *    (first pen-down to last pen-up) to the reference's. Both are unavailable unless
 *    every drawn stroke carries timestamps on its first and last sample. The reference
 *    timing is `referenceDurationsMs` when given, else stroke length at `referencePace`.
 * Count metrics earn three stars when everything is right, two from two thirds, one
 * from one third. `score` is the mean of stars / 3 over the available metrics.
 *
 * Nothing drawn gives zero stars on every available metric and a score of 0.
 */
export function assessWriting(drawn: readonly DrawnStroke[], glyph: Glyph, options: WritingAssessmentOptions = {}): WritingAssessment {
  const thresholds: AssessmentThresholds = { ...DEFAULT_ASSESSMENT_THRESHOLDS, ...options.thresholds };
  const strokeCount = glyph.strokes.length;
  const everyStroke = glyph.strokes.map((_, s) => s);
  const freeOptions = {
    ...(options.match ? { match: options.match } : {}),
    ...(options.minScore !== undefined ? { minScore: options.minScore } : {}),
  };
  const place = (strokes: readonly DrawnStroke[]): Placement => {
    const free = scoreFreeWriting(strokes, glyph, freeOptions);
    let paired = 0;
    let distanceSum = 0;
    free.assignment.forEach((stroke, pen) => {
      if (stroke === null) return;
      paired++;
      distanceSum += matchStroke(strokes[pen]!, glyph.strokes[stroke]!.median, glyph.size, options.match).metrics.averageDistance;
    });
    return { strokes, free, paired, distance: paired === 0 ? Infinity : distanceSum / paired };
  };
  const { strokes: fitted, free } =
    options.fitToReference === false || strokeCount === 0 ? place(drawn.map((s) => [...s])) : placeOnReference(drawn, glyph, place);

  // The written strokes that are in the right order relative to each other, as reference strokes.
  const written = free.assignment.filter((stroke): stroke is number => stroke !== null);
  const inOrder = new Set(longestIncreasingPositions(written).map((position) => written[position]!));

  const pace = options.referencePace !== undefined && options.referencePace > 0 ? options.referencePace : DEFAULT_REFERENCE_PACE;
  const referenceDuration = (stroke: number): number => {
    const given = options.referenceDurationsMs?.[stroke];
    if (given !== undefined && given > 0) return given;
    return (polylineLength(glyph.strokes[stroke]!.median) / glyph.size / pace) * 1000;
  };

  const drawnBy = new Array<number | null>(strokeCount).fill(null);
  free.assignment.forEach((stroke, pen) => {
    if (stroke !== null) drawnBy[stroke] = pen;
  });

  const durations = drawn.map(strokeDuration);
  const timed = drawn.length > 0 && durations.every((d) => d !== null);

  const strokes: AssessedStroke[] = free.strokes.map((s) => {
    const pen = drawnBy[s.stroke] ?? null;
    if (pen === null) {
      return { stroke: s.stroke, drawnIndex: null, orderOk: false, directionOk: false, lengthRatio: null, closeness: null, durationRatio: null };
    }
    const metrics = matchStroke(fitted[pen]!, glyph.strokes[s.stroke]!.median, glyph.size, options.match).metrics;
    const duration = durations[pen] ?? null;
    const reference = referenceDuration(s.stroke);
    return {
      stroke: s.stroke,
      drawnIndex: pen,
      orderOk: inOrder.has(s.stroke),
      directionOk: s.directionOk,
      lengthRatio: metrics.lengthRatio,
      closeness: metrics.averageDistance,
      durationRatio: duration === null || reference <= 0 ? null : duration / reference,
    };
  });

  const matched = strokes.filter((s) => s.drawnIndex !== null);
  const count = (id: AssessmentMetricId, value: number, outOf: number): MetricResult => ({
    id,
    group: GROUPS[id],
    available: true,
    value,
    outOf,
    stars: starsForShare(value, outOf, thresholds.countShares),
  });
  const unavailable = (id: AssessmentMetricId, note: string): MetricResult => ({
    id,
    group: GROUPS[id],
    available: false,
    value: 0,
    outOf: null,
    stars: 0,
    note,
  });

  let edit: MetricResult;
  if (options.edits === undefined) {
    edit = unavailable("stroke-edit", "the host did not report an edit count");
  } else {
    const edits = Math.max(0, options.edits);
    const stars: Stars = edits <= thresholds.maxEdits[0] ? 3 : edits <= thresholds.maxEdits[1] ? 2 : edits <= thresholds.maxEdits[2] ? 1 : 0;
    edit = { id: "stroke-edit", group: "precision", available: true, value: edits, outOf: null, stars: drawn.length === 0 ? 0 : stars };
  }

  let strokeSpeed: MetricResult;
  let symbolSpeed: MetricResult;
  if (!timed) {
    const note = drawn.length === 0 ? "nothing was written" : "some strokes carry no timestamps";
    strokeSpeed = unavailable("stroke-speed", note);
    symbolSpeed = unavailable("symbol-speed", note);
  } else {
    const fine = matched.filter((s) => s.durationRatio !== null && within(s.durationRatio, thresholds.strokeSpeedRatio)).length;
    strokeSpeed = count("stroke-speed", fine, matched.length);
    const starts = drawn.map((s) => s[0]!.t!);
    const ends = drawn.map((s) => s[s.length - 1]!.t!);
    const total = Math.max(...ends) - Math.min(...starts);
    const referenceTotal = everyStroke.reduce((sum, s) => sum + referenceDuration(s), 0) + thresholds.strokeGapMs * Math.max(0, strokeCount - 1);
    const ratio = referenceTotal > 0 ? total / referenceTotal : 0;
    const bands = thresholds.symbolSpeedRatio;
    const stars: Stars = within(ratio, bands[0]) ? 3 : within(ratio, bands[1]) ? 2 : within(ratio, bands[2]) ? 1 : 0;
    symbolSpeed = { id: "symbol-speed", group: "precision", available: true, value: ratio, outOf: null, stars };
  }

  const metrics: Record<AssessmentMetricId, MetricResult> = {
    "stroke-match": count("stroke-match", matched.length, Math.max(strokeCount, drawn.length)),
    "stroke-valid": count("stroke-valid", strokeCount - free.missing.length, strokeCount),
    "stroke-exist": count("stroke-exist", drawn.length - free.extra.length, drawn.length),
    "stroke-order": count("stroke-order", inOrder.size, strokeCount),
    "stroke-direction": count("stroke-direction", free.directionCorrect, strokeCount),
    "stroke-edit": edit,
    "stroke-length": count(
      "stroke-length",
      matched.filter((s) => s.lengthRatio !== null && within(s.lengthRatio, thresholds.lengthRatio)).length,
      matched.length,
    ),
    "stroke-closeness": count(
      "stroke-closeness",
      matched.filter((s) => s.closeness !== null && s.closeness <= thresholds.closeness).length,
      matched.length,
    ),
    "stroke-speed": strokeSpeed,
    "symbol-speed": symbolSpeed,
  };

  const available = Object.values(metrics).filter((m) => m.available);
  const score = available.length === 0 ? 0 : available.reduce((sum, m) => sum + m.stars / 3, 0) / available.length;
  return { metrics, strokes, missing: free.missing, extra: free.extra, score };
}
