"use server";

import { createServiceClient } from "@/lib/supabase/service";

export async function setScriptEnabled(
  studyId: string,
  scriptId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const service = createServiceClient();

  const { error } = await service
    .from("study_script_config")
    .upsert({ study_id: studyId, script_id: scriptId, enabled }, {
      onConflict: "study_id,script_id",
    });

  if (error) {
    console.error("Failed to update script config:", error);
    return { error: "Failed to update. Please try again." };
  }

  return {};
}
