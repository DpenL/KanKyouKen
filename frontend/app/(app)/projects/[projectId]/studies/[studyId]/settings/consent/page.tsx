import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ConsentFormEditor } from "@/components/consent/consent-form-editor";

interface Props {
  params: Promise<{ projectId: string; studyId: string }>;
}

export default async function ConsentSettingsPage({ params }: Props) {
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

  const [{ data: templates }, { data: config }] = await Promise.all([
    service.from("consent_templates").select("id, name, version, language, is_base").order("name"),
    service
      .from("study_consent_config")
      .select("base_template_id, custom_content_md, requires_scroll")
      .eq("study_id", studyId)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Consent Form</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the consent form participants see before joining{" "}
          <span className="font-medium text-foreground">{study.name}</span>.
        </p>
      </div>

      <ConsentFormEditor
        studyId={studyId}
        templates={templates ?? []}
        initialConfig={config ?? null}
      />

      <div className="rounded border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Participant link</p>
        <p>
          Share this URL with participants. They can consent without creating an account.
        </p>
        <code className="mt-2 block text-xs break-all">
          {process.env.NEXT_PUBLIC_APP_URL}/study/{studyId}/consent?participant_id=PARTICIPANT_ID
        </code>
      </div>
    </div>
  );
}
