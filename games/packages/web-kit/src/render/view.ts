/**
 * An SVG view of one glyph, built for writing games: a practice grid, the faint
 * character to trace over, the strokes as they get written, hints for the next stroke
 * (dotted spine, checkpoint dots, numbered arrows), the ink under the player's pen and
 * stroke animations.
 *
 * The view owns structure and geometry only. It never sets a colour: strokes carry a
 * `data-state`, layers a `data-visible`, and a stylesheet (`DEFAULT_GLYPH_CSS`, or the
 * game's own) decides what that looks like. Shapes are painted with `currentColor`.
 * Plain DOM, no dependencies; elements are built with `createElementNS` and glyph data
 * only ever reaches the document through `setAttribute` and `textContent`.
 *
 * The hints are the trace guides of the Radical Tunes studies (numbered direction arrows
 * on the whole character, the next stroke as a dotted line with a larger start dot, a
 * faint outline, nothing) plus the checkpoint dots of dot tracing; how each is drawn
 * here is our own design. A game maps `TraceGuide` onto the view like this:
 *
 *   "arrows"   showGhost(true) + showArrows(every stroke)
 *   "dotted"   showGhost(false) + showDotted(next stroke)
 *   "outline"  showGhost(true)
 *   "none"     showGhost(false)
 *
 * and the two hint levels as a one-dot `showDots` track (the start dot alone) and
 * `showDotted` or stroke state "ghost" (the whole stroke).
 */

import type { Glyph, GlyphStroke } from "@kankyouken/mechanics/glyph";
import type { DotTrack } from "@kankyouken/mechanics/stroke";
import { polylineLength } from "@kankyouken/mechanics/util";
import type { Point } from "@kankyouken/mechanics/util";
import {
  DEFAULT_PADDING,
  DEFAULT_STROKE_WIDTH,
  arrowGeometry,
  dottedDash,
  formatNumber,
  glyphViewBox,
  pointsAttribute,
  polylinePath,
  revealDash,
  viewBoxAttribute,
} from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The view's layers, bottom to top. */
export const GLYPH_LAYERS = ["grid", "ghost", "strokes", "guide", "ink", "fx"] as const;
export type GlyphLayer = (typeof GLYPH_LAYERS)[number];

/**
 * How one stroke of the "strokes" layer is shown (the stylesheet has the last word):
 * "hidden" not at all, "ghost" faintly, "done" as written ink, "active" highlighted,
 * "error" as a mistake.
 */
export type StrokeState = "hidden" | "ghost" | "done" | "active" | "error";

export interface GlyphViewOptions {
  /** Margin around the glyph square, as a fraction of the glyph size. Default 0.06. */
  readonly padding?: number;
  /** Width of centerline strokes, as a fraction of the glyph size. Hint sizes follow it. Default 0.045. */
  readonly strokeWidth?: number;
  /** How long `flashInk` keeps the flashing copy before removing it. Default 350 (the default stylesheet's fade). */
  readonly flashMs?: number;
}

export interface DotDisplayOptions {
  /**
   * Draw each track's first dot larger and mark it `data-start`. Default true. Turn it
   * off for a free coverage test, where the start dot would give the direction away.
   */
  readonly markStart?: boolean;
}

export interface GlyphView {
  readonly svg: SVGSVGElement;
  /** The glyph on show, or null. */
  readonly glyph: Glyph | null;

  /**
   * Show another glyph, or nothing. Sets the viewBox from the glyph's size and the
   * padding, rebuilds the grid, the ghost and one element per stroke (all strokes start
   * "hidden"), and resets everything transient: hints, ink, flashes, animations (their
   * promises resolve). Whether the ghost layer is visible is a setting of the view and
   * survives. With null the grid and viewBox stay as they were, so the practice square
   * does not jump between items. Throws a RangeError for a glyph whose size is not a
   * positive number, leaving the view untouched.
   */
  setGlyph(glyph: Glyph | null): void;

  /** Set one stroke's `data-state`. An index that is not a stroke of the glyph is ignored. */
  setStrokeState(index: number, state: StrokeState): void;
  /** Set every stroke's `data-state`. */
  setAllStrokes(state: StrokeState): void;
  /** Show or hide the faint full character. Hidden until asked for, so a recall task can never leak it. */
  showGhost(visible: boolean): void;

