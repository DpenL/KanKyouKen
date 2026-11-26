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
  type HintPolicy,
  type Layout,
  type PuzzleOptions,
  type RunRules,
  type Scoring,
  type StructureMode,
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
  /**
   * Hearts: none at all, a fixed number (the demo: 3; Kumiki: 5), or a dynamic rule:
   * "parts" gives a character as many hearts as it has parts, "adaptive" one more after a
   * hard character and one fewer after an easy one (both around 3, and per character).
   */
  readonly lives: "none" | "1" | "2" | "3" | "5" | "parts" | "adaptive";
  /** The hearts left go from character to character ("run", the demo), or every character starts full ("character", Kumiki). */
  readonly livesScope: "run" | "character";
  /** What a wrong check costs: half a heart (the demo), a whole one (Kumiki), or nothing. */
  readonly wrongCost: "half" | "whole" | "none";
  /** What solving a character gives back: one heart (the demo), half, or nothing (Kumiki). */
  readonly solveGain: "one" | "half" | "none";
  /** Out of hearts: the run ends ("end-run", the demo), or the character is lost and returns at the end of the deck ("retry-later", Kumiki). */
  readonly atZero: "end-run" | "retry-later";
  /**
   * What a hint costs: half a heart ("life", the demo), points ("points", Kumiki), a
   * token earned by first-try solves ("token"), the character coming back later
   * ("later") or not counting as mastered ("unmastered"), or nothing ("free"). "off"
   * takes the hint away.
   */
  readonly hint: "life" | "points" | "token" | "later" | "unmastered" | "free" | "off";
  /** The hint stays until Continue ("continue", the demo) or goes away by itself ("timed", Kumiki). */
  readonly hintStays: "continue" | "timed";
  /**
   * "demo": a running total, points for what was right in a wrong check, no best score
   * (the demo). "classic": points per solved character, less per wrong check, and a best
   * score per deck (Kumiki).
   */
  readonly scoring: Scoring;
  /**
   * The tray, as rows x tiles per row: 3x6 (the demo), 3x4 (Kumiki), 2x4 (few tiles, for
   * beginners) or 4x6 (crowded). The needed tiles and their look-alikes are never left
   * out, and a tray stays short when the set has no more parts to fill it with.
   */
  readonly tray: "3x6" | "3x4" | "2x4" | "4x6";
  /** Identical copies of right parts in the tray, any of which is accepted ("yes", the demo), or every right part once ("no", Kumiki). */
  readonly copies: "yes" | "no";
  /**
   * The structures offered beside the right one (which is the same under all of them):
   * decoys drawn afresh from a fixed catalogue, whatever their number of slots
   * ("catalogue", the demo); wrong structures made for the character, with as many slots
   * as it has parts ("alternatives", Kumiki); one fixed set of frames in fixed places for
   * every character ("fixed"); or the character split once, into two parts by position,
   * with the position classes as the fixed set ("positions").
   */
  readonly structures: StructureMode;
  /**
   * How the screen is laid out. "compact" (the demo's arrangement): lives and score in
   * the top bar, Hint beside the prompt, the structures two by two above the tray, on
   * every screen. "wide" (Kumiki): on a wide screen the structures in one row, and Hint
   * below the tray.
   */
  readonly board: "compact" | "wide";
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
  lives: {
    key: "lives",
    label: "Lives",
    options: [
      { value: "3", label: "3" },
      { value: "5", label: "5" },
      { value: "2", label: "2" },
      { value: "1", label: "1" },
      { value: "parts", label: "By the number of parts" },
      { value: "adaptive", label: "Adaptive to the last character" },
      { value: "none", label: "No lives: unlimited tries" },
    ],
  },
  livesScope: {
    key: "livesScope",
    label: "Lives last",
    options: [
      { value: "run", label: "For the whole run" },
      { value: "character", label: "For one character" },
    ],
  },
  wrongCost: {
    key: "wrongCost",
    label: "A wrong check costs",
    options: [
      { value: "half", label: "Half a life" },
      { value: "whole", label: "A life" },
      { value: "none", label: "Nothing" },
    ],
  },
  solveGain: {
    key: "solveGain",
    label: "A solved character gives back",
    options: [
      { value: "one", label: "A life" },
      { value: "half", label: "Half a life" },
      { value: "none", label: "Nothing" },
    ],
  },
  atZero: {
    key: "atZero",
    label: "Out of lives",
    options: [
      { value: "end-run", label: "The run ends" },
      { value: "retry-later", label: "The character returns at the end" },
    ],
  },
  hint: {
    key: "hint",
    label: "A hint costs",
    options: [
      { value: "life", label: "Half a life" },
      { value: "points", label: "Points" },
      { value: "token", label: "A token from first-try solves" },
      { value: "later", label: "The character comes back later" },
      { value: "unmastered", label: "Not counted as mastered" },
      { value: "free", label: "Nothing" },
      { value: "off", label: "No hints" },
    ],
  },
  hintStays: {
    key: "hintStays",
    label: "The hint stays",
    options: [
      { value: "continue", label: "Until Continue" },
      { value: "timed", label: "A few seconds" },
    ],
  },
  scoring: {
    key: "scoring",
    label: "Score",
    options: [
      { value: "demo", label: "Running total, partial points" },
      { value: "classic", label: "Per character, with a best score" },
    ],
  },
  tray: {
    key: "tray",
    label: "Tray",
    options: [
      { value: "3x6", label: "18 tiles in 3 rows" },
      { value: "3x4", label: "12 tiles in 3 rows" },
      { value: "2x4", label: "8 tiles in 2 rows" },
      { value: "4x6", label: "24 tiles in 4 rows" },
    ],
  },
  copies: {
    key: "copies",
    label: "Copies of right parts",
    options: [
      { value: "yes", label: "Right parts more than once" },
      { value: "no", label: "Every right part once" },
    ],
  },
  structures: {
    key: "structures",
    label: "Structures",
    options: [
      { value: "catalogue", label: "Decoys drawn from a catalogue" },
      { value: "alternatives", label: "Near misses, as many slots" },
      { value: "fixed", label: "The same four frames" },
      { value: "positions", label: "Two parts by position" },
    ],
  },
  board: {
    key: "board",
    label: "Board",
    options: [
      { value: "compact", label: "Two by two, Hint at the top" },
      { value: "wide", label: "In a row when wide, Hint below" },
    ],
  },
};

