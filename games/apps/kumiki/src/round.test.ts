import { describe, expect, it } from "vitest";
import { loadStarterJa } from "@kankyouken/glyph-data";
import {
  DEFAULT_RULES,
  MIN_MALFORMED_DIFFERENCE,
  MIN_TILE_DIFFERENCE,
  tellApart,
  type AssemblyPuzzle,
} from "@kankyouken/mechanics/components";
import { createRng } from "@kankyouken/mechanics/util";
import { buildContent } from "./content";
import { examChar, examTotals, startExam, submitExamItem } from "./exam";
import {
  buildPuzzle,
  canCheck,
  check,
  describeBoard,
  isOver,
  moveTile,
  potentialScore,
  returnTile,
  rulesFor,
  startRound,
  takeHint,
  type Mode,
  type Round,
} from "./round";

const { glyphs, set } = loadStarterJa();
const content = buildContent(glyphs, set);
const puzzleFor = (char: string, seed = "t"): AssemblyPuzzle => buildPuzzle(char, content, createRng(seed));

function solving(puzzle: AssemblyPuzzle): string[] {
  const used = new Set<string>();
  return puzzle.solution.map((shows) => {
    const tile = puzzle.tray.find((candidate) => candidate.shows === shows && !used.has(candidate.id))!;
    used.add(tile.id);
    return tile.id;
  });
}

function fill(round: Round, layout: number, tiles: readonly string[]): Round {
  return tiles.reduce((current, tile, slot) => moveTile(current, layout, slot, tile), round);
}

function begin(char: string, mode: Mode): Round {
  return startRound(char, mode, puzzleFor(char), 1000);
}

describe("puzzles", () => {
  it("are built with four structures and a 3 x 4 tray", () => {
    for (const deck of content.decks) {
      for (const char of deck.chars) {
        const puzzle = puzzleFor(char);
        expect(puzzle.layouts).toHaveLength(4);
        expect(puzzle.tray).toHaveLength(12);
        expect(puzzle.trayRows).toBe(3);
        expect(puzzle.solution.length).toBeGreaterThan(1);
      }
    }
  });

  it("are the same for the same seed", () => {
    const a = puzzleFor("持", "seed");
    const b = puzzleFor("持", "seed");
    expect(a.tray.map((tile) => tile.shows)).toEqual(b.tray.map((tile) => tile.shows));
    expect(a.layouts.map((layout) => layout.signature)).toEqual(b.layouts.map((layout) => layout.signature));
  });

  it("never show two tiles a player cannot tell apart, for any character of the set", () => {
    const twins = new Set(Object.entries(set.sameShape ?? {}).flatMap(([a, list]) => list.flatMap((b) => [a + b, b + a])));
    expect(twins.has("口囗")).toBe(true);
    for (const char of content.decks.at(-1)!.chars) {
      for (const seed of ["a", "b"]) {
        const puzzle = puzzleFor(char, seed);
        expect(puzzle.tray, char).toHaveLength(12);
        for (const component of new Set(puzzle.solution)) {
          expect(puzzle.tray.some((t) => t.imitates === component), `${char}: nothing passes for ${component}`).toBe(true);
        }
        puzzle.tray.forEach((a, i) => {
          for (const b of puzzle.tray.slice(i + 1)) {
            if (a.role === "correct" && b.role === "correct") continue;
            expect(twins.has(a.shows + b.shows), `${char}: ${a.shows} and ${b.shows}`).toBe(false);
            const least = a.role === "malformed" || b.role === "malformed" ? MIN_MALFORMED_DIFFERENCE : MIN_TILE_DIFFERENCE;
            expect(tellApart(a.glyph, b.glyph, least), `${char}: ${a.shows} and ${b.shows}`).toBe(true);
          }
        });
      }
    }
  });

  it("refuse characters without a glyph", () => {
    expect(() => buildPuzzle("？", content, createRng(1))).toThrow();
  });
});