  /**
   * Show the checkpoint dots of one stroke in the guide layer, replacing any dots shown
   * before; null removes them. `touched[d]` marks dot d as `data-touched="true"`. Calling
   * this again for the same track only updates attributes, so it is cheap to call on
   * every hit. Dots with coordinates that are not finite are skipped. Without a glyph
   * nothing is shown.
   */
  showDots(track: DotTrack | null, touched?: readonly boolean[], options?: DotDisplayOptions): void;
  /**
   * Show the dots of several strokes at once (free dot tracing). `touched` is indexed by
   * STROKE index, like `DotTraceState.touched`.
   */
  showAllDots(
    tracks: readonly DotTrack[],
    touched?: readonly (readonly boolean[] | undefined)[],
    options?: DotDisplayOptions,
  ): void;

  /**
   * Show a stroke-order hint for one stroke: its number (index + 1) just behind its
   * start and an arrow setting off along it. Replaces any arrows shown before; null, or
   * an index that is not a stroke, removes them.
   */
  showArrow(index: number | null): void;
  /** The same for several strokes at once (a stroke-order chart). Unknown and repeated indices are skipped. */
  showArrows(indices: readonly number[]): void;

  /**
   * Show a stroke's spine as a dotted line with a larger dot where it starts. Replaces
   * the previous dotted line; null, or an index that is not a stroke, removes it.
   */
  showDotted(index: number | null): void;

  /**
   * Draw a stroke progressively over `durationMs` and resolve when it is done. The
   * moving copy lives in the fx layer (`.kk-stroke-anim`); the stroke's own element is
   * marked `data-animating="true"` meanwhile (hidden by the default stylesheet) and
   * keeps its state, so set the state you want when the promise resolves.
   *
   * The promise never rejects. It resolves at once, without drawing, when the index is
   * not a stroke, when `durationMs` is not positive, or when the browser has no Web
   * Animations API. It also resolves when the animation is cancelled, so a loop that
   * awaits one stroke after another must check for itself whether to go on; use
   * `animateStrokes` for a sequence that stops as a whole.
   */
  animateStroke(index: number, durationMs: number): Promise<void>;
  /**
   * Draw several strokes one after another, each over `durationMs` with `gapMs` between
   * them (default 0), as ONE animation: finished strokes stay drawn until the last one
   * is done, and cancelling stops all of them. Unknown and repeated indices are skipped.
   * A stroke takes part in one animation at a time; starting another cancels the earlier.
   */
  animateStrokes(indices: readonly number[], durationMs: number, gapMs?: number): Promise<void>;
  /** Stop every stroke animation now. Their promises resolve; strokes show their state again. */
  cancelAnimations(): void;

  /**
   * Show the stroke under the player's pen as a polyline; null or an empty list clears
   * it (kept strokes stay). A single point shows as a dot.
   */
  setInk(points: readonly Point[] | null): void;
  /**
   * Leave the ink just drawn on the page as a finished stroke (`.kk-ink-kept`, in the ink
   * layer) and start with fresh ink. For free writing from memory, where the player's
   * own strokes must stay visible and no reference stroke may be revealed. Does nothing
   * when there is no ink.
   */
  keepInk(): void;
  /** Remove the live ink and every kept stroke. `setGlyph` does this too. */
  clearInk(): void;
  /**
   * Give feedback on the ink just drawn and clear it: the ink is handed over to a copy
   * in the fx layer with class `kk-ink-flash` plus `kk-ok` or `kk-error`, which is
   * removed after `flashMs`. The live ink is free at once, so the next stroke can start
   * during the flash. Does nothing when there is no ink.
   */
  flashInk(kind: "ok" | "error"): void;

  /** The element of a stroke in the "strokes" layer. Throws a RangeError when there is no such stroke. */
  strokeElement(index: number): SVGElement;
  /** A layer's group, for games that add their own effects or restyle a whole layer. */
  layer(name: GlyphLayer): SVGGElement;

  /**
   * Remove everything the view added and restore the SVG's previous viewBox. Animations
   * resolve. The view is inert afterwards.
   */
  destroy(): void;
}

