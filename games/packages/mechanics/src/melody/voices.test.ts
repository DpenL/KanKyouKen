import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { createRng } from "../util/rng";
import { createMelodist } from "./melodist";
import { DEFAULT_TUNING, stepToPitch } from "./tuning";
import type { MelodyStroke, TuningConfig, VoiceSpec } from "./types";
import { inventContour, strokeVoice } from "./voices";

const T = DEFAULT_TUNING;
const melody = createMelodist({ glyphs: FIXTURES }).melody(fixture("木"));
const stroke: MelodyStroke = melody.strokes[2]!;

/** Scale step of a pitch within 0..rangeSteps, or -1 when it is not on the ladder. */
const stepOf = (pitch: number, tuning: TuningConfig = T): number => {
  for (let s = 0; s <= tuning.rangeSteps; s++) if (stepToPitch(s, tuning) === pitch) return s;
  return -1;
};

function tone(voice: VoiceSpec | null): Extract<VoiceSpec, { kind: "tone" }> {
  if (!voice || voice.kind !== "tone") throw new Error("expected a tone");
  return voice;
}

describe("strokeVoice", () => {
  it("plays the stroke's own element in melody mode", () => {
    const voice = tone(strokeVoice("melody", stroke, T, createRng(1)));
    expect(voice).toEqual({
      kind: "tone",
      timbre: stroke.timbre,
      contour: stroke.element.contour,
      pan: stroke.element.pan,
      beats: stroke.element.beats,
    });
    expect(voice.contour).toBe(stroke.element.contour);
  });

  it("plays a chalk noise with the stroke's pan and length in sfx mode", () => {
    expect(strokeVoice("sfx", stroke, T, createRng(1))).toEqual({
      kind: "noise",
      texture: "chalk",
      pan: stroke.element.pan,
      beats: stroke.element.beats,
    });
  });

  it("plays nothing in silent mode", () => {
    expect(strokeVoice("silent", stroke, T, createRng(1))).toBeNull();
  });

  it("keeps timbre, pan and length but invents the contour in changing-melody mode", () => {
    const rng = createRng("changing");
    const starts = new Set<number>();
    let steady = 0;
    let up = 0;
    let down = 0;
    const draws = 600;
    for (let i = 0; i < draws; i++) {
      const voice = tone(strokeVoice("changing-melody", stroke, T, rng));
      expect(voice.timbre).toBe(stroke.timbre);
      expect(voice.pan).toBe(stroke.element.pan);
      expect(voice.beats).toBe(stroke.element.beats);
      expect(voice.contour.map((c) => c.p)).toEqual([0, 1]);
      const from = stepOf(voice.contour[0]!.pitch);
      const to = stepOf(voice.contour[1]!.pitch);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThanOrEqual(0);
      expect(Math.abs(to - from)).toBeLessThanOrEqual(4);
      starts.add(from);
      if (to === from) steady++;
      else if (to > from) up++;
      else down++;
    }
    expect(starts.size).toBe(T.rangeSteps + 1);
    expect(steady / draws).toBeGreaterThan(0.25);
    expect(steady / draws).toBeLessThan(0.42);
    expect(up).toBeGreaterThan(draws / 5);
    expect(down).toBeGreaterThan(draws / 5);
  });

  it("gives a different element on most attempts at the same stroke", () => {
    const rng = createRng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(JSON.stringify(tone(strokeVoice("changing-melody", stroke, T, rng)).contour));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("replays identically from the same seed", () => {
    const run = (seed: number): VoiceSpec[] => {
      const rng = createRng(seed);
      return melody.strokes.map((s) => strokeVoice("changing-melody", s, T, rng)!);
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("consumes random numbers only in changing-melody mode, and then always four", () => {
    for (const mode of ["melody", "sfx", "silent"] as const) {
      const rng = createRng(5);
      strokeVoice(mode, stroke, T, rng);
      expect(rng.next(), mode).toBe(createRng(5).next());
    }
    for (let seed = 0; seed < 20; seed++) {
      const rng = createRng(seed);
      strokeVoice("changing-melody", stroke, T, rng);
      const reference = createRng(seed);
      for (let i = 0; i < 4; i++) reference.next();
      expect(rng.next()).toBe(reference.next());
    }
  });
});

describe("inventContour", () => {
  it("moves the other way rather than turning a clamped glide into a held note", () => {
    const narrow: TuningConfig = { ...T, rangeSteps: 1 };
    const rng = createRng("narrow");
    let steady = 0;
    const draws = 600;
    for (let i = 0; i < draws; i++) {
      const [from, to] = inventContour(narrow, rng).map((c) => stepOf(c.pitch, narrow));
      expect([0, 1]).toContain(from);
      expect([0, 1]).toContain(to);
      if (from === to) steady++;
    }
    expect(steady / draws).toBeGreaterThan(0.25);
    expect(steady / draws).toBeLessThan(0.42);
  });

  it("stays inside the range at its edges", () => {
    const rng = createRng("edges");
    for (let i = 0; i < 300; i++) {
      for (const point of inventContour(T, rng)) {
        expect(point.pitch).toBeGreaterThanOrEqual(stepToPitch(0, T));
        expect(point.pitch).toBeLessThanOrEqual(stepToPitch(T.rangeSteps, T));
      }
    }
  });

  it("can only hold the tonic when the range is a single step", () => {
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) {
      expect(inventContour({ ...T, rangeSteps: 0 }, rng)).toEqual([
        { p: 0, pitch: T.tonic },
        { p: 1, pitch: T.tonic },
      ]);
    }
  });
});
