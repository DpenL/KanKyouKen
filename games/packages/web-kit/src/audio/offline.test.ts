import { describe, expect, it } from "vitest";
import { pitchToFrequency } from "@kankyouken/mechanics/melody";
import { estimatePitch, rmsLevel } from "./offline";
import { whiteNoise } from "./plan";

const RATE = 22050;

interface Partial {
  readonly ratio: number;
  readonly gain: number;
}

const PURE: readonly Partial[] = [{ ratio: 1, gain: 1 }];

/** A sum of sine partials whose fundamental follows `hzAt(seconds)`. */
function synth(
  hzAt: (seconds: number) => number,
  seconds: number,
  rate: number = RATE,
  partials: readonly Partial[] = PURE,
): Float32Array {
  const samples = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    let value = 0;
    for (const partial of partials) value += partial.gain * Math.sin(phase * partial.ratio);
    samples[i] = value;
    phase += (2 * Math.PI * hzAt(i / rate)) / rate;
  }
  return samples;
}

function cents(measured: number, expected: number): number {
  return 1200 * Math.log2(measured / expected);
}

describe("estimatePitch", () => {
  it("finds the frequency of a sine to within a few cents across the playable range", () => {
    for (const hz of [110, 196, 261.63, 440, 523.25, 880, 1318.5]) {
      const measured = estimatePitch(synth(() => hz, 0.3), RATE, 0, 0.3);
      expect(Math.abs(cents(measured, hz))).toBeLessThan(5);
    }
  });

  it("works at other sample rates", () => {
    for (const rate of [8000, 44100, 48000]) {
      const measured = estimatePitch(synth(() => 330, 0.2, rate), rate, 0, 0.2);
      expect(Math.abs(cents(measured, 330))).toBeLessThan(5);
    }
  });

  it("answers the fundamental of a tone rich in harmonics, not an octave or a partial", () => {
    const koto: readonly Partial[] = [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.5 },
      { ratio: 3, gain: 0.3 },
      { ratio: 4, gain: 0.15 },
    ];
    const measured = estimatePitch(synth(() => 220, 0.3, RATE, koto), RATE, 0, 0.3);
    expect(Math.abs(cents(measured, 220))).toBeLessThan(5);

    const hollow: readonly Partial[] = [
      { ratio: 1, gain: 1 },
      { ratio: 3, gain: 0.55 },
      { ratio: 5, gain: 0.3 },
    ];
    expect(Math.abs(cents(estimatePitch(synth(() => 392, 0.3, RATE, hollow), RATE, 0, 0.3), 392))).toBeLessThan(5);
  });

  it("measures only the window it is given", () => {
    const twoNotes = synth((t) => (t < 0.5 ? 440 : 660), 1);
    expect(Math.abs(cents(estimatePitch(twoNotes, RATE, 0.05, 0.45), 440))).toBeLessThan(5);
    expect(Math.abs(cents(estimatePitch(twoNotes, RATE, 0.55, 0.95), 660))).toBeLessThan(5);
  });

  it("follows a falling stroke: an octave glide read at its start, middle and end", () => {
    const from = pitchToFrequency(69);
    const glide = synth((t) => from * 2 ** -Math.min(1, t), 1.2);
    const early = estimatePitch(glide, RATE, 0.0, 0.06);
    const middle = estimatePitch(glide, RATE, 0.47, 0.53);
    const late = estimatePitch(glide, RATE, 1.05, 1.15);
    expect(Math.abs(cents(early, pitchToFrequency(69 - 12 * 0.03)))).toBeLessThan(25);
    expect(Math.abs(cents(middle, pitchToFrequency(63)))).toBeLessThan(25);
    expect(Math.abs(cents(late, pitchToFrequency(57)))).toBeLessThan(5);
    expect(early).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(late);
  });

  it("is not thrown off by a constant offset or by the level", () => {
    const sine = synth(() => 440, 0.2);
    const shifted = sine.map((sample) => sample * 0.01 + 0.5);
    expect(Math.abs(cents(estimatePitch(shifted, RATE, 0, 0.2), 440))).toBeLessThan(5);
  });

  it("accepts the two times in either order and clamps them to the array", () => {
    const sine = synth(() => 440, 0.2);
    const forwards = estimatePitch(sine, RATE, 0.05, 0.15);
    expect(estimatePitch(sine, RATE, 0.15, 0.05)).toBe(forwards);
    expect(Math.abs(cents(estimatePitch(sine, RATE, -3, 99), 440))).toBeLessThan(5);
  });

  it("returns 0 for silence, noise, and windows that are empty or too short", () => {
    const sine = synth(() => 440, 0.2);
    expect(estimatePitch(new Float32Array(4000), RATE, 0, 1)).toBe(0);
    expect(estimatePitch(whiteNoise(4000), RATE, 0, 1)).toBe(0);
    expect(estimatePitch(new Float32Array(0), RATE, 0, 1)).toBe(0);
    expect(estimatePitch(sine, RATE, 0.1, 0.1)).toBe(0);
    expect(estimatePitch(sine, RATE, 5, 6)).toBe(0);
    expect(estimatePitch(sine.subarray(0, 3), RATE, 0, 1)).toBe(0);
    expect(estimatePitch(sine, RATE, 0, 0.002)).toBe(0);
  });

  it("returns 0 for a broken sample rate or broken times", () => {
    const sine = synth(() => 440, 0.2);
    expect(estimatePitch(sine, 0, 0, 0.2)).toBe(0);
    expect(estimatePitch(sine, -RATE, 0, 0.2)).toBe(0);
    expect(estimatePitch(sine, Number.NaN, 0, 0.2)).toBe(0);
    expect(estimatePitch(sine, RATE, Number.NaN, 0.2)).toBe(0);
  });

  it("only looks inside the requested range", () => {
    const low = synth(() => 110, 0.3);
    expect(estimatePitch(low, RATE, 0, 0.3, { minHz: 200 })).toBe(0);
    expect(Math.abs(cents(estimatePitch(low, RATE, 0, 0.3, { minHz: 80, maxHz: 400 }), 110))).toBeLessThan(5);
    const high = synth(() => 880, 0.3);
    const folded = estimatePitch(high, RATE, 0, 0.3, { maxHz: 500 });
    expect(Math.abs(cents(folded, 440))).toBeLessThan(5);
  });
});