export const CHOICE_KEYS = Object.keys(CHOICES) as ChoiceKey[];

/** The choices under the headings Settings shows them under. Every choice is in exactly one group. */
export const CHOICE_GROUPS: readonly { readonly title: string; readonly keys: readonly ChoiceKey[] }[] = [
  { title: "Checking", keys: ["check", "afterCheck", "feedback"] },
  { title: "Lives", keys: ["lives", "livesScope", "wrongCost", "solveGain", "atZero", "learnLives"] },
  { title: "Hints", keys: ["hint", "hintStays"] },
  { title: "Score", keys: ["scoring"] },
  { title: "Board", keys: ["structures", "tray", "copies", "board"] },
];

/**
 * False when `key` changes nothing under `choices`: what lives cost and give back when
 * there are none, where they last when a dynamic rule counts them per character, how long
 * a hint stays when there is none. Settings shows such a choice switched off.
 */
export function choiceApplies(choices: RuleChoices, key: ChoiceKey): boolean {
  switch (key) {
    case "livesScope":
      return choices.lives !== "none" && choices.lives !== "parts" && choices.lives !== "adaptive";
    case "wrongCost":
    case "solveGain":
    case "atZero":
    case "learnLives":
      return choices.lives !== "none";
    case "hintStays":
      return choices.hint !== "off";
    default:
      return true;
  }
}

export type PresetId = "zen-hanzi" | "classic" | "gentle" | "study-no-hints";

export interface Preset {
  readonly id: PresetId;
  readonly title: string;
  /** One line on what sets it apart. */
  readonly note: string;
  readonly choices: RuleChoices;
}

/** As the Zen Hanzi demo was seen to play; the default, and what the study presets start from. */
const ZEN_HANZI_CHOICES: RuleChoices = {
  check: "frame",
  afterCheck: "keep-correct",
  feedback: "panel",
  learnLives: "same",
  lives: "3",
  livesScope: "run",
  wrongCost: "half",
  solveGain: "one",
  atZero: "end-run",
  hint: "life",
  hintStays: "continue",
  scoring: "demo",
  tray: "3x6",
  copies: "yes",
  structures: "catalogue",
  board: "compact",
};

