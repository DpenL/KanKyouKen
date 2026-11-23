import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import type { Glyph } from "../glyph/types";
import { pointAt, polylineLength } from "../util/geometry";
import { createRng } from "../util/rng";
import { shapeDistance } from "./lookalike";
import { MUTATION_KINDS, mutateGlyph, mutationsFor } from "./mutate";
import { EARTH_LINES, SCHOLAR_LINES, handGlyph, withPath } from "./test-glyphs";
import type { MutationKind } from "./types";

const earth = handGlyph("土", EARTH_LINES);
const bar = handGlyph("一", [
  [
    [100, 500],
    [900, 500],
  ],
]);

const paths = (glyph: Glyph): string[] => glyph.strokes.map((s) => s.path);
const medians = (glyph: Glyph): number[][] => glyph.strokes.map((s) => s.median.flatMap((p) => [p.x, p.y]));

function expectDerived(mutated: Glyph | null, from: Glyph, kind: MutationKind): asserts mutated is Glyph {
  expect(mutated).not.toBeNull();
  const glyph = mutated!;
  expect(glyph.char).toBe(`${from.char}~${kind}`);
  expect(glyph.size).toBe(from.size);
  expect(glyph.script).toBe(from.script);
  expect(glyph.pathKind).toBe(from.pathKind);
  expect(glyph.source).toEqual(from.source);
  expect(glyph.root).toEqual({
    id: "r",
    element: glyph.char,
    strokes: glyph.strokes.map((_, i) => i),
    children: [],
  });
  for (const stroke of glyph.strokes) expect(stroke.median.length).toBeGreaterThanOrEqual(2);
}

describe("mutateGlyph: drop-stroke", () => {
  it("removes one of the two shortest strokes", () => {
    const tree = fixture("木");
    const dropped = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const mutated = mutateGlyph(tree, "drop-stroke", createRng(seed));
      expectDerived(mutated, tree, "drop-stroke");
      expect(mutated.strokes).toHaveLength(3);
      // The bar and the upright (800 long) stay; one of the two diagonals goes.
      expect(mutated.strokes.slice(0, 2)).toEqual(tree.strokes.slice(0, 2));
      expect([tree.strokes[2], tree.strokes[3]]).toContainEqual(mutated.strokes[2]);
      dropped.add(mutated.strokes[2]!.path);
    }
    expect(dropped.size).toBe(2);
  });

  it("needs at least three strokes", () => {
    expect(mutateGlyph(fixture("十"), "drop-stroke", createRng(1))).toBeNull();
    expect(mutateGlyph(bar, "drop-stroke", createRng(1))).toBeNull();
    expect(mutateGlyph(fixture("口"), "drop-stroke", createRng(1))).not.toBeNull();
  });

  it("keeps the remaining strokes in order and leaves the original alone", () => {
    const before = JSON.stringify(earth);
    const mutated = mutateGlyph(earth, "drop-stroke", createRng(3));
    expectDerived(mutated, earth, "drop-stroke");
    // The short bar (400) and the upright (700) are the two shortest; the long bar stays.
    expect(mutated.strokes).toHaveLength(2);
    expect(mutated.strokes[1]).toEqual(earth.strokes[2]);
    expect(JSON.stringify(earth)).toBe(before);
  });
});

