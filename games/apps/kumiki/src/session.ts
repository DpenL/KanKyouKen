/** A run through a deck: which character comes next, what each round earned and handed on, and the totals at the end. */

import type { RoundOutcome, RoundStart } from "@kankyouken/mechanics/components";
import type { Mode } from "./round";

export interface RoundResult {
  readonly char: string;
  readonly solved: boolean;
  readonly attempts: number;
  readonly hints: number;
  readonly score: number;
  /** Solved in a way that counts as mastered (see the hint policy "unmastered"). Taken as `solved` when left out. */
  readonly mastered?: boolean;
}

/** How a round ends for its run: see `roundOutcome` and `nextRoundStart` in the mechanics library. */
export interface RoundEnd {
  /** The character is played again at the end of the deck (once). */
  readonly returns: boolean;
  /** The run is over: out of lives under the rule that ends it there. */
  readonly endsRun: boolean;
  /** What the next round starts with: hearts left, hint tokens. */
  readonly carry: RoundStart;
}

export interface Session {
  readonly deckId: string;
  readonly mode: Mode;
  /** Characters in playing order; a character that returns is appended once. */
  readonly queue: readonly string[];
  readonly index: number;
  /** Characters that already had their second chance. */
  readonly retried: readonly string[];
  readonly results: readonly RoundResult[];
  /** What the next round is handed by the one before; empty before the first. */
  readonly carry: RoundStart;
  /** The run ended before the deck did, out of lives. */
  readonly outOfLives: boolean;
}

export interface SessionSummary {
  /** The last round of every character, added up: a character played twice counts once. */
  readonly score: number;
  /** Distinct characters played in the run. */
  readonly chars: number;
  readonly solved: number;
  /** Characters solved in a round that counts as mastered. */
  readonly mastered: number;
  /** Characters solved with the first check of their first round. */
  readonly firstTry: number;
  readonly hints: number;
  readonly outOfLives: boolean;
}

export function startSession(deckId: string, mode: Mode, chars: readonly string[]): Session {
  return { deckId, mode, queue: [...chars], index: 0, retried: [], results: [], carry: {}, outOfLives: false };
}

/** The character to play now; null at the end of the deck, and once the run has ended out of lives. */
export function currentChar(session: Session): string | null {
  return session.outOfLives ? null : (session.queue[session.index] ?? null);
}

/** How a round ends when nobody says otherwise, as in Kumiki classic: a failed character returns, nothing is handed on. */
export function classicEnd(result: RoundResult): RoundEnd {
  return { returns: !result.solved, endsRun: false, carry: {} };
}

/** What `roundOutcome` and `nextRoundStart` say about a round, as the run needs it. */
export function roundEnd(outcome: RoundOutcome, carry: RoundStart): RoundEnd {
  return { returns: outcome.returns, endsRun: outcome.endsRun, carry };
}

/**
 * Record a finished round and move on. A character that returns (failed, or solved with
 * a hint under the rule that brings it back) goes to the end of the deck, once. A round
 * that ends the run leaves nothing to play.
 */
export function finishRound(session: Session, result: RoundResult, end: RoundEnd = classicEnd(result)): Session {
  const retry = end.returns && !end.endsRun && !session.retried.includes(result.char);
  return {
    ...session,
    queue: retry ? [...session.queue, result.char] : session.queue,
    retried: retry ? [...session.retried, result.char] : session.retried,
    index: session.index + 1,
    results: [...session.results, result],
    carry: end.carry,
    outOfLives: end.endsRun,
  };
}

/** True when `char` would come back if its round ended with `returns` now. */
export function canReturn(session: Session, char: string): boolean {
  return !session.retried.includes(char);
}

export function summarize(session: Session): SessionSummary {
  const firstRound = new Map<string, RoundResult>();
  const lastRound = new Map<string, RoundResult>();
  const solved = new Set<string>();
  const mastered = new Set<string>();
  for (const result of session.results) {
    if (!firstRound.has(result.char)) firstRound.set(result.char, result);
    lastRound.set(result.char, result);
    if (result.solved) solved.add(result.char);
    if (result.mastered ?? result.solved) mastered.add(result.char);
  }
  return {
    // Only the last round of a character counts, so that coming back cannot earn its points twice.
    score: [...lastRound.values()].reduce((sum, result) => sum + result.score, 0),
    chars: firstRound.size,
    solved: solved.size,
    mastered: mastered.size,
    firstTry: [...firstRound.values()].filter((result) => result.solved && result.attempts === 1).length,
    hints: session.results.reduce((sum, result) => sum + result.hints, 0),
    outOfLives: session.outOfLives,
  };
}
