/**
 * The Web Audio implementation of the mechanics' `AudioPort`: pen-driven voices, timed
 * playback and cues on one AudioContext, behind a master gain and a limiter.
 *
 * Browsers only let audio start after a user gesture: create the port whenever you
 * like, and call `resume()` from the first pointer or key event.
 */
import type { AudioPort, CueName, ScheduledNote, TimbreSpec, VoiceHandle } from "@kankyouken/mechanics/melody";
import { TIMBRES, contourPitchAt, pitchToFrequency } from "@kankyouken/mechanics/melody";
import type { SoundNodes } from "./graph";
import { STOP_FADE_SECONDS, buildCue, buildNoise, buildTone } from "./graph";
import type { NoiseSpec, SpeedSample, ToneSpec } from "./plan";
import {
  CHALK_LEVEL,
  DEFAULT_TEMPO,
  chalkGain,
  penSpeed,
  planCue,
  planHeldNoise,
  planHeldTone,
  planTimeline,
  resolveTimbre,
} from "./plan";

export const DEFAULT_MASTER_GAIN = 0.5;
export const DEFAULT_GLIDE_SECONDS = 0.03;

/** Playback is scheduled this far ahead of the context clock so that the first note starts cleanly. */
export const PLAY_LEAD_SECONDS = 0.05;

/** Pen voices and cues start this far ahead: inaudible as latency, enough for the attack to be rendered whole. */
const VOICE_LEAD_SECONDS = 0.005;

/** The chalk follows a new speed reading this fast, holds it this long, then falls silent with this time constant. */
const CHALK_RISE_SECONDS = 0.012;
const CHALK_HOLD_SECONDS = 0.025;
const CHALK_FALL_SECONDS = 0.018;
const CHALK_RELEASE_SECONDS = 0.06;

/**
 * The limiter: a compressor that leaves a single voice almost alone and holds a pile of
 * voices down. A DynamicsCompressorNode adds make-up gain by itself (about 1.47 times
 * for these settings); the trim takes it out again, so quiet sounds pass at the level
 * the master gain says and the loudest mixes stay well below full scale.
 */
const LIMITER_THRESHOLD_DB = -10;
const LIMITER_KNEE_DB = 10;
const LIMITER_RATIO = 12;
const LIMITER_ATTACK_SECONDS = 0.001;
const LIMITER_RELEASE_SECONDS = 0.25;
const LIMITER_TRIM = 0.68;

const MASTER_SMOOTHING_SECONDS = 0.015;
const CLOSE_FADE_MILLISECONDS = 60;
const TIMER_SLACK_MILLISECONDS = 20;

export interface WebAudioPortOptions {
  /** Context to play on. Omitted: the port creates its own, and closes it in `close()`. */
  readonly context?: AudioContext;
  /** Timbre palette; ids not found in it fall back to the neutral timbre. Default: the built-in palette. */
  readonly timbres?: readonly TimbreSpec[];
  /** Master level, 0..1. Default 0.5. */
  readonly masterGain?: number;
  /** Beats per minute, used for notes that carry no usable duration of their own. Default 132. */
  readonly tempo?: number;
  /** Time constant with which a pen voice follows the contour. Default 0.03 s; 0 jumps. */
  readonly glideSeconds?: number;
}

export interface WebAudioPort extends AudioPort {
  readonly context: AudioContext;
  /**
   * Lets the context run. Browsers require this to happen inside a user gesture (pointer
   * or key event); outside of one the promise may stay pending until a later gesture.
   * Safe to call on every gesture; does nothing once the port is closed.
   */
  resume(): Promise<void>;
  /** Sets the master level, clamped to 0..1, smoothed over a few milliseconds. Non-finite values are ignored. */
  setMasterGain(v: number): void;
  /**
   * Silences everything, resolves every pending `finished`, and closes the context if
   * the port created it (a context that was passed in is left open for its owner).
   * Afterwards the port accepts calls but makes no sound. Safe to call repeatedly.
   */
  close(): Promise<void>;
}

const SILENT_VOICE: VoiceHandle = { setProgress: () => undefined, stop: () => undefined };

