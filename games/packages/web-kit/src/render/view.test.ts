import { afterEach, describe, expect, it, vi } from "vitest";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { DotTrack } from "@kankyouken/mechanics/stroke";
import { fixture } from "../../../mechanics/src/glyph/fixtures";
import { DEFAULT_GLYPH_CSS } from "./css";
import { createFakeSvg, type FakeElement } from "./fake-dom";
import { GLYPH_LAYERS, createGlyphView, type GlyphViewOptions } from "./view";

const TREE = fixture("木");
const MOUTH = fixture("口");

/** A two-stroke glyph in the outline style: each path is the filled silhouette of a bar. */
const OUTLINE: Glyph = {
  ...fixture("十"),
  pathKind: "outline",
  strokes: [
    {
      path: "M100,420 L900,420 L900,480 L100,480 Z",
      median: [
        { x: 120, y: 450 },
        { x: 880, y: 450 },
      ],
    },
    {
      path: "M470,100 L530,100 L530,900 L470,900 Z",
      median: [
        { x: 500, y: 120 },
        { x: 500, y: 880 },
      ],
    },
  ],
};

function setup(options?: GlyphViewOptions, dom: { animations?: boolean } = {}) {
  const fake = createFakeSvg(dom);
  const view = createGlyphView(fake.svg, options);
  const layer = (name: (typeof GLYPH_LAYERS)[number]): FakeElement =>
    fake.root.children.find((child) => child.getAttribute("data-layer") === name)!;
  const states = (): (string | null)[] => layer("strokes").children.map((el) => el.getAttribute("data-state"));
  return { ...fake, view, layer, states };
}

const attrs = (element: FakeElement, ...names: string[]): (string | null)[] =>
  names.map((name) => element.getAttribute(name));

afterEach(() => {
  vi.useRealTimers();
});

describe("createGlyphView", () => {
  it("marks the svg and builds the six layers in order, drawing nothing yet", () => {
    const { root, view } = setup();
    expect(root.classList.contains("kk-glyph")).toBe(true);
    expect(root.children.map((child) => child.getAttribute("data-layer"))).toEqual([...GLYPH_LAYERS]);
    expect(root.children.map((child) => child.tagName)).toEqual(["g", "g", "g", "g", "g", "g"]);
    expect(root.children[2]!.getAttribute("class")).toBe("kk-layer kk-layer-strokes");
    expect(root.children.every((child) => child.namespaceURI === "http://www.w3.org/2000/svg")).toBe(true);
    expect(root.hasAttribute("viewBox")).toBe(false);
    expect(view.glyph).toBeNull();
    expect(view.svg).toBe(root);
    expect(view.layer("fx")).toBe(root.children[5]);
  });

  it("keeps the ghost hidden until asked", () => {
    const { layer, view } = setup();
    expect(layer("ghost").getAttribute("data-visible")).toBe("false");
    view.showGhost(true);
    expect(layer("ghost").getAttribute("data-visible")).toBe("true");
    view.setGlyph(TREE);
    expect(layer("ghost").getAttribute("data-visible")).toBe("true");
    view.showGhost(false);
    expect(layer("ghost").getAttribute("data-visible")).toBe("false");
  });
});

