"use server";

import { createServiceClient } from "@/lib/supabase/service";

interface ConsentConfigInput {
  base_template_id: string | null;
  custom_content_md: string | null;
  requires_scroll: boolean;
}

export async function saveConsentConfig(
  studyId: string,
  config: ConsentConfigInput,
): Promise<{ error?: string }> {
  const service = createServiceClient();

  const { error } = await service
    .from("study_consent_config")
    .upsert({ study_id: studyId, ...config, updated_at: new Date().toISOString() }, {
      onConflict: "study_id",
    });

  if (error) {
    console.error("Failed to save consent config:", error);
    return { error: "Failed to save. Please try again." };
  }

  return {};
}
