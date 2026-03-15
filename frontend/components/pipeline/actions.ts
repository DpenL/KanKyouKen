"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

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

export async function createScript(
  studyId: string,
  data: ScriptFormData,
): Promise<{ error?: string }> {
  const service = createServiceClient();

  const { error } = await service.from("pipeline_scripts").insert({
    study_id: studyId,
    name: data.name,
    description: data.description || null,
    script_type: data.scriptType,
    endpoint_url: data.endpointUrl,
    trigger_tables: data.triggerTables,
    trigger_event_types: data.triggerEventTypes.length ? data.triggerEventTypes : null,
    trigger_output_types: data.triggerOutputTypes.length ? data.triggerOutputTypes : null,
    writes_to_table: data.writesToTable,
    output_type: data.outputType || null,
    config: Object.keys(data.config).length ? data.config : null,
    enabled: true,
  });

  if (error) {
    console.error("Failed to create script:", error);
    return { error: "Failed to create script. Please try again." };
  }

  revalidatePath("/projects/");
  return {};
}

export async function updateScript(
  scriptId: string,
  data: ScriptFormData,
): Promise<{ error?: string }> {
  const service = createServiceClient();

  const { error } = await service
    .from("pipeline_scripts")
    .update({
      name: data.name,
      description: data.description || null,
      script_type: data.scriptType,
      endpoint_url: data.endpointUrl,
      trigger_tables: data.triggerTables,
      trigger_event_types: data.triggerEventTypes.length ? data.triggerEventTypes : null,
      trigger_output_types: data.triggerOutputTypes.length ? data.triggerOutputTypes : null,
      writes_to_table: data.writesToTable,
      output_type: data.outputType || null,
      config: Object.keys(data.config).length ? data.config : null,
    })
    .eq("id", scriptId);

  if (error) {
    console.error("Failed to update script:", error);
    return { error: "Failed to update script. Please try again." };
  }

  revalidatePath("/projects/");
  return {};
}

export async function deleteScript(scriptId: string): Promise<{ error?: string }> {
  const service = createServiceClient();

  const { error } = await service
    .from("pipeline_scripts")
    .delete()
    .eq("id", scriptId);

  if (error) {
    console.error("Failed to delete script:", error);
    return { error: "Failed to delete script. Please try again." };
  }

  revalidatePath("/projects/");
  return {};
}

export async function setScriptEnabled(
  studyId: string,
  scriptId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const service = createServiceClient();

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
