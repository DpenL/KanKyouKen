/**
 * Deterministic pseudo-random numbers. Every mechanic that needs randomness takes
 * an `Rng` so that sessions can be replayed from a seed (tests, telemetry audits,
 * identical item orders across study participants).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). `n` must be a positive integer. */
  int(n: number): number;
  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** New array with the items in random order (Fisher-Yates); input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** Independent generator derived from this one and a label; does not advance this generator. */
  fork(label: string): Rng;
}

/** 32-bit string hash (xmur3 finaliser). Stable across platforms. */
export function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seeded generator (mulberry32). The same seed always yields the same sequence. */
export function createRng(seed: number | string): Rng {
  const seed32 = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  let state = seed32;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => {
    if (!Number.isInteger(n) || n <= 0) throw new Error("Rng.int: n must be a positive integer");
    return Math.floor(next() * n);
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("Rng.pick: empty array");
      return items[int(items.length)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork(label: string): Rng {
      return createRng(hashString(`${seed32}:${label}`));
    },
  };
}
