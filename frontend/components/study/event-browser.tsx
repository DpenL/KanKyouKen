"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { createClient } from "@/lib/supabase/client";

interface EventRow {
  id: string;
  ts: string;
  participant_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
}

interface Props {
  studyId: string;
  participantFilter?: string | null;
}

const PAGE_SIZE = 50;

export function EventBrowser({ studyId, participantFilter }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("events")
      .select("id, ts, participant_id, event_type, payload", { count: "exact" })
      .eq("study_id", studyId)
      .order("ts", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (participantFilter) query = query.eq("participant_id", participantFilter);
    if (eventTypeFilter) query = query.ilike("event_type", `%${eventTypeFilter}%`);

    const { data, count } = await query;
    setEvents((data as EventRow[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [studyId, participantFilter, eventTypeFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEvents();
  }, [fetchEvents]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [participantFilter, eventTypeFilter]);

  // Realtime: refetch on new events (only when on first page to avoid confusing pagination)
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;
      channel = supabase
        .channel(`events:${studyId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "events", filter: `study_id=eq.${studyId}` },
          () => {
            if (page === 0) fetchEvents();
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [studyId, page, fetchEvents]);

  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="Filter by event type…"
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm w-56 bg-background"
        />
        {participantFilter && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            Participant: {participantFilter.slice(0, 8)}…
          </span>
        )}
        {loading && (
          <span className="text-xs text-muted-foreground ml-auto">Loading…</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Timestamp</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Participant</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Event Type</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">
                  No events found.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums text-xs">
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {e.participant_id ? e.participant_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{e.event_type}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {expandedId === e.id ? "▼" : "▶"}{" "}
                      {e.payload ? `${Object.keys(e.payload).length} fields` : "empty"}
                    </td>
                  </tr>
                  {expandedId === e.id && (
                    <tr key={`${e.id}-expanded`} className="border-b last:border-0">
                      <td colSpan={4} className="bg-muted/20 px-6 py-3">
                        <pre className="text-xs overflow-auto max-h-48">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-muted-foreground">
            {total === 0 ? "No events" : `${start}–${end} of ${total.toLocaleString()}`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-xs border rounded-md disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={end >= total}
              className="px-3 py-1 text-xs border rounded-md disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
