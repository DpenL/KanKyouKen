/**
 * The rules a run is played by: named presets, the choices they are made of, and how a
 * player (Settings) or a study (the launch link) picks them.
 *
 * Each choice names a rule in words a Settings screen can show; `assemblyRules` and
 * `puzzleOptions` turn the choices into what the mechanics library plays. The default
 * preset follows the Zen Hanzi demo as observed (MECHANICS.md Part 2); "classic" is
 * Kumiki as it was before, kept whole so that nothing it did is lost.
 */

import {
  CLASSIC_RULES,
  type AfterCheck,
  type AssemblyRules,
  type PuzzleOptions,
} from "@kankyouken/mechanics/components";
import type { Mode } from "./round";

export interface RuleChoices {
  /**
   * How an attempt is judged: a Check button below the board ("bar", Kumiki), a Check
   * button by the structure once it is full ("frame", the demo), or as soon as it is
   * full ("auto").
   */
  readonly check: "bar" | "frame" | "auto";
  /** What stays in the structure after a wrong attempt. */
  readonly afterCheck: AfterCheck;
  /**
   * How the result of a check is shown: three lines under the board ("lines", Kumiki), or
   * a panel over the structures with counts, closed with Continue ("panel", the demo).
   */
  readonly feedback: "lines" | "panel";
  /** Learn mode gives unlimited tries ("unlimited", Kumiki) or plays by the same lives as Review ("same", the demo). */
  readonly learnLives: "unlimited" | "same";
}

export type ChoiceKey = keyof RuleChoices;

export interface ChoiceOption<K extends ChoiceKey> {
  readonly value: RuleChoices[K];
  readonly label: string;
}

export interface ChoiceDefinition<K extends ChoiceKey = ChoiceKey> {
  readonly key: K;
  readonly label: string;
  readonly options: readonly ChoiceOption<K>[];
}

type Definitions = { readonly [K in ChoiceKey]: ChoiceDefinition<K> };

/** Every choice and the values it can take, in the order Settings shows them. */
export const CHOICES: Definitions = {
  check: {
    key: "check",
    label: "Checking",
    options: [
      { value: "frame", label: "Check button at the structure" },
      { value: "bar", label: "Check button below the board" },
      { value: "auto", label: "As soon as every slot is filled" },
    ],
  },
  afterCheck: {
    key: "afterCheck",
    label: "After a wrong check",
    options: [
      { value: "keep-correct", label: "Tiles in the right slot stay" },
      { value: "keep", label: "Every tile stays" },
      { value: "clear", label: "Every tile goes back" },
    ],
  },
  feedback: {
    key: "feedback",
    label: "Feedback",
    options: [
      { value: "panel", label: "A panel with counts" },
      { value: "lines", label: "Three lines under the board" },
    ],
  },
  learnLives: {
    key: "learnLives",
    label: "Lives in Learn",
    options: [
      { value: "same", label: "As in Review" },
      { value: "unlimited", label: "Unlimited tries" },
    ],
  },
};

export const CHOICE_KEYS = Object.keys(CHOICES) as ChoiceKey[];

export type PresetId = "zen-hanzi" | "classic";

export interface Preset {
  readonly id: PresetId;
  readonly title: string;
  /** One line on what sets it apart. */
  readonly note: string;
  readonly choices: RuleChoices;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "zen-hanzi",
    title: "Close to the paper",
    note: "As the Zen Hanzi demo plays: a Check button by the full structure, a feedback panel, the same lives in both modes.",
    choices: { check: "frame", afterCheck: "keep-correct", feedback: "panel", learnLives: "same" },
  },
  {
    id: "classic",
    title: "Kumiki classic",
    note: "Kumiki as it first was: Check below the board, every tile stays, unlimited tries in Learn.",
    choices: { check: "bar", afterCheck: "keep", feedback: "lines", learnLives: "unlimited" },
  },
];

export const DEFAULT_PRESET: PresetId = "zen-hanzi";

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** The choices of a preset. */
export function presetChoices(id: PresetId): RuleChoices {
  return presetById(id)!.choices;
}

/** A preset and what was changed from it; what is stored, and what a launch link names. */
export interface RuleSpec {
  readonly preset: PresetId;
  readonly changes: Partial<RuleChoices>;
}

export const DEFAULT_SPEC: RuleSpec = { preset: DEFAULT_PRESET, changes: {} };

/** True when `value` is one of the values `key` can take. */
export function isChoice<K extends ChoiceKey>(key: K, value: unknown): value is RuleChoices[K] {
  return (CHOICES[key].options as readonly ChoiceOption<K>[]).some((option) => option.value === value);
}

/**
 * A spec made safe to use: an unknown preset becomes the default one, and changes to
 * unknown choices, to values a choice cannot take, or to the preset's own value are
 * dropped. Storage and links can hold anything.
 */
