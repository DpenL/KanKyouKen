/** Where events go: the platform's collector when the launch link allows it, memory otherwise. */

import {
  createFanoutSink,
  createMemorySink,
  type EventSink,
  type GameEvent,
} from "@kankyouken/mechanics/telemetry";
import { canReport, mountRecordingNotice, safeLocalStorage, type LaunchParams } from "@kankyouken/web-kit/app";
import { createCollectorSink } from "@kankyouken/web-kit/telemetry";

export const APP_VERSION = "kumiki/0.1.0";

export interface Telemetry {
  readonly sink: EventSink;
  /** Events kept in memory: always in debug mode, and whenever nothing is reported. */
  readonly events: readonly GameEvent[] | null;
}

/**
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
