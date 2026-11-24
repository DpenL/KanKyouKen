/**
 * Pointer capture for drawing: turns mouse, touch and pen gestures on an SVG into
 * `DrawnStroke`s in glyph space, ready for the stroke mechanics.
 *
 * The SVG's viewBox is expected to be in glyph units (as `createGlyphView` sets it), so
 * the screen-to-SVG matrix is all the conversion there is. One stroke is one pen-down to
 * pen-up gesture of one pointer; a second finger, a palm or a mouse joining in while a
 * stroke is being drawn is ignored, and a thumb or palm resting elsewhere on the page
 * does not keep the next finger from writing. This is our own adapter; the research
 * games only fix what a stroke is, not how the browser delivers it.
 */

import type { Point } from "@kankyouken/mechanics/util";
import type { DrawnStroke, StrokeSample } from "@kankyouken/mechanics/stroke";
import { DEFAULT_MIN_DISTANCE, appendSample, finishStroke } from "./samples";

/**
 * Convert viewport coordinates (`event.clientX` / `clientY`) to the SVG's user space,
 * which is glyph space when the viewBox is in glyph units. Uses the inverse of
 * `svg.getScreenCTM()`, so CSS scaling, letterboxing by `preserveAspectRatio`, scrolling
 * and transforms on ancestors are all accounted for.
 *
 * When the SVG is not rendered (no screen matrix: detached or `display: none`) or has
 * no area (matrix not invertible) both coordinates are NaN; `createStrokeCapture` drops
 * such positions.
 */
export function clientToGlyph(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  let inverse: DOMMatrix | null;
  try {
    inverse = svg.getScreenCTM()?.inverse() ?? null;
  } catch {
    inverse = null;
  }
  if (inverse === null) return { x: Number.NaN, y: Number.NaN };
  return {
    x: inverse.a * clientX + inverse.c * clientY + inverse.e,
    y: inverse.b * clientX + inverse.d * clientY + inverse.f,
  };
}

export interface StrokeCaptureHandlers {
  /** The pen landed. `sample` is the first point of the new stroke. */
  onStart?(sample: StrokeSample): void;
  /** A position was kept. `stroke` is everything so far, `sample` included; a new array every time. */
  onMove?(sample: StrokeSample, stroke: DrawnStroke): void;
  /** The pen lifted. `stroke` always ends where it lifted. */
  onEnd?(stroke: DrawnStroke): void;
  /** The stroke in progress was abandoned (browser took the pointer away, or `cancel()`); discard it. */
  onCancel?(): void;
}

export interface StrokeCaptureOptions {
  /** Distance in glyph units between kept samples. Default `DEFAULT_MIN_DISTANCE` (4). */
  readonly minDistance?: number;
  /**
   * Asked when a pointer goes down; returning false ignores that gesture entirely.
   * Not asked again during a stroke: a stroke that started runs to its end.
   */
  readonly enabled?: () => boolean;
}

export interface StrokeCapture {
  /** Abandon the stroke in progress, if any, and tell `onCancel`. For time-outs and the like. */
  cancel(): void;
  /**
   * Remove the listeners and restore the target's previous `touch-action`. A stroke in
   * progress is abandoned without calling any handler. Safe to call twice.
   */
  dispose(): void;
}

/**
 * Listen for drawing gestures on `target` and report them as strokes in glyph space.
 *
 * - Sets `touch-action: none` on the target so that drawing does not scroll or zoom the
 *   page, and captures the pointer so the stroke keeps coming when the pen leaves the
 *   SVG.
 * - Any pointer pressing its main button on the target starts a stroke when none is
 *   being drawn (no right mouse button, no pen eraser). It need not be the browser's
 *   primary pointer: with a thumb or palm resting anywhere on the page, the finger that
 *   writes never is. While a stroke is being drawn every other pointer is ignored.
 * - Positions come from `getCoalescedEvents()` when the browser has it, so fast strokes
 *   keep their shape; they are thinned with `appendSample`. Each sample's `t` is its
 *   event's `timeStamp` (milliseconds, monotonic).
 * - On pen-up the final position is always added (`finishStroke`), then `onEnd` gets the
 *   whole stroke. A tap gives a one-sample stroke.
 * - `pointercancel`, or losing pointer capture any other way, calls `onCancel`. So does a
 *   new primary pointer of the same kind going down while a primary pointer's stroke is
 *   still open: that can only mean the pen-up was missed, and the new gesture then
 *   starts a fresh stroke.
 * - Positions that cannot be converted (see `clientToGlyph`) are skipped; a gesture that
 *   starts on such a position is ignored.
 *
 * Exceptions thrown by handlers are not caught.
 */
export function createStrokeCapture(
  target: SVGSVGElement,
  handlers: StrokeCaptureHandlers,
  options: StrokeCaptureOptions = {},
): StrokeCapture {
  const minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE;
  const previousTouchAction = target.style.touchAction;
  target.style.touchAction = "none";

  let active: { readonly pointerId: number; readonly pointerType: string; readonly primary: boolean } | null = null;
  let stroke: DrawnStroke = [];
  let disposed = false;

  const sampleOf = (event: PointerEvent, fallbackTime: number): StrokeSample => {
    const { x, y } = clientToGlyph(target, event.clientX, event.clientY);
    // Some browsers have shipped coalesced events without a usable timestamp.
    return { x, y, t: event.timeStamp > 0 ? event.timeStamp : fallbackTime };
  };

  const abandon = (): boolean => {
    if (active === null) return false;
    const { pointerId } = active;
    active = null;
    stroke = [];
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // The pointer is already gone; there is nothing left to release.
    }
    return true;
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (active !== null) {
      // Two primary pointers of one kind cannot be down together, so the first one's pen-up was
      // missed. Anything else is a second finger, a palm or another device joining in.
      if (!event.isPrimary || !active.primary || active.pointerType !== event.pointerType) return;
      abandon();
      handlers.onCancel?.();
    }
    if (options.enabled !== undefined && !options.enabled()) return;
    const sample = sampleOf(event, event.timeStamp);
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return;

    active = { pointerId: event.pointerId, pointerType: event.pointerType, primary: event.isPrimary };
    stroke = [sample];
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a convenience: without it the stroke simply ends at the SVG's edge.
    }
    event.preventDefault();
    handlers.onStart?.(sample);
  };

  const onMove = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    for (const piece of coalesced.length > 0 ? coalesced : [event]) {
      const next = appendSample(stroke, sampleOf(piece, event.timeStamp), minDistance);
      if (next === stroke) continue;
      stroke = next;
      handlers.onMove?.(next[next.length - 1]!, next);
      // A handler may have cancelled or disposed the capture.
      if (stroke !== next) return;
    }
  };

  const onUp = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    const finished = finishStroke(stroke, sampleOf(event, event.timeStamp));
    abandon();
    handlers.onEnd?.(finished);
  };

  const onLost = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    abandon();
    handlers.onCancel?.();
  };

  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onLost);
  target.addEventListener("lostpointercapture", onLost);

  return {
    cancel(): void {
      if (abandon()) handlers.onCancel?.();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onLost);
      target.removeEventListener("lostpointercapture", onLost);
      abandon();
      target.style.touchAction = previousTouchAction;
    },
  };
}
