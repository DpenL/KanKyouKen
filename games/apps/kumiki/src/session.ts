/** A run through a deck: which character comes next, what each round earned, and the totals at the end. */

import type { Mode } from "./round";

export interface RoundResult {
  readonly char: string;
  readonly solved: boolean;
  readonly attempts: number;
  readonly hints: number;
  readonly score: number;
}

export interface Session {
  readonly deckId: string;
  readonly mode: Mode;
  /** Characters in playing order; a failed character is appended once. */
  readonly queue: readonly string[];
  readonly index: number;
  /** Characters that already had their second chance. */
  readonly retried: readonly string[];
  readonly results: readonly RoundResult[];
}

export interface SessionSummary {
  readonly score: number;
  /** Distinct characters in the run. */
  readonly chars: number;
  readonly solved: number;
  /** Characters solved with the first check of their first round. */
  readonly firstTry: number;
  readonly hints: number;
}

export function startSession(deckId: string, mode: Mode, chars: readonly string[]): Session {
  return { deckId, mode, queue: [...chars], index: 0, retried: [], results: [] };
}

export function currentChar(session: Session): string | null {
  return session.queue[session.index] ?? null;
}

/** Record a finished round and move on. A character the player failed goes to the end of the deck, once. */
export function finishRound(session: Session, result: RoundResult): Session {
  const retry = !result.solved && !session.retried.includes(result.char);
  return {
    ...session,
    queue: retry ? [...session.queue, result.char] : session.queue,
    retried: retry ? [...session.retried, result.char] : session.retried,
    index: session.index + 1,
    results: [...session.results, result],
  };
}

export function summarize(session: Session): SessionSummary {
  const firstRound = new Map<string, RoundResult>();
  const solved = new Set<string>();
  for (const result of session.results) {
    if (!firstRound.has(result.char)) firstRound.set(result.char, result);
    if (result.solved) solved.add(result.char);
  }
  return {
    score: session.results.reduce((sum, result) => sum + result.score, 0),
    chars: firstRound.size,
    solved: solved.size,
    firstTry: [...firstRound.values()].filter((result) => result.solved && result.attempts === 1).length,
    hints: session.results.reduce((sum, result) => sum + result.hints, 0),
  };
}
