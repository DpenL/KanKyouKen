import { describe, expect, it } from "vitest";
import { currentChar, finishRound, isFinished, startSession, summarize } from "./session";

const solved = (char: string, attempts = 1, hints = 0, score = 100) => ({ char, solved: true, attempts, hints, score });
const failed = (char: string) => ({ char, solved: false, attempts: 5, hints: 0, score: 0 });

describe("session", () => {
  it("walks the deck in order", () => {
    let session = startSession("deck", "learn", ["a", "b"]);
    expect(currentChar(session)).toBe("a");
    session = finishRound(session, solved("a"));
    expect(currentChar(session)).toBe("b");
    expect(isFinished(session)).toBe(false);
    session = finishRound(session, solved("b"));
    expect(currentChar(session)).toBeNull();
    expect(isFinished(session)).toBe(true);
  });

  it("sends a failed character to the end of the deck, once", () => {
    let session = startSession("deck", "review", ["a", "b"]);
    session = finishRound(session, failed("a"));
    expect(session.queue).toEqual(["a", "b", "a"]);
    session = finishRound(session, solved("b"));
    expect(currentChar(session)).toBe("a");
    session = finishRound(session, failed("a"));
    expect(session.queue).toEqual(["a", "b", "a"]);
    expect(isFinished(session)).toBe(true);
  });

  it("totals score, first tries and hints", () => {
    let session = startSession("deck", "review", ["a", "b", "c"]);
    session = finishRound(session, failed("a"));
    session = finishRound(session, solved("b", 1, 1, 75));
    session = finishRound(session, solved("c", 3, 0, 70));
    session = finishRound(session, solved("a", 1, 2, 50));
    expect(summarize(session)).toEqual({ score: 195, chars: 3, solved: 3, firstTry: 1, hints: 3 });
  });

  it("summarizes an empty run", () => {
    expect(summarize(startSession("deck", "learn", []))).toEqual({ score: 0, chars: 0, solved: 0, firstTry: 0, hints: 0 });
  });
});
