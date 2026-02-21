"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryEvents, type Event, type QueryEventsParams } from "@/lib/api/events";

interface ExportEventsProps {
  studyId: string;
  filters: QueryEventsParams;
}

type ExportFormat = "csv" | "json";

export function ExportEvents({ studyId, filters }: ExportEventsProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      // Fetch up to 10k events
      const response = await queryEvents({
        study_id: studyId,
        ...filters,
        limit: 10000,
        offset: 0,
      });

      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `events-${studyId.slice(0, 8)}-${timestamp}.${format}`;

      let content: string;
      let mimeType: string;

      if (format === "json") {
        content = JSON.stringify(response.events, null, 2);
        mimeType = "application/json";
      } else {
        content = eventsToCSV(response.events);
        mimeType = "text/csv";
      }

      downloadFile(content, filename, mimeType);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
        <SelectTrigger className="w-24 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="csv">CSV</SelectItem>
          <SelectItem value="json">JSON</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
        <Download className="h-4 w-4 mr-1.5" />
        {loading ? "Exporting…" : "Export"}
      </Button>
    </div>
  );
}

function eventsToCSV(events: Event[]): string {
  if (events.length === 0) return "";

  // Collect all payload keys across events
  const payloadKeys = new Set<string>();
  for (const event of events) {
    if (event.payload) {
      for (const key of Object.keys(event.payload)) {
        payloadKeys.add(key);
      }
    }
  }

  const coreColumns = ["id", "ts", "event_type", "participant_id", "session_id", "study_id", "app_version", "platform"];
  const payloadColumns = Array.from(payloadKeys).sort().map((k) => `payload.${k}`);
  const headers = [...coreColumns, ...payloadColumns];

  const rows = events.map((event) => {
    const core = [
      event.id,
      event.ts,
      event.event_type,
      event.participant_id,
      event.session_id ?? "",
      event.study_id,
      event.app_version ?? "",
      event.platform ?? "",
    ];
    const payload = Array.from(payloadKeys).sort().map((k) => {
      const val = event.payload?.[k];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
    return [...core, ...payload].map(csvEscape).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
