import { describe, expect, it } from "vitest";
import {
  CLASSIC_PUZZLE,
  CLASSIC_RULES,
  CLASSIC_RUN,
  DEMO_FRAMES,
  ZEN_HANZI_PUZZLE,
  ZEN_HANZI_RULES,
  ZEN_HANZI_RUN,
  layoutCatalogue,
  validateRules,
} from "@kankyouken/mechanics/components";
import {
  CHOICES,
  CHOICE_GROUPS,
  CHOICE_KEYS,
  DEFAULT_PRESET,
  PRESETS,
  TRAYS,
  TRAY_COPIES,
  assemblyRules,
  choiceApplies,
  cleanSpec,
  formatRuleSpec,
  isPlainPreset,
  livesLine,
  parseRuleSpec,
  presetById,
  presetChoices,
  puzzleOptions,
  resolveChoices,
  ruleSource,
  runRules,
  withChoice,
  type RuleChoices,
} from "./rules";

describe("presets", () => {
  it("default to the one close to the paper, and keep Kumiki classic", () => {
    expect(DEFAULT_PRESET).toBe("zen-hanzi");
    expect(PRESETS.map((preset) => preset.id)).toContain("classic");
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
  });

  it("only use values their choices offer", () => {
    for (const preset of PRESETS) {
      for (const key of CHOICE_KEYS) {
        const values = CHOICES[key].options.map((option) => option.value);
        expect(values, `${preset.id}.${key}`).toContain(preset.choices[key]);
      }
    }
  });

  it("give Kumiki's classic rules exactly under classic", () => {
    const classic = presetChoices("classic");
    expect(assemblyRules(classic, "review")).toEqual(CLASSIC_RULES);
    expect(assemblyRules(classic, "learn")).toEqual({ ...CLASSIC_RULES, lives: null });
  });

  it("turn the check choices into the library's trigger", () => {
    const zen = presetChoices("zen-hanzi");
    expect(assemblyRules(zen, "review")).toMatchObject({ check: "button", afterCheck: "keep-correct" });
    expect(assemblyRules({ ...zen, check: "auto" }, "review").check).toBe("auto");
    expect(assemblyRules({ ...zen, check: "bar" }, "review").check).toBe("button");
  });
});

describe("lives, hints and scoring", () => {
  const zen = presetChoices("zen-hanzi");
  const classic = presetChoices("classic");
  const rules = (change: Partial<RuleChoices>, mode: "learn" | "review" = "review") => assemblyRules({ ...zen, ...change }, mode);

  it("play the demo's rules under the default preset, in both modes", () => {
    for (const mode of ["learn", "review"] as const) {
      expect(assemblyRules(zen, mode)).toEqual({ ...ZEN_HANZI_RULES, check: "button" });
    }
    expect(runRules(zen)).toEqual(ZEN_HANZI_RUN);
    expect(runRules(classic)).toEqual(CLASSIC_RUN);
  });

  it("turn every value of every choice into rules the library accepts", () => {
    for (const preset of PRESETS) {
      for (const key of CHOICE_KEYS) {
        for (const option of CHOICES[key].options) {
          for (const mode of ["learn", "review"] as const) {
            const made = assemblyRules({ ...preset.choices, [key]: option.value }, mode);
            expect(() => validateRules(made), `${preset.id} ${key}:${String(option.value)}`).not.toThrow();
          }
        }
      }
    }
  });

  it("set the number of hearts, none, or a dynamic rule", () => {
    expect(rules({ lives: "5" })).toMatchObject({ lives: 5, livesRule: "fixed" });
    expect(rules({ lives: "1" }).lives).toBe(1);
    expect(rules({ lives: "none" }).lives).toBeNull();
    expect(rules({ lives: "parts" })).toMatchObject({ lives: 3, livesRule: "parts" });
    expect(rules({ lives: "adaptive" })).toMatchObject({ lives: 3, livesRule: "adaptive" });
    // Learn can be freed of lives whatever Review plays by.
    expect(rules({ learnLives: "unlimited" }, "learn").lives).toBeNull();
    expect(rules({ learnLives: "unlimited" }, "review").lives).toBe(3);
  });

  it("set what a wrong check costs and what a solve gives back", () => {
    expect([rules({ wrongCost: "half" }), rules({ wrongCost: "whole" }), rules({ wrongCost: "none" })].map((made) => made.wrongCost)).toEqual([0.5, 1, 0]);
    expect([rules({ solveGain: "one" }), rules({ solveGain: "half" }), rules({ solveGain: "none" })].map((made) => made.solveGain)).toEqual([1, 0.5, 0]);
  });

  it("set where the hearts last and what happens without them", () => {
    expect(runRules({ ...zen, livesScope: "character" })).toEqual({ livesScope: "character", atZero: "end-run" });
    expect(runRules({ ...zen, atZero: "retry-later" })).toEqual({ livesScope: "run", atZero: "fail-character" });
  });

  it("set the hint policy and the scoring", () => {
    const policies = (["life", "points", "token", "later", "unmastered", "free", "off"] as const).map((hint) => rules({ hint }).hint);
    expect(policies).toEqual(["life", "points", "token", "return", "unmastered", "free", "off"]);
    expect(rules({ scoring: "classic" }).scoring).toBe("classic");
    expect(rules({}).scoring).toBe("demo");
  });

  it("describe the lives of a mode in a line", () => {
    expect(livesLine(zen, "learn")).toBe("3 lives for the run.");
    expect(livesLine(classic, "learn")).toBe("Unlimited tries.");
    expect(livesLine(classic, "review")).toBe("5 lives per character.");
    expect(livesLine({ ...zen, lives: "1", livesScope: "character" }, "review")).toBe("1 life per character.");
    expect(livesLine({ ...zen, lives: "none" }, "review")).toBe("Unlimited tries.");
    expect(livesLine({ ...zen, lives: "parts" }, "review")).toBe("A life per part.");
    expect(livesLine({ ...zen, lives: "adaptive" }, "review")).toBe("About 3 lives per character.");
  });
});

