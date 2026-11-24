import { describe, expect, it } from "vitest";
import { DEFAULT_SAVED, bestKey, bestScore, withScore } from "./saved";

describe("best scores", () => {
  it("keeps a best per deck and mode", () => {
    expect(bestKey("gate", "learn")).not.toBe(bestKey("gate", "review"));
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
