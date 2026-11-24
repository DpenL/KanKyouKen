/** Static drawings: a component shape on a tile or in a slot, and a structure's frame. */

import type { ComponentTile, Layout, Rect } from "@kankyouken/mechanics/components";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import { loopsPath, missAnchor, slotOutline, stretchBox, tileBox } from "../frame";
import { h, svg } from "./dom";

/** Side of a frame in its own SVG units. */
const FRAME = 100;
/** Room around the frame for the slots' outlines, in the same units. */
const FRAME_MARGIN = 2;
/** Space between neighbouring slots, as a fraction of the frame. */
const SLOT_GAP = 0.035;
/** Room between a slot's outline and the shape stretched into it. */
const SLOT_INSET = 0.035;
/** Side of a mark for a wrongly tried tile, and the most marks shown per slot. */
const MISS_SIDE = 0.13;
const MISS_LIMIT = 4;

function viewBox(rect: Rect): string {
  return [rect.x, rect.y, rect.w, rect.h].map((value) => Math.round(value * 100) / 100).join(" ");
}

function strokePaths(glyph: Glyph): SVGPathElement[] {
  return glyph.strokes.map((stroke) => svg("path", { d: stroke.path }));
}

/** A component shape in a square, aspect ratio kept: what a tray tile shows. */
export function tileShape(glyph: Glyph): SVGSVGElement {
  return svg("svg", { class: "shape", viewBox: viewBox(tileBox(glyph)), "aria-hidden": "true" }, ...strokePaths(glyph));
}

/** A character drawn from the glyph data, so it looks the same whatever fonts the device has. */
export function drawnChar(glyph: Glyph | undefined, char: string, className: string): HTMLElement {
  const box = h("span", { class: className, lang: "ja", role: "img", "aria-label": char });
  if (glyph === undefined) box.textContent = char;
  else box.append(tileShape(glyph));
  return box;
}

/** A component shape inside a rectangle of the frame: stretched over it, or centred with its aspect ratio kept. */
function shapeInFrame(glyph: Glyph, rect: Rect, className: string, stretch: boolean): SVGSVGElement {
  return svg(
    "svg",
    {
      class: className,
      x: rect.x * FRAME,
      y: rect.y * FRAME,
      width: rect.w * FRAME,
      height: rect.h * FRAME,
      viewBox: viewBox(stretch ? stretchBox(glyph) : tileBox(glyph)),
      preserveAspectRatio: stretch ? "none" : null,
    },
    ...strokePaths(glyph),
  );
}

export interface FrameContent {
  /** Tile sitting in each slot, or null. */
  readonly placed: readonly (ComponentTile | null)[];
  /** Tiles that were tried in each slot and were wrong there; empty lists while unknown. */
  readonly misses: readonly (readonly ComponentTile[])[];
}

/**
 * A structure: one outlined shape per slot (`.slot[data-slot]`, a focusable button), the
 * shapes of placed tiles stretched over their slots so the frame previews the
 * character, and small marks for tiles that were wrong in a slot.
 */
export function frameDrawing(layout: Layout, layoutIndex: number, content: FrameContent): SVGSVGElement {
  const root = svg("svg", {
    class: "frame",
    viewBox: `${-FRAME_MARGIN} ${-FRAME_MARGIN} ${FRAME + 2 * FRAME_MARGIN} ${FRAME + 2 * FRAME_MARGIN}`,
  });
  const shapes = svg("g", { class: "frame-shapes" });
  const marks = svg("g", { class: "frame-misses" });
  layout.slots.forEach((slot, index) => {
    const tile = content.placed[index] ?? null;
    root.append(
      svg(
        "g",
        {
          class: "slot",
          "data-layout": layoutIndex,
          "data-slot": index,
          "data-filled": tile !== null ? "true" : "false",
          "data-tile": tile?.id,
          tabindex: 0,
          role: "button",
          "aria-label": `Structure ${layoutIndex + 1}, slot ${index + 1}, ${tile === null ? "empty" : "filled"}`,
        },
        svg("path", { class: "slot-shape", d: loopsPath(slotOutline(slot, SLOT_GAP), FRAME), "fill-rule": "evenodd" }),
      ),
    );
    if (tile !== null) {
      const by = SLOT_GAP / 2 + SLOT_INSET;
      const { rect } = slot;
      shapes.append(
        shapeInFrame(tile.glyph, { x: rect.x + by, y: rect.y + by, w: rect.w - 2 * by, h: rect.h - 2 * by }, "slot-glyph", true),
      );
    }
    const { corner, step } = missAnchor(slot);
    (content.misses[index] ?? []).slice(0, MISS_LIMIT).forEach((missed, n) => {
      const start = SLOT_GAP / 2 + 0.02;
      const x = corner.x + (step.x < 0 ? -start - MISS_SIDE : start) + step.x * n * (MISS_SIDE + 0.015);
      const y = corner.y + start + step.y * n * (MISS_SIDE + 0.015);
      marks.append(
        svg(
          "g",
          { class: "miss", "data-slot": index, "data-tile": missed.id },
          svg("rect", { class: "miss-back", x: x * FRAME, y: y * FRAME, width: MISS_SIDE * FRAME, height: MISS_SIDE * FRAME, rx: 2 }),
          shapeInFrame(missed.glyph, { x, y, w: MISS_SIDE, h: MISS_SIDE }, "miss-glyph", false),
          svg("line", {
            class: "miss-strike",
            x1: x * FRAME,
            y1: (y + MISS_SIDE) * FRAME,
            x2: (x + MISS_SIDE) * FRAME,
            y2: y * FRAME,
          }),
        ),
      );
    });
  });
  root.append(shapes, marks);
  return root;
}
