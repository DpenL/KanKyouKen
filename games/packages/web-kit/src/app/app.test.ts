import { describe, expect, it } from "vitest";
import type { CollectorStatus } from "../telemetry/sink";
import { RECORDING_NOTICE_ATTRIBUTE, createRecordingNotice, mountRecordingNotice, recordingMessage } from "./notice";
import { canReport, participantStoreKey, readLaunchParams, storeKeyFor, studyLinkState } from "./params";
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

describe("study links", () => {
  const FULL = "?study=s1&participant=p1&session=x&api=https://x.test/functions/v1";

  it("tells a complete link, no link and an incomplete one apart", () => {
    expect(studyLinkState(readLaunchParams(FULL, "#token=t"))).toBe("complete");
    expect(readLaunchParams(FULL, "#token=t").missing).toBeUndefined();

    // Plain play, also with the keys that are not about reporting.
    for (const search of ["", "?debug", "?seed=abc&condition=sfx&debug=1"]) {
      const params = readLaunchParams(search);
      expect(studyLinkState(params), search).toBe("none");
      expect(params.missing, search).toBeUndefined();
    }

    // The fragment with the token was lost on the way.
    const noToken = readLaunchParams(FULL);
    expect(studyLinkState(noToken)).toBe("incomplete");
    expect(noToken.missing).toEqual(["token"]);
    expect(canReport(noToken)).toBe(false);

    // Anything that points to a study counts, however little of it is left.
    expect(readLaunchParams("?study=s1").missing).toEqual(["participant", "api", "token"]);
    expect(readLaunchParams("?participant=p1&api=https://x.test").missing).toEqual(["study", "token"]);
    expect(readLaunchParams("", "#token=t").missing).toEqual(["study", "participant", "api"]);
    expect(readLaunchParams("?session=x").missing).toEqual(["study", "participant", "api", "token"]);
    for (const search of ["?study=s1", "?participant=p1", "?session=x", "?api=https://x.test", "?token=t", "?study=&token=t"]) {
      expect(studyLinkState(readLaunchParams(search)), search).toBe("incomplete");
    }
    // Parameters put together by hand rather than read from a link.
    expect(studyLinkState({ debug: false, token: "t" })).toBe("incomplete");
    expect(studyLinkState({ debug: false })).toBe("none");
  });

  it("keeps a participant's settings apart from everybody else's on the device", () => {
    expect(storeKeyFor("kk.game.v1", readLaunchParams(FULL, "#token=t"))).toBe("kk.game.v1:s1:p1");
    expect(storeKeyFor("kk.game.v1", readLaunchParams(FULL.replace("p1", "p2"), "#token=t"))).toBe("kk.game.v1:s1:p2");
    // Plain play, and links that cannot be recorded anyway, keep the plain key.
    expect(storeKeyFor("kk.game.v1", readLaunchParams("?seed=abc"))).toBe("kk.game.v1");
    expect(storeKeyFor("kk.game.v1", readLaunchParams(FULL))).toBe("kk.game.v1");
  });

  it("keeps a participant's settings apart also when the link is incomplete", () => {
    const key = (search: string, hash = ""): string => participantStoreKey("kk.game.v1", readLaunchParams(search, hash));
    expect(key(FULL, "#token=t")).toBe("kk.game.v1:s1:p1");
    expect(key(FULL)).toBe("kk.game.v1:s1:p1");
    // The reviewer's link: study, participant and condition, no api and no token.
    expect(key("?study=s1&participant=p2&condition=sfx")).toBe("kk.game.v1:s1:p2");
    // Plain play, and a link that names only one of the two, keep the plain key.
    expect(key("?seed=abc")).toBe("kk.game.v1");
    expect(key("?study=s1&token=t")).toBe("kk.game.v1");
    expect(key("?participant=p1&condition=sfx")).toBe("kk.game.v1");
  });
});

