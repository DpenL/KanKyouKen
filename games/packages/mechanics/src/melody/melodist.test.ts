import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { segmentUnits } from "../glyph/tree";
import type { ComponentNode, Glyph } from "../glyph/types";
import { hashString } from "../util/rng";
import { contourTravel } from "./contour";
import { componentFrame, elementForStroke, generateElements } from "./generate";
import { createMelodist, type MelodistOptions } from "./melodist";
import { detectPrefixes } from "./prefix";
import { NEUTRAL_TIMBRE, TIMBRE_IDS } from "./timbres";
import { DEFAULT_MELODY_CONFIG, DEFAULT_TUNING, stepToPitch } from "./tuning";
import type { MelodicElement, MotifBook } from "./types";

const PREFIXES = detectPrefixes(FIXTURES, FIXTURES.keys());
const melodist = (extra: Partial<MelodistOptions> = {}) =>
  createMelodist({ glyphs: FIXTURES, prefixes: PREFIXES, ...extra });
const unshifted = { tuning: { registerSpread: 0 } };
const step = (s: number): number => stepToPitch(s, DEFAULT_TUNING);
const shiftOf = (component: string): number => hashString(component) % (DEFAULT_TUNING.registerSpread + 1);
const elementsOf = (m: ReturnType<typeof melodist>, char: string): readonly MelodicElement[] =>
  m.melody(fixture(char)).strokes.map((s) => s.element);

const note = (pitch: number, beats = 1): MelodicElement => ({
  contour: [
    { p: 0, pitch },
    { p: 1, pitch },
  ],
  beats,
  pan: 0,
});

/** A copy of a fixture with a different component tree below the root. */
function retree(char: string, children: readonly ComponentNode[]): Glyph {
  const glyph = fixture(char);
  return { ...glyph, root: { ...glyph.root, children } };
}
const node = (id: string, element: string, strokes: readonly number[]): ComponentNode => ({
  id,
  element,
  strokes,
  children: [],
});

