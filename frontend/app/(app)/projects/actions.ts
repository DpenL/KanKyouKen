"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const name = (formData.get("name") as string).trim();
  const description = (formData.get("description") as string | null)?.trim() || null;

  const { error } = await supabase.from("projects").insert({
    name,
    description,
    owner_id: user.id,
  });

  if (error) {
    redirect("/projects?error=" + encodeURIComponent(error.message));
  }

  revalidatePath("/projects");
  revalidatePath("/dashboard");
}