describe("rule specs", () => {
  it("are cleaned of unknown presets, choices and values", () => {
    expect(cleanSpec(null)).toEqual({ preset: DEFAULT_PRESET, changes: {} });
    expect(cleanSpec({ preset: "nope", changes: { check: "auto" } })).toEqual({ preset: DEFAULT_PRESET, changes: { check: "auto" } });
    expect(cleanSpec({ preset: "classic", changes: { check: "soon", colour: "red", feedback: "panel" } })).toEqual({
      preset: "classic",
      changes: { feedback: "panel" },
    });
    // A change to the preset's own value is no change.
    expect(cleanSpec({ preset: "classic", changes: { check: "bar" } })).toEqual({ preset: "classic", changes: {} });
    expect(cleanSpec({ preset: "classic", changes: [1] })).toEqual({ preset: "classic", changes: {} });
  });

  it("resolve to the preset's choices with the changes applied", () => {
    const spec = { preset: "classic" as const, changes: { check: "auto" as const } };
    expect(resolveChoices(spec)).toEqual({ ...presetChoices("classic"), check: "auto" });
    expect(isPlainPreset(spec)).toBe(false);
    expect(isPlainPreset({ preset: "classic", changes: {} })).toBe(true);
  });

  it("are read from and written to the launch-link form", () => {
    expect(parseRuleSpec("classic")).toEqual({ spec: { preset: "classic", changes: {} }, ignored: [] });
    expect(parseRuleSpec(" zen-hanzi , check:auto,afterCheck:keep ")).toEqual({
      spec: { preset: "zen-hanzi", changes: { check: "auto", afterCheck: "keep" } },
      ignored: [],
    });
    expect(parseRuleSpec("classic,check:soon,colour:red,feedback")).toEqual({
      spec: { preset: "classic", changes: {} },
      ignored: ["check:soon", "colour:red", "feedback"],
    });
    expect(parseRuleSpec("nope,check:auto")).toBeNull();
    expect(parseRuleSpec("")).toBeNull();
    const spec = { preset: "classic" as const, changes: { feedback: "panel" as const, check: "auto" as const } };
    expect(formatRuleSpec(spec)).toBe("classic,check:auto,feedback:panel");
    expect(parseRuleSpec(formatRuleSpec(spec))!.spec).toEqual(spec);
  });
});

