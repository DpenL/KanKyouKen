import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataHealthPanel } from "@/components/study/data-health-panel";
import { MonitorView } from "@/components/study/monitor-view";
import type { ParticipantStat } from "@/components/study/participant-table";

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
}

export default async function MonitorPage({ params }: Props) {
  const { projectId, studyId } = await params;
  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id")
    .eq("id", studyId)
    .eq("project_id", projectId)
    .single();

  if (!study) notFound();

  const [{ data: participantStats }, { data: healthData }] = await Promise.all([
    supabase.rpc("get_study_participant_stats", { p_study_id: studyId }),
    // Health metrics: last event, today's count, 30-day average
    supabase
      .from("events")
      .select("ts")
      .eq("study_id", studyId)
      // eslint-disable-next-line react-hooks/purity
      .gte("ts", new Date(Date.now() - 30 * 24 * 3_600_000).toISOString())
      .order("ts", { ascending: false }),
  ]);

  const events = healthData ?? [];
  const lastEventAt = events[0]?.ts ?? null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const eventsToday = events.filter((e) => new Date(e.ts) >= todayStart).length;
  const avgEventsPerDay = events.length / 30;

  const participants = (participantStats as ParticipantStat[] | null) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium mb-3">Data Health</h2>
        <DataHealthPanel
          lastEventAt={lastEventAt}
          eventsToday={eventsToday}
          avgEventsPerDay={avgEventsPerDay}
          validPct={100}
        />
      </div>

      <MonitorView studyId={studyId} participants={participants} />
    </div>
  );
}
