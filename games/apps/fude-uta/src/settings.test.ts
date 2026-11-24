import { PLAN_ARROWS, PLAN_GUIDED_FADE, PLAN_QUICK } from "@kankyouken/mechanics/scaffold";
import { describe, expect, it } from "vitest";
import {
  AUDIO_MODE_OPTIONS,
  DEFAULT_SETTINGS,
  LENIENCY,
  PLANS,
  conditionAudioMode,
  effectiveAudioMode,
  sanitizeSettings,
  soundOn,
} from "./settings";

describe("sanitizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const raw of [undefined, null, 3, "melody", []]) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const stored = { audioMode: "sfx", timbreMode: "single", volume: 0.25, judging: "strict", plan: "quick" };
    expect(sanitizeSettings(stored)).toEqual(stored);
  });

  it("replaces unknown values field by field", () => {
    const cleaned = sanitizeSettings({ audioMode: "loud", timbreMode: "single", volume: "0.5", judging: 2, plan: "arrows" });
    expect(cleaned).toEqual({ ...DEFAULT_SETTINGS, timbreMode: "single", plan: "arrows" });
  });

  it("clamps the volume to 0..1 and rejects non-finite numbers", () => {
    expect(sanitizeSettings({ volume: 7 }).volume).toBe(1);
    expect(sanitizeSettings({ volume: -1 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
  });
});

describe("study conditions", () => {
  it("maps the four condition labels to sound modes", () => {
    for (const { value } of AUDIO_MODE_OPTIONS) expect(conditionAudioMode(value)).toBe(value);
  });

  it("ignores missing and unknown conditions", () => {
    expect(conditionAudioMode(undefined)).toBeNull();
    expect(conditionAudioMode("control")).toBeNull();
  });

  it("lets a condition override the player's setting", () => {
    expect(effectiveAudioMode(DEFAULT_SETTINGS, "silent")).toBe("silent");
    expect(effectiveAudioMode({ ...DEFAULT_SETTINGS, audioMode: "sfx" }, undefined)).toBe("sfx");
    expect(effectiveAudioMode({ ...DEFAULT_SETTINGS, audioMode: "sfx" }, "nonsense")).toBe("sfx");
  });
});

describe("presets", () => {
  it("offers the four sound modes under plain-language labels", () => {
    expect(AUDIO_MODE_OPTIONS.map((o) => o.label)).toEqual(["Melodies", "Random notes", "Chalk sound", "Silent"]);
  });

  it("judges more leniently the gentler the setting", () => {
    expect(LENIENCY).toEqual({ gentle: 1.6, normal: 1.3, strict: 1.0 });
  });

  it("maps plan choices to the library's plans, guided fade by default", () => {
    expect(PLANS[DEFAULT_SETTINGS.plan]).toBe(PLAN_GUIDED_FADE);
    expect(PLANS.arrows).toBe(PLAN_ARROWS);
    expect(PLANS.quick).toBe(PLAN_QUICK);
  });
});

describe("soundOn", () => {
  it("is off in silent mode and at volume zero, whichever way the mode was set", () => {
    expect(soundOn(DEFAULT_SETTINGS, undefined)).toBe(true);
    expect(soundOn({ ...DEFAULT_SETTINGS, volume: 0 }, undefined)).toBe(false);
    expect(soundOn({ ...DEFAULT_SETTINGS, audioMode: "silent" }, undefined)).toBe(false);
    expect(soundOn(DEFAULT_SETTINGS, "silent")).toBe(false);
    expect(soundOn({ ...DEFAULT_SETTINGS, audioMode: "silent" }, "melody")).toBe(true);
    expect(soundOn({ ...DEFAULT_SETTINGS, volume: 0 }, "melody")).toBe(false);
  });
});
