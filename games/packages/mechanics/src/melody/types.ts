/**
 * Melodic signatures: every component owns a short melody (a motif), every stroke of the
 * component owns one element of it, and writing a character correctly "performs" the
 * motifs of its components in stroke order.
 *
 * The rules, and where they come from:
 *  - stroke -> element, component -> motif, composite reuses the motif of the component
 *    it starts with and appends elements for the extra strokes (木 = 十 + 2). Mined from
 *    Radical Tunes (Keehl & Melcer 2019, 2021).
 *  - an element is a pitch GESTURE that follows the stroke's direction: level stroke =
 *    steady note, downward stroke = falling pitch, upward stroke = rising pitch, and the
 *    longer the vertical travel the bigger the interval. Same source.
 *  - motifs are GENERATED from stroke geometry by rule so the mechanic scales to any
 *    character without hand-composing; hand-written motifs can override the generator.
 *    The generator, the scale, the timbre palette and the register spread are our own
 *    design (the papers describe hand-authored melodies and name algorithmic
 *    composition only as future work).
 *
 * Nothing in this module makes sound. It produces descriptions (`VoiceSpec`,
 * `ScheduledNote`) that a host plays through an `AudioPort`.
 */

/** MIDI note number, 60 = middle C. Fractions are allowed (they occur during glides). */
export type Pitch = number;

/** Name of a sound colour. The palette lives in melody/timbres.ts; hosts decide how to render each. */
export type TimbreId = string;

/** One vertex of a pitch gesture: at stroke progress `p` (0 = pen down, 1 = stroke end) the pitch is `pitch`. */
export interface ContourPoint {
  readonly p: number;
  readonly pitch: Pitch;
}

/** The sound of one stroke. */
export interface MelodicElement {
  /**
   * Piecewise-linear pitch over stroke progress. Sorted by `p`, starts at p = 0 and
   * ends at p = 1. A steady note is two points with the same pitch.
   */
  readonly contour: readonly ContourPoint[];
  /** Length in beats when the element is played back without a pen driving it. */
  readonly beats: number;
  /** Stereo position, -1 (left) .. 1 (right), from where the stroke sits horizontally. */
  readonly pan: number;
}

/** The melody of one component: one element per stroke, in stroke order. */
export interface Motif {
  /** Component key: the component's character as drawn (e.g. "木", "氵"). */
  readonly component: string;
  readonly timbre: TimbreId;
  readonly elements: readonly MelodicElement[];
  /**
   * Present when this motif starts with another component's motif: the first `count`
   * elements are that component's elements, unchanged.
   */
  readonly prefix?: { readonly component: string; readonly count: number };
  readonly origin: "authored" | "generated";
}

/** Hand-written motifs. Whatever is found here wins over the generator. */
export type MotifBook = Readonly<Record<string, Pick<Motif, "elements"> & Partial<Pick<Motif, "timbre">>>>;

/**
 * "Component B starts with component A": B's motif is A's motif plus new elements.
 * Maps the longer component to the one it starts with, e.g. { "木": "十" }.
 */
export type PrefixTable = Readonly<Record<string, string>>;

export interface TuningConfig {
  /** Pitch of scale step 0, the bottom of the playable range. */
  readonly tonic: Pitch;
  /** Scale as ascending semitone offsets within one octave, starting at 0. */
  readonly scale: readonly number[];
  /** Scale steps between the bottom and the top of a component's frame. */
  readonly rangeSteps: number;
  /**
   * Vertical travel (fraction of the component frame) below which a stroke counts as
   * level and gets a steady note.
   */
  readonly levelDeadband: number;
  /** Max vertices in an element's contour after simplification (>= 2). */
  readonly maxContourPoints: number;
  /** Beats for the shortest and the longest stroke; lengths in between interpolate. */
  readonly minBeats: number;
  readonly maxBeats: number;
  /**
   * Components are shifted up by 0..registerSpread scale steps (chosen deterministically
   * per component) so that motifs with similar contours still start on different notes.
   * 0 disables the shift. Motifs built on a prefix inherit the shift of that prefix.
   */
  readonly registerSpread: number;
}

export interface TimbreConfig {
  /** "per-component": each component gets its own timbre; "single": one timbre for everything. */
  readonly mode: "per-component" | "single";
  /** Timbres to hand out, in order of preference. In "single" mode only the first is used. */
  readonly palette: readonly TimbreId[];
  /** Fixed assignments that take precedence over automatic ones. */
  readonly assigned?: Readonly<Record<string, TimbreId>>;
}

export interface MelodyConfig {
  readonly tuning: TuningConfig;
  readonly timbre: TimbreConfig;
}

