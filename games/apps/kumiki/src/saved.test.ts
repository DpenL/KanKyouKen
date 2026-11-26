import { describe, expect, it } from "vitest";
import { DEFAULT_SAVED, bestKey, bestScore, cleanSaved, withScore, type Saved } from "./saved";

const stored = (value: unknown): Saved => ({ ...DEFAULT_SAVED, ...(value as Partial<Saved>) });

describe("cleanSaved", () => {
  it("keeps what is valid", () => {
    const saved: Saved = {
      mode: "review",
      sound: false,
      volume: 0.25,
      best: { "gate:learn": 320 },
      rules: { preset: "classic", changes: { check: "auto" } },
    };
    expect(cleanSaved(saved)).toEqual(saved);
    expect(cleanSaved(DEFAULT_SAVED)).toEqual(DEFAULT_SAVED);
  });

  it("replaces every field of the wrong kind with its default", () => {
    expect(cleanSaved(stored({ best: null }))).toEqual(DEFAULT_SAVED);
    expect(cleanSaved(stored({ best: [1, 2] })).best).toEqual({});
    expect(cleanSaved(stored({ mode: "exam" })).mode).toBe("learn");
    expect(cleanSaved(stored({ mode: null })).mode).toBe("learn");
    expect(cleanSaved(stored({ sound: "yes" })).sound).toBe(true);
    expect(cleanSaved(stored({ volume: "loud" })).volume).toBe(DEFAULT_SAVED.volume);
    expect(cleanSaved(stored({ volume: Number.NaN })).volume).toBe(DEFAULT_SAVED.volume);
    expect(cleanSaved(stored({ rules: "classic" })).rules).toEqual(DEFAULT_SAVED.rules);
    expect(cleanSaved(stored({ rules: { preset: "classic", changes: { check: "soon", feedback: "panel" } } })).rules).toEqual({
      preset: "classic",
      changes: { feedback: "panel" },
    });
  });

  it("starts players who stored nothing about rules on the default preset", () => {
    const { rules: _rules, ...older } = DEFAULT_SAVED;
    expect(cleanSaved(older as Saved).rules).toEqual({ preset: "zen-hanzi", changes: {} });
  });

  it("clamps the volume and drops best scores that are not finite numbers", () => {
    expect(cleanSaved(stored({ volume: 7 })).volume).toBe(1);
    expect(cleanSaved(stored({ volume: -1 })).volume).toBe(0);
    expect(cleanSaved(stored({ best: { a: 10, b: "many", c: null, d: Infinity } })).best).toEqual({ a: 10 });
  });
});

describe("best scores", () => {
  it("keeps a best per deck and mode", () => {
    expect(bestKey("gate", "learn")).not.toBe(bestKey("gate", "review"));
    // A best score belongs to the rules it was made under; classic keeps the keys it always had.
    expect(bestKey("gate", "learn", "classic")).toBe("gate:learn");
    expect(bestKey("gate", "learn", "zen-hanzi,scoring:classic")).toBe("gate:learn:zen-hanzi,scoring:classic");
    const other = { ...DEFAULT_SAVED, best: withScore(DEFAULT_SAVED, "gate", "learn", 585, "classic,lives:none") };
    expect(bestScore(other, "gate", "learn", "classic,lives:none")).toBe(585);
    expect(bestScore(other, "gate", "learn")).toBeNull();
    expect(bestScore(other, "gate", "learn", "classic,lives:1")).toBeNull();
    expect(bestScore(DEFAULT_SAVED, "gate", "learn")).toBeNull();
    const best = withScore(DEFAULT_SAVED, "gate", "learn", 320);
    const saved = { ...DEFAULT_SAVED, best };
    expect(bestScore(saved, "gate", "learn")).toBe(320);
    expect(bestScore(saved, "gate", "review")).toBeNull();
  });

  it("only replaces a best that was beaten", () => {
    const saved = { ...DEFAULT_SAVED, best: withScore(DEFAULT_SAVED, "gate", "learn", 320) };
    expect(withScore(saved, "gate", "learn", 300)).toBe(saved.best);
    expect(withScore(saved, "gate", "learn", 320)).toBe(saved.best);
    expect(withScore(saved, "gate", "learn", 400)[bestKey("gate", "learn")]).toBe(400);
  });

  it("ignores stored values that are not numbers", () => {
    const saved = { ...DEFAULT_SAVED, best: { [bestKey("gate", "learn")]: "many" as unknown as number } };
    expect(bestScore(saved, "gate", "learn")).toBeNull();
    expect(withScore(saved, "gate", "learn", 10)[bestKey("gate", "learn")]).toBe(10);
  });
});
