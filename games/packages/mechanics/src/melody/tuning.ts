import { DEFAULT_TIMBRE_CONFIG } from "./timbres";
import type { MelodyConfig, Pitch, TimbreConfig, TuningConfig } from "./types";

/**
 * The default tuning, our own design: a major pentatonic scale on A3, so that any
 * succession of generated notes sounds consonant, with a range of eight scale steps
 * (an octave and a fifth) between the bottom and the top of a component.
 */
export const DEFAULT_TUNING: TuningConfig = {
  tonic: 57,
  scale: [0, 2, 4, 7, 9],
  rangeSteps: 8,
  levelDeadband: 0.12,
  maxContourPoints: 3,
  minBeats: 0.5,
  maxBeats: 1.5,
  registerSpread: 3,
};

/** Default tuning with the default timbre palette, one timbre per component. */
export const DEFAULT_MELODY_CONFIG: MelodyConfig = {
  tuning: DEFAULT_TUNING,
  timbre: DEFAULT_TIMBRE_CONFIG,
};

/** A melody configuration in which every field, at both levels, may be left out. */
export interface PartialMelodyConfig {
  readonly tuning?: Partial<TuningConfig>;
  readonly timbre?: Partial<TimbreConfig>;
}

/**
 * Pitch of a scale step. Step 0 is the tonic, each further step is the next note of the
 * scale, and the scale repeats every octave: with a five-note scale, step 5 is the tonic
 * an octave up and step -1 is the top scale note of the octave below the tonic.
 * A fractional step is interpolated linearly between its two neighbouring steps.
 * Throws when the scale is empty or the step is not a finite number.
 */
export function stepToPitch(step: number, tuning: TuningConfig): Pitch {
  const { scale, tonic } = tuning;
  const degrees = scale.length;
  if (degrees === 0) throw new Error("stepToPitch: the scale is empty");
  if (!Number.isFinite(step)) throw new Error("stepToPitch: step must be a finite number");
  const whole = (s: number): Pitch => {
    const octave = Math.floor(s / degrees);
    return tonic + 12 * octave + scale[s - octave * degrees]!;
  };
  const below = Math.floor(step);
  if (below === step) return whole(below);
  const low = whole(below);
  return low + (whole(below + 1) - low) * (step - below);
}

/**
 * Check that a tuning can drive the generator; throws an Error naming the first field
 * that cannot: a non-finite tonic, an empty or non-ascending scale or one that leaves
 * the octave, fewer than one range step, a negative deadband, fewer than two contour
 * points, non-positive or inverted beat bounds, or a negative register spread.
 */
export function assertTuning(tuning: TuningConfig): void {
  const fail = (what: string): never => {
    throw new Error(`melody tuning: ${what}`);
  };
  if (!Number.isFinite(tuning.tonic)) fail("tonic must be a finite pitch");
  if (tuning.scale.length === 0) fail("scale must have at least one note");
  tuning.scale.forEach((offset, i) => {
    if (!Number.isFinite(offset) || offset < 0 || offset >= 12) fail("scale offsets must lie in 0..12 (exclusive)");
    if (i > 0 && offset <= tuning.scale[i - 1]!) fail("scale offsets must ascend");
  });
  if (!Number.isInteger(tuning.rangeSteps) || tuning.rangeSteps < 1) fail("rangeSteps must be an integer >= 1");
  if (!(tuning.levelDeadband >= 0)) fail("levelDeadband must be >= 0");
  if (!Number.isInteger(tuning.maxContourPoints) || tuning.maxContourPoints < 2) {
    fail("maxContourPoints must be an integer >= 2");
  }
  if (!(tuning.minBeats > 0) || !Number.isFinite(tuning.minBeats)) fail("minBeats must be > 0");
  if (!(tuning.maxBeats >= tuning.minBeats) || !Number.isFinite(tuning.maxBeats)) fail("maxBeats must be >= minBeats");
  if (!Number.isInteger(tuning.registerSpread) || tuning.registerSpread < 0) {
    fail("registerSpread must be an integer >= 0");
  }
}

function merge<T extends object>(base: T, overrides: Partial<T> | undefined): T {
  const out: T = { ...base };
  if (!overrides) return out;
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const value = overrides[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}

/**
 * Complete a partial configuration with the defaults, field by field at both levels
 * (`{ tuning: { tonic: 60 } }` keeps every other tuning default). Fields given as
 * `undefined` count as left out. The resulting tuning is validated with `assertTuning`;
 * the timbre palette is not, because an empty palette has a defined meaning (everything
 * falls back to the neutral timbre).
 */
export function resolveMelodyConfig(partial: PartialMelodyConfig = {}): MelodyConfig {
  const tuning = merge(DEFAULT_TUNING, partial.tuning);
  assertTuning(tuning);
  return { tuning, timbre: merge(DEFAULT_TIMBRE_CONFIG, partial.timbre) };
}