describe("rules", () => {
  it("gives unlimited tries in Learn and five lives in Review", () => {
    expect(rulesFor("learn")).toEqual({ ...DEFAULT_RULES, lives: null });
    expect(rulesFor("review").lives).toBe(5);
    expect(begin("持", "learn").state.livesLeft).toBeNull();
    expect(begin("持", "review").state.livesLeft).toBe(5);
  });
});

describe("a round", () => {
  it("can only be checked when every slot of the structure in play is filled", () => {
    let round = begin("持", "review");
    expect(canCheck(round)).toBe(false);
    expect(check(round, 2000)).toBeNull();
    const tiles = solving(round.puzzle);
    round = moveTile(round, round.puzzle.correctLayout, 0, tiles[0]!);
    expect(canCheck(round)).toBe(false);
    round = fill(round, round.puzzle.correctLayout, tiles);
    expect(canCheck(round)).toBe(true);
    round = returnTile(round, tiles[0]!);
    expect(canCheck(round)).toBe(false);
  });

  it("reports a wrong check with everything the event needs, and takes a life", () => {
    let round = begin("持", "review");
    const { puzzle } = round;
    const wrong = puzzle.layouts.findIndex((_, index) => index !== puzzle.correctLayout);
    const strangers = puzzle.tray.filter((tile) => !puzzle.solution.includes(tile.shows));
    round = fill(round, wrong, strangers.slice(0, puzzle.layouts[wrong]!.slots.length).map((tile) => tile.id));
    const outcome = check(round, 4500)!;
    expect(outcome.data).toMatchObject({
      correct: false,
      response_time_ms: 3500,
      target: "持",
      attempt: 1,
      structure_correct: false,
      correct_components: 0,
      correct_positions: 0,
      lives_left: 4,
    });
    expect(outcome.data.options).toEqual(puzzle.tray.map((tile) => tile.shows));
    expect(outcome.data.chosen.startsWith(`${puzzle.layouts[wrong]!.signature}+`)).toBe(true);
    expect(outcome.round.state.memory.layouts[wrong]).toBe("wrong");
    expect(outcome.round.feedback?.structureCorrect).toBe(false);
    // The placements stay on the board so they can be adjusted.
    expect(outcome.round.board).toEqual(round.board);
    expect(potentialScore(outcome.round)).toBe(85);
  });

  it("measures the response time from the previous check", () => {
    let round = begin("持", "learn");
    const { puzzle } = round;
    const tiles = solving(puzzle);
    round = fill(round, puzzle.correctLayout, [...tiles].reverse());
    const first = check(round, 3000)!;
    expect(first.data.response_time_ms).toBe(2000);
    expect(first.data.lives_left).toBeNull();
    const second = check(fill(first.round, puzzle.correctLayout, tiles), 3700)!;
    expect(second.data).toMatchObject({ correct: true, response_time_ms: 700, attempt: 2, correct_positions: tiles.length });
    expect(second.data.chosen).toBe([puzzle.layouts[puzzle.correctLayout]!.signature, ...puzzle.solution].join("+"));
    expect(second.round.state.score).toBe(85);
    expect(isOver(second.round)).toBe(true);
  });

  it("does not judge an unchanged board twice", () => {
    let round = begin("持", "review");
    const { puzzle } = round;
    const tiles = solving(puzzle);
    const reversed = [...tiles].reverse();
    round = check(fill(round, puzzle.correctLayout, reversed), 2000)!.round;
    expect(round.state.livesLeft).toBe(4);
    // A second tap on Check: nothing to judge, no life lost.
    expect(canCheck(round)).toBe(false);
    expect(check(round, 2010)).toBeNull();
    // Taking a tile out and putting it back gives the same board again.
    const emptied = returnTile(round, reversed[0]!);
    expect(canCheck(emptied)).toBe(false);
    expect(canCheck(moveTile(emptied, puzzle.correctLayout, 0, reversed[0]!))).toBe(false);
    // Any other arrangement can be checked.
    round = fill(round, puzzle.correctLayout, tiles);
    expect(canCheck(round)).toBe(true);
    const solved = check(round, 3000)!;
    expect(solved.data).toMatchObject({ correct: true, attempt: 2, lives_left: 4 });
  });

  it("locks the board once it is over", () => {
    let round = begin("持", "review");
    const tiles = solving(round.puzzle);
    round = check(fill(round, round.puzzle.correctLayout, tiles), 2000)!.round;
    expect(round.state.solved).toBe(true);
    expect(returnTile(round, tiles[0]!)).toBe(round);
    expect(moveTile(round, 0, 0, tiles[0]!)).toBe(round);
    expect(canCheck(round)).toBe(false);
  });

  it("fails after five wrong checks in Review", () => {
    let round = begin("持", "review");
    const { puzzle } = round;
    // Two wrong arrangements in turn: the same one is not judged twice in a row.
    const reversed = [...solving(puzzle)].reverse();
    const strangers = puzzle.tray.filter((tile) => !puzzle.solution.includes(tile.shows)).map((tile) => tile.id);
    for (let n = 0; n < 5; n++) {
      round = fill(round, puzzle.correctLayout, n % 2 === 0 ? reversed : strangers.slice(0, reversed.length));
      round = check(round, 2000 + n)!.round;
    }
    expect(round.state.failed).toBe(true);
    expect(round.state.livesLeft).toBe(0);
    expect(round.state.score).toBe(0);
    expect(check(round, 9000)).toBeNull();
  });

  it("counts hints against the score", () => {
    let round = takeHint(begin("持", "learn"));
    expect(round.state.hintsUsed).toBe(1);
    expect(potentialScore(round)).toBe(75);
    round = check(fill(round, round.puzzle.correctLayout, solving(round.puzzle)), 2000)!.round;
    expect(round.state.score).toBe(75);
  });

  it("ignores moves into structures the puzzle does not have", () => {
    const round = begin("持", "learn");
    expect(moveTile(round, 9, 0, "t0")).toBe(round);
  });
});