describe("mutateGlyph: extra-stroke", () => {
  it("doubles the level stroke, moved by 12% of the box height toward the roomier side", () => {
    const cross = fixture("十");
    const mutated = mutateGlyph(cross, "extra-stroke", createRng(1));
    expectDerived(mutated, cross, "extra-stroke");
    // Bar at y = 450 in a box from 100 to 900: more room below, 0.12 * 800 = 96 down.
    expect(paths(mutated)).toEqual(["M100,450L900,450", "M100,546L900,546", "M500,100L500,900"]);
    expect(medians(mutated)).toEqual([
      [100, 450, 900, 450],
      [100, 546, 900, 546],
      [500, 100, 500, 900],
    ]);
    expect(mutated.strokes[1]!.type).toBe(cross.strokes[0]!.type);
  });

  it("moves the copy up, and writes it first, when there is more room above", () => {
    const mutated = mutateGlyph(fixture("口"), "extra-stroke", createRng(1));
    expectDerived(mutated, fixture("口"), "extra-stroke");
    // Only the closing bar at y = 800 is level; box 200..800, so 72 up.
    expect(paths(mutated)).toEqual([
      "M200,200L200,800",
      "M200,200L800,200L800,800",
      "M200,728L800,728",
      "M200,800L800,800",
    ]);
  });

  it("lets the seed decide between equally level strokes", () => {
    const moon = fixture("月");
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const mutated = mutateGlyph(moon, "extra-stroke", createRng(seed));
      expectDerived(mutated, moon, "extra-stroke");
      expect(mutated.strokes).toHaveLength(5);
      seen.add(paths(mutated).join(" "));
    }
    // Bar at 370 doubled downward (to 466) or bar at 630 doubled upward (to 534).
    expect([...seen].sort()).toEqual(
      [
        "M250,100L250,600L150,900 M250,100L750,100L750,900L650,850 M250,370L750,370 M250,466L750,466 M250,630L750,630",
        "M250,100L250,600L150,900 M250,100L750,100L750,900L650,850 M250,370L750,370 M250,534L750,534 M250,630L750,630",
      ].sort(),
    );
  });

  it("prefers the most level stroke over a merely gentle one", () => {
    const glyph = handGlyph("二", [
      [
        [100, 200],
        [900, 380],
      ],
      [
        [100, 800],
        [900, 810],
      ],
    ]);
    const mutated = mutateGlyph(glyph, "extra-stroke", createRng(5));
    expectDerived(mutated, glyph, "extra-stroke");
    // Box height 610, so the lower bar is doubled 73.2 above itself.
    expect(medians(mutated)[1]).toEqual([100, 726.8, 900, 736.8]);
    expect(paths(mutated)[1]).toBe("M100,726.8L900,736.8");
  });

  it("does not apply without a level stroke", () => {
    expect(mutateGlyph(fixture("氵"), "extra-stroke", createRng(1))).toBeNull();
    const steep = handGlyph("丿", [
      [
        [600, 100],
        [300, 900],
      ],
      [
        [100, 100],
        [500, 220],
      ],
    ]);
    expect(mutateGlyph(steep, "extra-stroke", createRng(1))).toBeNull();
  });

  it("uses the width when the glyph is a single level line", () => {
    const mutated = mutateGlyph(bar, "extra-stroke", createRng(1));
    expectDerived(mutated, bar, "extra-stroke");
    expect(paths(mutated)).toEqual(["M100,500L900,500", "M100,596L900,596"]);
  });

  it("moves any path syntax together with the median", () => {
    const cross = fixture("十");
    const shifted = (path: string): string => {
      const mutated = mutateGlyph(withPath(cross, 0, path), "extra-stroke", createRng(1));
      expectDerived(mutated, cross, "extra-stroke");
      expect(medians(mutated)[1]).toEqual([100, 546, 900, 546]);
      return mutated.strokes[1]!.path;
    };
    // Relative commands keep their offsets; only the start moves.
    expect(shifted("m100,450 l800,0")).toBe("M100,546l800,0");
    expect(shifted("M100,450c200-30,600,30,800,0")).toBe("M100,546c200,-30,600,30,800,0");
    // Absolute curves, shorthand and implicit line-to pairs.
    expect(shifted("M 100 450 C 300 420 700 480 900 450")).toBe("M100,546C300,516,700,576,900,546");
    expect(shifted("M100,450 500,440 900,450")).toBe("M100,546L500,536L900,546");
    expect(shifted("M100 450 Q500 400 900 450 T950 450 S960 460 970 450")).toBe(
      "M100,546Q500,496,900,546T950,546S960,556,970,546",
    );
    // Horizontal and vertical line-to, close-path, decimals without separators.
    expect(shifted("M100,450H900V460H100Z")).toBe("M100,546H900V556H100Z");
    expect(shifted("M100.5.5h1.5.5v-3")).toBe("M100.5,96.5h1.5h0.5v-3");
    // Arcs: radii, rotation and flags stay, flags may be run together.
    expect(shifted("M100,450A400,50 0 01900,450a5 5 10 1 0 10 10")).toBe("M100,546A400,50,0,0,1,900,546a5,5,10,1,0,10,10");
  });

  it("rebuilds a centerline path it cannot read, and gives up on an outline it cannot read", () => {
    const broken = withPath(fixture("十"), 0, "M100,450 X 900,450");
    const mutated = mutateGlyph(broken, "extra-stroke", createRng(1));
    expectDerived(mutated, broken, "extra-stroke");
    expect(mutated.strokes[1]!.path).toBe("M100,546 L900,546");
    expect(mutated.strokes[0]!.path).toBe("M100,450 X 900,450");

    const outline: Glyph = { ...broken, pathKind: "outline" };
    expect(mutateGlyph(outline, "extra-stroke", createRng(1))).toBeNull();
    for (const bad of ["", "100,450", "M100", "M100,450L", "M100,450A1,1,0,2,0,5,5"]) {
      expect(mutateGlyph({ ...withPath(fixture("十"), 0, bad), pathKind: "outline" }, "extra-stroke", createRng(1))).toBeNull();
    }
  });

  it("moves outlines too", () => {
    const outline: Glyph = { ...withPath(fixture("十"), 0, "M100,430L900,430L900,470L100,470Z"), pathKind: "outline" };
    const mutated = mutateGlyph(outline, "extra-stroke", createRng(1));
    expectDerived(mutated, outline, "extra-stroke");
    expect(mutated.strokes[1]!.path).toBe("M100,526L900,526L900,566L100,566Z");
  });
});

