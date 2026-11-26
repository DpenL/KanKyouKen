import { describe, expect, it } from "vitest";
import { loadStarterJa } from "@kankyouken/glyph-data";
import {
  CLASSIC_RULES,
  MIN_MALFORMED_DIFFERENCE,
  MIN_TILE_DIFFERENCE,
  decompose,
  evaluateAttempt,
  layoutsLookAlike,
  tellApart,
  type AssemblyPuzzle,
} from "@kankyouken/mechanics/components";
import { createRng } from "@kankyouken/mechanics/util";
import { buildContent } from "./content";
import { examChar, examTotals, startExam, submitExamItem } from "./exam";
import {
  buildPuzzle,
  canCheck,
  canTakeHint,
  check,
  checksItself,
  describeBoard,
  hintCharge,
  isOver,
  lookAtCharacter,
  moveTile,
  potentialScore,
  returnTile,
  rulesFor,
  startRound,
  takeHint,
  type Mode,
  type Round,
} from "./round";
import { TRAYS, TRAY_COPIES, assemblyRules, puzzleOptions, presetChoices, type RuleChoices } from "./rules";

const { glyphs, set } = loadStarterJa();
const content = buildContent(glyphs, set);
/*
 * These tests were written for Kumiki's classic rules, the default until the rules of the
 * Zen Hanzi demo took over; they keep playing by them.
 */
const CLASSIC = presetChoices("classic");
const puzzleFor = (char: string, seed = "t"): AssemblyPuzzle => buildPuzzle(char, content, createRng(seed), puzzleOptions(CLASSIC));

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
  return startRound(char, mode, puzzleFor(char), 1000, rulesFor(mode, CLASSIC));
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

