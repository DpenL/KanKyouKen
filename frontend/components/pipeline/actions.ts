"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid, requireStudyRole } from "@/lib/auth/study-access";
import { ENDPOINT_PATH_HINT, isValidEndpointPath } from "@/lib/pipeline/endpoint";

/*
 * Every action here writes with the service-role client, which bypasses RLS, so
 * each one authenticates the caller and checks their role on the target study
 * before it touches the database. Arguments are validated at runtime: the
 * TypeScript types describe what the UI sends, not what a caller can send.
 *
 * Global scripts (study_id IS NULL) are platform built-ins. They are registered
 * by migration and cannot be created, edited or deleted from here; a study can
 * only switch one on or off for itself via setScriptEnabled.
 */

export interface ScriptFormData {
  name: string;
  description: string;
  scriptType: string;
  endpointUrl: string;
  triggerTables: string[];
  triggerEventTypes: string[];
  triggerOutputTypes: string[];
  writesToTable: string;
  outputType: string;
  config: Record<string, unknown>;
}

const MANAGE_ROLE = "supervisor" as const;
const SCRIPT_TYPES = ["analytics", "ml", "visualization"];
const NOT_FOUND = "Script not found in this study.";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate untrusted form input and map it to pipeline_scripts columns. */
function toScriptRow(
  input: unknown,
): { row: Record<string, unknown> } | { error: string } {
  if (!isPlainObject(input)) return { error: "Invalid script data." };
  const data = input as Partial<ScriptFormData>;

  if (typeof data.name !== "string" || !data.name.trim()) {
    return { error: "Name is required." };
  }
  if (!isValidEndpointPath(data.endpointUrl)) {
    return { error: `Invalid endpoint URL. ${ENDPOINT_PATH_HINT}` };
  }
  if (typeof data.scriptType !== "string" || !SCRIPT_TYPES.includes(data.scriptType)) {
    return { error: "Invalid script type." };
  }
  if (!isStringArray(data.triggerTables) || data.triggerTables.length === 0) {
    return { error: "Select at least one trigger table." };
  }
  if (typeof data.writesToTable !== "string" || !data.writesToTable.trim()) {
    return { error: "Select the table this script writes to." };
  }

  const eventTypes = isStringArray(data.triggerEventTypes) ? data.triggerEventTypes : [];
  const outputTypes = isStringArray(data.triggerOutputTypes) ? data.triggerOutputTypes : [];
  const config = isPlainObject(data.config) ? data.config : {};

  return {
    row: {
      name: data.name.trim(),
      description: typeof data.description === "string" && data.description ? data.description : null,
      script_type: data.scriptType,
      endpoint_url: data.endpointUrl,
      trigger_tables: data.triggerTables,
      trigger_event_types: eventTypes.length ? eventTypes : null,
      trigger_output_types: outputTypes.length ? outputTypes : null,
      writes_to_table: data.writesToTable,
      output_type: typeof data.outputType === "string" && data.outputType ? data.outputType : null,
      config: Object.keys(config).length ? config : null,
    },
  };
}

export async function createScript(
  studyId: string,
  data: ScriptFormData,
): Promise<{ error?: string; id?: string }> {
  const access = await requireStudyRole(studyId, MANAGE_ROLE);
  if (!access.ok) return { error: access.error };

  const parsed = toScriptRow(data);
  if ("error" in parsed) return { error: parsed.error };

  const service = createServiceClient();

  const { data: created, error } = await service
    .from("pipeline_scripts")
    .insert({ ...parsed.row, study_id: studyId, enabled: true })
    .select("id")
    .single();

  if (error || !created) {
    console.error("Failed to create script:", error);
    return { error: "Failed to create script. Please try again." };
  }

  revalidatePath("/projects/");
  return { id: created.id };
}

export async function updateScript(
  studyId: string,
  scriptId: string,
  data: ScriptFormData,
): Promise<{ error?: string }> {
  const access = await requireStudyRole(studyId, MANAGE_ROLE);
  if (!access.ok) return { error: access.error };
  if (!isUuid(scriptId)) return { error: NOT_FOUND };

  const parsed = toScriptRow(data);
  if ("error" in parsed) return { error: parsed.error };

  const service = createServiceClient();

  // Scoped to the study the caller was authorised for. `study_id = <uuid>` never
  // matches a NULL study_id, so global built-ins are out of reach as well.
  const { data: updated, error } = await service
    .from("pipeline_scripts")
    .update(parsed.row)
    .eq("id", scriptId)
    .eq("study_id", studyId)
    .select("id");

  if (error) {
    console.error("Failed to update script:", error);
    return { error: "Failed to update script. Please try again." };
  }
  if (!updated?.length) return { error: NOT_FOUND };

  revalidatePath("/projects/");
  return {};
}

export async function deleteScript(
  studyId: string,
  scriptId: string,
): Promise<{ error?: string }> {
  const access = await requireStudyRole(studyId, MANAGE_ROLE);
  if (!access.ok) return { error: access.error };
  if (!isUuid(scriptId)) return { error: NOT_FOUND };

  const service = createServiceClient();

  const { data: deleted, error } = await service
    .from("pipeline_scripts")
    .delete()
    .eq("id", scriptId)
    .eq("study_id", studyId)
    .select("id");

  if (error) {
    console.error("Failed to delete script:", error);
    return { error: "Failed to delete script. Please try again." };
  }
  if (!deleted?.length) return { error: NOT_FOUND };

  revalidatePath("/projects/");
  return {};
}

export async function setScriptEnabled(
  studyId: string,
  scriptId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const access = await requireStudyRole(studyId, MANAGE_ROLE);
  if (!access.ok) return { error: access.error };
  if (!isUuid(scriptId) || typeof enabled !== "boolean") return { error: NOT_FOUND };

  const service = createServiceClient();

  // A study may override a global built-in or one of its own scripts, never a
  // script that belongs to another study.
  const { data: script, error: lookupError } = await service
    .from("pipeline_scripts")
    .select("id, study_id")
    .eq("id", scriptId)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to look up script:", lookupError);
    return { error: "Failed to update. Please try again." };
  }
  if (!script || (script.study_id !== null && script.study_id !== studyId.toLowerCase())) {
    return { error: NOT_FOUND };
  }

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
