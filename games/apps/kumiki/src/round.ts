/**
 * One assembly round: the puzzle, what the player has placed, and what a check does.
 * Pure: time comes in as arguments, so the flow can be tested without a clock.
 */

import {
  canHint,
  createAssemblyPuzzle,
  hintPrice,
  judgesItself,
  placementsAfterCheck,
  solvePoints,
  startAssembly,
  submitAttempt,
  useHint,
  type AssemblyFeedback,
  type AssemblyPuzzle,
  type AssemblyRules,
  type AssemblyState,
  type HintPolicy,
  type HintPrice,
  type PuzzleOptions,
  type RoundStart,
} from "@kankyouken/mechanics/components";
import type { ChoiceAttemptData } from "@kankyouken/mechanics/telemetry";
import type { Rng } from "@kankyouken/mechanics/util";
import { EMPTY_BOARD, isFull, placeTile, removeTile, type Board } from "./board";
import type { Content } from "./content";
import { DEFAULT_SPEC, assemblyRules, puzzleOptions, resolveChoices, type RuleChoices } from "./rules";

/** "learn": the character is shown first. "review": meaning and reading only. What else differs is up to the rules. */
export type Mode = "learn" | "review";

/** The rules of a round of `mode` under `choices` (by default the default preset's). */
export function rulesFor(mode: Mode, choices: RuleChoices = resolveChoices(DEFAULT_SPEC)): AssemblyRules {
  return assemblyRules(choices, mode);
}

export function buildPuzzle(
  char: string,
  content: Content,
  rng: Rng,
  options: PuzzleOptions = puzzleOptions(resolveChoices(DEFAULT_SPEC), content.frames),
): AssemblyPuzzle {
  const glyph = content.glyphs.get(char);
  if (glyph === undefined) throw new Error(`No glyph for ${char}`);
  return createAssemblyPuzzle(glyph, content.context, options, rng);
}

export interface Round {
  readonly char: string;
  readonly mode: Mode;
  readonly puzzle: AssemblyPuzzle;
  readonly rules: AssemblyRules;
  readonly state: AssemblyState;
  readonly board: Board;
  /** Feedback of the latest check, or null before the first. */
  readonly feedback: AssemblyFeedback | null;
  /** The board as it was at the latest check, or null before the first. */
  readonly checked: Board | null;
  /** When the round started or was last checked; response times are measured from here. */
  readonly since: number;
}

/** Start a round; `start` is what the run hands on from the round before (hearts left, hint tokens). */
export function startRound(
  char: string,
  mode: Mode,
  puzzle: AssemblyPuzzle,
  now: number,
  rules: AssemblyRules = rulesFor(mode),
  start: RoundStart = {},
): Round {
  return {
    char,
    mode,
    puzzle,
    rules,
    state: startAssembly(puzzle, rules, start),
    board: EMPTY_BOARD,
    feedback: null,
    checked: null,
    since: now,
  };
}

export function isOver(round: Round): boolean {
  return round.state.solved || round.state.failed;
}

/** Put a tile into a slot of one of the structures (see `placeTile`). Nothing moves once the round is over. */
export function moveTile(round: Round, layout: number, slot: number, tileId: string): Round {
  const target = round.puzzle.layouts[layout];
  if (isOver(round) || target === undefined) return round;
  return { ...round, board: placeTile(round.board, layout, target.slots.length, slot, tileId) };
}

export function returnTile(round: Round, tileId: string): Round {
  return isOver(round) ? round : { ...round, board: removeTile(round.board, tileId) };
}

function sameBoard(a: Board, b: Board): boolean {
  return a.layout === b.layout && a.slots.length === b.slots.length && a.slots.every((id, slot) => id === b.slots[slot]);
}

/**
 * A full board can be checked once: judging the same arrangement again could only repeat
 * the answer and cost another life (a double tap on Check would do exactly that). When
 * the rules send tiles back after a check, the board is no longer full, so a double tap
 * finds nothing to check; building the same answer again is then a new attempt, which
 * the Zen Hanzi demo judges (and charges for) again.
 */
export function canCheck(round: Round): boolean {
  if (isOver(round) || !isFull(round.board)) return false;
  return round.rules.afterCheck !== "keep" || round.checked === null || !sameBoard(round.board, round.checked);
}

/** True when the rules judge the board by themselves now (`check: "auto"` and a board that can be checked). */
export function checksItself(round: Round): boolean {
  return (
    round.board.layout !== null &&
    canCheck(round) &&
    judgesItself(round.state, round.puzzle, { layout: round.board.layout, placements: round.board.slots }, round.rules)
  );
}