export const PRESETS: readonly Preset[] = [
  {
    id: "zen-hanzi",
    title: "Close to the paper",
    note: "As the Zen Hanzi demo plays: a Check button by the full structure, a feedback panel, three lives for the whole run lost in halves, a hint for half a life, a running total, 18 tiles, frames from a catalogue.",
    choices: ZEN_HANZI_CHOICES,
  },
  {
    id: "classic",
    title: "Kumiki classic",
    note: "Kumiki as it first was: Check below the board, every tile stays, five lives per character in Review and unlimited tries in Learn, hints for points, a best score, 12 tiles, near-miss structures.",
    choices: {
      check: "bar",
      afterCheck: "keep",
      feedback: "lines",
      learnLives: "unlimited",
      lives: "5",
      livesScope: "character",
      wrongCost: "whole",
      solveGain: "none",
      atZero: "retry-later",
      hint: "points",
      hintStays: "timed",
      scoring: "classic",
      tray: "3x4",
      copies: "no",
      structures: "alternatives",
      board: "wide",
    },
  },
  {
    id: "gentle",
    title: "Gentle",
    note: "For young children: no lives, hints are free and stay, the same four frames nearly every time (a character with a rarer structure gets its own in the fourth place), eight tiles, and a full structure is judged by itself.",
    choices: {
      ...ZEN_HANZI_CHOICES,
      check: "auto",
      lives: "none",
      wrongCost: "none",
      solveGain: "none",
      atZero: "retry-later",
      hint: "free",
      tray: "2x4",
      copies: "no",
      structures: "fixed",
    },
  },
  {
    id: "study-no-hints",
    title: "Study: no hints",
    note: "Close to the paper without the Hint button, for a study arm that must not look at the character while assembling. Learn still shows the character before each board; only Review keeps it out of sight.",
    choices: { ...ZEN_HANZI_CHOICES, hint: "off" },
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

/** `spec` with one choice set to `value`; a value that is the preset's own takes the change away again. */
export function withChoice<K extends ChoiceKey>(spec: RuleSpec, key: K, value: RuleChoices[K]): RuleSpec {
  return cleanSpec({ preset: spec.preset, changes: { ...spec.changes, [key]: value } });
}

/** True when the spec plays exactly as its preset does. */
export function isPlainPreset(spec: RuleSpec): boolean {
  return Object.keys(spec.changes).length === 0;
}

/**
 * Read the `rules` value of a launch link: a preset id, then any changes as
 * `key:value`, all separated by commas, e.g. `zen-hanzi,check:auto,afterCheck:keep`.
 * Upper and lower case are the same. A value that does not begin with a preset starts
 * from `base` (the default preset unless given): a link that sets rules means to fix
 * them, and a mistyped preset must not hand the session to whatever rules the device has
 * stored. Parts that name no preset, no choice or a value the choice cannot take are
 * returned in `ignored`, so that a study can see a typo in its link; so is the earlier
 * of two parts that set the same rule (the later one counts). Null only for a value with
 * nothing in it.
 */
export function parseRuleSpec(text: string, base: PresetId = DEFAULT_PRESET): { spec: RuleSpec; ignored: string[] } | null {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const head = parts[0];
  if (head === undefined) return null;
  const preset = presetById(head.toLowerCase());
  const changes: Partial<Record<ChoiceKey, unknown>> = {};
  /** The part that set each rule, to report it when a later part sets the rule again. */
  const setBy = new Map<ChoiceKey, string>();
  const ignored: string[] = [];
  for (const part of preset === undefined ? parts : parts.slice(1)) {
    const at = part.indexOf(":");
    const name = part.slice(0, Math.max(0, at)).trim().toLowerCase();
    const raw = part.slice(at + 1).trim().toLowerCase();
    const key = CHOICE_KEYS.find((candidate) => candidate.toLowerCase() === name);
    const option =
      key === undefined
        ? undefined
        : (CHOICES[key].options as readonly ChoiceOption<ChoiceKey>[]).find((candidate) => String(candidate.value).toLowerCase() === raw);
    if (key === undefined || option === undefined) {
      ignored.push(part);
      continue;
    }
    const earlier = setBy.get(key);
    if (earlier !== undefined) ignored.push(earlier);
    setBy.set(key, part);
    changes[key] = option.value;
  }
  return { spec: cleanSpec({ preset: preset?.id ?? base, changes }), ignored };
}

/** The launch-link form of a spec (see `parseRuleSpec`). */
export function formatRuleSpec(spec: RuleSpec): string {
  return [spec.preset, ...CHOICE_KEYS.flatMap((key) => (key in spec.changes ? [`${key}:${String(spec.changes[key])}`] : []))].join(",");
}

const HEARTS = { none: 0, half: 0.5, whole: 1, one: 1 } as const;
const HINT_POLICY: Readonly<Record<RuleChoices["hint"], HintPolicy>> = {
  life: "life",
  points: "points",
  token: "token",
  later: "return",
  unmastered: "unmastered",
  free: "free",
  off: "off",
};
/** What the dynamic lives rules count around: the demo's three hearts. */
const DYNAMIC_LIVES = 3;

/**
 * What the mechanics library plays a round of `mode` by. The numbers no choice names
 * (the classic score, half a heart per hint, one hint token to start with and three at
 * most) are Kumiki's own.
 */
export function assemblyRules(choices: RuleChoices, mode: Mode): AssemblyRules {
  const dynamic = choices.lives === "parts" || choices.lives === "adaptive";
  const none = choices.lives === "none" || (mode === "learn" && choices.learnLives === "unlimited");
  return {
    ...CLASSIC_RULES,
    check: choices.check === "auto" ? "auto" : "button",
    afterCheck: choices.afterCheck,
    lives: none ? null : dynamic ? DYNAMIC_LIVES : Number(choices.lives),
    livesRule: choices.lives === "parts" || choices.lives === "adaptive" ? choices.lives : "fixed",
    wrongCost: HEARTS[choices.wrongCost],
    solveGain: HEARTS[choices.solveGain],
    scoring: choices.scoring,
    hint: HINT_POLICY[choices.hint],
  };
}

/** What the mechanics library plays a run by. */
export function runRules(choices: RuleChoices): RunRules {
  return { livesScope: choices.livesScope, atZero: choices.atZero === "end-run" ? "end-run" : "fail-character" };
}

/**
 * The lives of a mode in a few words, for the mode switch: "Unlimited tries.", "3 lives
 * for the run.", "5 lives per character.".
 */
export function livesLine(choices: RuleChoices, mode: Mode): string {
  const rules = assemblyRules(choices, mode);
  if (rules.lives === null) return "Unlimited tries.";
  if (rules.livesRule === "parts") return "A life per part.";
  const count = `${rules.lives} ${rules.lives === 1 ? "life" : "lives"}`;
  if (rules.livesRule === "adaptive") return `About ${count} per character.`;
  return choices.livesScope === "run" ? `${count} for the run.` : `${count} per character.`;
}

/** Rows and tiles of each tray, and how many look-alikes each right part gets in it. */
export const TRAYS: Readonly<Record<RuleChoices["tray"], { readonly rows: number; readonly size: number; readonly lookAlikes: number }>> = {
  "3x6": { rows: 3, size: 18, lookAlikes: 2 },
  "3x4": { rows: 3, size: 12, lookAlikes: 2 },
  // Four parts and one look-alike each fill it exactly.
  "2x4": { rows: 2, size: 8, lookAlikes: 1 },
  "4x6": { rows: 4, size: 24, lookAlikes: 2 },
};

/** Identical copies of right parts dealt when the rules ask for them; the demo showed up to three tiles of one part. */
export const TRAY_COPIES = 2;

/** The frames a set of characters offers the structure modes (see `Frames` in content.ts). */
export interface FrameSets {
  readonly parts: readonly Layout[];
  readonly positions: readonly Layout[];
}

/**
 * How puzzles are put together. `frames` are those of the content being played; without
 * them the library's own are used (the nine frames of the demo, every two-slot structure).
 */
export function puzzleOptions(choices: RuleChoices, frames?: FrameSets): PuzzleOptions {
  const tray = TRAYS[choices.tray];
  const set = choices.structures === "positions" ? frames?.positions : frames?.parts;
  return {
    layoutChoices: 4,
    structures: choices.structures,
    ...(set === undefined || choices.structures === "alternatives" ? {} : { frames: set }),
    lookAlikesPerComponent: tray.lookAlikes,
    trayRows: tray.rows,
    traySize: tray.size,
    copies: choices.copies === "yes" ? TRAY_COPIES : 0,
  };
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
 * The rules a session starts with: the link's `rules` value when it has one, else a
 * study condition that is a preset's id, else the player's stored choice. A `rules`
 * value that names no preset starts from the condition's preset when there is one, else
 * from the default (see `parseRuleSpec`); either way the link fixes the rules.
 */
export function ruleSource(params: { readonly rules?: string; readonly condition?: string }, stored: RuleSpec): RuleSource {
  const preset = params.condition === undefined ? undefined : presetById(params.condition.trim().toLowerCase());
  const fromLink = params.rules === undefined ? null : parseRuleSpec(params.rules, preset?.id);
  if (fromLink !== null) return { spec: fromLink.spec, from: "link", ignored: fromLink.ignored };
  if (preset !== undefined) return { spec: { preset: preset.id, changes: {} }, from: "condition", ignored: [] };
  return { spec: cleanSpec(stored), from: "player", ignored: [] };
}