describe("describeBoard", () => {
  it("names the structure and what each slot shows", () => {
    const puzzle = puzzleFor("持");
    const tiles = solving(puzzle);
    expect(describeBoard(puzzle, { layout: puzzle.correctLayout, slots: [tiles[0]!, null, tiles[2]!] })).toBe(
      `${puzzle.layouts[puzzle.correctLayout]!.signature}+${puzzle.solution[0]}+_+${puzzle.solution[2]}`,
    );
  });
});

describe("exam", () => {
  it("scores slots without revealing anything and totals at the end", () => {
    let exam = startExam("temple", ["持", "待"]);
    expect(examChar(exam)).toBe("持");
    const first = puzzleFor("持");
    const right = submitExamItem(exam, first, { layout: first.correctLayout, slots: solving(first) }, 1234.4);
    expect(right.data).toMatchObject({ correct: true, response_time_ms: 1234, target: "持", attempt: 1, slots_correct: 3, slots_total: 3 });
    exam = right.exam;
    expect(examChar(exam)).toBe("待");

    const second = puzzleFor("待");
    const partial = submitExamItem(exam, second, { layout: second.correctLayout, slots: [solving(second)[0]!] }, 10);
    expect(partial.data).toMatchObject({ correct: false, slots_correct: 1, slots_total: 3 });
    exam = partial.exam;
    expect(examChar(exam)).toBeNull();
    expect(exam.results).toEqual([
      { char: "持", score: 3, slots: 3 },
      { char: "待", score: 1, slots: 3 },
    ]);
    expect(examTotals(exam)).toEqual({ score: 4, slots: 6 });
  });

  it("counts an untouched structure as zero", () => {
    const puzzle = puzzleFor("間");
    const outcome = submitExamItem(startExam("gate", ["間"]), puzzle, { layout: puzzle.correctLayout, slots: [] }, 5);
    expect(outcome.data).toMatchObject({ correct: false, slots_correct: 0, slots_total: 2 });
  });
});
