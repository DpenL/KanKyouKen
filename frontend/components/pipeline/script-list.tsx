"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { setScriptEnabled } from "./actions";

interface Script {
  id: string;
  name: string;
  description: string | null;
  script_type: string;
  trigger_tables: string[];
  writes_to_table: string;
  effectivelyEnabled: boolean;
  hasOverride: boolean;
}

interface Props {
  studyId: string;
  scripts: Script[];
}

export function ScriptList({ studyId, scripts }: Props) {
  const [states, setStates] = useState<Record<string, boolean>>(
    Object.fromEntries(scripts.map((s) => [s.id, s.effectivelyEnabled])),
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [_isPending, startTransition] = useTransition();

  function handleToggle(scriptId: string, enabled: boolean) {
    setStates((prev) => ({ ...prev, [scriptId]: enabled }));
    setPending((prev) => ({ ...prev, [scriptId]: true }));
    startTransition(async () => {
      await setScriptEnabled(studyId, scriptId, enabled);
      setPending((prev) => ({ ...prev, [scriptId]: false }));
    });
  }

  if (scripts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pipeline scripts are registered yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {scripts.map((script) => (
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
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor={`toggle-${script.id}`} className="text-xs text-muted-foreground sr-only">
                {states[script.id] ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id={`toggle-${script.id}`}
                checked={states[script.id]}
                onCheckedChange={(v) => handleToggle(script.id, v)}
                disabled={pending[script.id]}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
