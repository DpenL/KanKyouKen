import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import { createRng } from "../util/rng";
import {
  DEFAULT_RULES,
  evaluateAttempt,
  scoreComposition,
  startAssembly,
  submitAttempt,
  useHint,
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
  tray: [tile("a", "木"), tile("b", "月", "lookalike"), tile("c", "木"), tile("d", "木", "filler")],
  trayRows: 2,
};

const SOLVE_HU: AssemblyAttempt = { layout: 1, placements: ["t1", "t4", "t2"] };

function play(puzzle: AssemblyPuzzle, attempts: readonly AssemblyAttempt[], rules?: AssemblyRules): AssemblyState {
  let state = startAssembly(puzzle, rules);
  for (const attempt of attempts) state = submitAttempt(state, puzzle, attempt, rules).state;
  return state;
}

describe("DEFAULT_RULES", () => {
  it("has the documented numbers", () => {
    expect(DEFAULT_RULES).toEqual({ lives: 5, baseScore: 100, attemptCost: 15, hintCost: 25, minScore: 10 });
  });
});

describe("evaluateAttempt", () => {
  it("recognises the solution", () => {
    expect(evaluateAttempt(HU, SOLVE_HU)).toEqual({
      structureCorrect: true,
      correctComponents: 3,
      componentCount: 3,
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
    expect(startAssembly(HU, { ...DEFAULT_RULES, lives: 2 }).livesLeft).toBe(2);
    expect(startAssembly(HU, { ...DEFAULT_RULES, lives: null }).livesLeft).toBeNull();
  });

  it("rejects lives that are not a positive integer", () => {
    expect(() => startAssembly(HU, { ...DEFAULT_RULES, lives: 0 })).toThrow(RangeError);
    expect(() => startAssembly(HU, { ...DEFAULT_RULES, lives: -1 })).toThrow(RangeError);
    expect(() => startAssembly(HU, { ...DEFAULT_RULES, lives: 2.5 })).toThrow(RangeError);
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
    const rules = { ...DEFAULT_RULES, lives: 2 };
    const wrong: AssemblyAttempt = { layout: 0, placements: [null, null, null] };
    let turn = submitAttempt(startAssembly(HU, rules), HU, wrong, rules);
    expect(turn.state).toMatchObject({ livesLeft: 1, failed: false });
    turn = submitAttempt(turn.state, HU, wrong, rules);
    expect(turn.state).toMatchObject({ attempts: 2, livesLeft: 0, failed: true, solved: false, score: 0 });
  });

  it("changes nothing once the round is over, and repeats the final feedback", () => {
    const rules = { ...DEFAULT_RULES, lives: 1 };
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
    const rules = { ...DEFAULT_RULES, lives: null };
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

    const rules: AssemblyRules = { lives: null, baseScore: 50, attemptCost: 20, hintCost: 5, minScore: 0 };
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

  it("marks a spare tile of a needed shape as right", () => {
    const { state } = submitAttempt(startAssembly(LIN), LIN, { layout: 0, placements: ["d", "b"] });
    expect(state.memory.tiles).toEqual({ a: "untried", b: "wrong", c: "untried", d: "right" });
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
    const rules = { ...DEFAULT_RULES, lives: 1 };
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
