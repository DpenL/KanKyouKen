"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Check, X, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteEventType,
  upsertEventType,
  type EventField,
  type FieldType,
  type SchemaDefinition,
} from "@/app/(app)/events/actions";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "object", "array"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRows(definition: SchemaDefinition | null) {
  if (!definition) return [];
  return Object.entries(definition.events).map(([name, def]) => ({
    name,
    description: def.description ?? "",
    fields: Object.entries(def.payload_schema ?? {}).map(([fieldName, fieldType]) => ({
      name: fieldName,
      type: fieldType as FieldType,
      required: def.required?.includes(fieldName) ?? false,
    })),
  }));
}

function emptyField(): EventField {
  return { name: "", type: "string", required: false };
}

// ── Main table ────────────────────────────────────────────────────────────────

interface NewRow {
  name: string;
  description: string;
  fields: EventField[];
}

interface EventTypeTableProps {
  studyId: string;
  definition: SchemaDefinition | null;
  canWrite: boolean;
}

export function EventTypeTable({ studyId, definition, canWrite }: EventTypeTableProps) {
  const existingRows = parseRows(definition);
  const [newRows, setNewRows] = useState<NewRow[]>([]);

  const addRow = () =>
    setNewRows((prev) => [...prev, { name: "", description: "", fields: [] }]);

  const updateNewRow = (i: number, patch: Partial<NewRow>) =>
    setNewRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeNewRow = (i: number) =>
    setNewRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-52">Event type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-64">Fields</TableHead>
              {canWrite && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {existingRows.length === 0 && newRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canWrite ? 4 : 3}
                  className="text-center text-sm text-muted-foreground py-10"
                >
                  No event types defined yet.
                </TableCell>
              </TableRow>
            )}

            {existingRows.map((row) => (
              <ExistingRow
                key={row.name}
                studyId={studyId}
                row={row}
                canWrite={canWrite}
              />
            ))}

            {newRows.map((row, i) => (
              <NewRow
                key={`new-${i}`}
                studyId={studyId}
                row={row}
                onChange={(patch) => updateNewRow(i, patch)}
                onSaved={() => removeNewRow(i)}
                onCancel={() => removeNewRow(i)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {canWrite && (
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add row
        </Button>
      )}
    </div>
  );
}

// ── Existing row (display + inline desc edit + field expand) ─────────────────

interface ExistingRowProps {
  studyId: string;
  row: { name: string; description: string; fields: EventField[] };
  canWrite: boolean;
}

function ExistingRow({ studyId, row, canWrite }: ExistingRowProps) {
  const [desc, setDesc] = useState(row.description);
  const [editingFields, setEditingFields] = useState(false);
  const [editedFields, setEditedFields] = useState<EventField[]>(row.fields);
  const [isSaving, startSaving] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  const saveDesc = () => {
    if (desc === row.description) return;
    startSaving(async () => {
      await upsertEventType(studyId, { name: row.name, description: desc, fields: row.fields });
    });
  };

  const saveFields = () => {
    startSaving(async () => {
      await upsertEventType(studyId, { name: row.name, description: desc, fields: editedFields });
      setEditingFields(false);
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete event type "${row.name}"?`)) return;
    startDeleting(async () => {
      await deleteEventType(studyId, row.name);
    });
  };

  return (
    <>
      <TableRow className={isDeleting ? "opacity-50" : undefined}>
        <TableCell className="font-mono text-sm align-top py-3">{row.name}</TableCell>

        <TableCell className="align-top py-2">
          {canWrite ? (
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={saveDesc}
              className="h-7 text-sm border-transparent hover:border-input focus:border-input"
              placeholder="Description…"
              disabled={isSaving}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{row.description || "—"}</span>
          )}
        </TableCell>

        <TableCell className="align-top py-3">
          <div className="flex flex-wrap gap-1">
            {row.fields.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">No fields</span>
            ) : (
              row.fields.map((f) => (
                <span key={f.name} className="inline-flex items-baseline gap-0.5 text-xs">
                  <Badge variant="outline" className="font-mono py-0 px-1.5 text-xs">
                    {f.name}
                  </Badge>
                  <span className="text-muted-foreground">
                    {f.type}
                    {f.required && <span className="text-destructive">*</span>}
                  </span>
                </span>
              ))
            )}
          </div>
        </TableCell>

        {canWrite && (
          <TableCell className="align-top py-2">
            <div className="flex gap-1 justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setEditedFields(row.fields);
                  setEditingFields((v) => !v);
                }}
                title="Edit fields"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>

      {editingFields && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={canWrite ? 4 : 3} className="py-3 pl-6">
            <InlineFieldEditor fields={editedFields} onChange={setEditedFields} />
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="h-7 text-xs" onClick={saveFields} disabled={isSaving}>
                <Check className="h-3.5 w-3.5 mr-1" />
                {isSaving ? "Saving…" : "Save fields"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditingFields(false)}
              >
                Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── New row (fully inline) ────────────────────────────────────────────────────

interface NewRowProps {
  studyId: string;
  row: NewRow;
  onChange: (patch: Partial<NewRow>) => void;
  onSaved: () => void;
  onCancel: () => void;
}

function NewRow({ studyId, row, onChange, onSaved, onCancel }: NewRowProps) {
  const [fieldsExpanded, setFieldsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const handleSave = () => {
    const name = row.name.trim();
    if (!name) {
      setError("Name required");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      setError("Use snake_case (e.g. answer_submitted)");
      return;
    }
    setError(null);
    startSaving(async () => {
      try {
        await upsertEventType(studyId, row);
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <>
      <TableRow className="bg-primary/5 hover:bg-primary/5">
        <TableCell className="py-2 align-top">
          <Input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="event_type_name"
            className="h-7 font-mono text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") onCancel();
            }}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </TableCell>

        <TableCell className="py-2 align-top">
          <Input
            value={row.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Description…"
            className="h-7 text-sm"
          />
        </TableCell>

        <TableCell className="py-2 align-top">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setFieldsExpanded((v) => !v)}
            type="button"
          >
            {row.fields.length > 0
              ? `${row.fields.length} field${row.fields.length > 1 ? "s" : ""}`
              : "Add fields"}
            {fieldsExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        </TableCell>

        <TableCell className="py-2 align-top">
          <div className="flex gap-1 justify-end">
            <Button
              size="sm"
              className="h-7 px-2"
              onClick={handleSave}
              disabled={isSaving}
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onCancel}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {fieldsExpanded && (
        <TableRow className="bg-primary/5 hover:bg-primary/5">
          <TableCell colSpan={4} className="py-3 pl-6">
            <InlineFieldEditor
              fields={row.fields}
              onChange={(fields) => onChange({ fields })}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Shared inline field editor ────────────────────────────────────────────────

function InlineFieldEditor({
  fields,
  onChange,
}: {
  fields: EventField[];
  onChange: (fields: EventField[]) => void;
}) {
  const update = (i: number, patch: Partial<EventField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Payload fields</Label>

      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No fields — payload will be unstructured.</p>
      )}

      <div className="space-y-1.5">
        {fields.map((field, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={field.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="field_name"
              className="h-7 font-mono text-xs flex-1 max-w-48"
            />
            <Select
              value={field.type}
              onValueChange={(v) => update(i, { type: v as FieldType })}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Checkbox
                id={`ireq-${i}`}
                checked={field.required}
                onCheckedChange={(c) => update(i, { required: c === true })}
                className="h-3.5 w-3.5"
              />
              <Label htmlFor={`ireq-${i}`} className="text-xs cursor-pointer select-none">
                req
              </Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange([...fields, emptyField()])}
        type="button"
      >
        <Plus className="h-3 w-3 mr-1" />
        Add field
      </Button>
    </div>
  );
}
