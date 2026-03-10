import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GenerateInviteDialog } from "@/components/generate-invite-dialog";
import { LiveAnalytics } from "@/components/study/live-analytics";

type EventBreakdown = {
  event_type: string;
  event_count: number;
  pct: number;
};

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
}

export default async function StudyPage({ params }: Props) {
  const { projectId, studyId } = await params;
  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id")
    .eq("id", studyId)
    .eq("project_id", projectId)
    .single();

  if (!study) notFound();

  const [
    { data: studyMetrics },
    { data: eventBreakdown },
    { data: members },
  ] = await Promise.all([
    supabase.from("study_metrics").select("*").eq("study_id", studyId).maybeSingle(),
    supabase.rpc("get_study_event_breakdown", { p_study_id: studyId }),
    supabase.from("study_roles").select("id, user_id, role, granted_at").eq("study_id", studyId).order("granted_at", { ascending: true }),
  ]);

  const breakdown = (eventBreakdown as EventBreakdown[] | null) ?? [];

  return (
    <div className="space-y-8">
      {/* Live analytics — subscribes to study_metrics and script_outputs via Realtime */}
      <div>
        <h2 className="text-lg font-medium mb-3">Overview</h2>
        <LiveAnalytics studyId={studyId} initialMetrics={studyMetrics} />
      </div>

      {/* Event type breakdown */}
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
