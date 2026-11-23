import { describe, expect, it } from "vitest";
import type { ScheduledNote, TimbreSpec } from "@kankyouken/mechanics/melody";
import { NEUTRAL_TIMBRE, TIMBRES, pitchToFrequency, timbreById } from "@kankyouken/mechanics/melody";
import type { NoiseSpec, ToneSpec } from "./plan";
import {
  CHALK_BURST_LEVEL,
  CHALK_HALF_SPEED,
  DEFAULT_TEMPO,
  MIN_SPEED_INTERVAL,
  chalkGain,
  cueEnd,
  cueEnvelope,
  noteSeconds,
  penSpeed,
  planCue,
  planHeldNoise,
  planHeldTone,
  planNoiseBurst,
  planTimeline,
  planTone,
  resolveTimbre,
  toneFrequencyAt,
  whiteNoise,
} from "./plan";

const flute = timbreById("flute");
const koto = timbreById("koto");

/** A falling octave, A4 to A3, panned a little left. */
const falling: ToneSpec = {
  kind: "tone",
  timbre: "flute",
  contour: [
    { p: 0, pitch: 69 },
    { p: 1, pitch: 57 },
  ],
  pan: -0.3,
  beats: 1,
};

const steady: ToneSpec = {
  kind: "tone",
  timbre: "koto",
  contour: [
    { p: 0, pitch: 60 },
    { p: 1, pitch: 60 },
  ],
  pan: 0,
  beats: 0.5,
};

const chalk: NoiseSpec = { kind: "noise", texture: "chalk", pan: 0.4, beats: 1 };

function times(points: readonly { readonly time: number }[]): number[] {
  return points.map((point) => point.time);
}

function expectNeverBackwards(points: readonly { readonly time: number }[]): void {
  const list = times(points);
  for (let i = 1; i < list.length; i++) expect(list[i]!).toBeGreaterThanOrEqual(list[i - 1]!);
}

