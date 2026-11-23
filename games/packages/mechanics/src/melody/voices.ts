import { clamp } from "../util/geometry";
import type { Rng } from "../util/rng";
import { stepToPitch } from "./tuning";
import type { ContourPoint, MelodyStroke, StrokeAudioMode, TuningConfig, VoiceSpec } from "./types";

/** Largest move, in scale steps, of an invented element. */
const MAX_INVENTED_MOVE = 4;

/**
 * A contour that has nothing to do with the stroke: a random start step in
 * 0..rangeSteps, then, one time in three, a steady note, otherwise a glide of 1 to 4
 * steps up or down. A glide that would leave the range is clamped to it; if that leaves
 * no movement it goes the other way instead (and stays steady only when the range is a
 * single step). Always draws exactly four numbers from `rng`, whatever comes out, so
 * that replays stay aligned.
 */
export function inventContour(tuning: TuningConfig, rng: Rng): ContourPoint[] {
  const range = Math.max(0, Math.floor(tuning.rangeSteps));
  const start = rng.int(range + 1);
  const steady = rng.int(3) === 0;
  const size = 1 + rng.int(MAX_INVENTED_MOVE);
  const direction = rng.int(2) === 0 ? -1 : 1;
  let end = start;
  if (!steady) {
    end = clamp(start + direction * size, 0, range);
    if (end === start) end = clamp(start - direction * size, 0, range);
  }
  return [
    { p: 0, pitch: stepToPitch(start, tuning) },
    { p: 1, pitch: stepToPitch(end, tuning) },
  ];
}

/**
 * What a host should sound for one stroke under the given audio condition (the
 * contract's switch between study conditions). How the changing melody is invented is
 * our own design.
 *
 *  - "melody": the stroke's own element in its component's timbre.
 *  - "changing-melody": the same timbre, pan and length, but a contour made up on the
 *    spot by `inventContour`, so the music carries no information about the character.
 *    A new one is drawn on every call (call once per stroke attempt).
 *  - "sfx": a chalk noise with the stroke's pan and length.
 *  - "silent": null.
 *
 * Only "changing-melody" consumes random numbers; the other modes leave `rng` untouched.
 */
export function strokeVoice(
  mode: StrokeAudioMode,
  stroke: MelodyStroke,
  tuning: TuningConfig,
  rng: Rng,
): VoiceSpec | null {
  const { pan, beats } = stroke.element;
  switch (mode) {
    case "melody":
      return { kind: "tone", timbre: stroke.timbre, contour: stroke.element.contour, pan, beats };
    case "changing-melody":
      return { kind: "tone", timbre: stroke.timbre, contour: inventContour(tuning, rng), pan, beats };
    case "sfx":
      return { kind: "noise", texture: "chalk", pan, beats };
    case "silent":
      return null;
  }
}
