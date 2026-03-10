"use client";

import { useState, useEffect, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { createClient } from "@/lib/supabase/client";
import { ParticipantTable, type ParticipantStat } from "./participant-table";
import { EventBrowser } from "./event-browser";

interface Props {
  studyId: string;
  participants: ParticipantStat[];
}

export function MonitorView({ studyId, participants: initialParticipants }: Props) {
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantStat[]>(initialParticipants);

  const refreshParticipants = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_study_participant_stats", { p_study_id: studyId });
    // Only update if the query succeeded — don't overwrite SSR data with an empty
    // result caused by a transient auth/network error during Realtime callback.
    if (!error) setParticipants((data as ParticipantStat[]) ?? []);
  }, [studyId]);

  // Realtime: refresh participant stats whenever a new event arrives for this study
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
        .channel(`monitor-participants:${studyId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "events", filter: `study_id=eq.${studyId}` },
          () => { refreshParticipants(); }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [studyId, refreshParticipants]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium mb-3">Participants</h2>
        <ParticipantTable
          initialData={participants}
          selectedParticipant={selectedParticipant}
          onSelectParticipant={setSelectedParticipant}
        />
      </div>

      <div>
        <h2 className="text-lg font-medium mb-3">Events</h2>
        <EventBrowser studyId={studyId} participantFilter={selectedParticipant} />
      </div>
    </div>
  );
}
