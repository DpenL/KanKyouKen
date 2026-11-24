import { describe, expect, it } from "vitest";
import type { AssemblyFeedback } from "@kankyouken/mechanics/components";
import { TONE_ICON, feedbackLines } from "./feedback";

const feedback = (change: Partial<AssemblyFeedback>): AssemblyFeedback => ({
  structureCorrect: false,
  correctComponents: 0,
  componentCount: 3,
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
