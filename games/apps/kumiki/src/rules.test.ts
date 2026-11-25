import { describe, expect, it } from "vitest";
import { CLASSIC_RULES } from "@kankyouken/mechanics/components";
import {
  CHOICES,
  CHOICE_KEYS,
  DEFAULT_PRESET,
  PRESETS,
  assemblyRules,
  cleanSpec,
  formatRuleSpec,
  isPlainPreset,
  parseRuleSpec,
  presetChoices,
  resolveChoices,
  ruleSource,
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