describe("setGlyph", () => {
  it("sets the viewBox and builds grid, ghost and one hidden element per stroke", () => {
    const { root, layer, view, states } = setup();
    view.setGlyph(TREE);

    expect(view.glyph).toBe(TREE);
    expect(root.getAttribute("viewBox")).toBe("-60 -60 1120 1120");
    expect(root.getAttribute("data-path-kind")).toBe("centerline");

    const grid = layer("grid").children;
    expect(grid.map((el) => [el.tagName, el.getAttribute("class")])).toEqual([
      ["rect", "kk-grid-frame"],
      ["line", "kk-grid-cross"],
      ["line", "kk-grid-cross"],
    ]);
    expect(attrs(grid[0]!, "x", "y", "width", "height")).toEqual(["0", "0", "1000", "1000"]);
    expect(attrs(grid[1]!, "x1", "y1", "x2", "y2")).toEqual(["500", "0", "500", "1000"]);
    expect(attrs(grid[2]!, "x1", "y1", "x2", "y2")).toEqual(["0", "500", "1000", "500"]);

    const ghost = layer("ghost").children;
    const strokes = layer("strokes").children;
    expect(ghost).toHaveLength(4);
    expect(strokes).toHaveLength(4);
    expect(states()).toEqual(["hidden", "hidden", "hidden", "hidden"]);
    strokes.forEach((el, i) => {
      expect(el.tagName).toBe("path");
      expect(el.getAttribute("class")).toBe("kk-stroke");
      expect(el.getAttribute("d")).toBe(TREE.strokes[i]!.path);
      expect(el.getAttribute("data-stroke")).toBe(String(i));
      expect(ghost[i]!.getAttribute("class")).toBe("kk-ghost-stroke");
      expect(ghost[i]!.getAttribute("d")).toBe(TREE.strokes[i]!.path);
      expect(view.strokeElement(i)).toBe(el);
    });
  });

  it("draws centerline glyphs as round stroked paths", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    for (const el of [...layer("strokes").children, ...layer("ghost").children]) {
      expect(attrs(el, "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin")).toEqual([
        "none",
        "currentColor",
        "45",
        "round",
        "round",
      ]);
    }
  });

  it("draws outline glyphs as filled paths", () => {
    const { root, layer, view } = setup();
    view.setGlyph(OUTLINE);
    expect(root.getAttribute("data-path-kind")).toBe("outline");
    for (const el of [...layer("strokes").children, ...layer("ghost").children]) {
      expect(attrs(el, "fill", "stroke", "stroke-width")).toEqual(["currentColor", "none", null]);
    }
  });

  it("honours padding and stroke width, and falls back on nonsense", () => {
    const custom = setup({ padding: 0, strokeWidth: 0.1 });
    custom.view.setGlyph(TREE);
    expect(custom.root.getAttribute("viewBox")).toBe("0 0 1000 1000");
    expect(custom.view.strokeElement(0).getAttribute("stroke-width")).toBe("100");

    const broken = setup({ padding: -1, strokeWidth: Number.NaN });
    broken.view.setGlyph(TREE);
    expect(broken.root.getAttribute("viewBox")).toBe("-60 -60 1120 1120");
    expect(broken.view.strokeElement(0).getAttribute("stroke-width")).toBe("45");
  });

  it("scales everything with the glyph's own size", () => {
    const { root, view } = setup();
    view.setGlyph({ ...TREE, size: 100 });
    expect(root.getAttribute("viewBox")).toBe("-6 -6 112 112");
    expect(view.strokeElement(0).getAttribute("stroke-width")).toBe("4.5");
  });

  it("starts afresh for the next glyph", () => {
    const { layer, view, states } = setup();
    view.setGlyph(TREE);
    view.setAllStrokes("done");
    view.showDotted(1);
    view.showArrow(1);
    view.showDots({ stroke: 1, dots: TREE.strokes[1]!.median });
    view.setInk([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    view.keepInk();
    view.setInk([{ x: 5, y: 6 }]);

    view.setGlyph(MOUTH);
    expect(states()).toEqual(["hidden", "hidden", "hidden"]);
    expect(layer("ghost").children).toHaveLength(3);
    expect(layer("guide").tree().filter((el) => ["circle", "path", "text"].includes(el.tagName))).toEqual([]);
    expect(layer("ink").byClass("kk-ink").map((el) => el.getAttribute("points"))).toEqual([""]);
  });

  it("empties the view for null but keeps the practice square", () => {
    const { root, layer, view } = setup();
    view.setGlyph(TREE);
    view.setGlyph(null);
    expect(view.glyph).toBeNull();
    expect(layer("strokes").children).toEqual([]);
    expect(layer("ghost").children).toEqual([]);
    expect(layer("grid").children).toHaveLength(3);
    expect(root.getAttribute("viewBox")).toBe("-60 -60 1120 1120");
    expect(root.hasAttribute("data-path-kind")).toBe(false);
  });

  it("copes with a glyph that has no strokes", () => {
    const { layer, view } = setup();
    view.setGlyph({ ...TREE, strokes: [] });
    expect(layer("strokes").children).toEqual([]);
    expect(layer("grid").children).toHaveLength(3);
  });

  it("refuses a glyph without a usable size and stays as it was", () => {
    const { root, view, states } = setup();
    view.setGlyph(TREE);
    view.setStrokeState(0, "done");
    expect(() => view.setGlyph({ ...MOUTH, size: 0 })).toThrow(RangeError);
    expect(view.glyph).toBe(TREE);
    expect(root.getAttribute("viewBox")).toBe("-60 -60 1120 1120");
    expect(states()).toEqual(["done", "hidden", "hidden", "hidden"]);
  });
});

describe("stroke states", () => {
  it("sets one stroke or all of them", () => {
    const { view, states } = setup();
    view.setGlyph(TREE);
    view.setStrokeState(0, "done");
    view.setStrokeState(1, "active");
    view.setStrokeState(2, "error");
    view.setStrokeState(3, "ghost");
    expect(states()).toEqual(["done", "active", "error", "ghost"]);
    view.setAllStrokes("done");
    expect(states()).toEqual(["done", "done", "done", "done"]);
  });

  it("ignores indices that are not strokes", () => {
    const { view, states } = setup();
    view.setStrokeState(0, "done");
    view.setAllStrokes("done");
    view.setGlyph(TREE);
    for (const index of [-1, 4, 1.5, Number.NaN]) view.setStrokeState(index, "done");
    expect(states()).toEqual(["hidden", "hidden", "hidden", "hidden"]);
  });

  it("throws from strokeElement when there is no such stroke", () => {
    const { view } = setup();
    expect(() => view.strokeElement(0)).toThrow(RangeError);
    view.setGlyph(TREE);
    expect(() => view.strokeElement(4)).toThrow(RangeError);
    expect(() => view.strokeElement(-1)).toThrow(RangeError);
  });
});

describe("showDots", () => {
  const track: DotTrack = {
    stroke: 1,
    dots: [
      { x: 500, y: 100 },
      { x: 500, y: 500 },
      { x: 500, y: 900 },
    ],
  };

  it("draws the dots of a stroke with a larger start dot", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDots(track);
    const dots = layer("guide").byClass("kk-dot");
    expect(dots.map((el) => attrs(el, "cx", "cy", "data-dot", "data-stroke"))).toEqual([
      ["500", "100", "0", "1"],
      ["500", "500", "1", "1"],
      ["500", "900", "2", "1"],
    ]);
    const radii = dots.map((el) => Number(el.getAttribute("r")));
    expect(radii[0]).toBeGreaterThan(radii[1]!);
    expect(radii[1]).toBe(radii[2]);
    expect(dots.map((el) => el.getAttribute("data-start"))).toEqual(["true", null, null]);
    expect(dots.map((el) => el.getAttribute("data-touched"))).toEqual(["false", "false", "false"]);
    expect(dots.every((el) => el.tagName === "circle" && el.getAttribute("fill") === "currentColor")).toBe(true);
  });

  it("marks touched dots and reuses the elements on every update", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDots(track, [false, false, false]);
    const before = layer("guide").byClass("kk-dot");
    view.showDots(track, [true, true, false]);
    const after = layer("guide").byClass("kk-dot");
    expect(after.map((el) => el.getAttribute("data-touched"))).toEqual(["true", "true", "false"]);
    expect(after).toHaveLength(3);
    after.forEach((el, i) => expect(el).toBe(before[i]));
  });

  it("replaces the previous track and removes surplus dots", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDots(track);
    view.showDots({ stroke: 0, dots: [{ x: 100, y: 350 }, { x: 900, y: 350 }] }, [true]);
    const dots = layer("guide").byClass("kk-dot");
    expect(dots.map((el) => attrs(el, "cx", "data-stroke", "data-touched"))).toEqual([
      ["100", "0", "true"],
      ["900", "0", "false"],
    ]);
    view.showDots(null);
    expect(layer("guide").byClass("kk-dot")).toEqual([]);
  });

  it("can leave the start dot unmarked", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDots(track);
    view.showDots(track, undefined, { markStart: false });
    const dots = layer("guide").byClass("kk-dot");
    expect(dots.map((el) => el.getAttribute("data-start"))).toEqual([null, null, null]);
    expect(new Set(dots.map((el) => el.getAttribute("r"))).size).toBe(1);
  });

  it("skips broken dots, shows nothing for an empty track or without a glyph", () => {
    const { layer, view } = setup();
    view.showDots(track);
    expect(layer("guide").byClass("kk-dot")).toEqual([]);
    view.setGlyph(TREE);
    view.showDots({ stroke: 0, dots: [] });
    expect(layer("guide").byClass("kk-dot")).toEqual([]);
    view.showDots({ stroke: 0, dots: [{ x: Number.NaN, y: 0 }, { x: 5, y: 5 }] });
    expect(layer("guide").byClass("kk-dot").map((el) => el.getAttribute("data-dot"))).toEqual(["1"]);
  });

  it("shows every stroke's dots at once, with touches indexed by stroke", () => {
    const { layer, view } = setup();
    view.setGlyph(MOUTH);
    const tracks: DotTrack[] = MOUTH.strokes.map((stroke, s) => ({ stroke: s, dots: stroke.median }));
    view.showAllDots(tracks, [[true, false], undefined, [false, true]], { markStart: false });
    const dots = layer("guide").byClass("kk-dot");
    expect(dots).toHaveLength(2 + 3 + 2);
    expect(dots.map((el) => `${el.getAttribute("data-stroke")}.${el.getAttribute("data-dot")}`)).toEqual([
      "0.0",
      "0.1",
      "1.0",
      "1.1",
      "1.2",
      "2.0",
      "2.1",
    ]);
    expect(dots.map((el) => el.getAttribute("data-touched") === "true")).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    view.showAllDots([]);
    expect(layer("guide").byClass("kk-dot")).toEqual([]);
  });
});

