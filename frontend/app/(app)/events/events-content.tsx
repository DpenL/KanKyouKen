"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { StudySelector } from "@/components/events/study-selector";
import { EventTypeTable } from "@/components/events/event-type-table";
import { CsvImportButton } from "@/components/events/csv-import-button";
import { createClient } from "@/lib/supabase/client";
import type { StudyForEvents } from "./page";
import type { SchemaDefinition } from "./actions";

interface EventsContentProps {
  studies: StudyForEvents[];
}

const WRITE_ROLES = new Set(["owner", "supervisor"]);

export function EventsContent({ studies }: EventsContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedStudyId, setSelectedStudyId] = useState(
    searchParams.get("study_id") ?? studies[0].id
  );
  const [definition, setDefinition] = useState<SchemaDefinition | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedStudy = studies.find((s) => s.id === selectedStudyId) ?? studies[0];
  const canWrite = WRITE_ROLES.has(selectedStudy.role);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDefinition(null);

    const supabase = createClient();
    supabase
      .from("event_schemas")
      .select("definition")
      .eq("study_id", selectedStudyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setDefinition(data ? (data.definition as SchemaDefinition) : null);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [selectedStudyId]);

  const handleStudyChange = (studyId: string) => {
    setSelectedStudyId(studyId);
    router.replace(`/events?study_id=${studyId}`, { scroll: false });
  };

  const eventCount = definition ? Object.keys(definition.events).length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Event Types</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define the events your game client can send for each study.
          </p>
        </div>
        {canWrite && <CsvImportButton studyId={selectedStudyId} />}
      </div>

      <StudySelector
        studies={studies}
        selectedId={selectedStudyId}
        onSelect={handleStudyChange}
      />

      {!canWrite && (
        <p className="text-sm text-muted-foreground">
          Read-only — only owners and supervisors can edit event types.
        </p>
      )}

      <div className="text-sm text-muted-foreground">
        {loading
          ? "Loading…"
          : `${eventCount} event type${eventCount !== 1 ? "s" : ""} defined`}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-md border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <EventTypeTable
          studyId={selectedStudyId}
          definition={definition}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
