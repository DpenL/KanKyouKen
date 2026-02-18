import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default async function ProjectsPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>

      {error && (
        <p className="mb-4 text-sm text-destructive">{decodeURIComponent(error)}</p>
      )}

      {!projects?.length ? (
        <p className="text-muted-foreground text-sm">No projects yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{project.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {project.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No description</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    {project.status} · {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
