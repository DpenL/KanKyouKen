import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GenerateInviteDialog } from "@/components/generate-invite-dialog";

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
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
    { data: participants },
    { data: members },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).single(),
    supabase.from("events").select("*", { count: "exact", head: true }).eq("study_id", studyId),
    supabase.from("events").select("ts").eq("study_id", studyId).order("ts", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("events").select("ts").eq("study_id", studyId).order("ts", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("get_study_participant_stats", { p_study_id: studyId }),
    supabase.from("study_roles").select("id, user_id, role, granted_at").eq("study_id", studyId).order("granted_at", { ascending: true }),
  ]);

  const participantCount = participants?.length ?? 0;

  return (
    <div className="space-y-8">
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

      {/* Overview stats */}
      <div>
        <h2 className="text-lg font-medium mb-3">Overview</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Total events</p>
            <p className="text-2xl font-semibold mt-1">{(eventCount ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Participants</p>
            <p className="text-2xl font-semibold mt-1">{participantCount.toLocaleString()}</p>
          </div>
          <div className="rounded-md border px-4 py-3">
            <p className="text-xs text-muted-foreground">Last event</p>
            <p className="text-lg font-semibold mt-1">
              {lastEvent?.ts
                ? new Date(lastEvent.ts).toLocaleDateString()
                : <span className="text-muted-foreground text-sm">—</span>}
            </p>
            {firstEvent?.ts && lastEvent?.ts && (
              <p className="text-xs text-muted-foreground mt-0.5">
                since {new Date(firstEvent.ts).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Participants */}
      <div>
        <h2 className="text-lg font-medium mb-3">Participants</h2>
        {!participants?.length ? (
          <p className="text-sm text-muted-foreground">No data collected yet.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Pseudonym</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Events</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Last active</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.participant_id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{p.pseudonym ?? p.participant_id}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(p.event_count).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {p.last_event ? new Date(p.last_event).toLocaleDateString() : "—"}
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
