/** A whole character on a pale wooden board, drawn stroke by stroke. */

import type { Glyph } from "@kankyouken/mechanics/glyph";
import { createGlyphView, type GlyphView } from "@kankyouken/web-kit/render";
import { h, prefersReducedMotion, svg } from "./dom";

export interface GlyphBoard {
  readonly element: HTMLElement;
  readonly view: GlyphView;
  /** Draw every stroke in turn at a steady pace; resolves when the character is complete. */
  write(strokeMs: number, gapMs: number): Promise<void>;
  /** Draw one stroke over `durationMs` in a colour of its own and leave it on the board. */
  writeStroke(index: number, durationMs: number, color: string): Promise<void>;
  dispose(): void;
}

export function createGlyphBoard(glyph: Glyph, label: string): GlyphBoard {
  const drawing = svg("svg", { class: "glyph-board-svg", role: "img", "aria-label": label });
  const element = h("div", { class: "glyph-board" }, drawing);
  const view = createGlyphView(drawing, { padding: 0.08, strokeWidth: 0.042 });
  view.setGlyph(glyph);
  let disposed = false;

  return {
    element,
    view,
    async write(strokeMs, gapMs) {
      if (!prefersReducedMotion()) {
        await view.animateStrokes(
          glyph.strokes.map((_, index) => index),
          strokeMs,
          gapMs,
        );
      }
      if (!disposed) view.setAllStrokes("done");
    },
    async writeStroke(index, durationMs, color) {
      const own = view.strokeElement(index);
      own.style.color = color;
      if (!prefersReducedMotion()) {
        const done = view.animateStroke(index, durationMs);
        drawing.querySelector<SVGElement>(`.kk-stroke-anim[data-stroke="${index}"]`)?.style.setProperty("color", color);
        await done;
      }
      if (!disposed) view.setStrokeState(index, "done");
    },
    dispose() {
      disposed = true;
      view.destroy();
    },
  };
}
