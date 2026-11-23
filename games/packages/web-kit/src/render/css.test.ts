import { describe, expect, it } from "vitest";
import { DEFAULT_GLYPH_CSS, installGlyphCss } from "./css";

interface StyleStub {
  tagName: string;
  id: string;
  textContent: string;
}

function createDocumentStub() {
  const head: StyleStub[] = [{ tagName: "link", id: "app-styles", textContent: "" }];
  const doc = {
    head: { prepend: (element: StyleStub) => void head.unshift(element) },
    createElement: (tagName: string): StyleStub => ({ tagName, id: "", textContent: "" }),
    getElementById: (id: string): StyleStub | null => head.find((element) => element.id === id) ?? null,
  };
  return { head, doc: doc as unknown as Document };
}

describe("DEFAULT_GLYPH_CSS", () => {
  it("declares a default for each of the five colours and uses every one", () => {
    for (const name of ["--kk-ink", "--kk-ghost", "--kk-guide", "--kk-accent", "--kk-error"]) {
      expect(DEFAULT_GLYPH_CSS, name).toMatch(new RegExp(`${name}:\\s*[^;]+;`));
      expect(DEFAULT_GLYPH_CSS, name).toContain(`var(${name})`);
    }
  });

  it("declares the defaults where any app rule overrides them", () => {
    const declarations = [...DEFAULT_GLYPH_CSS.matchAll(/([^{}]+)\{[^{}]*--kk-ink:/g)].map((m) => m[1]!.trim());
    expect(declarations).toEqual([":where(:root, :host)"]);
  });

  it("has a rule for every stroke state that needs one and hides hidden strokes", () => {
    for (const state of ["hidden", "ghost", "active", "error"]) {
      expect(DEFAULT_GLYPH_CSS).toContain(`.kk-stroke[data-state="${state}"]`);
    }
    expect(DEFAULT_GLYPH_CSS).toMatch(/\[data-state="hidden"\][^{]*\{\s*visibility: hidden;/);
    expect(DEFAULT_GLYPH_CSS).toMatch(/\.kk-layer\[data-visible="false"\]\s*\{\s*display: none;/);
  });

  it("keeps every rule scoped to the view and has balanced braces", () => {
    const selectors = [...DEFAULT_GLYPH_CSS.matchAll(/(^|\})\s*([^{}@]+)\{/g)]
      .flatMap((match) => match[2]!.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !["from", "to"].includes(selector));
    expect(selectors.length).toBeGreaterThan(15);
    const allowed = (selector: string): boolean =>
      selector === ":where(:root" || selector === ":host)" || selector.startsWith(":where(.kk-glyph)");
    for (const selector of selectors) expect(allowed(selector), selector).toBe(true);
    expect(DEFAULT_GLYPH_CSS.split("{").length).toBe(DEFAULT_GLYPH_CSS.split("}").length);
  });
});

describe("installGlyphCss", () => {
  it("puts the stylesheet first in the head", () => {
    const { head, doc } = createDocumentStub();
    const style = installGlyphCss(doc) as unknown as StyleStub;
    expect(head.map((element) => element.id)).toEqual(["kk-glyph-css", "app-styles"]);
    expect(style.tagName).toBe("style");
    expect(style.textContent).toBe(DEFAULT_GLYPH_CSS);
  });

  it("installs once per document and keeps what is there", () => {
    const { head, doc } = createDocumentStub();
    const first = installGlyphCss(doc, ".kk-glyph { color: red; }");
    const second = installGlyphCss(doc);
    expect(second).toBe(first);
    expect(head).toHaveLength(2);
    expect(first.textContent).toBe(".kk-glyph { color: red; }");
  });
});
