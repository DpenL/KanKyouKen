/**
 * Everything about a sound that can be decided without an AudioContext: when each
 * envelope point falls, which frequency the voice has at which moment, what a cue
 * consists of, how loud the chalk is at a given pen speed. graph.ts turns these plans
 * into Web Audio nodes; keeping them as plain data lets them be tested under Node and
 * lets live playback and offline rendering share one description.
 *
 * The mapping from stroke to pitch gesture comes from the melody module (and, through
 * it, from Radical Tunes). How a gesture is voiced (the envelope handling, the cue
 * sounds, the chalk response) is our own design.
 */
import type { CueName, ScheduledNote, TimbreSpec, VoiceSpec } from "@kankyouken/mechanics/melody";
import { NEUTRAL_TIMBRE, TIMBRES, contourPitchAt, pitchToFrequency } from "@kankyouken/mechanics/melody";

export type ToneSpec = Extract<VoiceSpec, { kind: "tone" }>;
export type NoiseSpec = Extract<VoiceSpec, { kind: "noise" }>;

/** Tempo used to turn `VoiceSpec.beats` into seconds when a note carries no usable duration. */
export const DEFAULT_TEMPO = 132;

/** Gain a chalk voice reaches at full pen speed, and the level of a scheduled chalk burst. */
export const CHALK_LEVEL = 0.5;
export const CHALK_BURST_LEVEL = 0.3;

/** Pen speed (stroke progress per second) at which the chalk is at half level. */
export const CHALK_HALF_SPEED = 0.8;

/** Two progress samples closer together than this cannot give a trustworthy speed. */
export const MIN_SPEED_INTERVAL = 0.004;

const NOISE_FADE_IN = 0.02;
const NOISE_FADE_OUT = 0.05;
const CUE_ATTACK = 0.008;

/** Frequency of the fundamental at an absolute time (seconds on the context clock). */
export interface FrequencyPoint {
  readonly time: number;
  readonly hz: number;
}

/** Envelope level (linear, 0..1) at an absolute time; levels between points are joined by straight lines. */
export interface EnvelopePoint {
  readonly time: number;
  readonly level: number;
}

/** One note of one timbre, fully laid out on the context clock. */
export interface TonePlan {
  /** Sine partials that can sound: finite, positive ratio and gain. */
  readonly partials: readonly { readonly ratio: number; readonly gain: number }[];
  /**
   * The pitch gesture of the fundamental. Times never decrease; the list spans
   * `start`..`start + duration`. Between two points the PITCH moves in a straight line,
   * so the frequency moves exponentially. Empty when the voice had no contour: the plan
   * is then silent.
   */
  readonly frequency: readonly FrequencyPoint[];
  /** Amplitude envelope with a peak of 1; times never decrease. */
  readonly envelope: readonly EnvelopePoint[];
  /** Stereo position, -1..1. */
  readonly pan: number;
  readonly vibrato: { readonly cents: number; readonly hz: number } | null;
  /** Level of the breath noise relative to the partials, 0 = none. */
  readonly breath: number;
  /** Overall level trim of the timbre, 0..1. */
  readonly gain: number;
  readonly start: number;
  /** When the last of the sound has died away; `Infinity` for a held tone, which sounds until stopped. */
  readonly end: number;
}

/** A stretch of the writing noise, laid out on the context clock. */
export interface NoisePlan {
  readonly texture: NoiseSpec["texture"];
  /** Absolute gain over time; a held noise starts silent and is driven live. */
  readonly envelope: readonly EnvelopePoint[];
  readonly pan: number;
  readonly start: number;
  /** `Infinity` for a held noise. */
  readonly end: number;
}

/** One sine blip of a cue: glides from `fromHz` to `toHz` while it fades. */
export interface CuePlan {
  readonly fromHz: number;
  readonly toHz: number;
  readonly start: number;
  readonly duration: number;
  /** Peak gain, 0..1. */
  readonly gain: number;
}

export type NotePlan =
  | { readonly kind: "tone"; readonly stroke: number; readonly plan: TonePlan }
  | { readonly kind: "noise"; readonly stroke: number; readonly plan: NoisePlan };

export interface TimelinePlan {
  /** One entry per scheduled note, in the order given. */
  readonly notes: readonly NotePlan[];
  /** When the last note has died away; equals the offset for an empty timeline. */
  readonly end: number;
}

export interface TimelineOptions {
  /** Context time of timeline second 0. Default 0. */
  readonly offset?: number;
  readonly timbres?: readonly TimbreSpec[];
  readonly tempo?: number;
}