function level(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** `value` when it is a finite number that is not negative, otherwise `fallback`. */
function usable(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Creates the Web Audio port.
 *
 *  - `startVoice` (tone): the timbre's attack and decay, then the sustain level for as
 *    long as the pen is down. The voice starts on the contour's pitch at p = 0;
 *    `setProgress(p)` glides every partial to its ratio times the contour's frequency at
 *    `p` (p is clamped to 0..1, NaN is ignored); `stop()` releases over the timbre's
 *    release time. A voice with an empty contour is silent.
 *  - `startVoice` (noise): chalk whose level follows pen speed. Each `setProgress(p)`
 *    measures the change in `p` over context time; the first call only sets the
 *    reference point, and when calls stop arriving the chalk falls silent within about
 *    80 ms, so a resting pen is quiet.
 *  - `play`: schedules the notes 50 ms ahead. `finished` resolves when the last note has
 *    died away, at once for an empty list, and at once on `stop()`, which also fades
 *    whatever is sounding. If the context is not running when the timeline should have
 *    ended (audio still locked, tab interrupted), the notes are dropped and `finished`
 *    resolves anyway, so game flow never waits on blocked audio.
 *  - `cue`: the blips of `planCue`.
 *
 * Everything is mixed through a master gain into a compressor set up as a limiter, so
 * overlapping voices do not clip. Unknown timbre ids fall back to the neutral timbre;
 * a negative or non-finite `masterGain` or `glideSeconds` falls back to its default.
 * Throws only if no context is given and the environment has no `AudioContext`.
 */
export function createWebAudioPort(options: WebAudioPortOptions = {}): WebAudioPort {
  const context = options.context ?? new AudioContext({ latencyHint: "interactive" });
  const ownsContext = options.context === undefined;
  const timbres = options.timbres ?? TIMBRES;
  const tempo = options.tempo ?? DEFAULT_TEMPO;
  const glideSeconds = usable(options.glideSeconds, DEFAULT_GLIDE_SECONDS);

  const master = context.createGain();
  master.gain.value = level(usable(options.masterGain, DEFAULT_MASTER_GAIN));
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = LIMITER_KNEE_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = LIMITER_ATTACK_SECONDS;
  limiter.release.value = LIMITER_RELEASE_SECONDS;
  const trim = context.createGain();
  trim.gain.value = LIMITER_TRIM;
  master.connect(limiter).connect(trim).connect(context.destination);

  /** Fast silencers of everything that may still sound; `close()` runs them all. */
  const active = new Set<() => void>();
  let closed = false;

  /** Registers a pen voice with `close()` and returns the one-shot that ends it with a given fade. */
  const track = (nodes: SoundNodes): { readonly live: () => boolean; readonly end: (fade: number) => void } => {
    let live = true;
    const end = (fade: number): void => {
      if (!live) return;
      live = false;
      active.delete(cut);
      nodes.stop(context.currentTime, fade);
    };
    const cut = (): void => end(STOP_FADE_SECONDS);
    active.add(cut);
    return { live: () => live, end };
  };

  const startTone = (spec: ToneSpec): VoiceHandle => {
    if (spec.contour.length === 0) return SILENT_VOICE;
    const timbre = resolveTimbre(spec.timbre, timbres);
    const start = context.currentTime + VOICE_LEAD_SECONDS;
    const nodes = buildTone(context, master, planHeldTone(spec, timbre, start));
    const voice = track(nodes);
    return {
      setProgress(p) {
        if (!voice.live() || Number.isNaN(p)) return;
        const hz = pitchToFrequency(contourPitchAt(spec.contour, p));
        nodes.glideTo(hz, Math.max(context.currentTime, start), glideSeconds);
      },
      stop: () => voice.end(timbre.envelope.release),
    };
  };

  const startNoise = (spec: NoiseSpec): VoiceHandle => {
    const start = context.currentTime + VOICE_LEAD_SECONDS;
    const nodes = buildNoise(context, master, planHeldNoise(spec, start));
    const voice = track(nodes);
    let previous: SpeedSample | null = null;
    return {
      setProgress(p) {
        if (!voice.live() || !Number.isFinite(p)) return;
        const now = context.currentTime;
        if (previous === null) {
          previous = { p, time: now };
          return;
        }
        const speed = penSpeed(previous, p, now);
        if (speed === null) return;
        previous = { p, time: now };
        const at = Math.max(now, start);
        nodes.level.cancelScheduledValues(at);
        nodes.level.setTargetAtTime(CHALK_LEVEL * chalkGain(speed), at, CHALK_RISE_SECONDS);
        nodes.level.setTargetAtTime(0, at + CHALK_HOLD_SECONDS, CHALK_FALL_SECONDS);
      },
      stop: () => voice.end(CHALK_RELEASE_SECONDS),
    };
  };

  const play = (notes: readonly ScheduledNote[]): { stop(): void; readonly finished: Promise<void> } => {
    if (closed || notes.length === 0) return { stop: () => undefined, finished: Promise.resolve() };
    const timeline = planTimeline(notes, { offset: context.currentTime + PLAY_LEAD_SECONDS, timbres, tempo });
    const sounds: SoundNodes[] = timeline.notes.map((note) =>
      note.kind === "tone" ? buildTone(context, master, note.plan) : buildNoise(context, master, note.plan),
    );
    let settle: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (silence: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      active.delete(cut);
      if (silence) for (const sound of sounds) sound.stop(context.currentTime);
      settle();
    };
    const cut = (): void => finish(true);
    const watch = (): void => {
      const remaining = timeline.end - context.currentTime;
      if (remaining <= 0) finish(false);
      else if (context.state !== "running") finish(true);
      else timer = setTimeout(watch, remaining * 1000 + TIMER_SLACK_MILLISECONDS);
    };
    timer = setTimeout(watch, (timeline.end - context.currentTime) * 1000 + TIMER_SLACK_MILLISECONDS);
    active.add(cut);
    return { stop: cut, finished };
  };

  return {
    context,
    startVoice(spec) {
      if (closed) return SILENT_VOICE;
      return spec.kind === "tone" ? startTone(spec) : startNoise(spec);
    },
    play,
    cue(name: CueName) {
      if (closed) return;
      buildCue(context, master, planCue(name, context.currentTime + VOICE_LEAD_SECONDS));
    },
    resume() {
      if (closed || context.state === "closed") return Promise.resolve();
      return context.resume();
    },
    setMasterGain(v) {
      if (closed || !Number.isFinite(v)) return;
      master.gain.setTargetAtTime(level(v), context.currentTime, MASTER_SMOOTHING_SECONDS);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const cut of [...active]) cut();
      active.clear();
      if (context.state === "running") {
        master.gain.setTargetAtTime(0, context.currentTime, MASTER_SMOOTHING_SECONDS);
        await new Promise<void>((resolve) => setTimeout(resolve, CLOSE_FADE_MILLISECONDS));
      }
      master.disconnect();
      limiter.disconnect();
      trim.disconnect();
      if (ownsContext && context.state !== "closed") await context.close();
    },
  };
}
