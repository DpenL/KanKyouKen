"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createStudy(projectId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const name = (formData.get("name") as string).trim();

  const { data: study, error } = await supabase
    .from("studies")
    .insert({ name, project_id: projectId, owner_id: user.id })
    .select("id")
    .single();

  if (error || !study) {
    redirect(`/projects/${projectId}?error=` + encodeURIComponent(error?.message ?? "Failed to create study"));
  }

  // Grant the creator an explicit owner role so study_roles queries find this study
  await supabase.from("study_roles").insert({
    user_id: user.id,
    study_id: study.id,
    role: "owner",
    granted_by: user.id,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
}
