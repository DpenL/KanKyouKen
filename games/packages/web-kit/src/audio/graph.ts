/**
 * The thin Web Audio layer: turns the plans of plan.ts into nodes on any
 * BaseAudioContext, live or offline. Nothing here decides WHAT to play; every builder
 * schedules what its plan says and hands back the few controls a host needs.
 *
 * Signal path of every sound: sources -> envelope -> gate -> panner -> destination.
 * The gate is a gain that stays at the sound's level and is only touched by `stop`, so
 * a sound can be faded from any point of its envelope without `cancelAndHoldAtTime`,
 * which not every browser has.
 */
import type { CuePlan, EnvelopePoint, FrequencyPoint, NoisePlan, TonePlan } from "./plan";
import { cueEnd, cueEnvelope, whiteNoise } from "./plan";

/** Default length of the fade `stop` applies, short enough to feel immediate, long enough not to click. */
export const STOP_FADE_SECONDS = 0.015;

const MIN_FADE_SECONDS = 0.003;
const MIN_HZ = 1;
const NOISE_LOOP_SECONDS = 2;
const CHALK_CENTER_HZ = 3000;
const CHALK_Q = 0.8;
const BREATH_Q = 1.5;
/** Band-passing white noise removes most of its power; this brings `breath` back to the scale of a partial's gain. */
const BREATH_MAKEUP = 6;

export interface SoundNodes {
  /**
   * Fades the sound out from context time `at` (or from now, when `at` has passed) over
   * `fade` seconds, then stops its sources and frees its nodes. Calling it again, or
   * after the sound has ended on its own, does nothing.
   */
  stop(at: number, fade?: number): void;
}

export interface ToneNodes extends SoundNodes {
  /** The frequency of each sounding partial's oscillator: already the fundamental times that partial's ratio. */
  readonly frequencyParams: AudioParam[];
  /** The ratio behind each entry of `frequencyParams`. */
  readonly ratios: number[];
  /**
   * Moves the fundamental towards `hz` from context time `at` on, approaching it with
   * the given time constant (0 jumps). Every partial keeps its ratio and the breath
   * filter follows. Non-positive or non-finite frequencies are ignored.
   */
  glideTo(hz: number, at: number, timeConstant: number): void;
}

export interface NoiseNodes extends SoundNodes {
  /** Gain of the noise; the plan's envelope is scheduled on it, a host may drive it further. */
  readonly level: AudioParam;
}

function when(time: number): number {
  return Number.isFinite(time) ? Math.max(0, time) : 0;
}

function audible(hz: number, ceiling: number): number {
  return Number.isNaN(hz) ? MIN_HZ : Math.min(Math.max(hz, MIN_HZ), ceiling);
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function scheduleEnvelope(param: AudioParam, points: readonly EnvelopePoint[]): void {
  const first = points[0];
  if (!first) return;
  param.setValueAtTime(first.level, when(first.time));
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    param.linearRampToValueAtTime(point.level, when(point.time));
  }
}

