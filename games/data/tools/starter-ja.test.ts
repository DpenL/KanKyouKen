import { describe, expect, it } from "vitest";
import { decodeGlyphSet, segmentUnits } from "@kankyouken/mechanics/glyph";
import type { ComponentNode, Glyph } from "@kankyouken/mechanics/glyph";
import { loadStarterJa, setCharacters, STARTER_JA_GLYPHS, STARTER_JA_SET } from "../index";
import { KANJIVG_SOURCE, serializeGlyphSet } from "./glyph-set";

const { glyphs, set } = loadStarterJa();

function elements(glyph: Glyph): Set<string> {
  const out = new Set<string>();
  const visit = (node: ComponentNode): void => {
    if (node.element !== undefined) out.add(node.element);
    node.children.forEach(visit);
  };
  glyph.root.children.forEach(visit);
  return out;
}

const units = (char: string, alphabet?: ReadonlySet<string>): (string | null)[] =>
  segmentUnits(glyphs.get(char)!, alphabet ? { alphabet } : {}).map((u) => u.component);

describe("STARTER_JA_GLYPHS", () => {
  it("carries the header and the attribution the license asks for", () => {
    expect(STARTER_JA_GLYPHS.format).toBe("kankyouken-glyphs");
    expect(STARTER_JA_GLYPHS.version).toBe(1);
    expect(STARTER_JA_GLYPHS.script).toBe("ja");
    expect(STARTER_JA_GLYPHS.size).toBe(1000);
    expect(STARTER_JA_GLYPHS.pathKind).toBe("centerline");
    expect(STARTER_JA_GLYPHS.source).toMatchObject(KANJIVG_SOURCE);
    expect(STARTER_JA_GLYPHS.source.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is sorted by code point without duplicates", () => {
    const points = STARTER_JA_GLYPHS.glyphs.map((g) => g.char.codePointAt(0)!);
    for (let i = 1; i < points.length; i++) expect(points[i]!).toBeGreaterThan(points[i - 1]!);
  });

  it("is stored exactly as the build serialises it", () => {
    expect(JSON.parse(serializeGlyphSet(STARTER_JA_GLYPHS))).toEqual(STARTER_JA_GLYPHS);
  });

  it("holds well-formed strokes inside the square", () => {
    const { size } = STARTER_JA_GLYPHS;
    for (const { char, strokes } of STARTER_JA_GLYPHS.glyphs) {
      expect(strokes.length, char).toBeGreaterThan(0);
      for (const [path, median, type] of strokes) {
        expect(path, char).toMatch(/^M[0-9.,]+(?:[LCQ][0-9.,]+)+$/);
        expect(path, char).not.toMatch(/\.\d\d/);
        expect(median.length, char).toBeGreaterThanOrEqual(4);
        expect(median.length, char).toBeLessThanOrEqual(28);
        expect(median.every((v) => Number.isInteger(v) && v >= 0 && v <= size), char).toBe(true);
        for (let i = 2; i < median.length; i += 2) {
          expect(median[i] !== median[i - 2] || median[i + 1] !== median[i - 1], char).toBe(true);
        }
        expect(typeof type, char).toBe("string");
      }
    }
  });
});

describe("loadStarterJa", () => {
  it("decodes every glyph and hands back the set definition", () => {
    expect(glyphs.size).toBe(STARTER_JA_GLYPHS.glyphs.length);
    expect(set).toBe(STARTER_JA_SET);
    expect(set.id).toBe("starter-ja");
    expect(glyphs.get("木")).toMatchObject({ char: "木", script: "ja", size: 1000, pathKind: "centerline" });
    expect(glyphs.get("木")!.source).toEqual({ name: "kanjivg", license: "CC-BY-SA-3.0" });
    expect(glyphs.get("木")!.strokes).toHaveLength(4);
  });

  it("decodes afresh on every call", () => {
    const again = loadStarterJa();
    expect(again.glyphs).not.toBe(glyphs);
    expect(again.glyphs).toEqual(decodeGlyphSet(STARTER_JA_GLYPHS));
  });

  it("has a glyph for every character the set mentions", () => {
    const missing = setCharacters(set).filter((char) => !glyphs.has(char));
    expect(missing).toEqual([]);
    expect(glyphs.size).toBeGreaterThan(setCharacters(set).length);
  });

  it("has a root that covers all strokes and is named after the character", () => {
    for (const glyph of glyphs.values()) {
      expect(glyph.root.element, glyph.char).toBe(glyph.char);
      expect(glyph.root.strokes, glyph.char).toEqual(glyph.strokes.map((_, i) => i));
    }
  });

  it("finds every lesson component in the lesson that introduces it", () => {
    for (const lesson of set.lessons) {
      for (const component of lesson.components) {
        const users = lesson.chars.filter((char) => char === component || elements(glyphs.get(char)!).has(component));
        expect(users.length, `${component} in ${lesson.title}`).toBeGreaterThan(0);
      }
    }
  });

  it("builds every lesson character from components met so far, unless it is written in one piece", () => {
    const introduced = new Set<string>();
    for (const lesson of set.lessons) {
      for (const component of lesson.components) introduced.add(component);
      for (const char of lesson.chars) {
        const parts = elements(glyphs.get(char)!);
        const familiar = parts.size === 0 || introduced.has(char) || [...parts].some((part) => introduced.has(part));
        expect(familiar, `${char} in ${lesson.title}`).toBe(true);
      }
    }
  });

  it("finds the shared part in every member of a family", () => {
    for (const family of set.families) {
      for (const char of family.chars) {
        expect(elements(glyphs.get(char)!).has(family.shared), `${family.shared} in ${char}`).toBe(true);
      }
    }
  });

  it("segments characters into the units the games play with", () => {
    expect(units("古")).toEqual(["十", "口"]);
    expect(units("湖")).toEqual(["氵", "十", "口", "月"]);
    expect(units("休")).toEqual(["亻", "木"]);
    const enclosed = segmentUnits(glyphs.get("困")!);
    expect(enclosed.map((u) => [u.component, u.strokes.length, u.offset])).toEqual([
      ["囗", 2, 0],
      ["木", 4, 0],
      ["囗", 1, 2],
    ]);
    const family = new Set(["寺", "扌", "日", "亻", "彳", "言", "牜"]);
    expect(units("持", family)).toEqual(["扌", "寺"]);
    expect(units("時", family)).toEqual(["日", "寺"]);
  });

  it("marks enclosures and what they hold", () => {
    const [box, tree, bottom] = glyphs.get("困")!.root.children;
    expect(box).toMatchObject({ element: "囗", position: "enclosure", positionDetail: "kamae", part: 1, radical: true });
    expect(tree).toMatchObject({ element: "木", position: "inside" });
    expect(bottom).toMatchObject({ element: "囗", position: "enclosure", part: 2 });
    const [content, walk] = glyphs.get("返")!.root.children;
    expect(content).toMatchObject({ element: "反", position: "inside", positionDetail: "nyoc" });
    expect(walk).toMatchObject({ position: "enclosure", positionDetail: "nyo", original: "辶" });
  });
});
