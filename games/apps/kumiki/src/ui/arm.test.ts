import { describe, expect, it } from "vitest";
import { ARM_MS, armScreen, createArming } from "./arm";

/** A clock that is moved by hand, with the timeouts that hang on it. */
function fakeTime(): { now(): number; after(ms: number, run: () => void): void; advance(ms: number): void } {
  let time = 1000;
  let pending: { readonly at: number; readonly run: () => void }[] = [];
  return {
    now: () => time,
    after: (ms, run) => void pending.push({ at: time + ms, run }),
    advance(ms) {
      time += ms;
      const due = pending.filter((timeout) => timeout.at <= time);
      pending = pending.filter((timeout) => timeout.at > time);
      for (const timeout of due) timeout.run();
    },
  };
}

describe("controls a click brought on screen", () => {
  it("are held for a slow double tap on a phone, and not so long that anyone waits", () => {
    expect(ARM_MS).toBeGreaterThanOrEqual(500);
    expect(ARM_MS).toBeLessThanOrEqual(600);
  });

  it("stay off until a double tap is over, then come on", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const decks = { disabled: false };
    // Finish is tapped and the exam results come up with their Decks under the finger.
    arming.clicked();
    arming.hold([decks]);
    expect(decks.disabled).toBe(true);
    time.advance(ARM_MS - 1);
    expect(decks.disabled).toBe(true);
    time.advance(1);
    expect(decks.disabled).toBe(false);
  });

  it("stay off while they are pressed: three taps 300 ms apart leave the screen the first one brought", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const decks = { disabled: false };
    arming.clicked();
    arming.hold([decks]);
    for (let tap = 1; tap < 3; tap++) {
      time.advance(300);
      expect(decks.disabled).toBe(true);
      arming.pressed(decks);
    }
    time.advance(ARM_MS - 1);
    expect(decks.disabled).toBe(true);
    time.advance(1);
    expect(decks.disabled).toBe(false);
  });

  it("hold what comes up while a burst still runs, as the deck list after a held Decks", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const decks = { disabled: false };
    arming.clicked();
    arming.hold([decks]);
    time.advance(400);
    arming.pressed(decks);
    time.advance(400);
    // The burst is still on (its last press was 400 ms ago); a screen put up now is held to its end.
    const card = { disabled: false };
    arming.hold([card]);
    expect(card.disabled).toBe(true);
    time.advance(ARM_MS - 400);
    expect([decks.disabled, card.disabled]).toEqual([false, false]);
  });

  it("leave alone a screen that came up without a recent click, and controls the game shows off", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const next = { disabled: false };
    const check = { disabled: true };
    arming.clicked();
    time.advance(ARM_MS + 300);
    // The reveal, put up by a timeout after the check.
    arming.hold([next]);
    expect(next.disabled).toBe(false);
    arming.clicked();
    arming.hold([check]);
    time.advance(ARM_MS);
    expect(check.disabled).toBe(true);
  });

  it("presses on controls that are not held change nothing", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const decks = { disabled: false };
    const tile = { disabled: false };
    arming.clicked();
    arming.hold([decks]);
    time.advance(300);
    arming.pressed(tile);
    time.advance(ARM_MS - 300);
    expect(decks.disabled).toBe(false);
  });

  it("are every control of a new screen but the tiles of the tray", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const asked: string[] = [];
    const screen = {
      querySelectorAll(selector: string) {
        asked.push(selector);
        return [];
      },
    } as unknown as ParentNode;
    armScreen(arming, screen);
    expect(asked).toEqual(["button:not(.tile), input"]);
  });
});
