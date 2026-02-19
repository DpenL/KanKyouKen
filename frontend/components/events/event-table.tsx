"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { type Event } from "@/lib/api/events";
import { PayloadInspector } from "./payload-inspector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EventTableProps {
  events: Event[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function EventTable({
  events,
  loading,
  page,
  limit,
  total,
  onPageChange,
}: EventTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(total / limit);
  const from = page * limit + 1;
  const to = Math.min((page + 1) * limit, total);

  if (loading) return <EventTableSkeleton />;

  if (events.length === 0) {
    return (
      <div className="rounded-md border p-12 text-center text-sm text-muted-foreground">
        No events found. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Timestamp</TableHead>
              <TableHead>Event Type</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead>Platform</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const isExpanded = expanded.has(event.id);
              return (
                <>
                  <TableRow key={event.id} className="cursor-pointer" onClick={() => toggleRow(event.id)}>
                    <TableCell className="p-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm tabular-nums">
                          {format(new Date(event.ts), "yyyy-MM-dd HH:mm:ss")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.ts), { addSuffix: true })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {event.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.participant_id.substring(0, 8)}…
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {event.platform ?? "—"}
                    </TableCell>
                  </TableRow>

                  {isExpanded && (
                    <TableRow key={`${event.id}-expanded`}>
                      <TableCell colSpan={5} className="bg-muted/20 px-6 py-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Event ID: </span>
                              <code className="rounded bg-muted px-1">{event.id}</code>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Participant: </span>
                              <code className="rounded bg-muted px-1">{event.participant_id}</code>
                            </div>
                            {event.session_id && (
                              <div>
                                <span className="text-muted-foreground">Session: </span>
                                <code className="rounded bg-muted px-1">{event.session_id}</code>
                              </div>
                            )}
                            {event.app_version && (
                              <div>
                                <span className="text-muted-foreground">App version: </span>
                                <span>{event.app_version}</span>
                              </div>
                            )}
                          </div>
                          <PayloadInspector payload={event.payload} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? "No events" : `${from}–${to} of ${total.toLocaleString()} events`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventTableSkeleton() {
  return (
    <div className="rounded-md border p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
