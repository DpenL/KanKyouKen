import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import { CLASSIC_RULES, ZEN_HANZI_RULES, startAssembly, submitAttempt, useHint } from "./assembly";
import { parseLayout } from "./layout";
import { ADAPTIVE_RANGE, CLASSIC_RUN, DEFAULT_RUN, ZEN_HANZI_RUN, nextRoundStart, roundOutcome } from "./run";
import type { AssemblyAttempt, AssemblyPuzzle, AssemblyRules, AssemblyState, ComponentTile, RoundStart, RunRules } from "./types";

const tile = (id: string, shows: string): ComponentTile => ({ id, shows, glyph: fixture(FIXTURES.has(shows) ? shows : "十"), role: "correct" });

/** 胡 by hand: layouts[1] is right; slots are 十, 口, 月. */
const HU: AssemblyPuzzle = {
  target: "胡",
  layouts: ["R(S,S,S)", "R(C(S,S),S)"].map(parseLayout),
  correctLayout: 1,
  solution: ["十", "口", "月"],
  parts: [[0, 1], [2, 3, 4], [5, 6, 7, 8]],
  tray: [tile("t0", "木"), tile("t1", "十"), tile("t2", "月"), tile("t3", "口")],
  trayRows: 1,
};
const SOLVE: AssemblyAttempt = { layout: 1, placements: ["t1", "t3", "t2"] };
const WRONG: AssemblyAttempt = { layout: 0, placements: ["t0", null, null] };

/** Play a round: `wrong` wrong attempts, `hints` hints, then a solve unless the hearts ran out or `solve` is false. */
function round(rules: AssemblyRules, { wrong = 0, hints = 0, solve = true, start = {} as RoundStart } = {}): AssemblyState {
  let state = startAssembly(HU, rules, start);
  for (let look = 0; look < hints; look++) state = useHint(state, rules);
  for (let attempt = 0; attempt < wrong; attempt++) state = submitAttempt(state, HU, WRONG, rules).state;
  return solve ? submitAttempt(state, HU, SOLVE, rules).state : state;
}

describe("run rule sets", () => {
  it("default to the demo's, and keep Kumiki's classic ones", () => {
    expect(DEFAULT_RUN).toBe(ZEN_HANZI_RUN);
    expect(ZEN_HANZI_RUN).toEqual({ livesScope: "run", atZero: "end-run" });
    expect(CLASSIC_RUN).toEqual({ livesScope: "character", atZero: "fail-character" });
  });
});

describe("roundOutcome", () => {
  it("ends the run when the hearts are gone, as in the demo", () => {
    const lost = round(ZEN_HANZI_RULES, { wrong: 6 });
    expect(lost.failed).toBe(true);
    expect(roundOutcome(lost, ZEN_HANZI_RULES, ZEN_HANZI_RUN)).toEqual({ solved: false, mastered: false, returns: false, endsRun: true });
    // The last half heart spent on a hint ends it too.
    const hinted = round(ZEN_HANZI_RULES, { hints: 6, solve: false });
    expect(roundOutcome(hinted, ZEN_HANZI_RULES, ZEN_HANZI_RUN).endsRun).toBe(true);
  });

  it("only loses the character under Kumiki's classic run rules, and brings it back", () => {
    const lost = round(CLASSIC_RULES, { wrong: 5 });
    expect(roundOutcome(lost, CLASSIC_RULES, CLASSIC_RUN)).toEqual({ solved: false, mastered: false, returns: true, endsRun: false });
  });

  it("counts a solve as mastered and done", () => {
    for (const run of [ZEN_HANZI_RUN, CLASSIC_RUN]) {
      expect(roundOutcome(round(ZEN_HANZI_RULES, { wrong: 2, hints: 1 }), ZEN_HANZI_RULES, run)).toEqual({
        solved: true,
        mastered: true,
        returns: false,
        endsRun: false,
      });
    }
  });

  it("brings a character solved with a hint back under the policy that says so", () => {
    const rules = { ...ZEN_HANZI_RULES, hint: "return" as const };
    expect(roundOutcome(round(rules, { hints: 1 }), rules, ZEN_HANZI_RUN)).toMatchObject({ solved: true, mastered: true, returns: true });
    expect(roundOutcome(round(rules), rules, ZEN_HANZI_RUN).returns).toBe(false);
  });

  it("does not count a character solved with a hint as mastered under the policy that says so", () => {
    const rules = { ...ZEN_HANZI_RULES, hint: "unmastered" as const };
    expect(roundOutcome(round(rules, { hints: 2 }), rules, ZEN_HANZI_RUN)).toMatchObject({ solved: true, mastered: false, returns: false });
    expect(roundOutcome(round(rules), rules, ZEN_HANZI_RUN).mastered).toBe(true);
  });

  it("says nothing yet about a round still being played", () => {
    const open = round(ZEN_HANZI_RULES, { wrong: 1, solve: false });
    expect(roundOutcome(open, ZEN_HANZI_RULES, ZEN_HANZI_RUN)).toEqual({ solved: false, mastered: false, returns: false, endsRun: false });
  });
});

