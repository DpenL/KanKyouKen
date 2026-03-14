"use server";

import { createServiceClient } from "@/lib/supabase/service";

export async function submitConsent(
  participantId: string,
  studyId: string,
  consentVersion: string,
): Promise<{ error?: string }> {
  const service = createServiceClient();

  // Verify study exists
  const { data: study, error: studyErr } = await service
    .from("studies")
    .select("id")
    .eq("id", studyId)
    .single();

  if (studyErr || !study) {
    return { error: "Study not found" };
  }

  // Insert consent record
  const { error: insertErr } = await service.from("consent_records").insert({
    participant_id: participantId,
    study_id: studyId,
    consent_version: consentVersion,
    consent_status: "granted",
    granted_at: new Date().toISOString(),
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { error: "Consent already recorded for this participant and study" };
    }
    console.error("Failed to insert consent record:", insertErr);
    return { error: "Failed to submit consent. Please try again." };
  }

  // Audit log (best-effort, don't fail the request if this fails)
  await service.from("audit_log").insert({
    action: "consent_granted",
    target: `participant:${participantId}:study:${studyId}`,
  }).then(({ error }) => {
    if (error) console.error("Failed to write audit log:", error);
  });

  return {};
}
