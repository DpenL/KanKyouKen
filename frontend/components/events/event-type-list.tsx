"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventTypeDialog } from "./event-type-dialog";
import {
  deleteEventType,
  type EventField,
  type FieldType,
  type SchemaDefinition,
} from "@/app/(app)/events/actions";

interface EventTypeListProps {
  studyId: string;
  definition: SchemaDefinition | null;
  canWrite: boolean;
}

export function EventTypeList({ studyId, definition, canWrite }: EventTypeListProps) {
  const events = definition?.events ?? {};
  const entries = Object.entries(events);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center">
        <p className="text-sm font-medium mb-1">No event types defined</p>
        <p className="text-sm text-muted-foreground">
          Add event types to document what your game client will send.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {entries.map(([typeName, typeDef]) => (
        <EventTypeCard
          key={typeName}
          studyId={studyId}
          typeName={typeName}
          typeDef={typeDef}
          canWrite={canWrite}
        />
      ))}
    </div>
  );
}

interface EventTypeCardProps {
  studyId: string;
  typeName: string;
  typeDef: SchemaDefinition["events"][string];
  canWrite: boolean;
}

function EventTypeCard({ studyId, typeName, typeDef, canWrite }: EventTypeCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const fields: EventField[] = Object.entries(typeDef.payload_schema ?? {}).map(
    ([fieldName, fieldType]) => ({
      name: fieldName,
      type: fieldType as FieldType,
      required: typeDef.required?.includes(fieldName) ?? false,
    })
  );

  const handleDelete = () => {
    if (!confirm(`Delete event type "${typeName}"?`)) return;
    startDelete(async () => {
      await deleteEventType(studyId, typeName);
    });
  };

  return (
    <>
      <Card className={isDeleting ? "opacity-50" : undefined}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="font-mono text-sm">{typeName}</CardTitle>
              {typeDef.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{typeDef.description}</p>
              )}
            </div>
            {canWrite && (
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setEditOpen(true)}
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
            )}
          </div>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No payload fields defined</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fields.map((field) => (
                <div key={field.name} className="flex items-center gap-1">
                  <Badge variant="outline" className="font-mono text-xs py-0">
                    {field.name}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{field.type}</span>
                  {field.required && (
                    <span className="text-xs text-destructive" title="required">*</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EventTypeDialog
        studyId={studyId}
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={{ name: typeName, description: typeDef.description ?? "", fields }}
      />
    </>
  );
}
