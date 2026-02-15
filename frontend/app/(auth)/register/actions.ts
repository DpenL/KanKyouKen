"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function register(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect("/register?error=" + encodeURIComponent(error.message));
  }

  // Local Supabase auto-confirms emails, so we can go straight to dashboard
  redirect("/dashboard");
}
