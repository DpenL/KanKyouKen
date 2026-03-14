-- ============================================================
-- 002 · Access control
-- Roles, RLS policies, helper functions, audit triggers,
-- study invitations, and auto-owner trigger.
-- ============================================================

-- === STUDY ROLES ===
-- One row per (user, study) or (user, project) assignment.
-- 'participant' is a study-scoped role that routes to the consent form.
CREATE TABLE public.study_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  study_id   UUID REFERENCES public.studies(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'supervisor', 'researcher', 'teacher', 'participant')),
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT project_or_study_exclusive CHECK (
    (project_id IS NOT NULL AND study_id IS NULL) OR
    (project_id IS NULL AND study_id IS NOT NULL)
  ),
  CONSTRAINT unique_user_project UNIQUE (user_id, project_id),
  CONSTRAINT unique_user_study   UNIQUE (user_id, study_id)
);

CREATE INDEX idx_study_roles_user    ON public.study_roles(user_id);
CREATE INDEX idx_study_roles_project ON public.study_roles(project_id);
CREATE INDEX idx_study_roles_study   ON public.study_roles(study_id);
CREATE INDEX idx_study_roles_role    ON public.study_roles(role);

ALTER TABLE public.study_roles ENABLE ROW LEVEL SECURITY;

-- === CONSENT RECORDS ===
-- One record per participant per study (updated in-place on withdrawal).
CREATE TABLE public.consent_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  study_id         UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  consent_version  TEXT NOT NULL,
  consent_status   TEXT NOT NULL CHECK (consent_status IN ('pending', 'granted', 'withdrawn')),
  granted_at       TIMESTAMPTZ,
  withdrawn_at     TIMESTAMPTZ,
  consent_text     TEXT,
  metadata         JSONB DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT valid_granted_at   CHECK (consent_status != 'granted'    OR granted_at IS NOT NULL),
  CONSTRAINT valid_withdrawn_at CHECK (consent_status != 'withdrawn'  OR withdrawn_at IS NOT NULL),
  CONSTRAINT consent_records_participant_study_unique UNIQUE (participant_id, study_id)
);

CREATE INDEX idx_consent_participant       ON public.consent_records(participant_id);
CREATE INDEX idx_consent_study             ON public.consent_records(study_id);
CREATE INDEX idx_consent_status            ON public.consent_records(consent_status);
CREATE INDEX idx_consent_participant_study ON public.consent_records(participant_id, study_id);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- === STUDY INVITATIONS ===
-- Expiring single-use tokens that grant a role on acceptance.
-- All access goes through server-side actions using the service role key.
CREATE TABLE public.study_invitations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  study_id   UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'supervisor', 'researcher', 'teacher', 'participant')),
  invited_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '7 days',
  used_by    UUID,
  used_at    TIMESTAMPTZ
);

-- === HELPER FUNCTIONS ===

create or replace function public.is_owner(uid uuid, proj_id uuid)
returns boolean language sql stable as $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid);
$$;

create or replace function public.has_project_access(uid uuid, proj_id uuid)
returns boolean language sql stable security definer as $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid)
      or exists(select 1 from public.study_roles where user_id = uid and project_id = proj_id);
$$;

create or replace function public.has_study_access(uid uuid, stud_id uuid)
returns boolean language sql stable security definer as $$
  select exists(select 1 from public.studies where id = stud_id and owner_id = uid)
      or exists(select 1 from public.study_roles where user_id = uid and study_id = stud_id)
      or exists(
        select 1 from public.studies s
        join public.study_roles sr on sr.project_id = s.project_id
        where s.id = stud_id and sr.user_id = uid
      );
$$;

create or replace function public.has_role_in_study(uid uuid, stud_id uuid, required_role text)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.study_roles where user_id = uid and study_id = stud_id and role = required_role
  ) or exists(
    select 1 from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where s.id = stud_id and sr.user_id = uid and sr.role = required_role
  );
$$;

create or replace function public.has_role_in_project(uid uuid, proj_id uuid, required_role text)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.study_roles where user_id = uid and project_id = proj_id and role = required_role
  );
$$;

create or replace function public.get_accessible_study_ids(uid uuid)
returns uuid[] language sql stable security definer as $$
  select array_agg(distinct study_id)
  from (
    select id as study_id from public.studies where owner_id = uid
    union
    select study_id from public.study_roles where user_id = uid and study_id is not null
    union
    select s.id as study_id
    from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where sr.user_id = uid
  ) accessible_studies
  where study_id is not null;
$$;

