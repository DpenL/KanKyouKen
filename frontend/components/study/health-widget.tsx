"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface HealthResponse {
  status: "healthy" | "degraded" | "error";
  timestamp: string;
  checks: {
    database: { ok: boolean; latency_ms: number };
    events: { ok: boolean; count_24h: number; error_rate_24h: number };
  };
}

export function HealthWidget() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;

        const r = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/health`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } },
        );
        if (cancelled) return;
        if (!r.ok) throw new Error(`${r.status}`);
        const data: HealthResponse = await r.json();
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (failed) return null;

  if (!health) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }

  const healthy = health.status === "healthy";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Platform Health</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status</span>
          <Badge variant={healthy ? "default" : "destructive"}>{health.status}</Badge>
        </div>
        <div>
          <span className="text-muted-foreground">DB latency </span>
          <span className="tabular-nums">{health.checks.database.latency_ms} ms</span>
        </div>
        <div>
          <span className="text-muted-foreground">Events (24 h) </span>
          <span className="tabular-nums">{health.checks.events.count_24h.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Error rate </span>
          <span className="tabular-nums">
            {(health.checks.events.error_rate_24h * 100).toFixed(2)}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