// Sizes of the hints, as multiples of the stroke width.
const INK_WIDTH = 0.8;
const DOT_RADIUS = 0.38;
const START_DOT_RADIUS = 0.62;
const DOTTED_WIDTH = 0.3;
const DOTTED_SPACING = 0.9;
const DOTTED_START_RADIUS = 0.55;
const ARROW_SHAFT_WIDTH = 0.25;
// As fractions of the glyph size.
const LABEL_FONT_SIZE = 0.075;
const GRID_LINE_WIDTH = 0.004;
/** Brush that reveals an outline stroke along its median; wide enough for the fattest stroke. */
const OUTLINE_BRUSH_WIDTH = 0.2;

const DEFAULT_FLASH_MS = 350;

type Attributes = Readonly<Record<string, string>>;

interface AnimationRun {
  readonly indices: readonly number[];
  readonly nodes: SVGElement[];
  readonly targets: SVGElement[];
  readonly animations: Animation[];
  readonly resolve: () => void;
  done: boolean;
}

interface Flash {
  readonly element: SVGElement;
  readonly timer: ReturnType<typeof setTimeout>;
}

let nextViewId = 0;

const linePaint = (width: number): Attributes => ({
  fill: "none",
  stroke: "currentColor",
  "stroke-width": formatNumber(width),
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
});

const FILL_PAINT: Attributes = { fill: "currentColor", stroke: "none" };

const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** A finite option value above `min` (or equal to it, when a minimum is given). */
const usable = (value: number | undefined, min?: number): value is number =>
  value !== undefined && Number.isFinite(value) && (min === undefined ? value > 0 : value >= min);

/** `pathLength` lets dash patterns be computed from the median instead of measuring the path in the DOM. */
const lengthAttribute = (length: number): Attributes =>
  Number.isFinite(length) && length > 0 ? { pathLength: formatNumber(length) } : {};

/**
 * Turn an `<svg>` into a glyph view. The element gets the class `kk-glyph` and six layer
 * groups (see `GLYPH_LAYERS`); nothing is drawn until `setGlyph`. Inject
 * `DEFAULT_GLYPH_CSS` (or call `installGlyphCss`) once per document, otherwise states
 * and layers have no look. Options that are not positive finite numbers fall back to
 * their defaults (zero is allowed for `padding` and `flashMs`).
 */
