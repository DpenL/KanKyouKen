import { describe, expect, it } from "vitest";
import { decodeGlyphSet } from "@kankyouken/mechanics/glyph";
import type { GlyphRecord, GlyphSetRecord } from "@kankyouken/mechanics/glyph";
import { collectGlyphs, kanjiVGGlyphSet, KANJIVG_SOURCE, noticeText, serializeGlyphSet } from "./glyph-set";

/** A minimal KanjiVG-style document: one horizontal stroke per named part (shapes invented). */
function svg(char: string, parts: readonly string[] = []): string {
  const groups = parts
    .map((part, i) => `<g id="g${i}" kvg:element="${part}"><path id="s${i}" d="M10,${10 + i * 10}H90"/></g>`)
    .join("\n");
  const own = parts.length === 0 ? `<path id="s" kvg:type="㇐" d="M10,50H90"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_test" style="fill:none">
<g id="kvg:test" kvg:element="${char}">
${groups}${own}
</g>
</g>
</svg>`;
}

function library(files: Readonly<Record<string, string>>): { load: (char: string) => string | null; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    load: (char) => {
      calls.push(char);
      return files[char] ?? null;
    },
  };
}

const chars = (glyphs: readonly GlyphRecord[]): string => glyphs.map((g) => g.char).join("");

describe("collectGlyphs", () => {
  it("converts the requested characters and the components their trees name", async () => {
    const { load } = library({ 休: svg("休", ["亻", "木"]), 木: svg("木") });
    const result = await collectGlyphs(["休"], load);
    expect(chars(result.glyphs)).toBe("休木");
    expect(result.added).toEqual(["木"]);
    expect(result.missing).toEqual([]);
    expect(result.missingComponents).toEqual(["亻"]);
    expect(result.unsegmented).toEqual(["木"]);
    expect(result.glyphs[0]!.tree).toEqual({ c: [{ e: "亻", s: [0] }, { e: "木", s: [1] }] });
  });

  it("follows components transitively", async () => {
    const { load, calls } = library({
      湖: svg("湖", ["氵", "胡"]),
      胡: svg("胡", ["古", "月"]),
      古: svg("古", ["十", "口"]),
      十: svg("十"),
      口: svg("口"),
      月: svg("月"),
      氵: svg("氵"),
    });
    const result = await collectGlyphs(["湖"], load);
    expect(new Set(result.glyphs.map((g) => g.char))).toEqual(new Set("湖胡古十口月氵"));
    expect(result.added).toEqual(["氵", "胡", "古", "月", "十", "口"]);
    expect(result.missingComponents).toEqual([]);
    expect(calls).toHaveLength(7);
  });

  it("sorts the glyphs by code point, astral characters last", async () => {
    const { load } = library({ 木: svg("木"), 一: svg("一"), "𠂉": svg("𠂉"), 口: svg("口"), "⺕": svg("⺕") });
    const result = await collectGlyphs(["𠂉", "木", "口", "⺕", "一"], load);
    expect(chars(result.glyphs)).toBe("⺕一口木𠂉");
  });

  it("reports requested characters without a file separately from components without one", async () => {
    const { load } = library({ 持: svg("持", ["扌", "寺"]) });
    const result = await collectGlyphs(["鬱", "持", "寺"], load);
    expect(chars(result.glyphs)).toBe("持");
    expect(result.missing).toEqual(["鬱", "寺"]);
    expect(result.missingComponents).toEqual(["扌"]);
    expect(result.added).toEqual([]);
  });

  it("loads every character once, however often it is asked for or named", async () => {
    const { load, calls } = library({ 林: svg("林", ["木", "木"]), 森: svg("森", ["木", "林"]), 木: svg("木") });
    const result = await collectGlyphs(["林", "森", "林", "木"], load);
    expect(chars(result.glyphs)).toBe("木林森");
    expect([...calls].sort()).toEqual(["木", "林", "森"].sort());
    expect(result.added).toEqual([]);
  });

  it("does not follow component names that are not a single character", async () => {
    const { load, calls } = library({ 斉: svg("斉", ["⿵AB", "月"]), 月: svg("月") });
    const result = await collectGlyphs(["斉"], load);
    expect(chars(result.glyphs)).toBe("斉月");
    expect(calls).toEqual(["斉", "月"]);
    expect(result.missingComponents).toEqual([]);
  });

  it("accepts asynchronous loaders and limits how many run at once", async () => {
    let running = 0;
    let peak = 0;
    const names = [..."一二三四五六七八九十"];
    const load = async (char: string): Promise<string> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return svg(char);
    };
    const result = await collectGlyphs(names, load, { concurrency: 3 });
    expect(result.glyphs).toHaveLength(10);
    expect(peak).toBe(3);
    expect(result.unsegmented).toEqual(names);
  });

  it("passes conversion options on", async () => {
    const { load } = library({ 一: svg("一") });
    const result = await collectGlyphs(["一"], load, { size: 109 });
    expect(result.glyphs[0]!.strokes).toEqual([["M10,50L90,50", [10, 50, 90, 50], "㇐"]]);
  });

  it("returns empty lists for an empty request", async () => {
    const { load, calls } = library({});
    expect(await collectGlyphs([], load)).toEqual({
      glyphs: [],
      missing: [],
      missingComponents: [],
      unsegmented: [],
      added: [],
    });
    expect(calls).toEqual([]);
  });

  it("rejects when a file cannot be parsed or a request is not one character", async () => {
    const { load } = library({ 木: "<svg></svg>", 一: svg("一") });
    await expect(collectGlyphs(["一", "木"], load)).rejects.toThrow(/KanjiVG 木/);
    await expect(collectGlyphs(["一", "木木"], load)).rejects.toThrow(/not a single character/);
    await expect(
      collectGlyphs(["一"], () => {
        throw new Error("disk on fire");
      }),
    ).rejects.toThrow(/disk on fire/);
  });
});

