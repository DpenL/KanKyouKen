import type { EventSink, GameEvent } from "./types";

/** Keeps every event in an array. For tests, replays and debug overlays. */
export function createMemorySink(): EventSink & { readonly events: GameEvent[]; clear(): void } {
  const events: GameEvent[] = [];
  return {
    events,
    record(event) {
      events.push(event);
    },
    clear() {
      events.length = 0;
    },
    flush: () => Promise.resolve(),
  };
}

/** Wraps a plain function as a sink. */
export function sinkFrom(record: (event: GameEvent) => void): EventSink {
  return { record };
}

/**
 * Sends each event to several sinks. A sink that throws does not stop the others;
 * `flush` waits for all of them and never rejects, whether a sink's `flush` rejects or
 * throws outright.
 */
export function createFanoutSink(sinks: readonly EventSink[]): EventSink {
  return {
    record(event) {
      for (const sink of sinks) {
        try {
          sink.record(event);
        } catch {
          // A broken sink must never break the game or starve the other sinks.
        }
      }
    },
    async flush() {
      // `async` turns a flush that throws before returning its promise into a rejection.
      await Promise.allSettled(sinks.map(async (s) => s.flush?.()));
    },
  };
}

/** Fills in `task` and merges default `data` fields (the event's own fields win). */
export function withEventDefaults(
  sink: EventSink,
  defaults: { readonly task?: string; readonly data?: Readonly<Record<string, unknown>> },
): EventSink {
  return {
    record(event) {
      const merged: { -readonly [K in keyof GameEvent]: GameEvent[K] } = { ...event };
      if (merged.task === undefined && defaults.task !== undefined) merged.task = defaults.task;
      if (defaults.data !== undefined) merged.data = { ...defaults.data, ...event.data };
      sink.record(merged);
    },
    flush: () => sink.flush?.() ?? Promise.resolve(),
  };
}