describe("showArrow / showArrows", () => {
  it("draws a numbered arrow at the stroke's start", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showArrow(1);
    const arrows = layer("guide").byClass("kk-arrow");
    expect(arrows).toHaveLength(1);
    const [shaft, head, label] = arrows[0]!.children as [FakeElement, FakeElement, FakeElement];
    expect(arrows[0]!.getAttribute("data-stroke")).toBe("1");
    expect([shaft.tagName, head.tagName, label.tagName]).toEqual(["line", "polygon", "text"]);
    expect(attrs(shaft, "x1", "y1", "x2", "y2")).toEqual(["500", "100", "500", "205"]);
    expect(head.getAttribute("points")).toBe("500,260 475,205 525,205");
    expect(label.textContent).toBe("2");
    expect(attrs(label, "x", "y", "text-anchor", "dominant-baseline", "font-size")).toEqual([
      "500",
      "35",
      "middle",
      "central",
      "75",
    ]);
  });

  it("replaces the previous arrow and clears on null or an unknown stroke", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showArrow(0);
    view.showArrow(3);
    expect(layer("guide").byClass("kk-arrow").map((el) => el.getAttribute("data-stroke"))).toEqual(["3"]);
    view.showArrow(null);
    expect(layer("guide").byClass("kk-arrow")).toEqual([]);
    view.showArrow(0);
    view.showArrow(9);
    expect(layer("guide").byClass("kk-arrow")).toEqual([]);
  });

  it("draws a whole stroke-order chart, skipping unknown and repeated strokes", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showArrows([0, 1, 1, 2, 7, 3, -1]);
    expect(layer("guide").byClass("kk-arrow-label").map((el) => el.textContent)).toEqual(["1", "2", "3", "4"]);
    view.showArrows([]);
    expect(layer("guide").byClass("kk-arrow")).toEqual([]);
  });

  it("does nothing without a glyph and skips strokes without a direction", () => {
    const { layer, view } = setup();
    view.showArrows([0]);
    expect(layer("guide").byClass("kk-arrow")).toEqual([]);
    const dot = { path: "M5,5", median: [{ x: 5, y: 5 }, { x: 5, y: 5 }] };
    view.setGlyph({ ...TREE, strokes: [dot, TREE.strokes[1]!] });
    view.showArrows([0, 1]);
    expect(layer("guide").byClass("kk-arrow").map((el) => el.getAttribute("data-stroke"))).toEqual(["1"]);
  });
});

