"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface EventField {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
}

export interface EventTypeInput {
  name: string; // snake_case event type key, e.g. "answer_submitted"
  description: string;
  fields: EventField[];
}

// The definition format stored in event_schemas.definition
export interface SchemaDefinition {
  version: string;
  events: Record<
    string,
    {
      description?: string;
      payload_schema: Record<string, FieldType>;
      required?: string[];
    }
  >;
}

async function getOrInitSchema(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studyId: string
): Promise<{ id: string | null; definition: SchemaDefinition }> {
  const { data } = await supabase
    .from("event_schemas")
    .select("id, definition")
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return { id: data.id as string, definition: data.definition as SchemaDefinition };
  }

  return {
    id: null,
    definition: { version: "1.0.0", events: {} },
  };
}

export async function upsertEventType(studyId: string, eventType: EventTypeInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id, definition } = await getOrInitSchema(supabase, studyId);

  // Build the payload_schema and required list from fields
  const payload_schema: Record<string, FieldType> = {};
  const required: string[] = [];
  for (const field of eventType.fields) {
    if (field.name.trim()) {
      payload_schema[field.name.trim()] = field.type;
      if (field.required) required.push(field.name.trim());
    }
  }

  definition.events[eventType.name] = {
    description: eventType.description || undefined,
    payload_schema,
    ...(required.length > 0 ? { required } : {}),
  };

  if (id) {
    const { error } = await supabase
      .from("event_schemas")
      .update({ definition })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("event_schemas").insert({
      study_id: studyId,
      version: "1.0.0",
      name: "Study Schema",
      definition,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/events");
}

export async function deleteEventType(studyId: string, eventTypeName: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id, definition } = await getOrInitSchema(supabase, studyId);
  if (!id) return;

  delete definition.events[eventTypeName];

  const { error } = await supabase
    .from("event_schemas")
    .update({ definition })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/events");
}
