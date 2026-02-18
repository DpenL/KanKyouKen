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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();

  const { data: members } = await supabase
    .from("study_roles")
    .select("id, user_id, role, granted_at")
    .eq("study_id", studyId)
    .order("granted_at", { ascending: true });

  return (
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

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{study.name}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {study.status} · created {new Date(study.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
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
  );
}
