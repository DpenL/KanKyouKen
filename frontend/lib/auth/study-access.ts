import { createClient } from "@/lib/supabase/server";

/** Role hierarchy understood by public.has_role_level: owner > supervisor > researcher > teacher. */
export type StudyRole = "teacher" | "researcher" | "supervisor" | "owner";

export type StudyAccess =
  | { ok: true; userId: string }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Authenticate the caller of a Server Action and check their role on a study.
 *
 * Server Actions are public HTTP endpoints: anyone who can reach the app can POST
 * to one with arguments of their choosing, whatever the UI would have sent. Any
 * action that goes on to use createServiceClient() (which bypasses RLS) must call
 * this first and return early when `ok` is false.
 *
 * The study id is an argument like any other, so it is validated here too. An
 * unknown study and a study the caller has no role on get the same answer.
 */
export async function requireStudyRole(
  studyId: unknown,
  minRole: StudyRole,
): Promise<StudyAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const denied = `You must be ${
    minRole === "owner" ? "the owner of" : `a ${minRole} or above on`
  } this study to do that.`;

  if (!isUuid(studyId)) return { ok: false, error: denied };

  const { data: permitted, error } = await supabase.rpc("has_role_level", {
    uid: user.id,
    stud_id: studyId,
    min_role: minRole,
  });
  if (error) console.error("has_role_level failed:", error);
  if (error || permitted !== true) return { ok: false, error: denied };

  return { ok: true, userId: user.id };
}
