/**
 * How long a control stays off after the click that brought it on screen.
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

/** Keeps controls that a click has just brought on screen from acting on the rest of a double click. */
export interface Arming {
  /** A control was clicked just now. */
  clicked(): void;
  /**
   * These controls have just come on screen: those that are on are switched off until
   * `ARM_MS` after the last click on a control, and back on then. Does nothing when no
   * click is that recent (the screen changed by itself, or by writing).
   */
  hold(controls: Iterable<Switchable>): void;
  /** True while a click may still be the second of a double click; for what cannot be disabled, such as a dialog's backdrop. */
  holding(): boolean;
}

/** `now` is a clock in milliseconds, `after` runs something once that many milliseconds have passed. */
export function createArming(now: () => number, after: (ms: number, run: () => void) => void): Arming {
  let lastClickAt = Number.NEGATIVE_INFINITY;
  const remaining = (): number => lastClickAt + ARM_MS - now();
  return {
    clicked() {
      lastClickAt = now();
    },
    hold(controls) {
      const wait = remaining();
      if (wait <= 0) return;
      // A control the game shows switched off (Undo with nothing to undo) is not ours to switch on.
      const held = [...controls].filter((control) => !control.disabled);
      for (const control of held) control.disabled = true;
      after(wait, () => {
        for (const control of held) control.disabled = false;
      });
    },
    holding: () => remaining() > 0,
  };
}
