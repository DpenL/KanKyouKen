import { describe, expect, it } from "vitest";
import { DEFAULT_TIMBRE_CONFIG, TIMBRE_IDS } from "./timbres";
import { assertTuning, DEFAULT_MELODY_CONFIG, DEFAULT_TUNING, resolveMelodyConfig, stepToPitch } from "./tuning";
import type { TuningConfig } from "./types";

describe("DEFAULT_TUNING", () => {
  it("is a pentatonic scale on A3 with eight steps of range", () => {
    expect(DEFAULT_TUNING).toEqual({
      tonic: 57,
      scale: [0, 2, 4, 7, 9],
      rangeSteps: 8,
      levelDeadband: 0.12,
      maxContourPoints: 3,
      minBeats: 0.5,
      maxBeats: 1.5,
      registerSpread: 3,
    });
    expect(() => assertTuning(DEFAULT_TUNING)).not.toThrow();
    expect(DEFAULT_MELODY_CONFIG).toEqual({ tuning: DEFAULT_TUNING, timbre: DEFAULT_TIMBRE_CONFIG });
  });
});

describe("stepToPitch", () => {
  it("walks the scale upwards from the tonic", () => {
    expect([0, 1, 2, 3, 4].map((s) => stepToPitch(s, DEFAULT_TUNING))).toEqual([57, 59, 61, 64, 66]);
  });

  it("wraps into the next octave after the last scale note", () => {
    expect(stepToPitch(5, DEFAULT_TUNING)).toBe(57 + 12);
    expect(stepToPitch(8, DEFAULT_TUNING)).toBe(57 + 12 + 7);
    expect(stepToPitch(10, DEFAULT_TUNING)).toBe(57 + 24);
  });

  it("goes below the tonic for negative steps", () => {
    expect(stepToPitch(-1, DEFAULT_TUNING)).toBe(57 - 12 + 9);
    expect(stepToPitch(-5, DEFAULT_TUNING)).toBe(57 - 12);
    expect(stepToPitch(-6, DEFAULT_TUNING)).toBe(57 - 24 + 9);
  });

  it("interpolates fractional steps linearly between their neighbours", () => {
    expect(stepToPitch(0.5, DEFAULT_TUNING)).toBe(58);
    expect(stepToPitch(2.25, DEFAULT_TUNING)).toBeCloseTo(61 + 0.25 * 3, 10);
    expect(stepToPitch(4.5, DEFAULT_TUNING)).toBe(67.5);
    expect(stepToPitch(-0.5, DEFAULT_TUNING)).toBe(55.5);
  });

  it("rises strictly with the step", () => {
    for (let s = -12; s < 24; s++) {
      expect(stepToPitch(s + 1, DEFAULT_TUNING)).toBeGreaterThan(stepToPitch(s, DEFAULT_TUNING));
      expect(stepToPitch(s + 0.5, DEFAULT_TUNING)).toBeGreaterThan(stepToPitch(s, DEFAULT_TUNING));
    }
  });

  it("handles other scales, including a single-note one", () => {
    const octaves: TuningConfig = { ...DEFAULT_TUNING, tonic: 60, scale: [0] };
    expect([-1, 0, 1, 2].map((s) => stepToPitch(s, octaves))).toEqual([48, 60, 72, 84]);
    const major: TuningConfig = { ...DEFAULT_TUNING, tonic: 60, scale: [0, 2, 4, 5, 7, 9, 11] };
    expect(stepToPitch(7, major)).toBe(72);
    expect(stepToPitch(-1, major)).toBe(59);
  });

  it("throws on an empty scale and on non-finite steps", () => {
    expect(() => stepToPitch(0, { ...DEFAULT_TUNING, scale: [] })).toThrow(/scale is empty/);
    expect(() => stepToPitch(Number.NaN, DEFAULT_TUNING)).toThrow(/finite/);
    expect(() => stepToPitch(Number.POSITIVE_INFINITY, DEFAULT_TUNING)).toThrow(/finite/);
  });
});

describe("resolveMelodyConfig", () => {
  it("returns the defaults when nothing is given", () => {
    expect(resolveMelodyConfig()).toEqual(DEFAULT_MELODY_CONFIG);
    expect(resolveMelodyConfig({})).toEqual(DEFAULT_MELODY_CONFIG);
    expect(resolveMelodyConfig({ tuning: {}, timbre: {} })).toEqual(DEFAULT_MELODY_CONFIG);
  });

  it("merges field by field at both levels", () => {
    const config = resolveMelodyConfig({
      tuning: { tonic: 60, registerSpread: 0 },
      timbre: { mode: "single", assigned: { 木: "glass" } },
    });
    expect(config.tuning).toEqual({ ...DEFAULT_TUNING, tonic: 60, registerSpread: 0 });
    expect(config.timbre).toEqual({ mode: "single", palette: TIMBRE_IDS, assigned: { 木: "glass" } });
  });

  it("treats undefined fields as left out and leaves the defaults untouched", () => {
    const before = JSON.stringify(DEFAULT_MELODY_CONFIG);
    const config = resolveMelodyConfig({ tuning: { tonic: undefined, rangeSteps: 6 }, timbre: { palette: undefined } });
    expect(config.tuning.tonic).toBe(57);
    expect(config.tuning.rangeSteps).toBe(6);
    expect(config.timbre.palette).toEqual(TIMBRE_IDS);
    expect(JSON.stringify(DEFAULT_MELODY_CONFIG)).toBe(before);
    expect(config.tuning).not.toBe(DEFAULT_TUNING);
  });

  it("accepts an empty palette", () => {
    expect(resolveMelodyConfig({ timbre: { palette: [] } }).timbre.palette).toEqual([]);
  });

  it("rejects tunings the generator cannot work with", () => {
    const bad: Partial<TuningConfig>[] = [
      { tonic: Number.NaN },
      { scale: [] },
      { scale: [0, 4, 2] },
      { scale: [0, 7, 12] },
      { rangeSteps: 0 },
      { rangeSteps: 2.5 },
      { levelDeadband: -0.1 },
      { maxContourPoints: 1 },
      { minBeats: 0 },
      { minBeats: 2, maxBeats: 1 },
      { registerSpread: -1 },
      { registerSpread: 1.5 },
    ];
    for (const tuning of bad) expect(() => resolveMelodyConfig({ tuning }), JSON.stringify(tuning)).toThrow(/melody tuning/);
  });
});
