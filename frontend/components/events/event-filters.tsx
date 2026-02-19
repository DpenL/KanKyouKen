"use client";

import { useEffect, useState } from "react";
import { getEventTypes } from "@/lib/api/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

export interface Filters {
  event_type?: string;
  participant_id?: string;
  date_from?: string;
  date_to?: string;
}

interface EventFiltersProps {
  studyId: string;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export function EventFilters({ studyId, filters, onFiltersChange }: EventFiltersProps) {
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  // Local draft state so filters only apply on "Apply"
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    getEventTypes(studyId).then((types) => {
      if (!cancelled) setEventTypes(types);
    });
    return () => { cancelled = true; };
  }, [studyId]);

  const handleApply = () => onFiltersChange(draft);

  const handleReset = () => {
    const empty: Filters = {};
    setDraft(empty);
    onFiltersChange(empty);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Date from */}
          <div className="space-y-1">
            <Label htmlFor="date-from">From</Label>
            <Input
              id="date-from"
              type="datetime-local"
              value={draft.date_from ? toLocalInput(draft.date_from) : ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  date_from: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                }))
              }
            />
          </div>

          {/* Date to */}
          <div className="space-y-1">
            <Label htmlFor="date-to">To</Label>
            <Input
              id="date-to"
              type="datetime-local"
              value={draft.date_to ? toLocalInput(draft.date_to) : ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  date_to: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                }))
              }
            />
          </div>

          {/* Event type */}
          <div className="space-y-1">
            <Label htmlFor="event-type-filter">Event Type</Label>
            <Select
              value={draft.event_type ?? "all"}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, event_type: v === "all" ? undefined : v }))
              }
            >
              <SelectTrigger id="event-type-filter">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {eventTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Participant */}
          <div className="space-y-1">
            <Label htmlFor="participant-filter">Participant ID</Label>
            <Input
              id="participant-filter"
              placeholder="UUID or prefix…"
              value={draft.participant_id ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, participant_id: e.target.value || undefined }))
              }
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button onClick={handleApply} size="sm">
            Apply
          </Button>
          <Button onClick={handleReset} variant="outline" size="sm">
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:mm) */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
