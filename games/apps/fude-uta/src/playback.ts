import type { GlyphMelody, PlaybackOptions, ScheduledNote, TuningConfig } from "@kankyouken/mechanics/melody";
import { scheduleMelody } from "@kankyouken/mechanics/melody";
import type { Rng } from "@kankyouken/mechanics/util";

/** When a stroke sounds in a performance, in milliseconds from its start. */
export interface StrokeCue {
  readonly stroke: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * The timing of a character's melody, whatever the sound mode: the visuals of a silent
 * performance keep the rhythm the melody would have had.
 */
export function strokeCues(melody: GlyphMelody, tuning: TuningConfig, rng: Rng, options: Partial<PlaybackOptions> = {}): StrokeCue[] {
  return scheduleMelody(melody, "melody", tuning, rng, options).map(toCue);
}

const toCue = (note: ScheduledNote): StrokeCue => ({
  stroke: note.stroke,
  startMs: note.start * 1000,
  durationMs: note.duration * 1000,
});

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
