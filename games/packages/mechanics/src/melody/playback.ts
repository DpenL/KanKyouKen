import type { Rng } from "../util/rng";
import type { GlyphMelody, PlaybackOptions, ScheduledNote, StrokeAudioMode, TuningConfig } from "./types";
import { strokeVoice } from "./voices";

/** Our own defaults: a brisk tempo, a clear breath between components, strokes almost legato. */
export const DEFAULT_PLAYBACK: PlaybackOptions = {
  tempo: 132,
  unitGapBeats: 0.5,
  strokeGapBeats: 0.05,
};

/**
 * Lay a character's melody out on a timeline, for demonstrations and replays where no
 * pen is driving the sound. Notes follow one another in stroke order, each lasting its
 * element's beats at the given tempo. Every note is followed by the stroke gap; a
 * stroke that starts a unit is additionally preceded by the unit gap, except the very
 * first stroke, which starts at 0. The phrasing (a component's motif as one phrase, a
 * breath before the next component) is our own design.
 *
 * The voices come from `strokeVoice`, so `mode` selects the study condition; "silent"
 * (and an empty melody) gives no notes. `rng` is only consumed in "changing-melody"
 * mode. Options left out, or given as undefined, take `DEFAULT_PLAYBACK`. Throws when
 * the tempo is not a positive finite number; negative gaps count as 0.
 */
export function scheduleMelody(
  melody: GlyphMelody,
  mode: StrokeAudioMode,
  tuning: TuningConfig,
  rng: Rng,
  options: Partial<PlaybackOptions> = {},
): ScheduledNote[] {
  const tempo = options.tempo ?? DEFAULT_PLAYBACK.tempo;
  if (!Number.isFinite(tempo) || tempo <= 0) throw new Error("scheduleMelody: tempo must be a positive number");
  const secondsPerBeat = 60 / tempo;
  const unitGap = Math.max(0, options.unitGapBeats ?? DEFAULT_PLAYBACK.unitGapBeats) * secondsPerBeat;
  const strokeGap = Math.max(0, options.strokeGapBeats ?? DEFAULT_PLAYBACK.strokeGapBeats) * secondsPerBeat;

  const notes: ScheduledNote[] = [];
  let time = 0;
  for (const stroke of melody.strokes) {
    const voice = strokeVoice(mode, stroke, tuning, rng);
    if (!voice) continue;
    if (stroke.startsUnit && notes.length > 0) time += unitGap;
    const duration = voice.beats * secondsPerBeat;
    notes.push({ start: time, duration, voice, stroke: stroke.stroke });
    time += duration + strokeGap;
  }
  return notes;
}

/** Seconds from the start of playback to the end of the last-ending note; 0 for no notes. */
export function melodyDuration(notes: readonly ScheduledNote[]): number {
  let end = 0;
  for (const note of notes) end = Math.max(end, note.start + note.duration);
  return end;
}