/** A progress reading of the pen at a moment of context time. */
export interface SpeedSample {
  readonly p: number;
  readonly time: number;
}

function seconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function panOf(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}

function soundingPartials(timbre: TimbreSpec): TonePlan["partials"] {
  return timbre.partials
    .filter((partial) => Number.isFinite(partial.ratio) && partial.ratio > 0)
    .filter((partial) => Number.isFinite(partial.gain) && partial.gain > 0)
    .map((partial) => ({ ratio: partial.ratio, gain: partial.gain }));
}

function vibratoOf(timbre: TimbreSpec): TonePlan["vibrato"] {
  const vibrato = timbre.vibrato;
  if (!vibrato || !Number.isFinite(vibrato.cents) || !Number.isFinite(vibrato.hz)) return null;
  return vibrato.cents > 0 && vibrato.hz > 0 ? { cents: vibrato.cents, hz: vibrato.hz } : null;
}

/**
 * Looks a timbre up by id. An unknown id falls back to the neutral timbre: first the one
 * in the given list, then the built-in one, so a custom palette without a neutral entry
 * still produces sound. Never throws.
 */
export function resolveTimbre(id: string, timbres: readonly TimbreSpec[] = TIMBRES): TimbreSpec {
  const neutral = (list: readonly TimbreSpec[]) => list.find((timbre) => timbre.id === NEUTRAL_TIMBRE);
  return timbres.find((timbre) => timbre.id === id) ?? neutral(timbres) ?? neutral(TIMBRES) ?? TIMBRES[0]!;
}

/**
 * Lays out one note of fixed length: the contour becomes absolute times (vertex `p` maps
 * to `start + p * duration`) and frequencies, the timbre's envelope becomes five points:
 * silence at `start`, the peak after the attack, the sustain level after the decay, the
 * same level at `start + duration`, silence after the release. The plan ends at
 * `start + duration + release`.
 *
 * Edge cases:
 *  - a note shorter than attack + decay squeezes both by the same factor, so the peak
 *    still happens and the sustain level is reached exactly when the note ends;
 *  - a negative or non-finite duration counts as 0, which leaves only the release tail;
 *  - contour vertices with `p` outside 0..1 are clamped, vertices with a non-finite `p`
 *    or pitch are skipped, and a contour that does not reach p = 0 or p = 1 holds its
 *    first or last pitch up to that edge;
 *  - an empty contour gives an empty `frequency` list: a silent plan that still occupies
 *    its time span;
 *  - partials with a non-positive ratio or gain are dropped; pan is clamped to -1..1.
 */
export function planTone(spec: ToneSpec, timbre: TimbreSpec, start: number, duration: number): TonePlan {
  const length = seconds(duration);
  const attack = seconds(timbre.envelope.attack);
  const decay = seconds(timbre.envelope.decay);
  const release = seconds(timbre.envelope.release);
  const sustain = unit(timbre.envelope.sustain);
  const squeezed = attack + decay > length;
  const peakAt = start + (squeezed ? (attack * length) / (attack + decay) : attack);
  const noteEnd = start + length;
  const sustainAt = squeezed ? noteEnd : Math.min(peakAt + decay, noteEnd);

  const frequency: FrequencyPoint[] = [];
  let latest = start;
  for (const vertex of spec.contour) {
    if (!Number.isFinite(vertex.p) || !Number.isFinite(vertex.pitch)) continue;
    latest = Math.max(latest, start + unit(vertex.p) * length);
    frequency.push({ time: latest, hz: pitchToFrequency(vertex.pitch) });
  }
  const head = frequency[0];
  const tail = frequency[frequency.length - 1];
  if (head && head.time > start) frequency.unshift({ time: start, hz: head.hz });
  if (tail && tail.time < noteEnd) frequency.push({ time: noteEnd, hz: tail.hz });

  return {
    partials: soundingPartials(timbre),
    frequency,
    envelope: [
      { time: start, level: 0 },
      { time: peakAt, level: 1 },
      { time: sustainAt, level: sustain },
      { time: noteEnd, level: sustain },
      { time: noteEnd + release, level: 0 },
    ],
    pan: panOf(spec.pan),
    vibrato: vibratoOf(timbre),
    breath: unit(timbre.breath ?? 0),
    gain: unit(timbre.gain),
    start,
    end: noteEnd + release,
  };
}

