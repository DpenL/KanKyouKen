/**
 * Default look of a glyph view. The view only builds elements and sets `data-*`
 * attributes; every colour and every visibility rule lives here, so a game restyles by
 * overriding custom properties or by writing its own rules against the same hooks.
 *
 * Hooks (all inside the `<svg class="kk-glyph" data-path-kind="centerline|outline">`):
 *
 *   .kk-layer.kk-layer-<name>[data-layer][data-visible]   grid, ghost, strokes, guide, ink, fx
 *   .kk-grid-frame, .kk-grid-cross                        practice square and centre cross
 *   .kk-ghost-stroke[data-stroke]                         faint full character
 *   .kk-stroke[data-stroke][data-state][data-animating]   hidden | ghost | done | active | error
 *   .kk-dots > .kk-dot[data-stroke][data-dot][data-start][data-touched]
 *   .kk-arrows > .kk-arrow[data-stroke] > .kk-arrow-shaft, .kk-arrow-head, .kk-arrow-label
 *   .kk-dotted[data-stroke] > .kk-dotted-line, .kk-dotted-start
 *   .kk-ink                                               the stroke being drawn
 *   .kk-kept > .kk-ink.kk-ink-kept                        strokes the player drew earlier (free writing)
 *   .kk-ink-flash.kk-ok | .kk-error                       its copy while it flashes (fx layer)
 *   .kk-stroke-anim[data-stroke]                          a stroke while it is being animated (fx layer)
 *
 * Shapes are painted with `currentColor`, so `color` is the one property to set
 * whatever the glyph's path kind (stroked centerlines or filled outlines).
 */

/**
 * The stylesheet. Colours come from five custom properties:
 *
 *   --kk-ink     written strokes, the stroke being drawn and animated strokes (default: the text colour)
 *   --kk-ghost   the faint character to trace over
 *   --kk-guide   grid, dots, dotted line, arrows and stroke numbers
 *   --kk-accent  the stroke in state "active", touched dots, the "ok" flash
 *   --kk-error   strokes in state "error", the "error" flash
 *
 * Their defaults are declared on the root with zero specificity, so any declaration of
 * yours wins, wherever it is in the cascade: on `:root`, on a container, on the SVG.
 * The defaults follow the page's `color-scheme` where the browser supports
 * `light-dark()` and are light-page colours elsewhere. Every rule is scoped with
 * `:where(.kk-glyph)`, which keeps specificity at that of the hook itself.
 */
export const DEFAULT_GLYPH_CSS = `
:where(:root, :host) {
  --kk-ink: currentColor;
  --kk-ghost: #d9dde3;
  --kk-guide: #8792a2;
  --kk-accent: #2f7df6;
  --kk-error: #d93a40;
}
@supports (color: light-dark(#000, #fff)) {
  :where(:root, :host) {
    --kk-ghost: light-dark(#d9dde3, #3a4049);
    --kk-guide: light-dark(#8792a2, #7c8796);
    --kk-accent: light-dark(#2f7df6, #6aa6ff);
    --kk-error: light-dark(#d93a40, #ff7b80);
  }
}

:where(.kk-glyph) {
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
:where(.kk-glyph) .kk-layer[data-visible="false"] {
  display: none;
}

:where(.kk-glyph) .kk-layer-grid {
  color: var(--kk-guide);
  opacity: 0.5;
}
:where(.kk-glyph) .kk-grid-frame,
:where(.kk-glyph) .kk-grid-cross {
  vector-effect: non-scaling-stroke;
  stroke-width: 1px;
}
:where(.kk-glyph) .kk-grid-cross {
  stroke-dasharray: 5 5;
}

:where(.kk-glyph) .kk-layer-ghost {
  color: var(--kk-ghost);
}

:where(.kk-glyph) .kk-stroke {
  color: var(--kk-ink);
}
:where(.kk-glyph) .kk-stroke[data-state="hidden"],
:where(.kk-glyph) .kk-stroke[data-animating="true"] {
  visibility: hidden;
}
:where(.kk-glyph) .kk-stroke[data-state="ghost"] {
  color: var(--kk-ghost);
}
:where(.kk-glyph) .kk-stroke[data-state="active"] {
  color: var(--kk-accent);
}
:where(.kk-glyph) .kk-stroke[data-state="error"] {
  color: var(--kk-error);
}

:where(.kk-glyph) .kk-layer-guide {
  color: var(--kk-guide);
}
:where(.kk-glyph) .kk-dot[data-touched="true"] {
  color: var(--kk-accent);
}
:where(.kk-glyph) .kk-arrow-label {
  font-family: system-ui, sans-serif;
  font-weight: 600;
}

:where(.kk-glyph) .kk-layer-ink,
:where(.kk-glyph) .kk-layer-fx {
  color: var(--kk-ink);
}
:where(.kk-glyph) .kk-ink-flash {
  animation: kk-ink-flash 350ms ease-out forwards;
}
:where(.kk-glyph) .kk-ink-flash.kk-ok {
  color: var(--kk-accent);
}
:where(.kk-glyph) .kk-ink-flash.kk-error {
  color: var(--kk-error);
}
@keyframes kk-ink-flash {
  from { opacity: 1; }
  to { opacity: 0; }
}
`;

const STYLE_ID = "kk-glyph-css";

/**
 * Add the stylesheet to a document once: a `<style id="kk-glyph-css">` at the START of
 * `<head>`, so that styles the app declares later win ties. Calling it again returns the
 * element that is already there and leaves its content alone (even when `css` differs).
 * Apps with their own pipeline can ignore this and bundle `DEFAULT_GLYPH_CSS` themselves.
 */
export function installGlyphCss(doc: Document = document, css: string = DEFAULT_GLYPH_CSS): HTMLStyleElement {
  const existing = doc.getElementById(STYLE_ID);
  if (existing !== null) return existing as HTMLStyleElement;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  doc.head.prepend(style);
  return style;
}
