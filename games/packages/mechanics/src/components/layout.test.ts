import { describe, expect, it } from "vitest";
import type { Box } from "../util/geometry";
import { createRng } from "../util/rng";
import {
  ENCLOSE_SHAPES,
  alternativeLayouts,
  layoutCatalogue,
  layoutFromBoxes,
  layoutSignature,
  layoutsEqual,
  makeLayout,
  parseLayout,
} from "./layout";
import type { EncloseShape, LayoutNode, Rect } from "./types";

const S: LayoutNode = { kind: "slot" };
const row = (...children: LayoutNode[]): LayoutNode => ({ kind: "row", children });
const column = (...children: LayoutNode[]): LayoutNode => ({ kind: "column", children });
const enclose = (shape: EncloseShape, inner: LayoutNode): LayoutNode => ({ kind: "enclose", shape, inner });
const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({ minX, minY, maxX, maxY });

function expectRect(actual: Rect | undefined, x: number, y: number, w: number, h: number): void {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(x, 10);
  expect(actual!.y).toBeCloseTo(y, 10);
  expect(actual!.w).toBeCloseTo(w, 10);
  expect(actual!.h).toBeCloseTo(h, 10);
}

const signatureOf = (boxes: readonly Box[]): string => makeLayout(layoutFromBoxes(boxes).tree).signature;

describe("makeLayout", () => {
  it("gives a single slot the whole square", () => {
    const layout = makeLayout(S);
    expect(layout.signature).toBe("S");
    expect(layout.slots).toHaveLength(1);
    expectRect(layout.slots[0]!.rect, 0, 0, 1, 1);
    expect(layout.slots[0]!.hole).toBeUndefined();
  });

  it("divides rows into equal widths and columns into equal heights", () => {
    const across = makeLayout(row(S, S));
    expect(across.signature).toBe("R(S,S)");
    expectRect(across.slots[0]!.rect, 0, 0, 0.5, 1);
    expectRect(across.slots[1]!.rect, 0.5, 0, 0.5, 1);

    const down = makeLayout(column(S, S, S));
    expect(down.signature).toBe("C(S,S,S)");
    expectRect(down.slots[0]!.rect, 0, 0, 1, 1 / 3);
    expectRect(down.slots[1]!.rect, 0, 1 / 3, 1, 1 / 3);
    expectRect(down.slots[2]!.rect, 0, 2 / 3, 1, 1 / 3);
  });

  it("lays out nested structures depth-first (the structure of 胡)", () => {
    const layout = makeLayout(row(column(S, S), S));
    expect(layout.signature).toBe("R(C(S,S),S)");
    expect(layout.slots).toHaveLength(3);
    expectRect(layout.slots[0]!.rect, 0, 0, 0.5, 0.5);
    expectRect(layout.slots[1]!.rect, 0, 0.5, 0.5, 0.5);
    expectRect(layout.slots[2]!.rect, 0.5, 0, 0.5, 1);
  });

  it.each<[EncloseShape, number, number, number, number]>([
    ["full", 0.24, 0.24, 0.52, 0.52],
    ["top-left", 0.24, 0.24, 0.76, 0.76],
    ["bottom-left", 0.24, 0, 0.76, 0.76],
    ["top-right", 0, 0.24, 0.76, 0.76],
    ["top", 0.24, 0.24, 0.52, 0.76],
    ["bottom", 0.24, 0, 0.52, 0.76],
    ["left", 0.24, 0.24, 0.76, 0.52],
  ])("gives a %s enclosure the whole area and insets its hole from the covered sides", (shape, x, y, w, h) => {
    const layout = makeLayout(enclose(shape, S));
    expect(layout.signature).toBe(`E:${shape}(S)`);
    expect(layout.slots).toHaveLength(2);
    expectRect(layout.slots[0]!.rect, 0, 0, 1, 1);
    expectRect(layout.slots[0]!.hole, x, y, w, h);
    expectRect(layout.slots[1]!.rect, x, y, w, h);
    expect(layout.slots[1]!.hole).toBeUndefined();
  });

  it("lays the inner structure out inside the hole, outer slot first", () => {
    const layout = makeLayout(enclose("full", row(S, S)));
    expect(layout.signature).toBe("E:full(R(S,S))");
    expect(layout.slots).toHaveLength(3);
    expectRect(layout.slots[0]!.hole, 0.24, 0.24, 0.52, 0.52);
    expectRect(layout.slots[1]!.rect, 0.24, 0.24, 0.26, 0.52);
    expectRect(layout.slots[2]!.rect, 0.5, 0.24, 0.26, 0.52);
  });

  it("scales the wall of an enclosure with the area it sits in", () => {
    const layout = makeLayout(row(enclose("top-left", S), S));
    expectRect(layout.slots[0]!.rect, 0, 0, 0.5, 1);
    expectRect(layout.slots[0]!.hole, 0.12, 0.24, 0.38, 0.76);
    expectRect(layout.slots[2]!.rect, 0.5, 0, 0.5, 1);
  });

  it("replaces a row or column of one child by that child", () => {
    const layout = makeLayout(row(column(S)));
    expect(layout.signature).toBe("S");
    expect(layout.tree).toEqual(S);
    expect(makeLayout(row(column(S, S))).signature).toBe("C(S,S)");
    expect(makeLayout(enclose("top", column(row(S, S)))).signature).toBe("E:top(R(S,S))");
  });

  it("rejects rows and columns without children", () => {
    expect(() => makeLayout(row())).toThrow(RangeError);
    expect(() => makeLayout(row(S, column()))).toThrow(RangeError);
  });

  it("keeps rows nested in rows distinct from flat rows", () => {
    const nested = makeLayout(row(row(S, S), S));
    expect(nested.signature).toBe("R(R(S,S),S)");
    expectRect(nested.slots[0]!.rect, 0, 0, 0.25, 1);
    expectRect(nested.slots[2]!.rect, 0.5, 0, 0.5, 1);
  });
});

