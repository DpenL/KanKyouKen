"use client";

import { useEffect, useRef } from "react";

interface ScriptOutput {
  output_type: string;
  data: unknown;
}

interface Spec {
  $schema?: string;
}

export function ScriptOutputViewer({ output }: { output: ScriptOutput }) {
  const spec = output.data as Spec | null;

  if (!spec || typeof spec !== "object") {
    return <JsonViewer data={output.data} />;
  }

  if (typeof spec.$schema === "string" && spec.$schema.includes("vega-lite")) {
    return <VegaLiteChart spec={spec} />;
  }

  return <JsonViewer data={spec} />;
}

function VegaLiteChart({ spec }: { spec: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    import("vega-embed").then(({ default: embed }) => {
      if (cancelled || !containerRef.current) return;
      embed(containerRef.current, spec as never, { actions: false });
    });

    return () => {
      cancelled = true;
      if (el) el.innerHTML = "";
    };
  }, [spec]);

  return <div ref={containerRef} className="overflow-x-auto min-h-10" />;
}

function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="text-xs font-mono bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