describe("showDotted", () => {
  it("draws the spine as a dotted line with a start dot", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDotted(0);
    const group = layer("guide").byClass("kk-dotted")[0]!;
    expect(group.getAttribute("data-stroke")).toBe("0");
    const [line, start] = group.children as [FakeElement, FakeElement];
    expect(line.getAttribute("class")).toBe("kk-dotted-line");
    expect(line.getAttribute("d")).toBe(TREE.strokes[0]!.path);
    expect(attrs(line, "fill", "stroke-linecap", "pathLength", "stroke-dasharray", "stroke-width")).toEqual([
      "none",
      "round",
      "800",
      "0 40",
      "13.5",
    ]);
    expect(start.getAttribute("class")).toBe("kk-dotted-start");
    expect(attrs(start, "cx", "cy")).toEqual(["100", "350"]);
    expect(Number(start.getAttribute("r")) * 2).toBeGreaterThan(Number(line.getAttribute("stroke-width")));
  });

  it("shows one stroke at a time and clears on null or an unknown stroke", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.showDotted(0);
    view.showDotted(2);
    const group = layer("guide").byClass("kk-dotted")[0]!;
    expect(group.children).toHaveLength(2);
    expect(group.getAttribute("data-stroke")).toBe("2");
    view.showDotted(null);
    expect(group.children).toEqual([]);
    expect(group.hasAttribute("data-stroke")).toBe(false);
    view.showDotted(0);
    view.showDotted(12);
    expect(group.children).toEqual([]);
  });

  it("follows the median of an outline stroke, not its silhouette", () => {
    const { layer, view } = setup();
    view.setGlyph(OUTLINE);
    view.showDotted(1);
    const line = layer("guide").byClass("kk-dotted-line")[0]!;
    expect(line.getAttribute("d")).toBe("M500,120 L500,880");
    expect(line.getAttribute("pathLength")).toBe("760");
  });
});

