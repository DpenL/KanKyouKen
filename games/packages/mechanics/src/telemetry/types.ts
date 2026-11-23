/**
 * Telemetry contracts. Mechanics and games describe what happened as `GameEvent`s and
 * hand them to an `EventSink`. Sinks decide where events go: memory (tests, replays),
 * the console, or the KanKyouKen event collector (`@kankyouken/web-kit/telemetry`).
 *
 * The event vocabulary is deliberately small and shaped for the analytics the platform
 * already has: every scored action carries `correct` and `response_time_ms`, and names
 * the learning item (the character) and the task (which mechanic / stage produced it).
 */

/** Event names emitted by the shared mechanics. Games may add their own. */
export type CoreEventType =
  | "session_start"
  | "session_end"
  | "item_start"
  | "item_complete"
  | "stage_enter"
  | "stroke_attempt"
  | "hint_shown"
  | "melody_listen"
  | "demo_watched"
  | "recall_result"
  | "timed_round_result"
  | "choice_attempt"
  | "review_scheduled";

export interface GameEvent {
  readonly type: CoreEventType | (string & {});
  /** Wall-clock time of the event, milliseconds since the Unix epoch. */
  readonly ts: number;
  /** Learning item, normally the character (maps to the collector's `item_id`). */
  readonly item?: string;
  /** Mechanic or stage that produced the event (maps to the collector's `task_id`). */
  readonly task?: string;
  /** Free-form details (maps to the collector's `payload`). Must be JSON-serializable. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface EventSink {
  record(event: GameEvent): void;
  /** Deliver anything buffered. Resolves when the sink has nothing left to send (or has given up). */
  flush?(): Promise<void>;
}

/** Payload of a `stroke_attempt` event. */
export interface StrokeAttemptData {
  readonly correct: boolean;
  /** Time from the previous accepted stroke (or item start) to the end of this attempt. */
  readonly response_time_ms: number;
  readonly verdict: "correct" | "wrong-direction" | "wrong-order" | "miss";
  readonly stroke_index: number;
  /** Reference stroke the drawing resembled most, if any. */
  readonly resembles: number | null;
  /** How many attempts this stroke has taken so far, including this one. */
  readonly attempt: number;
  /** How long the pen was down. */
  readonly draw_ms: number;
  readonly hint_level: number;
  /** Component the expected stroke belongs to, if any. */
  readonly component: string | null;
  readonly guide: string;
  readonly audio_mode: string;
}

/** Payload of a `recall_result` event. */
export interface RecallResultData {
  readonly correct: boolean;
  readonly response_time_ms: number;
  readonly stroke_count: number;
  readonly drawn_count: number;
  readonly order_correct: number;
  readonly direction_correct: number;
  readonly order_relative: number;
  readonly melody_listens: number;
  readonly audio_mode: string;
}

/** Payload of a `choice_attempt` event (picking or placing a component). */
export interface ChoiceAttemptData {
  readonly correct: boolean;
  readonly response_time_ms: number;
  /** What the right answer was. */
  readonly target: string;
  /** What the player chose. */
  readonly chosen: string;
  /** Everything that was on offer, in display order. */
  readonly options: readonly string[];
  /** Where in the character the choice belonged, if the task has slots. */
  readonly slot?: string;
  readonly attempt: number;
}

/** Static facts about the client, sent with every event. */
export interface ClientContext {
  /** Game id and version, e.g. "fude-uta/0.1.0". */
  readonly appVersion: string;
  /** e.g. "web". */
  readonly platform: string;
}

/** Who the events belong to on the KanKyouKen platform. */
export interface StudyContext {
  readonly studyId: string;
  readonly participantId: string;
  /** Platform session row id, when the host created one. */
  readonly sessionId?: string;
}

/** Request body of the platform's `POST /functions/v1/event-collector`. */
export interface CollectorBody {
  readonly participant_id: string;
  readonly study_id: string;
  readonly event_type: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly ts: string;
  readonly session_id?: string;
  readonly app_version?: string;
  readonly platform?: string;
  readonly item_id?: string;
  readonly task_id?: string;
}