/** Payload of the `choice_attempt` event a check produces. */
export interface CheckData extends ChoiceAttemptData {
  readonly structure_correct: boolean;
  readonly correct_components: number;
  readonly correct_positions: number;
  /** Hearts after this check (whole or half), or null without lives. */
  readonly lives_left: number | null;
  /** The most hearts the round can hold, or null without lives. */
  readonly lives_max: number | null;
  /** Hearts this check cost (a wrong one) and gave back (a solve). */
  readonly lives_lost: number;
  readonly lives_gained: number;
  /** Points this check earned, and the round's points so far. */
  readonly points: number;
  readonly score: number;
}

/** Payload of the `hint_shown` event: what the look cost under the hint policy in force. */
export interface HintData {
  readonly hint: "character";
  readonly hints_used: number;
  readonly policy: HintPolicy;
  /** Hearts, points off the solve, and tokens the hint took. */
  readonly lives_lost: number;
  readonly points_lost: number;
  readonly tokens_spent: number;
  /** What it means for the character in its run: it returns later, or does not count as mastered. */
  readonly consequence: HintPrice["consequence"];
  readonly lives_left: number | null;
  readonly tokens_left: number;
  /** The hint took the last of the hearts. */
  readonly out_of_lives: boolean;
}

/** What the player built, as text: the structure's signature, then what each slot shows. */
export function describeBoard(puzzle: AssemblyPuzzle, board: Board): string {
  const signature = board.layout === null ? "" : (puzzle.layouts[board.layout]?.signature ?? "");
  const shows = board.slots.map((id) => puzzle.tray.find((tile) => tile.id === id)?.shows ?? "_");
  return [signature, ...shows].join("+");
}

/** Check what is on the board. Returns null when the board is not ready to be checked. */
export function check(round: Round, now: number): { round: Round; data: CheckData } | null {
  if (!canCheck(round) || round.board.layout === null) return null;
  const attempt = { layout: round.board.layout, placements: round.board.slots };
  const { state, feedback } = submitAttempt(round.state, round.puzzle, attempt, round.rules);
  // What stays in the structure for the next try; once the round is over nothing moves.
  const board: Board = state.failed
    ? round.board
    : { layout: round.board.layout, slots: placementsAfterCheck(round.puzzle, attempt, round.rules) };
  const data: CheckData = {
    correct: feedback.solved,
    response_time_ms: Math.max(0, Math.round(now - round.since)),
    target: round.char,
    chosen: describeBoard(round.puzzle, round.board),
    options: round.puzzle.tray.map((tile) => tile.shows),
    attempt: state.attempts,
    structure_correct: feedback.structureCorrect,
    correct_components: feedback.correctComponents,
    correct_positions: feedback.correctPositions,
    lives_left: state.livesLeft,
    lives_max: state.livesMax,
    lives_lost: Math.max(0, (round.state.livesLeft ?? 0) - (state.livesLeft ?? 0)),
    lives_gained: Math.max(0, (state.livesLeft ?? 0) - (round.state.livesLeft ?? 0)),
    points: state.score - (round.rules.scoring === "demo" ? round.state.score : 0),
    score: state.score,
  };
  return { round: { ...round, state, feedback, board, checked: round.board, since: now }, data };
}

/** Whether a hint can be taken now (see `canHint`): not after the round, not without hints, not without a token when hints cost one. */
export function canTakeHint(round: Round): boolean {
  return canHint(round.state, round.rules);
}

/** What the next hint would cost (see `hintPrice`). */
export function hintCharge(round: Round): HintPrice {
  return hintPrice(round.state, round.puzzle, round.rules);
}

/** Count a look at the whole character and charge what the hint policy asks (see `useHint`). */
export function takeHint(round: Round): Round {
  return { ...round, state: useHint(round.state, round.rules) };
}

/** Take a hint and say what it cost; null when none can be taken. */
export function lookAtCharacter(round: Round): { round: Round; data: HintData } | null {
  if (!canTakeHint(round)) return null;
  const price = hintCharge(round);
  const after = takeHint(round);
  const data: HintData = {
    hint: "character",
    hints_used: after.state.hintsUsed,
    policy: price.policy,
    lives_lost: price.lives,
    points_lost: price.points,
    tokens_spent: price.tokens,
    consequence: price.consequence,
    lives_left: after.state.livesLeft,
    tokens_left: after.state.hintTokens,
    out_of_lives: after.state.failed,
  };
  return { round: after, data };
}

/** Points solving would earn right now, shown while playing (see `solvePoints`). */
export function potentialScore(round: Round): number {
  return solvePoints(round.rules, round.puzzle.solution.length, round.state.attempts + 1, round.state.hintsUsed);
}
