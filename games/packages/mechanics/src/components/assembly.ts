/**
 * Playing an assembly round: judging attempts and remembering what was tried.
 *
 * Mined from Zen Hanzi: feedback in three parts (structure right or wrong, how many
 * components are right, whether any is in the right place), per-slot marks only once
 * the structure is found, and lasting marks on everything that has been tried. The paper
 * shows hearts and a score without saying how they work; the lives, hint and scoring rules
 * here are either what the public demo was seen to do (`ZEN_HANZI_RULES`) or our own
 * (`CLASSIC_RULES` and every other option), as each says.
 */

import type {
  AssemblyAttempt,
  AssemblyFeedback,
  AssemblyMemory,
  AssemblyPuzzle,
  AssemblyRules,
  AssemblyState,
  ComponentTile,
  HintPolicy,
  RoundStart,
  TriedMark,
} from "./types";

/**
 * The numbers of the "demo" scoring. Observed in the Zen Hanzi demo; the formula is
 * inferred from the values seen (800/900/1000 for a first-try solve of 2/3/4 parts,
 * 460/540 at the second attempt, 280 and 220 for three parts at the third and fourth).
 */
export const DEMO_SCORING = {
  /** A wrong attempt in the right structure. */
  structure: 100,
  /** Per placed part that belongs to the character, in a wrong attempt. */
  belongs: 10,
  /** Per part in its own slot, in a wrong attempt. */
  inPlace: 10,
  /**
   * How many wrong attempts on one character earn points. Ours, not the demo's: the
   * demo's three hearts allow five wrong attempts before a solve, and within those every
   * number here is the demo's. With more lives or none, wrong attempts would otherwise
   * add up without end, and a character would be worth more failed on purpose than
   * solved at once (five wrong attempts and a solve stay 100 below a first-try solve).
   */
  paidWrongAttempts: 5,
  /** Any solve. */
  solve: 100,
  /** Per part of a solved character, less `perAttempt` for every attempt made (the solving one included). */
  perPart: 120,
  perAttempt: 20,
  /** Bonus for solving at the first and at the second attempt. */
  firstTry: 500,
  secondTry: 200,
} as const;

/**
 * Kumiki's rules before the Zen Hanzi demo could be played: a Check button, the board
 * left as it was after a wrong attempt, five lives per character, one lost per wrong
 * attempt and none given back, and a score that drops with every wrong attempt and hint.
 * All numbers are our own.
 */
export const CLASSIC_RULES: AssemblyRules = {
  check: "button",
  afterCheck: "keep",
  lives: 5,
  livesRule: "fixed",
  wrongCost: 1,
  solveGain: 0,
  scoring: "classic",
  baseScore: 100,
  attemptCost: 15,
  hintCost: 25,
  minScore: 10,
  hint: "points",
  hintLives: 0.5,
  tokenStart: 1,
  tokenMax: 3,
};

/**
 * Rules as the Zen Hanzi demo was seen to play (see MECHANICS.md Part 2, "observed in the
 * public demo"): a Check button, only the tiles in their right slot stay after a wrong
 * attempt, three hearts lost in halves (half for a wrong attempt, half for a hint), one
 * heart back for a solve, and the demo's scoring. The numbers the demo has no use for
 * (the classic score, hint tokens) are Kumiki's, so that switching one option on its own
 * gives something playable.
 */
export const ZEN_HANZI_RULES: AssemblyRules = {
  check: "button",
  afterCheck: "keep-correct",
  lives: 3,
  livesRule: "fixed",
  wrongCost: 0.5,
  solveGain: 1,
  scoring: "demo",
  baseScore: 100,
  attemptCost: 15,
  hintCost: 25,
  minScore: 10,
  hint: "life",
  hintLives: 0.5,
  tokenStart: 1,
  tokenMax: 3,
};

/** The rules used when none are given: those of the Zen Hanzi demo. */
export const DEFAULT_RULES: AssemblyRules = ZEN_HANZI_RULES;

const CHECK_TRIGGERS: readonly AssemblyRules["check"][] = ["button", "auto"];
const AFTER_CHECKS: readonly AssemblyRules["afterCheck"][] = ["keep", "keep-correct", "clear"];
const LIVES_RULES: readonly AssemblyRules["livesRule"][] = ["fixed", "parts", "adaptive"];
const SCORINGS: readonly AssemblyRules["scoring"][] = ["classic", "demo"];
const HINT_POLICIES: readonly HintPolicy[] = ["life", "points", "token", "return", "unmastered", "free", "off"];

/** Whole or half hearts, none negative. */
function isHearts(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && Number.isInteger(value * 2);
}

