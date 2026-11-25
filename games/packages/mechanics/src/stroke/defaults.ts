import type { MatchOptions } from "./types";

/**
 * Default tolerances for comparing a drawn stroke with a reference stroke.
 *
 * These are our own tuning, not values from the research papers. They sit in the range
 * open-source stroke quizzes use (endpoints within about a fifth of the character,
 * normalised Frechet distance of 0.4, direction cosine above 0), re-expressed as
 * fractions of the glyph size so that they hold for any data source.
 */
export const DEFAULT_MATCH_OPTIONS: MatchOptions = Object.freeze({
  leniency: 1,
  endpointTolerance: 0.2,
  averageDistanceTolerance: 0.12,
  minDirectionCosine: 0,
  shapeTolerance: 0.4,
  minLengthRatio: 0.4,
  maxLengthRatio: 1.6,
  maxBacktrackRatio: 0.5,
  maxExtraTurning: 4 * Math.PI,
  resampleCount: 24,
});

const OPTION_KEYS = Object.keys(DEFAULT_MATCH_OPTIONS) as readonly (keyof MatchOptions)[];

/**
 * Fill in the defaults for every option the caller left out.
 *
 * Fields that are absent or `undefined` take their default. `resampleCount` is rounded
 * and raised to at least 2 (a line needs two points). Throws a RangeError when any value
 * is not a number, or when `leniency` is not a positive finite number: tolerances are
 * multiplied and divided by it, so zero or a negative value has no meaning.
 * Tolerances of zero or below are accepted and simply make that test unpassable
 * (or, for `minLengthRatio`, always passed). An infinite `maxLengthRatio`,
 * `maxBacktrackRatio` or `maxExtraTurning` switches that test off.
 */
export function resolveMatchOptions(partial: Partial<MatchOptions> = {}): MatchOptions {
  const resolved: { -readonly [K in keyof MatchOptions]: MatchOptions[K] } = { ...DEFAULT_MATCH_OPTIONS };
  for (const key of OPTION_KEYS) {
    const value = partial[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new RangeError(`match option ${key} must be a number`);
    }
    resolved[key] = value;
  }
  if (!(resolved.leniency > 0) || !Number.isFinite(resolved.leniency)) {
    throw new RangeError("match option leniency must be a positive finite number");
  }
  if (!Number.isFinite(resolved.resampleCount)) {
    throw new RangeError("match option resampleCount must be finite");
  }
  resolved.resampleCount = Math.max(2, Math.round(resolved.resampleCount));
  return resolved;
}
