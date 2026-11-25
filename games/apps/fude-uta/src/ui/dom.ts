import { createArming } from "./arm";

type Child = Node | string;

/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

export type ButtonKind = "primary" | "plain" | "quiet";

export function button(label: string, onClick: () => void, kind: ButtonKind = "plain"): HTMLButtonElement {
  const node = el("button", { type: "button", class: `btn btn-${kind}` }, label);
  node.addEventListener("click", onClick);
  return node;
}

const arming = createArming(
  () => performance.now(),
  (ms, run) => void window.setTimeout(run, ms),
);

/** Where the last click on a control came down, in the viewport; null when it came from the keyboard. */
let clickedAt: { readonly x: number; readonly y: number } | null = null;

/** The control a press on `target` works: a button, an input, or the input a label stands for. */
function controlOf(target: EventTarget | null): HTMLButtonElement | HTMLInputElement | null {
  const found = target instanceof Element ? target.closest<HTMLButtonElement | HTMLInputElement | HTMLLabelElement>("button, input, label") : null;
  if (!(found instanceof HTMLLabelElement)) return found;
  const { control } = found;
  return control instanceof HTMLButtonElement || control instanceof HTMLInputElement ? control : null;
}

/** Start noting the clicks and presses on controls that `arm` goes by. Call once, before anything is on screen. */
export function watchClicks(): void {
  document.addEventListener(
    "click",
    (event) => {
      // Ink on the writing square ends in a click too; only controls bring controls on screen.
      if (event.target instanceof Element && event.target.closest("button, input, label") !== null) {
        arming.clicked();
        clickedAt = event.detail === 0 ? null : { x: event.clientX, y: event.clientY };
      }
    },
    { capture: true },
  );
  // A button that is switched off gets no click, but the press itself arrives here with the button as its target.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = controlOf(event.target);
      if (control !== null) arming.pressed(control);
    },
    { capture: true },
  );
}

/**
 * The controls under `scope` have just come on screen. If a click brought them, they are
 * disabled until the rest of a double click has passed (see `ARM_MS`), so that its second
 * click cannot act on them; every press on one of them while it is disabled puts that end
 * off again. Every screen, action row and overlay card goes through here; a dialog goes
 * through `armUnderPointer`, and an action row that only shows what a press of its own changed
 * through neither (`WritingUi.redrawActions`).
 */
export function arm(scope: ParentNode): void {
  arming.hold(scope.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input"));
}

/**
 * A dialog has just been shown over the page. Its controls are what whoever opened it came
 * for, so they stay live, all but the one that now lies where the opening click came down:
 * the rest of a double click would work that one (on a phone, often a setting), so it is
 * held as `arm` holds. Call once the dialog is shown, so that it is laid out.
 */
export function armUnderPointer(scope: Element): void {
  if (clickedAt === null) return;
  const control = controlOf(document.elementFromPoint(clickedAt.x, clickedAt.y));
  if (control !== null && scope.contains(control)) arming.hold([control]);
}

/** What a click can bring under the pointer although it is no button and cannot be disabled, such as a dialog's backdrop. */
export interface Guard {
  /** It has just come under the pointer: `arm` for it. */
  hold(): void;
  /** True while a press on it may still belong to the click that brought it, and must not act. */
  held(): boolean;
  /** A press came down on it; while it is held, that puts the end of the hold off as a press on a disabled button does. */
  pressed(): void;
}

export function createGuard(): Guard {
  const state = { disabled: false };
  return {
    hold: () => arming.hold([state]),
    held: () => state.disabled && arming.holding(),
    pressed: () => arming.pressed(state),
  };
}

/** Timeouts that can all be cancelled together when a screen is left. */
export interface Timers {
  after(ms: number, run: () => void): void;
  clear(): void;
}

export function createTimers(): Timers {
  const pending = new Set<number>();
  return {
    after(ms, run) {
      const id = window.setTimeout(() => {
        pending.delete(id);
        run();
      }, ms);
      pending.add(id);
    },
    clear() {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
