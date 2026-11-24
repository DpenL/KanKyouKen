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

/** Start noting the clicks on controls that `arm` goes by. Call once, before anything is on screen. */
export function watchClicks(): void {
  document.addEventListener(
    "click",
    (event) => {
      // Ink on the writing square ends in a click too; only controls bring controls on screen.
      if (event.target instanceof Element && event.target.closest("button, input, label") !== null) arming.clicked();
    },
    { capture: true },
  );
}

/**
 * The controls under `scope` have just come on screen. If a click brought them, they are
 * disabled until the rest of a double click has passed (see `ARM_MS`), so that its second
 * click cannot act on them. Every screen, action row, overlay card and dialog goes through here.
 */
export function arm(scope: ParentNode): void {
  arming.hold(scope.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input"));
}

/** False while a click may still be the second of a double click: the test for what cannot be disabled (a dialog's backdrop). */
export function armed(): boolean {
  return !arming.holding();
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
