/** Learn mode: a look at the character before it has to be built. */

import type { App } from "./app";
import { button, h } from "./dom";
import { createGlyphBoard } from "./glyph-board";

const STROKE_MS = 260;
const GAP_MS = 70;

export interface PreviewOptions {
  readonly char: string;
  readonly progress: string;
  quit(): void;
  next(): void;
}

export function previewScreen(app: App, options: PreviewOptions): { screen: HTMLElement; leave(): void } {
  const glyph = app.content.glyphs.get(options.char)!;
  const entry = app.content.lexicon.get(options.char);
  const board = createGlyphBoard(glyph, `The character for ${entry?.meaning ?? options.char}`);
  void board.write(STROKE_MS, GAP_MS);
  const screen = h(
    "main",
    { class: "screen preview" },
    h(
      "header",
      { class: "bar" },
      button("← Decks", { class: "ghost small", "data-action": "quit" }, options.quit),
      h("span", { class: "bar-progress" }, options.progress),
    ),
    h("p", { class: "eyebrow" }, "Remember this character"),
    board.element,
    h("h1", { class: "meaning" }, entry?.meaning ?? ""),
    h("p", { class: "reading", lang: "ja" }, entry?.reading ?? ""),
    h("div", { class: "actions" }, button("Continue", { class: "primary", "data-action": "continue" }, options.next)),
  );
  return { screen, leave: () => board.dispose() };
}
