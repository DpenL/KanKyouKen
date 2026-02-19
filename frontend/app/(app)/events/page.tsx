import { createClient } from "@/lib/supabase/server";
import { EventsContent } from "./events-content";

export interface StudyForEvents {
  id: string;
  name: string;
  project_id: string;
  projects: { name: string };
  role: string;
}

export default async function EventsPage() {
  const supabase = await createClient();

  // Fetch studies accessible via study_roles (RLS enforced), including the user's role
  const { data: rows } = await supabase
    .from("study_roles")
    .select("role, studies(id, name, project_id, projects(name))");

  const seen = new Set<string>();
  const studies: StudyForEvents[] = [];

  for (const row of rows ?? []) {
    const s = row.studies as unknown as Omit<StudyForEvents, "role"> | null;
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      studies.push({ ...s, role: row.role as string });
    }
  }

  studies.sort((a, b) => a.name.localeCompare(b.name));

  if (studies.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">No Studies Found</h2>
          <p className="text-muted-foreground">
            You don&apos;t have access to any studies yet.
          </p>
        </div>
      </div>
    );
  }

  return <EventsContent studies={studies} />;
}
