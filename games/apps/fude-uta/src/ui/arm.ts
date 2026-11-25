/**
 * How long a control stays off after the click that brought it on screen, and after
 * every further press on it while it is off.
 *
 * A double click or double tap delivers its second click to whatever stands under the
 * pointer by then. Where the first click has just put a control there (the next
 * character's Done, the Skip of the demonstration that Next character started, a lesson
 * card under Back to lessons), that control must not take the second click for a
 * request. Long enough for a slow double tap on a phone (300 ms between the taps and
 * more), short enough that nobody waits for it.
 */
export const ARM_MS = 500;

/** Anything that can be switched off the way a button can. */
export interface Switchable {
  disabled: boolean;
}

/** Keeps controls that a click has just brought on screen from acting on the rest of a double click, or of a longer burst of taps. */
export interface Arming {
  /** A control was clicked just now. */
  clicked(): void;
  /**
   * These controls have just come on screen: those that are on are switched off until
   * `ARM_MS` after the last click on a control or the last press on a held one, and back
   * on then. Does nothing when no click is that recent and nothing is being held (the
   * screen changed by itself, or by writing).
   */
  hold(controls: Iterable<Switchable>): void;
  /**
   * A press came down on `control`. If it is being held, the press is one more tap of the
   * burst that brought it on screen (a greyed button invites it), and everything held
   * stays off until `ARM_MS` after this press: a burst of any length is over half a
   * second after its last tap, not half a second after its first.
   */
  pressed(control: Switchable): void;
  /** True while controls are being held, to the millisecond (they are switched back on by a timeout, which may come a little late). */
  holding(): boolean;
}

/** `now` is a clock in milliseconds, `after` runs something once about that many milliseconds have passed. */
export function createArming(now: () => number, after: (ms: number, run: () => void) => void): Arming {
  let lastClickAt = Number.NEGATIVE_INFINITY;
  /** When what is held comes back on. */
  let releaseAt = Number.NEGATIVE_INFINITY;
  const held = new Set<Switchable>();
  /** Whether a timeout for `release` is under way. */
  let waiting = false;

  const release = (): void => {
    const wait = releaseAt - now();
    if (wait > 0) {
      // A press on a held control has put the end off (or the timeout came early): wait for the rest.
      after(wait, release);
      return;
    }
    waiting = false;
    for (const control of held) control.disabled = false;
    held.clear();
  };

  return {
    clicked() {
      lastClickAt = now();
    },
    hold(controls) {
      // What comes up while a burst of taps still runs is under the pointer as much as what the first click brought.
      const until = Math.max(lastClickAt + ARM_MS, releaseAt);
      if (until <= now()) return;
      // A control the game shows switched off (Undo with nothing to undo) is not ours to switch on.
      const fresh = [...controls].filter((control) => !control.disabled);
      if (fresh.length === 0) return;
      for (const control of fresh) {
        control.disabled = true;
        held.add(control);
      }
      releaseAt = until;
      if (waiting) return;
      waiting = true;
      after(until - now(), release);
    },
    pressed(control) {
      if (held.has(control)) releaseAt = now() + ARM_MS;
    },
    holding: () => releaseAt > now(),
  };
}
