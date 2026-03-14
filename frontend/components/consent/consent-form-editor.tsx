"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { saveConsentConfig } from "./actions";

interface Template {
  id: string;
  name: string;
  version: string;
  language: string;
  is_base: boolean;
}

interface ConsentConfig {
  base_template_id: string | null;
  custom_content_md: string | null;
  requires_scroll: boolean;
}

interface Props {
  studyId: string;
  templates: Template[];
  initialConfig: ConsentConfig | null;
}

export function ConsentFormEditor({ studyId, templates, initialConfig }: Props) {
  const [baseTemplateId, setBaseTemplateId] = useState(initialConfig?.base_template_id ?? "");
  const [customContent, setCustomContent] = useState(initialConfig?.custom_content_md ?? "");
  const [requiresScroll, setRequiresScroll] = useState(initialConfig?.requires_scroll ?? true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveConsentConfig(studyId, {
        base_template_id: baseTemplateId || null,
        custom_content_md: customContent || null,
        requires_scroll: requiresScroll,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  }

  const baseTemplates = templates.filter((t) => t.is_base);
  const selectedTemplate = templates.find((t) => t.id === baseTemplateId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Base template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="base-template">Platform consent template</Label>
            <select
              id="base-template"
              value={baseTemplateId}
              onChange={(e) => setBaseTemplateId(e.target.value)}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="">— No base template —</option>
              {baseTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} v{t.version} ({t.language})
                </option>
              ))}
            </select>
          </div>
          {selectedTemplate && (
            <p className="text-xs text-muted-foreground">
              Version {selectedTemplate.version} · {selectedTemplate.language}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Study-specific additions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="custom-content">
              Additional consent text (Markdown)
            </Label>
            <Textarea
              id="custom-content"
              value={customContent}
              onChange={(e) => setCustomContent(e.target.value)}
              placeholder="Describe any study-specific data collection, risks, or procedures…"
              rows={8}
              className="font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Checkbox
              id="requires-scroll"
              checked={requiresScroll}
              onCheckedChange={(v) => setRequiresScroll(Boolean(v))}
            />
            <Label htmlFor="requires-scroll" className="text-sm cursor-pointer">
              Require participants to scroll to the bottom before agreeing
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
