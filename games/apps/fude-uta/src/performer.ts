import type { GlyphMelody, StrokeAudioMode, TuningConfig } from "@kankyouken/mechanics/melody";
import { scheduleMelody } from "@kankyouken/mechanics/melody";
import type { Rng } from "@kankyouken/mechanics/util";
import { PLAY_LEAD_SECONDS } from "@kankyouken/web-kit/audio";
import type { StrokeCue } from "./playback";
import { runCues, strokeCues } from "./playback";
import type { Sound } from "./sound";

export interface PerformOptions {
  readonly mode: StrokeAudioMode;
  /** Beats per minute; the library's default when omitted. */
  readonly tempo?: number;
  /** A stroke's note begins: animate it for `cue.durationMs`. */
  onStroke(cue: StrokeCue): void;
  /** The melody has run its length (not called when the performance is stopped). */
  onEnd?(): void;
}

/** Plays a character's melody while telling the screen which stroke sounds. One performance at a time. */
export interface Performer {
  perform(melody: GlyphMelody, options: PerformOptions): void;
  stop(): void;
}

export function createPerformer(sound: Sound, tuning: () => TuningConfig, rng: Rng): Performer {
  let stopCurrent: (() => void) | null = null;
  const stop = (): void => {
    stopCurrent?.();
    stopCurrent = null;
  };
  return {
    perform(melody, options) {
      stop();
      const playback = options.tempo === undefined ? {} : { tempo: options.tempo };
      const audio = sound.play(scheduleMelody(melody, options.mode, tuning(), rng, playback));
      // The port schedules audio slightly ahead of time; the visuals wait just as long.
      const cues = strokeCues(melody, tuning(), rng, playback).map((cue) => ({
        ...cue,
        startMs: cue.startMs + PLAY_LEAD_SECONDS * 1000,
      }));
      const cancel = runCues(cues, options.onStroke, () => {
        stopCurrent = null;
        options.onEnd?.();
      });
      stopCurrent = () => {
        cancel();
        audio.stop();
      };
    },
    stop,
  };
}
