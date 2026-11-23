import { describe, expect, it } from "vitest";
import { toCollectorBody } from "./collector";
import { choiceAttemptEvent, gameEvent, strokeAttemptEvent } from "./events";
import { createFanoutSink, createMemorySink, sinkFrom, withEventDefaults } from "./sinks";

const attempt = strokeAttemptEvent(
  { ts: Date.UTC(2026, 0, 2, 3, 4, 5), item: "木", task: "trace:dotted" },
  {
    correct: false,
    response_time_ms: 1800,
    verdict: "wrong-direction",
    stroke_index: 1,
    resembles: 1,
    attempt: 2,
    draw_ms: 420,
    hint_level: 0,
    component: "十",
    guide: "dotted",
    audio_mode: "melody",
  },
);

describe("telemetry", () => {
  it("builds events without undefined fields", () => {
    expect(gameEvent("session_start", { ts: 5 })).toEqual({ type: "session_start", ts: 5 });
    expect(attempt.type).toBe("stroke_attempt");
    expect(attempt.item).toBe("木");
    expect(attempt.data?.correct).toBe(false);
    const choice = choiceAttemptEvent(
      { ts: 1, item: "持" },
      { correct: true, response_time_ms: 900, target: "扌", chosen: "扌", options: ["扌", "才"], attempt: 1 },
    );
    expect(choice.data?.options).toEqual(["扌", "才"]);
    expect("task" in choice).toBe(false);
  });

  it("maps events onto the collector body", () => {
    const body = toCollectorBody(attempt, { studyId: "s-1", participantId: "p-1" }, { appVersion: "game/0.1.0", platform: "web" });
    expect(body).toEqual({
      participant_id: "p-1",
      study_id: "s-1",
      event_type: "stroke_attempt",
      payload: attempt.data,
      ts: "2026-01-02T03:04:05.000Z",
      app_version: "game/0.1.0",
      platform: "web",
      item_id: "木",
      task_id: "trace:dotted",
    });
    const bare = toCollectorBody(gameEvent("session_end", { ts: 0 }), { studyId: "s", participantId: "p", sessionId: "x" }, { appVersion: "a", platform: "web" });
    expect(bare.payload).toBeNull();
    expect(bare.session_id).toBe("x");
    expect("item_id" in bare).toBe(false);
  });

  it("fans out, survives a throwing sink and applies defaults", async () => {
    const a = createMemorySink();
    const b = createMemorySink();
    const broken = sinkFrom(() => {
      throw new Error("boom");
    });
    const fan = createFanoutSink([broken, a, withEventDefaults(b, { task: "default-task", data: { build: 7, correct: true } })]);
    fan.record(attempt);
    fan.record(gameEvent("session_end", { ts: 9 }));
    await fan.flush?.();
    expect(a.events).toHaveLength(2);
    expect(b.events[0]!.task).toBe("trace:dotted");
    expect(b.events[0]!.data).toMatchObject({ build: 7, correct: false });
    expect(b.events[1]).toEqual({ type: "session_end", ts: 9, task: "default-task", data: { build: 7, correct: true } });
    a.clear();
    expect(a.events).toHaveLength(0);
  });
});
