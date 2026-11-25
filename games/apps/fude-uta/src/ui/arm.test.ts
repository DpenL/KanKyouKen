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

  it("stay off while they are pressed: a burst of taps is over half a second after its last tap", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const done = { disabled: false };
    arming.clicked();
    arming.hold([done]);
    // Six more taps 150 ms apart, the last one 900 ms after the click that brought the button.
    for (let tap = 0; tap < 6; tap++) {
      time.advance(150);
      expect(done.disabled).toBe(true);
      arming.pressed(done);
    }
    time.advance(ARM_MS - 1);
    expect(done.disabled).toBe(true);
    expect(arming.holding()).toBe(true);
    time.advance(1);
    expect(done.disabled).toBe(false);
    expect(arming.holding()).toBe(false);
  });

  it("are not kept off by a press on a control that is not held", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const done = { disabled: false };
    const chip = { disabled: false };
    arming.clicked();
    arming.hold([done]);
    time.advance(300);
    arming.pressed(chip);
    time.advance(ARM_MS - 300);
    expect(done.disabled).toBe(false);
    // Nor does a press on a control that has come back on start anything.
    arming.pressed(done);
    expect(arming.holding()).toBe(false);
  });

  it("are held to the end of a burst that is still running when they appear", () => {
    const time = fakeTime();
    const arming = createArming(time.now, time.after);
    const skip = { disabled: false };
    const listen = { disabled: false };
    arming.clicked();
    arming.hold([skip]);
    time.advance(400);
    arming.pressed(skip);
    // 600 ms after the click the demonstration ends by itself, and Listen comes up where Skip was.
    time.advance(200);
    arming.hold([listen]);
    expect(listen.disabled).toBe(true);
    time.advance(299);
    expect([skip.disabled, listen.disabled]).toEqual([true, true]);
    time.advance(1);
    expect([skip.disabled, listen.disabled]).toEqual([false, false]);
  });

  it("come back on when the timeout runs a little early", () => {
    const time = fakeTime();
    const arming = createArming(time.now, (ms, run) => time.after(Math.max(0, ms - 1), run));
    const done = { disabled: false };
    arming.clicked();
    arming.hold([done]);
    time.advance(ARM_MS - 1);
    expect(done.disabled).toBe(true);
    time.advance(1);
    expect(done.disabled).toBe(false);
  });

  it("count as held to the millisecond, however late the timeout switches them back on (what the writing square goes by)", () => {
    const time = fakeTime();
    const arming = createArming(time.now, (ms, run) => time.after(ms + 30, run));
    const square = { disabled: false };
    arming.clicked();
    arming.hold([square]);
    time.advance(ARM_MS - 1);
    expect(arming.holding()).toBe(true);
    time.advance(1);
    expect(square.disabled).toBe(true);
    expect(arming.holding()).toBe(false);
    time.advance(30);
    expect(square.disabled).toBe(false);
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
