import { describe, expect, it } from "vitest";
import type { AssemblyFeedback } from "@kankyouken/mechanics/components";
import { TONE_ICON, feedbackCounts, feedbackLines, heartsText, hintCostNote, outcomeNote } from "./feedback";

const feedback = (change: Partial<AssemblyFeedback>): AssemblyFeedback => ({
  structureCorrect: false,
  correctComponents: 0,
  componentCount: 3,
  slotCount: 3,
  correctPositions: 0,
  anyInCorrectPosition: false,
  solved: false,
  ...change,
});

describe("feedbackLines", () => {
  it("always gives structure, components and position", () => {
    const lines = feedbackLines(feedback({}));
    expect(lines.map((line) => line.label)).toEqual(["Structure", "Components", "Position"]);
  });

  it("says positions cannot be judged while the structure is wrong", () => {
    const lines = feedbackLines(feedback({ correctComponents: 2 }));
    expect(lines[0]).toMatchObject({ text: "wrong", tone: "bad" });
    expect(lines[1]).toMatchObject({ text: "2 of 3 belong", tone: "partial" });
    expect(lines[2]).toMatchObject({ tone: "unknown" });
    expect(lines[2]!.text).toContain("cannot be judged");
  });

  it("reports positions once the structure is right", () => {
    const none = feedbackLines(feedback({ structureCorrect: true, correctComponents: 3 }));
    expect(none[0]).toMatchObject({ text: "right", tone: "good" });
    expect(none[1]).toMatchObject({ tone: "good" });
    expect(none[2]).toMatchObject({ text: "none in place", tone: "bad" });
    const some = feedbackLines(feedback({ structureCorrect: true, correctPositions: 1, anyInCorrectPosition: true }));
    expect(some[1]).toMatchObject({ text: "0 of 3 belong", tone: "bad" });
    expect(some[2]).toMatchObject({ text: "at least one in place", tone: "partial" });
  });

  it("is all good when solved", () => {
    const lines = feedbackLines(
      feedback({ structureCorrect: true, correctComponents: 3, correctPositions: 3, anyInCorrectPosition: true, solved: true }),
    );
    expect(lines.map((line) => line.tone)).toEqual(["good", "good", "good"]);
  });

  it("has a different icon for every tone", () => {
    expect(new Set(Object.values(TONE_ICON)).size).toBe(4);
  });
});

describe("feedbackCounts", () => {
  it("counts parts and places out of the slots of the structure tried", () => {
    // A four-part character tried in a three-slot structure: nothing gives the four away.
    const lines = feedbackCounts(feedback({ componentCount: 4, slotCount: 3, correctComponents: 3 }));
    expect(lines.map((line) => line.label)).toEqual(["Structure", "Parts that belong", "In their place"]);
    expect(lines[0]).toMatchObject({ text: "wrong", tone: "bad" });
    expect(lines[1]).toMatchObject({ text: "3 of 3", tone: "good" });
    expect(lines[2]).toMatchObject({ text: "0 of 3", tone: "bad" });
  });

  it("shows partial counts under the right structure", () => {
    const lines = feedbackCounts(feedback({ structureCorrect: true, correctComponents: 2, correctPositions: 1, anyInCorrectPosition: true }));
    expect(lines[0]).toMatchObject({ text: "right", tone: "good" });
    expect(lines[1]).toMatchObject({ text: "2 of 3", tone: "partial" });
    expect(lines[2]).toMatchObject({ text: "1 of 3", tone: "partial" });
  });
});

describe("hintCostNote", () => {
  const price = (policy: Parameters<typeof hintCostNote>[0]["policy"], change: Partial<Parameters<typeof hintCostNote>[0]> = {}) => ({
    policy,
    lives: 0,
    points: 0,
    tokens: 0,
    consequence: null,
    ...change,
  });

  it("names what each policy takes", () => {
    expect(hintCostNote(price("life", { lives: 0.5 }), 0)).toBe("½ life");
    expect(hintCostNote(price("life", { lives: 1 }), 0)).toBe("1 life");
    expect(hintCostNote(price("life", { lives: 1.5 }), 0)).toBe("1½ lives");
    expect(hintCostNote(price("points", { points: 25 }), 0)).toBe("−25");
    expect(hintCostNote(price("token", { tokens: 1 }), 2)).toBe("2 tokens");
    expect(hintCostNote(price("token", { tokens: 1 }), 1)).toBe("1 token");
    expect(hintCostNote(price("token", { tokens: 1 }), 0)).toBe("0 tokens");
    expect(hintCostNote(price("return", { consequence: "returns" }), 0)).toBe("comes back later");
    expect(hintCostNote(price("unmastered", { consequence: "unmastered" }), 0)).toBe("not mastered");
  });

  it("says nothing when the hint costs nothing", () => {
    expect(hintCostNote(price("free"), 0)).toBe("");
    expect(hintCostNote(price("life"), 0)).toBe("");
    expect(hintCostNote(price("points"), 0)).toBe("");
    expect(hintCostNote(price("off"), 0)).toBe("");
  });

  it("writes hearts with their halves", () => {
    expect([3, 2.5, 1, 0.5, 0].map(heartsText)).toEqual(["3", "2½", "1", "½", "0"]);
  });
});

describe("outcomeNote", () => {
  const facts = { solved: true, score: 85, mastered: true, returns: false, endsRun: false };

  it("gives the points of a solved character, and what a look meant for it", () => {
    expect(outcomeNote(facts)).toBe("+85 points");
    expect(outcomeNote({ ...facts, returns: true })).toBe("+85 points. You looked, so it comes back at the end of the deck.");
    expect(outcomeNote({ ...facts, mastered: false })).toBe("+85 points. You looked, so it does not count as mastered yet.");
  });

  it("says what follows a lost character", () => {
    const lost = { ...facts, solved: false, mastered: false, score: 0 };
    expect(outcomeNote(lost)).toBe("No points this time.");
    expect(outcomeNote({ ...lost, returns: true })).toBe("No points this time. It comes back at the end of the deck.");
    expect(outcomeNote({ ...lost, endsRun: true })).toBe("No points this time. The run ends here.");
    expect(outcomeNote({ ...lost, score: 140, endsRun: true })).toBe("+140 points for what was right. The run ends here.");
  });
});
