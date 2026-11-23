import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setCharacters, symmetricLookAlikes } from "./set-types";
import type { SetDefinition } from "./set-types";

const TINY: SetDefinition = {
  id: "tiny",
  script: "ja",
  lessons: [
    { id: "a", title: "A", components: ["十", "口"], chars: ["十", "古", "口"] },
    { id: "b", title: "B", components: ["口", "月"], chars: ["胡", "古", "月"] },
  ],
  families: [{ id: "f", shared: "寺", chars: ["持", "時", "古"] }],
  lookAlikes: { 土: ["士"], 日: ["目", "白"], 目: ["自", "日"] },
  extra: ["士", "目", "白", "自", "鳥"],
  lexicon: { 十: { meanings: ["ten"], readings: { on: ["ジュウ"], kun: ["とお"] } } },
};

describe("setCharacters", () => {
  it("lists every mentioned character once, in order of first appearance", () => {
    expect(setCharacters(TINY)).toEqual([..."十口古月胡寺持時土士日目白自鳥"]);
  });

  it("is empty for an empty set", () => {
    expect(setCharacters({ ...TINY, lessons: [], families: [], lookAlikes: {}, extra: [] })).toEqual([]);
  });
});

describe("symmetricLookAlikes", () => {
  it("fills in the reverse direction and keeps authored order first", () => {
    const pairs = symmetricLookAlikes(TINY.lookAlikes);
    expect(pairs.get("土")).toEqual(["士"]);
    expect(pairs.get("士")).toEqual(["土"]);
    expect(pairs.get("日")).toEqual(["目", "白"]);
    expect(pairs.get("目")).toEqual(["自", "日"]);
    expect(pairs.get("白")).toEqual(["日"]);
    expect(pairs.get("自")).toEqual(["目"]);
  });

  it("is not transitive, lists nothing twice and never pairs a character with itself", () => {
    const pairs = symmetricLookAlikes({ 日: ["目", "目", "日"], 目: ["貝"] });
    expect(pairs.get("日")).toEqual(["目"]);
    expect(pairs.get("目")).toEqual(["貝", "日"]);
    expect(pairs.get("貝")).toEqual(["目"]);
  });

  it("is empty for no pairs", () => {
    expect(symmetricLookAlikes({}).size).toBe(0);
  });
});

/** The authored starter set, read as plain JSON so that the checks see the file as written. */
const STARTER = JSON.parse(readFileSync(new URL("../sets/starter-ja.json", import.meta.url), "utf8")) as SetDefinition;

const isOne = (text: string): boolean => [...text].length === 1;
const unique = <T>(items: readonly T[]): boolean => new Set(items).size === items.length;

describe("sets/starter-ja.json", () => {
  it("has the expected identity and shape", () => {
    expect(STARTER.id).toBe("starter-ja");
    expect(STARTER.script).toBe("ja");
    expect(STARTER.lessons.map((l) => l.title)).toEqual([
      "Lines and boxes",
      "People and trees",
      "Water and moon",
      "Fire and earth",
      "Home",
      "Words and time",
    ]);
    expect(STARTER.families.map((f) => f.shared).join("")).toBe("寺青門主交各反");
    expect(unique(STARTER.lessons.map((l) => l.id))).toBe(true);
    expect(unique(STARTER.families.map((f) => f.id))).toBe(true);
  });

  it("uses single characters everywhere and repeats none within a list", () => {
    for (const lesson of STARTER.lessons) {
      expect(lesson.components.every(isOne) && lesson.chars.every(isOne), lesson.id).toBe(true);
      expect(unique(lesson.components) && unique(lesson.chars), lesson.id).toBe(true);
      expect(lesson.chars.length).toBeGreaterThanOrEqual(8);
    }
    for (const family of STARTER.families) {
      expect(isOne(family.shared) && family.chars.every(isOne), family.id).toBe(true);
      expect(unique(family.chars), family.id).toBe(true);
      expect(family.chars).not.toContain(family.shared);
      expect(family.chars.length).toBeGreaterThanOrEqual(4);
    }
    expect(setCharacters(STARTER).every(isOne)).toBe(true);
    expect(Object.keys(STARTER.lexicon).every(isOne)).toBe(true);
  });

  it("teaches no character in two lessons", () => {
    expect(unique(STARTER.lessons.flatMap((l) => l.chars))).toBe(true);
  });

  it("lists each look-alike pair once and no character against itself", () => {
    const seen = new Set<string>();
    for (const [key, values] of Object.entries(STARTER.lookAlikes)) {
      expect(values.length, key).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, key).not.toBe(key);
        const pair = [key, value].sort().join("");
        expect(seen.has(pair), `${key}/${value} listed twice`).toBe(false);
        seen.add(pair);
      }
    }
    expect(seen.size).toBe(45);
    const both = symmetricLookAlikes(STARTER.lookAlikes);
    expect(both.get("天")).toEqual(["大", "夫"]);
    expect(both.get("目")).toEqual(["自", "貝", "日"]);
  });

  it("keeps extra equal to the right-hand sides of lookAlikes", () => {
    const rightHand = [...new Set(Object.values(STARTER.lookAlikes).flat())];
    expect(STARTER.extra).toEqual(rightHand);
  });

  it("has a full lexicon entry for every lesson and family character", () => {
    const taught = new Set([
      ...STARTER.lessons.flatMap((l) => l.chars),
      ...STARTER.families.flatMap((f) => [f.shared, ...f.chars]),
    ]);
    expect(taught.size).toBe(95);
    for (const char of taught) {
      const entry = STARTER.lexicon[char];
      expect(entry, char).toBeDefined();
      expect(entry!.readings, char).toBeDefined();
      expect(entry!.readings!.on.length + entry!.readings!.kun.length, char).toBeGreaterThan(0);
    }
  });

  it("glosses the bare component forms", () => {
    for (const char of "亻氵宀扌彳忄艹辶囗飠糸阝攵夂冖广厂冫礻衤牜") {
      expect(STARTER.lexicon[char]?.meanings.length, char).toBeGreaterThan(0);
    }
    for (const lesson of STARTER.lessons) {
      for (const component of lesson.components) expect(STARTER.lexicon[component], component).toBeDefined();
    }
    // The code points KanjiVG uses for the walk and village radicals inside characters.
    expect(STARTER.lexicon["⻌"]).toEqual(STARTER.lexicon["辶"]);
    expect(STARTER.lexicon["⻏"]?.meanings).toEqual(["village"]);
  });

  it("writes one to three short meanings, on readings in katakana and kun readings in hiragana", () => {
    for (const [char, entry] of Object.entries(STARTER.lexicon)) {
      expect(entry.meanings.length, char).toBeGreaterThanOrEqual(1);
      expect(entry.meanings.length, char).toBeLessThanOrEqual(3);
      expect(unique(entry.meanings), char).toBe(true);
      for (const meaning of entry.meanings) expect(meaning, char).toMatch(/^[a-z][a-z -]{1,22}$/);
      if (!entry.readings) continue;
      expect(unique(entry.readings.on) && unique(entry.readings.kun), char).toBe(true);
      for (const on of entry.readings.on) expect(on, char).toMatch(/^[ァ-ヶー]+$/);
      for (const kun of entry.readings.kun) expect(kun, char).toMatch(/^[ぁ-ゖ]+$/);
    }
  });

  it("matches the example entry the format was specified with", () => {
    expect(STARTER.lexicon["木"]).toEqual({ meanings: ["tree", "wood"], readings: { on: ["モク", "ボク"], kun: ["き"] } });
  });
});
