"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScriptFormDialog } from "./script-form-dialog";
import {
  setScriptEnabled,
  createScript,
  updateScript,
  deleteScript,
  type ScriptFormData,
} from "./actions";

interface BuiltinScript {
  id: string;
  name: string;
  description: string | null;
  script_type: string;
  trigger_tables: string[];
  writes_to_table: string;
  last_run_at: string | null;
  effectivelyEnabled: boolean;
  hasOverride: boolean;
}

interface CustomScript {
  id: string;
  name: string;
  description: string | null;
  script_type: string;
  endpoint_url: string;
  trigger_tables: string[];
  trigger_event_types: string[] | null;
  trigger_output_types: string[] | null;
  writes_to_table: string;
  output_type: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
}

interface Props {
  studyId: string;
  builtinScripts: BuiltinScript[];
  customScripts: CustomScript[];
}

export function ScriptList({ studyId, builtinScripts, customScripts: initialCustom }: Props) {
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>(
    Object.fromEntries(builtinScripts.map((s) => [s.id, s.effectivelyEnabled])),
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [customScripts, setCustomScripts] = useState<CustomScript[]>(initialCustom);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomScript | null>(null);
  const [_isPending, startTransition] = useTransition();

  function handleToggle(scriptId: string, enabled: boolean) {
    setToggleStates((prev) => ({ ...prev, [scriptId]: enabled }));
    setPending((prev) => ({ ...prev, [scriptId]: true }));
    startTransition(async () => {
      await setScriptEnabled(studyId, scriptId, enabled);
      setPending((prev) => ({ ...prev, [scriptId]: false }));
    });
  }

  async function handleCreate(data: ScriptFormData) {
    const result = await createScript(studyId, data);
    if (!result.error) {
      setCustomScripts((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
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
        },
      ]);
    }
    return result;
  }

  async function handleUpdate(scriptId: string, data: ScriptFormData) {
    const result = await updateScript(scriptId, data);
    if (!result.error) {
      setCustomScripts((prev) =>
        prev.map((s) =>
          s.id !== scriptId
            ? s
            : {
                ...s,
                name: data.name,
                description: data.description || null,
                script_type: data.scriptType,
                endpoint_url: data.endpointUrl,
                trigger_tables: data.triggerTables,
                trigger_event_types: data.triggerEventTypes.length ? data.triggerEventTypes : null,
                trigger_output_types: data.triggerOutputTypes.length
                  ? data.triggerOutputTypes
                  : null,
                writes_to_table: data.writesToTable,
                output_type: data.outputType || null,
                config: Object.keys(data.config).length ? data.config : null,
              },
        ),
      );
    }
    return result;
  }

  async function handleDelete(scriptId: string) {
    await deleteScript(scriptId);
    setCustomScripts((prev) => prev.filter((s) => s.id !== scriptId));
  }

  return (
    <div className="space-y-6">
      {/* Built-in scripts */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Built-in
        </h2>
        {builtinScripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No built-in scripts registered.</p>
        ) : (
          builtinScripts.map((script) => (
            <Card key={script.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{script.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {script.script_type}
                    </Badge>
                  </div>
                  {script.description && (
                    <p className="text-sm text-muted-foreground">{script.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Triggers on:{" "}
                    <span className="font-medium text-foreground">
                      {script.trigger_tables.join(", ")}
                    </span>
                    {" · "}Writes to:{" "}
                    <span className="font-medium text-foreground">{script.writes_to_table}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last run:{" "}
                    {script.last_run_at
                      ? new Date(script.last_run_at).toLocaleString()
                      : "Never"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Label htmlFor={`toggle-${script.id}`} className="sr-only">
                    {toggleStates[script.id] ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id={`toggle-${script.id}`}
                    checked={toggleStates[script.id]}
                    onCheckedChange={(v) => handleToggle(script.id, v)}
                    disabled={pending[script.id]}
                  />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Custom scripts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Custom (this study)
          </h2>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            + Add script
          </Button>
        </div>

        {customScripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom scripts yet. Add one to hook in your own analytics or ML endpoint.
          </p>
        ) : (
          customScripts.map((script) => (
            <Card key={script.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{script.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {script.script_type}
                    </Badge>
                  </div>
                  {script.description && (
                    <p className="text-sm text-muted-foreground">{script.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Triggers on:{" "}
                    <span className="font-medium text-foreground">
                      {script.trigger_tables.join(", ")}
                    </span>
                    {script.output_type && (
                      <>
                        {" · "}Output:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {script.output_type}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground truncate max-w-xs">
                    {script.endpoint_url}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(script)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(script.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <ScriptFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add custom script"
        onSubmit={handleCreate}
      />

      {editTarget && (
        <ScriptFormDialog
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          title="Edit script"
          initial={{
            name: editTarget.name,
            description: editTarget.description ?? "",
            scriptType: editTarget.script_type,
            endpointUrl: editTarget.endpoint_url,
            triggerTables: editTarget.trigger_tables,
            triggerEventTypes: editTarget.trigger_event_types ?? [],
            triggerOutputTypes: editTarget.trigger_output_types ?? [],
            writesToTable: editTarget.writes_to_table,
            outputType: editTarget.output_type ?? "",
            config: editTarget.config ?? {},
          }}
          onSubmit={(data) => handleUpdate(editTarget.id, data)}
        />
      )}
    </div>
  );
}
