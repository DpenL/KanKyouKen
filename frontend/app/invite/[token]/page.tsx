import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInvite } from "@/app/(app)/projects/[projectId]/studies/[studyId]/invites/actions";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  const service = createServiceClient();
  const { data: invite } = await service
    .from("study_invitations")
    .select("study_id, role, expires_at, used_by, studies(name)")
    .eq("token", token)
    .single();

  if (!invite) {
    return <InviteCard title="Invalid link" message="This invite link doesn't exist or has been removed." />;
  }
  if (invite.used_by) {
    return <InviteCard title="Link already used" message="This invite link has already been accepted." />;
  }
  if (new Date(invite.expires_at) < new Date()) {
    return <InviteCard title="Link expired" message="This invite link has expired. Ask the study owner for a new one." />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const studyName = (invite.studies as any)?.name || "a study";

  // Check if user is already logged in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const roleLabel = invite.role.charAt(0).toUpperCase() + invite.role.slice(1);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">You&apos;ve been invited</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Join <span className="font-medium text-foreground">{studyName}</span> as a{" "}
            <span className="font-medium text-foreground">{roleLabel}</span>.
          </p>

          {user ? (
            <form
              action={async () => {
                "use server";
                await acceptInvite(token);
              }}
            >
              <Button type="submit" className="w-full">
                Accept &amp; join
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href={`/register?invite=${token}`}>Create account to join</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/login?invite=${token}`}>Sign in to join</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InviteCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
