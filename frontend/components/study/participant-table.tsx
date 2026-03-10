"use client";

import { useState } from "react";

export interface ParticipantStat {
  participant_id: string;
  pseudonym: string | null;
  event_count: number;
  last_event: string | null;
  is_active: boolean;
}

interface Props {
  initialData: ParticipantStat[];
  onSelectParticipant?: (id: string | null) => void;
  selectedParticipant?: string | null;
}

type SortKey = "last_event" | "event_count";
type FilterKey = "all" | "active" | "inactive";

function formatRelative(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ParticipantTable({ initialData, onSelectParticipant, selectedParticipant }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("last_event");

  const filtered = initialData
    .filter((p) =>
      filter === "all" ? true : filter === "active" ? p.is_active : !p.is_active,
    )
    .sort((a, b) => {
      if (sortBy === "last_event") {
        return (b.last_event ?? "").localeCompare(a.last_event ?? "");
      }
      return b.event_count - a.event_count;
    });

  const filterBtn = (key: FilterKey, label: string) => (
    <button
      onClick={() => setFilter(key)}
      className={`px-3 py-1 text-xs rounded-md border transition-colors ${
        filter === key
          ? "bg-foreground text-background border-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  const sortHeader = (key: SortKey, label: string) => (
    <th
      className="px-4 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
      onClick={() => setSortBy(key)}
    >
      {label} {sortBy === key ? "↓" : ""}
    </th>
  );

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {filterBtn("all", "All")}
        {filterBtn("active", "Active")}
        {filterBtn("inactive", "Inactive")}
        {selectedParticipant && (
          <button
            onClick={() => onSelectParticipant?.(null)}
            className="ml-auto px-3 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            Clear filter ✕
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No participants found.</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                  Participant
                </th>
                {sortHeader("event_count", "Events")}
                {sortHeader("last_event", "Last Active")}
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.participant_id}
                  className={`border-b last:border-0 cursor-pointer transition-colors ${
                    selectedParticipant === p.participant_id
                      ? "bg-muted/50"
                      : "hover:bg-muted/30"
                  }`}
                  onClick={() =>
                    onSelectParticipant?.(
                      selectedParticipant === p.participant_id ? null : p.participant_id,
                    )
                  }
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs">
                      {p.pseudonym ?? p.participant_id.slice(0, 8) + "…"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Number(p.event_count).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {formatRelative(p.last_event)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {p.is_active ? "🟢" : "🟡"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
