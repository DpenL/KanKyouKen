"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvite } from "@/app/(app)/projects/[projectId]/studies/[studyId]/invites/actions";
import { INVITABLE_ROLES } from "@/lib/constants/roles";

interface Props {
  studyId: string;
  projectId: string;
}

type InvitableRole = typeof INVITABLE_ROLES[number]["value"];

export function GenerateInviteDialog({ studyId, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<InvitableRole>(INVITABLE_ROLES[0].value);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setError(null);
    setLink(null);
    const result = await createInvite(studyId, projectId, role);
    if ("error" in result) {
      setError(result.error);
    } else {
      setLink(result.url);
    }
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      setLink(null);
      setError(null);
      setCopied(false);
      setRole(INVITABLE_ROLES[0].value);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Invite member</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to study</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-2">
          <div className="grid gap-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as InvitableRole)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {link ? (
            <div className="grid gap-2">
              <Label>Invite link</Label>
              <div className="flex gap-2">
                <Input value={link} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Link expires in 7 days and can only be used once.</p>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleGenerate}>
                Generate link
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