describe("ruleSource", () => {
  const stored = { preset: "classic" as const, changes: {} };

  it("takes the link's rules first, fixed for the session", () => {
    expect(ruleSource({ rules: "zen-hanzi,check:auto", condition: "classic" }, stored)).toEqual({
      spec: { preset: "zen-hanzi", changes: { check: "auto" } },
      from: "link",
      ignored: [],
    });
  });

  it("then a study condition that names a preset", () => {
    expect(ruleSource({ condition: "classic" }, { preset: "zen-hanzi", changes: {} })).toEqual({
      spec: { preset: "classic", changes: {} },
      from: "condition",
      ignored: [],
    });
    expect(ruleSource({ rules: "typo", condition: "classic" }, stored)).toMatchObject({ from: "condition", ignored: ["typo"] });
  });

  it("else the player's own choice", () => {
    expect(ruleSource({}, stored)).toEqual({ spec: stored, from: "player", ignored: [] });
    expect(ruleSource({ condition: "melody" }, stored).from).toBe("player");
    expect(ruleSource({}, { preset: "bogus", changes: {} } as never).spec.preset).toBe(DEFAULT_PRESET);
  });
});

describe("the tray, the structures and the board", () => {
  const zen = presetChoices("zen-hanzi");
  const classic = presetChoices("classic");

  it("lay puzzles out as the demo does by default, and as Kumiki did under classic", () => {
    expect(puzzleOptions(zen)).toEqual(ZEN_HANZI_PUZZLE);
    expect(puzzleOptions(classic)).toEqual(CLASSIC_PUZZLE);
    expect(zen.board).toBe("compact");
    expect(classic.board).toBe("wide");
  });

  it("set the size and rows of the tray, and whether copies are dealt", () => {
    expect(TRAYS["3x6"]).toMatchObject({ rows: 3, size: 18 });
    for (const option of CHOICES.tray.options) {
      const made = puzzleOptions({ ...zen, tray: option.value });
      expect(made).toMatchObject({ trayRows: TRAYS[option.value].rows, traySize: TRAYS[option.value].size });
      const [rows, columns] = option.value.split("x").map(Number);
      expect(rows! * columns!).toBe(made.traySize);
      expect(made.trayRows).toBe(rows);
    }
    expect(puzzleOptions({ ...zen, copies: "yes" }).copies).toBe(TRAY_COPIES);
    expect(puzzleOptions({ ...zen, copies: "no" }).copies).toBe(0);
  });

  it("set where the structures beside the right one come from, with the frames of the content", () => {
    const frames = { parts: DEMO_FRAMES.slice(0, 5), positions: layoutCatalogue(2).slice(0, 3) };
    expect(puzzleOptions({ ...zen, structures: "catalogue" }, frames)).toMatchObject({ structures: "catalogue", frames: frames.parts });
    expect(puzzleOptions({ ...zen, structures: "fixed" }, frames)).toMatchObject({ structures: "fixed", frames: frames.parts });
    expect(puzzleOptions({ ...zen, structures: "positions" }, frames)).toMatchObject({ structures: "positions", frames: frames.positions });
    // Kumiki's own alternatives are made for the character and need no frames.
    expect(puzzleOptions({ ...zen, structures: "alternatives" }, frames)).not.toHaveProperty("frames");
    expect(puzzleOptions({ ...zen, structures: "fixed" })).not.toHaveProperty("frames");
    expect(CHOICES.structures.options.map((option) => option.value)).toEqual(["catalogue", "alternatives", "fixed", "positions"]);
  });
});

