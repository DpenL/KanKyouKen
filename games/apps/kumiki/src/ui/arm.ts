/**
 * Holding back what a click has just brought on screen.
 *
 * A double tap delivers its second tap to whatever stands under the finger by then, and a
 * burst of taps goes on doing so. Where the first tap has just put up another screen
 * (Finish to the exam results, their Decks to the deck list, a deck card to its first
 * character, Next on the reveal, the buttons of the summary), the control that now lies
 * under the finger must not take the rest of the burst for a choice of its own: on a phone
 * that skipped the exam results, and started and recorded a deck nobody chose. The same
 * goes for a dialog that a tap opens or closes (`armOverlay`). Taps that change nothing
 * but the screen they are on (Check, Hint, the tiles, the mode switch) hold nothing.
 */

/**
 * How long a control stays off after the click that brought it on screen, and after
 * every further press on it while it is off: long enough for a slow double tap on a phone,
 * short enough that nobody waits for it. The same as the exam's Next (`NEXT_ARM_MS`).
 */
export const ARM_MS = 600;

/** Anything that can be switched off the way a button can. */
export interface Switchable {
  disabled: boolean;
}

export interface Arming {
  /** A control was clicked just now. */
  clicked(): void;
  /**
   * These controls have just come on screen: those that are on are switched off until
   * `ARM_MS` after the last click on a control or the last press on a held one, and back
   * on then. Does nothing when no click is that recent and nothing is being held (the
   * screen changed by itself, such as the reveal after a check, or by the browser's Back).
   */
  hold(controls: Iterable<Switchable>): void;
  /**
   * A press came down on `control`. If it is being held, the press is one more tap of the
   * burst that brought it on screen, and everything held stays off until `ARM_MS` after
   * this press: a burst of any length is over this long after its last tap.
   */
  pressed(control: Switchable): void;
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
      // What comes up while a burst of taps still runs is under the finger as much as what the first tap brought.
      const until = Math.max(lastClickAt + ARM_MS, releaseAt);
      if (until <= now()) return;
      // A control the game shows switched off (Check with an empty board) is not ours to switch on.
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
  };
}

/** Whether the last click on a control came from a pointer (a finger, a mouse, a pen), not from the keyboard. */
let byPointer = false;

/** Note the clicks on controls, and the presses on held ones, that `arming` goes by. Call once, before anything is on screen. */
export function watchClicks(arming: Arming): void {
  document.addEventListener(
    "click",
    (event) => {
      // Only controls put up screens; a tap on a slot of a structure does not.
      if (event.target instanceof Element && event.target.closest("button, input") !== null) {
        arming.clicked();
        byPointer = event.detail !== 0;
      }
    },
    { capture: true },
  );
  // A button that is switched off gets no click, but the press itself arrives here with the button (or a part of it) as its target.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = event.target instanceof Element ? event.target.closest<HTMLButtonElement | HTMLInputElement>("button, input") : null;
      if (control !== null) arming.pressed(control);
    },
    { capture: true },
  );
}

/**
 * Note a click that `watchClicks` does not count because it landed on no control: a click
 * on a dialog's backdrop, which closes the dialog. What that click uncovers lies under the
 * finger just as much as what a click on a control brings up, and a double tap on the
 * backdrop would otherwise start the deck card behind it.
 */
export function noteClick(arming: Arming, event: MouseEvent): void {
  arming.clicked();
  byPointer = event.detail !== 0;
}

/**
 * `screen` has just been put up: hold its controls (see `Arming.hold`). The tiles of the
 * tray are left alone: a stray tap on one only picks it up, which shows and is undone by
 * another tap, records nothing, and a tile that is off could still be dragged.
 */
export function armScreen(arming: Arming, screen: ParentNode): void {
  arming.hold(screen.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button:not(.tile), input"));
}

/**
 * A dialog has just opened over the screen, or closed and left the screen bare: if a
 * pointer's click did it, hold the controls of `scope` as `armScreen` does, since the rest
 * of a double tap would work whichever of them lies under the finger now (a deck in the
 * exam chooser, the deck card behind Close; a phone gives a tap to a control next to where
 * it lands, so all of them). Not after the keyboard: a dialog moves the focus into its
 * first control, and back to the button that opened it when it closes, and holding that
 * control would lose the focus.
 */
export function armOverlay(arming: Arming, scope: ParentNode): void {
  if (byPointer) armScreen(arming, scope);
}
