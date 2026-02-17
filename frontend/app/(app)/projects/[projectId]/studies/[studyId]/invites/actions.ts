"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function createInvite(
  studyId: string,
  projectId: string,
  role: string
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify the caller has at least supervisor role in this study
  const { data: permitted } = await supabase.rpc("has_role_level", {
    uid: user.id,
    stud_id: studyId,
    min_role: "supervisor",
  });
  if (!permitted) return { error: "You must be a supervisor or owner to invite members" };

  const service = createServiceClient();
  const { data, error } = await service
    .from("study_invitations")
    .insert({ study_id: studyId, role, invited_by: user.id })
    .select("token")
    .single();

  if (error || !data) return { error: "Failed to create invitation" };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SUPABASE_URL!.replace("/rest/v1", "");
  return { url: `${origin}/invite/${data.token}` };
}

export async function acceptInvite(token: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?invite=${token}`);

  const service = createServiceClient();

  // Load and validate the invitation
  const { data: invite } = await service
    .from("study_invitations")
    .select("id, study_id, role, invited_by, expires_at, used_by")
    .eq("token", token)
    .single();

  if (!invite) redirect("/invite-error?reason=not_found");
  if (invite.used_by) redirect("/invite-error?reason=already_used");
  if (new Date(invite.expires_at) < new Date()) redirect("/invite-error?reason=expired");

  // Re-check that the original inviter still has sufficient authority
  const { data: inviterStillValid } = await service.rpc("has_role_level", {
    uid: invite.invited_by,
    stud_id: invite.study_id,
    min_role: "supervisor",
  });
  if (!inviterStillValid) redirect("/invite-error?reason=revoked");

  // Assign the role (service role bypasses RLS; granted_by preserves the inviter)
  const { error: insertError } = await service.from("study_roles").insert({
    user_id: user.id,
    study_id: invite.study_id,
    role: invite.role,
    granted_by: invite.invited_by,
  });

  if (insertError) {
    // Duplicate role assignment — user already has access, still redirect to study
    if (!insertError.message.includes("duplicate key")) {
      redirect("/invite-error?reason=server_error");
    }
  }

  // Mark token as used
  await service
    .from("study_invitations")
    .update({ used_by: user.id, used_at: new Date().toISOString() })
    .eq("token", token);

  // Look up project_id to build the redirect URL
  const { data: study } = await service
    .from("studies")
    .select("project_id")
    .eq("id", invite.study_id)
    .single();

  revalidatePath(`/projects/${study?.project_id}/studies/${invite.study_id}`);
  redirect(`/projects/${study?.project_id}/studies/${invite.study_id}`);
}