/**
 * Throws a RangeError when `rules` cannot be played: an unknown check trigger,
 * after-check policy, lives rule, scoring or hint policy; lives that are neither null nor
 * a positive number of whole or half hearts; heart costs and gains that are not whole or
 * half hearts; or hint tokens that are not whole numbers with `tokenStart` within
 * `tokenMax`.
 */
export function validateRules(rules: AssemblyRules, where = "rules"): void {
  if (!CHECK_TRIGGERS.includes(rules.check)) throw new RangeError(`${where}: unknown check ${JSON.stringify(rules.check)}`);
  if (!AFTER_CHECKS.includes(rules.afterCheck)) {
    throw new RangeError(`${where}: unknown afterCheck ${JSON.stringify(rules.afterCheck)}`);
  }
  if (rules.lives !== null && (!isHearts(rules.lives) || rules.lives < 1)) {
    throw new RangeError(`${where}: lives must be null or at least one heart, in whole or half hearts, got ${rules.lives}`);
  }
  if (!LIVES_RULES.includes(rules.livesRule)) throw new RangeError(`${where}: unknown livesRule ${JSON.stringify(rules.livesRule)}`);
  if (!SCORINGS.includes(rules.scoring)) throw new RangeError(`${where}: unknown scoring ${JSON.stringify(rules.scoring)}`);
  if (!HINT_POLICIES.includes(rules.hint)) throw new RangeError(`${where}: unknown hint policy ${JSON.stringify(rules.hint)}`);
  for (const key of ["wrongCost", "solveGain", "hintLives"] as const) {
    if (!isHearts(rules[key])) throw new RangeError(`${where}: ${key} must be whole or half hearts, got ${rules[key]}`);
  }
  const tokens = [rules.tokenStart, rules.tokenMax];
  if (!tokens.every((count) => Number.isInteger(count) && count >= 0) || rules.tokenStart > rules.tokenMax) {
    throw new RangeError(`${where}: hint tokens must be whole numbers with tokenStart within tokenMax, got ${tokens.join(" and ")}`);
  }
}

/**
 * The hearts a character of `parts` parts starts with under `rules` (see `LivesRule`):
 * null without lives; `lives` under "fixed" and "adaptive" (whose changes from character
 * to character come from `nextRoundStart`); under "parts", `lives` for three parts and
 * proportionally more or fewer for others, rounded to half a heart and at least one
 * (with 3 lives: 2, 3 and 4 hearts for 2, 3 and 4 parts).
 */
export function heartsFor(rules: AssemblyRules, parts: number): number | null {
  if (rules.lives === null) return null;
  if (rules.livesRule !== "parts") return rules.lives;
  return Math.max(1, Math.round((rules.lives * parts * 2) / 3) / 2);
}

/**
 * Points a wrong attempt earns: under "demo" scoring 100 for the right structure, 10 per
 * placed part that belongs and 10 per part in its own slot; under "classic" nothing.
 * Only the first `DEMO_SCORING.paidWrongAttempts` wrong attempts on a character earn
 * anything: `wrongBefore` is how many were made before this one. A solving attempt gives
 * 0 here: see `solvePoints`.
 */
export function attemptPoints(rules: AssemblyRules, feedback: AssemblyFeedback, wrongBefore = 0): number {
  if (rules.scoring !== "demo" || feedback.solved) return 0;
  if (wrongBefore >= DEMO_SCORING.paidWrongAttempts) return 0;
  return (
    (feedback.structureCorrect ? DEMO_SCORING.structure : 0) +
    DEMO_SCORING.belongs * feedback.correctComponents +
    DEMO_SCORING.inPlace * feedback.correctPositions
  );
}

/**
 * What solving a character of `parts` parts is worth at attempt number `attempt` (1 for
 * the first) after `hints` hints.
 *  - "classic": `baseScore - attemptCost * (attempt - 1)`.
 *  - "demo": `100 + parts * (120 - 20 * attempt)`, plus 500 at the first attempt and 200
 *    at the second; a part is never worth less than nothing, so from the sixth attempt on
 *    a solve is worth 100.
 * Under the hint policy "points" each hint takes `hintCost` off. Never less than `minScore`.
 */