describe("recording notice", () => {
  const FULL = "?study=s1&participant=p1&api=https://x.test/functions/v1";
  const complete = readLaunchParams(FULL, "#token=t");
  const status = (state: CollectorStatus["state"], dropped = 0): CollectorStatus => ({ state, pending: 3, dropped });

  /** The little of a document the notice needs. */
  function fakePage() {
    const created: { tag: string; attributes: Record<string, string>; style: Record<string, string>; hidden: boolean; textContent: string }[] = [];
    const doc = {
      createElement(tag: string) {
        const attributes: Record<string, string> = {};
        const element = { tag, attributes, style: {}, hidden: false, textContent: "", setAttribute: (name: string, value: string) => void (attributes[name] = value) };
        created.push(element);
        return element as unknown as HTMLElement;
      },
    } as unknown as Document;
    const appended: unknown[] = [];
    const host = { appendChild: <T>(node: T): T => (appended.push(node), node) } as unknown as Node;
    return { doc, host, created, appended };
  }

  it("says nothing in plain play and while a study session is being recorded", () => {
    expect(recordingMessage(readLaunchParams(""))).toBeNull();
    expect(recordingMessage(readLaunchParams("?seed=abc&debug"), status("retrying", 2))).toBeNull();
    expect(recordingMessage(complete)).toBeNull();
    expect(recordingMessage(complete, status("recording"))).toBeNull();
  });

  it("says that a session is not being recorded, and why", () => {
    expect(recordingMessage(readLaunchParams(FULL))).toMatch(/Not being recorded.*incomplete \(no token\)/);
    expect(recordingMessage(readLaunchParams("?study=s1"))).toContain("(no participant, no api, no token)");
    expect(recordingMessage({ debug: false, token: "t" })).toMatch(/Not being recorded.*incomplete\./);
    expect(recordingMessage(complete, status("rejected"))).toMatch(/Not being recorded.*not accepted/);
    expect(recordingMessage(complete, status("retrying"))).toMatch(/cannot be sent.*kept on this device/);
    // Events that could not be kept are owned up to in every state.
    expect(recordingMessage(complete, status("retrying", 1))).toContain("1 event could not be kept.");
    expect(recordingMessage(complete, status("rejected", 12))).toContain("12 events could not be kept.");
    expect(recordingMessage(complete, status("recording", 2))).toBe("Recording, but 2 events could not be kept.");
  });

  it("is a status region that takes no room and lets clicks through", () => {
    const { doc, created } = fakePage();
    const notice = createRecordingNotice(doc);
    const element = created[0]!;
    expect(notice.element).toBe(element);
    expect(element.tag).toBe("div");
    expect(element.attributes).toEqual({ role: "status", [RECORDING_NOTICE_ATTRIBUTE]: "" });
    expect(element.style).toMatchObject({ position: "fixed", pointerEvents: "none" });
    expect(element.hidden).toBe(true);
    notice.show("Not recorded");
    expect([element.hidden, element.textContent]).toEqual([false, "Not recorded"]);
    notice.show(null);
    expect([element.hidden, element.textContent]).toEqual([true, ""]);
  });

  it("adds nothing to the page in plain play", () => {
    const { doc, host, created, appended } = fakePage();
    const update = mountRecordingNotice(readLaunchParams("?seed=abc"), host, doc);
    update(status("rejected", 5));
    expect(created).toEqual([]);
    expect(appended).toEqual([]);
    // Nor does it need a page to be there at all (these tests run without a DOM).
    expect(() => mountRecordingNotice(readLaunchParams("?debug"))(status("retrying"))).not.toThrow();
  });

  it("announces an incomplete link at once", () => {
    const { doc, host, created, appended } = fakePage();
    mountRecordingNotice(readLaunchParams(FULL), host, doc);
    expect(appended).toEqual([created[0]]);
    expect(created[0]!.hidden).toBe(false);
    expect(created[0]!.textContent).toContain("Not being recorded");
  });

  it("follows the collector sink for a complete link", () => {
    const { doc, host, created } = fakePage();
    const update = mountRecordingNotice(complete, host, doc);
    const element = created[0]!;
    expect(element.hidden).toBe(true);
    update(status("retrying"));
    expect([element.hidden, element.textContent]).toEqual([false, recordingMessage(complete, status("retrying"))]);
    update(status("recording"));
    expect(element.hidden).toBe(true);
    update(status("rejected"));
    expect(element.textContent).toContain("not accepted");
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
