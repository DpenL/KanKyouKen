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

  const [
    { data: builtinScripts },
    { data: customScripts },
    { data: overrides },
  ] = await Promise.all([
    service
      .from("pipeline_scripts")
      .select("id, name, description, script_type, trigger_tables, writes_to_table, enabled")
      .is("study_id", null)
      .order("name"),
    service
      .from("pipeline_scripts")
      .select(
        "id, name, description, script_type, endpoint_url, trigger_tables, trigger_event_types, trigger_output_types, writes_to_table, output_type, config, enabled",
      )
      .eq("study_id", studyId)
      .order("name"),
    service.from("study_script_config").select("script_id, enabled").eq("study_id", studyId),
  ]);

  const overrideMap = Object.fromEntries(
    (overrides ?? []).map((o) => [o.script_id, o.enabled]),
  );

  const builtinWithState = (builtinScripts ?? []).map((s) => ({
    ...s,
    effectivelyEnabled: overrideMap[s.id] ?? s.enabled,
    hasOverride: s.id in overrideMap,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline Scripts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage analytics scripts for{" "}
          <span className="font-medium text-foreground">{study.name}</span>.
        </p>
      </div>

      <ScriptList
        studyId={studyId}
        builtinScripts={builtinWithState}
        customScripts={customScripts ?? []}
      />
    </div>
  );
}
