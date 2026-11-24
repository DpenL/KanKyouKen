/** What the game remembers between visits. */

import type { Mode } from "./round";

export const STORE_KEY = "kk.kumiki.v1";

export interface Saved {
  readonly mode: Mode;
  readonly sound: boolean;
  /** 0..1. */
  readonly volume: number;
  /** Best deck score, by `bestKey`. */
  readonly best: Readonly<Record<string, number>>;
}

export const DEFAULT_SAVED: Saved = { mode: "learn", sound: true, volume: 0.6, best: {} };

/** Scores of the two modes are not comparable (Review can end rounds early), so each keeps its own best. */
export function bestKey(deckId: string, mode: Mode): string {
  return `${deckId}:${mode}`;
}

export function bestScore(saved: Saved, deckId: string, mode: Mode): number | null {
  const value = saved.best[bestKey(deckId, mode)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The best-score table after a run; unchanged when the run did not beat what is stored. */
export function withScore(saved: Saved, deckId: string, mode: Mode, score: number): Saved["best"] {
  const before = bestScore(saved, deckId, mode);
  return before !== null && before >= score ? saved.best : { ...saved.best, [bestKey(deckId, mode)]: score };
}