export function solvePoints(rules: AssemblyRules, parts: number, attempt: number, hints: number): number {
  const worth =
    rules.scoring === "demo"
      ? DEMO_SCORING.solve +
        parts * Math.max(0, DEMO_SCORING.perPart - DEMO_SCORING.perAttempt * attempt) +
        (attempt === 1 ? DEMO_SCORING.firstTry : attempt === 2 ? DEMO_SCORING.secondTry : 0)
      : rules.baseScore - rules.attemptCost * (attempt - 1);
  return Math.max(rules.minScore, worth - (rules.hint === "points" ? rules.hintCost * hints : 0));
}

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
    slotCount: tiles.length,
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
 * Fresh state for a round: nothing tried, no score, and the hearts the rules give a
 * character of this many parts (`heartsFor`). `start` carries over what a run hands from
 * one round to the next (`nextRoundStart`): the hearts left, the most the round can hold,
 * and the hint tokens in hand (by default the rules' `tokenStart`).
 * `memory.tiles` lists every tile of the tray as "untried" and `memory.slotMisses` has
 * one empty list per slot of the right structure. Throws a RangeError for rules that
 * `validateRules` refuses, and for a start without hearts (none left, or not whole or
 * half hearts) or with tokens that are not a whole number; hearts beyond the most the
 * round can hold and tokens beyond `tokenMax` are cut down to it.
 */
export function startAssembly(puzzle: AssemblyPuzzle, rules: AssemblyRules = DEFAULT_RULES, start: RoundStart = {}): AssemblyState {
  validateRules(rules, "startAssembly");
  const full = heartsFor(rules, puzzle.solution.length);
  const livesMax = full === null ? null : (start.livesMax ?? full);
  const livesLeft = livesMax === null ? null : Math.min(livesMax, start.livesLeft ?? livesMax);
  for (const hearts of [livesMax, livesLeft]) {
    if (hearts !== null && (!isHearts(hearts) || hearts <= 0)) {
      throw new RangeError(`startAssembly: a round starts with at least half a heart, in whole or half hearts, got ${hearts}`);
    }
  }
  const hintTokens = start.hintTokens ?? rules.tokenStart;
  if (!Number.isInteger(hintTokens) || hintTokens < 0) {
    throw new RangeError(`startAssembly: hint tokens must be a whole number, got ${hintTokens}`);
  }
  const tiles: Record<string, TriedMark> = {};
  for (const tile of puzzle.tray) tiles[tile.id] = "untried";
  return {
    attempts: 0,
    hintsUsed: 0,
    livesLeft,
    livesMax,
    hintTokens: Math.min(rules.tokenMax, hintTokens),
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
    if (tile === null) continue;
    const mark = puzzle.solution.includes(tile.shows) ? "right" : "wrong";
    // Tiles that show the same are interchangeable: what is learned of one is learned of its copies.
    for (const other of puzzle.tray) if (other.shows === tile.shows) tiles[other.id] = mark;
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
 * tile is marked "right" if the target needs its shape anywhere and "wrong" if not, and so
 * is every other tile showing the same (the demo tints all copies of a part alike);
 * and, for attempts made with the right structure, a tile that is wrong for the slot it
 * sits in is added to that slot's misses (once). Attempts with a wrong structure never
 * add slot misses, because their slots are not the target's.
 *
 * Lives: an attempt that does not solve the puzzle costs `wrongCost` hearts when there
 * are lives, and the round is failed when none is left; a solve gives `solveGain` hearts
 * back, never beyond `livesMax`. Score: see `attemptPoints` and `solvePoints`. Under the
 * hint policy "token", solving at the first attempt without a hint earns a token.
 * `rules` should be the rules the round was started with; lives are read from the state.
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
  const livesLeft =
    state.livesLeft === null
      ? null
      : feedback.solved
        ? Math.min(state.livesMax ?? state.livesLeft, state.livesLeft + rules.solveGain)
        : Math.max(0, state.livesLeft - rules.wrongCost);
  const earned = feedback.solved
    ? solvePoints(rules, puzzle.solution.length, state.attempts + 1, state.hintsUsed)
    : attemptPoints(rules, feedback, state.attempts);
  const firstTry = feedback.solved && state.attempts === 0 && state.hintsUsed === 0;
  const next: AssemblyState = {
    attempts: state.attempts + 1,
    hintsUsed: state.hintsUsed,
    livesLeft,
    livesMax: state.livesMax,
    hintTokens: rules.hint === "token" && firstTry ? Math.min(rules.tokenMax, state.hintTokens + 1) : state.hintTokens,
    memory: remember(state.memory, puzzle, attempt.layout, placed, feedback.structureCorrect),
    solved: feedback.solved,
    failed: !feedback.solved && livesLeft !== null && livesLeft <= 0,
    score: rules.scoring === "demo" ? state.score + earned : earned,
    history: [
      ...state.history,
      { attempt: { layout: attempt.layout, placements: [...attempt.placements] }, feedback },
    ],
  };
  return { state: next, feedback };
}

/**
 * True when the attempt names a structure of the puzzle and every one of its slots holds
 * a tile. Says nothing about whether the tiles are right, and never throws: an unknown
 * structure or a placements array of the wrong length is simply not complete.
 */
export function isComplete(puzzle: AssemblyPuzzle, attempt: AssemblyAttempt): boolean {
  const layout = Number.isInteger(attempt.layout) ? puzzle.layouts[attempt.layout] : undefined;
  return (
    layout !== undefined &&
    attempt.placements.length === layout.slots.length &&
    attempt.placements.every((id) => id !== null)
  );
}

/**
 * Whether the rules judge this attempt by themselves now, without the player asking:
 * under `check: "auto"`, as soon as it is complete (`isComplete`) and the round is still
 * being played. Under "button" never: the host waits for its Check button.
 */
export function judgesItself(state: AssemblyState, puzzle: AssemblyPuzzle, attempt: AssemblyAttempt, rules: AssemblyRules): boolean {
  return rules.check === "auto" && !state.solved && !state.failed && isComplete(puzzle, attempt);
}

/**
 * What stays in the structure after `attempt` was judged and did not solve the puzzle,
 * by `rules.afterCheck`: every tile ("keep"), only tiles showing exactly the component of
 * their slot in the right structure ("keep-correct"; under a wrong structure nothing
 * stays), or nothing ("clear"). The result has one tile id or null per slot of the
 * attempt's structure. A solving attempt is returned whole: nothing goes back once the
 * character is built. Throws a RangeError for the malformed attempts listed under
 * `evaluateAttempt`.
 */
export function placementsAfterCheck(
  puzzle: AssemblyPuzzle,
  attempt: AssemblyAttempt,
  rules: AssemblyRules,
): (string | null)[] {
  const tiles = resolvePlacements(puzzle, attempt.layout, attempt.placements);
  const feedback = judge(puzzle, attempt.layout, tiles);
  if (feedback.solved || rules.afterCheck === "keep") return [...attempt.placements];
  if (rules.afterCheck === "clear" || !feedback.structureCorrect) return attempt.placements.map(() => null);
  return tiles.map((tile, slot) => (tile !== null && tile.shows === puzzle.solution[slot] ? tile.id : null));
}

/**
 * Whether a hint can be taken now: not once the round is over, never under the hint
 * policy "off", and under "token" only with a token in hand.
 */
export function canHint(state: AssemblyState, rules: AssemblyRules = DEFAULT_RULES): boolean {
  if (state.solved || state.failed || rules.hint === "off") return false;
  return rules.hint !== "token" || state.hintTokens > 0;
}

/** What a hint costs, for a host to show and to record. */
export interface HintPrice {
  readonly policy: HintPolicy;
  /** Hearts it takes. */
  readonly lives: number;
  /** Points it takes off what solving is worth. */
  readonly points: number;
  /** Hint tokens it takes. */
  readonly tokens: number;
  /** What it means for the character in its run: it returns later, or it will not count as mastered. */
  readonly consequence: "returns" | "unmastered" | null;
}

/**
 * What the next hint would cost under `rules` (see `HintPolicy`). Under "life" no more
 * hearts than are left, and none when there are no lives; under "points" the drop in
 * what solving is worth now, which is less than `hintCost` near `minScore`.
 */
export function hintPrice(state: AssemblyState, puzzle: AssemblyPuzzle, rules: AssemblyRules = DEFAULT_RULES): HintPrice {
  const worth = (hints: number): number => solvePoints(rules, puzzle.solution.length, state.attempts + 1, hints);
  return {
    policy: rules.hint,
    lives: rules.hint === "life" && state.livesLeft !== null ? Math.min(rules.hintLives, state.livesLeft) : 0,
    points: rules.hint === "points" ? worth(state.hintsUsed) - worth(state.hintsUsed + 1) : 0,
    tokens: rules.hint === "token" ? 1 : 0,
    consequence: rules.hint === "return" ? "returns" : rules.hint === "unmastered" ? "unmastered" : null,
  };
}

/**
 * Record that the player asked for a hint (in Zen Hanzi: a look at the character) and
 * charge what the hint policy asks up front: `hintLives` hearts under "life" (the round
 * is failed when that was the last of them, as in the demo), a token under "token". The
 * other policies only count the hint: "points" lowers what a solve earns (`solvePoints`),
 * "return" and "unmastered" show in `roundOutcome`. No effect when no hint can be taken
 * (`canHint`).
 */
export function useHint(state: AssemblyState, rules: AssemblyRules = DEFAULT_RULES): AssemblyState {
  if (!canHint(state, rules)) return state;
  const livesLeft =
    rules.hint === "life" && state.livesLeft !== null ? Math.max(0, state.livesLeft - rules.hintLives) : state.livesLeft;
  return {
    ...state,
    hintsUsed: state.hintsUsed + 1,
    livesLeft,
    hintTokens: rules.hint === "token" ? state.hintTokens - 1 : state.hintTokens,
    failed: livesLeft !== null && livesLeft <= 0,
  };
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