describe("animateStroke", () => {
  it("draws a centerline stroke with a dash offset and resolves when the animation ends", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(TREE);
    view.setStrokeState(1, "done");
    let resolved = false;
    const done = view.animateStroke(1, 600).then(() => {
      resolved = true;
    });

    const overlay = layer("fx").byClass("kk-stroke-anim");
    expect(overlay).toHaveLength(1);
    expect(overlay[0]!.getAttribute("d")).toBe(TREE.strokes[1]!.path);
    expect(attrs(overlay[0]!, "data-stroke", "pathLength", "stroke-dasharray", "stroke-dashoffset")).toEqual([
      "1",
      "800",
      "800 845",
      "822.5",
    ]);
    expect(attrs(overlay[0]!, "fill", "stroke", "stroke-width", "stroke-linecap")).toEqual([
      "none",
      "currentColor",
      "45",
      "round",
    ]);
    expect(view.strokeElement(1).getAttribute("data-animating")).toBe("true");
    expect(view.strokeElement(1).getAttribute("data-state")).toBe("done");

    expect(doc.animations).toHaveLength(1);
    const animation = doc.animations[0]!;
    expect(animation.element).toBe(overlay[0]);
    expect(animation.keyframes).toEqual([{ strokeDashoffset: 822.5 }, { strokeDashoffset: 0 }]);
    expect(animation.options).toMatchObject({ duration: 600, delay: 0, fill: "both" });

    await Promise.resolve();
    expect(resolved).toBe(false);

    animation.finish();
    await done;
    expect(layer("fx").children).toEqual([]);
    expect(view.strokeElement(1).hasAttribute("data-animating")).toBe(false);
    expect(view.strokeElement(1).getAttribute("data-state")).toBe("done");
  });

  it("reveals an outline stroke with a wide brush clipped to its silhouette", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(OUTLINE);
    const done = view.animateStroke(0, 400);

    const [clip, brush] = layer("fx").children as [FakeElement, FakeElement];
    expect(clip.tagName).toBe("clipPath");
    expect(clip.children.map((el) => el.getAttribute("d"))).toEqual([OUTLINE.strokes[0]!.path]);
    expect(brush.getAttribute("class")).toBe("kk-stroke-anim");
    expect(brush.getAttribute("d")).toBe("M120,450 L880,450");
    expect(brush.getAttribute("clip-path")).toBe(`url(#${clip.getAttribute("id")})`);
    expect(attrs(brush, "fill", "stroke-width", "stroke-dasharray", "stroke-dashoffset")).toEqual([
      "none",
      "200",
      "760 960",
      "860",
    ]);

    doc.animations[0]!.finish();
    await done;
    expect(layer("fx").children).toEqual([]);
  });

  it("gives each view its own clip ids", () => {
    const a = setup();
    const b = setup();
    a.view.setGlyph(OUTLINE);
    b.view.setGlyph(OUTLINE);
    void a.view.animateStroke(0, 100);
    void b.view.animateStroke(0, 100);
    expect(a.layer("fx").children[0]!.getAttribute("id")).not.toBe(b.layer("fx").children[0]!.getAttribute("id"));
  });

  it("resolves at once for an unknown stroke, a non-positive duration or no glyph", async () => {
    const { doc, layer, view } = setup();
    await view.animateStroke(0, 500);
    view.setGlyph(TREE);
    await view.animateStroke(4, 500);
    await view.animateStroke(-1, 500);
    await view.animateStroke(0, 0);
    await view.animateStroke(0, -50);
    await view.animateStroke(0, Number.NaN);
    await view.animateStroke(0, Number.POSITIVE_INFINITY);
    expect(doc.animations).toEqual([]);
    expect(layer("fx").children).toEqual([]);
    expect(view.strokeElement(0).hasAttribute("data-animating")).toBe(false);
  });

  it("resolves at once and leaves nothing behind without the Web Animations API", async () => {
    const { layer, view } = setup(undefined, { animations: false });
    view.setGlyph(TREE);
    await view.animateStroke(2, 500);
    expect(layer("fx").children).toEqual([]);
    expect(view.strokeElement(2).hasAttribute("data-animating")).toBe(false);
  });

  it("cancelAnimations stops everything and resolves the promises", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(TREE);
    const first = view.animateStroke(0, 500);
    const second = view.animateStroke(1, 500);
    expect(layer("fx").children).toHaveLength(2);

    view.cancelAnimations();
    await Promise.all([first, second]);
    expect(doc.animations.map((a) => a.state)).toEqual(["cancelled", "cancelled"]);
    expect(layer("fx").children).toEqual([]);
    expect(view.strokeElement(0).hasAttribute("data-animating")).toBe(false);
    expect(view.strokeElement(1).hasAttribute("data-animating")).toBe(false);
    view.cancelAnimations();
  });

  it("restarting a stroke cancels its earlier animation", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(TREE);
    const first = view.animateStroke(0, 500);
    const second = view.animateStroke(0, 500);
    await first;
    expect(doc.animations.map((a) => a.state)).toEqual(["cancelled", "running"]);
    expect(layer("fx").children).toHaveLength(1);
    expect(view.strokeElement(0).getAttribute("data-animating")).toBe("true");
    doc.animations[1]!.finish();
    await second;
    expect(view.strokeElement(0).hasAttribute("data-animating")).toBe(false);
  });

  it("is cancelled by setGlyph and by destroy", async () => {
    const one = setup();
    one.view.setGlyph(TREE);
    const first = one.view.animateStroke(0, 500);
    one.view.setGlyph(MOUTH);
    await first;
    expect(one.layer("fx").children).toEqual([]);

    const two = setup();
    two.view.setGlyph(TREE);
    const second = two.view.animateStroke(0, 500);
    two.view.destroy();
    await second;
    expect(two.doc.animations[0]!.state).toBe("cancelled");
  });
});

