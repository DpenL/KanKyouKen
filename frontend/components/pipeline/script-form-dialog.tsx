"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ScriptFormData } from "./actions";

const TRIGGER_TABLE_OPTIONS = ["events", "script_outputs", "sessions"];
const WRITES_TO_OPTIONS = ["script_outputs", "study_metrics", "session_metrics"];
const SCRIPT_TYPE_OPTIONS = ["analytics", "ml", "visualization"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: Partial<ScriptFormData>;
  onSubmit: (data: ScriptFormData) => Promise<{ error?: string }>;
}

const DEFAULTS: ScriptFormData = {
  name: "",
  description: "",
  scriptType: "analytics",
  endpointUrl: "",
  triggerTables: ["events"],
  triggerEventTypes: [],
  triggerOutputTypes: [],
  writesToTable: "script_outputs",
  outputType: "",
  config: {},
};

export function ScriptFormDialog({ open, onOpenChange, title, initial, onSubmit }: Props) {
  const [form, setForm] = useState<ScriptFormData>({ ...DEFAULTS, ...initial });
  const [configText, setConfigText] = useState(
    initial?.config && Object.keys(initial.config).length
      ? JSON.stringify(initial.config, null, 2)
      : "",
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof ScriptFormData>(key: K, value: ScriptFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleTriggerTable(table: string) {
    set(
      "triggerTables",
      form.triggerTables.includes(table)
        ? form.triggerTables.filter((t) => t !== table)
        : [...form.triggerTables, table],
    );
  }

  function handleConfigChange(text: string) {
    setConfigText(text);
    if (!text.trim()) {
      setConfigError(null);
      set("config", {});
      return;
    }
    try {
      const parsed = JSON.parse(text);
      set("config", parsed);
      setConfigError(null);
    } catch {
      setConfigError("Invalid JSON");
    }
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.endpointUrl.trim()) {
      setError("Name and Endpoint URL are required.");
      return;
    }
    if (configError) return;
    setError(null);

    startTransition(async () => {
      const result = await onSubmit(form);
      if (result.error) {
        setError(result.error);
      } else {
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sf-name">Name</Label>
            <Input
              id="sf-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="participant-progress"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-description">Description</Label>
            <Input
              id="sf-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What does this script compute?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-type">Type</Label>
            <Select value={form.scriptType} onValueChange={(v) => set("scriptType", v)}>
              <SelectTrigger id="sf-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-url">Endpoint URL</Label>
            <Input
              id="sf-url"
              value={form.endpointUrl}
              onChange={(e) => set("endpointUrl", e.target.value)}
              placeholder="/functions/v1/my-script"
            />
            <p className="text-xs text-muted-foreground">
              Relative paths are resolved against your Supabase URL.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Trigger tables</Label>
            <div className="flex flex-wrap gap-2">
              {TRIGGER_TABLE_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTriggerTable(t)}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    form.triggerTables.includes(t)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-writes-to">Writes to</Label>
            <Select value={form.writesToTable} onValueChange={(v) => set("writesToTable", v)}>
              <SelectTrigger id="sf-writes-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WRITES_TO_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.writesToTable === "script_outputs" && (
            <div className="space-y-1.5">
              <Label htmlFor="sf-output-type">Output type</Label>
              <Input
                id="sf-output-type"
                value={form.outputType}
                onChange={(e) => set("outputType", e.target.value)}
                placeholder="participant_progress"
              />
              <p className="text-xs text-muted-foreground">
                Identifier used in <code className="font-mono">script_outputs.output_type</code>.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="sf-config">Config JSON (optional)</Label>
            <Textarea
              id="sf-config"
              value={configText}
              onChange={(e) => handleConfigChange(e.target.value)}
              placeholder='{ "threshold": 0.8 }'
              className="font-mono text-xs"
              rows={4}
            />
            {configError && (
              <p className="text-xs text-destructive">{configError}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !!configError}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
