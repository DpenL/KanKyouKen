"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PayloadInspectorProps {
  payload: Record<string, unknown> | null;
}

export function PayloadInspector({ payload }: PayloadInspectorProps) {
  const [copied, setCopied] = useState(false);

  if (!payload) {
    return <p className="text-sm text-muted-foreground italic">No payload</p>;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Payload
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
      <div className="font-mono text-xs">
        <JsonNode value={payload} depth={0} />
      </div>
    </div>
  );
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null) return <span className="text-gray-400">null</span>;
  if (value === undefined) return <span className="text-gray-400">undefined</span>;
  if (typeof value === "boolean") return <span className="text-purple-600">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-orange-600">{value}</span>;
  if (typeof value === "string") return <span className="text-green-700">&quot;{value}&quot;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
    return (
      <span>
        <button
          className="inline-flex items-center gap-0.5 hover:bg-muted rounded px-0.5"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">[{value.length}]</span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-border pl-2 mt-0.5 space-y-0.5">
            {value.map((item, i) => (
              <div key={i}>
                <span className="text-muted-foreground">{i}: </span>
                <JsonNode value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;
    return (
      <span>
        <button
          className="inline-flex items-center gap-0.5 hover:bg-muted rounded px-0.5"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">{"{…}"}</span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-border pl-2 mt-0.5 space-y-0.5">
            {entries.map(([k, v]) => (
              <div key={k}>
                <span className="text-blue-600">{k}</span>
                <span className="text-muted-foreground">: </span>
                <JsonNode value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}