create or replace function public.get_accessible_project_ids(uid uuid)
returns uuid[] language sql stable security definer as $$
  select array_agg(distinct project_id)
  from (
    select id as project_id from public.projects where owner_id = uid
    union
    select project_id from public.study_roles where user_id = uid and project_id is not null
    union
    select s.project_id
    from public.studies s
    join public.study_roles sr on sr.study_id = s.id
    where sr.user_id = uid
  ) accessible_projects
  where project_id is not null;
$$;

-- Role hierarchy: owner(4) > supervisor(3) > researcher(2) > teacher(1)
create or replace function public.has_role_level(uid uuid, stud_id uuid, min_role text)
returns boolean language sql stable security definer as $$
  with user_roles as (
    select sr.role
    from public.study_roles sr
    where sr.user_id = uid
      and (sr.study_id = stud_id
           or sr.project_id = (select project_id from public.studies where id = stud_id))
    union
    select 'owner' as role from public.studies where id = stud_id and owner_id = uid
    union
    select 'owner' as role
    from public.studies s
    join public.projects p on p.id = s.project_id
    where s.id = stud_id and p.owner_id = uid
  ),
  role_levels as (
    select 'owner'      as role, 4 as level union all
    select 'supervisor',          3          union all
    select 'researcher',          2          union all
    select 'teacher',             1
  )
  select exists(
    select 1
    from user_roles ur
    join role_levels ur_level  on ur_level.role  = ur.role
    join role_levels min_level on min_level.role = min_role
    where ur_level.level >= min_level.level
  );
$$;

create or replace function public.log_role_access(uid uuid, target_type text, target_id uuid, action text)
returns void language plpgsql security definer as $$
begin
  insert into public.audit_log (user_id, action, target, timestamp)
  values (uid, action, target_type || ':' || target_id::text, now());
end;
$$;

-- === AUDIT TRIGGER ===
-- SECURITY DEFINER so RLS on audit_log does not block inserts from authenticated sessions.
-- auth.uid() still resolves correctly across SECURITY DEFINER boundaries.
create or replace function public.audit_row()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid := auth.uid();
begin
  insert into public.audit_log(user_id, action, target)
  values (who, tg_op, tg_table_name);
  return new;
end;
$$;

CREATE TRIGGER trg_audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE TRIGGER trg_audit_studies
  AFTER INSERT OR UPDATE OR DELETE ON public.studies
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE TRIGGER trg_audit_participants
  AFTER INSERT OR UPDATE OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- === CONSENT SYNC TRIGGER ===
-- Keeps participants.consent_status in sync whenever a consent_record changes.
create or replace function public.sync_participant_consent()
returns trigger language plpgsql security definer as $$
begin
  update public.participants
  set
    consent_status    = (new.consent_status = 'granted'),
    consent_timestamp = coalesce(new.granted_at, new.withdrawn_at, new.created_at)
  where id = new.participant_id;
  return new;
end;
$$;

CREATE TRIGGER sync_participant_consent_trigger
  AFTER INSERT OR UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.sync_participant_consent();

-- === AUTO-OWNER TRIGGER ===
-- Grants the study creator an explicit 'owner' study_role on insert so that
-- study_roles-based queries (event schema page, member list) can find them.
create or replace function public.create_study_owner_role()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.study_roles (user_id, study_id, role, granted_by)
  values (new.owner_id, new.id, 'owner', new.owner_id);
  return new;
end;
$$;

CREATE TRIGGER study_owner_role_on_insert
  AFTER INSERT ON public.studies
  FOR EACH ROW EXECUTE FUNCTION public.create_study_owner_role();

-- === RLS POLICIES ===

-- Prevent direct client inserts on events (only service role via edge functions)
REVOKE INSERT ON public.events FROM anon, authenticated;

-- Projects
CREATE POLICY projects_role_read     ON public.projects FOR SELECT USING (public.has_project_access(auth.uid(), id));
CREATE POLICY projects_owner_create  ON public.projects FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY projects_owner_update  ON public.projects FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY projects_owner_delete  ON public.projects FOR DELETE USING (auth.uid() = owner_id);

-- Studies
CREATE POLICY studies_role_read          ON public.studies FOR SELECT USING (public.has_study_access(auth.uid(), id));
CREATE POLICY studies_supervisor_create  ON public.studies FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
  OR public.has_role_in_project(auth.uid(), project_id, 'supervisor')
);
CREATE POLICY studies_supervisor_update  ON public.studies FOR UPDATE USING (
  auth.uid() = owner_id OR public.has_role_level(auth.uid(), id, 'supervisor')
);
CREATE POLICY studies_owner_delete       ON public.studies FOR DELETE USING (auth.uid() = owner_id);

