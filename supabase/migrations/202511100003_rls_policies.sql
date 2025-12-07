-- Row-level-security policies and role placeholders

-- Enable RLS
alter table public.projects enable row level security;
alter table public.studies enable row level security;
alter table public.participants enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;
alter table public.audit_log enable row level security;
alter table public.event_schemas enable row level security;

-- === Ownership / role helpers ===
create or replace function public.is_owner(uid uuid, proj_id uuid)
returns boolean language sql stable as $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid);
$$;

-- === PROJECT POLICIES ===
create policy project_owner_read on public.projects
  for select using (auth.uid() = owner_id);
create policy project_owner_write on public.projects
  for insert with check (auth.uid() = owner_id);
create policy project_owner_update on public.projects
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- === STUDIES ===
create policy study_owner_all on public.studies
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- === PARTICIPANTS ===
create policy participants_owner_read on public.participants
  for select using (exists (
    select 1 from public.studies s
    join public.events e on e.study_id = s.id
    where e.participant_id = participants.id and s.owner_id = auth.uid()
  ));

-- === EVENTS ===
create policy events_owner_read on public.events
  for select using (exists (
    select 1 from public.studies s where s.id = events.study_id and s.owner_id = auth.uid()
  ));

-- Teachers/researchers placeholders (refine later)
create policy teacher_read_summary on public.events
  for select using (auth.role() = 'teacher');
create policy researcher_read_full on public.events
  for select using (auth.role() = 'researcher');

-- Prevent client direct inserts
revoke insert on public.events from anon, authenticated;
