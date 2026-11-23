import { describe, expect, it } from "vitest";
import { contourPitchAt, contourTravel, pitchToFrequency } from "./contour";
import * as api from "./index";
import { DEFAULT_TIMBRE_CONFIG, NEUTRAL_TIMBRE, TIMBRE_IDS, timbreById, TIMBRES } from "./timbres";
import type { ContourPoint } from "./types";

describe("contour helpers", () => {
  const bend: ContourPoint[] = [
    { p: 0, pitch: 76 },
    { p: 0.5, pitch: 76 },
    { p: 1, pitch: 57 },
  ];

  it("converts pitches to frequencies", () => {
    expect(pitchToFrequency(69)).toBe(440);
    expect(pitchToFrequency(57)).toBeCloseTo(220, 10);
    expect(pitchToFrequency(69.5)).toBeGreaterThan(440);
  });

  it("interpolates a contour and clamps progress", () => {
    expect(contourPitchAt(bend, 0.25)).toBe(76);
    expect(contourPitchAt(bend, 0.75)).toBeCloseTo(66.5, 10);
    expect(contourPitchAt(bend, -1)).toBe(76);
    expect(contourPitchAt(bend, 2)).toBe(57);
    expect(() => contourPitchAt([], 0.5)).toThrow(/empty contour/);
  });

  it("reports the net travel", () => {
    expect(contourTravel(bend)).toBe(-19);
    expect(contourTravel([])).toBe(0);
  });
});

describe("timbres", () => {
  it("offers distinct, sustaining timbres with the neutral one among them", () => {
    expect(new Set(TIMBRE_IDS).size).toBe(TIMBRES.length);
    expect(TIMBRE_IDS).toContain(NEUTRAL_TIMBRE);
    expect(DEFAULT_TIMBRE_CONFIG.palette).toEqual(TIMBRE_IDS);
    expect(TIMBRES.every((t) => t.envelope.sustain > 0 && t.partials.length > 0)).toBe(true);
    expect(timbreById("glass").label).toBe("Glass bell");
    expect(() => timbreById("kazoo")).toThrow(/unknown timbre/);
  });
});

describe("melody index", () => {
  it("re-exports the whole module", () => {
    for (const name of [
      "pitchToFrequency",
      "contourPitchAt",
      "contourTravel",
      "TIMBRES",
      "timbreById",
      "DEFAULT_TUNING",
      "DEFAULT_MELODY_CONFIG",
      "stepToPitch",
      "resolveMelodyConfig",
      "elementForStroke",
      "generateElements",
      "detectPrefixes",
      "createMelodist",
      "strokeVoice",
      "DEFAULT_PLAYBACK",
      "scheduleMelody",
      "melodyDuration",
    ]) {
      expect(api, name).toHaveProperty(name);
    }
  });
});
