import { createClient } from "@/lib/supabase/client";

export interface Event {
  id: string;
  participant_id: string;
  study_id: string;
  session_id?: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  ts: string;
  app_version?: string;
  platform?: string;
  item_id?: string;
  task_id?: string;
  schema_id?: string;
  created_at: string;
}

export interface QueryEventsParams {
  study_id?: string;
  project_id?: string;
  participant_id?: string;
  event_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface QueryEventsResponse {
  events: Event[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    returned: number;
  };
  filters: QueryEventsParams;
}

export async function queryEvents(
  params: QueryEventsParams
): Promise<QueryEventsResponse> {
  const supabase = createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) {
    throw new Error("Not authenticated");
  }

  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/query-events?${queryParams}`,
    {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to query events");
  }

  return response.json();
}

/** Fetch distinct event types for a study by sampling recent events. */
export async function getEventTypes(studyId: string): Promise<string[]> {
  const response = await queryEvents({ study_id: studyId, limit: 1000 });
  const unique = new Set(response.events.map((e) => e.event_type));
  return Array.from(unique).sort();
}