describe("planTone", () => {
  it("lays the timbre's envelope out as five points on the context clock", () => {
    const plan = planTone(falling, flute, 2, 1);
    expect(plan.envelope.map((point) => point.level)).toEqual([0, 1, 0.85, 0.85, 0]);
    const [silence, peak, settled, held, gone] = times(plan.envelope);
    expect(silence).toBe(2);
    expect(peak).toBeCloseTo(2.07, 10);
    expect(settled).toBeCloseTo(2.17, 10);
    expect(held).toBe(3);
    expect(gone).toBeCloseTo(3.18, 10);
    expect(plan.start).toBe(2);
    expect(plan.end).toBeCloseTo(3.18, 10);
  });

  it("maps contour vertices to absolute times and frequencies", () => {
    const plan = planTone(falling, flute, 2, 1);
    expect(plan.frequency).toHaveLength(2);
    expect(plan.frequency[0]).toEqual({ time: 2, hz: 440 });
    expect(plan.frequency[1]!.time).toBe(3);
    expect(plan.frequency[1]!.hz).toBeCloseTo(220, 9);
  });

  it("places inner vertices proportionally", () => {
    const hook: ToneSpec = {
      ...falling,
      contour: [
        { p: 0, pitch: 72 },
        { p: 0.75, pitch: 64 },
        { p: 1, pitch: 67 },
      ],
    };
    const plan = planTone(hook, flute, 10, 0.8);
    expect(times(plan.frequency)).toEqual([10, 10 + 0.75 * 0.8, 10.8]);
    expect(plan.frequency.map((point) => point.hz)).toEqual([72, 64, 67].map(pitchToFrequency));
  });

  it("carries the timbre and the stereo position", () => {
    const plan = planTone(falling, flute, 0, 1);
    expect(plan.partials).toEqual(flute.partials);
    expect(plan.vibrato).toEqual({ cents: 12, hz: 5 });
    expect(plan.breath).toBe(0.12);
    expect(plan.gain).toBe(0.9);
    expect(plan.pan).toBe(-0.3);

    const plain = planTone(steady, koto, 0, 1);
    expect(plain.vibrato).toBeNull();
    expect(plain.breath).toBe(0);
  });

  it("squeezes attack and decay by the same factor when the note is shorter than both", () => {
    const plan = planTone(steady, koto, 1, 0.1);
    const [silence, peak, settled, held, gone] = times(plan.envelope);
    expect(silence).toBe(1);
    expect(peak).toBeCloseTo(1 + (0.005 * 0.1) / 0.355, 12);
    expect(settled).toBe(1.1);
    expect(held).toBe(1.1);
    expect(gone).toBeCloseTo(1.35, 12);
    expect(plan.envelope.map((point) => point.level)).toEqual([0, 1, 0.35, 0.35, 0]);
    expect(plan.end).toBeCloseTo(1.35, 12);
    expectNeverBackwards(plan.envelope);
  });

  it("leaves the envelope alone when the note is exactly attack + decay long or longer", () => {
    const exact = planTone(falling, flute, 0, flute.envelope.attack + flute.envelope.decay);
    expect(exact.envelope[1]!.time).toBeCloseTo(0.07, 12);
    expectNeverBackwards(exact.envelope);
  });

  it("reduces a zero, negative or non-finite duration to the release tail", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planTone(falling, flute, 4, duration);
      expect(times(plan.envelope)).toEqual([4, 4, 4, 4, 4.18]);
      expect(times(plan.frequency)).toEqual([4, 4]);
      expect(plan.end).toBe(4.18);
    }
  });

  it("holds the first and the last pitch when the contour does not reach the edges", () => {
    const inner: ToneSpec = {
      ...falling,
      contour: [
        { p: 0.25, pitch: 69 },
        { p: 0.5, pitch: 57 },
      ],
    };
    const plan = planTone(inner, flute, 0, 2);
    expect(times(plan.frequency)).toEqual([0, 0.5, 1, 2]);
    expect(plan.frequency[0]!.hz).toBe(440);
    expect(plan.frequency[3]!.hz).toBeCloseTo(220, 9);
  });

  it("clamps out-of-range progress, skips broken vertices and never schedules backwards", () => {
    const messy: ToneSpec = {
      ...falling,
      contour: [
        { p: -0.5, pitch: 60 },
        { p: 0.6, pitch: 62 },
        { p: Number.NaN, pitch: 64 },
        { p: 0.4, pitch: 65 },
        { p: 0.8, pitch: Number.NaN },
        { p: 1.5, pitch: 67 },
      ],
    };
    const plan = planTone(messy, flute, 0, 1);
    expect(times(plan.frequency)).toEqual([0, 0.6, 0.6, 1]);
    expect(plan.frequency.map((point) => point.hz)).toEqual([60, 62, 65, 67].map(pitchToFrequency));
    expectNeverBackwards(plan.frequency);
  });

  it("gives a silent plan that still occupies its time for an empty contour", () => {
    const plan = planTone({ ...falling, contour: [] }, flute, 1, 0.5);
    expect(plan.frequency).toEqual([]);
    expect(plan.end).toBeCloseTo(1.68, 12);
  });

  it("drops unplayable partials and clamps pan, gain, sustain and breath", () => {
    const odd: TimbreSpec = {
      id: "odd",
      label: "Odd",
      partials: [
        { ratio: 1, gain: 1 },
        { ratio: 0, gain: 1 },
        { ratio: 2, gain: 0 },
        { ratio: -3, gain: 0.5 },
        { ratio: Number.NaN, gain: 0.5 },
        { ratio: 3, gain: 0.25 },
      ],
      envelope: { attack: -1, decay: Number.NaN, sustain: 1.5, release: 0.1 },
      vibrato: { cents: 0, hz: 5 },
      breath: 3,
      gain: 2,
    };
    const plan = planTone({ ...falling, pan: -7 }, odd, 0, 1);
    expect(plan.partials).toEqual([
      { ratio: 1, gain: 1 },
      { ratio: 3, gain: 0.25 },
    ]);
    expect(plan.envelope).toEqual([
      { time: 0, level: 0 },
      { time: 0, level: 1 },
      { time: 0, level: 1 },
      { time: 1, level: 1 },
      { time: 1.1, level: 0 },
    ]);
    expect(plan.vibrato).toBeNull();
    expect(plan.breath).toBe(1);
    expect(plan.gain).toBe(1);
    expect(plan.pan).toBe(-1);
    expect(planTone({ ...falling, pan: Number.NaN }, odd, 0, 1).pan).toBe(0);
  });
});

