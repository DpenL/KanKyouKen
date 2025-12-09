-- Update RLS Policies to Support Role-Based Multi-User Access
-- Replaces owner-only policies with role-based access using study_roles
-- Maintains multi-tenant isolation while enabling team collaboration

-- === DROP OLD RESTRICTIVE POLICIES ===
drop policy if exists project_owner_read on public.projects;
drop policy if exists project_owner_write on public.projects;
drop policy if exists project_owner_update on public.projects;
drop policy if exists study_owner_all on public.studies;
drop policy if exists participants_owner_read on public.participants;
drop policy if exists events_owner_read on public.events;
drop policy if exists teacher_read_summary on public.events;
drop policy if exists researcher_read_full on public.events;

-- === PROJECTS: Read access for anyone with project role ===
create policy projects_role_read on public.projects
  for select using (
    public.has_project_access(auth.uid(), id)
  );

-- Only owners can create projects (owner_id must match auth.uid())
create policy projects_owner_create on public.projects
  for insert with check (auth.uid() = owner_id);

-- Only owners can update their projects
create policy projects_owner_update on public.projects
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Only owners can delete their projects
create policy projects_owner_delete on public.projects
  for delete using (auth.uid() = owner_id);

-- === STUDIES: Read access for anyone with study or project role ===
create policy studies_role_read on public.studies
  for select using (
    public.has_study_access(auth.uid(), id)
  );

-- Owners and supervisors can create studies in their projects
create policy studies_supervisor_create on public.studies
  for insert with check (
    -- Must be project owner
    exists (
      select 1 from public.projects
      where id = project_id and owner_id = auth.uid()
    )
    -- Or have supervisor role in project
    or public.has_role_in_project(auth.uid(), project_id, 'supervisor')
  );

-- Owners and supervisors can update studies
create policy studies_supervisor_update on public.studies
  for update using (
    auth.uid() = owner_id
    or public.has_role_level(auth.uid(), id, 'supervisor')
  );

-- Only study owners can delete studies
create policy studies_owner_delete on public.studies
  for delete using (auth.uid() = owner_id);

-- === PARTICIPANTS: Read access for researchers with study access ===
-- Participants are pseudonymized - researchers can see participants in their studies
create policy participants_researcher_read on public.participants
  for select using (
    exists (
      select 1 from public.events e
      where e.participant_id = participants.id
        and public.has_study_access(auth.uid(), e.study_id)
    )
  );

-- Service role can create participants (via edge functions)
create policy participants_service_create on public.participants
  for insert with check (auth.role() = 'service_role');

-- === SESSIONS: Read access for researchers with study access ===
create policy sessions_researcher_read on public.sessions
  for select using (
    public.has_study_access(auth.uid(), study_id)
  );

-- Service role can create sessions (via edge functions)
create policy sessions_service_create on public.sessions
  for insert with check (auth.role() = 'service_role');

-- === EVENTS: Read access for researchers with study access ===
-- Core data access policy - researchers can query events from their studies
create policy events_researcher_read on public.events
  for select using (
    public.has_study_access(auth.uid(), study_id)
  );

-- Service role can insert events (via edge functions)
-- Direct inserts by users are still blocked
create policy events_service_insert on public.events
  for insert with check (auth.role() = 'service_role');

-- === AUDIT_LOG: Only owners can read their project/study audit logs ===
create policy audit_owner_read on public.audit_log
  for select using (
    auth.uid() = user_id
    or exists (
      -- Parse target format "project:uuid" or "study:uuid"
      select 1 from public.projects p
      where 'project:' || p.id::text = target and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studies s
      where 'study:' || s.id::text = target and s.owner_id = auth.uid()
    )
  );

-- Service role can insert audit logs
create policy audit_service_insert on public.audit_log
  for insert with check (auth.role() = 'service_role');

-- === EVENT_SCHEMAS: Read access for anyone with study access ===
-- Schemas are shared across studies but filtered by study access
create policy event_schemas_researcher_read on public.event_schemas
  for select using (
    -- Anyone with access to at least one study can read schemas
    exists (
      select 1 from unnest(public.get_accessible_study_ids(auth.uid())) as study_id
    )
  );

-- Only owners and supervisors can create/update schemas
create policy event_schemas_supervisor_write on public.event_schemas
  for all using (
    -- Must have supervisor role in at least one project
    exists (
      select 1 from public.study_roles
      where user_id = auth.uid()
        and role in ('owner', 'supervisor')
    )
  );

-- === HELPER VIEWS FOR RESEARCHERS ===
-- Create a view that pre-filters events by user's accessible studies
-- Researchers can use this view instead of querying events table directly
create or replace view public.my_events as
  select e.*
  from public.events e
  where e.study_id = any(public.get_accessible_study_ids(auth.uid()));

comment on view public.my_events is 'Pre-filtered view of events accessible to current user';

-- View of studies accessible to current user
create or replace view public.my_studies as
  select s.*
  from public.studies s
  where public.has_study_access(auth.uid(), s.id);

comment on view public.my_studies is 'Studies accessible to current user (owner, direct role, or project role)';

-- View of projects accessible to current user
create or replace view public.my_projects as
  select p.*
  from public.projects p
  where public.has_project_access(auth.uid(), p.id);

comment on view public.my_projects is 'Projects accessible to current user (owner or role assignment)';

-- === GRANTS ===
-- Grant select on views to authenticated users
grant select on public.my_events to authenticated;
grant select on public.my_studies to authenticated;
grant select on public.my_projects to authenticated;