describe("layoutSignature, parseLayout, layoutsEqual", () => {
  it("writes the tree as given", () => {
    expect(layoutSignature(row(S))).toBe("R(S)");
    expect(layoutSignature(enclose("bottom-left", column(S, S)))).toBe("E:bottom-left(C(S,S))");
  });

  it("round-trips every structure of the catalogue", () => {
    for (const count of [1, 2, 3, 4, 5]) {
      for (const layout of layoutCatalogue(count)) {
        expect(parseLayout(layout.signature)).toEqual(layout);
      }
    }
  });

  it("parses nested signatures", () => {
    const layout = parseLayout("R(C(S,S),E:top-right(S))");
    expect(layout.slots).toHaveLength(4);
    expect(layout.tree).toEqual(row(column(S, S), enclose("top-right", S)));
  });

  it.each(["", "X", "R()", "R(S", "R(S,)", "S,S", "E:nope(S)", "E:full", "E:full(S", "SS", "r(S,S)"])(
    "rejects %j",
    (text) => {
      expect(() => parseLayout(text)).toThrow(SyntaxError);
    },
  );

  it("compares layouts by structure", () => {
    expect(layoutsEqual(makeLayout(row(S, S)), parseLayout("R(S,S)"))).toBe(true);
    expect(layoutsEqual(makeLayout(row(S, S)), makeLayout(row(column(S), S)))).toBe(true);
    expect(layoutsEqual(makeLayout(row(S, S)), makeLayout(column(S, S)))).toBe(false);
    expect(layoutsEqual(makeLayout(enclose("top", S)), makeLayout(enclose("bottom", S)))).toBe(false);
  });
});