describe("the presets a player or a study can pick", () => {
  it("are the four named ones, each with a title and a note", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual(["zen-hanzi", "classic", "gentle", "study-no-hints"]);
    for (const preset of PRESETS) {
      expect(preset.title.length).toBeGreaterThan(0);
      expect(preset.note.length).toBeGreaterThan(20);
      expect(Object.keys(preset.choices).sort()).toEqual([...CHOICE_KEYS].sort());
    }
    expect(presetById("zen-hanzi")!.title).toBe("Close to the paper");
    expect(presetById("nope")).toBeUndefined();
  });

  it("gentle: no lives, free hints that stay, a small tray, the same frames every time, no button to find", () => {
    const gentle = presetChoices("gentle");
    expect(gentle).toMatchObject({ lives: "none", hint: "free", hintStays: "continue", tray: "2x4", copies: "no", structures: "fixed", check: "auto" });
    for (const mode of ["learn", "review"] as const) {
      expect(assemblyRules(gentle, mode)).toMatchObject({ lives: null, hint: "free", check: "auto" });
      expect(livesLine(gentle, mode)).toBe("Unlimited tries.");
    }
    expect(puzzleOptions(gentle)).toMatchObject({ traySize: 8, trayRows: 2, copies: 0, structures: "fixed" });
  });

  it("study: no hints differs from the default in the hint alone", () => {
    const study = presetChoices("study-no-hints");
    expect(study).toEqual({ ...presetChoices("zen-hanzi"), hint: "off" });
    expect(assemblyRules(study, "review").hint).toBe("off");
  });

  it("can be named by a link and by a study condition", () => {
    for (const preset of PRESETS) {
      expect(parseRuleSpec(preset.id)).toEqual({ spec: { preset: preset.id, changes: {} }, ignored: [] });
      expect(ruleSource({ condition: preset.id }, { preset: "classic", changes: {} })).toMatchObject({ spec: { preset: preset.id }, from: "condition" });
    }
    expect(parseRuleSpec("gentle,tray:3x6,structures:positions,board:wide")!.spec).toEqual({
      preset: "gentle",
      changes: { tray: "3x6", structures: "positions", board: "wide" },
    });
  });
});

describe("what Settings shows", () => {
  const zen = presetChoices("zen-hanzi");

  it("groups every choice once", () => {
    const grouped = CHOICE_GROUPS.flatMap((group) => group.keys);
    expect([...grouped].sort()).toEqual([...CHOICE_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const group of CHOICE_GROUPS) expect(group.title.length).toBeGreaterThan(0);
  });

  it("gives every option of every choice a label and a value that survives the link form", () => {
    for (const key of CHOICE_KEYS) {
      expect(CHOICES[key].label.length, key).toBeGreaterThan(0);
      const values = CHOICES[key].options.map((option) => String(option.value));
      expect(new Set(values).size, key).toBe(values.length);
      for (const option of CHOICES[key].options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(String(option.value)).not.toMatch(/[,:\s]/);
      }
    }
  });

  it("switches off the choices that change nothing", () => {
    for (const key of CHOICE_KEYS) expect(choiceApplies(zen, key), key).toBe(true);
    const none = { ...zen, lives: "none" as const };
    for (const key of ["livesScope", "wrongCost", "solveGain", "atZero", "learnLives"] as const) expect(choiceApplies(none, key), key).toBe(false);
    expect(choiceApplies(none, "lives")).toBe(true);
    expect(choiceApplies(none, "hint")).toBe(true);
    // The dynamic rules count per character whatever the scope says.
    expect(choiceApplies({ ...zen, lives: "parts" }, "livesScope")).toBe(false);
    expect(choiceApplies({ ...zen, lives: "adaptive" }, "livesScope")).toBe(false);
    expect(choiceApplies({ ...zen, lives: "adaptive" }, "wrongCost")).toBe(true);
    expect(choiceApplies({ ...zen, hint: "off" }, "hintStays")).toBe(false);
    expect(choiceApplies({ ...zen, hint: "free" }, "hintStays")).toBe(true);
  });

  it("changes one rule at a time, and forgets a change back to the preset's own value", () => {
    const base = { preset: "zen-hanzi" as const, changes: {} };
    const changed = withChoice(base, "hint", "free");
    expect(changed).toEqual({ preset: "zen-hanzi", changes: { hint: "free" } });
    expect(withChoice(changed, "tray", "2x4")).toEqual({ preset: "zen-hanzi", changes: { hint: "free", tray: "2x4" } });
    expect(withChoice(changed, "hint", "life")).toEqual(base);
    expect(withChoice(base, "hint", "sometimes" as never)).toEqual(base);
    expect(formatRuleSpec(withChoice(changed, "board", "wide"))).toBe("zen-hanzi,hint:free,board:wide");
  });
});
