import { describe, expect, it } from "vitest";
import { makeLayout, parseLayout, type LayoutSlot } from "@kankyouken/mechanics/components";
import { loadStarterJa } from "@kankyouken/glyph-data";
import { loopsPath, missAnchor, slotOutline, stretchBox, tileBox } from "./frame";

function area(loop: readonly { x: number; y: number }[]): number {
  let sum = 0;
  loop.forEach((point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

const outer = (signature: string): LayoutSlot => parseLayout(signature).slots[0]!;

describe("slotOutline", () => {
  it("pulls a plain slot in by half the gap", () => {
    const loops = slotOutline({ rect: { x: 0, y: 0, w: 0.5, h: 1 } }, 0.04);
    expect(loops).toHaveLength(1);
    const expected = [
      [0.02, 0.02],
      [0.48, 0.02],
      [0.48, 0.98],
      [0.02, 0.98],
    ];
    loops[0]!.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expected[index]![0]!);
      expect(point.y).toBeCloseTo(expected[index]![1]!);
    });
  });

  it("gives a ring for a full enclosure", () => {
    const loops = slotOutline(outer("E:full(S)"), 0.04);
    expect(loops).toHaveLength(2);
    expect(loops.map((loop) => loop.length)).toEqual([4, 4]);
  });

  it("gives one U-shaped loop for a gate", () => {
    const slot = outer("E:top(S)");
    const loops = slotOutline(slot, 0.04);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(8);
    // The opening reaches the bottom edge of the outline.
    const bottom = Math.max(...loops[0]!.map((point) => point.y));
    expect(loops[0]!.filter((point) => point.y === bottom)).toHaveLength(4);
  });

  it.each(["E:top-left(S)", "E:bottom-left(S)", "E:top-right(S)"])("gives one L-shaped loop for %s", (signature) => {
    const loops = slotOutline(outer(signature), 0.04);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it("never overlaps the slots inside the hole", () => {
    for (const signature of ["E:full(S)", "E:top(C(S,S))", "E:left(S)", "E:bottom(R(S,S))"]) {
      const layout = parseLayout(signature);
      const gap = 0.04;
      const [first, ...inner] = layout.slots.map((slot) => slotOutline(slot, gap));
      const wall = area(first![0]!) - (first![1] ? area(first![1]) : 0);
      const inside = inner.reduce((sum, loops) => sum + area(loops[0]!), 0);
      expect(wall).toBeGreaterThan(0);
      expect(wall + inside).toBeLessThan(1);
    }
  });

  it("works on nested structures", () => {
    const layout = makeLayout({ kind: "row", children: [{ kind: "slot" }, { kind: "enclose", shape: "top", inner: { kind: "slot" } }] });
    const loops = slotOutline(layout.slots[1]!, 0.04);
    expect(loops).toHaveLength(1);
    expect(Math.min(...loops[0]!.map((point) => point.x))).toBeCloseTo(0.52);
  });
});

describe("loopsPath", () => {
  it("writes closed sub-paths in frame units", () => {
    expect(loopsPath(slotOutline({ rect: { x: 0, y: 0, w: 1, h: 1 } }, 0), 100)).toBe("M0 0L100 0L100 100L0 100Z");
    expect(loopsPath(slotOutline(outer("E:full(S)"), 0.04), 100).match(/M/g)).toHaveLength(2);
  });
});

describe("missAnchor", () => {
  const inside = (slot: LayoutSlot, point: { x: number; y: number }): boolean => {
    const hole = slot.hole!;
    return point.x > hole.x && point.x < hole.x + hole.w && point.y > hole.y && point.y < hole.y + hole.h;
  };

  it("starts plain slots at the top left, going right", () => {
    expect(missAnchor({ rect: { x: 0.5, y: 0, w: 0.5, h: 1 } })).toEqual({ corner: { x: 0.5, y: 0 }, step: { x: 1, y: 0 } });
  });

  it.each(["full", "top-left", "bottom-left", "top-right", "top", "bottom", "left"])("keeps marks of a %s enclosure on its wall", (shape) => {
    const slot = outer(`E:${shape}(S)`);
    const { corner, step } = missAnchor(slot);
    // Three marks of side 0.13, laid out as the drawing code does.
    for (let n = 0; n < 3; n++) {
      const x = corner.x + (step.x < 0 ? -0.1 : 0.1) + step.x * n * 0.145;
      const y = corner.y + 0.1 + step.y * n * 0.145;
      expect(inside(slot, { x, y })).toBe(false);
    }
  });
});

describe("shape boxes", () => {
  const { glyphs } = loadStarterJa();

  it("fits a tile's shape into a square that contains every stroke", () => {
    for (const char of ["口", "氵", "一", "門"]) {
      const glyph = glyphs.get(char);
      if (glyph === undefined) continue;
      const box = tileBox(glyph);
      expect(box.w).toBeCloseTo(box.h);
      for (const stroke of glyph.strokes) {
        for (const point of stroke.median) {
          expect(point.x).toBeGreaterThan(box.x);
          expect(point.x).toBeLessThan(box.x + box.w);
          expect(point.y).toBeGreaterThan(box.y);
          expect(point.y).toBeLessThan(box.y + box.h);
        }
      }
    }
  });

  it("keeps small shapes small and flat shapes from collapsing", () => {
    const one = glyphs.get("一")!;
    expect(tileBox(one).w).toBeGreaterThanOrEqual(one.size * 0.5);
    expect(stretchBox(one).h).toBeGreaterThan(one.size * 0.14);
    expect(stretchBox(one).w).toBeGreaterThan(stretchBox(one).h);
  });
});