describe("layoutFromBoxes", () => {
  it("rejects an empty list", () => {
    expect(() => layoutFromBoxes([])).toThrow(RangeError);
  });

  it("makes one box a slot", () => {
    expect(layoutFromBoxes([box(10, 10, 90, 90)])).toEqual({ tree: S, order: [0], guessed: false });
  });

  it("cuts boxes side by side into a row, left to right whatever the input order", () => {
    const result = layoutFromBoxes([box(600, 0, 1000, 1000), box(0, 0, 400, 1000)]);
    expect(layoutSignature(result.tree)).toBe("R(S,S)");
    expect(result.order).toEqual([1, 0]);
  });

  it("cuts stacked boxes into a column, top to bottom", () => {
    const result = layoutFromBoxes([box(0, 700, 1000, 1000), box(0, 0, 1000, 250), box(0, 350, 1000, 600)]);
    expect(layoutSignature(result.tree)).toBe("C(S,S,S)");
    expect(result.order).toEqual([1, 2, 0]);
  });

  it("recurses into the groups a cut leaves (two stacked boxes beside a tall one)", () => {
    const result = layoutFromBoxes([box(500, 0, 1000, 1000), box(50, 550, 400, 950), box(0, 0, 450, 450)]);
    expect(layoutSignature(result.tree)).toBe("R(C(S,S),S)");
    expect(result.order).toEqual([2, 1, 0]);
  });

  it("still cuts when neighbours overlap by less than 12% of the narrower one", () => {
    expect(signatureOf([box(0, 0, 500, 1000), box(480, 0, 1000, 1000)])).toBe("R(S,S)");
    expect(signatureOf([box(0, 0, 1000, 500), box(0, 460, 1000, 800)])).toBe("C(S,S)");
  });

  it("does not cut when the overlap is larger than the tolerance", () => {
    // 100 units of overlap between boxes 500 wide: neither a row nor an enclosure.
    const result = layoutFromBoxes([box(0, 0, 500, 300), box(400, 100, 900, 400)]);
    expect(layoutSignature(result.tree)).toBe("R(S,S)");
    expect(result.order).toEqual([0, 1]);
    // The same overlap vertically, with centres spread along y: last resort is a column.
    expect(signatureOf([box(0, 0, 300, 500), box(100, 400, 400, 900)])).toBe("C(S,S)");
  });

  it("prefers the cut with the wider gap relative to the extent when both exist", () => {
    // Diagonal neighbours: gap of 400 across over 1000, gap of 100 down over 1000.
    expect(signatureOf([box(0, 0, 300, 450), box(700, 550, 1000, 1000)])).toBe("R(S,S)");
    expect(signatureOf([box(0, 0, 450, 300), box(550, 700, 1000, 1000)])).toBe("C(S,S)");
    // Equal gaps: row.
    expect(signatureOf([box(0, 0, 400, 400), box(600, 600, 1000, 1000)])).toBe("R(S,S)");
  });

  it("reads a two-by-two grid along its wider gap", () => {
    const grid = (gapX: number, gapY: number): Box[] => [
      box(0, 0, 500 - gapX / 2, 500 - gapY / 2),
      box(500 + gapX / 2, 0, 1000, 500 - gapY / 2),
      box(0, 500 + gapY / 2, 500 - gapX / 2, 1000),
      box(500 + gapX / 2, 500 + gapY / 2, 1000, 1000),
    ];
    expect(signatureOf(grid(200, 50))).toBe("R(C(S,S),C(S,S))");
    expect(layoutFromBoxes(grid(200, 50)).order).toEqual([0, 2, 1, 3]);
    expect(signatureOf(grid(50, 200))).toBe("C(R(S,S),R(S,S))");
    expect(layoutFromBoxes(grid(50, 200)).order).toEqual([0, 1, 2, 3]);
  });

  it.each<[EncloseShape, Box]>([
    ["full", box(300, 300, 700, 700)],
    ["top-left", box(300, 300, 1000, 1000)],
    ["bottom-left", box(300, 0, 1000, 700)],
    ["top-right", box(0, 300, 700, 1000)],
    ["top", box(300, 300, 700, 1000)],
    ["bottom", box(300, 0, 700, 700)],
    ["left", box(300, 300, 1000, 700)],
  ])("recognises a %s enclosure from where the inner box keeps away from the edge", (shape, inner) => {
    const result = layoutFromBoxes([inner, box(0, 0, 1000, 1000)]);
    expect(layoutSignature(result.tree)).toBe(`E:${shape}(S)`);
    expect(result.order).toEqual([1, 0]);
  });

  it("treats side combinations without a name as a full enclosure", () => {
    // Clear on the right only.
    expect(signatureOf([box(0, 0, 1000, 1000), box(0, 0, 600, 1000)])).toBe("E:full(S)");
    // Clear on no side at all: two boxes on top of each other.
    expect(signatureOf([box(0, 0, 1000, 1000), box(0, 0, 1000, 1000)])).toBe("E:full(S)");
  });

  it("recurses into what an enclosure wraps", () => {
    const result = layoutFromBoxes([box(300, 300, 480, 700), box(520, 300, 700, 700), box(0, 0, 1000, 1000)]);
    expect(layoutSignature(result.tree)).toBe("E:full(R(S,S))");
    expect(result.order).toEqual([2, 0, 1]);
  });

  it("takes the largest box when several could be the outer one", () => {
    const result = layoutFromBoxes([box(350, 350, 650, 650), box(0, 0, 1000, 1000), box(200, 200, 800, 800)]);
    expect(layoutSignature(result.tree)).toBe("E:full(E:full(S))");
    expect(result.order).toEqual([1, 2, 0]);
  });

  it("falls back to a flat row or column along the wider spread of centres", () => {
    // Three boxes chained by large overlaps; none contains the centres of the others.
    const chain = [box(0, 0, 400, 400), box(250, 250, 650, 650), box(500, 100, 900, 500)];
    const result = layoutFromBoxes(chain);
    expect(layoutSignature(result.tree)).toBe("R(S,S,S)");
    expect(result.order).toEqual([0, 1, 2]);
    const turned = chain.map((b) => box(b.minY, b.minX, b.maxY, b.maxX));
    expect(signatureOf(turned)).toBe("C(S,S,S)");
  });

  it("says when the structure is a guess, wherever in the tree the last resort was used", () => {
    const chain = [box(0, 0, 400, 400), box(250, 250, 650, 650), box(500, 100, 900, 500)];
    expect(layoutFromBoxes(chain).guessed).toBe(true);
    // The same chain as the right half of a row, and inside an enclosure.
    const half = chain.map((b) => box(500 + b.minX / 2, b.minY, 500 + b.maxX / 2, b.maxY));
    const beside = layoutFromBoxes([box(0, 0, 400, 1000), ...half]);
    expect(layoutSignature(beside.tree)).toBe("R(S,S,S,S)");
    expect(beside.guessed).toBe(true);
    const within = chain.map((b) => box(200 + b.minX / 2, 200 + b.minY / 2, 200 + b.maxX / 2, 200 + b.maxY / 2));
    const wrapped = layoutFromBoxes([box(0, 0, 1000, 1000), ...within]);
    expect(layoutSignature(wrapped.tree)).toBe("E:full(R(S,S,S))");
    expect(wrapped.guessed).toBe(true);

    // Cuts and enclosures that were found are no guess.
    expect(layoutFromBoxes([box(600, 0, 1000, 1000), box(0, 0, 400, 1000)]).guessed).toBe(false);
    expect(layoutFromBoxes([box(300, 300, 700, 700), box(0, 0, 1000, 1000)]).guessed).toBe(false);
    expect(layoutFromBoxes([box(500, 0, 1000, 1000), box(50, 550, 400, 950), box(0, 0, 450, 450)]).guessed).toBe(false);
  });

  it("takes no box for an enclosure that the caller says is none", () => {
    const boxes = [box(300, 300, 700, 700), box(0, 0, 1000, 1000)];
    // Not known: the clearance test decides, as without hints.
    expect(layoutSignature(layoutFromBoxes(boxes, [undefined, undefined]).tree)).toBe("E:full(S)");
    expect(layoutSignature(layoutFromBoxes(boxes, [undefined, "top"]).tree)).toBe("E:top(S)");
    // No enclosure: the big box is not replaced by the small one as the outer slot either.
    const refused = layoutFromBoxes(boxes, ["full", null]);
    expect(layoutSignature(refused.tree)).toBe("R(S,S)");
    expect(refused.guessed).toBe(true);
  });

  it("takes a box for an enclosure only with a shape the caller allows", () => {
    const centred = [box(300, 300, 700, 700), box(0, 0, 1000, 1000)];
    const tucked = [box(400, 400, 1000, 1000), box(0, 0, 1000, 1000)];
    const wraps = ["top-left", "bottom-left", "top-right"] as const;
    expect(layoutSignature(layoutFromBoxes(tucked, [undefined, wraps]).tree)).toBe("E:top-left(S)");
    // The clearance test reads "full" here, which the caller did not allow.
    const refused = layoutFromBoxes(centred, [undefined, wraps]);
    expect(layoutSignature(refused.tree)).toBe("R(S,S)");
    expect(refused.guessed).toBe(true);
  });

  it("copes with boxes that have no width or no height", () => {
    // Two upright lines side by side, then one above the other on the same x.
    expect(signatureOf([box(200, 0, 200, 1000), box(800, 0, 800, 1000)])).toBe("R(S,S)");
    expect(signatureOf([box(500, 0, 500, 400), box(500, 600, 500, 1000)])).toBe("C(S,S)");
    // Two identical points.
    const points = layoutFromBoxes([box(5, 5, 5, 5), box(5, 5, 5, 5)]);
    expect(points.order.slice().sort()).toEqual([0, 1]);
    expect(makeLayout(points.tree).slots).toHaveLength(2);
  });

  it("always returns a permutation of the input as slot order", () => {
    const rng = createRng("boxes");
    for (let round = 0; round < 50; round++) {
      const boxes = Array.from({ length: 1 + rng.int(6) }, () => {
        const x = rng.int(800);
        const y = rng.int(800);
        return box(x, y, x + rng.int(400), y + rng.int(400));
      });
      const result = layoutFromBoxes(boxes);
      expect(result.order.slice().sort((a, b) => a - b)).toEqual(boxes.map((_, i) => i));
      expect(makeLayout(result.tree).slots).toHaveLength(boxes.length);
    }
  });
});

