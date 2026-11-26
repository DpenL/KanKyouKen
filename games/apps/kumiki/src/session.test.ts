import { describe, expect, it } from "vitest";
import { canReturn, classicEnd, currentChar, finishRound, roundEnd, startSession, summarize, summaryData } from "./session";

const solved = (char: string, attempts = 1, hints = 0, score = 100) => ({ char, solved: true, attempts, hints, score });
const failed = (char: string) => ({ char, solved: false, attempts: 5, hints: 0, score: 0 });

describe("session", () => {
  it("walks the deck in order", () => {
    let session = startSession("deck", "learn", ["a", "b"]);
    expect(currentChar(session)).toBe("a");
    session = finishRound(session, solved("a"));
    expect(currentChar(session)).toBe("b");
    session = finishRound(session, solved("b"));
    expect(currentChar(session)).toBeNull();
  });

  it("sends a failed character to the end of the deck, once", () => {
    let session = startSession("deck", "review", ["a", "b"]);
    session = finishRound(session, failed("a"));
    expect(session.queue).toEqual(["a", "b", "a"]);
    session = finishRound(session, solved("b"));
    expect(currentChar(session)).toBe("a");
    session = finishRound(session, failed("a"));
    expect(session.queue).toEqual(["a", "b", "a"]);
    expect(currentChar(session)).toBeNull();
  });

  it("totals score, first tries and hints", () => {
    let session = startSession("deck", "review", ["a", "b", "c"]);
    session = finishRound(session, failed("a"));
    session = finishRound(session, solved("b", 1, 1, 75));
    session = finishRound(session, solved("c", 3, 0, 70));
    session = finishRound(session, solved("a", 1, 2, 50));
    expect(summarize(session)).toEqual({ score: 195, chars: 3, solved: 3, mastered: 3, firstTry: 1, hints: 3, outOfLives: false });
  });

  it("hands a summary to the events under their field names", () => {
    const summary = { score: 195, chars: 3, solved: 3, mastered: 2, firstTry: 1, hints: 3, outOfLives: true };
    expect(summaryData(summary)).toEqual({ score: 195, chars: 3, solved: 3, mastered: 2, first_try: 1, hints: 3, out_of_lives: true });
  });

  it("summarizes an empty run", () => {
    expect(summarize(startSession("deck", "learn", []))).toEqual({
      score: 0,
      chars: 0,
      solved: 0,
      mastered: 0,
      firstTry: 0,
      hints: 0,
      outOfLives: false,
    });
  });
});

describe("a run under other rules", () => {
  const end = (returns: boolean, endsRun: boolean, carry = {}) => ({ returns, endsRun, carry });

  it("ends as Kumiki classic does when nothing else is said", () => {
    expect(classicEnd(failed("a"))).toEqual({ returns: true, endsRun: false, carry: {} });
    expect(classicEnd(solved("a"))).toEqual({ returns: false, endsRun: false, carry: {} });
    expect(roundEnd({ solved: true, mastered: true, returns: true, endsRun: false }, { hintTokens: 2 })).toEqual({
      returns: true,
      endsRun: false,
      carry: { hintTokens: 2 },
    });
  });

  it("is over when a round ends it, whatever is left in the deck", () => {
    let session = startSession("deck", "review", ["a", "b", "c"]);
    session = finishRound(session, solved("a", 2, 0, 460), end(false, false, { livesLeft: 2.5, livesMax: 3 }));
    expect(session.carry).toEqual({ livesLeft: 2.5, livesMax: 3 });
    expect(currentChar(session)).toBe("b");
    session = finishRound(session, { ...failed("b"), score: 140 }, end(false, true));
    expect(currentChar(session)).toBeNull();
    expect(session.queue).toEqual(["a", "b", "c"]);
    expect(summarize(session)).toMatchObject({ score: 600, chars: 2, solved: 1, outOfLives: true });
  });

  it("hands on what the round before left", () => {
    let session = startSession("deck", "review", ["a", "b"]);
    expect(session.carry).toEqual({});
    session = finishRound(session, solved("a"), end(false, false, { hintTokens: 2, livesLeft: 3, livesMax: 3 }));
    expect(session.carry).toEqual({ hintTokens: 2, livesLeft: 3, livesMax: 3 });
    session = finishRound(session, solved("b"), end(false, false, { hintTokens: 3 }));
    expect(session.carry).toEqual({ hintTokens: 3 });
  });

  it("brings a character solved with a hint back once, and counts its last round only", () => {
    let session = startSession("deck", "review", ["a", "b"]);
    expect(canReturn(session, "a")).toBe(true);
    session = finishRound(session, solved("a", 1, 1, 900), end(true, false));
    expect(session.queue).toEqual(["a", "b", "a"]);
    expect(canReturn(session, "a")).toBe(false);
    session = finishRound(session, solved("b", 1, 0, 900), end(false, false));
    session = finishRound(session, solved("a", 2, 1, 540), end(true, false));
    expect(session.queue).toEqual(["a", "b", "a"]);
    expect(currentChar(session)).toBeNull();
    expect(summarize(session)).toMatchObject({ score: 1440, chars: 2, solved: 2, firstTry: 2, hints: 2 });
  });

  it("does not bring a character back when its round ends the run", () => {
    const session = finishRound(startSession("deck", "review", ["a", "b"]), failed("a"), end(true, true));
    expect(session.queue).toEqual(["a", "b"]);
    expect(currentChar(session)).toBeNull();
  });

  it("counts characters solved with a hint apart when they are not mastered", () => {
    let session = startSession("deck", "learn", ["a", "b", "c"]);
    session = finishRound(session, { ...solved("a", 1, 1), mastered: false }, end(false, false));
    session = finishRound(session, { ...solved("b"), mastered: true }, end(false, false));
    session = finishRound(session, failed("c"), end(false, false));
    expect(summarize(session)).toMatchObject({ solved: 2, mastered: 1, chars: 3 });
  });
});
