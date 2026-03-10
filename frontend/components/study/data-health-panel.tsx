interface Props {
  lastEventAt: string | null;
  eventsToday: number;
  avgEventsPerDay: number;
  validPct: number;
}

function healthStatus(lastEventAt: string | null): {
  label: string;
  color: string;
  indicator: string;
} {
  if (!lastEventAt) return { label: "No data", color: "text-muted-foreground", indicator: "○" };
  const diffHours = (Date.now() - new Date(lastEventAt).getTime()) / 3_600_000;
  if (diffHours > 24) return { label: "Stale", color: "text-destructive", indicator: "🔴" };
  if (diffHours > 1) return { label: "Warning", color: "text-yellow-600", indicator: "🟡" };
  return { label: "Healthy", color: "text-green-600", indicator: "🟢" };
}

function activityStatus(today: number, avg: number): { label: string; indicator: string } {
  if (avg === 0) return { label: "No baseline", indicator: "○" };
  if (today < avg * 0.5) return { label: "Low activity", indicator: "🟡" };
  if (today > avg * 1.2) return { label: "Above avg", indicator: "🟢" };
  return { label: "Normal", indicator: "🟢" };
}

export function DataHealthPanel({ lastEventAt, eventsToday, avgEventsPerDay, validPct }: Props) {
  const health = healthStatus(lastEventAt);
  const activity = activityStatus(eventsToday, avgEventsPerDay);

  const lastEventLabel = lastEventAt
    ? new Date(lastEventAt).toLocaleString()
    : "None";

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        title="Last Event"
        value={lastEventLabel}
        sub={`${health.indicator} ${health.label}`}
        subColor={health.color}
      />
      <StatCard
        title="Events Today"
        value={eventsToday.toLocaleString()}
        sub={`${activity.indicator} ${activity.label} (avg ${Math.round(avgEventsPerDay)})`}
        subColor="text-muted-foreground"
      />
      <StatCard
        title="Data Quality"
        value={`${validPct.toFixed(1)}%`}
        sub={validPct >= 95 ? "🟢 Good" : validPct >= 80 ? "🟡 Fair" : "🔴 Poor"}
        subColor={validPct >= 95 ? "text-green-600" : validPct >= 80 ? "text-yellow-600" : "text-destructive"}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
  subColor,
}: {
  title: string;
  value: string;
  sub: string;
  subColor: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground mb-1">{title}</p>
      <p className="text-sm font-medium truncate">{value}</p>
      <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>
    </div>
  );
}