export function createGlyphView(svg: SVGSVGElement, options: GlyphViewOptions = {}): GlyphView {
  const doc = svg.ownerDocument;
  const viewId = nextViewId++;
  const padding = usable(options.padding, 0) ? options.padding : DEFAULT_PADDING;
  const widthFraction = usable(options.strokeWidth) ? options.strokeWidth : DEFAULT_STROKE_WIDTH;
  const flashMs = usable(options.flashMs, 0) ? options.flashMs : DEFAULT_FLASH_MS;
  const previousViewBox = svg.getAttribute("viewBox");

  const create = <K extends keyof SVGElementTagNameMap>(
    name: K,
    attributes: Attributes,
    parent?: SVGElement,
  ): SVGElementTagNameMap[K] => {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent?.appendChild(element);
    return element;
  };

  svg.classList.add("kk-glyph");
  const layers = {} as Record<GlyphLayer, SVGGElement>;
  for (const name of GLYPH_LAYERS) {
    layers[name] = create("g", { class: `kk-layer kk-layer-${name}`, "data-layer": name }, svg);
  }
  layers.ghost.setAttribute("data-visible", "false");
  const dottedGroup = create("g", { class: "kk-dotted" }, layers.guide);
  const dotsGroup = create("g", { class: "kk-dots" }, layers.guide);
  const arrowsGroup = create("g", { class: "kk-arrows" }, layers.guide);
  const keptGroup = create("g", { class: "kk-kept" }, layers.ink);
  const ink = create("polyline", { class: "kk-ink", points: "", ...linePaint(0) }, layers.ink);

  let glyph: Glyph | null = null;
  let strokeWidth = 0;
  let strokeEls: SVGPathElement[] = [];
  let dotEls: SVGCircleElement[] = [];
  let destroyed = false;
  const runs = new Set<AnimationRun>();
  const flashes = new Set<Flash>();

  const finishRun = (run: AnimationRun): void => {
    if (run.done) return;
    run.done = true;
    runs.delete(run);
    for (const animation of run.animations) {
      try {
        animation.cancel();
      } catch {
        // Already gone with its element.
      }
    }
    for (const node of run.nodes) node.remove();
    for (const target of run.targets) target.removeAttribute("data-animating");
    run.resolve();
  };

  const cancelAnimations = (): void => {
    for (const run of [...runs]) finishRun(run);
  };

  const clearFlashes = (): void => {
    for (const flash of flashes) {
      clearTimeout(flash.timer);
      flash.element.remove();
    }
    flashes.clear();
  };

  const clearInk = (): void => {
    ink.setAttribute("points", "");
    keptGroup.replaceChildren();
  };

  const clearGuides = (): void => {
    dottedGroup.replaceChildren();
    dottedGroup.removeAttribute("data-stroke");
    dotsGroup.replaceChildren();
    dotEls = [];
    arrowsGroup.replaceChildren();
  };

  const buildGrid = (size: number): void => {
    const line = { class: "kk-grid-cross", ...linePaint(size * GRID_LINE_WIDTH) };
    const full = formatNumber(size);
    const half = formatNumber(size / 2);
    layers.grid.replaceChildren();
    create(
      "rect",
      { class: "kk-grid-frame", x: "0", y: "0", width: full, height: full, ...linePaint(size * GRID_LINE_WIDTH) },
      layers.grid,
    );
    create("line", { ...line, x1: half, y1: "0", x2: half, y2: full }, layers.grid);
    create("line", { ...line, x1: "0", y1: half, x2: full, y2: half }, layers.grid);
  };

  const renderDots = (
    tracks: readonly DotTrack[],
    touchedOf: (track: DotTrack) => readonly boolean[] | undefined,
    markStart: boolean,
  ): void => {
    let used = 0;
    for (const track of glyph === null ? [] : tracks) {
      const touched = touchedOf(track);
      track.dots.forEach((dot, d) => {
        if (!isFinitePoint(dot)) return;
        let element = dotEls[used];
        if (element === undefined) {
          element = create("circle", { class: "kk-dot", fill: "currentColor" }, dotsGroup);
          dotEls.push(element);
        }
        used++;
        const isStart = markStart && d === 0;
        element.setAttribute("cx", formatNumber(dot.x));
        element.setAttribute("cy", formatNumber(dot.y));
        element.setAttribute("r", formatNumber(strokeWidth * (isStart ? START_DOT_RADIUS : DOT_RADIUS)));
        element.setAttribute("data-stroke", String(track.stroke));
        element.setAttribute("data-dot", String(d));
        element.setAttribute("data-touched", touched?.[d] === true ? "true" : "false");
        if (isStart) element.setAttribute("data-start", "true");
        else element.removeAttribute("data-start");
      });
    }
    for (const extra of dotEls.splice(used)) extra.remove();
  };

  const showArrows = (indices: readonly number[]): void => {
    arrowsGroup.replaceChildren();
    if (glyph === null) return;
    const seen = new Set<number>();
    for (const index of indices) {
      const stroke = glyph.strokes[index];
      if (stroke === undefined || seen.has(index)) continue;
      seen.add(index);
      const arrow = arrowGeometry(stroke.median, glyph.size);
      if (arrow === null) continue;
      const group = create("g", { class: "kk-arrow", "data-stroke": String(index) }, arrowsGroup);
      const [from, to] = arrow.shaft;
      create(
        "line",
        {
          class: "kk-arrow-shaft",
          x1: formatNumber(from.x),
          y1: formatNumber(from.y),
          x2: formatNumber(to.x),
          y2: formatNumber(to.y),
          ...linePaint(strokeWidth * ARROW_SHAFT_WIDTH),
        },
        group,
      );
      create("polygon", { class: "kk-arrow-head", points: pointsAttribute(arrow.head), ...FILL_PAINT }, group);
      const label = create(
        "text",
        {
          class: "kk-arrow-label",
          x: formatNumber(arrow.label.x),
          y: formatNumber(arrow.label.y),
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-size": formatNumber(glyph.size * LABEL_FONT_SIZE),
          ...FILL_PAINT,
        },
        group,
      );
      label.textContent = String(index + 1);
    }
  };

  /** The moving copy of a stroke: nodes to add to the fx layer, and the path whose dash offset is animated. */
  const buildOverlay = (
    shown: Glyph,
    stroke: GlyphStroke,
    index: number,
  ): { readonly nodes: SVGElement[]; readonly brush: SVGPathElement; readonly from: number } => {
    const length = polylineLength(stroke.median);
    const outline = shown.pathKind === "outline";
    const width = outline ? shown.size * OUTLINE_BRUSH_WIDTH : strokeWidth;
    const dash = revealDash(length, width / 2);
    const nodes: SVGElement[] = [];
    const clipId = `kk-clip-${viewId}-${index}`;
    if (outline) {
      // The outline cannot be drawn progressively itself: sweep a wide brush along the
      // median and let the outline clip it.
      const clip = create("clipPath", { id: clipId }, layers.fx);
      create("path", { d: stroke.path }, clip);
      nodes.push(clip);
    }
    const brush = create(
      "path",
      {
        class: "kk-stroke-anim",
        "data-stroke": String(index),
        d: outline ? polylinePath(stroke.median) : stroke.path,
        ...(outline ? { "clip-path": `url(#${clipId})` } : {}),
        ...linePaint(width),
        ...lengthAttribute(length),
        "stroke-dasharray": dash.dasharray,
        "stroke-dashoffset": formatNumber(dash.from),
      },
      layers.fx,
    );
    nodes.push(brush);
    return { nodes, brush, from: dash.from };
  };

  const animateStrokes = (indices: readonly number[], durationMs: number, gapMs = 0): Promise<void> => {
    const shown = glyph;
    if (shown === null || !(durationMs > 0) || !Number.isFinite(durationMs)) return Promise.resolve();
    const wanted = [...new Set(indices)].filter((index) => shown.strokes[index] !== undefined);
    if (wanted.length === 0) return Promise.resolve();
    for (const run of [...runs]) {
      if (run.indices.some((index) => wanted.includes(index))) finishRun(run);
    }
    const gap = Number.isFinite(gapMs) && gapMs > 0 ? gapMs : 0;

    return new Promise<void>((resolve) => {
      const run: AnimationRun = { indices: wanted, nodes: [], targets: [], animations: [], resolve, done: false };
      runs.add(run);
      wanted.forEach((index, position) => {
        const overlay = buildOverlay(shown, shown.strokes[index]!, index);
        run.nodes.push(...overlay.nodes);
        const target = strokeEls[index];
        if (target !== undefined) {
          target.setAttribute("data-animating", "true");
          run.targets.push(target);
        }
        if (typeof overlay.brush.animate !== "function") return;
        run.animations.push(
          overlay.brush.animate([{ strokeDashoffset: overlay.from }, { strokeDashoffset: 0 }], {
            duration: durationMs,
            delay: position * (durationMs + gap),
            easing: "linear",
            fill: "both",
          }),
        );
      });
      const last = run.animations[run.animations.length - 1];
      if (last === undefined) {
        finishRun(run);
        return;
      }
      const end = (): void => finishRun(run);
      last.finished.then(end, end);
    });
  };

  return {
    svg,
    get glyph() {
      return glyph;
    },

    setGlyph(next: Glyph | null): void {
      if (destroyed) return;
      const box = next === null ? null : glyphViewBox(next.size, padding);
      cancelAnimations();
      clearFlashes();
      clearGuides();
      clearInk();
      layers.ghost.replaceChildren();
      layers.strokes.replaceChildren();
      strokeEls = [];
      glyph = next;
      if (next === null || box === null) {
        svg.removeAttribute("data-path-kind");
        return;
      }

      strokeWidth = widthFraction * next.size;
      svg.setAttribute("viewBox", viewBoxAttribute(box));
      svg.setAttribute("data-path-kind", next.pathKind);
      buildGrid(next.size);
      ink.setAttribute("stroke-width", formatNumber(strokeWidth * INK_WIDTH));
      const paint = next.pathKind === "outline" ? FILL_PAINT : linePaint(strokeWidth);
      next.strokes.forEach((stroke, index) => {
        const shared = { "data-stroke": String(index), d: stroke.path, ...paint };
        create("path", { class: "kk-ghost-stroke", ...shared }, layers.ghost);
        strokeEls.push(create("path", { class: "kk-stroke", "data-state": "hidden", ...shared }, layers.strokes));
      });
    },

    setStrokeState(index: number, state: StrokeState): void {
      strokeEls[index]?.setAttribute("data-state", state);
    },

    setAllStrokes(state: StrokeState): void {
      for (const element of strokeEls) element.setAttribute("data-state", state);
    },

    showGhost(visible: boolean): void {
      layers.ghost.setAttribute("data-visible", visible ? "true" : "false");
    },

    showDots(track, touched, options = {}): void {
      renderDots(track === null ? [] : [track], () => touched, options.markStart ?? true);
    },

    showAllDots(tracks, touched, options = {}): void {
      renderDots(tracks, (track) => touched?.[track.stroke], options.markStart ?? true);
    },

    showArrow(index: number | null): void {
      showArrows(index === null ? [] : [index]);
    },

    showArrows,

    showDotted(index: number | null): void {
      dottedGroup.replaceChildren();
      dottedGroup.removeAttribute("data-stroke");
      const stroke = index === null ? undefined : glyph?.strokes[index];
      if (glyph === null || stroke === undefined) return;
      const length = polylineLength(stroke.median);
      dottedGroup.setAttribute("data-stroke", String(index));
      create(
        "path",
        {
          class: "kk-dotted-line",
          d: glyph.pathKind === "outline" ? polylinePath(stroke.median) : stroke.path,
          ...linePaint(strokeWidth * DOTTED_WIDTH),
          ...lengthAttribute(length),
          "stroke-dasharray": dottedDash(length, strokeWidth * DOTTED_SPACING).dasharray,
        },
        dottedGroup,
      );
      const start = stroke.median[0];
      if (start === undefined || !isFinitePoint(start)) return;
      create(
        "circle",
        {
          class: "kk-dotted-start",
          cx: formatNumber(start.x),
          cy: formatNumber(start.y),
          r: formatNumber(strokeWidth * DOTTED_START_RADIUS),
          ...FILL_PAINT,
        },
        dottedGroup,
      );
    },

    animateStroke(index: number, durationMs: number): Promise<void> {
      return animateStrokes([index], durationMs);
    },

    animateStrokes,
    cancelAnimations,

    setInk(points: readonly Point[] | null): void {
      ink.setAttribute("points", pointsAttribute(points ?? []));
    },

    keepInk(): void {
      const points = ink.getAttribute("points");
      if (destroyed || points === null || points === "") return;
      ink.setAttribute("points", "");
      create(
        "polyline",
        { class: "kk-ink kk-ink-kept", points, ...linePaint(strokeWidth * INK_WIDTH) },
        keptGroup,
      );
    },

    clearInk,

    flashInk(kind: "ok" | "error"): void {
      const points = ink.getAttribute("points");
      if (destroyed || points === null || points === "") return;
      ink.setAttribute("points", "");
      const element = create(
        "polyline",
        { class: `kk-ink kk-ink-flash kk-${kind}`, points, ...linePaint(strokeWidth * INK_WIDTH) },
        layers.fx,
      );
      const flash: Flash = {
        element,
        timer: setTimeout(() => {
          flashes.delete(flash);
          element.remove();
        }, flashMs),
      };
      flashes.add(flash);
    },

    strokeElement(index: number): SVGElement {
      const element = strokeEls[index];
      if (element === undefined) throw new RangeError(`glyph view: no stroke ${index}`);
      return element;
    },

    layer(name: GlyphLayer): SVGGElement {
      return layers[name];
    },

    destroy(): void {
      if (destroyed) return;
      cancelAnimations();
      clearFlashes();
      destroyed = true;
      glyph = null;
      strokeEls = [];
      dotEls = [];
      for (const name of GLYPH_LAYERS) layers[name].remove();
      svg.classList.remove("kk-glyph");
      svg.removeAttribute("data-path-kind");
      if (previousViewBox === null) svg.removeAttribute("viewBox");
      else svg.setAttribute("viewBox", previousViewBox);
    },
  };
}