/** Exponential ramps between frequency points are straight lines in pitch, which is how contours are defined. */
function scheduleFrequency(param: AudioParam, points: readonly FrequencyPoint[], ratio: number, ceiling: number): void {
  const first = points[0];
  if (!first) return;
  param.setValueAtTime(audible(first.hz * ratio, ceiling), when(first.time));
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    param.exponentialRampToValueAtTime(audible(point.hz * ratio, ceiling), when(point.time));
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_LOOP_SECONDS));
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    buffer.getChannelData(0).set(whiteNoise(length));
    noiseBuffers.set(ctx, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

/**
 * Ends the sources at `end` (when finite), disconnects everything once they have ended,
 * and returns the `stop` that fades the gate early. All sources of a sound end together,
 * so listening to the first one is enough.
 */
function manage(
  ctx: BaseAudioContext,
  sources: readonly AudioScheduledSourceNode[],
  nodes: readonly AudioNode[],
  gate: AudioParam,
  level: number,
  end: number,
): SoundNodes["stop"] {
  const first = sources[0];
  if (first) {
    first.onended = () => {
      for (const node of nodes) node.disconnect();
    };
  }
  if (Number.isFinite(end)) for (const source of sources) source.stop(when(end));
  let stopped = false;
  return (at, fade = STOP_FADE_SECONDS) => {
    if (stopped) return;
    stopped = true;
    const from = Math.max(when(at), ctx.currentTime);
    const until = from + Math.max(Number.isFinite(fade) ? fade : 0, MIN_FADE_SECONDS);
    if (until >= end) return;
    gate.setValueAtTime(level, from);
    gate.linearRampToValueAtTime(0, until);
    for (const source of sources) {
      try {
        source.stop(until);
      } catch {
        // An engine that refuses a second stop() still ends the source at its planned end; the gate has silenced it by then.
      }
    }
  };
}

/**
 * Builds one tone: a sine oscillator per partial, a gain envelope of linear ramps, the
 * timbre's level, a stereo panner. Vibrato is one LFO whose depth in cents feeds every
 * oscillator's `detune`; breath is looped white noise through a band-pass that sits on
 * the fundamental and follows it, mixed in ahead of the envelope so it swells and fades
 * with the note.
 *
 * The pitch gesture is scheduled on every oscillator separately (its frequency is the
 * fundamental times the partial's ratio), rather than driven from one shared control
 * signal: that keeps each `frequencyParams` entry a plain frequency in hertz that a host
 * can retarget directly.
 *
 * A finite plan stops and disconnects itself at `plan.end`; a held plan (`end` is
 * `Infinity`) sounds until `stop`. Partials that would reach the Nyquist frequency are
 * left out. A plan with no frequency points or no playable partial builds nothing and
 * returns controls that do nothing.
 */
export function buildTone(ctx: BaseAudioContext, destination: AudioNode, plan: TonePlan): ToneNodes {
  const nyquist = ctx.sampleRate / 2;
  const top = plan.frequency.reduce((max, point) => Math.max(max, point.hz), 0);
  const partials = plan.partials.filter((partial) => partial.ratio * top < nyquist);
  if (!(top > 0) || partials.length === 0) {
    return { frequencyParams: [], ratios: [], glideTo: () => undefined, stop: () => undefined };
  }

  const start = when(plan.start);
  const envelope = gainNode(ctx, 0);
  scheduleEnvelope(envelope.gain, plan.envelope);
  const gate = gainNode(ctx, plan.gain);
  const panner = ctx.createStereoPanner();
  panner.pan.value = plan.pan;
  envelope.connect(gate).connect(panner).connect(destination);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [envelope, gate, panner];
  const oscillators: OscillatorNode[] = [];
  for (const partial of partials) {
    const oscillator = ctx.createOscillator();
    scheduleFrequency(oscillator.frequency, plan.frequency, partial.ratio, nyquist);
    const level = gainNode(ctx, partial.gain);
    oscillator.connect(level).connect(envelope);
    oscillator.start(start);
    oscillators.push(oscillator);
    sources.push(oscillator);
    nodes.push(oscillator, level);
  }

  if (plan.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = plan.vibrato.hz;
    const depth = gainNode(ctx, plan.vibrato.cents);
    lfo.connect(depth);
    for (const oscillator of oscillators) depth.connect(oscillator.detune);
    lfo.start(start);
    sources.push(lfo);
    nodes.push(lfo, depth);
  }

  let breathFrequency: AudioParam | null = null;
  if (plan.breath > 0) {
    const noise = noiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = BREATH_Q;
    scheduleFrequency(filter.frequency, plan.frequency, 1, nyquist);
    const level = gainNode(ctx, plan.breath * BREATH_MAKEUP);
    noise.connect(filter).connect(level).connect(envelope);
    noise.start(start, start % NOISE_LOOP_SECONDS);
    breathFrequency = filter.frequency;
    sources.push(noise);
    nodes.push(noise, filter, level);
  }

  const frequencyParams = oscillators.map((oscillator) => oscillator.frequency);
  const ratios = partials.map((partial) => partial.ratio);
  const glide = (param: AudioParam, hz: number, at: number, timeConstant: number): void => {
    if (timeConstant > 0) param.setTargetAtTime(audible(hz, nyquist), at, timeConstant);
    else param.setValueAtTime(audible(hz, nyquist), at);
  };
  return {
    frequencyParams,
    ratios,
    glideTo(hz, at, timeConstant) {
      if (!Number.isFinite(hz) || hz <= 0) return;
      frequencyParams.forEach((param, i) => glide(param, hz * ratios[i]!, when(at), timeConstant));
      if (breathFrequency) glide(breathFrequency, hz, when(at), timeConstant);
    },
    stop: manage(ctx, sources, nodes, gate.gain, plan.gain, plan.end),
  };
}

/**
 * Builds the writing noise: looped white noise through a wide band-pass around 3 kHz
 * (Q 0.8), which reads as chalk or a brush dragged over a surface, then a gain that
 * carries the plan's envelope and is returned as `level` so a host can drive it from pen
 * speed. Every texture is rendered as chalk for now. A finite plan frees itself at
 * `plan.end`; a held plan sounds (at whatever `level` says) until `stop`.
 */
export function buildNoise(ctx: BaseAudioContext, destination: AudioNode, plan: NoisePlan): NoiseNodes {
  const start = when(plan.start);
  const source = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = Math.min(CHALK_CENTER_HZ, ctx.sampleRate * 0.45);
  filter.Q.value = CHALK_Q;
  const level = gainNode(ctx, 0);
  scheduleEnvelope(level.gain, plan.envelope);
  const gate = gainNode(ctx, 1);
  const panner = ctx.createStereoPanner();
  panner.pan.value = plan.pan;
  source.connect(filter).connect(level).connect(gate).connect(panner).connect(destination);
  source.start(start, start % NOISE_LOOP_SECONDS);
  return {
    level: level.gain,
    stop: manage(ctx, [source], [source, filter, level, gate, panner], gate.gain, 1, plan.end),
  };
}

/**
 * Builds a cue: one sine oscillator per blip, gliding from `fromHz` to `toHz` under the
 * envelope of `cueEnvelope`, centred in the stereo field. The nodes free themselves when
 * the last blip has faded. An empty list builds nothing.
 */
export function buildCue(ctx: BaseAudioContext, destination: AudioNode, plans: readonly CuePlan[]): SoundNodes {
  if (plans.length === 0) return { stop: () => undefined };
  const nyquist = ctx.sampleRate / 2;
  const gate = gainNode(ctx, 1);
  gate.connect(destination);
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [gate];
  for (const plan of plans) {
    const oscillator = ctx.createOscillator();
    scheduleFrequency(
      oscillator.frequency,
      [
        { time: plan.start, hz: plan.fromHz },
        { time: plan.start + Math.max(0, plan.duration), hz: plan.toHz },
      ],
      1,
      nyquist,
    );
    const envelope = gainNode(ctx, 0);
    scheduleEnvelope(envelope.gain, cueEnvelope(plan));
    oscillator.connect(envelope).connect(gate);
    oscillator.start(when(plan.start));
    sources.push(oscillator);
    nodes.push(oscillator, envelope);
  }
  return { stop: manage(ctx, sources, nodes, gate.gain, 1, cueEnd(plans)) };
}
