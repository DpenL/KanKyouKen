"use client";

import dynamic from "next/dynamic";

// VegaLite uses canvas — must be loaded client-side only
const VegaLite = dynamic(() => import("react-vega").then((m) => m.VegaLite), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded bg-muted" />,
});

interface ScriptOutput {
  output_type: string;
  data: unknown;
}

interface Spec {
  $schema?: string;
  type?: string;
  data?: unknown;
  layout?: unknown;
}

export function ScriptOutputViewer({ output }: { output: ScriptOutput }) {
  const spec = output.data as Spec | null;

  if (!spec || typeof spec !== "object") {
    return <JsonViewer data={output.data} />;
  }

  if (typeof spec.$schema === "string" && spec.$schema.includes("vega-lite")) {
    return (
      <div className="overflow-x-auto">
        <VegaLite spec={spec as never} actions={false} />
      </div>
    );
  }

  return <JsonViewer data={spec} />;
}

function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="text-xs font-mono bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