// ---------------------------------------------------------------------------
// The melody of a whole character
// ---------------------------------------------------------------------------

/** A run of consecutive strokes that belong to one component (or to none). */
export interface MelodyUnit {
  /** Component key, or null for strokes that belong to no known component. */
  readonly component: string | null;
  /** Component-tree node ids this run was taken from (empty for loose strokes). */
  readonly nodeIds: readonly string[];
  /** Glyph stroke indices in this run, ascending and consecutive. */
  readonly strokes: readonly number[];
  /** Index within the component's motif of the first stroke in this run (non-zero for later parts of split components). */
  readonly offset: number;
}

export interface MelodyStroke {
  /** Glyph stroke index. */
  readonly stroke: number;
  readonly element: MelodicElement;
  readonly timbre: TimbreId;
  readonly component: string | null;
  /** Position of this stroke inside its component's motif. */
  readonly indexInComponent: number;
  /** Index into `GlyphMelody.units`. */
  readonly unit: number;
  /** True for the first stroke of a unit; hosts may breathe or accent here. */
  readonly startsUnit: boolean;
}

export interface GlyphMelody {
  readonly char: string;
  /** One entry per glyph stroke, in writing order. */
  readonly strokes: readonly MelodyStroke[];
  readonly units: readonly MelodyUnit[];
}

// ---------------------------------------------------------------------------
// What a host is asked to play
// ---------------------------------------------------------------------------

/**
 * The audio layer is a switch, so the same game can run as different study conditions:
 *  - "melody":          the consistent, component-bound melodies (the mnemonic).
 *  - "changing-melody": a freshly invented element for every stroke attempt, same
 *                       timbres: music without the mnemonic.
 *  - "sfx":             a non-musical writing noise.
 *  - "silent":          nothing.
 */
export type StrokeAudioMode = "melody" | "changing-melody" | "sfx" | "silent";

export type VoiceSpec =
  | {
      readonly kind: "tone";
      readonly timbre: TimbreId;
      readonly contour: readonly ContourPoint[];
      readonly pan: number;
      readonly beats: number;
    }
  | {
      readonly kind: "noise";
      /** Which writing noise; hosts may support more. */
      readonly texture: "chalk";
      readonly pan: number;
      readonly beats: number;
    };

/** A voice placed on a timeline, in seconds from the start of playback. */
export interface ScheduledNote {
  readonly start: number;
  readonly duration: number;
  readonly voice: VoiceSpec;
  /** Glyph stroke this note belongs to, so hosts can animate in sync. */
  readonly stroke: number;
}

export interface PlaybackOptions {
  /** Beats per minute. */
  readonly tempo: number;
  /** Silence inserted between units, in beats. */
  readonly unitGapBeats: number;
  /** Silence between strokes inside a unit, in beats. */
  readonly strokeGapBeats: number;
}

/** Short non-melodic signals. "error" is the soft ping for a wrong stroke. */
export type CueName = "error" | "hint" | "complete" | "tick";

/** A sounding voice that follows the pen. */
export interface VoiceHandle {
  /** Move the voice to stroke progress `p` (0..1); the pitch follows the contour. */
  setProgress(p: number): void;
  /** Release the voice. */
  stop(): void;
}

/**
 * What a host must provide to make the mechanics audible. `@kankyouken/web-kit`
 * implements it with Web Audio; another engine implements it with its own mixer.
 */
export interface AudioPort {
  /** Start a voice that sounds until `stop()` (a pen is down and drawing). */
  startVoice(spec: VoiceSpec): VoiceHandle;
  /** Play a prepared timeline; `finished` resolves when it ends or is stopped. */
  play(notes: readonly ScheduledNote[]): { stop(): void; readonly finished: Promise<void> };
  cue(name: CueName): void;
}

// ---------------------------------------------------------------------------
// Timbres as data
// ---------------------------------------------------------------------------

/** Attack / decay / sustain / release; times in seconds, sustain as a 0..1 level. */
export interface Envelope {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

/**
 * A sample-free description of a sound colour, simple enough for any engine:
 * a sum of sine partials, optional vibrato and optional breath noise.
 */
export interface TimbreSpec {
  readonly id: TimbreId;
  /** Human label for settings screens. */
  readonly label: string;
  /** Sine partials: frequency ratio to the fundamental and linear gain. */
  readonly partials: readonly { readonly ratio: number; readonly gain: number }[];
  readonly envelope: Envelope;
  /** Vibrato depth in cents and rate in Hz; omitted = none. */
  readonly vibrato?: { readonly cents: number; readonly hz: number };
  /** Level of filtered noise mixed in (0..1); omitted = none. */
  readonly breath?: number;
  /** Overall level trim, 0..1. */
  readonly gain: number;
}