const sample = async (): Promise<GlyphSetRecord> => {
  const { load } = library({ 休: svg("休", ["亻", "木"]), 木: svg("木"), 一: svg("一") });
  const { glyphs } = await collectGlyphs(["休", "一"], load);
  return kanjiVGGlyphSet(glyphs.reverse(), { script: "ja", size: 1000, revision: "abc123" });
};

describe("kanjiVGGlyphSet", () => {
  it("wraps glyphs with the format header and the KanjiVG attribution", async () => {
    const set = await sample();
    expect(set).toMatchObject({
      format: "kankyouken-glyphs",
      version: 1,
      script: "ja",
      size: 1000,
      pathKind: "centerline",
      source: {
        name: "kanjivg",
        license: "CC-BY-SA-3.0",
        attribution: "KanjiVG © Ulrich Apel and contributors, https://kanjivg.tagaini.net",
        url: "https://github.com/KanjiVG/kanjivg",
        revision: "abc123",
      },
    });
    expect(set.source).toEqual({ ...KANJIVG_SOURCE, revision: "abc123" });
  });

  it("sorts by code point and decodes cleanly", async () => {
    const set = await sample();
    expect(chars(set.glyphs)).toBe("一休木");
    const decoded = decodeGlyphSet(set);
    expect([...decoded.keys()]).toEqual(["一", "休", "木"]);
    expect(decoded.get("休")!.source).toEqual({ name: "kanjivg", license: "CC-BY-SA-3.0" });
  });
});

describe("serializeGlyphSet", () => {
  it("round-trips through JSON.parse", async () => {
    const set = await sample();
    expect(JSON.parse(serializeGlyphSet(set))).toEqual(set);
  });

  it("puts every header field and every glyph on a line of its own", async () => {
    const set = await sample();
    const text = serializeGlyphSet(set);
    expect(text.endsWith("]\n}\n")).toBe(true);
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(1 + 6 + 1 + set.glyphs.length + 2);
    expect(lines[0]).toBe("{");
    expect(lines[1]).toBe('"format":"kankyouken-glyphs",');
    expect(lines[2]).toBe('"version":1,');
    expect(lines[6]!.startsWith('"source":{"name":"kanjivg"')).toBe(true);
    expect(lines[7]).toBe('"glyphs":[');
    expect(lines.slice(8, 11).map((line) => line.slice(0, 12))).toEqual(['{"char":"一",', '{"char":"休",', '{"char":"木",']);
    expect(lines[8]!.endsWith("},")).toBe(true);
    expect(lines[10]!.endsWith("}")).toBe(true);
    expect(lines[10]!.endsWith(",")).toBe(false);
  });

  it("changes exactly one line when one glyph changes", async () => {
    const set = await sample();
    const edited: GlyphSetRecord = {
      ...set,
      glyphs: set.glyphs.map((g) => (g.char === "休" ? { ...g, tree: { s: [0, 1] } } : g)),
    };
    const before = serializeGlyphSet(set).split("\n");
    const after = serializeGlyphSet(edited).split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toHaveLength(1);
  });

  it("stays valid JSON without glyphs", async () => {
    const empty = { ...(await sample()), glyphs: [] };
    expect(JSON.parse(serializeGlyphSet(empty))).toEqual(empty);
  });
});

describe("noticeText", () => {
  it("names the source, its license, the revision and the changes", () => {
    const text = noticeText("0123abc");
    expect(text).toContain("derived from KanjiVG");
    expect(text).toContain("CC BY-SA 3.0");
    expect(text).toContain("https://creativecommons.org/licenses/by-sa/3.0/");
    expect(text).toContain("https://github.com/KanjiVG/kanjivg");
    expect(text).toContain(KANJIVG_SOURCE.attribution);
    expect(text).toContain("`0123abc`");
    expect(text).toMatch(/rescaled from 109 to 1000 units/);
    expect(text).toMatch(/medians/);
    expect(text).toMatch(/MIT license/);
  });
});
