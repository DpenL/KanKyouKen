/**
 * Rendering without loudspeakers, and measuring what was rendered. `renderOffline` runs
 * a timeline through the same graph builders as the live port on an
 * OfflineAudioContext; `estimatePitch` and `rmsLevel` are plain functions over samples,
 * so a browser test can assert "this stroke falls by a fifth" on the actual output.
 */
import type { ScheduledNote, TimbreSpec } from "@kankyouken/mechanics/melody";
import { buildNoise, buildTone } from "./graph";
import { planTimeline } from "./plan";

export const DEFAULT_OFFLINE_SAMPLE_RATE = 22050;

const DEFAULT_TAIL_SECONDS = 0.1;
const DEFAULT_OFFLINE_GAIN = 0.5;
const MIN_CLARITY = 0.5;
const FIRST_PEAK_SHARE = 0.9;
const SILENCE_POWER = 1e-10;

export interface OfflineRenderOptions {
  /** Default 22050, plenty for pitch checks and quick to render. */
  readonly sampleRate?: number;
  readonly timbres?: readonly TimbreSpec[];
  /** Silence rendered after the last note has died away. Default 0.1 s. */
  readonly tailSeconds?: number;
  /** Channels of the result. Default 1: the stereo positions are folded down to mono. */
  readonly channels?: 1 | 2;
  /** Plain output gain, 0..1. Default 0.5. There is no limiter offline, so levels stay measurable. */
  readonly gain?: number;
  /** Beats per minute for notes without a usable duration. Default 132. */
  readonly tempo?: number;
}

export interface PitchRange {
  /** Lowest pitch looked for. Default 50 Hz. */
  readonly minHz?: number;
  /** Highest pitch looked for. Default a quarter of the sample rate. */
  readonly maxHz?: number;
}

/**
 * Renders a timeline to an AudioBuffer: timeline second 0 is sample 0, the buffer ends
 * `tailSeconds` after the last note has died away. An empty timeline gives a buffer of
 * silence as long as the tail (at least one frame). Needs `OfflineAudioContext`, so it
 * runs in browsers only.
 */
export async function renderOffline(
  notes: readonly ScheduledNote[],
  options: OfflineRenderOptions = {},
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? DEFAULT_OFFLINE_SAMPLE_RATE;
  const tail = Math.max(0, options.tailSeconds ?? DEFAULT_TAIL_SECONDS);
  const timeline = planTimeline(notes, { offset: 0, timbres: options.timbres, tempo: options.tempo });
  const frames = Math.max(1, Math.ceil((timeline.end + tail) * sampleRate));
  const context = new OfflineAudioContext(options.channels ?? 1, frames, sampleRate);
  const master = context.createGain();
  master.gain.value = Math.min(1, Math.max(0, options.gain ?? DEFAULT_OFFLINE_GAIN));
  master.connect(context.destination);
  for (const note of timeline.notes) {
    if (note.kind === "tone") buildTone(context, master, note.plan);
    else buildNoise(context, master, note.plan);
  }
  return context.startRendering();
}

/** The sample range [from, to) covered by a time window, clamped to the array; the two times may come in either order. */
function windowOf(length: number, sampleRate: number, fromSeconds: number, toSeconds: number): [number, number] {
  if (!(sampleRate > 0) || Number.isNaN(fromSeconds) || Number.isNaN(toSeconds)) return [0, 0];
  const clamp = (index: number) => Math.min(length, Math.max(0, index));
  const from = clamp(Math.round(Math.min(fromSeconds, toSeconds) * sampleRate));
  const to = clamp(Math.round(Math.max(fromSeconds, toSeconds) * sampleRate));
  return [from, to];
}

/**
 * Root-mean-square level of the samples between two times (seconds from the start of
 * the array). The window is clamped to the array; an empty window gives 0.
 */
export function rmsLevel(samples: Float32Array, sampleRate: number, fromSeconds: number, toSeconds: number): number {
  const [from, to] = windowOf(samples.length, sampleRate, fromSeconds, toSeconds);
  if (to <= from) return 0;
  let power = 0;
  for (let i = from; i < to; i++) power += samples[i]! * samples[i]!;
  return Math.sqrt(power / (to - from));
}

/**
 * Fundamental frequency, in hertz, of the samples between two times, by normalised
 * autocorrelation: the window is compared with itself at every lag, and the first lag at
 * which it matches nearly as well as it ever does is the period (taking the first, not
 * the best, avoids answering an octave too low). The lag is refined between samples by
 * fitting a parabola through the peak.
 *
 * Returns 0 when there is nothing to measure: an empty or very short window (it must
 * hold two periods of the answer), silence, or a signal without a clear period such as
 * noise. The window is clamped to the array and the two times may come in either order.
 * Pitches outside `range` are not found; a tone above `maxHz` may be reported one or
 * more octaves low.
 *
 * It measures the period of the waveform, which for the built-in timbres is the written
 * pitch only when the partials are whole multiples of the fundamental: "whistle" sounds
 * an octave up, "organ" carries a sub-octave, "glass" is inharmonic.
 */
export function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
  fromSeconds: number,
  toSeconds: number,
  range: PitchRange = {},
): number {
  const [from, to] = windowOf(samples.length, sampleRate, fromSeconds, toSeconds);
  const size = to - from;
  const minHz = range.minHz !== undefined && range.minHz > 0 ? range.minHz : 50;
  const maxHz = range.maxHz !== undefined && range.maxHz > 0 ? range.maxHz : sampleRate / 4;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), Math.floor(size / 2) - 1);
  if (maxLag < minLag) return 0;

  let mean = 0;
  for (let i = from; i < to; i++) mean += samples[i]!;
  mean /= size;
  const centred = new Float64Array(size);
  let power = 0;
  for (let i = 0; i < size; i++) {
    const value = samples[from + i]! - mean;
    centred[i] = value;
    power += value * value;
  }
  if (!(power / size > SILENCE_POWER)) return 0;

  const match = new Float64Array(maxLag + 2);
  for (let lag = 0; lag < match.length; lag++) {
    let product = 0;
    let energy = 0;
    for (let i = 0; i + lag < size; i++) {
      const a = centred[i]!;
      const b = centred[i + lag]!;
      product += a * b;
      energy += a * a + b * b;
    }
    match[lag] = energy > 0 ? (2 * product) / energy : 0;
  }

  const peaks: number[] = [];
  let lag = 1;
  while (lag <= maxLag && match[lag]! > 0) lag++;
  while (lag <= maxLag) {
    while (lag <= maxLag && match[lag]! <= 0) lag++;
    let best = -1;
    while (lag <= maxLag && match[lag]! > 0) {
      if (best < 0 || match[lag]! > match[best]!) best = lag;
      lag++;
    }
    const isSummit = best >= minLag && match[best]! >= match[best - 1]! && match[best]! >= match[best + 1]!;
    if (isSummit) peaks.push(best);
  }
  const highest = peaks.reduce((max, peak) => Math.max(max, match[peak]!), 0);
  if (highest < MIN_CLARITY) return 0;
  const period = peaks.find((peak) => match[peak]! >= FIRST_PEAK_SHARE * highest)!;

  const before = match[period - 1]!;
  const at = match[period]!;
  const after = match[period + 1]!;
  const curvature = before - 2 * at + after;
  const refined = curvature < 0 ? period + (0.5 * (before - after)) / curvature : period;
  return sampleRate / refined;
}
