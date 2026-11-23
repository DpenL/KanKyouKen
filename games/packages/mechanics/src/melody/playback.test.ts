import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { createRng } from "../util/rng";
import { createMelodist } from "./melodist";
import { DEFAULT_PLAYBACK, melodyDuration, scheduleMelody } from "./playback";
import { detectPrefixes } from "./prefix";
import type { GlyphMelody, ScheduledNote } from "./types";
import { strokeVoice } from "./voices";

const melodist = createMelodist({ glyphs: FIXTURES, prefixes: detectPrefixes(FIXTURES, FIXTURES.keys()) });
const T = melodist.config.tuning;
const hu = melodist.melody(fixture("胡"));
const beat = 60 / 132;
const gapBefore = (notes: readonly ScheduledNote[], i: number): number =>
  notes[i]!.start - (notes[i - 1]!.start + notes[i - 1]!.duration);

describe("scheduleMelody", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_PLAYBACK).toEqual({ tempo: 132, unitGapBeats: 0.5, strokeGapBeats: 0.05 });
  });

  it("plays the strokes of 胡 one after another, breathing between components", () => {
    const notes = scheduleMelody(hu, "melody", T, createRng(1));
    expect(notes.map((n) => n.stroke)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(notes[0]!.start).toBe(0);
    notes.forEach((n, i) => {
      const stroke = hu.strokes[i]!;
      expect(n.voice).toEqual(strokeVoice("melody", stroke, T, createRng(1)));
      expect(n.duration).toBeCloseTo(stroke.element.beats * beat, 10);
    });
    for (let i = 1; i < notes.length; i++) {
      const expected = hu.strokes[i]!.startsUnit ? 0.55 * beat : 0.05 * beat;
      expect(gapBefore(notes, i), `before stroke ${i}`).toBeCloseTo(expected, 10);
    }
    expect([2, 5].every((i) => hu.strokes[i]!.startsUnit)).toBe(true);
    const beats = hu.strokes.reduce((sum, s) => sum + s.element.beats, 0);
    expect(melodyDuration(notes)).toBeCloseTo((beats + 8 * 0.05 + 2 * 0.5) * beat, 10);
  });

  it("applies tempo and gap options, keeping defaults for the rest", () => {
    const slow = scheduleMelody(hu, "melody", T, createRng(1), { tempo: 60 });
    slow.forEach((n, i) => expect(n.duration).toBeCloseTo(hu.strokes[i]!.element.beats, 10));
    expect(gapBefore(slow, 1)).toBeCloseTo(0.05, 10);
    expect(gapBefore(slow, 2)).toBeCloseTo(0.55, 10);

    const legato = scheduleMelody(hu, "melody", T, createRng(1), { tempo: 60, unitGapBeats: 0, strokeGapBeats: 0 });
    for (let i = 1; i < legato.length; i++) expect(gapBefore(legato, i)).toBeCloseTo(0, 10);
    expect(melodyDuration(legato)).toBeCloseTo(hu.strokes.reduce((sum, s) => sum + s.element.beats, 0), 10);

    const undefinedTempo = scheduleMelody(hu, "melody", T, createRng(1), { tempo: undefined, unitGapBeats: 2 });
    expect(undefinedTempo[1]!.start).toBeCloseTo(scheduleMelody(hu, "melody", T, createRng(1))[1]!.start, 10);
    expect(gapBefore(undefinedTempo, 2)).toBeCloseTo(2.05 * beat, 10);
  });

  it("treats negative gaps as none", () => {
    const notes = scheduleMelody(hu, "melody", T, createRng(1), { unitGapBeats: -3, strokeGapBeats: -1 });
    for (let i = 1; i < notes.length; i++) expect(gapBefore(notes, i)).toBeCloseTo(0, 10);
  });

  it("schedules nothing in silent mode or for an empty melody", () => {
    expect(scheduleMelody(hu, "silent", T, createRng(1))).toEqual([]);
    const empty: GlyphMelody = { char: "空", strokes: [], units: [] };
    expect(scheduleMelody(empty, "melody", T, createRng(1))).toEqual([]);
  });

  it("keeps the timing and swaps the voices in the other audio conditions", () => {
    const reference = scheduleMelody(hu, "melody", T, createRng(1));
    const sfx = scheduleMelody(hu, "sfx", T, createRng(1));
    expect(sfx.map((n) => [n.start, n.duration, n.stroke])).toEqual(reference.map((n) => [n.start, n.duration, n.stroke]));
    expect(sfx.every((n) => n.voice.kind === "noise")).toBe(true);

    const changing = scheduleMelody(hu, "changing-melody", T, createRng(9));
    expect(changing.map((n) => [n.start, n.duration])).toEqual(reference.map((n) => [n.start, n.duration]));
    expect(changing.map((n) => (n.voice.kind === "tone" ? n.voice.timbre : null))).toEqual(hu.strokes.map((s) => s.timbre));
    expect(changing.map((n) => n.voice)).not.toEqual(reference.map((n) => n.voice));
    expect(scheduleMelody(hu, "changing-melody", T, createRng(9))).toEqual(changing);
    expect(scheduleMelody(hu, "changing-melody", T, createRng(10))).not.toEqual(changing);
  });

  it("plays a single stroke at time 0 with no gaps", () => {
    const one: GlyphMelody = { ...hu, strokes: [hu.strokes[5]!] };
    const notes = scheduleMelody(one, "melody", T, createRng(1));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.start).toBe(0);
    expect(melodyDuration(notes)).toBeCloseTo(hu.strokes[5]!.element.beats * beat, 10);
  });

  it("rejects a tempo that is not a positive number", () => {
    for (const tempo of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scheduleMelody(hu, "melody", T, createRng(1), { tempo })).toThrow(/tempo/);
    }
  });
});

describe("melodyDuration", () => {
  it("is 0 for no notes", () => {
    expect(melodyDuration([])).toBe(0);
  });

  it("is the end of the note that ends last, whatever the order", () => {
    const voice = strokeVoice("sfx", hu.strokes[0]!, T, createRng(1))!;
    const notes: ScheduledNote[] = [
      { start: 2, duration: 1, voice, stroke: 1 },
      { start: 0, duration: 4.5, voice, stroke: 0 },
      { start: 3, duration: 0.5, voice, stroke: 2 },
    ];
    expect(melodyDuration(notes)).toBe(4.5);
  });
});
