import { describe, expect, it } from "vitest";
import { createRng, hashString } from "./rng";

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    const c = createRng("other");
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    const seqC = Array.from({ length: 8 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("shuffles without losing items and without mutating the input", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRng(7).shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
    expect(out).not.toEqual(items);
  });

  it("forks independent, reproducible streams", () => {
    const root = createRng(1);
    const f1 = root.fork("melody");
    const f2 = createRng(1).fork("melody");
    const f3 = root.fork("order");
    expect(f1.next()).toBe(f2.next());
    expect(root.fork("melody").next()).not.toBe(f3.next());
  });

  it("validates arguments", () => {
    const r = createRng(1);
    expect(() => r.int(0)).toThrow();
    expect(() => r.pick([])).toThrow();
    expect(r.int(1)).toBe(0);
    expect(hashString("abc")).toBe(hashString("abc"));
  });
});