describe("animateStrokes", () => {
  it("plays strokes one after another as a single animation", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(TREE);
    let resolved = false;
    const done = view.animateStrokes([0, 1, 2, 3], 300, 100).then(() => {
      resolved = true;
    });

    expect(layer("fx").byClass("kk-stroke-anim").map((el) => el.getAttribute("data-stroke"))).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(doc.animations.map((a) => a.options.delay)).toEqual([0, 400, 800, 1200]);
    expect(doc.animations.every((a) => a.options.duration === 300 && a.options.fill === "both")).toBe(true);
    expect(layer("strokes").children.every((el) => el.getAttribute("data-animating") === "true")).toBe(true);

    for (const animation of doc.animations.slice(0, 3)) animation.finish();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(layer("fx").children).toHaveLength(4);

    doc.animations[3]!.finish();
    await done;
    expect(layer("fx").children).toEqual([]);
    expect(layer("strokes").children.some((el) => el.hasAttribute("data-animating"))).toBe(false);
  });

  it("skips unknown and repeated strokes and ignores a broken gap", async () => {
    const { doc, view } = setup();
    view.setGlyph(TREE);
    const done = view.animateStrokes([2, 9, 2, 0], 200, Number.NaN);
    expect(doc.animations.map((a) => [a.element.getAttribute("data-stroke"), a.options.delay])).toEqual([
      ["2", 0],
      ["0", 200],
    ]);
    view.cancelAnimations();
    await done;
    await view.animateStrokes([], 200);
    await view.animateStrokes([8, 9], 200);
    expect(doc.animations).toHaveLength(2);
  });

  it("stops as a whole when one of its strokes is animated again", async () => {
    const { doc, layer, view } = setup();
    view.setGlyph(TREE);
    const sequence = view.animateStrokes([0, 1, 2], 200);
    const single = view.animateStroke(1, 200);
    await sequence;
    expect(doc.animations.map((a) => a.state)).toEqual(["cancelled", "cancelled", "cancelled", "running"]);
    expect(layer("fx").children).toHaveLength(1);
    expect(view.strokeElement(0).hasAttribute("data-animating")).toBe(false);
    expect(view.strokeElement(1).getAttribute("data-animating")).toBe("true");
    view.cancelAnimations();
    await single;
  });
});

