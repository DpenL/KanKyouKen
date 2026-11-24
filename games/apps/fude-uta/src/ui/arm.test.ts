import { describe, expect, it } from "vitest";
import { ARM_MS, createArming } from "./arm";

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
  it("covers a slow double tap on a phone", () => {
    expect(ARM_MS).toBeGreaterThanOrEqual(400);
  });

  it("stay off until a double click is over, then come on", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const done = { disabled: false };
    arming.clicked();
    arming.hold([done]);
    expect(done.disabled).toBe(true);
    expect(arming.holding()).toBe(true);
    time.advance(ARM_MS - 1);
    expect(done.disabled).toBe(true);
    time.advance(1);
    expect(done.disabled).toBe(false);
    expect(arming.holding()).toBe(false);
  });

  it("are held from the click, not from the moment they appear", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const skip = { disabled: false };
    arming.clicked();
    time.advance(200);
    arming.hold([skip]);
    time.advance(ARM_MS - 201);
    expect(skip.disabled).toBe(true);
    time.advance(1);
    expect(skip.disabled).toBe(false);
  });

  it("are left alone when no click brought them (the screen changed by itself, or by writing)", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const hint = { disabled: false };
    arming.hold([hint]);
    expect(hint.disabled).toBe(false);
    arming.clicked();
    time.advance(ARM_MS);
    arming.hold([hint]);
    expect(hint.disabled).toBe(false);
    expect(arming.holding()).toBe(false);
  });

  it("never switch on a control the game shows switched off", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const undo = { disabled: true };
    const done = { disabled: false };
    arming.clicked();
    arming.hold([undo, done]);
    time.advance(ARM_MS);
    expect(undo.disabled).toBe(true);
    expect(done.disabled).toBe(false);
  });
});