describe("nextRoundStart", () => {
  it("hands the hearts left on to the next character, as in the demo", () => {
    // Three wrong attempts (3 -> 1.5), then a solve gives one back.
    const first = round(ZEN_HANZI_RULES, { wrong: 3 });
    expect(nextRoundStart(first, ZEN_HANZI_RULES, ZEN_HANZI_RUN)).toEqual({ hintTokens: 1, livesLeft: 2.5, livesMax: 3 });
    const second = round(ZEN_HANZI_RULES, { wrong: 1, start: nextRoundStart(first, ZEN_HANZI_RULES, ZEN_HANZI_RUN) });
    expect(second).toMatchObject({ livesLeft: 3, livesMax: 3 });
  });

  it("starts every character afresh under Kumiki's classic run rules", () => {
    const first = round(CLASSIC_RULES, { wrong: 3 });
    expect(first.livesLeft).toBe(2);
    expect(nextRoundStart(first, CLASSIC_RULES, CLASSIC_RUN)).toEqual({ hintTokens: 1 });
    expect(startAssembly(HU, CLASSIC_RULES, nextRoundStart(first, CLASSIC_RULES, CLASSIC_RUN)).livesLeft).toBe(5);
  });

  it("refills the hearts after a lost character when the run goes on", () => {
    const run: RunRules = { livesScope: "run", atZero: "fail-character" };
    const lost = round(ZEN_HANZI_RULES, { wrong: 6 });
    expect(nextRoundStart(lost, ZEN_HANZI_RULES, run)).toEqual({ hintTokens: 1 });
  });

  it("hands nothing on without lives, except hint tokens", () => {
    const rules: AssemblyRules = { ...ZEN_HANZI_RULES, lives: null, hint: "token" };
    const first = round(rules);
    expect(first.hintTokens).toBe(2);
    expect(nextRoundStart(first, rules, ZEN_HANZI_RUN)).toEqual({ hintTokens: 2 });
    const spent = round(rules, { hints: 1, start: { hintTokens: 2 } });
    expect(nextRoundStart(spent, rules, CLASSIC_RUN)).toEqual({ hintTokens: 1 });
  });

  it("counts hearts per character under the parts rule, whatever the scope", () => {
    const rules: AssemblyRules = { ...ZEN_HANZI_RULES, livesRule: "parts" };
    expect(nextRoundStart(round(rules, { wrong: 2 }), rules, ZEN_HANZI_RUN)).toEqual({ hintTokens: 1 });
  });

  it("adapts the hearts to how the last character went", () => {
    const rules: AssemblyRules = { ...ZEN_HANZI_RULES, livesRule: "adaptive", solveGain: 0 };
    const next = (state: AssemblyState): RoundStart => nextRoundStart(state, rules, CLASSIC_RUN);
    // A first-try solve: one heart fewer.
    expect(next(round(rules))).toEqual({ hintTokens: 1, livesMax: 2, livesLeft: 2 });
    // One wrong attempt: the same.
    expect(next(round(rules, { wrong: 1 }))).toMatchObject({ livesMax: 3, livesLeft: 3 });
    // Two wrong attempts, or a lost character: one more.
    expect(next(round(rules, { wrong: 2 }))).toMatchObject({ livesMax: 4, livesLeft: 4 });
    expect(next(round(rules, { wrong: 6 }))).toMatchObject({ livesMax: 4, livesLeft: 4 });
    // Never more than two hearts away from the rules' count, and never below one.
    expect(ADAPTIVE_RANGE).toBe(2);
    expect(next(round(rules, { wrong: 2, start: { livesMax: 5, livesLeft: 5 } }))).toMatchObject({ livesMax: 5 });
    expect(next(round(rules, { start: { livesMax: 1, livesLeft: 1 } }))).toMatchObject({ livesMax: 1 });
    const two: AssemblyRules = { ...rules, lives: 2 };
    expect(nextRoundStart(round(two, { start: { livesMax: 1, livesLeft: 1 } }), two, ZEN_HANZI_RUN)).toMatchObject({ livesMax: 1, livesLeft: 1 });
  });
});
