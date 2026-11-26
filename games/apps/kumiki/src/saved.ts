/** What the game remembers between visits. */

import type { Mode } from "./round";
import { DEFAULT_SPEC, cleanSpec, type RuleSpec } from "./rules";

export const STORE_KEY = "kk.kumiki.v1";

export interface Saved {
  readonly mode: Mode;
  readonly sound: boolean;
  /** 0..1. */
  readonly volume: number;
  /** Best deck score, by `bestKey`. */
  readonly best: Readonly<Record<string, number>>;
  /** The rules chosen in Settings. */
  readonly rules: RuleSpec;
}

export const DEFAULT_SAVED: Saved = { mode: "learn", sound: true, volume: 0.6, best: {}, rules: DEFAULT_SPEC };

/**
 * What was read from storage, made safe to use: every field that is missing or of the
 * wrong kind falls back to its default, and only finite best scores are kept. Storage
 * can hold anything (an older version's data, a hand-edited value).
 */
export function cleanSaved(stored: Saved): Saved {
  const loose = stored as { readonly [K in keyof Saved]?: unknown };
  const best: Record<string, number> = {};
  if (loose.best !== null && typeof loose.best === "object" && !Array.isArray(loose.best)) {
    for (const [key, value] of Object.entries(loose.best)) {
      if (typeof value === "number" && Number.isFinite(value)) best[key] = value;
    }
  }
  return {
    mode: loose.mode === "learn" || loose.mode === "review" ? loose.mode : DEFAULT_SAVED.mode,
    sound: typeof loose.sound === "boolean" ? loose.sound : DEFAULT_SAVED.sound,
    volume:
      typeof loose.volume === "number" && Number.isFinite(loose.volume)
        ? Math.min(1, Math.max(0, loose.volume))
        : DEFAULT_SAVED.volume,
    best,
    rules: cleanSpec(loose.rules),
  };
}

/** The link form of the rules under which best scores were first kept; its keys carry no rules. */
const FIRST_RULES = "classic";

/**
 * Scores of the two modes are not comparable (Review can end rounds early), and neither
 * are scores made under different rules (five lives or none, hints for points or free),
 * so each mode and each set of rules keeps its own best. `rules` is the link form of the
 * rules in force (`formatRuleSpec`).
 */
export function bestKey(deckId: string, mode: Mode, rules: string = FIRST_RULES): string {
  return rules === FIRST_RULES ? `${deckId}:${mode}` : `${deckId}:${mode}:${rules}`;
}

export function bestScore(saved: Saved, deckId: string, mode: Mode, rules: string = FIRST_RULES): number | null {
  const value = saved.best[bestKey(deckId, mode, rules)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The best-score table after a run; unchanged when the run did not beat what is stored. */
export function withScore(saved: Saved, deckId: string, mode: Mode, score: number, rules: string = FIRST_RULES): Saved["best"] {
  const before = bestScore(saved, deckId, mode, rules);
  return before !== null && before >= score ? saved.best : { ...saved.best, [bestKey(deckId, mode, rules)]: score };
}
