/**
 * One assembly round: the puzzle, what the player has placed, and what a check does.
 * Pure: time comes in as arguments, so the flow can be tested without a clock.
 */

import {
  createAssemblyPuzzle,
  DEFAULT_RULES,
  startAssembly,
  submitAttempt,
  useHint,
  type AssemblyFeedback,
  type AssemblyPuzzle,
  type AssemblyRules,
  type AssemblyState,
  type PuzzleOptions,
} from "@kankyouken/mechanics/components";
import type { ChoiceAttemptData } from "@kankyouken/mechanics/telemetry";
import type { Rng } from "@kankyouken/mechanics/util";
import { EMPTY_BOARD, isFull, placeTile, removeTile, type Board } from "./board";
import type { Content } from "./content";

/** "learn": the character is shown first and tries are unlimited. "review": meaning and reading only, five lives. */
export type Mode = "learn" | "review";

const PUZZLE_OPTIONS: PuzzleOptions = { layoutChoices: 4, lookAlikesPerComponent: 2, trayRows: 3, traySize: 12 };

export function rulesFor(mode: Mode): AssemblyRules {
  return mode === "learn" ? { ...DEFAULT_RULES, lives: null } : DEFAULT_RULES;
}

export function buildPuzzle(char: string, content: Content, rng: Rng): AssemblyPuzzle {
  const glyph = content.glyphs.get(char);
  if (glyph === undefined) throw new Error(`No glyph for ${char}`);
  return createAssemblyPuzzle(glyph, content.context, PUZZLE_OPTIONS, rng);
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
  /** When the round started or was last checked; response times are measured from here. */
  readonly since: number;
}

export function startRound(char: string, mode: Mode, puzzle: AssemblyPuzzle, now: number): Round {
  const rules = rulesFor(mode);
  return { char, mode, puzzle, rules, state: startAssembly(puzzle, rules), board: EMPTY_BOARD, feedback: null, since: now };
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

export function canCheck(round: Round): boolean {
  return !isOver(round) && isFull(round.board);
}

/** Payload of the `choice_attempt` event a check produces. */
export interface CheckData extends ChoiceAttemptData {
  readonly structure_correct: boolean;
  readonly correct_components: number;
  readonly correct_positions: number;
  readonly lives_left: number | null;
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
  const { state, feedback } = submitAttempt(
    round.state,
    round.puzzle,
    { layout: round.board.layout, placements: round.board.slots },
    round.rules,
  );
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
  };
  return { round: { ...round, state, feedback, since: now }, data };
}

/** Count a look at the whole character; it lowers what a solved round is worth. */
export function takeHint(round: Round): Round {
  return { ...round, state: useHint(round.state) };
}

/** Points a solved round would earn right now, shown while playing. */
export function potentialScore(round: Round): number {
  const { baseScore, attemptCost, hintCost, minScore } = round.rules;
  return Math.max(minScore, baseScore - attemptCost * round.state.attempts - hintCost * round.state.hintsUsed);
}
