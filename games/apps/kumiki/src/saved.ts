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
  };
}

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
