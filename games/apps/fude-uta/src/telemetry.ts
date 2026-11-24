import type { EventSink, GameEvent } from "@kankyouken/mechanics/telemetry";
import { createFanoutSink, createMemorySink } from "@kankyouken/mechanics/telemetry";
import type { LaunchParams } from "@kankyouken/web-kit/app";
import { canReport, mountRecordingNotice, safeLocalStorage } from "@kankyouken/web-kit/app";
import { createCollectorSink } from "@kankyouken/web-kit/telemetry";

export const APP_VERSION = "fude-uta/0.1.0";

export interface Telemetry {
  readonly sink: EventSink;
  /** Every event recorded so far when a memory sink is in use (offline play, debug mode); otherwise null. */
  readonly events: readonly GameEvent[] | null;
}

/**
 * Events go to the platform's collector when the launch link carries what that needs,
 * and stay in memory otherwise. Debug mode keeps a copy in memory either way.
 *
 * Also puts a notice on the page whenever a session that belongs to a study is not being
 * recorded (an incomplete link, a refused token, no connection); plain play shows nothing.
 */
export function createTelemetry(params: LaunchParams): Telemetry {
  const onStatus = mountRecordingNotice(params);
  if (!canReport(params)) {
    const memory = createMemorySink();
    return { sink: memory, events: memory.events };
  }
  const collector = createCollectorSink({
    endpoint: `${params.api}/event-collector`,
    getToken: () => params.token,
    study: params.study,
    client: { appVersion: APP_VERSION, platform: "web" },
    storage: safeLocalStorage(),
    onStatus,
  });
  if (!params.debug) return { sink: collector, events: null };
  const memory = createMemorySink();
  return { sink: createFanoutSink([collector, memory]), events: memory.events };
}