describe("layoutCatalogue", () => {
  it("lists the family of structures for a slot count", () => {
    expect(layoutCatalogue(1).map((l) => l.signature)).toEqual(["S"]);
    expect(layoutCatalogue(2)).toHaveLength(9);
    expect(layoutCatalogue(3)).toHaveLength(20);
    expect(layoutCatalogue(4)).toHaveLength(28);
    const three = layoutCatalogue(3).map((l) => l.signature);
    for (const expected of ["R(S,S,S)", "C(S,S,S)", "R(C(S,S),S)", "C(S,R(S,S))", "E:top-left(C(S,S))", "E:full(R(S,S))"]) {
      expect(three).toContain(expected);
    }
  });

  it("lists distinct structures with exactly that many slots", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 9, 12]) {
      const catalogue = layoutCatalogue(count);
      expect(new Set(catalogue.map((l) => l.signature)).size).toBe(catalogue.length);
      for (const layout of catalogue) expect(layout.slots).toHaveLength(count);
    }
  });

  it("never nests a row in a row, a column in a column, or more than two levels", () => {
    for (const layout of layoutCatalogue(5)) {
      expect(layout.signature).not.toMatch(/R\([^()]*R\(|C\([^()]*C\(/);
      expect(layout.signature).not.toMatch(/\([^()]*\([^()]*\(/);
    }
  });

  it("has every enclosure shape", () => {
    const two = layoutCatalogue(2).map((l) => l.signature);
    for (const shape of ENCLOSE_SHAPES) expect(two).toContain(`E:${shape}(S)`);
  });

  it("is empty for counts that are not positive integers", () => {
    expect(layoutCatalogue(0)).toEqual([]);
    expect(layoutCatalogue(-2)).toEqual([]);
    expect(layoutCatalogue(2.5)).toEqual([]);
    expect(layoutCatalogue(Number.NaN)).toEqual([]);
  });
});

describe("alternativeLayouts", () => {
  const signatures = (source: string, count: number, seed: number | string): string[] =>
    alternativeLayouts(parseLayout(source), count, createRng(seed)).map((l) => l.signature);

  it("returns distinct structures with the same slot count, never the original", () => {
    for (const source of ["R(S,S)", "C(S,S,S)", "R(C(S,S),S)", "E:full(S)", "E:top-left(C(S,S))", "R(C(S,S),C(S,S))"]) {
      const original = parseLayout(source);
      for (let seed = 0; seed < 10; seed++) {
        const alternatives = alternativeLayouts(original, 3, createRng(seed));
        expect(alternatives).toHaveLength(3);
        const all = alternatives.map((l) => l.signature);
        expect(new Set(all).size).toBe(3);
        expect(all).not.toContain(source);
        for (const layout of alternatives) expect(layout.slots).toHaveLength(original.slots.length);
      }
    }
  });

  it("puts near misses first", () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(signatures("R(S,S)", 1, seed)).toEqual(["C(S,S)"]);
      expect(signatures("C(S,S,S)", 1, seed)).toEqual(["R(S,S,S)"]);
      expect(signatures("R(C(S,S),S)", 3, seed).sort()).toEqual(["C(S,S,S)", "R(S,C(S,S))", "R(S,S,S)"]);
      // An enclosure: another shape, or opened up into a row or column.
      for (const signature of signatures("E:top-left(C(S,S))", 9, seed)) {
        expect(signature).toMatch(/^E:[a-z-]+\(C\(S,S\)\)$|^E:top-left\(R\(S,S\)\)$|^C\(S,S,S\)$|^R\(S,C\(S,S\)\)$/);
      }
    }
  });

  it("fills up with other structures of the same slot count", () => {
    const all = signatures("R(S,S)", 8, 1);
    expect(all[0]).toBe("C(S,S)");
    expect(all.slice().sort()).toEqual(
      layoutCatalogue(2)
        .map((l) => l.signature)
        .filter((s) => s !== "R(S,S)")
        .sort(),
    );
  });

  it("borrows structures with one slot more or fewer only when it has to", () => {
    const single = alternativeLayouts(parseLayout("S"), 3, createRng(2));
    expect(single).toHaveLength(3);
    for (const layout of single) expect(layout.slots).toHaveLength(2);

    const many = alternativeLayouts(parseLayout("R(S,S)"), 12, createRng(2));
    expect(many).toHaveLength(12);
    expect(new Set(many.map((l) => l.signature)).size).toBe(12);
    expect(many.slice(0, 8).every((l) => l.slots.length === 2)).toBe(true);
    expect(many.slice(8).every((l) => l.slots.length === 1 || l.slots.length === 3)).toBe(true);
  });

  it("returns what exists when asked for more than there is", () => {
    const everything = alternativeLayouts(parseLayout("S"), 1000, createRng(3));
    expect(everything).toHaveLength(9);
  });

  it("returns nothing for a count below one", () => {
    expect(alternativeLayouts(parseLayout("R(S,S)"), 0, createRng(1))).toEqual([]);
    expect(alternativeLayouts(parseLayout("R(S,S)"), -3, createRng(1))).toEqual([]);
    expect(alternativeLayouts(parseLayout("R(S,S)"), Number.NaN, createRng(1))).toEqual([]);
  });

  it("works for structures outside the catalogue", () => {
    const deep = makeLayout(row(column(row(S, S), S), S));
    const alternatives = alternativeLayouts(deep, 3, createRng(4));
    expect(alternatives).toHaveLength(3);
    for (const layout of alternatives) expect(layout.slots).toHaveLength(4);
  });

  it("is deterministic per seed", () => {
    expect(signatures("R(C(S,S),S)", 5, "seed")).toEqual(signatures("R(C(S,S),S)", 5, "seed"));
    const seen = new Set(Array.from({ length: 20 }, (_, seed) => signatures("C(S,S)", 3, seed).join(" ")));
    expect(seen.size).toBeGreaterThan(1);
  });
});