describe("planHeldTone", () => {
  it("attacks, decays and then holds without a release", () => {
    const plan = planHeldTone(falling, flute, 5);
    expect(plan.envelope.map((point) => point.level)).toEqual([0, 1, 0.85]);
    expect(plan.envelope[0]!.time).toBe(5);
    expect(plan.envelope[1]!.time).toBeCloseTo(5.07, 12);
    expect(plan.envelope[2]!.time).toBeCloseTo(5.17, 12);
    expect(plan.end).toBe(Infinity);
    expect(plan.start).toBe(5);
  });

  it("starts on the contour's pitch at p = 0, even when the first vertex comes later", () => {
    expect(planHeldTone(falling, flute, 5).frequency).toEqual([{ time: 5, hz: 440 }]);
    const late: ToneSpec = { ...falling, contour: [{ p: 0.3, pitch: 57 }] };
    expect(planHeldTone(late, flute, 0).frequency[0]!.hz).toBeCloseTo(220, 9);
  });

  it("is silent for an empty contour", () => {
    expect(planHeldTone({ ...falling, contour: [] }, flute, 5).frequency).toEqual([]);
  });
});

describe("toneFrequencyAt", () => {
  const plan = planTone(falling, flute, 2, 1);

  it("moves in straight lines of pitch, so half way down an octave is six semitones down", () => {
    expect(toneFrequencyAt(plan, 2.5)).toBeCloseTo(pitchToFrequency(63), 9);
    expect(toneFrequencyAt(plan, 2.25)).toBeCloseTo(pitchToFrequency(66), 9);
  });

  it("holds the edge frequencies outside the gesture, including the release", () => {
    expect(toneFrequencyAt(plan, 0)).toBe(440);
    expect(toneFrequencyAt(plan, 2)).toBe(440);
    expect(toneFrequencyAt(plan, 3)).toBeCloseTo(220, 9);
    expect(toneFrequencyAt(plan, 3.1)).toBeCloseTo(220, 9);
  });

  it("takes the later of two points that share a time, and is 0 for a silent plan", () => {
    const jump: ToneSpec = {
      ...falling,
      contour: [
        { p: 0, pitch: 69 },
        { p: 0.5, pitch: 69 },
        { p: 0.5, pitch: 81 },
        { p: 1, pitch: 81 },
      ],
    };
    const jumping = planTone(jump, flute, 0, 1);
    expect(toneFrequencyAt(jumping, 0.49)).toBeCloseTo(440, 9);
    expect(toneFrequencyAt(jumping, 0.5)).toBeCloseTo(880, 9);
    expect(toneFrequencyAt(planTone({ ...falling, contour: [] }, flute, 0, 1), 0.5)).toBe(0);
  });
});

describe("planNoiseBurst and planHeldNoise", () => {
  it("fades a burst in, holds it and fades it out", () => {
    const plan = planNoiseBurst(chalk, 1, 0.5);
    expect(plan.envelope).toEqual([
      { time: 1, level: 0 },
      { time: 1.02, level: CHALK_BURST_LEVEL },
      { time: 1.5, level: CHALK_BURST_LEVEL },
      { time: 1.55, level: 0 },
    ]);
    expect(plan.end).toBe(1.55);
    expect(plan.pan).toBe(0.4);
    expect(plan.texture).toBe("chalk");
  });

  it("shortens the fade-in of a very short burst and survives a broken duration", () => {
    expect(planNoiseBurst(chalk, 0, 0.01).envelope[1]).toEqual({ time: 0.005, level: CHALK_BURST_LEVEL });
    const none = planNoiseBurst(chalk, 2, Number.NaN, 5);
    expect(times(none.envelope)).toEqual([2, 2, 2, 2.05]);
    expect(none.envelope[1]!.level).toBe(1);
    expectNeverBackwards(none.envelope);
  });

  it("starts a held noise silent and without an end", () => {
    const plan = planHeldNoise(chalk, 3);
    expect(plan.envelope).toEqual([{ time: 3, level: 0 }]);
    expect(plan.end).toBe(Infinity);
    expect(plan.start).toBe(3);
  });
});

