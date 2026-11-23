/**
 * Playing an assembly round: judging attempts and remembering what was tried.
 *
 * Mined from Zen Hanzi: feedback in three parts (structure right or wrong, how many
 * components are right, whether any is in the right place), per-slot marks only once
 * the structure is found, and lasting marks on everything that has been tried. Lives
 * and scoring are our own design.
 */

import type {
  AssemblyAttempt,
  AssemblyFeedback,
  AssemblyMemory,
  AssemblyPuzzle,
  AssemblyRules,
  AssemblyState,
  ComponentTile,
  TriedMark,
} from "./types";

/** Default lives and scoring. All numbers are our own. */
export const DEFAULT_RULES: AssemblyRules = {
  lives: 5,
  baseScore: 100,
  attemptCost: 15,
  hintCost: 25,
  minScore: 10,
};

/** The tiles behind an attempt's placements, after checking the attempt against the puzzle. */
function resolvePlacements(
  puzzle: AssemblyPuzzle,
  layoutIndex: number,
  placements: readonly (string | null)[],
): (ComponentTile | null)[] {
  const layout = Number.isInteger(layoutIndex) ? puzzle.layouts[layoutIndex] : undefined;
  if (layout === undefined) {
    throw new RangeError(`assembly: no structure ${layoutIndex} (the puzzle offers ${puzzle.layouts.length})`);
  }
  if (placements.length !== layout.slots.length) {
    throw new RangeError(
      `assembly: structure ${layout.signature} has ${layout.slots.length} slots, got ${placements.length} placements`,
    );
  }
  const used = new Set<string>();
  return placements.map((id) => {
    if (id === null) return null;
    const tile = puzzle.tray.find((candidate) => candidate.id === id);
    if (tile === undefined) throw new RangeError(`assembly: no tile ${JSON.stringify(id)} in the tray`);
    if (used.has(id)) throw new RangeError(`assembly: tile ${id} is placed twice`);
    used.add(id);
    return tile;
  });
}

function isRightStructure(puzzle: AssemblyPuzzle, layoutIndex: number): boolean {
  return puzzle.layouts[layoutIndex]?.signature === puzzle.layouts[puzzle.correctLayout]?.signature;
}

function judge(puzzle: AssemblyPuzzle, layoutIndex: number, tiles: readonly (ComponentTile | null)[]): AssemblyFeedback {
  const structureCorrect = isRightStructure(puzzle, layoutIndex);

  const needed = new Map<string, number>();
  for (const shows of puzzle.solution) needed.set(shows, (needed.get(shows) ?? 0) + 1);
  let correctComponents = 0;
  for (const tile of tiles) {
    const left = tile === null ? 0 : (needed.get(tile.shows) ?? 0);
    if (tile !== null && left > 0) {
      needed.set(tile.shows, left - 1);
      correctComponents++;
    }
  }

  const correctPositions = structureCorrect
    ? tiles.filter((tile, slot) => tile !== null && tile.shows === puzzle.solution[slot]).length
    : 0;
  return {
    structureCorrect,
    correctComponents,
    componentCount: puzzle.solution.length,
    correctPositions,
    anyInCorrectPosition: correctPositions > 0,
    solved: structureCorrect && correctPositions === puzzle.solution.length,
  };
}

/**
 * Judge one attempt without touching any state.
 *
 * Tiles are compared by what they show, so two tiles with the same shape are
 * interchangeable. `correctComponents` counts placed tiles that the target needs, each
 * needed component at most as often as the target has it, wherever the tiles sit and
 * whatever the structure. `correctPositions` counts tiles in exactly their slot and is
 * 0 under a wrong structure, whose slots have no counterpart. `solved` needs the right
 * structure and every slot right. Empty slots simply count for nothing.
 *
 * Throws a RangeError for a structure index the puzzle does not have, a placements
 * array that does not match the chosen structure's slot count, an unknown tile id, or
 * one tile placed in two slots.
 */
export function evaluateAttempt(puzzle: AssemblyPuzzle, attempt: AssemblyAttempt): AssemblyFeedback {
  return judge(puzzle, attempt.layout, resolvePlacements(puzzle, attempt.layout, attempt.placements));
}

/**
 * Fresh state for a round: nothing tried, all lives, no score.
 * `memory.tiles` lists every tile of the tray as "untried" and `memory.slotMisses` has
 * one empty list per slot of the right structure. Throws a RangeError when
 * `rules.lives` is neither null nor a positive integer.
 */
export function startAssembly(puzzle: AssemblyPuzzle, rules: AssemblyRules = DEFAULT_RULES): AssemblyState {
  if (rules.lives !== null && (!Number.isInteger(rules.lives) || rules.lives < 1)) {
    throw new RangeError(`startAssembly: lives must be null or a positive integer, got ${rules.lives}`);
  }
  const tiles: Record<string, TriedMark> = {};
  for (const tile of puzzle.tray) tiles[tile.id] = "untried";
  return {
    attempts: 0,
    hintsUsed: 0,
    livesLeft: rules.lives,
    memory: {
      layouts: puzzle.layouts.map(() => "untried"),
      tiles,
      slotMisses: puzzle.solution.map(() => []),
      structureFound: false,
    },
    solved: false,
    failed: false,
    score: 0,
    history: [],
  };
}

