import type { Melodist, StrokeAudioMode } from "@kankyouken/mechanics/melody";
import type { GameEvent } from "@kankyouken/mechanics/telemetry";
import type { Point, Rng } from "@kankyouken/mechanics/util";
import type { Content } from "./content";
import type { LeftBy } from "./left";
import type { Performer } from "./performer";
import type { Settings } from "./settings";
import type { Sound } from "./sound";

/** What the screen currently asks of the player; exposed read-only as `window.__kk` in debug mode. */
export interface Probe {
  screen: "home" | "learn" | "timed" | "results" | "recall" | "recall-summary";
  /** "demo", "trace:<guide>", "rest" (a finished repetition on show), "complete", "timed", "recall"; null in between. */
  stage: string | null;
  char: string | null;
  rep: number | null;
  expected: number | null;
  /** Stroke medians of the current character, in glyph space. */
  medians: readonly (readonly Point[])[] | null;
}

export const IDLE_PROBE: Omit<Probe, "screen"> = {
  stage: null,
  char: null,
  rep: null,
  expected: null,
  medians: null,
};

/** Everything the screens share. */
export interface Env {
  readonly content: Content;
  /** Decides orders (timed round, recall round). */
  readonly rng: Rng;
  /** Feeds the "random notes" sound mode, so that sound never disturbs item orders. */
  readonly audioRng: Rng;
  readonly sound: Sound;
  readonly performer: Performer;
  readonly probe: Probe;
  settings(): Settings;
  /** The sound mode in effect (a study condition overrides the setting). */
  audioMode(): StrokeAudioMode;
  melodist(): Melodist;
  emit(event: GameEvent): void;
}

/** A screen activity that can be abandoned at any moment (the player went back, or closed the page). */
export interface Mode {
  /** Record, as `lesson_abandoned`, what is being left unfinished. Records nothing once the activity has run its course. */
  recordLeft(by: LeftBy): void;
  stop(): void;
}
