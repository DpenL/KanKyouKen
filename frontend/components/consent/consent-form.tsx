"use client";

import { useRef, useState, useEffect } from "react";
import { submitConsent } from "@/app/study/[studyId]/consent/actions";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ConsentFormProps {
  studyId: string;
  studyName: string;
  participantId: string;
  consentContent: string;
  consentVersion: string;
  requiresScroll: boolean;
  redirectUrl: string | null;
}

export function ConsentForm({
  studyId,
  studyName,
  participantId,
  consentContent,
  consentVersion,
  requiresScroll,
  redirectUrl,
}: ConsentFormProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(!requiresScroll);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!requiresScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
        setScrolled(true);
      }
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [requiresScroll]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const { error } = await submitConsent(participantId, studyId, consentVersion);
      if (error) {
        setError(error);
        return;
      }
      setDone(true);
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    } catch {
      setError("Failed to submit consent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done && !redirectUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Consent recorded</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Thank you. Your consent has been recorded and you may now proceed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{studyName}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Please read the following consent form carefully before participating.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          ref={scrollRef}
          data-testid="consent-scroll"
          className="max-h-96 overflow-y-auto rounded border bg-background p-4 text-sm leading-relaxed whitespace-pre-wrap"
        >
          {consentContent}
        </div>

        {requiresScroll && !scrolled && (
          <p className="text-xs text-muted-foreground">
            Please scroll to the bottom of the consent form before agreeing.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="agree"
            checked={agreed}
            onCheckedChange={(v) => setAgreed(Boolean(v))}
            disabled={!scrolled}
          />
          <Label htmlFor="agree" className="text-sm cursor-pointer select-none">
            I have read and agree to the terms above.
          </Label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>

      <CardFooter>
        <Button
          onClick={handleSubmit}
          disabled={!agreed || submitting}
          className="w-full"
        >
          {submitting ? "Submitting…" : "Submit consent"}
        </Button>
      </CardFooter>
    </Card>
  );
}