export function cleanSpec(raw: unknown): RuleSpec {
  const source = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const preset = presetById(typeof source["preset"] === "string" ? source["preset"] : "") ?? presetById(DEFAULT_PRESET)!;
  const rawChanges = source["changes"];
  const changes: Partial<Record<ChoiceKey, unknown>> = {};
  if (rawChanges !== null && typeof rawChanges === "object" && !Array.isArray(rawChanges)) {
    for (const key of CHOICE_KEYS) {
      const value = (rawChanges as Record<string, unknown>)[key];
      if (isChoice(key, value) && value !== preset.choices[key]) changes[key] = value;
    }
  }
  return { preset: preset.id, changes: changes as Partial<RuleChoices> };
}

/** What a spec plays by: its preset's choices with the changes applied. */
export function resolveChoices(spec: RuleSpec): RuleChoices {
  return { ...presetChoices(spec.preset), ...spec.changes };
}

/** True when the spec plays exactly as its preset does. */
export function isPlainPreset(spec: RuleSpec): boolean {
  return Object.keys(spec.changes).length === 0;
}

/**
 * Read the `rules` value of a launch link: a preset id, then any changes as
 * `key:value`, all separated by commas, e.g. `zen-hanzi,check:auto,afterCheck:keep`.
 * Returns null when the first part names no preset. Parts that name no choice or a value
 * the choice cannot take are returned in `ignored`, so that a study can see a typo in
 * its link.
 */
export function parseRuleSpec(text: string): { spec: RuleSpec; ignored: string[] } | null {
  const [head, ...rest] = text.split(",").map((part) => part.trim());
  const preset = presetById(head ?? "");
  if (preset === undefined) return null;
  const changes: Partial<Record<ChoiceKey, unknown>> = {};
  const ignored: string[] = [];
  for (const part of rest) {
    if (part === "") continue;
    const at = part.indexOf(":");
    const key = part.slice(0, at) as ChoiceKey;
    const raw = part.slice(at + 1);
    if (at < 0 || !CHOICE_KEYS.includes(key)) {
      ignored.push(part);
      continue;
    }
    const option = (CHOICES[key].options as readonly ChoiceOption<ChoiceKey>[]).find((candidate) => String(candidate.value) === raw);
    if (option === undefined) ignored.push(part);
    else changes[key] = option.value;
  }
  return { spec: cleanSpec({ preset: preset.id, changes }), ignored };
}

/** The launch-link form of a spec (see `parseRuleSpec`). */
export function formatRuleSpec(spec: RuleSpec): string {
  return [spec.preset, ...CHOICE_KEYS.flatMap((key) => (key in spec.changes ? [`${key}:${String(spec.changes[key])}`] : []))].join(",");
}

/** What the mechanics library plays a round of `mode` by. */
export function assemblyRules(choices: RuleChoices, mode: Mode): AssemblyRules {
  const rules: AssemblyRules = {
    ...CLASSIC_RULES,
    check: choices.check === "auto" ? "auto" : "button",
    afterCheck: choices.afterCheck,
  };
  return mode === "learn" && choices.learnLives === "unlimited" ? { ...rules, lives: null } : rules;
}

/** How puzzles are put together. */
export function puzzleOptions(_choices: RuleChoices): PuzzleOptions {
  return { layoutChoices: 4, lookAlikesPerComponent: 2, trayRows: 3, traySize: 12 };
}

/** Where the rules of a session come from. */
export interface RuleSource {
  readonly spec: RuleSpec;
  /**
   * "link": the launch link's `rules` value; "condition": a study condition that names a
   * preset; "player": what the player chose in Settings (or the default). Rules from a
   * link or a condition are fixed for the session: Settings shows them but cannot change
   * them, as a study condition fixes the sound mode in Fude Uta.
   */
  readonly from: "link" | "condition" | "player";
  /** Parts of the link's `rules` value that named no choice or no value of one. */
  readonly ignored: readonly string[];
}

/**
 * The rules a session starts with: the link's `rules` value when it names a preset,
 * else a study condition that is a preset's id, else the player's stored choice. A
 * `rules` value that names no preset is passed over (and reported in `ignored`).
 */
export function ruleSource(params: { readonly rules?: string; readonly condition?: string }, stored: RuleSpec): RuleSource {
  const fromLink = params.rules === undefined ? null : parseRuleSpec(params.rules);
  if (fromLink !== null) return { spec: fromLink.spec, from: "link", ignored: fromLink.ignored };
  const ignored = params.rules === undefined ? [] : [params.rules];
  const preset = params.condition === undefined ? undefined : presetById(params.condition);
  if (preset !== undefined) return { spec: { preset: preset.id, changes: {} }, from: "condition", ignored };
  return { spec: cleanSpec(stored), from: "player", ignored };
}
