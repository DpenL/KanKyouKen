import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import { createRng } from "../util/rng";
import {
  CLASSIC_RULES,
  DEFAULT_RULES,
  DEMO_SCORING,
  ZEN_HANZI_RULES,
  attemptPoints,
  canHint,
  evaluateAttempt,
  heartsFor,
  hintPrice,
  isComplete,
  judgesItself,
  placementsAfterCheck,
  scoreComposition,
  solvePoints,
  startAssembly as startWith,
  submitAttempt as submitWith,
  useHint as hintWith,
  validateRules,
} from "./assembly";
import { parseLayout } from "./layout";
import { buildLookAlikeTable } from "./lookalike";
import { createAssemblyPuzzle } from "./puzzle";
import type { AssemblyAttempt, AssemblyPuzzle, AssemblyRules, AssemblyState, ComponentTile, TileRole } from "./types";

const tile = (id: string, shows: string, role: TileRole = "correct"): ComponentTile => ({
  id,
  shows,
  glyph: fixture(FIXTURES.has(shows) ? shows : "十"),
  role,
});

/** 胡 by hand, with a fixed tray: layouts[1] is right; slots are 十 (top left), 口 (bottom left), 月 (right). */
const HU: AssemblyPuzzle = {
  target: "胡",
  layouts: ["R(S,S,S)", "R(C(S,S),S)", "C(S,S,S)", "R(S,S)"].map(parseLayout),
  correctLayout: 1,
  solution: ["十", "口", "月"],
  parts: [[0, 1], [2, 3, 4], [5, 6, 7, 8]],
  tray: [
    tile("t0", "木", "lookalike"),
    tile("t1", "十"),
    tile("t2", "月"),
    tile("t3", "氵", "filler"),
    tile("t4", "口"),
    tile("t5", "十~extra-stroke", "malformed"),
  ],
  trayRows: 2,
};

/** 林 by hand: the same component twice, plus a spare 木 tile and a look-alike. */
const LIN: AssemblyPuzzle = {
  target: "林",
  layouts: ["C(S,S)", "R(S,S)", "R(S,S,S)"].map(parseLayout),
  correctLayout: 1,
  solution: ["木", "木"],
  parts: [[0, 1, 2, 3], [4, 5, 6, 7]],
  tray: [tile("a", "木"), tile("b", "月", "lookalike"), tile("c", "木"), tile("d", "木", "filler")],
  trayRows: 2,
};

const SOLVE_HU: AssemblyAttempt = { layout: 1, placements: ["t1", "t4", "t2"] };

/*
 * Most tests below were written for Kumiki's classic rules, the library's default until
 * the rules of the Zen Hanzi demo took over (five lives, the score falling by 15 per
 * wrong attempt and 25 per hint). They keep those rules unless they name others.
 */
const startAssembly = (puzzle: AssemblyPuzzle, rules: AssemblyRules = CLASSIC_RULES): AssemblyState => startWith(puzzle, rules);
const submitAttempt = (
  state: AssemblyState,
  puzzle: AssemblyPuzzle,
  attempt: AssemblyAttempt,
  rules: AssemblyRules = CLASSIC_RULES,
): ReturnType<typeof submitWith> => submitWith(state, puzzle, attempt, rules);
/** Under the classic rules a hint only counts (and lowers the score); the default rules charge half a heart for it. */
const useHint = (state: AssemblyState, rules: AssemblyRules = CLASSIC_RULES): AssemblyState => hintWith(state, rules);

function play(puzzle: AssemblyPuzzle, attempts: readonly AssemblyAttempt[], rules?: AssemblyRules): AssemblyState {
  let state = startAssembly(puzzle, rules);
  for (const attempt of attempts) state = submitAttempt(state, puzzle, attempt, rules).state;
  return state;
}

describe("rule sets", () => {
  it("keeps Kumiki's classic numbers", () => {
    expect(CLASSIC_RULES).toEqual({
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
    });
  });

  it("defaults to the rules of the Zen Hanzi demo", () => {
    expect(DEFAULT_RULES).toBe(ZEN_HANZI_RULES);
    expect(ZEN_HANZI_RULES).toMatchObject({
      check: "button",
      afterCheck: "keep-correct",
      lives: 3,
      livesRule: "fixed",
      wrongCost: 0.5,
      solveGain: 1,
      scoring: "demo",
      hint: "life",
      hintLives: 0.5,
    });
    expect(startWith(HU).livesLeft).toBe(3);
  });

  it("refuses rules that cannot be played", () => {
    expect(() => validateRules(CLASSIC_RULES)).not.toThrow();
    expect(() => validateRules({ ...CLASSIC_RULES, check: "soon" as never })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, afterCheck: "shuffle" as never })).toThrow(RangeError);
    expect(() => validateRules(ZEN_HANZI_RULES)).not.toThrow();
    expect(() => validateRules({ ...CLASSIC_RULES, livesRule: "random" as never })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, scoring: "golf" as never })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, hint: "bribe" as never })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, wrongCost: 0.25 })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, solveGain: -1 })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, hintLives: Number.NaN })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, tokenStart: 4 })).toThrow(RangeError);
    expect(() => validateRules({ ...CLASSIC_RULES, tokenMax: 1.5 })).toThrow(RangeError);
    expect(() => startWith(HU, { ...CLASSIC_RULES, check: "never" as never })).toThrow(RangeError);
  });
});