describe("puzzles under the default preset (the demo's tray and structures)", () => {
  const ZEN = presetChoices("zen-hanzi");
  const all = content.decks.at(-1)!.chars;
  /** Puzzles are built once per character, seed and change: building one takes a moment. */
  const built = new Map<string, AssemblyPuzzle>();
  const zenPuzzle = (char: string, seed: string, changes: Partial<RuleChoices> = {}): AssemblyPuzzle => {
    const key = `${char} ${seed} ${JSON.stringify(changes)}`;
    const puzzle = built.get(key) ?? buildPuzzle(char, content, createRng(seed), puzzleOptions({ ...ZEN, ...changes }, content.frames));
    built.set(key, puzzle);
    return puzzle;
  };
  /** Tests that build a puzzle for every character get more time than the default. */
  const SLOW = 30_000;
  const isRight = (tile: AssemblyPuzzle["tray"][number]): boolean => tile.role === "correct" || tile.role === "copy";
  const twins = new Set(Object.entries(set.sameShape ?? {}).flatMap(([a, list]) => list.flatMap((b) => [a + b, b + a])));
  /** The rule that stays in force whatever the tray: no WRONG tile looks like another tile. */
  function expectTellable(puzzle: AssemblyPuzzle): void {
    puzzle.tray.forEach((a, i) => {
      for (const b of puzzle.tray.slice(i + 1)) {
        if (isRight(a) && isRight(b)) continue;
        expect(twins.has(a.shows + b.shows), `${puzzle.target}: ${a.shows} and ${b.shows}`).toBe(false);
        const least = a.role === "malformed" || b.role === "malformed" ? MIN_MALFORMED_DIFFERENCE : MIN_TILE_DIFFERENCE;
        expect(tellApart(a.glyph, b.glyph, least), `${puzzle.target}: ${a.shows} and ${b.shows}`).toBe(true);
      }
    });
  }

  it("is what buildPuzzle makes when no options are given", () => {
    const byDefault = buildPuzzle("持", content, createRng("s"));
    const named = zenPuzzle("持", "s");
    expect(byDefault.tray.map((tile) => tile.shows)).toEqual(named.tray.map((tile) => tile.shows));
    expect(byDefault.layouts.map((layout) => layout.signature)).toEqual(named.layouts.map((layout) => layout.signature));
  });

  it("deals 18 tiles in 3 rows of 6 for every character of the set, with copies that are accepted", () => {
    for (const char of all) {
      for (const seed of ["a", "b"]) {
        const puzzle = zenPuzzle(char, seed);
        expect(puzzle.tray, char).toHaveLength(18);
        expect(puzzle.trayRows).toBe(3);
        expectTellable(puzzle);
        for (const component of new Set(puzzle.solution)) {
          expect(puzzle.tray.some((tile) => tile.imitates === component), `${char}: nothing passes for ${component}`).toBe(true);
        }
        const copies = puzzle.tray.filter((tile) => tile.role === "copy");
        expect(copies, char).toHaveLength(TRAY_COPIES);
        // Any copy does in place of its original.
        const used = new Set<string>();
        const placements = puzzle.solution.map((shows) => {
          const free = puzzle.tray.filter((candidate) => candidate.shows === shows && !used.has(candidate.id));
          const tile = free.find((candidate) => candidate.role === "copy") ?? free[0]!;
          used.add(tile.id);
          return tile.id;
        });
        expect(placements.some((id) => copies.some((copy) => copy.id === id))).toBe(true);
        expect(evaluateAttempt(puzzle, { layout: puzzle.correctLayout, placements }).solved).toBe(true);
      }
    }
  }, SLOW);

  it("offers four frames: the character's own, always the same, among decoys from the catalogue that change", () => {
    for (const char of all) {
      const own = decompose(glyphs.get(char)!, { known: content.context.known }).layout.signature;
      const boards = new Set<string>();
      for (const seed of ["a", "b", "c", "d"]) {
        const puzzle = zenPuzzle(char, seed);
        expect(puzzle.layouts, char).toHaveLength(4);
        expect(puzzle.layouts[puzzle.correctLayout]!.signature, char).toBe(own);
        puzzle.layouts.forEach((a, i) => {
          for (const b of puzzle.layouts.slice(i + 1)) expect(layoutsLookAlike(a, b), char).toBe(false);
          // Every decoy is a frame of the catalogue (the right one may be finer than the catalogue allows).
          if (i !== puzzle.correctLayout) {
            expect(content.frames.parts.some((frame) => frame.signature === a.signature), `${char}: ${a.signature}`).toBe(true);
          }
        });
        boards.add(puzzle.layouts.map((layout) => layout.signature).join(" "));
      }
      expect(boards.size, char).toBeGreaterThan(1);
    }
  }, SLOW);

  it("lets a decoy have another number of slots than the character has parts, and shows enclosures as decoys too", () => {
    let otherCount = 0;
    let enclosureDecoys = 0;
    for (const char of all) {
      // A seed of its own for every character, as every round of a run has.
      const puzzle = zenPuzzle(char, `seed for ${char}`);
      const right = puzzle.layouts[puzzle.correctLayout]!;
      for (const layout of puzzle.layouts) {
        if (layout === right) continue;
        if (layout.slots.length !== right.slots.length) otherCount++;
        if (layout.signature.startsWith("E:")) enclosureDecoys++;
      }
    }
    expect(otherCount).toBeGreaterThan(10);
    // An enclosure is not the right answer just because it is one.
    expect(enclosureDecoys).toBeGreaterThan(5);
  });

  it("sizes the tray as chosen, never leaving out a needed tile or its look-alike", () => {
    // One character of every deck: 持 and its like have three parts, 路 four, 門's family two.
    const sample = [...new Set([...content.decks.map((deck) => deck.chars[0]!), "路", "落", "閣", "返"])].filter((char) => all.includes(char));
    for (const tray of ["3x6", "3x4", "2x4", "4x6"] as const) {
      for (const char of sample) {
        const puzzle = zenPuzzle(char, "a", { tray });
        expect(puzzle.trayRows, tray).toBe(TRAYS[tray].rows);
        expect(puzzle.tray.length, `${tray} ${char}`).toBe(TRAYS[tray].size);
        expectTellable(puzzle);
        for (const shows of puzzle.solution) expect(puzzle.tray.some((tile) => tile.role === "correct" && tile.shows === shows)).toBe(true);
        for (const component of new Set(puzzle.solution)) {
          expect(puzzle.tray.some((tile) => tile.imitates === component), `${tray} ${char}: nothing passes for ${component}`).toBe(true);
        }
      }
    }
  }, SLOW);

  it("deals every right part once when copies are off", () => {
    for (const char of all) {
      const puzzle = zenPuzzle(char, "a", { copies: "no" });
      expect(puzzle.tray.some((tile) => tile.role === "copy")).toBe(false);
      expect(puzzle.tray, char).toHaveLength(18);
    }
  });

  it("shows the same four frames in the same places for every character under 'fixed'", () => {
    const usual = content.frames.parts.slice(0, 4).map((frame) => frame.signature);
    let odd = 0;
    for (const char of all) {
      const own = decompose(glyphs.get(char)!, { known: content.context.known }).layout.signature;
      for (const seed of ["a", "b"]) {
        const puzzle = zenPuzzle(char, seed, { structures: "fixed" });
        const shown = puzzle.layouts.map((layout) => layout.signature);
        expect(puzzle.layouts[puzzle.correctLayout]!.signature, char).toBe(own);
        // Only a character whose structure is none of the four changes the last frame.
        expect(shown.slice(0, 3), char).toEqual(usual.slice(0, 3));
        if (usual.includes(own)) expect(shown, char).toEqual(usual);
        else odd++;
      }
    }
    expect(odd / 2).toBeLessThan(all.length / 8);
  }, SLOW);

  it("splits every character in two by position under 'positions', with the four position classes as frames", () => {
    const classes = content.frames.positions.slice(0, 4).map((frame) => frame.signature);
    for (const char of all) {
      const puzzle = zenPuzzle(char, "a", { structures: "positions" });
      expect(puzzle.solution, char).toHaveLength(2);
      expect(puzzle.layouts.map((layout) => layout.signature), char).toEqual(classes);
      expect(puzzle.parts.flat().sort((a, b) => a - b), char).toEqual(glyphs.get(char)!.strokes.map((_, index) => index));
      expect(puzzle.tray, char).toHaveLength(18);
      expectTellable(puzzle);
    }
  }, SLOW);

  it("makes classic puzzles under 'alternatives', whatever frames the content has", () => {
    const withFrames = buildPuzzle("持", content, createRng("s"), puzzleOptions(CLASSIC, content.frames));
    const without = buildPuzzle("持", content, createRng("s"), puzzleOptions(CLASSIC));
    expect(withFrames.layouts.map((layout) => layout.signature)).toEqual(without.layouts.map((layout) => layout.signature));
    for (const layout of withFrames.layouts) expect(layout.slots).toHaveLength(withFrames.solution.length);
  });
});