describe("mutateGlyph: swap-lengths", () => {
  it("turns 土 into 士: the two bars trade lengths about their own middles", () => {
    const mutated = mutateGlyph(earth, "swap-lengths", createRng(1));
    expectDerived(mutated, earth, "swap-lengths");
    expect(medians(mutated)).toEqual(SCHOLAR_LINES.map((line) => line.flat()));
    expect(paths(mutated)).toEqual(["M100,400 L900,400", "M500,150L500,850", "M300,850 L700,850"]);
    expect(shapeDistance(mutated, handGlyph("士", SCHOLAR_LINES))).toBeCloseTo(0, 10);
    expect(shapeDistance(mutated, earth)).toBeGreaterThan(0);
  });

  it("keeps each stroke's middle and direction, and trades the exact lengths", () => {
    const glyph = handGlyph("三", [
      [
        [300, 200],
        [500, 210],
        [700, 200],
      ],
      [
        [900, 800],
        [100, 780],
      ],
    ]);
    const mutated = mutateGlyph(glyph, "swap-lengths", createRng(1));
    expectDerived(mutated, glyph, "swap-lengths");
    const [a, b] = glyph.strokes;
    const [a2, b2] = mutated.strokes;
    expect(polylineLength(a2!.median)).toBeCloseTo(polylineLength(b!.median), 6);
    expect(polylineLength(b2!.median)).toBeCloseTo(polylineLength(a!.median), 6);
    expect(pointAt(a2!.median, 0.5).x).toBeCloseTo(pointAt(a!.median, 0.5).x, 6);
    expect(pointAt(b2!.median, 0.5).y).toBeCloseTo(pointAt(b!.median, 0.5).y, 6);
    expect(a2!.median).toHaveLength(3);
    // Still drawn right to left.
    expect(b2!.median[0]!.x).toBeGreaterThan(b2!.median[1]!.x);
    // Paths are polylines through the new medians.
    expect(a2!.path).toMatch(/^M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+$/);
    const numbers = a2!.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    a2!.median.forEach((p, i) => {
      expect(numbers[2 * i]).toBeCloseTo(p.x, 2);
      expect(numbers[2 * i + 1]).toBeCloseTo(p.y, 2);
    });
  });

  it("needs two level strokes whose lengths differ by at least 20%", () => {
    // 月: two bars of equal length. 十: one bar. 氵: none.
    expect(mutateGlyph(fixture("月"), "swap-lengths", createRng(1))).toBeNull();
    expect(mutateGlyph(fixture("十"), "swap-lengths", createRng(1))).toBeNull();
    expect(mutateGlyph(fixture("氵"), "swap-lengths", createRng(1))).toBeNull();
    const pair = (short: number): Glyph =>
      handGlyph("二", [
        [
          [0, 300],
          [short, 300],
        ],
        [
          [0, 700],
          [1000, 700],
        ],
      ]);
    expect(mutateGlyph(pair(850), "swap-lengths", createRng(1))).toBeNull();
    expect(mutateGlyph(pair(800), "swap-lengths", createRng(1))).not.toBeNull();
    expect(mutateGlyph(pair(400), "swap-lengths", createRng(1))).not.toBeNull();
  });

  it("lets the seed pick the pair when several qualify", () => {
    const three = handGlyph("三", [
      [
        [300, 200],
        [700, 200],
      ],
      [
        [200, 500],
        [800, 500],
      ],
      [
        [50, 800],
        [950, 800],
      ],
    ]);
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const mutated = mutateGlyph(three, "swap-lengths", createRng(seed));
      expectDerived(mutated, three, "swap-lengths");
      const lengths = mutated.strokes.map((s) => Math.round(polylineLength(s.median)));
      expect([...lengths].sort((x, y) => x - y)).toEqual([400, 600, 900]);
      seen.add(lengths.join(","));
    }
    expect([...seen].sort()).toEqual(["400,900,600", "600,400,900", "900,600,400"]);
  });

  it("scales an outline with its median instead of flattening it to a line", () => {
    const outline: Glyph = {
      ...withPath(withPath(earth, 0, "M300,380L700,380L700,420L300,420Z"), 2, "M100,830h800v40h-800z"),
      pathKind: "outline",
    };
    const mutated = mutateGlyph(outline, "swap-lengths", createRng(1));
    expectDerived(mutated, outline, "swap-lengths");
    expect(medians(mutated)).toEqual(SCHOLAR_LINES.map((line) => line.flat()));
    // Twice as long and thick about (500, 400); half as long and thick about (500, 850).
    expect(mutated.strokes[0]!.path).toBe("M100,360L900,360L900,440L100,440Z");
    expect(mutated.strokes[2]!.path).toBe("M300,840h400v20h-400z");
    expect(mutateGlyph(withPath(outline, 0, "nonsense"), "swap-lengths", createRng(1))).toBeNull();
  });

  it("leaves the original alone", () => {
    const before = JSON.stringify(earth);
    mutateGlyph(earth, "swap-lengths", createRng(1));
    mutateGlyph(earth, "extra-stroke", createRng(1));
    expect(JSON.stringify(earth)).toBe(before);
  });
});