describe("evaluateAttempt", () => {
  it("recognises the solution", () => {
    expect(evaluateAttempt(HU, SOLVE_HU)).toEqual({
      structureCorrect: true,
      correctComponents: 3,
      componentCount: 3,
      slotCount: 3,
      correctPositions: 3,
      anyInCorrectPosition: true,
      solved: true,
    });
  });

  it("counts right components but no positions under a wrong structure", () => {
    expect(evaluateAttempt(HU, { layout: 0, placements: ["t1", "t4", "t2"] })).toEqual({
      structureCorrect: false,
      correctComponents: 3,
      componentCount: 3,
      slotCount: 3,
      correctPositions: 0,
      anyInCorrectPosition: false,
      solved: false,
    });
    expect(evaluateAttempt(HU, { layout: 3, placements: ["t2", "t0"] })).toMatchObject({
      structureCorrect: false,
      correctComponents: 1,
      correctPositions: 0,
    });
  });

  it("counts positions under the right structure", () => {
    // 口 and 十 swapped, 月 in place.
    expect(evaluateAttempt(HU, { layout: 1, placements: ["t4", "t1", "t2"] })).toEqual({
      structureCorrect: true,
      correctComponents: 3,
      componentCount: 3,
      slotCount: 3,
      correctPositions: 1,
      anyInCorrectPosition: true,
      solved: false,
    });
    // Everything rotated: all components right, none in place.
    expect(evaluateAttempt(HU, { layout: 1, placements: ["t2", "t1", "t4"] })).toMatchObject({
      correctComponents: 3,
      correctPositions: 0,
      anyInCorrectPosition: false,
      solved: false,
    });
  });

  it("does not count look-alikes, malformed shapes or empty slots", () => {
    expect(evaluateAttempt(HU, { layout: 1, placements: ["t5", "t4", "t0"] })).toMatchObject({
      structureCorrect: true,
      correctComponents: 1,
      correctPositions: 1,
      solved: false,
    });
    expect(evaluateAttempt(HU, { layout: 1, placements: [null, null, null] })).toEqual({
      structureCorrect: true,
      correctComponents: 0,
      componentCount: 3,
      slotCount: 3,
      correctPositions: 0,
      anyInCorrectPosition: false,
      solved: false,
    });
    expect(evaluateAttempt(HU, { layout: 1, placements: ["t1", "t4", null] })).toMatchObject({
      correctComponents: 2,
      correctPositions: 2,
      solved: false,
    });
  });

  it("counts a component as often as the target has it, and treats equal tiles as interchangeable", () => {
    // Three 木 tiles on a three-slot structure: the target has only two.
    expect(evaluateAttempt(LIN, { layout: 2, placements: ["a", "c", "d"] })).toMatchObject({
      structureCorrect: false,
      correctComponents: 2,
      componentCount: 2,
      slotCount: 3,
    });
    expect(evaluateAttempt(LIN, { layout: 1, placements: ["a", "b"] })).toMatchObject({
      correctComponents: 1,
      correctPositions: 1,
      solved: false,
    });
    // Any two of the three 木 tiles solve it, the filler included.
    expect(evaluateAttempt(LIN, { layout: 1, placements: ["d", "a"] }).solved).toBe(true);
    expect(evaluateAttempt(LIN, { layout: 1, placements: ["c", "d"] }).solved).toBe(true);
  });

  it("goes by structure, not by index, when a puzzle lists the right structure twice", () => {
    const doubled: AssemblyPuzzle = { ...HU, layouts: [...HU.layouts, parseLayout("R(C(S,S),S)")] };
    expect(evaluateAttempt(doubled, { layout: 4, placements: ["t1", "t4", "t2"] }).solved).toBe(true);
  });

  it("rejects malformed attempts", () => {
    expect(() => evaluateAttempt(HU, { layout: 4, placements: [] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: -1, placements: ["t1", "t4", "t2"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 1.5, placements: ["t1", "t4", "t2"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 1, placements: ["t1", "t4"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 3, placements: ["t1", "t4", "t2"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 1, placements: ["t1", "t4", "t9"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 1, placements: ["t1", "t1", "t2"] })).toThrow(RangeError);
    expect(() => evaluateAttempt(HU, { layout: 1, placements: ["t1", "十", "t2"] })).toThrow(RangeError);
  });
});

describe("startAssembly", () => {
  it("starts with nothing tried", () => {
    expect(startAssembly(HU)).toEqual({
      attempts: 0,
      hintsUsed: 0,
      livesLeft: 5,
      livesMax: 5,
      hintTokens: 1,
      memory: {
        layouts: ["untried", "untried", "untried", "untried"],
        tiles: { t0: "untried", t1: "untried", t2: "untried", t3: "untried", t4: "untried", t5: "untried" },
        slotMisses: [[], [], []],
        structureFound: false,
      },
      solved: false,
      failed: false,
      score: 0,
      history: [],
    });
  });

  it("takes lives from the rules, unlimited included", () => {
    expect(startAssembly(HU, { ...CLASSIC_RULES, lives: 2 }).livesLeft).toBe(2);
    expect(startAssembly(HU, { ...CLASSIC_RULES, lives: null }).livesLeft).toBeNull();
  });

  // Until hearts could be lost in halves (the Zen Hanzi demo), 2.5 lives were refused too.
  it("rejects lives that are not at least one heart in whole or half hearts", () => {
    expect(() => startAssembly(HU, { ...CLASSIC_RULES, lives: 0 })).toThrow(RangeError);
    expect(() => startAssembly(HU, { ...CLASSIC_RULES, lives: -1 })).toThrow(RangeError);
    expect(() => startAssembly(HU, { ...CLASSIC_RULES, lives: 0.5 })).toThrow(RangeError);
    expect(() => startAssembly(HU, { ...CLASSIC_RULES, lives: 2.25 })).toThrow(RangeError);
    expect(startAssembly(HU, { ...CLASSIC_RULES, lives: 2.5 }).livesLeft).toBe(2.5);
  });

  it("takes over what a run hands on: hearts left, the most it can hold, hint tokens", () => {
    expect(startWith(HU, ZEN_HANZI_RULES, { livesLeft: 1.5 })).toMatchObject({ livesLeft: 1.5, livesMax: 3, hintTokens: 1 });
    expect(startWith(HU, ZEN_HANZI_RULES, { livesLeft: 4, livesMax: 4, hintTokens: 2 })).toMatchObject({ livesLeft: 4, livesMax: 4, hintTokens: 2 });
    // More than the round can hold is cut down; so are tokens beyond the most.
    expect(startWith(HU, ZEN_HANZI_RULES, { livesLeft: 5, hintTokens: 9 })).toMatchObject({ livesLeft: 3, hintTokens: 3 });
    // Without lives there is nothing to hand on.
    expect(startWith(HU, { ...ZEN_HANZI_RULES, lives: null }, { livesLeft: 2, livesMax: 3 })).toMatchObject({ livesLeft: null, livesMax: null });
    expect(() => startWith(HU, ZEN_HANZI_RULES, { livesLeft: 0 })).toThrow(RangeError);
    expect(() => startWith(HU, ZEN_HANZI_RULES, { livesLeft: 1.2 })).toThrow(RangeError);
    expect(() => startWith(HU, ZEN_HANZI_RULES, { livesMax: 0 })).toThrow(RangeError);
    expect(() => startWith(HU, ZEN_HANZI_RULES, { hintTokens: -1 })).toThrow(RangeError);
    expect(() => startWith(HU, ZEN_HANZI_RULES, { hintTokens: 0.5 })).toThrow(RangeError);
  });
});

describe("submitAttempt", () => {
  it("scores a first-try solution in full", () => {
    const start = startAssembly(HU);
    const { state, feedback } = submitAttempt(start, HU, SOLVE_HU);
    expect(feedback.solved).toBe(true);
    expect(state).toMatchObject({ attempts: 1, livesLeft: 5, solved: true, failed: false, score: 100 });
    expect(state.memory.layouts).toEqual(["untried", "right", "untried", "untried"]);
    expect(state.memory.tiles).toMatchObject({ t1: "right", t4: "right", t2: "right", t0: "untried" });
    expect(state.memory.slotMisses).toEqual([[], [], []]);
    expect(state.memory.structureFound).toBe(true);
    expect(state.history).toEqual([{ attempt: SOLVE_HU, feedback }]);
    // The previous state is untouched.
    expect(start).toEqual(startAssembly(HU));
  });

  it("remembers what was tried, stage by stage (a whole round)", () => {
    let state = startAssembly(HU);

    // 1. Wrong structure, a look-alike, a right component and a filler.
    let turn = submitAttempt(state, HU, { layout: 0, placements: ["t0", "t1", "t3"] });
    state = turn.state;
    expect(turn.feedback).toMatchObject({ structureCorrect: false, correctComponents: 1, correctPositions: 0 });
    expect(state.memory.layouts).toEqual(["wrong", "untried", "untried", "untried"]);
    expect(state.memory.tiles).toMatchObject({ t0: "wrong", t1: "right", t3: "wrong", t2: "untried", t4: "untried" });
    expect(state.memory.structureFound).toBe(false);
    expect(state.memory.slotMisses).toEqual([[], [], []]);
    expect(state).toMatchObject({ attempts: 1, livesLeft: 4, solved: false, failed: false, score: 0 });

    // 2. Right structure; 月 top left, 十 bottom left, malformed 十 on the right.
    turn = submitAttempt(state, HU, { layout: 1, placements: ["t2", "t1", "t5"] });
    state = turn.state;
    expect(turn.feedback).toMatchObject({ structureCorrect: true, correctComponents: 2, correctPositions: 0 });
    expect(state.memory.layouts).toEqual(["wrong", "right", "untried", "untried"]);
    expect(state.memory.structureFound).toBe(true);
    expect(state.memory.slotMisses).toEqual([["t2"], ["t1"], ["t5"]]);
    expect(state.memory.tiles).toMatchObject({ t2: "right", t1: "right", t5: "wrong" });
    expect(state.livesLeft).toBe(3);

    // 3. Same mistake on the right, 十 now in place, slot two left empty.
    turn = submitAttempt(state, HU, { layout: 1, placements: ["t1", null, "t5"] });
    state = turn.state;
    expect(turn.feedback).toMatchObject({ correctComponents: 1, correctPositions: 1, anyInCorrectPosition: true });
    expect(state.memory.slotMisses).toEqual([["t2"], ["t1"], ["t5"]]);

    // 4. Back to a wrong structure: slots do not correspond, nothing is added to the misses.
    turn = submitAttempt(state, HU, { layout: 2, placements: ["t4", "t2", "t1"] });
    state = turn.state;
    expect(state.memory.layouts).toEqual(["wrong", "right", "wrong", "untried"]);
    expect(state.memory.slotMisses).toEqual([["t2"], ["t1"], ["t5"]]);
    expect(state.memory.structureFound).toBe(true);
    expect(state.memory.tiles.t4).toBe("right");
    expect(state.livesLeft).toBe(1);

    // 5. Solved on the last life: 100 - 4 * 15.
    turn = submitAttempt(state, HU, SOLVE_HU);
    state = turn.state;
    expect(turn.feedback.solved).toBe(true);
    expect(state).toMatchObject({ attempts: 5, livesLeft: 1, solved: true, failed: false, score: 40 });
    expect(state.history).toHaveLength(5);
    expect(state.history.map((h) => h.feedback.solved)).toEqual([false, false, false, false, true]);
  });

  it("adds several misses to one slot, each tile once", () => {
    const state = play(HU, [
      { layout: 1, placements: ["t0", null, null] },
      { layout: 1, placements: ["t3", null, null] },
      { layout: 1, placements: ["t0", null, "t3"] },
    ]);
    expect(state.memory.slotMisses).toEqual([["t0", "t3"], [], ["t3"]]);
  });

  it("takes a life per wrong attempt and fails the round when they run out", () => {
    const rules = { ...CLASSIC_RULES, lives: 2 };
    const wrong: AssemblyAttempt = { layout: 0, placements: [null, null, null] };
    let turn = submitAttempt(startAssembly(HU, rules), HU, wrong, rules);
    expect(turn.state).toMatchObject({ livesLeft: 1, failed: false });
    turn = submitAttempt(turn.state, HU, wrong, rules);
    expect(turn.state).toMatchObject({ attempts: 2, livesLeft: 0, failed: true, solved: false, score: 0 });
  });

  it("changes nothing once the round is over, and repeats the final feedback", () => {
    const rules = { ...CLASSIC_RULES, lives: 1 };
    const failed = submitAttempt(startAssembly(HU, rules), HU, { layout: 1, placements: ["t4", "t1", "t2"] }, rules);
    expect(failed.state.failed).toBe(true);
    const after = submitAttempt(failed.state, HU, SOLVE_HU, rules);
    expect(after.state).toBe(failed.state);
    expect(after.feedback).toEqual(failed.feedback);
    expect(after.feedback.solved).toBe(false);

    const solved = submitAttempt(startAssembly(HU), HU, SOLVE_HU);
    const again = submitAttempt(solved.state, HU, { layout: 0, placements: ["t0", "t3", "t5"] });
    expect(again.state).toBe(solved.state);
    expect(again.feedback).toEqual(solved.feedback);
    // Even a malformed attempt is ignored after the end.
    expect(submitAttempt(solved.state, HU, { layout: 99, placements: [] }).state).toBe(solved.state);
  });

  it("never fails a round with unlimited lives", () => {
    const rules = { ...CLASSIC_RULES, lives: null };
    const wrong: AssemblyAttempt = { layout: 2, placements: ["t0", "t3", "t5"] };
    const state = play(HU, Array.from({ length: 12 }, () => wrong), rules);
    expect(state).toMatchObject({ attempts: 12, livesLeft: null, failed: false, solved: false });
    // 100 - 12 * 15 is below the floor.
    expect(submitAttempt(state, HU, SOLVE_HU, rules).state).toMatchObject({ solved: true, score: 10 });
  });

  it("charges for wrong attempts and hints, down to the minimum", () => {
    const wrong: AssemblyAttempt = { layout: 0, placements: [null, null, null] };
    expect(play(HU, [wrong, wrong, SOLVE_HU]).score).toBe(70);

    let state = useHint(startAssembly(HU));
    expect(submitAttempt(state, HU, SOLVE_HU).state.score).toBe(75);
    state = useHint(submitAttempt(state, HU, wrong).state);
    expect(submitAttempt(state, HU, SOLVE_HU).state.score).toBe(35);
    state = useHint(useHint(state));
    expect(submitAttempt(state, HU, SOLVE_HU).state.score).toBe(10);

    const rules: AssemblyRules = { ...CLASSIC_RULES, lives: null, baseScore: 50, attemptCost: 20, hintCost: 5, minScore: 0 };
    expect(play(HU, [wrong, SOLVE_HU], rules).score).toBe(30);
    expect(play(HU, [wrong, wrong, wrong, SOLVE_HU], rules).score).toBe(0);
  });

  it("rejects malformed attempts without advancing the round", () => {
    const state = startAssembly(HU);
    expect(() => submitAttempt(state, HU, { layout: 7, placements: ["t1", "t4", "t2"] })).toThrow(RangeError);
    expect(() => submitAttempt(state, HU, { layout: 1, placements: ["t1", "t4", "t2", "t0"] })).toThrow(RangeError);
    expect(() => submitAttempt(state, HU, { layout: 1, placements: ["t1", "nope", "t2"] })).toThrow(RangeError);
    expect(() => submitAttempt(state, HU, { layout: 1, placements: ["t1", "t2", "t2"] })).toThrow(RangeError);
    expect(state).toEqual(startAssembly(HU));
  });

  it("keeps its own copy of the attempt in the history", () => {
    const placements: (string | null)[] = ["t0", "t1", "t3"];
    const { state } = submitAttempt(startAssembly(HU), HU, { layout: 0, placements });
    placements[0] = "t5";
    expect(state.history[0]!.attempt.placements).toEqual(["t0", "t1", "t3"]);
  });

  it("marks a spare tile of a needed shape as right, and with it every tile showing the same", () => {
    // The Zen Hanzi demo tints all copies of a part alike; before that only the tile that was placed was marked.
    const { state } = submitAttempt(startAssembly(LIN), LIN, { layout: 0, placements: ["d", "b"] });
    expect(state.memory.tiles).toEqual({ a: "right", b: "wrong", c: "right", d: "right" });
  });

  it("marks every tile showing what a wrong tile shows", () => {
    const twins: AssemblyPuzzle = { ...LIN, tray: [...LIN.tray, tile("e", "月", "filler")] };
    const { state } = submitAttempt(startAssembly(twins), twins, { layout: 0, placements: ["a", "b"] });
    expect(state.memory.tiles).toEqual({ a: "right", b: "wrong", c: "right", d: "right", e: "wrong" });
  });

  it("plays a generated puzzle from first guess to solution", () => {
    const components = ["十", "口", "木", "月", "氵"];
    const puzzle = createAssemblyPuzzle(
      fixture("胡"),
      { glyphs: FIXTURES, lookAlikes: buildLookAlikeTable(components, FIXTURES), fillers: components },
      { traySize: 9 },
      createRng("round"),
    );
    const idOf = (shows: string): string => puzzle.tray.find((t) => t.shows === shows)!.id;
    const wrongLayout = puzzle.correctLayout === 0 ? 1 : 0;
    const distractor = puzzle.tray.find((t) => t.imitates === "月")!;

    let state = startAssembly(puzzle);
    let turn = submitAttempt(state, puzzle, {
      layout: wrongLayout,
      placements: puzzle.layouts[wrongLayout]!.slots.map((_, i) => (i === 0 ? idOf("十") : null)),
    });
    expect(turn.feedback).toMatchObject({ structureCorrect: false, correctComponents: 1, solved: false });
    state = turn.state;

    turn = submitAttempt(state, puzzle, {
      layout: puzzle.correctLayout,
      placements: [idOf("十"), idOf("口"), distractor.id],
    });
    expect(turn.feedback).toMatchObject({ structureCorrect: true, correctComponents: 2, correctPositions: 2, solved: false });
    state = turn.state;
    expect(state.memory.slotMisses).toEqual([[], [], [distractor.id]]);
    expect(state.memory.tiles[distractor.id]).toBe("wrong");

    turn = submitAttempt(state, puzzle, {
      layout: puzzle.correctLayout,
      placements: [idOf("十"), idOf("口"), idOf("月")],
    });
    expect(turn.feedback.solved).toBe(true);
    expect(turn.state).toMatchObject({ attempts: 3, livesLeft: 3, solved: true, score: 70 });
  });
});

describe("useHint", () => {
  it("counts hints while the round is open", () => {
    const state = startAssembly(HU);
    const hinted = useHint(useHint(state));
    expect(hinted.hintsUsed).toBe(2);
    expect(state.hintsUsed).toBe(0);
    expect({ ...hinted, hintsUsed: 0 }).toEqual(state);
  });

  it("does nothing once the round is solved or failed", () => {
    const solved = submitAttempt(startAssembly(HU), HU, SOLVE_HU).state;
    expect(useHint(solved)).toBe(solved);
    const rules = { ...CLASSIC_RULES, lives: 1 };
    const failed = submitAttempt(startAssembly(HU, rules), HU, { layout: 0, placements: [null, null, null] }, rules).state;
    expect(useHint(failed)).toBe(failed);
  });
});

describe("scoreComposition", () => {
  it("counts the slots of the right structure that hold the right shape", () => {
    expect(scoreComposition(HU, ["t1", "t4", "t2"])).toBe(3);
    expect(scoreComposition(HU, ["t4", "t1", "t2"])).toBe(1);
    expect(scoreComposition(HU, ["t5", "t4", "t0"])).toBe(1);
    expect(scoreComposition(HU, ["t2", "t1", "t4"])).toBe(0);
    expect(scoreComposition(HU, [null, null, "t2"])).toBe(1);
    expect(scoreComposition(HU, [null, null, null])).toBe(0);
    expect(scoreComposition(LIN, ["d", "c"])).toBe(2);
    expect(scoreComposition(LIN, ["b", "c"])).toBe(1);
  });

  it("rejects compositions that do not fit the right structure or the tray", () => {
    expect(() => scoreComposition(HU, ["t1", "t4"])).toThrow(RangeError);
    expect(() => scoreComposition(HU, [])).toThrow(RangeError);
    expect(() => scoreComposition(HU, ["t1", "t4", "x"])).toThrow(RangeError);
    expect(() => scoreComposition(HU, ["t1", "t1", "t2"])).toThrow(RangeError);
  });
});

describe("check triggers", () => {
  const auto: AssemblyRules = { ...CLASSIC_RULES, check: "auto" };

  it("knows when every slot of the chosen structure is filled", () => {
    expect(isComplete(HU, SOLVE_HU)).toBe(true);
    expect(isComplete(HU, { layout: 1, placements: ["t1", null, "t2"] })).toBe(false);
    expect(isComplete(HU, { layout: 3, placements: ["t1", "t2"] })).toBe(true);
    // Malformed attempts are not complete, and do not throw.
    expect(isComplete(HU, { layout: 1, placements: ["t1", "t4"] })).toBe(false);
    expect(isComplete(HU, { layout: 9, placements: ["t1", "t4", "t2"] })).toBe(false);
    expect(isComplete(HU, { layout: 0.5, placements: ["t1", "t4", "t2"] })).toBe(false);
  });

  it("judges a full structure by itself only under the automatic trigger", () => {
    const state = startAssembly(HU, auto);
    expect(judgesItself(state, HU, SOLVE_HU, auto)).toBe(true);
    expect(judgesItself(state, HU, { layout: 1, placements: ["t1", null, "t2"] }, auto)).toBe(false);
    expect(judgesItself(state, HU, SOLVE_HU, CLASSIC_RULES)).toBe(false);
    const solved = submitAttempt(state, HU, SOLVE_HU, auto).state;
    expect(judgesItself(solved, HU, SOLVE_HU, auto)).toBe(false);
  });
});

describe("placementsAfterCheck", () => {
  // 口 and 十 swapped, 月 in place.
  const swapped: AssemblyAttempt = { layout: 1, placements: ["t4", "t1", "t2"] };

  it("keeps the whole board under the classic rules", () => {
    expect(placementsAfterCheck(HU, swapped, CLASSIC_RULES)).toEqual(["t4", "t1", "t2"]);
  });

  it("keeps only tiles in their right slot, as the demo does", () => {
    const rules = { ...CLASSIC_RULES, afterCheck: "keep-correct" as const };
    expect(placementsAfterCheck(HU, swapped, rules)).toEqual([null, null, "t2"]);
    // A malformed 十 and an empty slot go; the right 口 stays.
    expect(placementsAfterCheck(HU, { layout: 1, placements: ["t5", "t4", null] }, rules)).toEqual([null, "t4", null]);
    // Under a wrong structure no slot is right, so everything goes back.
    expect(placementsAfterCheck(HU, { layout: 0, placements: ["t1", "t4", "t2"] }, rules)).toEqual([null, null, null]);
    // A spare tile of the right shape counts like the one it equals.
    expect(placementsAfterCheck(LIN, { layout: 1, placements: ["d", "b"] }, rules)).toEqual(["d", null]);
  });

  it("clears everything on request, and leaves a solved board alone", () => {
    const rules = { ...CLASSIC_RULES, afterCheck: "clear" as const };
    expect(placementsAfterCheck(HU, swapped, rules)).toEqual([null, null, null]);
    expect(placementsAfterCheck(HU, SOLVE_HU, rules)).toEqual(["t1", "t4", "t2"]);
    expect(placementsAfterCheck(HU, SOLVE_HU, { ...rules, afterCheck: "keep-correct" })).toEqual(["t1", "t4", "t2"]);
  });

  it("refuses attempts that do not fit the puzzle", () => {
    expect(() => placementsAfterCheck(HU, { layout: 1, placements: ["t1"] }, CLASSIC_RULES)).toThrow(RangeError);
  });
});

describe("feedback", () => {
  it("names the slots of the structure that was tried", () => {
    expect(evaluateAttempt(HU, { layout: 3, placements: ["t2", "t0"] })).toMatchObject({ componentCount: 3, slotCount: 2 });
    expect(evaluateAttempt(HU, SOLVE_HU).slotCount).toBe(3);
  });
});

describe("lives", () => {
  const wrong: AssemblyAttempt = { layout: 0, placements: [null, null, null] };

  it("are lost in halves and given back by a solve, as in the demo", () => {
    let state = startWith(HU, ZEN_HANZI_RULES);
    state = submitWith(state, HU, wrong, ZEN_HANZI_RULES).state;
    expect(state).toMatchObject({ livesLeft: 2.5, livesMax: 3, failed: false });
    state = submitWith(state, HU, wrong, ZEN_HANZI_RULES).state;
    state = submitWith(state, HU, wrong, ZEN_HANZI_RULES).state;
    expect(state.livesLeft).toBe(1.5);
    // 1.5 -> 2.5: one heart back.
    expect(submitWith(state, HU, SOLVE_HU, ZEN_HANZI_RULES).state).toMatchObject({ livesLeft: 2.5, solved: true });
    // Never beyond the most the round can hold: 2.5 -> 3.
    const once = submitWith(startWith(HU, ZEN_HANZI_RULES), HU, wrong, ZEN_HANZI_RULES).state;
    expect(submitWith(once, HU, SOLVE_HU, ZEN_HANZI_RULES).state.livesLeft).toBe(3);
    expect(submitWith(startWith(HU, ZEN_HANZI_RULES), HU, SOLVE_HU, ZEN_HANZI_RULES).state.livesLeft).toBe(3);
  });

  it("run out after six wrong attempts at half a heart each, the same answer included", () => {
    let state = startWith(HU, ZEN_HANZI_RULES);
    for (let attempt = 1; attempt <= 5; attempt++) state = submitWith(state, HU, wrong, ZEN_HANZI_RULES).state;
    expect(state).toMatchObject({ livesLeft: 0.5, failed: false });
    state = submitWith(state, HU, wrong, ZEN_HANZI_RULES).state;
    expect(state).toMatchObject({ attempts: 6, livesLeft: 0, failed: true, solved: false });
  });

  it("can cost a whole heart, or nothing", () => {
    const whole = { ...ZEN_HANZI_RULES, wrongCost: 1 };
    expect(play(HU, [wrong, wrong, wrong], whole)).toMatchObject({ livesLeft: 0, failed: true });
    const free = { ...ZEN_HANZI_RULES, wrongCost: 0 };
    expect(play(HU, Array.from({ length: 9 }, () => wrong), free)).toMatchObject({ attempts: 9, livesLeft: 3, failed: false });
    // An odd half heart is lost whole by the attempt that would go past zero.
    expect(play(HU, [wrong, wrong, wrong], { ...whole, lives: 2.5 })).toMatchObject({ livesLeft: 0, failed: true });
  });

  it("give back nothing, half a heart or one on a solve", () => {
    const after = (solveGain: number): number | null => play(HU, [wrong, wrong, wrong, SOLVE_HU], { ...ZEN_HANZI_RULES, solveGain }).livesLeft;
    expect(after(0)).toBe(1.5);
    expect(after(0.5)).toBe(2);
    expect(after(1)).toBe(2.5);
  });

  it("are not counted at all without lives", () => {
    const none = { ...ZEN_HANZI_RULES, lives: null };
    const state = play(HU, Array.from({ length: 8 }, () => wrong), none);
    expect(state).toMatchObject({ attempts: 8, livesLeft: null, livesMax: null, failed: false });
    expect(submitWith(state, HU, SOLVE_HU, none).state).toMatchObject({ solved: true, livesLeft: null });
  });

  it("can be scaled to the number of parts", () => {
    const parts = { ...ZEN_HANZI_RULES, livesRule: "parts" as const };
    expect([2, 3, 4].map((count) => heartsFor(parts, count))).toEqual([2, 3, 4]);
    expect([1, 2, 3, 4].map((count) => heartsFor({ ...parts, lives: 5 }, count))).toEqual([1.5, 3.5, 5, 6.5]);
    expect(heartsFor({ ...parts, lives: 1 }, 1)).toBe(1);
    expect(heartsFor(ZEN_HANZI_RULES, 4)).toBe(3);
    expect(heartsFor({ ...parts, lives: null }, 4)).toBeNull();
    // 胡 has three parts, 林 two.
    expect(startWith(HU, parts)).toMatchObject({ livesLeft: 3, livesMax: 3 });
    expect(startWith(LIN, parts)).toMatchObject({ livesLeft: 2, livesMax: 2 });
  });
});

describe("scoring as in the demo", () => {
  const wrongFrame: AssemblyAttempt = { layout: 0, placements: ["t1", "t4", "t2"] };
  const swapped: AssemblyAttempt = { layout: 1, placements: ["t4", "t1", "t2"] };
  const strangers: AssemblyAttempt = { layout: 1, placements: ["t0", "t3", "t5"] };

  it("gives the values seen for a solve at each attempt", () => {
    const solve = (parts: number, attempt: number): number => solvePoints(ZEN_HANZI_RULES, parts, attempt, 0);
    expect([2, 3, 4].map((parts) => solve(parts, 1))).toEqual([800, 900, 1000]);
    expect([2, 3].map((parts) => solve(parts, 2))).toEqual([460, 540]);
    expect(solve(3, 3)).toBe(280);
    expect(solve(3, 4)).toBe(220);
    // A part is never worth less than nothing: from the sixth attempt on only the 100 are left.
    expect(solve(3, 6)).toBe(100);
    expect(solve(4, 9)).toBe(100);
    // The run of ten the demo plays is worth 8900 at most: two of two parts, seven of three, one of four.
    expect(2 * solve(2, 1) + 7 * solve(3, 1) + solve(4, 1)).toBe(8900);
    expect(DEMO_SCORING).toMatchObject({ structure: 100, belongs: 10, inPlace: 10, firstTry: 500, secondTry: 200 });
  });

  it("pays a wrong attempt for the right structure, parts that belong and parts in place", () => {
    const points = (attempt: AssemblyAttempt): number => attemptPoints(ZEN_HANZI_RULES, evaluateAttempt(HU, attempt));
    // Wrong structure, three parts that belong: 30.
    expect(points(wrongFrame)).toBe(30);
    // Right structure, three belong, one in place: 100 + 30 + 10.
    expect(points(swapped)).toBe(140);
    expect(points(strangers)).toBe(100);
    expect(points({ layout: 3, placements: ["t0", "t3"] })).toBe(0);
    expect(points({ layout: 3, placements: ["t1", "t3"] })).toBe(10);
    // A solve is paid by solvePoints, and the classic scoring pays nothing for a wrong attempt.
    expect(points(SOLVE_HU)).toBe(0);
    expect(attemptPoints(CLASSIC_RULES, evaluateAttempt(HU, swapped))).toBe(0);
  });

  it("adds up over a round, solved or lost", () => {
    let state = submitWith(startWith(HU, ZEN_HANZI_RULES), HU, wrongFrame, ZEN_HANZI_RULES).state;
    expect(state).toMatchObject({ score: 30, solved: false });
    state = submitWith(state, HU, swapped, ZEN_HANZI_RULES).state;
    expect(state.score).toBe(170);
    // Third attempt, three parts: 280.
    expect(submitWith(state, HU, SOLVE_HU, ZEN_HANZI_RULES).state).toMatchObject({ score: 450, solved: true });
    const lost = play(HU, Array.from({ length: 6 }, () => swapped), ZEN_HANZI_RULES);
    expect(lost).toMatchObject({ failed: true, score: 6 * 140 });
  });

  it("takes nothing off for hints, unless hints cost points", () => {
    const hinted = hintWith(hintWith(startWith(HU, ZEN_HANZI_RULES), ZEN_HANZI_RULES), ZEN_HANZI_RULES);
    expect(submitWith(hinted, HU, SOLVE_HU, ZEN_HANZI_RULES).state.score).toBe(900);
    const points = { ...ZEN_HANZI_RULES, hint: "points" as const };
    expect(submitWith(hintWith(hintWith(startWith(HU, points), points), points), HU, SOLVE_HU, points).state.score).toBe(850);
    expect(solvePoints({ ...points, hintCost: 400 }, 2, 3, 2)).toBe(10);
  });

  it("leaves the classic scoring as it was", () => {
    expect(solvePoints(CLASSIC_RULES, 3, 1, 0)).toBe(100);
    expect(solvePoints(CLASSIC_RULES, 3, 3, 1)).toBe(45);
    expect(solvePoints(CLASSIC_RULES, 3, 9, 0)).toBe(10);
    // Hints only cost points under the policy that says so.
    expect(solvePoints({ ...CLASSIC_RULES, hint: "free" }, 3, 1, 3)).toBe(100);
  });
});

describe("hint policies", () => {
  const withHint = (hint: AssemblyRules["hint"], base: AssemblyRules = ZEN_HANZI_RULES): AssemblyRules => ({ ...base, hint });
  const wrong: AssemblyAttempt = { layout: 0, placements: [null, null, null] };

  it("life: half a heart per look, as often as hearts allow, the last one losing the round", () => {
    const rules = withHint("life");
    let state = startWith(HU, rules);
    expect(hintPrice(state, HU, rules)).toEqual({ policy: "life", lives: 0.5, points: 0, tokens: 0, consequence: null });
    state = hintWith(hintWith(state, rules), rules);
    expect(state).toMatchObject({ hintsUsed: 2, livesLeft: 2, failed: false, score: 0 });
    for (let look = 0; look < 3; look++) state = hintWith(state, rules);
    expect(state).toMatchObject({ hintsUsed: 5, livesLeft: 0.5, failed: false });
    expect(canHint(state, rules)).toBe(true);
    state = hintWith(state, rules);
    expect(state).toMatchObject({ hintsUsed: 6, livesLeft: 0, failed: true, solved: false });
    expect(canHint(state, rules)).toBe(false);
    expect(hintWith(state, rules)).toBe(state);
  });

  it("life: free when there are no lives", () => {
    const rules = { ...withHint("life"), lives: null };
    const state = hintWith(startWith(HU, rules), rules);
    expect(state).toMatchObject({ hintsUsed: 1, livesLeft: null, failed: false });
    expect(hintPrice(state, HU, rules).lives).toBe(0);
  });

  it("points: lowers what the solve earns, and no lives", () => {
    const rules = withHint("points", CLASSIC_RULES);
    const start = startWith(HU, rules);
    expect(hintPrice(start, HU, rules)).toEqual({ policy: "points", lives: 0, points: 25, tokens: 0, consequence: null });
    const state = hintWith(start, rules);
    expect(state).toMatchObject({ hintsUsed: 1, livesLeft: 5, hintTokens: 1 });
    expect(submitWith(state, HU, SOLVE_HU, rules).state.score).toBe(75);
    // Near the floor a hint takes off less than its price, then nothing.
    const low = hintWith(hintWith(hintWith(state, rules), rules), rules);
    expect(hintPrice(low, HU, rules).points).toBe(0);
    expect(hintPrice(hintWith(hintWith(state, rules), rules), HU, rules).points).toBe(15);
  });

  it("token: one is spent to look, and earned back only by a first-try solve without a hint", () => {
    const rules = withHint("token");
    let state = startWith(HU, rules);
    expect(state.hintTokens).toBe(1);
    expect(hintPrice(state, HU, rules)).toMatchObject({ policy: "token", tokens: 1, lives: 0, points: 0 });
    state = hintWith(state, rules);
    expect(state).toMatchObject({ hintsUsed: 1, hintTokens: 0, livesLeft: 3 });
    expect(canHint(state, rules)).toBe(false);
    expect(hintWith(state, rules)).toBe(state);
    // Solved at the first attempt, but with a hint: no token.
    expect(submitWith(state, HU, SOLVE_HU, rules).state.hintTokens).toBe(0);
    // First try, no hint: one more, up to the most.
    expect(submitWith(startWith(HU, rules), HU, SOLVE_HU, rules).state.hintTokens).toBe(2);
    expect(submitWith(startWith(HU, rules, { hintTokens: 3 }), HU, SOLVE_HU, rules).state.hintTokens).toBe(3);
    // Second try: none.
    const second = submitWith(startWith(HU, rules), HU, wrong, rules).state;
    expect(submitWith(second, HU, SOLVE_HU, rules).state.hintTokens).toBe(1);
    // Under other policies tokens are neither earned nor spent.
    expect(submitWith(startWith(HU, ZEN_HANZI_RULES), HU, SOLVE_HU, ZEN_HANZI_RULES).state.hintTokens).toBe(1);
    expect(startWith(HU, { ...rules, tokenStart: 0 }).hintTokens).toBe(0);
  });

  it("return, unmastered and free: the hint is only counted here", () => {
    for (const policy of ["return", "unmastered", "free"] as const) {
      const rules = withHint(policy);
      const start = startWith(HU, rules);
      const state = hintWith(start, rules);
      expect({ ...state, hintsUsed: 0 }, policy).toEqual(start);
      expect(state.hintsUsed).toBe(1);
      expect(submitWith(state, HU, SOLVE_HU, rules).state.score, policy).toBe(900);
    }
    expect(hintPrice(startWith(HU), HU, withHint("return")).consequence).toBe("returns");
    expect(hintPrice(startWith(HU), HU, withHint("unmastered")).consequence).toBe("unmastered");
    expect(hintPrice(startWith(HU), HU, withHint("free"))).toEqual({ policy: "free", lives: 0, points: 0, tokens: 0, consequence: null });
  });

  it("off: there is no hint to take", () => {
    const rules = withHint("off");
    const state = startWith(HU, rules);
    expect(canHint(state, rules)).toBe(false);
    expect(hintWith(state, rules)).toBe(state);
  });
});
