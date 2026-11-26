/**
 * A run of assembly rounds: what one character hands to the next (hearts, hint tokens)
 * and how a finished round counts (solved, mastered, to be played again, the end of the
 * run).
 *
 * Observed in the Zen Hanzi demo (`ZEN_HANZI_RUN`): hearts go from character to
 * character, and running out of them ends the whole run. Kumiki's classic rules
 * (`CLASSIC_RUN`) and everything else here are our own design.
 */

import type { AssemblyRules, AssemblyState, RoundOutcome, RoundStart, RunRules } from "./types";

/** Kumiki classic: fresh hearts for every character; a lost character comes back later. */
export const CLASSIC_RUN: RunRules = { livesScope: "character", atZero: "fail-character" };

/** As the Zen Hanzi demo was seen to play: one stock of hearts for the run, and the run is over when it is empty. */
export const ZEN_HANZI_RUN: RunRules = { livesScope: "run", atZero: "end-run" };

/** The run rules used when none are given: those of the Zen Hanzi demo. */
export const DEFAULT_RUN: RunRules = ZEN_HANZI_RUN;

/** How far the "adaptive" lives rule moves away from `lives`, in hearts. */
export const ADAPTIVE_RANGE = 2;

/**
 * How a round that is over counts in its run (see `RoundOutcome`). A round still being
 * played is neither solved nor mastered, does not return and does not end the run.
 */
export function roundOutcome(state: AssemblyState, rules: AssemblyRules, run: RunRules): RoundOutcome {
  const hinted = state.hintsUsed > 0;
  return {
    solved: state.solved,
    mastered: state.solved && !(rules.hint === "unmastered" && hinted),
    returns: (state.failed && run.atZero === "fail-character") || (state.solved && rules.hint === "return" && hinted),
    endsRun: state.failed && run.atZero === "end-run",
  };
}

/**
 * What the round after `state` starts with (pass it to `startAssembly`).
 *
 *  - Hint tokens always go on to the next round.
 *  - Hearts under the lives rule "adaptive": the next character can hold one heart more
 *    than this one after a round that was lost or took two or more wrong attempts, one
 *    fewer after a first-try solve, the same otherwise; never more than `ADAPTIVE_RANGE`
 *    hearts away from `lives` and never fewer than one. It starts full.
 *  - Hearts under "parts", or with `livesScope` "character": nothing is handed on; the
 *    next character starts with what `heartsFor` gives it.
 *  - Otherwise (`livesScope` "run", the demo): the hearts left go on, out of the same
 *    most. After a round that was lost (which under "end-run" ends the run anyway) the
 *    next character starts full again.
 */
export function nextRoundStart(state: AssemblyState, rules: AssemblyRules, run: RunRules): RoundStart {
  const tokens = { hintTokens: state.hintTokens };
  if (rules.lives === null || state.livesMax === null) return tokens;
  if (rules.livesRule === "adaptive") {
    const wrong = state.attempts - (state.solved ? 1 : 0);
    const step = state.failed || wrong >= 2 ? 1 : state.solved && wrong === 0 ? -1 : 0;
    const most = Math.min(rules.lives + ADAPTIVE_RANGE, Math.max(1, rules.lives - ADAPTIVE_RANGE, state.livesMax + step));
    return { ...tokens, livesMax: most, livesLeft: most };
  }
  if (rules.livesRule === "parts" || run.livesScope === "character" || state.failed) return tokens;
  return { ...tokens, livesMax: state.livesMax, livesLeft: state.livesLeft };
}
