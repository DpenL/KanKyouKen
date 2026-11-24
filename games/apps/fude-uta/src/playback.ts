import type { GlyphMelody, PlaybackOptions, ScheduledNote, StrokeAudioMode, TuningConfig } from "@kankyouken/mechanics/melody";
import { scheduleMelody } from "@kankyouken/mechanics/melody";
import type { Rng } from "@kankyouken/mechanics/util";

/** When a stroke sounds in a performance, in milliseconds from its start. */
export interface StrokeCue {
  readonly stroke: number;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface ScoreOptions {
  /** Beats per minute; the library's default when omitted. */
  readonly tempo?: number;
  /** Play these strokes only (one component's motif); the first of them then sounds at once. */
  readonly strokes?: readonly number[];
}

/** The notes of a character's melody in a sound mode, or of an excerpt of it. Silent mode has none. */
export function melodyNotes(
  melody: GlyphMelody,
  mode: StrokeAudioMode,
  tuning: TuningConfig,
  rng: Rng,
  options: ScoreOptions = {},
): ScheduledNote[] {
  const playback: Partial<PlaybackOptions> = options.tempo === undefined ? {} : { tempo: options.tempo };
  const notes = scheduleMelody(melody, mode, tuning, rng, playback);
  const wanted = options.strokes;
  if (wanted === undefined) return notes;
  const kept = notes.filter((note) => wanted.includes(note.stroke));
  const offset = kept[0]?.start ?? 0;
  return kept.map((note) => ({ ...note, start: note.start - offset }));
}

/**
 * The timing of a character's melody, whatever the sound mode: the visuals of a silent
 * performance keep the rhythm the melody would have had.
 */
export function strokeCues(melody: GlyphMelody, tuning: TuningConfig, rng: Rng, options: ScoreOptions = {}): StrokeCue[] {
  return melodyNotes(melody, "melody", tuning, rng, options).map((note) => ({
    stroke: note.stroke,
    startMs: note.start * 1000,
    durationMs: note.duration * 1000,
  }));
}

/**
 * Call `onCue` when each cue is due and `onEnd` once the last one has run its length.
 * Returns a function that cancels whatever has not happened yet (`onEnd` is then not called).
 */
export function runCues(cues: readonly StrokeCue[], onCue: (cue: StrokeCue) => void, onEnd: () => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let end = 0;
  for (const cue of cues) {
    timers.push(setTimeout(() => onCue(cue), cue.startMs));
    end = Math.max(end, cue.startMs + cue.durationMs);
  }
  timers.push(setTimeout(onEnd, end));
  return () => timers.forEach((timer) => clearTimeout(timer));
}