describe("createMelodist: motifs", () => {
  it("resolves the configuration", () => {
    expect(melodist().config).toEqual(DEFAULT_MELODY_CONFIG);
    expect(melodist({ config: { tuning: { tonic: 60 } } }).config.tuning).toEqual({ ...DEFAULT_TUNING, tonic: 60 });
    expect(() => melodist({ config: { tuning: { rangeSteps: 0 } } })).toThrow(/melody tuning/);
  });

  it("plays 十 as a steady note, then a fall", () => {
    const motif = melodist({ config: unshifted }).motif("十");
    expect(motif.component).toBe("十");
    expect(motif.origin).toBe("generated");
    expect(motif.prefix).toBeUndefined();
    expect(motif.elements.map((e) => e.contour.map((c) => c.pitch))).toEqual([
      [step(5), step(5)],
      [step(8), step(0)],
    ]);
    const shifted = melodist().motif("十").elements;
    expect(shifted).toHaveLength(2);
    expect(contourTravel(shifted[0]!.contour)).toBe(0);
    expect(contourTravel(shifted[1]!.contour)).toBeLessThan(0);
  });

  it("shifts each component's register by a step count derived from its key", () => {
    const m = melodist();
    for (const component of ["十", "口", "月", "氵"]) {
      const expected = generateElements(fixture(component), fixture(component).strokes.map((_, i) => i), DEFAULT_TUNING, shiftOf(component));
      expect(m.motif(component).elements, component).toEqual(expected);
    }
    expect(new Set(["十", "口", "月", "氵", "木", "囗"].map(shiftOf)).size).toBeGreaterThan(1);
    const flat = melodist({ config: unshifted });
    expect(flat.motif("口").elements).toEqual(generateElements(fixture("口"), [0, 1, 2], DEFAULT_TUNING, 0));
  });

  it("starts 木 with the motif of 十, unchanged, and continues in the same register", () => {
    const m = melodist();
    const ten = m.motif("十");
    const tree = m.motif("木");
    expect(tree.prefix).toEqual({ component: "十", count: 2 });
    expect(tree.origin).toBe("generated");
    expect(tree.elements).toHaveLength(4);
    expect(tree.elements.slice(0, 2)).toEqual(ten.elements);
    expect(tree.elements[0]).toBe(ten.elements[0]);
    expect(tree.elements[1]).toBe(ten.elements[1]);
    const frame = componentFrame(fixture("木"), [0, 1, 2, 3]);
    expect(tree.elements.slice(2)).toEqual(generateElements(fixture("木"), [2, 3], DEFAULT_TUNING, shiftOf("十"), frame));
  });

  it("generates 木 on its own when no prefix table is given", () => {
    const m = createMelodist({ glyphs: FIXTURES, config: unshifted });
    const tree = m.motif("木");
    expect(tree.prefix).toBeUndefined();
    expect(tree.elements).toEqual(generateElements(fixture("木"), [0, 1, 2, 3], DEFAULT_TUNING, 0));
    expect(tree.elements[0]).not.toEqual(m.motif("十").elements[0]);
  });

  it("follows prefix chains", () => {
    const m = melodist();
    const forest = m.motif("林");
    expect(forest.prefix).toEqual({ component: "木", count: 4 });
    expect(forest.elements).toHaveLength(8);
    expect(forest.elements.slice(0, 4)).toEqual(m.motif("木").elements);
    expect(forest.elements.slice(0, 2)).toEqual(m.motif("十").elements);
    const frame = componentFrame(fixture("林"), [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(forest.elements.slice(4)).toEqual(
      generateElements(fixture("林"), [4, 5, 6, 7], DEFAULT_TUNING, shiftOf("十"), frame),
    );
  });

  it("ignores prefix entries that cannot apply", () => {
    const longer = createMelodist({ glyphs: FIXTURES, prefixes: { 十: "木" } });
    expect(longer.motif("十").prefix).toBeUndefined();
    const sameLength = createMelodist({ glyphs: FIXTURES, prefixes: { 木: "月" } });
    expect(sameLength.motif("木").prefix).toBeUndefined();
    const unknown = createMelodist({ glyphs: FIXTURES, prefixes: { 木: "無" } });
    expect(unknown.motif("木").prefix).toBeUndefined();
    const self = createMelodist({ glyphs: FIXTURES, prefixes: { 木: "木" } });
    expect(self.motif("木").prefix).toBeUndefined();
  });

  it("survives a prefix table with a loop, whatever is asked first", () => {
    const loop = { 十: "木", 木: "十" };
    const a = createMelodist({ glyphs: FIXTURES, prefixes: loop });
    const b = createMelodist({ glyphs: FIXTURES, prefixes: loop });
    const treeFirst = [a.motif("木"), a.motif("十")];
    const tenFirst = [b.motif("十"), b.motif("木")].reverse();
    expect(treeFirst).toEqual(tenFirst);
    expect(treeFirst[0]!.prefix).toEqual({ component: "十", count: 2 });
    expect(treeFirst[1]!.prefix).toBeUndefined();
  });

  it("returns the same motif object every time", () => {
    const m = melodist();
    expect(m.motif("木")).toBe(m.motif("木"));
    expect(m.motif("木", { glyph: fixture("沐"), strokes: [3, 4, 5, 6] })).toBe(m.motif("木"));
  });

  it("throws when a component has no book entry, no glyph and no instance", () => {
    const m = melodist();
    expect(() => m.motif("無")).toThrow(/no motif for "無"/);
    expect(() => m.motif("囗")).toThrow(/no motif/);
    expect(() => m.motif("囗", { glyph: fixture("困"), strokes: [] })).toThrow(/no strokes/);
  });
});

describe("createMelodist: motifs from instances", () => {
  it("generates a component without stand-alone glyph from where it occurs", () => {
    const m = melodist();
    const box = fixture("困");
    const enclosure = m.motif("囗", { glyph: box, strokes: [0, 1, 6] });
    expect(enclosure.component).toBe("囗");
    expect(enclosure.elements).toEqual(generateElements(box, [0, 1, 6], DEFAULT_TUNING, shiftOf("囗")));
    expect(enclosure.elements.map((e) => Math.sign(contourTravel(e.contour)))).toEqual([-1, -1, 0]);
  });

  it("lets the first instance with a given stroke count define the motif", () => {
    const m = melodist();
    const first = m.motif("囗", { glyph: fixture("困"), strokes: [0, 1, 6] });
    const other = m.motif("囗", { glyph: fixture("口"), strokes: [0, 1, 2] });
    expect(other).toBe(first);
    const twoStrokes = m.motif("囗", { glyph: fixture("困"), strokes: [0, 1] });
    expect(twoStrokes).not.toBe(first);
    expect(twoStrokes.elements).toHaveLength(2);
  });

  it("uses the instance when the stand-alone glyph has a different stroke count", () => {
    const m = melodist();
    const variant = { glyph: fixture("木"), strokes: [0, 1, 2] };
    const short = m.motif("木", variant);
    expect(short.elements).toHaveLength(3);
    expect(short.prefix).toEqual({ component: "十", count: 2 });
    expect(short.elements.slice(0, 2)).toEqual(m.motif("十").elements);
    expect(m.motif("木").elements).toHaveLength(4);
    expect(m.motif("木", variant)).toBe(short);
  });
});

describe("createMelodist: authored motifs", () => {
  const book: MotifBook = {
    十: { elements: [note(60), note(64, 2)], timbre: "glass" },
    月: { elements: [note(72)] },
  };

  it("lets the book win over the generator", () => {
    const m = melodist({ book });
    const ten = m.motif("十");
    expect(ten).toEqual({ component: "十", timbre: "glass", elements: book["十"]!.elements, origin: "authored" });
    expect(ten.elements).toBe(book["十"]!.elements);
    expect(m.motif("十", { glyph: fixture("胡"), strokes: [0, 1] })).toBe(ten);
    const moon = m.motif("月");
    expect(moon.origin).toBe("authored");
    expect(moon.timbre).toBe(TIMBRE_IDS[hashString("月") % TIMBRE_IDS.length]);
  });

  it("serves an authored motif for a component without any glyph", () => {
    const m = melodist({ book: { 無: { elements: [note(50)] } } });
    expect(m.motif("無").elements).toEqual([note(50)]);
  });

  it("builds generated motifs on an authored prefix", () => {
    const m = melodist({ book });
    const tree = m.motif("木");
    expect(tree.origin).toBe("generated");
    expect(tree.prefix).toEqual({ component: "十", count: 2 });
    expect(tree.elements.slice(0, 2)).toEqual(book["十"]!.elements);
    const frame = componentFrame(fixture("木"), [0, 1, 2, 3]);
    expect(tree.elements.slice(2)).toEqual(generateElements(fixture("木"), [2, 3], DEFAULT_TUNING, shiftOf("十"), frame));
  });

  it("fills in generated elements when an authored motif is shorter than the component", () => {
    const m = melodist({ book });
    const melody = m.melody(fixture("胡"));
    const moon = melody.strokes.slice(5);
    expect(moon[0]!.element).toBe(book["月"]!.elements[0]);
    const frame = componentFrame(fixture("胡"), [5, 6, 7, 8]);
    for (const s of moon.slice(1)) {
      expect(s.element).toEqual(
        elementForStroke(fixture("胡").strokes[s.stroke]!.median, frame, DEFAULT_TUNING, shiftOf("月")),
      );
      expect(s.timbre).toBe(moon[0]!.timbre);
    }
    expect(moon.map((s) => s.indexInComponent)).toEqual([0, 1, 2, 3]);
  });

  it("uses only the first elements when an authored motif is longer than the component", () => {
    const long: MotifBook = { 十: { elements: [note(60), note(62), note(64)] } };
    const m = melodist({ book: long });
    expect(m.melody(fixture("十")).strokes.map((s) => s.element)).toEqual([note(60), note(62)]);
  });
});

describe("createMelodist: timbres", () => {
  const everyTimbre = (m: ReturnType<typeof melodist>): Set<string> =>
    new Set([...FIXTURES.values()].flatMap((glyph) => m.melody(glyph).strokes.map((s) => s.timbre)));

  it("picks a palette entry by hash when there is no alphabet", () => {
    const m = melodist();
    for (const component of ["十", "口", "木", "月", "氵"]) {
      expect(m.motif(component).timbre).toBe(TIMBRE_IDS[hashString(component) % TIMBRE_IDS.length]);
    }
    const two = melodist({ config: { timbre: { palette: ["reed", "glass"] } } });
    expect(two.motif("木").timbre).toBe(["reed", "glass"][hashString("木") % 2]);
  });

  it("hands the palette out in alphabet order when there is an alphabet", () => {
    const alphabet = new Set(["木", "十", "口", "月", "氵", "囗"]);
    const sorted = [...alphabet].sort();
    const m = melodist({ alphabet });
    for (const component of ["十", "口", "木", "月", "氵"]) {
      expect(m.motif(component).timbre).toBe(TIMBRE_IDS[sorted.indexOf(component)]);
    }
    expect(m.melody(fixture("困")).strokes[0]!.timbre).toBe(TIMBRE_IDS[sorted.indexOf("囗")]);
    expect(everyTimbre(m).size).toBe(6);
    const small = melodist({ alphabet, config: { timbre: { palette: ["reed", "glass"] } } });
    expect(small.motif("木").timbre).toBe(["reed", "glass"][sorted.indexOf("木") % 2]);
  });

  it("falls back to the hash for a component outside the alphabet", () => {
    const m = melodist({ alphabet: new Set(["十", "口"]) });
    const melody = m.melody(fixture("月"));
    expect(melody.units.map((u) => u.component)).toEqual(["月"]);
    expect(melody.strokes[0]!.timbre).toBe(TIMBRE_IDS[hashString("月") % TIMBRE_IDS.length]);
  });

  it("lets fixed assignments win", () => {
    const m = melodist({ config: { timbre: { assigned: { 木: "whistle" } } } });
    expect(m.motif("木").timbre).toBe("whistle");
    expect(m.motif("十").timbre).toBe(TIMBRE_IDS[hashString("十") % TIMBRE_IDS.length]);
    const authored = melodist({
      book: { 十: { elements: [note(60)], timbre: "glass" } },
      config: { timbre: { assigned: { 十: "reed" } } },
    });
    expect(authored.motif("十").timbre).toBe("reed");
  });

  it("uses one timbre everywhere in single mode", () => {
    expect(everyTimbre(melodist({ config: { timbre: { mode: "single" } } }))).toEqual(new Set([TIMBRE_IDS[0]]));
    const glass = melodist({
      config: { timbre: { mode: "single", palette: ["glass", "reed"] } },
      book: { 十: { elements: [note(60), note(62)], timbre: "organ" } },
    });
    expect(everyTimbre(glass)).toEqual(new Set(["glass"]));
    const loose = glass.melody(retree("古", [node("r.0", "十", [0, 1])]));
    expect(loose.strokes.map((s) => s.timbre)).toEqual(["glass", "glass", "glass", "glass", "glass"]);
  });

  it("falls back to the neutral timbre when the palette is empty", () => {
    const m = melodist({ config: { timbre: { palette: [] } } });
    expect(everyTimbre(m)).toEqual(new Set([NEUTRAL_TIMBRE]));
  });
});

describe("createMelodist: melodies", () => {
  it("describes every stroke of a character in writing order", () => {
    const m = melodist();
    const glyph = fixture("胡");
    const melody = m.melody(glyph);
    expect(melody.char).toBe("胡");
    expect(melody.units).toEqual(segmentUnits(glyph));
    expect(melody.strokes.map((s) => s.stroke)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(melody.strokes.map((s) => s.component)).toEqual(["十", "十", "口", "口", "口", "月", "月", "月", "月"]);
    expect(melody.strokes.map((s) => s.indexInComponent)).toEqual([0, 1, 0, 1, 2, 0, 1, 2, 3]);
    expect(melody.strokes.map((s) => s.unit)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2]);
    expect(melody.strokes.map((s) => s.startsUnit)).toEqual([true, false, true, false, false, true, false, false, false]);
  });

  it("plays 胡 as the motifs of 十, 口 and 月, one after the other", () => {
    const m = melodist();
    const melody = m.melody(fixture("胡"));
    const motifs = [m.motif("十"), m.motif("口"), m.motif("月")];
    expect(melody.strokes.map((s) => s.element)).toEqual(motifs.flatMap((motif) => motif.elements));
    expect(melody.strokes.map((s) => s.timbre)).toEqual(
      motifs.flatMap((motif) => motif.elements.map(() => motif.timbre)),
    );
  });

  it("makes 木 sound the same alone, inside 沐, inside 困 and twice in 林", () => {
    const m = melodist();
    const tree = m.motif("木");
    expect(elementsOf(m, "木")).toEqual(tree.elements);
    expect(elementsOf(m, "沐").slice(3)).toEqual(tree.elements);
    expect(elementsOf(m, "困").slice(2, 6)).toEqual(tree.elements);
    const forest = m.melody(fixture("林"));
    expect(forest.strokes.slice(0, 4).map((s) => s.element)).toEqual(tree.elements);
    expect(forest.strokes.slice(4).map((s) => s.element)).toEqual(tree.elements);
    expect(new Set(forest.strokes.map((s) => s.timbre))).toEqual(new Set([tree.timbre]));
    expect(forest.strokes.map((s) => s.indexInComponent)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(forest.strokes.map((s) => s.unit)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("lets a single-component character sound like its component", () => {
    const m = melodist();
    const melody = m.melody(fixture("十"));
    expect(melody.units).toEqual([{ component: "十", nodeIds: ["r"], strokes: [0, 1], offset: 0 }]);
    expect(melody.strokes.map((s) => s.element)).toEqual(m.motif("十").elements);
  });

  it("splits the enclosure's motif around 木 in 困, offsets continuing", () => {
    const m = melodist();
    const glyph = fixture("困");
    const melody = m.melody(glyph);
    expect(melody.units).toEqual([
      { component: "囗", nodeIds: ["r.0"], strokes: [0, 1], offset: 0 },
      { component: "木", nodeIds: ["r.1"], strokes: [2, 3, 4, 5], offset: 0 },
      { component: "囗", nodeIds: ["r.2"], strokes: [6], offset: 2 },
    ]);
    const enclosure = m.motif("囗", { glyph, strokes: [0, 1, 6] });
    expect(enclosure.elements).toHaveLength(3);
    const byStroke = melody.strokes;
    expect([byStroke[0]!.element, byStroke[1]!.element, byStroke[6]!.element]).toEqual(enclosure.elements);
    expect(byStroke.map((s) => s.indexInComponent)).toEqual([0, 1, 0, 1, 2, 3, 2]);
    expect(byStroke.map((s) => s.unit)).toEqual([0, 0, 1, 1, 1, 1, 2]);
    expect(byStroke.map((s) => s.startsUnit)).toEqual([true, false, true, false, false, false, true]);
    expect(byStroke[6]!.timbre).toBe(byStroke[0]!.timbre);
    // The closing stroke is heard in the frame of the whole enclosure: at its bottom.
    expect(byStroke[6]!.element.contour[0]!.pitch).toBe(stepToPitch(shiftOf("囗"), DEFAULT_TUNING));
  });

  it("treats a composite as one component when the alphabet says so, reusing its prefix", () => {
    const m = melodist({ alphabet: new Set(["古", "月"]) });
    const melody = m.melody(fixture("胡"));
    expect(melody.units.map((u) => [u.component, u.strokes.length])).toEqual([
      ["古", 5],
      ["月", 4],
    ]);
    const old = m.motif("古");
    expect(old.prefix).toEqual({ component: "十", count: 2 });
    expect(melody.strokes.slice(0, 5).map((s) => s.element)).toEqual(old.elements);
    expect(melody.strokes.slice(0, 2).map((s) => s.element)).toEqual(m.motif("十").elements);
    expect(melody.strokes.slice(0, 5).map((s) => s.indexInComponent)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives loose strokes their own unshifted elements in the neutral timbre", () => {
    const m = melodist();
    const glyph = retree("古", [node("r.0", "十", [0, 1])]);
    const melody = m.melody(glyph);
    expect(melody.units.map((u) => u.component)).toEqual(["十", null]);
    const loose = melody.strokes.slice(2);
    expect(loose.map((s) => s.element)).toEqual(generateElements(glyph, [2, 3, 4], DEFAULT_TUNING, 0));
    expect(loose.map((s) => s.timbre)).toEqual([NEUTRAL_TIMBRE, NEUTRAL_TIMBRE, NEUTRAL_TIMBRE]);
    expect(loose.map((s) => s.component)).toEqual([null, null, null]);
    expect(loose.map((s) => s.indexInComponent)).toEqual([0, 1, 2]);
    expect(loose.map((s) => s.startsUnit)).toEqual([true, false, false]);
    expect(melody.strokes.slice(0, 2).map((s) => s.element)).toEqual(m.motif("十").elements);
  });

  it("caches by character and recomposes for a different glyph of the same character", () => {
    const m = melodist();
    const glyph = fixture("沐");
    const first = m.melody(glyph);
    expect(m.melody(glyph)).toBe(first);
    const regrouped = retree("沐", [node("r.0", "氵", [0, 1, 2])]);
    const second = m.melody(regrouped);
    expect(second).not.toBe(first);
    expect(second.units.map((u) => u.component)).toEqual(["氵", null]);
    expect(m.melody(regrouped)).toBe(second);
  });

  it("is deterministic: equal options give equal motifs and melodies", () => {
    const a = melodist();
    const b = melodist();
    const forwards = [...FIXTURES.values()];
    const backwards = [...forwards].reverse();
    const fromA = new Map(forwards.map((glyph) => [glyph.char, a.melody(glyph)]));
    const fromB = new Map(backwards.map((glyph) => [glyph.char, b.melody(glyph)]));
    for (const glyph of forwards) expect(fromB.get(glyph.char), glyph.char).toEqual(fromA.get(glyph.char));
    for (const component of ["十", "口", "木", "月", "氵"]) expect(b.motif(component)).toEqual(a.motif(component));
    expect(JSON.parse(JSON.stringify(fromA.get("胡")))).toEqual(fromA.get("胡"));
  });
});
