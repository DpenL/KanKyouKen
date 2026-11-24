import { DEFAULT_PLAYBACK, scheduleMelody } from "@kankyouken/mechanics/melody";
import type { ScheduledNote, StrokeAudioMode } from "@kankyouken/mechanics/melody";
import { createRng } from "@kankyouken/mechanics/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMelodist, glyphOf, loadContent } from "./content";
import { createPerformer } from "./performer";
import type { StrokeCue } from "./playback";
import { melodyNotes, runCues, strokeCues } from "./playback";
import type { Sound } from "./sound";

const content = loadContent();
const melodist = buildMelodist(content, "per-component");
const rest = melodist.melody(glyphOf(content, "休"));
const tuning = melodist.config.tuning;

describe("strokeCues", () => {
  it("has one cue per stroke, in writing order, timed like the melody", () => {
    const cues = strokeCues(rest, tuning, createRng(1));
    const notes = scheduleMelody(rest, "melody", tuning, createRng(1));
    expect(cues.map((cue) => cue.stroke)).toEqual(rest.strokes.map((stroke) => stroke.stroke));
    cues.forEach((cue, i) => {
      expect(cue.startMs).toBeCloseTo((notes[i]?.start ?? -1) * 1000);
      expect(cue.durationMs).toBeCloseTo((notes[i]?.duration ?? -1) * 1000);
    });
  });

  it("breathes between components", () => {
    const cues = strokeCues(rest, tuning, createRng(1));
    const secondUnit = rest.units[1]?.strokes[0] ?? -1;
    const before = cues[secondUnit - 1];
    const first = cues[secondUnit];
    expect(before).toBeDefined();
    expect(first).toBeDefined();
    const gap = (first?.startMs ?? 0) - ((before?.startMs ?? 0) + (before?.durationMs ?? 0));
    expect(gap).toBeGreaterThan((DEFAULT_PLAYBACK.unitGapBeats * 60_000) / DEFAULT_PLAYBACK.tempo - 1);
  });

  it("slows down with the tempo", () => {
    const fast = strokeCues(rest, tuning, createRng(1), { tempo: 120 });
    const slow = strokeCues(rest, tuning, createRng(1), { tempo: 60 });
    expect(slow.at(-1)?.startMs).toBeCloseTo((fast.at(-1)?.startMs ?? 0) * 2);
  });
});

describe("melodyNotes", () => {
  it("is the library's schedule for the whole character", () => {
    expect(melodyNotes(rest, "melody", tuning, createRng(1))).toEqual(scheduleMelody(rest, "melody", tuning, createRng(1)));
    expect(melodyNotes(rest, "sfx", tuning, createRng(1), { tempo: 90 })).toEqual(
      scheduleMelody(rest, "sfx", tuning, createRng(1), { tempo: 90 }),
    );
    expect(melodyNotes(rest, "silent", tuning, createRng(1))).toEqual([]);
  });

  it("excerpts one component's motif, starting at once and keeping its rhythm", () => {
    const whole = melodyNotes(rest, "melody", tuning, createRng(1));
    const unit = rest.units[1]?.strokes ?? [];
    const motif = melodyNotes(rest, "melody", tuning, createRng(1), { strokes: unit });
    expect(motif.map((note) => note.stroke)).toEqual([...unit]);
    expect(motif[0]?.start).toBe(0);
    const shift = whole[unit[0] ?? -1]?.start ?? 0;
    expect(shift).toBeGreaterThan(0);
    motif.forEach((note, i) => {
      const original = whole[unit[i] ?? -1];
      expect(note.start).toBeCloseTo((original?.start ?? 0) - shift);
      expect(note.voice).toEqual(original?.voice);
    });
  });

  it("gives matching cues for an excerpt", () => {
    const unit = rest.units[0]?.strokes ?? [];
    const cues = strokeCues(rest, tuning, createRng(1), { strokes: unit });
    expect(cues.map((cue) => cue.stroke)).toEqual([...unit]);
    expect(cues[0]?.startMs).toBe(0);
  });
});

describe("timed playback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const cues: StrokeCue[] = [
    { stroke: 0, startMs: 0, durationMs: 200 },
    { stroke: 1, startMs: 250, durationMs: 300 },
  ];

  it("fires every cue when it is due and ends after the last one", () => {
    const seen: number[] = [];
    const onEnd = vi.fn();
    runCues(cues, (cue) => seen.push(cue.stroke), onEnd);
    vi.advanceTimersByTime(0);
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(249);
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([0, 1]);
    vi.advanceTimersByTime(299);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled", () => {
    const onCue = vi.fn();
    const onEnd = vi.fn();
    const cancel = runCues(cues, onCue, onEnd);
    vi.advanceTimersByTime(100);
    cancel();
    vi.runAllTimers();
    expect(onCue).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("ends at once when there is nothing to play", () => {
    const onEnd = vi.fn();
    runCues([], vi.fn(), onEnd);
    vi.advanceTimersByTime(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  function fakeSound(): Sound & { played: (readonly ScheduledNote[])[]; stops: number } {
    const fake = {
      played: [] as (readonly ScheduledNote[])[],
      stops: 0,
      unlock: () => undefined,
      setVolume: () => undefined,
      startVoice: () => ({ setProgress: () => undefined, stop: () => undefined }),
      play(notes: readonly ScheduledNote[]) {
        fake.played.push(notes);
        return { stop: () => void (fake.stops += 1) };
      },
      cue: () => undefined,
    };
    return fake;
  }

  const perform = (mode: StrokeAudioMode) => {
    const sound = fakeSound();
    const performer = createPerformer(sound, () => tuning, createRng(7));
    const strokes: number[] = [];
    const onEnd = vi.fn();
    performer.perform(rest, { mode, onStroke: (cue) => strokes.push(cue.stroke), onEnd });
    return { sound, performer, strokes, onEnd };
  };

  it("plays the melody and announces every stroke in order", () => {
    const { sound, strokes, onEnd } = perform("melody");
    expect(sound.played).toHaveLength(1);
    expect(sound.played[0]).toHaveLength(rest.strokes.length);
    vi.runAllTimers();
    expect(strokes).toEqual(rest.strokes.map((stroke) => stroke.stroke));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(sound.stops).toBe(0);
  });

  it("keeps the rhythm of the visuals when the sound mode is silent", () => {
    const { sound, strokes } = perform("silent");
    expect(sound.played[0]).toEqual([]);
    vi.runAllTimers();
    expect(strokes).toHaveLength(rest.strokes.length);
  });

  it("performs a single component when asked to", () => {
    const sound = fakeSound();
    const performer = createPerformer(sound, () => tuning, createRng(7));
    const unit = rest.units[1]?.strokes ?? [];
    const strokes: number[] = [];
    performer.perform(rest, { mode: "melody", strokes: unit, onStroke: (cue) => strokes.push(cue.stroke) });
    expect(sound.played[0]?.map((note) => note.stroke)).toEqual([...unit]);
    vi.runAllTimers();
    expect(strokes).toEqual([...unit]);
  });

  it("stops sound and visuals together, and a new performance replaces the old one", () => {
    const { sound, performer, strokes, onEnd } = perform("melody");
    vi.advanceTimersByTime(60);
    expect(strokes).toEqual([0]);
    performer.stop();
    vi.runAllTimers();
    expect(strokes).toEqual([0]);
    expect(onEnd).not.toHaveBeenCalled();
    expect(sound.stops).toBe(1);

    performer.perform(rest, { mode: "melody", onStroke: () => undefined });
    performer.perform(rest, { mode: "melody", onStroke: () => undefined });
    expect(sound.stops).toBe(2);
  });
});
