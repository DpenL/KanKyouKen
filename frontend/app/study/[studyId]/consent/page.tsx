import { createServiceClient } from "@/lib/supabase/service";
import { ConsentForm } from "@/components/consent/consent-form";

interface Props {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ participant_id?: string; redirect?: string }>;
}

export default async function ParticipantConsentPage({ params, searchParams }: Props) {
  const { studyId } = await params;
  const { participant_id, redirect: redirectUrl } = await searchParams;

  const service = createServiceClient();

  const { data: study } = await service
    .from("studies")
    .select("id, name")
    .eq("id", studyId)
    .single();

  if (!study) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <p className="text-muted-foreground">Study not found.</p>
      </div>
    );
  }

  if (!participant_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <p className="text-muted-foreground">Invalid consent link — missing participant ID.</p>
      </div>
    );
  }

  // Load consent config + templates
  const { data: config } = await service
    .from("study_consent_config")
    .select("base_template_id, custom_content_md, requires_scroll")
    .eq("study_id", studyId)
    .maybeSingle();

  let baseContent: string | null = null;
  let consentVersion = "1.0";

  if (config?.base_template_id) {
    const { data: template } = await service
      .from("consent_templates")
      .select("content_md, version")
      .eq("id", config.base_template_id)
      .single();
    if (template) {
      baseContent = template.content_md;
      consentVersion = template.version;
    }
  }

  const combinedContent = [baseContent, config?.custom_content_md]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return (
    <div className="min-h-screen bg-muted/40 py-12 px-4">
      <div className="mx-auto max-w-2xl">
        <ConsentForm
          studyId={studyId}
          studyName={study.name}
          participantId={participant_id}
          consentContent={combinedContent || "No consent form has been configured for this study yet."}
          consentVersion={consentVersion}
          requiresScroll={config?.requires_scroll ?? true}
          redirectUrl={redirectUrl ?? null}
        />
      </div>
    </div>
  );
}