describe("ink", () => {
  it("shows the stroke under the pen and clears it", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    const ink = layer("ink").byClass("kk-ink")[0]!;
    expect(ink.tagName).toBe("polyline");
    expect(attrs(ink, "fill", "stroke", "stroke-linecap", "stroke-width")).toEqual([
      "none",
      "currentColor",
      "round",
      "36",
    ]);

    view.setInk([{ x: 10, y: 20 }]);
    expect(ink.getAttribute("points")).toBe("10,20 10,20");
    view.setInk([{ x: 10, y: 20 }, { x: 30.123, y: 40 }]);
    expect(ink.getAttribute("points")).toBe("10,20 30.12,40");
    view.setInk([]);
    expect(ink.getAttribute("points")).toBe("");
    view.setInk([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    view.setInk(null);
    expect(ink.getAttribute("points")).toBe("");
  });

  it("flashes a copy of the ink, frees the live ink at once and removes the copy later", () => {
    vi.useFakeTimers();
    const { layer, view } = setup();
    view.setGlyph(TREE);
    const ink = layer("ink").byClass("kk-ink")[0]!;
    view.setInk([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    view.flashInk("ok");

    expect(ink.getAttribute("points")).toBe("");
    const flash = layer("fx").byClass("kk-ink-flash");
    expect(flash).toHaveLength(1);
    expect(flash[0]!.getAttribute("class")).toBe("kk-ink kk-ink-flash kk-ok");
    expect(flash[0]!.getAttribute("points")).toBe("0,0 100,0");
    expect(flash[0]!.getAttribute("stroke-width")).toBe("36");

    view.setInk([{ x: 5, y: 5 }, { x: 6, y: 6 }]);
    vi.advanceTimersByTime(349);
    expect(layer("fx").byClass("kk-ink-flash")).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(layer("fx").byClass("kk-ink-flash")).toEqual([]);
    expect(ink.getAttribute("points")).toBe("5,5 6,6");
  });

  it("marks an error flash, lets flashes overlap and honours flashMs", () => {
    vi.useFakeTimers();
    const { layer, view } = setup({ flashMs: 100 });
    view.setGlyph(TREE);
    view.setInk([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    view.flashInk("error");
    vi.advanceTimersByTime(60);
    view.setInk([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
    view.flashInk("ok");
    expect(layer("fx").byClass("kk-ink-flash").map((el) => el.getAttribute("class"))).toEqual([
      "kk-ink kk-ink-flash kk-error",
      "kk-ink kk-ink-flash kk-ok",
    ]);
    vi.advanceTimersByTime(40);
    expect(layer("fx").byClass("kk-ink-flash").map((el) => el.classList.contains("kk-ok"))).toEqual([true]);
    vi.advanceTimersByTime(60);
    expect(layer("fx").byClass("kk-ink-flash")).toEqual([]);
  });

  it("does not flash when there is no ink", () => {
    vi.useFakeTimers();
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.flashInk("ok");
    expect(layer("fx").children).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops pending flashes when the glyph changes", () => {
    vi.useFakeTimers();
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.setInk([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    view.flashInk("ok");
    view.setGlyph(MOUTH);
    expect(layer("fx").children).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps finished strokes of free writing until the ink is cleared", () => {
    const { layer, view } = setup();
    view.setGlyph(TREE);
    view.keepInk();
    expect(layer("ink").byClass("kk-ink-kept")).toEqual([]);

    view.setInk([{ x: 100, y: 350 }, { x: 900, y: 350 }]);
    view.keepInk();
    view.setInk([{ x: 500, y: 100 }, { x: 500, y: 900 }]);
    view.keepInk();
    view.setInk([{ x: 1, y: 1 }]);
    view.setInk(null);

    const kept = layer("ink").byClass("kk-ink-kept");
    expect(kept.map((el) => el.getAttribute("points"))).toEqual(["100,350 900,350", "500,100 500,900"]);
    expect(kept[0]!.getAttribute("class")).toBe("kk-ink kk-ink-kept");
    expect(kept[0]!.getAttribute("stroke-width")).toBe("36");

    view.clearInk();
    expect(layer("ink").byClass("kk-ink-kept")).toEqual([]);
    expect(layer("ink").byClass("kk-ink")).toHaveLength(1);
  });
});

describe("destroy", () => {
  it("removes what the view added and restores the viewBox", () => {
    vi.useFakeTimers();
    const fake = createFakeSvg();
    fake.root.setAttribute("viewBox", "0 0 24 24");
    fake.root.setAttribute("class", "app-canvas");
    const view = createGlyphView(fake.svg);
    view.setGlyph(TREE);
    view.setInk([{ x: 0, y: 0 }, { x: 9, y: 9 }]);
    view.flashInk("ok");

    view.destroy();
    view.destroy();
    expect(fake.root.children).toEqual([]);
    expect(fake.root.getAttribute("class")).toBe("app-canvas");
    expect(fake.root.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(fake.root.hasAttribute("data-path-kind")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes a viewBox the svg did not have before", () => {
    const { root, view } = setup();
    view.setGlyph(TREE);
    view.destroy();
    expect(root.hasAttribute("viewBox")).toBe(false);
    expect(root.hasAttribute("class")).toBe(false);
  });

  it("leaves an inert view behind", async () => {
    const { root, view } = setup();
    view.setGlyph(TREE);
    view.destroy();
    view.setGlyph(MOUTH);
    view.setAllStrokes("done");
    view.showArrows([0]);
    view.showDotted(0);
    view.showDots({ stroke: 0, dots: [{ x: 1, y: 1 }] });
    view.setInk([{ x: 1, y: 1 }]);
    view.flashInk("ok");
    view.keepInk();
    await view.animateStroke(0, 100);
    expect(view.glyph).toBeNull();
    expect(root.children).toEqual([]);
    expect(root.hasAttribute("viewBox")).toBe(false);
    expect(() => view.strokeElement(0)).toThrow(RangeError);
  });
});

describe("a traced character, start to finish", () => {
  it("walks 木 through demo, guided strokes, a mistake and completion", async () => {
    vi.useFakeTimers();
    const { doc, layer, view, states } = setup();
    view.setGlyph(TREE);
    view.showGhost(true);

    const demo = view.animateStrokes([0, 1, 2, 3], 250, 50);
    for (const animation of doc.animations) animation.finish();
    await demo;
    expect(states()).toEqual(["hidden", "hidden", "hidden", "hidden"]);

    for (let index = 0; index < TREE.strokes.length; index++) {
      const median = TREE.strokes[index]!.median;
      view.setStrokeState(index, "active");
      view.showDotted(index);
      view.showArrow(index);
      expect(layer("guide").byClass("kk-arrow-label")[0]!.textContent).toBe(String(index + 1));
      expect(layer("guide").byClass("kk-dotted")[0]!.getAttribute("data-stroke")).toBe(String(index));

      if (index === 2) {
        view.setInk([...median].reverse());
        view.flashInk("error");
        view.setStrokeState(index, "error");
        expect(states()[index]).toBe("error");
        vi.advanceTimersByTime(350);
      }

      view.setInk([median[0]!]);
      view.setInk(median);
      view.flashInk("ok");
      view.setStrokeState(index, "done");
    }
    view.showDotted(null);
    view.showArrow(null);
    vi.advanceTimersByTime(350);

    expect(states()).toEqual(["done", "done", "done", "done"]);
    expect(layer("guide").tree().filter((el) => ["circle", "path", "text"].includes(el.tagName))).toEqual([]);
    expect(layer("fx").children).toEqual([]);
    expect(layer("ink").byClass("kk-ink")[0]!.getAttribute("points")).toBe("");
    expect(layer("ghost").getAttribute("data-visible")).toBe("true");
  });
});

describe("DEFAULT_GLYPH_CSS", () => {
  it("only styles hooks the view really produces", () => {
    vi.useFakeTimers();
    const { root, view } = setup();
    for (const glyph of [TREE, OUTLINE]) {
      view.setGlyph(glyph);
      view.showDots({ stroke: 0, dots: glyph.strokes[0]!.median }, [true]);
      view.showArrows([0, 1]);
      view.showDotted(0);
      view.setInk([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
      view.keepInk();
      view.setInk([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
      view.flashInk("ok");
      view.setInk([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
      view.flashInk("error");
      void view.animateStroke(1, 100);
    }
    const produced = new Set(root.tree().flatMap((el) => el.classes()));
    const styled = new Set([...DEFAULT_GLYPH_CSS.matchAll(/\.(kk-[a-z-]+)/g)].map((match) => match[1]!));
    expect(styled.size).toBeGreaterThan(10);
    for (const name of styled) expect(produced, `.${name} is styled but never produced`).toContain(name);

    const attributes = new Set(root.tree().flatMap((el) => [...el.attributes.keys()]));
    for (const match of DEFAULT_GLYPH_CSS.matchAll(/\[(data-[a-z-]+)[=\]]/g)) {
      expect(attributes, `[${match[1]}] is styled but never set`).toContain(match[1]);
    }
  });
});
