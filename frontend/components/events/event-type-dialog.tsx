"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertEventType, type EventField, type FieldType, type EventTypeInput } from "@/app/(app)/events/actions";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "object", "array"];

interface EventTypeDialogProps {
  studyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provide when editing an existing event type */
  initial?: {
    name: string;
    description: string;
    fields: EventField[];
  };
}

function emptyField(): EventField {
  return { name: "", type: "string", required: false };
}

export function EventTypeDialog({
  studyId,
  open,
  onOpenChange,
  initial,
}: EventTypeDialogProps) {
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [fields, setFields] = useState<EventField[]>(
    initial?.fields.length ? initial.fields : [emptyField()]
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reset form when dialog opens fresh
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (!isEditing) {
        setName("");
        setDescription("");
        setFields([emptyField()]);
      }
      setError(null);
    }
    onOpenChange(isOpen);
  };

  const updateField = (index: number, patch: Partial<EventField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim().replace(/\s+/g, "_");
    if (!trimmedName) {
      setError("Event type name is required.");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(trimmedName)) {
      setError("Name must be lowercase letters, numbers, or underscores (e.g. answer_submitted).");
      return;
    }

    const validFields = fields.filter((f) => f.name.trim());
    const input: EventTypeInput = {
      name: trimmedName,
      description,
      fields: validFields,
    };

    setError(null);
    startTransition(async () => {
      try {
        await upsertEventType(studyId, input);
        handleOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save event type.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit event type" : "Add event type"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="event-type-name">
              Event type name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="event-type-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="answer_submitted"
              disabled={isEditing}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              snake_case identifier sent by the game client (e.g. kanji_presented)
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="event-type-desc">Description</Label>
            <Input
              id="event-type-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Learner submitted an answer"
            />
          </div>

          {/* Fields */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Payload fields</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFields((prev) => [...prev, emptyField()])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add field
              </Button>
            </div>

            {fields.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No fields defined — event will have no payload schema.
              </p>
            )}

            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    placeholder="field_name"
                    className="font-mono text-sm flex-1"
                  />
                  <Select
                    value={field.type}
                    onValueChange={(v) => updateField(i, { type: v as FieldType })}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`req-${i}`}
                      checked={field.required}
                      onCheckedChange={(checked) =>
                        updateField(i, { required: checked === true })
                      }
                    />
                    <Label htmlFor={`req-${i}`} className="text-xs cursor-pointer">
                      Req
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => removeField(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : isEditing ? "Save changes" : "Add event type"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
