"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Study {
  id: string;
  name: string;
  projects: { name: string };
}

interface StudySelectorProps {
  studies: Study[];
  selectedId: string;
  onSelect: (studyId: string) => void;
}

export function StudySelector({ studies, selectedId, onSelect }: StudySelectorProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="study-select">Study</Label>
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger id="study-select" className="w-full">
          <SelectValue placeholder="Select a study" />
        </SelectTrigger>
        <SelectContent>
          {studies.map((study) => (
            <SelectItem key={study.id} value={study.id}>
              <span>{study.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                ({study.projects.name})
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
