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

  const { error } = await supabase.from("studies").insert({
    name,
    project_id: projectId,
    owner_id: user.id,
  });

  if (error) {
    redirect(`/projects/${projectId}?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
}