describe("planCue", () => {
  it("answers a wrong stroke with one soft, low, short falling blip", () => {
    expect(planCue("error", 7)).toEqual([{ fromHz: 330, toHz: 220, start: 7, duration: 0.18, gain: 0.25 }]);
  });

  it("hints with two soft rising notes", () => {
    const [first, second] = planCue("hint", 1);
    expect(planCue("hint", 1)).toHaveLength(2);
    expect(first!.fromHz).toBe(first!.toHz);
    expect(second!.fromHz).toBe(second!.toHz);
    expect(second!.fromHz).toBeGreaterThan(first!.fromHz);
    expect(second!.start).toBeGreaterThan(first!.start);
    expect(first!.start).toBe(1);
    expect(Math.max(first!.gain, second!.gain)).toBeLessThanOrEqual(0.25);
  });

  it("celebrates with a three-note rising arpeggio on the major pentatonic", () => {
    const notes = planCue("complete", 0);
    expect(notes).toHaveLength(3);
    const pentatonic = [0, 2, 4, 7, 9];
    const pitches = notes.map((note) => 69 + 12 * Math.log2(note.fromHz / 440));
    for (const pitch of pitches) {
      expect(pitch).toBeCloseTo(Math.round(pitch), 9);
      expect(pentatonic).toContain(((Math.round(pitch) % 12) + 12) % 12);
    }
    for (let i = 1; i < notes.length; i++) {
      expect(pitches[i]!).toBeGreaterThan(pitches[i - 1]!);
      expect(notes[i]!.start).toBeGreaterThan(notes[i - 1]!.start);
    }
  });

  it("ticks with a single 20 ms blip", () => {
    const tick = planCue("tick", 3);
    expect(tick).toHaveLength(1);
    expect(tick[0]!.duration).toBe(0.02);
    expect(tick[0]!.start).toBe(3);
  });

  it("keeps every cue quiet and returns nothing for an unknown name", () => {
    for (const name of ["error", "hint", "complete", "tick"] as const) {
      for (const cue of planCue(name, 0)) {
        expect(cue.gain).toBeGreaterThan(0);
        expect(cue.gain).toBeLessThanOrEqual(0.25);
        expect(cue.fromHz).toBeGreaterThan(0);
        expect(cue.toHz).toBeGreaterThan(0);
      }
    }
    expect(planCue("fanfare" as never, 0)).toEqual([]);
  });
});

describe("cueEnvelope and cueEnd", () => {
  it("rises quickly to the blip's gain and fades to its end", () => {
    const [error] = planCue("error", 2);
    expect(cueEnvelope(error!)).toEqual([
      { time: 2, level: 0 },
      { time: 2.008, level: 0.25 },
      { time: 2.18, level: 0 },
    ]);
  });

  it("uses a quarter of a very short blip for the rise, and tolerates a negative duration", () => {
    const [tick] = planCue("tick", 0);
    expect(cueEnvelope(tick!)[1]!.time).toBeCloseTo(0.005, 12);
    expect(times(cueEnvelope({ ...tick!, duration: -1 }))).toEqual([0, 0, 0]);
  });

  it("finds the end of the last blip", () => {
    expect(cueEnd(planCue("complete", 1))).toBeCloseTo(1.6, 12);
    expect(cueEnd(planCue("error", 0))).toBe(0.18);
    expect(cueEnd([], 9)).toBe(9);
    expect(cueEnd([])).toBe(0);
  });
});

