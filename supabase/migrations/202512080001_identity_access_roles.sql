-- Role-based access control and consent management

create table public.study_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid references public.projects(id) on delete cascade,
  study_id uuid references public.studies(id) on delete cascade,
  role text not null check (role in ('owner', 'researcher', 'supervisor', 'teacher')),
  granted_by uuid not null,
  granted_at timestamptz default now(),

  constraint project_or_study_exclusive check (
    (project_id is not null and study_id is null) or
    (project_id is null and study_id is not null)
  ),
  constraint unique_user_project unique(user_id, project_id),
  constraint unique_user_study unique(user_id, study_id)
);

create index idx_study_roles_user on public.study_roles(user_id);
create index idx_study_roles_project on public.study_roles(project_id);
create index idx_study_roles_study on public.study_roles(study_id);
create index idx_study_roles_role on public.study_roles(role);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  consent_version text not null,
  consent_status text not null check (consent_status in ('pending', 'granted', 'withdrawn')),

  granted_at timestamptz,
  withdrawn_at timestamptz,
  consent_text text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint valid_granted_at check (consent_status != 'granted' or granted_at is not null),
  constraint valid_withdrawn_at check (consent_status != 'withdrawn' or withdrawn_at is not null)
);

create index idx_consent_participant on public.consent_records(participant_id);
create index idx_consent_study on public.consent_records(study_id);
create index idx_consent_status on public.consent_records(consent_status);
create index idx_consent_participant_study on public.consent_records(participant_id, study_id);

create or replace function public.sync_participant_consent()
returns trigger language plpgsql security definer as $$
begin
  update public.participants
  set
    consent_status = (new.consent_status = 'granted'),
    consent_timestamp = coalesce(new.granted_at, new.withdrawn_at, new.created_at)
  where id = new.participant_id;
  return new;
end;
$$;

create trigger sync_participant_consent_trigger
  after insert or update on public.consent_records
  for each row
  execute function public.sync_participant_consent();

alter table public.study_roles enable row level security;
alter table public.consent_records enable row level security;

create policy study_roles_self_read on public.study_roles
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.projects p
      where p.id = study_roles.project_id and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studies s
      where s.id = study_roles.study_id and s.owner_id = auth.uid()
    )
  );

create policy study_roles_owner_grant on public.study_roles
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = study_roles.project_id and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studies s
      where s.id = study_roles.study_id and s.owner_id = auth.uid()
    )
  );

create policy study_roles_owner_revoke on public.study_roles
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = study_roles.project_id and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studies s
      where s.id = study_roles.study_id and s.owner_id = auth.uid()
    )
  );

create policy consent_self_read on public.consent_records
  for select using (
    true
    or exists (
      select 1 from public.studies s
      where s.id = consent_records.study_id and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.study_roles sr
      where sr.study_id = consent_records.study_id
        and sr.user_id = auth.uid()
        and sr.role in ('researcher', 'supervisor')
    )
  );

create policy consent_system_insert on public.consent_records
  for insert with check (auth.role() = 'service_role');

create policy consent_withdraw on public.consent_records
  for update using (consent_status = 'granted')
  with check (consent_status = 'withdrawn');
