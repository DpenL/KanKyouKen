"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScriptOutputViewer } from "./script-output-viewer";

interface ScriptOutput {
  id: string;
  output_type: string;
  scope: string | null;
  scope_id: string | null;
  data: unknown;
  computed_at: string;
}

function upsertOutput(prev: ScriptOutput[], next: unknown): ScriptOutput[] {
  const incoming = next as ScriptOutput;
  const idx = prev.findIndex(
    (o) =>
      o.output_type === incoming.output_type &&
      o.scope === incoming.scope &&
      o.scope_id === incoming.scope_id,
  );
  if (idx === -1) return [...prev, incoming];
  const updated = [...prev];
  updated[idx] = incoming;
  return updated;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString();
}

export function ScriptOutputsPanel({
  studyId,
  initial,
}: {
  studyId: string;
  initial: ScriptOutput[];
}) {
  const [outputs, setOutputs] = useState<ScriptOutput[]>(initial);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`script-outputs-${studyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_outputs",
          filter: `study_id=eq.${studyId}`,
        },
        (payload) => {
          setOutputs((prev) => upsertOutput(prev, payload.new));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studyId, supabase]);

  if (outputs.length === 0) return null;

  return (
    <div className="grid gap-4">
      {outputs.map((output) => (
        <Card key={`${output.output_type}-${output.scope_id ?? "study"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{output.output_type}</CardTitle>
            <span className="text-xs text-muted-foreground">
              {output.scope}
              {output.scope_id ? ` · ${output.scope_id}` : ""}
              {" · "}
              {formatTime(output.computed_at)}
            </span>
          </CardHeader>
          <CardContent>
            <ScriptOutputViewer output={output} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
