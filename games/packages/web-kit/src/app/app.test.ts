import { describe, expect, it } from "vitest";
import { canReport, readLaunchParams } from "./params";
import { createLocalStore, type KeyValueStorage } from "./store";

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe("launch params", () => {
  it("reads study context, api and token, fragment over query", () => {
    const p = readLaunchParams("?study=s1&participant=p1&api=https://x.test/functions/v1/&token=old&debug", "#token=new&condition=melody");
    expect(p.study).toEqual({ studyId: "s1", participantId: "p1" });
    expect(p.api).toBe("https://x.test/functions/v1");
    expect(p.token).toBe("new");
    expect(p.condition).toBe("melody");
    expect(p.debug).toBe(true);
    expect(canReport(p)).toBe(true);
  });

  it("runs offline without a complete link", () => {
    const p = readLaunchParams("?study=s1&seed=abc&debug=0");
    expect(p.study).toBeUndefined();
    expect(p.seed).toBe("abc");
    expect(p.debug).toBe(false);
    expect(canReport(p)).toBe(false);
    expect(readLaunchParams("")).toEqual({ debug: false });
    expect(readLaunchParams("?study=s&participant=p&session=z").study).toEqual({ studyId: "s", participantId: "p", sessionId: "z" });
  });
});

describe("local store", () => {
  it("persists patches and merges stored values over defaults", () => {
    const storage = fakeStorage({ k: JSON.stringify({ volume: 0.2 }) });
    const store = createLocalStore("k", { volume: 0.5, mode: "melody" }, storage);
    expect(store.get()).toEqual({ volume: 0.2, mode: "melody" });
    store.patch({ mode: "sfx" });
    expect(JSON.parse(storage.data.k!)).toEqual({ volume: 0.2, mode: "sfx" });
    expect(store.reset()).toEqual({ volume: 0.5, mode: "melody" });
    expect("k" in storage.data).toBe(false);
  });

  it("passes what was stored through the cleaner, and falls back to the defaults if it throws", () => {
    const defaults = { volume: 0.5, mode: "melody" };
    const clean = (stored: typeof defaults): typeof defaults => ({
      volume: typeof stored.volume === "number" ? stored.volume : defaults.volume,
      mode: stored.mode,
    });
    const storage = fakeStorage({ k: JSON.stringify({ volume: "loud", mode: "sfx" }) });
    expect(createLocalStore("k", defaults, storage, clean).get()).toEqual({ volume: 0.5, mode: "sfx" });
    // Nothing stored: the defaults are used as they are.
    expect(createLocalStore("other", defaults, storage, () => ({ volume: 0, mode: "x" })).get()).toEqual(defaults);
    const failing = (): typeof defaults => {
      throw new Error("bad data");
    };
    expect(createLocalStore("k", defaults, storage, failing).get()).toEqual(defaults);
  });

  it("survives corrupt, wrong-shaped, missing and throwing storage", () => {
    expect(createLocalStore("k", { a: 1 }, fakeStorage({ k: "{nope" })).get()).toEqual({ a: 1 });
    expect(createLocalStore("k", { a: 1 }, fakeStorage({ k: "[1,2]" })).get()).toEqual({ a: 1 });
    expect(createLocalStore("k", { a: 1 }, null).patch({ a: 2 })).toEqual({ a: 2 });
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createLocalStore("k", { a: 1 }, throwing);
    expect(store.patch({ a: 3 })).toEqual({ a: 3 });
    expect(store.reset()).toEqual({ a: 1 });
  });
});