/**
 * Lays out a tone that sounds for as long as a pen is down: attack and decay as written
 * in the timbre, then the sustain level with no release (the release happens when the
 * voice is stopped), `end` is `Infinity`. The frequency is a single point, the contour's
 * pitch at p = 0; the host glides it as the pen moves. An empty contour gives a silent
 * plan, as in `planTone`.
 */
export function planHeldTone(spec: ToneSpec, timbre: TimbreSpec, start: number): TonePlan {
  const attack = seconds(timbre.envelope.attack);
  const decay = seconds(timbre.envelope.decay);
  const pitch = spec.contour.length > 0 ? contourPitchAt(spec.contour, 0) : NaN;
  return {
    partials: soundingPartials(timbre),
    frequency: Number.isFinite(pitch) ? [{ time: start, hz: pitchToFrequency(pitch) }] : [],
    envelope: [
      { time: start, level: 0 },
      { time: start + attack, level: 1 },
      { time: start + attack + decay, level: unit(timbre.envelope.sustain) },
    ],
    pan: panOf(spec.pan),
    vibrato: vibratoOf(timbre),
    breath: unit(timbre.breath ?? 0),
    gain: unit(timbre.gain),
    start,
    end: Infinity,
  };
}

/**
 * Frequency of a plan's fundamental at an absolute time, interpolated the way the graph
 * renders it (straight lines in pitch). Before the first point it is the first
 * frequency, after the last point the last one; where two points share a time the later
 * one wins. 0 for a silent plan.
 */
export function toneFrequencyAt(plan: TonePlan, time: number): number {
  const points = plan.frequency;
  const first = points[0];
  if (!first) return 0;
  if (time <= first.time) return first.hz;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (time < b.time) return a.hz * (b.hz / a.hz) ** ((time - a.time) / (b.time - a.time));
  }
  return points[points.length - 1]!.hz;
}

/**
 * Lays out a burst of writing noise at a fixed level: a 20 ms fade in (at most half the
 * burst), the level held to `start + duration`, a 50 ms fade out. A negative or
 * non-finite duration counts as 0, which leaves a 50 ms puff; the level is clamped to 0..1.
 */
export function planNoiseBurst(
  spec: NoiseSpec,
  start: number,
  duration: number,
  level: number = CHALK_BURST_LEVEL,
): NoisePlan {
  const length = seconds(duration);
  const peak = unit(level);
  const end = start + length + NOISE_FADE_OUT;
  return {
    texture: spec.texture,
    envelope: [
      { time: start, level: 0 },
      { time: start + Math.min(NOISE_FADE_IN, length / 2), level: peak },
      { time: start + length, level: peak },
      { time: end, level: 0 },
    ],
    pan: panOf(spec.pan),
    start,
    end,
  };
}

/** Lays out a writing noise that lasts until stopped: silent at `start`, its level is driven live from pen speed. */
export function planHeldNoise(spec: NoiseSpec, start: number): NoisePlan {
  return { texture: spec.texture, envelope: [{ time: start, level: 0 }], pan: panOf(spec.pan), start, end: Infinity };
}

function blip(fromHz: number, toHz: number, start: number, duration: number, gain: number): CuePlan {
  return { fromHz, toHz, start, duration, gain };
}

function steadyBlip(pitch: number, start: number, duration: number, gain: number): CuePlan {
  const hz = pitchToFrequency(pitch);
  return blip(hz, hz, start, duration, gain);
}

/**
 * The sine blips of a cue, placed from `start` on:
 *  - "error": one soft, low blip falling from 330 Hz to 220 Hz in 0.18 s. Deliberately
 *    gentle: Radical Tunes answers a wrong stroke with a quiet ping, not a buzzer.
 *  - "hint": two soft notes, the second a fourth higher (E5 then A5).
 *  - "complete": a rising C5 E5 G5 arpeggio from the major pentatonic, the last note ringing.
 *  - "tick": one 20 ms click-like blip.
 * An unknown name gives no blips.
 */
export function planCue(name: CueName, start: number): CuePlan[] {
  switch (name) {
    case "error":
      return [blip(330, 220, start, 0.18, 0.25)];
    case "hint":
      return [steadyBlip(76, start, 0.12, 0.18), steadyBlip(81, start + 0.13, 0.2, 0.18)];
    case "complete":
      return [
        steadyBlip(72, start, 0.12, 0.22),
        steadyBlip(76, start + 0.1, 0.12, 0.22),
        steadyBlip(79, start + 0.2, 0.4, 0.22),
      ];
    case "tick":
      return [blip(1500, 1000, start, 0.02, 0.2)];
    default:
      return [];
  }
}