describe("rules", () => {
  it("gives unlimited tries in Learn and five lives in Review", () => {
    expect(rulesFor("learn", CLASSIC)).toEqual({ ...CLASSIC_RULES, lives: null });
    expect(rulesFor("review", CLASSIC)).toEqual(CLASSIC_RULES);
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

describe("checking", () => {
  const roundWith = (changes: Partial<ReturnType<typeof presetChoices>>, char = "持"): Round => {
    const choices = { ...CLASSIC, ...changes };
    return startRound(char, "review", buildPuzzle(char, content, createRng("t"), puzzleOptions(choices)), 1000, rulesFor("review", choices));
  };

  it("judges a full board by itself under automatic checking, and only then", () => {
    let round = roundWith({ check: "auto" });
    expect(round.rules.check).toBe("auto");
    const tiles = solving(round.puzzle);
    round = moveTile(round, round.puzzle.correctLayout, 0, tiles[0]!);
    expect(checksItself(round)).toBe(false);
    round = fill(round, round.puzzle.correctLayout, tiles);
    expect(checksItself(round)).toBe(true);
    expect(checksItself({ ...round, rules: { ...round.rules, check: "button" } })).toBe(false);
    round = check(round, 2000)!.round;
    expect(round.state.solved).toBe(true);
    expect(checksItself(round)).toBe(false);
  });

  it("does not judge the same full board twice by itself", () => {
    let round = roundWith({ check: "auto" });
    const reversed = [...solving(round.puzzle)].reverse();
    round = check(fill(round, round.puzzle.correctLayout, reversed), 2000)!.round;
    expect(round.state.attempts).toBe(1);
    // Every tile stayed (afterCheck "keep"): nothing new to judge until something moves.
    expect(checksItself(round)).toBe(false);
  });

  it("sends back the tiles that are not in their right slot, as the demo does", () => {
    let round = roundWith({ afterCheck: "keep-correct" });
    const { puzzle } = round;
    const tiles = solving(puzzle);
    // The first two swapped, the rest in place.
    const swapped = [tiles[1]!, tiles[0]!, ...tiles.slice(2)];
    round = check(fill(round, puzzle.correctLayout, swapped), 2000)!.round;
    expect(round.board.layout).toBe(puzzle.correctLayout);
    expect(round.board.slots).toEqual([null, null, ...tiles.slice(2)]);
    expect(canCheck(round)).toBe(false);
    // Building the same wrong answer again is a new attempt, judged and charged again.
    round = fill(round, puzzle.correctLayout, swapped);
    expect(canCheck(round)).toBe(true);
    round = check(round, 3000)!.round;
    expect(round.state).toMatchObject({ attempts: 2, livesLeft: 3 });
  });

  it("empties a wrong structure, and leaves a failed board as it was", () => {
    let round = roundWith({ afterCheck: "keep-correct" });
    const { puzzle } = round;
    const wrong = puzzle.layouts.findIndex((layout, index) => index !== puzzle.correctLayout && layout.slots.length === 3);
    const tiles = solving(puzzle);
    round = check(fill(round, wrong, tiles), 2000)!.round;
    expect(round.board).toEqual({ layout: wrong, slots: [null, null, null] });

    let last = roundWith({ afterCheck: "clear" });
    last = { ...last, state: { ...last.state, livesLeft: 1 } };
    const full = fill(last, puzzle.correctLayout, [...tiles].reverse());
    const failed = check(full, 2000)!.round;
    expect(failed.state.failed).toBe(true);
    expect(failed.board).toEqual(full.board);
  });
});

describe("a round by the demo's rules", () => {
  const ZEN = presetChoices("zen-hanzi");
  const zenRound = (change: Partial<RuleChoices> = {}, start = {}): Round =>
    startRound("持", "review", puzzleFor("持"), 1000, assemblyRules({ ...ZEN, ...change }, "review"), start);

  it("loses half a heart per wrong check and reports it, with the points the check earned", () => {
    let round = zenRound();
    const { puzzle } = round;
    const tiles = solving(puzzle);
    expect(round.state).toMatchObject({ livesLeft: 3, livesMax: 3 });
    const swapped = [tiles[1]!, tiles[0]!, ...tiles.slice(2)];
    const first = check(fill(round, puzzle.correctLayout, swapped), 2000)!;
    // Right structure, three parts that belong, one in place: 100 + 30 + 10.
    expect(first.data).toMatchObject({ correct: false, lives_left: 2.5, lives_max: 3, lives_lost: 0.5, lives_gained: 0, points: 140, score: 140 });
    round = first.round;
    expect(potentialScore(round)).toBe(540);
    const second = check(fill(round, puzzle.correctLayout, tiles), 3000)!;
    // The solve gives the half heart back (never beyond three) and 540 for a second try.
    expect(second.data).toMatchObject({ correct: true, lives_left: 3, lives_lost: 0, lives_gained: 0.5, points: 540, score: 680 });
  });

  it("starts with what the round before left", () => {
    const round = zenRound({}, { livesLeft: 1.5, livesMax: 3, hintTokens: 2 });
    expect(round.state).toMatchObject({ livesLeft: 1.5, livesMax: 3, hintTokens: 2 });
  });

  it("charges half a heart for a hint and nothing off the score", () => {
    const round = zenRound();
    expect(potentialScore(round)).toBe(900);
    expect(hintCharge(round)).toMatchObject({ policy: "life", lives: 0.5, points: 0 });
    const looked = lookAtCharacter(round)!;
    expect(looked.data).toEqual({
      hint: "character",
      hints_used: 1,
      policy: "life",
      lives_lost: 0.5,
      points_lost: 0,
      tokens_spent: 0,
      consequence: null,
      lives_left: 2.5,
      tokens_left: 1,
      out_of_lives: false,
    });
    expect(potentialScore(looked.round)).toBe(900);
  });

  it("loses the round to a hint bought with the last half heart", () => {
    const round = zenRound({}, { livesLeft: 0.5, livesMax: 3 });
    expect(canTakeHint(round)).toBe(true);
    const looked = lookAtCharacter(round)!;
    expect(looked.data).toMatchObject({ lives_lost: 0.5, lives_left: 0, out_of_lives: true });
    expect(isOver(looked.round)).toBe(true);
    expect(looked.round.state).toMatchObject({ failed: true, solved: false });
    expect(lookAtCharacter(looked.round)).toBeNull();
  });

  it("reports what each other hint policy takes", () => {
    const data = (hint: RuleChoices["hint"]) => lookAtCharacter(zenRound({ hint }))?.data;
    expect(data("points")).toMatchObject({ policy: "points", points_lost: 25, lives_lost: 0, lives_left: 3 });
    expect(data("token")).toMatchObject({ policy: "token", tokens_spent: 1, tokens_left: 0, lives_lost: 0 });
    expect(data("later")).toMatchObject({ policy: "return", consequence: "returns", lives_lost: 0, points_lost: 0 });
    expect(data("unmastered")).toMatchObject({ policy: "unmastered", consequence: "unmastered" });
    expect(data("free")).toMatchObject({ policy: "free", lives_lost: 0, points_lost: 0, tokens_spent: 0, consequence: null });
    expect(data("off")).toBeUndefined();
    // Without a token there is no hint to take.
    const spent = lookAtCharacter(zenRound({ hint: "token" }))!.round;
    expect(canTakeHint(spent)).toBe(false);
    expect(lookAtCharacter(spent)).toBeNull();
  });

  it("plays without lives when the rules have none", () => {
    let round = zenRound({ lives: "none" });
    const { puzzle } = round;
    const tiles = solving(puzzle);
    expect(round.state.livesLeft).toBeNull();
    for (let attempt = 0; attempt < 8; attempt++) {
      round = check(fill(round, puzzle.correctLayout, [...tiles].reverse()), 2000 + attempt)!.round;
    }
    expect(round.state).toMatchObject({ attempts: 8, failed: false, livesLeft: null });
    expect(lookAtCharacter(round)!.data).toMatchObject({ policy: "life", lives_lost: 0, lives_left: null });
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
