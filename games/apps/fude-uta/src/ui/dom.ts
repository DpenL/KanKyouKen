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
