import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ScriptList } from "@/components/pipeline/script-list";

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
}

export default async function PipelineSettingsPage({ params }: Props) {
  const { projectId, studyId } = await params;
  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id, name")
    .eq("id", studyId)
    .eq("project_id", projectId)
    .single();

  if (!study) notFound();

  const service = createServiceClient();

  // Load global scripts (study_id IS NULL) — built-in scripts available to all studies
  const { data: scripts } = await service
    .from("pipeline_scripts")
    .select("id, name, description, script_type, trigger_tables, writes_to_table, enabled")
    .is("study_id", null)
    .order("name");

  // Load per-study overrides
  const { data: overrides } = await service
    .from("study_script_config")
    .select("script_id, enabled")
    .eq("study_id", studyId);

  const overrideMap = Object.fromEntries(
    (overrides ?? []).map((o) => [o.script_id, o.enabled]),
  );

  const scriptsWithState = (scripts ?? []).map((s) => ({
    ...s,
    // Per-study override takes precedence over the script's own enabled flag
    effectivelyEnabled: overrideMap[s.id] ?? s.enabled,
    hasOverride: s.id in overrideMap,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline Scripts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Built-in analytics scripts for{" "}
          <span className="font-medium text-foreground">{study.name}</span>.
          Disable a script to stop it from running when new events arrive.
        </p>
      </div>

      <ScriptList studyId={studyId} scripts={scriptsWithState} />
    </div>
  );
}
