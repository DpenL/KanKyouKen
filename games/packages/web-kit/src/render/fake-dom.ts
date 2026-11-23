/**
 * The few DOM features the glyph view uses, re-created for unit tests under Node (the
 * workspace has no DOM test environment). Test support only: not exported from the
 * package. Animations are recorded and finished by hand, so tests control time.
 */

export interface FakeAnimation {
  readonly element: FakeElement;
  readonly keyframes: readonly Record<string, unknown>[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly finished: Promise<void>;
  readonly state: "running" | "finished" | "cancelled";
  /** Let the animation reach its end. */
  finish(): void;
  cancel(): void;
}

export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  parent: FakeElement | null = null;
  textContent = "";
  /** Present only when the document was created with animations enabled, like `Element.animate`. */
  animate?: (keyframes: Record<string, unknown>[], options: Record<string, unknown>) => FakeAnimation;

  readonly classList = {
    add: (...names: string[]): void => {
      this.setAttribute("class", [...new Set([...this.classes(), ...names])].join(" "));
    },
    remove: (...names: string[]): void => {
      const left = this.classes().filter((name) => !names.includes(name));
      if (left.length === 0) this.removeAttribute("class");
      else this.setAttribute("class", left.join(" "));
    },
    contains: (name: string): boolean => this.classes().includes(name),
  };

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly namespaceURI: string,
    readonly tagName: string,
  ) {
    if (ownerDocument.animationsEnabled) {
      this.animate = (keyframes, options) => ownerDocument.startAnimation(this, keyframes, options);
    }
  }

  classes(): string[] {
    return (this.attributes.get("class") ?? "").split(/\s+/).filter((name) => name.length > 0);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent === null) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  replaceChildren(): void {
    for (const child of [...this.children]) child.remove();
  }

  /** This element and everything below it, in document order. */
  tree(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.tree())];
  }

  /** Descendants carrying the class, in document order. */
  byClass(name: string): FakeElement[] {
    return this.tree().filter((element) => element !== this && element.classList.contains(name));
  }
}

export class FakeDocument {
  readonly animations: FakeAnimation[] = [];

  constructor(readonly animationsEnabled = true) {}

  createElementNS(namespaceURI: string, tagName: string): FakeElement {
    return new FakeElement(this, namespaceURI, tagName);
  }

  startAnimation(
    element: FakeElement,
    keyframes: Record<string, unknown>[],
    options: Record<string, unknown>,
  ): FakeAnimation {
    let state: FakeAnimation["state"] = "running";
    let resolve: () => void = () => undefined;
    let reject: (reason: Error) => void = () => undefined;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Like the real thing, a cancelled animation must not surface as an unhandled rejection.
    finished.catch(() => undefined);
    const animation: FakeAnimation = {
      element,
      keyframes,
      options,
      finished,
      get state() {
        return state;
      },
      finish() {
        if (state !== "running") return;
        state = "finished";
        resolve();
      },
      cancel() {
        if (state === "running") reject(new Error("AbortError"));
        state = "cancelled";
      },
    };
    this.animations.push(animation);
    return animation;
  }
}

/** A detached fake `<svg>` and its document, typed for `createGlyphView`. */
export function createFakeSvg(options: { readonly animations?: boolean } = {}): {
  readonly doc: FakeDocument;
  readonly root: FakeElement;
  readonly svg: SVGSVGElement;
} {
  const doc = new FakeDocument(options.animations ?? true);
  const root = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  return { doc, root, svg: root as unknown as SVGSVGElement };
}
