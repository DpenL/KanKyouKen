"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite } from "@/app/(app)/projects/[projectId]/studies/[studyId]/invites/actions";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const invite = formData.get("invite") as string | null;

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    const params = new URLSearchParams({ error: error.message });
    if (invite) params.set("invite", invite);
    redirect("/login?" + params.toString());
  }

  // If an invite token was carried through, accept it (redirects to the study)
  if (invite) await acceptInvite(invite);

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