describe("chalkGain", () => {
  it("is silent at rest and stays within 0..1", () => {
    expect(chalkGain(0)).toBe(0);
    for (const speed of [0.01, 0.1, 0.5, 1, 2, 5, 50, 1e6]) {
      expect(chalkGain(speed)).toBeGreaterThan(0);
      expect(chalkGain(speed)).toBeLessThanOrEqual(1);
    }
  });

  it("grows with speed and reaches one half at the half speed", () => {
    const speeds = [0, 0.05, 0.2, 0.4, 0.8, 1.6, 3.2, 10];
    for (let i = 1; i < speeds.length; i++) expect(chalkGain(speeds[i]!)).toBeGreaterThan(chalkGain(speeds[i - 1]!));
    expect(chalkGain(CHALK_HALF_SPEED)).toBeCloseTo(0.5, 12);
  });

  it("has a soft knee at both ends: jitter is nearly silent, fast strokes level off", () => {
    expect(chalkGain(0.05)).toBeLessThan(0.01);
    expect(chalkGain(0.1) / 0.1).toBeLessThan(chalkGain(0.4) / 0.4);
    expect(chalkGain(4)).toBeGreaterThan(0.95);
    expect(chalkGain(8) - chalkGain(4)).toBeLessThan(0.05);
  });

  it("ignores direction and survives NaN and infinity", () => {
    expect(chalkGain(-1.5)).toBe(chalkGain(1.5));
    expect(chalkGain(Number.NaN)).toBe(0);
    expect(chalkGain(Number.POSITIVE_INFINITY)).toBe(1);
    expect(chalkGain(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});

describe("penSpeed", () => {
  it("measures progress per second, forwards or backwards", () => {
    expect(penSpeed({ p: 0.2, time: 1 }, 0.3, 1.05)).toBeCloseTo(2, 9);
    expect(penSpeed({ p: 0.3, time: 1 }, 0.2, 1.05)).toBeCloseTo(2, 9);
    expect(penSpeed({ p: 0.5, time: 1 }, 0.5, 1.5)).toBe(0);
  });

  it("refuses to measure over too short an interval, a backwards clock or a broken reading", () => {
    expect(penSpeed({ p: 0, time: 1 }, 0.1, 1)).toBeNull();
    expect(penSpeed({ p: 0, time: 1 }, 0.1, 1 + MIN_SPEED_INTERVAL / 2)).toBeNull();
    expect(penSpeed({ p: 0, time: 1 }, 0.1, 0.5)).toBeNull();
    expect(penSpeed({ p: 0, time: 1 }, Number.NaN, 2)).toBeNull();
    expect(penSpeed({ p: 0, time: 1 }, 0.1, Number.NaN)).toBeNull();
    expect(penSpeed({ p: 0, time: 1 }, 0.1, 1 + MIN_SPEED_INTERVAL)).not.toBeNull();
  });

  it("drives the chalk: a one-second stroke is clearly audible, a crawl is not", () => {
    const stroke = penSpeed({ p: 0.4, time: 2 }, 0.416, 2.016)!;
    expect(chalkGain(stroke)).toBeGreaterThan(0.5);
    const crawl = penSpeed({ p: 0.4, time: 2 }, 0.4008, 2.016)!;
    expect(chalkGain(crawl)).toBeLessThan(0.01);
  });
});

describe("resolveTimbre", () => {
  it("finds a timbre by id", () => {
    expect(resolveTimbre("glass")).toBe(timbreById("glass"));
  });

  it("falls back to the neutral timbre for an unknown id", () => {
    expect(resolveTimbre("theremin").id).toBe(NEUTRAL_TIMBRE);
    expect(resolveTimbre("").id).toBe(NEUTRAL_TIMBRE);
  });

  it("prefers a custom palette, its own neutral entry, then the built-in neutral", () => {
    const bell: TimbreSpec = { ...timbreById("glass"), id: "bell" };
    const ownNeutral: TimbreSpec = { ...timbreById("reed"), id: NEUTRAL_TIMBRE };
    expect(resolveTimbre("bell", [bell])).toBe(bell);
    expect(resolveTimbre("flute", [bell, ownNeutral])).toBe(ownNeutral);
    expect(resolveTimbre("flute", [bell])).toBe(timbreById(NEUTRAL_TIMBRE));
    expect(resolveTimbre("flute", [])).toBe(timbreById(NEUTRAL_TIMBRE));
  });
});

describe("noteSeconds", () => {
  const note: ScheduledNote = { start: 0, duration: 0.4, voice: falling, stroke: 0 };

  it("uses the note's own duration when it has one", () => {
    expect(noteSeconds(note, 60)).toBe(0.4);
  });

  it("converts beats at the tempo when the duration is unusable", () => {
    expect(noteSeconds({ ...note, duration: 0 }, 120)).toBe(0.5);
    expect(noteSeconds({ ...note, duration: Number.NaN }, 60)).toBe(1);
    expect(noteSeconds({ ...note, duration: -2 })).toBeCloseTo(60 / DEFAULT_TEMPO, 12);
    expect(noteSeconds({ ...note, duration: 0 }, 0)).toBeCloseTo(60 / DEFAULT_TEMPO, 12);
  });

  it("is 0 when neither duration nor beats are usable", () => {
    expect(noteSeconds({ ...note, duration: 0, voice: { ...falling, beats: 0 } })).toBe(0);
    expect(noteSeconds({ ...note, duration: 0, voice: { ...falling, beats: Number.NaN } })).toBe(0);
  });
});

describe("planTimeline", () => {
  /** Four strokes in the shape of 木: level, falling, falling left, falling right; hand-made pitches. */
  const strokes: ScheduledNote[] = [
    { start: 0, duration: 0.4, stroke: 0, voice: { ...steady, timbre: "marimba", pan: 0 } },
    { start: 0.5, duration: 0.6, stroke: 1, voice: { ...falling, timbre: "marimba", pan: 0 } },
    {
      start: 1.2,
      duration: 0.3,
      stroke: 2,
      voice: { ...falling, timbre: "marimba", contour: [{ p: 0, pitch: 67 }, { p: 1, pitch: 62 }], pan: -0.5, beats: 0.75 },
    },
    {
      start: 1.6,
      duration: 0.3,
      stroke: 3,
      voice: { ...falling, timbre: "marimba", contour: [{ p: 0, pitch: 67 }, { p: 1, pitch: 60 }], pan: 0.5, beats: 0.75 },
    },
  ];

  it("plans a whole character against the context clock", () => {
    const marimba = timbreById("marimba");
    const timeline = planTimeline(strokes, { offset: 10 });
    expect(timeline.notes.map((note) => note.stroke)).toEqual([0, 1, 2, 3]);
    expect(timeline.notes.map((note) => note.kind)).toEqual(["tone", "tone", "tone", "tone"]);
    expect(timeline.notes.map((note) => note.plan.start)).toEqual([10, 10.5, 11.2, 11.6]);
    const last = timeline.notes[3]!;
    expect(last.plan).toEqual(planTone(strokes[3]!.voice as ToneSpec, marimba, 11.6, 0.3));
    expect(timeline.end).toBeCloseTo(11.6 + 0.3 + marimba.envelope.release, 12);
    for (const note of timeline.notes) {
      expectNeverBackwards(note.plan.envelope);
      expect(note.plan.end).toBeLessThanOrEqual(timeline.end);
    }
  });

  it("ends with the longest tail, not with the last note", () => {
    const glassTail: ScheduledNote = { start: 0, duration: 1, stroke: 0, voice: { ...steady, timbre: "glass" } };
    const short: ScheduledNote = { start: 0.9, duration: 0.1, stroke: 1, voice: { ...steady, timbre: "organ" } };
    expect(planTimeline([glassTail, short]).end).toBe(1.5);
  });

  it("is empty and ends at its offset when there are no notes", () => {
    expect(planTimeline([])).toEqual({ notes: [], end: 0 });
    expect(planTimeline([], { offset: 3 }).end).toBe(3);
  });

  it("falls back to the neutral timbre and honours a custom palette", () => {
    const unknown: ScheduledNote = { start: 0, duration: 1, stroke: 0, voice: { ...steady, timbre: "theremin" } };
    const planned = planTimeline([unknown]).notes[0]!;
    expect(planned.kind === "tone" && planned.plan.partials).toEqual(timbreById(NEUTRAL_TIMBRE).partials);

    const pure: TimbreSpec = { ...timbreById("whistle"), id: "theremin", partials: [{ ratio: 1, gain: 1 }] };
    const custom = planTimeline([unknown], { timbres: [...TIMBRES, pure] }).notes[0]!;
    expect(custom.kind === "tone" && custom.plan.partials).toEqual([{ ratio: 1, gain: 1 }]);
  });

  it("plans noise notes as bursts", () => {
    const timeline = planTimeline([{ start: 0.25, duration: 0.5, stroke: 4, voice: chalk }], { offset: 1 });
    const note = timeline.notes[0]!;
    expect(note.kind).toBe("noise");
    expect(note.plan).toEqual(planNoiseBurst(chalk, 1.25, 0.5));
    expect(timeline.end).toBe(1.8);
  });

  it("treats a broken start as 0 and a missing duration as beats at the tempo", () => {
    const early: ScheduledNote = { start: -3, duration: 0, stroke: 0, voice: { ...steady, beats: 2 } };
    const lost: ScheduledNote = { start: Number.NaN, duration: 0.2, stroke: 1, voice: steady };
    const timeline = planTimeline([early, lost], { offset: 2, tempo: 120 });
    expect(timeline.notes[0]!.plan.start).toBe(2);
    expect(timeline.notes[1]!.plan.start).toBe(2);
    expect(timeline.notes[0]!.plan.end).toBeCloseTo(2 + 1 + koto.envelope.release, 12);
  });
});

describe("whiteNoise", () => {
  it("is reproducible for a seed and different for another", () => {
    expect(Array.from(whiteNoise(64, 7))).toEqual(Array.from(whiteNoise(64, 7)));
    expect(Array.from(whiteNoise(64, 7))).not.toEqual(Array.from(whiteNoise(64, 8)));
  });

  it("fills -1..1 evenly around zero", () => {
    const samples = whiteNoise(20000);
    let sum = 0;
    let power = 0;
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThan(1);
      sum += sample;
      power += sample * sample;
    }
    expect(Math.abs(sum / samples.length)).toBeLessThan(0.02);
    expect(power / samples.length).toBeCloseTo(1 / 3, 1);
  });

  it("gives an empty array for a length that is zero, negative or not a number", () => {
    expect(whiteNoise(0)).toHaveLength(0);
    expect(whiteNoise(-5)).toHaveLength(0);
    expect(whiteNoise(Number.NaN)).toHaveLength(0);
    expect(whiteNoise(2.9)).toHaveLength(2);
  });
});
