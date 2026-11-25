import { createLocalStore, participantStoreKey, readLaunchParams } from "@kankyouken/web-kit/app";
import { describe, expect, it } from "vitest";
import type { Saved } from "./saved";
import { DEFAULT_SAVED, STORE_KEY, cleanSaved } from "./saved";
import { DEFAULT_SETTINGS } from "./settings";

function memoryStorage(initial: Record<string, string> = {}): Storage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } as unknown as Storage & { readonly data: Map<string, string> };
}

const openStore = (search: string, storage: Storage): ReturnType<typeof createLocalStore<Saved>> =>
  createLocalStore<Saved>(participantStoreKey(STORE_KEY, readLaunchParams(search)), DEFAULT_SAVED, storage, cleanSaved);

describe("what the game remembers", () => {
  it("keeps settings and stars apart for every participant of a study, and plain play under the plain key", () => {
    const storage = memoryStorage();
    const link = (participant: string): string => `?study=S1&participant=${participant}&api=https://x.example/functions/v1&token=t`;

    const first = openStore(link("P1"), storage);
    first.patch({ settings: { ...DEFAULT_SETTINGS, judging: "gentle", plan: "quick", volume: 0 }, stars: { "first-strokes": 3 } });

    expect(openStore(link("P2"), storage).get()).toEqual(DEFAULT_SAVED);
    expect(openStore("", storage).get()).toEqual(DEFAULT_SAVED);
    expect(openStore(link("P1"), storage).get().settings).toMatchObject({ judging: "gentle", plan: "quick", volume: 0 });
    expect([...storage.data.keys()]).toEqual([`${STORE_KEY}:S1:P1`]);

    // A link that lost its api or token cannot report, but it is still that participant's session:
    // it keeps to their key, so it neither starts from nor leaves behind anyone else's settings.
    const incomplete = openStore("?study=S1&participant=P2&condition=sfx", storage);
    expect(incomplete.get()).toEqual(DEFAULT_SAVED);
    incomplete.patch({ stars: { "first-strokes": 1 } });
    expect(openStore(link("P2"), storage).get().stars).toEqual({ "first-strokes": 1 });
    expect(openStore("", storage).get()).toEqual(DEFAULT_SAVED);
    // A link that names only one of the two is plain play.
    openStore("?study=S1", storage).patch({ stars: { "first-strokes": 2 } });
    expect([...storage.data.keys()].sort()).toEqual([STORE_KEY, `${STORE_KEY}:S1:P1`, `${STORE_KEY}:S1:P2`]);
  });

  it("starts from defaults for whatever is stored in the wrong shape", () => {
    for (const stored of [
      { settings: "loud", stars: [3, 3] },
      { settings: null, stars: null },
      { settings: { audioMode: "karaoke", volume: "max", judging: 7, plan: null, timbreMode: {} }, stars: { a: 5, b: "3" } },
    ]) {
      const store = createLocalStore<Saved>(STORE_KEY, DEFAULT_SAVED, memoryStorage({ [STORE_KEY]: JSON.stringify(stored) }), cleanSaved);
      expect(store.get()).toEqual(DEFAULT_SAVED);
    }
  });

  it("keeps what is stored in the right shape", () => {
    const stored = { settings: { ...DEFAULT_SETTINGS, audioMode: "sfx", volume: 0.25 }, stars: { one: 2, two: 4 } };
    expect(cleanSaved(stored as unknown as Saved)).toEqual({ settings: stored.settings, stars: { one: 2 } });
  });
});
