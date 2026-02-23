import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GenerateInviteDialog } from "@/components/generate-invite-dialog";

type ParticipantStat = {
  participant_id: string;
  pseudonym: string | null;
  event_count: number;
  last_event: string | null;
  is_active: boolean;
};

type EventBreakdown = {
  event_type: string;
  event_count: number;
  pct: number;
};

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default async function StudyPage({ params }: Props) {
  const { projectId, studyId } = await params;
  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id, name, status, created_at, project_id")
    .eq("id", studyId)
    .eq("project_id", projectId)
    .single();

  if (!study) notFound();

  const [
    { data: project },
    { count: eventCount },
    { data: firstEvent },
    { data: lastEvent },
    { data: participantStats },
    { data: eventBreakdown },
    { data: members },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).single(),
    supabase.from("events").select("*", { count: "exact", head: true }).eq("study_id", studyId),
    supabase.from("events").select("ts").eq("study_id", studyId).order("ts", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("events").select("ts").eq("study_id", studyId).order("ts", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("get_study_participant_stats", { p_study_id: studyId }),
    supabase.rpc("get_study_event_breakdown", { p_study_id: studyId }),
    supabase.from("study_roles").select("id, user_id, role, granted_at").eq("study_id", studyId).order("granted_at", { ascending: true }),
  ]);

  const stats = (participantStats as ParticipantStat[] | null) ?? [];
  const breakdown = (eventBreakdown as EventBreakdown[] | null) ?? [];

  // Derived monitoring metrics — all computed from data already fetched
  const participantCount = stats.length;

  const activeCount = stats.filter((p) => p.is_active).length;

  const medianEvents = median(stats.map((p) => Number(p.event_count)));

  const daySpan =
    firstEvent?.ts && lastEvent?.ts
      ? Math.max(1, (new Date(lastEvent.ts).getTime() - new Date(firstEvent.ts).getTime()) / 86_400_000)
      : null;
  const avgPerDay = daySpan && eventCount ? (eventCount / daySpan).toFixed(1) : null;

  return (
    <div className="space-y-8">
      {/* Header + breadcrumb */}
      <div>
        <nav className="text-sm text-muted-foreground mb-4 flex items-center gap-1">
          <Link href="/projects" className="hover:text-foreground transition-colors">Projects</Link>
          <span>/</span>
          <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors">
            {project?.name ?? projectId}
          </Link>
          <span>/</span>
          <span className="text-foreground">{study.name}</span>
        </nav>

        <h1 className="text-2xl font-semibold">{study.name}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {study.status} · created {new Date(study.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Monitoring overview — 4 population-level stats */}
      <div>
        <h2 className="text-lg font-medium mb-3">Overview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Total events</p>
            <p className="text-2xl font-semibold mt-1">{(eventCount ?? 0).toLocaleString()}</p>
            {firstEvent?.ts && (
              <p className="text-xs text-muted-foreground mt-0.5">
                since {new Date(firstEvent.ts).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Avg events / day</p>
            <p className="text-2xl font-semibold mt-1">{avgPerDay ?? "—"}</p>
            {lastEvent?.ts && (
              <p className="text-xs text-muted-foreground mt-0.5">
                last {new Date(lastEvent.ts).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Active last 7 days</p>
            <p className="text-2xl font-semibold mt-1">
              {participantCount > 0 ? `${activeCount} / ${participantCount}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">participants</p>
          </div>

          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Median events / participant</p>
            <p className="text-2xl font-semibold mt-1">
              {participantCount > 0 ? medianEvents.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">coverage proxy</p>
          </div>
        </div>
      </div>

      {/* Event type breakdown — what is being collected */}
      <div>
        <h2 className="text-lg font-medium mb-3">Event breakdown</h2>
        {breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data collected yet.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Event type</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Share</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.event_type} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{row.event_type}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {Number(row.event_count).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {Number(row.pct).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Members */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">Members</h2>
          <GenerateInviteDialog studyId={studyId} projectId={projectId} />
        </div>
        {!members?.length ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md border px-4 py-3 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">{m.user_id}</span>
                <span className="capitalize text-muted-foreground">{m.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