describe("rmsLevel", () => {
  it("is amplitude over root two for a sine and the plain value for a constant", () => {
    const sine = synth(() => 441, 1).map((sample) => sample * 0.5);
    expect(rmsLevel(sine, RATE, 0, 1)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(rmsLevel(new Float32Array(100).fill(0.25), RATE, 0, 1)).toBeCloseTo(0.25, 6);
  });

  it("tells a sounding stretch from a silent one", () => {
    const samples = new Float32Array(RATE);
    samples.set(synth(() => 440, 0.5));
    expect(rmsLevel(samples, RATE, 0, 0.5)).toBeGreaterThan(0.7);
    expect(rmsLevel(samples, RATE, 0.5, 1)).toBe(0);
  });

  it("is 0 for an empty window, an empty array or a broken sample rate", () => {
    const sine = synth(() => 440, 0.1);
    expect(rmsLevel(sine, RATE, 0.05, 0.05)).toBe(0);
    expect(rmsLevel(sine, RATE, 3, 4)).toBe(0);
    expect(rmsLevel(new Float32Array(0), RATE, 0, 1)).toBe(0);
    expect(rmsLevel(sine, 0, 0, 1)).toBe(0);
    expect(rmsLevel(sine, RATE, Number.NaN, 1)).toBe(0);
  });

  it("accepts the two times in either order", () => {
    const sine = synth(() => 440, 0.1);
    expect(rmsLevel(sine, RATE, 0.08, 0.02)).toBe(rmsLevel(sine, RATE, 0.02, 0.08));
  });
});
