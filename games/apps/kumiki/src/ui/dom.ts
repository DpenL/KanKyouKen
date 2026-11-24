/** Small helpers for building DOM and SVG without a framework. */

type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;
type Child = Node | string | null | undefined | false;

const SVG_NS = "http://www.w3.org/2000/svg";

function fill(element: Element, attrs: Attrs | undefined, children: readonly Child[]): void {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
}

/** Create an HTML element. Attributes that are null, undefined or false are left out; true gives an empty attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  fill(element, attrs, children);
  return element;
}

/** Create an SVG element. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  fill(element, attrs, children);
  return element;
}

/** A button with a click handler. */
export function button(label: string, attrs: Attrs, onClick: () => void): HTMLButtonElement {
  const element = h("button", { type: "button", ...attrs }, label);
  element.addEventListener("click", onClick);
  return element;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