function remember(
  memory: AssemblyMemory,
  puzzle: AssemblyPuzzle,
  layoutIndex: number,
  placed: readonly (ComponentTile | null)[],
  structureCorrect: boolean,
): AssemblyMemory {
  const layouts = memory.layouts.map((mark, index) =>
    index === layoutIndex ? (structureCorrect ? "right" : "wrong") : mark,
  );
  const tiles: Record<string, TriedMark> = { ...memory.tiles };
  for (const tile of placed) {
    if (tile !== null) tiles[tile.id] = puzzle.solution.includes(tile.shows) ? "right" : "wrong";
  }
  const slotMisses = structureCorrect
    ? puzzle.solution.map((shows, slot) => {
        const known = memory.slotMisses[slot] ?? [];
        const tile = placed[slot] ?? null;
        return tile !== null && tile.shows !== shows && !known.includes(tile.id) ? [...known, tile.id] : known;
      })
    : memory.slotMisses;
  return { layouts, tiles, slotMisses, structureFound: memory.structureFound || structureCorrect };
}

/**
 * Play one attempt: judge it and return the next state together with the feedback.
 *
 * Memory (as in the paper): the chosen structure is marked right or wrong; every placed
 * tile is marked "right" if the target needs its shape anywhere and "wrong" if not;
 * and, for attempts made with the right structure, a tile that is wrong for the slot it
 * sits in is added to that slot's misses (once). Attempts with a wrong structure never
 * add slot misses, because their slots are not the target's.
 *
 * Lives and score (our own): an attempt that does not solve the puzzle costs one life
 * when lives are limited, and the round is failed when none is left. Solving scores
 * `baseScore - attemptCost * wrong attempts - hintCost * hints`, but at least
 * `minScore`. `rules` should be the rules the round was started with; lives are read
 * from the state.
 *
 * Once the round is solved or failed, further submissions change nothing: the same
 * state comes back with the feedback of the final attempt, and the attempt is not even
 * checked. Otherwise throws a RangeError for the malformed attempts listed under
 * `evaluateAttempt`; the state is not advanced.
 */
export function submitAttempt(
  state: AssemblyState,
  puzzle: AssemblyPuzzle,
  attempt: AssemblyAttempt,
  rules: AssemblyRules = DEFAULT_RULES,
): { state: AssemblyState; feedback: AssemblyFeedback } {
  if (state.solved || state.failed) {
    const last = state.history[state.history.length - 1];
    return { state, feedback: last ? last.feedback : evaluateAttempt(puzzle, attempt) };
  }
  const placed = resolvePlacements(puzzle, attempt.layout, attempt.placements);
  const feedback = judge(puzzle, attempt.layout, placed);
  const livesLeft = state.livesLeft === null || feedback.solved ? state.livesLeft : Math.max(0, state.livesLeft - 1);
  const next: AssemblyState = {
    attempts: state.attempts + 1,
    hintsUsed: state.hintsUsed,
    livesLeft,
    memory: remember(state.memory, puzzle, attempt.layout, placed, feedback.structureCorrect),
    solved: feedback.solved,
    failed: !feedback.solved && livesLeft === 0,
    score: feedback.solved
      ? Math.max(
          rules.minScore,
          rules.baseScore - rules.attemptCost * state.attempts - rules.hintCost * state.hintsUsed,
        )
      : 0,
    history: [
      ...state.history,
      { attempt: { layout: attempt.layout, placements: [...attempt.placements] }, feedback },
    ],
  };
  return { state: next, feedback };
}

/**
 * Record that the player asked for a hint (in Zen Hanzi: a look at the character).
 * Each hint lowers the score a solved round earns by `hintCost`. No effect once the
 * round is solved or failed.
 */
export function useHint(state: AssemblyState): AssemblyState {
  if (state.solved || state.failed) return state;
  return { ...state, hintsUsed: state.hintsUsed + 1 };
}

/**
 * Score a composition made without feedback, as in a post-test: how many slots of the
 * RIGHT structure hold a tile showing the right component (0 to `solution.length`).
 * `placements` has one tile id or null per slot of the right structure. The structure
 * itself is not being tested here. Throws a RangeError for a wrong number of
 * placements, an unknown tile id, or a tile placed twice.
 */
export function scoreComposition(puzzle: AssemblyPuzzle, placements: readonly (string | null)[]): number {
  const placed = resolvePlacements(puzzle, puzzle.correctLayout, placements);
  return placed.filter((tile, slot) => tile !== null && tile.shows === puzzle.solution[slot]).length;
}
