"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { isUuid, requireStudyRole } from "@/lib/auth/study-access";

interface ConsentConfigInput {
  base_template_id: string | null;
  custom_content_md: string | null;
  requires_scroll: boolean;
}

export async function saveConsentConfig(
  studyId: string,
  config: ConsentConfigInput,
): Promise<{ error?: string }> {
  // The write below uses the service-role client (bypasses RLS), so the caller is
  // authenticated and checked against the study first. Same rule as the
  // study_consent_config_write policy: owners and supervisors only.
  const access = await requireStudyRole(studyId, "supervisor");
  if (!access.ok) return { error: access.error };

  // Arguments are untrusted. Read the three known fields one by one rather than
  // spreading `config` into the row: a spread would let the caller supply its own
  // study_id and write to a study it was not authorised for.
  const input = (typeof config === "object" && config !== null ? config : {}) as Partial<ConsentConfigInput>;
  const baseTemplateId = input.base_template_id ?? null;
  const customContent = input.custom_content_md ?? null;

  if (baseTemplateId !== null && !isUuid(baseTemplateId)) {
    return { error: "Invalid consent template." };
  }
  if (customContent !== null && typeof customContent !== "string") {
    return { error: "Invalid consent text." };
  }
  if (typeof input.requires_scroll !== "boolean") {
    return { error: "Invalid consent settings." };
  }

  const service = createServiceClient();

  const { error } = await service
    .from("study_consent_config")
    .upsert(
      {
        study_id: studyId,
        base_template_id: baseTemplateId,
        custom_content_md: customContent,
        requires_scroll: input.requires_scroll,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "study_id" },
    );

  if (error) {
    console.error("Failed to save consent config:", error);
    return { error: "Failed to save. Please try again." };
  }

  return {};
}
