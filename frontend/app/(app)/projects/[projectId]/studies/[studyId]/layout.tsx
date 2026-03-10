import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActiveTabLink } from "@/components/study/active-tab-link";

interface Props {
  children: React.ReactNode;
  params: Promise<{ projectId: string; studyId: string }>;
}

export default async function StudyLayout({ children, params }: Props) {
  const { projectId, studyId } = await params;
  const supabase = await createClient();

  const [{ data: study }, { data: project }] = await Promise.all([
    supabase
      .from("studies")
      .select("id, name, status, created_at")
      .eq("id", studyId)
      .eq("project_id", projectId)
      .single(),
    supabase.from("projects").select("id, name").eq("id", projectId).single(),
  ]);

  if (!study) notFound();

  return (
    <div className="space-y-6">
      {/* Breadcrumb + title */}
      <div>
        <nav className="text-sm text-muted-foreground mb-4 flex items-center gap-1">
          <Link href="/projects" className="hover:text-foreground transition-colors">
            Projects
          </Link>
          <span>/</span>
          <Link
            href={`/projects/${projectId}`}
            className="hover:text-foreground transition-colors"
          >
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

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b">
        <ActiveTabLink href={`/projects/${projectId}/studies/${studyId}`} exact>
          Overview
        </ActiveTabLink>
        <ActiveTabLink href={`/projects/${projectId}/studies/${studyId}/monitor`}>
          Monitoring
        </ActiveTabLink>
      </nav>

      {children}
    </div>
  );
}
