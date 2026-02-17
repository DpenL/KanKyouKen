-- Study invite links: allow owners/supervisors to invite users to a study
-- even if the invitee has no account yet. Acceptance validates the token and
-- re-checks that the original inviter still holds a sufficient role.

create table public.study_invitations (
  id         uuid primary key default gen_random_uuid(),
  token      text unique not null default encode(gen_random_bytes(32), 'hex'),
  study_id   uuid not null references public.studies(id) on delete cascade,
  role       text not null check (role in ('researcher', 'supervisor', 'teacher')),
  invited_by uuid not null,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '7 days',
  used_by    uuid,
  used_at    timestamptz
);

-- All access goes through server-side actions using the service role key,
-- so no RLS policy is needed on this table.
