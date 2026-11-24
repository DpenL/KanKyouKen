/**
 * The composition test: for each character only the right structure is shown, the
 * player fills it, and nothing is revealed until the whole deck is done.
 */

import { scoreComposition, type AssemblyPuzzle } from "@kankyouken/mechanics/components";
import type { ChoiceAttemptData } from "@kankyouken/mechanics/telemetry";
import { describeBoard } from "./round";
import type { Board } from "./board";

export interface ExamResult {
  readonly char: string;
  /** Slots holding the right component. */
  readonly score: number;
  readonly slots: number;
}

export interface Exam {
  readonly deckId: string;
  readonly chars: readonly string[];
  readonly index: number;
  readonly results: readonly ExamResult[];
}

export function startExam(deckId: string, chars: readonly string[]): Exam {
  return { deckId, chars: [...chars], index: 0, results: [] };
}

export function examChar(exam: Exam): string | null {
  return exam.chars[exam.index] ?? null;
}

/** Payload of the one `choice_attempt` event an exam item produces. */
export interface ExamData extends ChoiceAttemptData {
  readonly slots_correct: number;
  readonly slots_total: number;
}

/** Score the board as it stands (empty slots count for nothing) and move to the next character. */
export function submitExamItem(
  exam: Exam,
  puzzle: AssemblyPuzzle,
  board: Board,
  responseTimeMs: number,
): { exam: Exam; data: ExamData } {
  const slots = puzzle.solution.length;
  const placements = puzzle.solution.map((_, slot) => board.slots[slot] ?? null);
  const score = scoreComposition(puzzle, placements);
  const data: ExamData = {
    correct: score === slots,
    response_time_ms: Math.max(0, Math.round(responseTimeMs)),
    target: puzzle.target,
    chosen: describeBoard(puzzle, { layout: puzzle.correctLayout, slots: placements }),
    options: puzzle.tray.map((tile) => tile.shows),
    attempt: 1,
    slots_correct: score,
    slots_total: slots,
  };
  return {
    exam: { ...exam, index: exam.index + 1, results: [...exam.results, { char: puzzle.target, score, slots }] },
    data,
  };
}

export function examTotals(exam: Exam): { score: number; slots: number } {
  return {
    score: exam.results.reduce((sum, result) => sum + result.score, 0),
    slots: exam.results.reduce((sum, result) => sum + result.slots, 0),
  };
}
