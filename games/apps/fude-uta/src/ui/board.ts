import type { GlyphMelody } from "@kankyouken/mechanics/melody";
import type { StrokeCaptureHandlers } from "@kankyouken/web-kit/input";
import { createStrokeCapture } from "@kankyouken/web-kit/input";
import type { GlyphView } from "@kankyouken/web-kit/render";
import { createGlyphView } from "@kankyouken/web-kit/render";
import type { ToneColour } from "../palette";
import { toneOf } from "../palette";
import { el } from "./dom";

/** The writing square: a glyph view plus pen capture. */
export interface Board {
  readonly el: HTMLElement;
  readonly view: GlyphView;
  /** Whether a pen-down starts a stroke. */
  enabled: boolean;
  /** Who hears about the pen; null ignores it. */
  pen: StrokeCaptureHandlers | null;
  /** The colour touched dots take: that of the component being written. */
  setTone(tone: ToneColour | null): void;
  /** Colour every stroke by its component's timbre; null goes back to plain ink. */
  tint(melody: GlyphMelody | null): void;
  /** Let a stroke that is on show (written, or part of the faint character) swell for as long as its note sounds. */
  pulse(stroke: number, durationMs: number): void;
  /** The short settle of a stroke that was just accepted. */
  settle(stroke: number): void;
  /** Draw the eye to the start dot on show (a hint was given). */
  beckon(): void;
  destroy(): void;
}

const SETTLE_MS = 260;
const BECKON_MS = 700;

export function createBoard(): Board {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Writing area");
  const root = el("div", { class: "board" });
  root.append(svg);
  const view = createGlyphView(svg, { padding: 0.04, strokeWidth: 0.05 });

  /** Mark an element for a while; re-marking restarts the CSS animation. */
  const mark = (element: SVGElement, attribute: string, durationMs: number): void => {
    element.removeAttribute(attribute);
    element.getBoundingClientRect();
    element.style.setProperty("--fu-duration", `${Math.round(durationMs)}ms`);
    element.setAttribute(attribute, "true");
    window.setTimeout(() => {
      if (element.isConnected) element.removeAttribute(attribute);
    }, durationMs);
  };

  const hasStroke = (stroke: number): boolean => view.glyph !== null && stroke >= 0 && stroke < view.glyph.strokes.length;

  const board: Board = {
    el: root,
    view,
    enabled: false,
    pen: null,
    setTone(tone) {
      if (tone === null) delete root.dataset["tone"];
      else root.dataset["tone"] = tone;
    },
    tint(melody) {
      const count = view.glyph?.strokes.length ?? 0;
      for (let i = 0; i < count; i++) {
        const timbre = melody?.strokes[i]?.timbre;
        const element = view.strokeElement(i);
        if (timbre === undefined) element.removeAttribute("data-tone");
        else element.setAttribute("data-tone", toneOf(timbre));
      }
    },
    pulse(stroke, durationMs) {
      if (!hasStroke(stroke)) return;
      mark(view.strokeElement(stroke), "data-pulse", durationMs);
      // Where the faint character is on show, its stroke answers too; a hidden stroke gives nothing away.
      const ghost = svg.querySelector<SVGElement>(`.kk-ghost-stroke[data-stroke="${stroke}"]`);
      if (ghost !== null) mark(ghost, "data-pulse", durationMs);
    },
    settle(stroke) {
      if (hasStroke(stroke)) mark(view.strokeElement(stroke), "data-settle", SETTLE_MS);
    },
    beckon: () => mark(svg, "data-beckon", BECKON_MS),
    destroy() {
      capture.dispose();
      view.destroy();
      root.remove();
    },
  };

  const capture = createStrokeCapture(
    svg,
    {
      onStart: (sample) => board.pen?.onStart?.(sample),
      onMove: (sample, stroke) => board.pen?.onMove?.(sample, stroke),
      onEnd: (stroke) => board.pen?.onEnd?.(stroke),
      onCancel: () => board.pen?.onCancel?.(),
    },
    { enabled: () => board.enabled && board.pen !== null },
  );
  return board;
}
