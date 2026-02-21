"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertEventType, type EventField, type FieldType } from "@/app/(app)/events/actions";

/**
 * CSV format — one row per field:
 *
 *   event_type,description,field_name,field_type,required
 *   answer_submitted,Learner answered,answer,string,true
 *   answer_submitted,Learner answered,correct,boolean,true
 *   kanji_presented,Kanji shown,kanji,string,true
 *   kanji_presented,Kanji shown,jlpt_level,number,false
 *
 * Event types with no fields — leave field columns empty:
 *   session_started,Session began,,,
 */

const VALID_TYPES = new Set(["string", "number", "boolean", "object", "array"]);

interface ImportRow {
  event_type: string;
  description: string;
  field_name: string;
  field_type: string;
  required: string;
}

function parseCSV(text: string): ImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const iET = col("event_type");
  const iDesc = col("description");
  const iFN = col("field_name");
  const iFT = col("field_type");
  const iReq = col("required");

  if (iET === -1) throw new Error('CSV must have an "event_type" column');

  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas
    const cols = splitCSVLine(line);
    return {
      event_type: (cols[iET] ?? "").trim(),
      description: iDesc >= 0 ? (cols[iDesc] ?? "").trim() : "",
      field_name: iFN >= 0 ? (cols[iFN] ?? "").trim() : "",
      field_type: iFT >= 0 ? (cols[iFT] ?? "").trim() : "",
      required: iReq >= 0 ? (cols[iReq] ?? "").trim() : "",
    };
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

interface GroupedEventType {
  name: string;
  description: string;
  fields: EventField[];
}

function groupRows(rows: ImportRow[]): GroupedEventType[] {
  const map = new Map<string, GroupedEventType>();

  for (const row of rows) {
    const name = row.event_type;
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) continue;

    if (!map.has(name)) {
      map.set(name, { name, description: row.description, fields: [] });
    }

    const entry = map.get(name)!;
    // First row per event type sets the description
    if (!entry.description && row.description) {
      entry.description = row.description;
    }

    const fieldName = row.field_name;
    const fieldType = row.field_type.toLowerCase() as FieldType;
    if (fieldName && VALID_TYPES.has(fieldType)) {
      entry.fields.push({
        name: fieldName,
        type: fieldType,
        required: row.required.toLowerCase() === "true",
      });
    }
  }

  return Array.from(map.values());
}

interface CsvImportButtonProps {
  studyId: string;
}

export function CsvImportButton({ studyId }: CsvImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isImporting, startImporting] = useTransition();

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      startImporting(async () => {
        try {
          const rows = parseCSV(text);
          const grouped = groupRows(rows);

          if (grouped.length === 0) {
            setStatus("No valid event types found in CSV.");
            return;
          }

          for (const et of grouped) {
            await upsertEventType(studyId, et);
          }

          setStatus(`Imported ${grouped.length} event type${grouped.length > 1 ? "s" : ""}.`);
          setTimeout(() => setStatus(null), 3000);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "Import failed.");
        }
      });
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleFile(file);
            e.target.value = "";
          }
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isImporting}
      >
        <Upload className="h-4 w-4 mr-1.5" />
        {isImporting ? "Importing…" : "Import CSV"}
      </Button>
      {status && <span className="text-xs text-muted-foreground">{status}</span>}
    </div>
  );
}