-- Participants (pseudonymized — only reachable via event linkage)
CREATE POLICY participants_researcher_read ON public.participants FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.participant_id = participants.id AND public.has_study_access(auth.uid(), e.study_id)
  )
);
CREATE POLICY participants_service_create ON public.participants FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Sessions
CREATE POLICY sessions_researcher_read  ON public.sessions FOR SELECT USING (public.has_study_access(auth.uid(), study_id));
CREATE POLICY sessions_service_create   ON public.sessions FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Events
CREATE POLICY events_researcher_read  ON public.events FOR SELECT USING (public.has_study_access(auth.uid(), study_id));
CREATE POLICY events_service_insert   ON public.events FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Audit log
CREATE POLICY audit_owner_read ON public.audit_log FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.projects p WHERE 'project:' || p.id::text = target AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.studies  s WHERE 'study:'   || s.id::text = target AND s.owner_id = auth.uid())
);
CREATE POLICY audit_service_insert ON public.audit_log FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Event schemas
CREATE POLICY event_schemas_researcher_read ON public.event_schemas FOR SELECT USING (
  EXISTS (SELECT 1 FROM unnest(public.get_accessible_study_ids(auth.uid())) AS study_id)
);
CREATE POLICY event_schemas_supervisor_write ON public.event_schemas FOR ALL USING (
  EXISTS (SELECT 1 FROM public.study_roles WHERE user_id = auth.uid() AND role IN ('owner', 'supervisor'))
);

-- Study roles
CREATE POLICY study_roles_self_read ON public.study_roles FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = study_roles.project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.studies  s WHERE s.id = study_roles.study_id  AND s.owner_id = auth.uid())
);
CREATE POLICY study_roles_owner_grant ON public.study_roles FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = study_roles.project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.studies s WHERE s.id = study_roles.study_id  AND s.owner_id = auth.uid())
);
CREATE POLICY study_roles_owner_revoke ON public.study_roles FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = study_roles.project_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.studies s WHERE s.id = study_roles.study_id  AND s.owner_id = auth.uid())
);

-- Consent records
CREATE POLICY consent_self_read ON public.consent_records FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.studies s WHERE s.id = consent_records.study_id AND s.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.study_roles sr
    WHERE sr.study_id = consent_records.study_id AND sr.user_id = auth.uid() AND sr.role IN ('researcher', 'supervisor')
  )
);
CREATE POLICY consent_system_insert ON public.consent_records FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY consent_withdraw      ON public.consent_records FOR UPDATE
  USING (consent_status = 'granted') WITH CHECK (consent_status = 'withdrawn');

-- === CONVENIENCE VIEWS ===
CREATE OR REPLACE VIEW public.my_events AS
  SELECT e.* FROM public.events e
  WHERE e.study_id = ANY(public.get_accessible_study_ids(auth.uid()));

CREATE OR REPLACE VIEW public.my_studies AS
  SELECT s.* FROM public.studies s
  WHERE public.has_study_access(auth.uid(), s.id);

CREATE OR REPLACE VIEW public.my_projects AS
  SELECT p.* FROM public.projects p
  WHERE public.has_project_access(auth.uid(), p.id);

GRANT SELECT ON public.my_events   TO authenticated;
GRANT SELECT ON public.my_studies  TO authenticated;
GRANT SELECT ON public.my_projects TO authenticated;

COMMENT ON FUNCTION public.has_project_access   IS 'Check if user has access to project (owner or via role assignment)';
COMMENT ON FUNCTION public.has_study_access     IS 'Check if user has access to study (owner, direct role, or project role)';
COMMENT ON FUNCTION public.has_role_in_study    IS 'Check if user has specific role in study (directly or via project)';
COMMENT ON FUNCTION public.has_role_in_project  IS 'Check if user has specific role in project';
COMMENT ON FUNCTION public.get_accessible_study_ids   IS 'Get array of all study IDs user can access (for query filtering)';
COMMENT ON FUNCTION public.get_accessible_project_ids IS 'Get array of all project IDs user can access (for query filtering)';
COMMENT ON FUNCTION public.has_role_level IS 'Check if user meets minimum role level (respects hierarchy: owner > supervisor > researcher > teacher)';
COMMENT ON FUNCTION public.log_role_access IS 'Log access event to audit_log for compliance tracking';
COMMENT ON VIEW public.my_events   IS 'Pre-filtered view of events accessible to current user';
COMMENT ON VIEW public.my_studies  IS 'Studies accessible to current user (owner, direct role, or project role)';
COMMENT ON VIEW public.my_projects IS 'Projects accessible to current user (owner or role assignment)';
