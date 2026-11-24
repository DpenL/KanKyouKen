import { describe, expect, it } from "vitest";
import { lessonAbandonedEvent } from "./left";

describe("lesson_abandoned", () => {
  it("says what was left, where, and how far the player had got", () => {
    const event = lessonAbandonedEvent(5000, "back", {
      lesson: "first-strokes",
      mode: "learn",
      task: "trace:none",
      item: "十",
      position: 1,
      of: 10,
      completed: 1,
      strokesDone: 1,
      strokeCount: 2,
      elapsedMs: 4321.4,
      detail: { stage_index: 2, rep: 0, mistakes: 2 },
    });
    expect(event).toEqual({
      type: "lesson_abandoned",
      ts: 5000,
      item: "十",
      task: "trace:none",
      data: {
        lesson: "first-strokes",
        mode: "learn",
        left_by: "back",
        position: 1,
        of: 10,
        completed: 1,
        strokes_done: 1,
        stroke_count: 2,
        elapsed_ms: 4321,
        stage_index: 2,
        rep: 0,
        mistakes: 2,
      },
    });
  });

  it("names no character when none was on screen", () => {
    const event = lessonAbandonedEvent(100, "page-closed", {
      lesson: "home",
      mode: "timed",
      task: "timed",
      item: null,
      position: 0,
      of: 16,
      completed: 0,
      strokesDone: 0,
      strokeCount: 0,
      elapsedMs: 0,
    });
    expect(event).not.toHaveProperty("item");
    expect(event).toMatchObject({ type: "lesson_abandoned", task: "timed", data: { mode: "timed", left_by: "page-closed", completed: 0, of: 16 } });
  });
});