/**
 * Envelope of one cue blip: silence, the peak after 8 ms (a quarter of the blip when it
 * is shorter than 32 ms), a straight fade to silence at the blip's end. A negative
 * duration counts as 0.
 */
export function cueEnvelope(cue: CuePlan): EnvelopePoint[] {
  const length = seconds(cue.duration);
  return [
    { time: cue.start, level: 0 },
    { time: cue.start + Math.min(CUE_ATTACK, length / 4), level: unit(cue.gain) },
    { time: cue.start + length, level: 0 },
  ];
}

/** When the last blip of a cue has faded; `fallback` for an empty cue. */
export function cueEnd(cues: readonly CuePlan[], fallback: number = 0): number {
  return cues.length === 0 ? fallback : Math.max(...cues.map((cue) => cue.start + seconds(cue.duration)));
}

/**
 * Chalk level for a pen speed given in stroke progress per second: 0 at rest, one half
 * at `CHALK_HALF_SPEED`, approaching 1 for fast strokes. The curve
 * speed² / (speed² + half²) is flat near 0, so the jitter of a resting pen stays
 * silent, and bends over softly instead of clipping. The sign of the speed is ignored;
 * NaN gives 0 and an infinite speed gives 1.
 */
export function chalkGain(speed: number): number {
  if (Number.isNaN(speed)) return 0;
  const magnitude = Math.abs(speed);
  if (magnitude === Infinity) return 1;
  const squared = magnitude * magnitude;
  return squared / (squared + CHALK_HALF_SPEED * CHALK_HALF_SPEED);
}

/**
 * Pen speed between an earlier sample and a new reading, in stroke progress per second
 * (never negative). Returns null when less than `MIN_SPEED_INTERVAL` has passed or time
 * ran backwards: the caller should keep the earlier sample and measure against it again,
 * so the movement is not lost, only counted in the next reading.
 */
export function penSpeed(previous: SpeedSample, p: number, time: number): number | null {
  const elapsed = time - previous.time;
  if (!(elapsed >= MIN_SPEED_INTERVAL) || !Number.isFinite(p)) return null;
  return Math.abs(p - previous.p) / elapsed;
}

/**
 * Length of a scheduled note in seconds: its `duration` when that is positive and
 * finite, otherwise the voice's `beats` at `tempo` beats per minute, otherwise 0.
 */
export function noteSeconds(note: ScheduledNote, tempo: number = DEFAULT_TEMPO): number {
  if (Number.isFinite(note.duration) && note.duration > 0) return note.duration;
  const bpm = Number.isFinite(tempo) && tempo > 0 ? tempo : DEFAULT_TEMPO;
  return seconds((note.voice.beats * 60) / bpm);
}

/**
 * Lays out a whole timeline: every note becomes a tone or noise plan starting at
 * `offset + note.start`. Unknown timbres fall back to the neutral one; a negative or
 * non-finite `start` counts as 0; durations go through `noteSeconds`. `end` is the
 * moment the last note has died away, which for an empty list is the offset itself.
 */
export function planTimeline(notes: readonly ScheduledNote[], options: TimelineOptions = {}): TimelinePlan {
  const offset = options.offset ?? 0;
  const timbres = options.timbres ?? TIMBRES;
  const tempo = options.tempo ?? DEFAULT_TEMPO;
  let end = offset;
  const plans = notes.map((note): NotePlan => {
    const start = offset + seconds(note.start);
    const duration = noteSeconds(note, tempo);
    const voice = note.voice;
    const planned: NotePlan =
      voice.kind === "tone"
        ? { kind: "tone", stroke: note.stroke, plan: planTone(voice, resolveTimbre(voice.timbre, timbres), start, duration) }
        : { kind: "noise", stroke: note.stroke, plan: planNoiseBurst(voice, start, duration) };
    end = Math.max(end, planned.plan.end);
    return planned;
  });
  return { notes: plans, end };
}

/**
 * `length` samples of white noise, uniform in -1..1, from a small seeded generator
 * (mulberry32) so that renders are reproducible. A non-positive or non-finite length
 * gives an empty array.
 */
export function whiteNoise(length: number, seed: number = 1): Float32Array {
  const samples = new Float32Array(Number.isFinite(length) && length > 0 ? Math.floor(length) : 0);
  let state = seed >>> 0;
  for (let i = 0; i < samples.length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    samples[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return samples;
}
