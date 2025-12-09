-- Role Helper Functions for RLS Policies
-- These functions make RLS policies more readable and maintainable
-- All functions are SECURITY DEFINER and STABLE for performance

-- === PROJECT ACCESS ===
-- Check if user has access to a project (as owner OR via study_roles)
create or replace function public.has_project_access(uid uuid, proj_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists(
    -- User is project owner
    select 1 from public.projects
    where id = proj_id and owner_id = uid
  ) or exists(
    -- User has a role in the project
    select 1 from public.study_roles
    where user_id = uid and project_id = proj_id
  );
$$;

-- === STUDY ACCESS ===
-- Check if user has access to a study (as owner OR via study_roles OR via project_roles)
create or replace function public.has_study_access(uid uuid, stud_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists(
    -- User is study owner
    select 1 from public.studies
    where id = stud_id and owner_id = uid
  ) or exists(
    -- User has a direct role in the study
    select 1 from public.study_roles
    where user_id = uid and study_id = stud_id
  ) or exists(
    -- User has a role in the parent project
    select 1 from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where s.id = stud_id and sr.user_id = uid
  );
$$;

-- === ROLE-SPECIFIC ACCESS ===
-- Check if user has a specific role in a study (directly OR via project)
create or replace function public.has_role_in_study(uid uuid, stud_id uuid, required_role text)
returns boolean
language sql
stable
security definer
as $$
  select exists(
    -- User has direct role in study
    select 1 from public.study_roles
    where user_id = uid and study_id = stud_id and role = required_role
  ) or exists(
    -- User has role in parent project
    select 1 from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where s.id = stud_id and sr.user_id = uid and sr.role = required_role
  );
$$;

-- Check if user has a specific role in a project
create or replace function public.has_role_in_project(uid uuid, proj_id uuid, required_role text)
returns boolean
language sql
stable
security definer
as $$
  select exists(
    select 1 from public.study_roles
    where user_id = uid and project_id = proj_id and role = required_role
  );
$$;

-- === QUERY HELPERS ===
-- Get all study IDs that a user has access to (useful for filtering queries)
-- Returns: array of study UUIDs
create or replace function public.get_accessible_study_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
as $$
  select array_agg(distinct study_id)
  from (
    -- Studies where user is owner
    select id as study_id from public.studies where owner_id = uid
    union
    -- Studies where user has direct role
    select study_id from public.study_roles where user_id = uid and study_id is not null
    union
    -- Studies in projects where user has project-level role
    select s.id as study_id
    from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where sr.user_id = uid
  ) accessible_studies
  where study_id is not null;
$$;

-- Get all project IDs that a user has access to
create or replace function public.get_accessible_project_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
as $$
  select array_agg(distinct project_id)
  from (
    -- Projects where user is owner
    select id as project_id from public.projects where owner_id = uid
    union
    -- Projects where user has role
    select project_id from public.study_roles where user_id = uid and project_id is not null
    union
    -- Projects containing studies where user has role
    select s.project_id
    from public.studies s
    join public.study_roles sr on sr.study_id = s.id
    where sr.user_id = uid
  ) accessible_projects
  where project_id is not null;
$$;

-- === ROLE HIERARCHY ===
-- Check if a user can perform an action based on role hierarchy
-- Hierarchy: owner > supervisor > researcher > teacher
-- Example: supervisor can do anything researcher can do
create or replace function public.has_role_level(uid uuid, stud_id uuid, min_role text)
returns boolean
language sql
stable
security definer
as $$
  -- Get user's highest role in study (directly or via project)
  with user_roles as (
    select sr.role
    from public.study_roles sr
    where sr.user_id = uid
      and (sr.study_id = stud_id
           or sr.project_id = (select project_id from public.studies where id = stud_id))
    union
    -- Study/project owners implicitly have 'owner' role
    select 'owner' as role
    from public.studies s
    where s.id = stud_id and s.owner_id = uid
    union
    select 'owner' as role
    from public.studies s
    join public.projects p on p.id = s.project_id
    where s.id = stud_id and p.owner_id = uid
  ),
  role_levels as (
    select 'owner' as role, 4 as level
    union all select 'supervisor', 3
    union all select 'researcher', 2
    union all select 'teacher', 1
  )
  select exists(
    select 1
    from user_roles ur
    join role_levels ur_level on ur_level.role = ur.role
    join role_levels min_level on min_level.role = min_role
    where ur_level.level >= min_level.level
  );
$$;

-- === AUDIT HELPER ===
-- Log role access for audit trail (called by RLS policies when access is granted)
create or replace function public.log_role_access(uid uuid, target_type text, target_id uuid, action text)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.audit_log (user_id, action, target, timestamp)
  values (uid, action, target_type || ':' || target_id::text, now());
end;
$$;

-- === COMMENTS FOR DOCUMENTATION ===
comment on function public.has_project_access is 'Check if user has access to project (owner or via role assignment)';
comment on function public.has_study_access is 'Check if user has access to study (owner, direct role, or project role)';
comment on function public.has_role_in_study is 'Check if user has specific role in study (directly or via project)';
comment on function public.has_role_in_project is 'Check if user has specific role in project';
comment on function public.get_accessible_study_ids is 'Get array of all study IDs user can access (for query filtering)';
comment on function public.get_accessible_project_ids is 'Get array of all project IDs user can access (for query filtering)';
comment on function public.has_role_level is 'Check if user meets minimum role level (respects hierarchy: owner > supervisor > researcher > teacher)';
comment on function public.log_role_access is 'Log access event to audit_log for compliance tracking';
