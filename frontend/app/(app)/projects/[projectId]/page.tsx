import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  const { data: studies } = await supabase
    .from("studies")
    .select("id, name, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        {project.description && (
          <p className="text-muted-foreground text-sm mt-1">{project.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {project.status} · created {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Studies</h2>
      </div>

      {!studies?.length ? (
        <p className="text-muted-foreground text-sm">No studies yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {studies.map((study) => (
            <div key={study.id} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <span className="font-medium">{study.name}</span>
              <span className="text-muted-foreground">{study.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