describe("mutationsFor", () => {
  const kindsOf = (glyph: Glyph): string[] =>
    mutationsFor(glyph, createRng(1)).map((m) => m.char.slice(glyph.char.length + 1));

  it("returns every mutation that applies, in a fixed order", () => {
    expect(MUTATION_KINDS).toEqual(["drop-stroke", "extra-stroke", "swap-lengths"]);
    expect(kindsOf(earth)).toEqual(["drop-stroke", "extra-stroke", "swap-lengths"]);
    expect(kindsOf(fixture("木"))).toEqual(["drop-stroke", "extra-stroke"]);
    expect(kindsOf(fixture("十"))).toEqual(["extra-stroke"]);
    expect(kindsOf(fixture("氵"))).toEqual(["drop-stroke"]);
  });

  it("returns nothing when no mutation applies", () => {
    const slashes = handGlyph("八", [
      [
        [450, 100],
        [100, 900],
      ],
      [
        [550, 100],
        [900, 900],
      ],
    ]);
    expect(mutationsFor(slashes, createRng(1))).toEqual([]);
  });

  it("makes shapes that are close to, but not the same as, the original", () => {
    for (const glyph of [...FIXTURES.values(), earth]) {
      for (const mutated of mutationsFor(glyph, createRng(glyph.char))) {
        const d = shapeDistance(glyph, mutated);
        expect(d).toBeGreaterThan(0);
        // A mutation changes one stroke, so it stays well below "nothing in common".
        expect(d).toBeLessThan(0.25);
        expect(mutated.char.startsWith(`${glyph.char}~`)).toBe(true);
      }
    }
  });

  it("is deterministic per seed", () => {
    for (const glyph of [fixture("木"), fixture("月"), earth]) {
      expect(mutationsFor(glyph, createRng("same"))).toEqual(mutationsFor(glyph, createRng("same")));
    }
  });
});
