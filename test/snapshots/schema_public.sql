--
-- PostgreSQL database dump
--

\restrict Rh9AI5L9tRaLMph4NHxOyrIZghVEyEBey4BimdHDdgjVWcyazy76AVXgA23iV2h

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: audit_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  who uuid := auth.uid();
begin
  insert into public.audit_log(user_id, action, target)
  values (who, tg_op, tg_table_name);
  return new;
end;
$$;


--
-- Name: create_study_owner_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_study_owner_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.study_roles (user_id, study_id, role, granted_by)
  values (new.owner_id, new.id, 'owner', new.owner_id);
  return new;
end;
$$;


--
-- Name: get_accessible_project_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_accessible_project_ids(uid uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
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


--
-- Name: FUNCTION get_accessible_project_ids(uid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_accessible_project_ids(uid uuid) IS 'Get array of all project IDs user can access (for query filtering)';


--
-- Name: get_accessible_study_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_accessible_study_ids(uid uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
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


--
-- Name: FUNCTION get_accessible_study_ids(uid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_accessible_study_ids(uid uuid) IS 'Get array of all study IDs user can access (for query filtering)';


--
-- Name: get_study_event_breakdown(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_study_event_breakdown(p_study_id uuid) RETURNS TABLE(event_type text, event_count bigint, pct numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    event_type,
    COUNT(*)                                                          as event_count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1)   as pct
  from events
  where study_id = p_study_id
  group by event_type
  order by event_count desc;
$$;


--
-- Name: get_study_participant_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_study_participant_stats(p_study_id uuid) RETURNS TABLE(participant_id uuid, pseudonym text, event_count bigint, last_event timestamp with time zone, is_active boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    p.id                                        as participant_id,
    p.pseudonym,
    COUNT(e.id)                                 as event_count,
    MAX(e.ts)                                   as last_event,
    MAX(e.ts) > now() - interval '7 days'       as is_active
  from events e
  join participants p on p.id = e.participant_id
  where e.study_id = p_study_id
  group by p.id, p.pseudonym
  order by MAX(e.ts) desc nulls last;
$$;


--
-- Name: has_project_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_project_access(uid uuid, proj_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid)
      or exists(select 1 from public.study_roles where user_id = uid and project_id = proj_id);
$$;


--
-- Name: FUNCTION has_project_access(uid uuid, proj_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_project_access(uid uuid, proj_id uuid) IS 'Check if user has access to project (owner or via role assignment)';


--
-- Name: has_role_in_project(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role_in_project(uid uuid, proj_id uuid, required_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists(
    select 1 from public.study_roles where user_id = uid and project_id = proj_id and role = required_role
  );
$$;


--
-- Name: FUNCTION has_role_in_project(uid uuid, proj_id uuid, required_role text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_role_in_project(uid uuid, proj_id uuid, required_role text) IS 'Check if user has specific role in project';


--
-- Name: has_role_in_study(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role_in_study(uid uuid, stud_id uuid, required_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists(
    select 1 from public.study_roles where user_id = uid and study_id = stud_id and role = required_role
  ) or exists(
    select 1 from public.studies s
    join public.study_roles sr on sr.project_id = s.project_id
    where s.id = stud_id and sr.user_id = uid and sr.role = required_role
  );
$$;


--
-- Name: FUNCTION has_role_in_study(uid uuid, stud_id uuid, required_role text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_role_in_study(uid uuid, stud_id uuid, required_role text) IS 'Check if user has specific role in study (directly or via project)';


--
-- Name: has_role_level(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role_level(uid uuid, stud_id uuid, min_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
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


--
-- Name: FUNCTION has_role_level(uid uuid, stud_id uuid, min_role text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_role_level(uid uuid, stud_id uuid, min_role text) IS 'Check if user meets minimum role level (respects hierarchy: owner > supervisor > researcher > teacher)';


--
-- Name: has_study_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_study_access(uid uuid, stud_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists(select 1 from public.studies where id = stud_id and owner_id = uid)
      or exists(select 1 from public.study_roles where user_id = uid and study_id = stud_id)
      or exists(
        select 1 from public.studies s
        join public.study_roles sr on sr.project_id = s.project_id
        where s.id = stud_id and sr.user_id = uid
      );
$$;


--
-- Name: FUNCTION has_study_access(uid uuid, stud_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_study_access(uid uuid, stud_id uuid) IS 'Check if user has access to study (owner, direct role, or project role)';


--
-- Name: is_owner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner(uid uuid, proj_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid);
$$;


--
-- Name: log_role_access(uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_role_access(uid uuid, target_type text, target_id uuid, action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into public.audit_log (user_id, action, target, timestamp)
  values (uid, action, target_type || ':' || target_id::text, now());
end;
$$;


--
-- Name: FUNCTION log_role_access(uid uuid, target_type text, target_id uuid, action text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_role_access(uid uuid, target_type text, target_id uuid, action text) IS 'Log access event to audit_log for compliance tracking';


--
-- Name: sync_participant_consent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_participant_consent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update public.participants
  set
    consent_status    = (new.consent_status = 'granted'),
    consent_timestamp = coalesce(new.granted_at, new.withdrawn_at, new.created_at)
  where id = new.participant_id;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id uuid,
    action text,
    target text,
    "timestamp" timestamp with time zone DEFAULT now()
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid NOT NULL,
    study_id uuid NOT NULL,
    consent_version text NOT NULL,
    consent_status text NOT NULL,
    granted_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    consent_text text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT consent_records_consent_status_check CHECK ((consent_status = ANY (ARRAY['pending'::text, 'granted'::text, 'withdrawn'::text]))),
    CONSTRAINT valid_granted_at CHECK (((consent_status <> 'granted'::text) OR (granted_at IS NOT NULL))),
    CONSTRAINT valid_withdrawn_at CHECK (((consent_status <> 'withdrawn'::text) OR (withdrawn_at IS NOT NULL)))
);


--
-- Name: consent_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    content_md text NOT NULL,
    version text NOT NULL,
    is_base boolean DEFAULT false,
    language text DEFAULT 'en'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: event_schemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid,
    version text NOT NULL,
    name text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid,
    study_id uuid,
    session_id uuid,
    event_type text NOT NULL,
    payload jsonb,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    app_version text,
    platform text,
    item_id text,
    task_id text,
    created_at timestamp with time zone DEFAULT now(),
    schema_id uuid
);


--
-- Name: my_events; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.my_events AS
 SELECT id,
    participant_id,
    study_id,
    session_id,
    event_type,
    payload,
    ts,
    app_version,
    platform,
    item_id,
    task_id,
    created_at,
    schema_id
   FROM public.events e
  WHERE (study_id = ANY (public.get_accessible_study_ids(auth.uid())));


--
-- Name: VIEW my_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.my_events IS 'Pre-filtered view of events accessible to current user';


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: my_projects; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.my_projects AS
 SELECT id,
    owner_id,
    name,
    description,
    status,
    created_at
   FROM public.projects p
  WHERE public.has_project_access(auth.uid(), id);


--
-- Name: VIEW my_projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.my_projects IS 'Projects accessible to current user (owner or role assignment)';


--
-- Name: studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text,
    retention_policy text,
    schema_ref text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT studies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
);


--
-- Name: my_studies; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.my_studies AS
 SELECT id,
    project_id,
    owner_id,
    name,
    status,
    retention_policy,
    schema_ref,
    created_at
   FROM public.studies s
  WHERE public.has_study_access(auth.uid(), id);


--
-- Name: VIEW my_studies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.my_studies IS 'Studies accessible to current user (owner, direct role, or project role)';


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pseudonym text,
    consent_status boolean DEFAULT false NOT NULL,
    consent_timestamp timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    CONSTRAINT pseudonym_format CHECK ((pseudonym ~ '^[A-Za-z0-9_.-]{3,64}$'::text))
);


--
-- Name: pipeline_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_scripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid,
    name text NOT NULL,
    description text,
    script_type text NOT NULL,
    endpoint_url text NOT NULL,
    trigger_tables text[] NOT NULL,
    trigger_event_types text[],
    trigger_output_types text[],
    writes_to_table text NOT NULL,
    output_type text,
    config jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pipeline_scripts_script_type_check CHECK ((script_type = ANY (ARRAY['analytics'::text, 'ml'::text, 'visualization'::text])))
);


--
-- Name: script_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.script_outputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid NOT NULL,
    output_type text NOT NULL,
    scope text NOT NULL,
    scope_id text,
    data jsonb NOT NULL,
    script_id uuid,
    computed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT script_outputs_scope_check CHECK ((scope = ANY (ARRAY['study'::text, 'participant'::text, 'session'::text, 'item'::text])))
);


--
-- Name: session_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid NOT NULL,
    participant_id text NOT NULL,
    session_id text,
    session_start timestamp with time zone,
    session_end timestamp with time zone,
    duration_ms integer,
    event_count integer DEFAULT 0,
    valid_response_count integer DEFAULT 0,
    aberrant_count integer DEFAULT 0,
    avg_rt_ms integer,
    extra jsonb DEFAULT '{}'::jsonb,
    computed_at timestamp with time zone DEFAULT now()
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid NOT NULL,
    study_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    app_version text,
    device text,
    meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: study_consent_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_consent_config (
    study_id uuid NOT NULL,
    base_template_id uuid,
    custom_content_md text,
    requires_scroll boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: study_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    study_id uuid NOT NULL,
    role text NOT NULL,
    invited_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    used_by uuid,
    used_at timestamp with time zone,
    CONSTRAINT study_invitations_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'supervisor'::text, 'researcher'::text, 'teacher'::text, 'participant'::text])))
);


--
-- Name: study_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_metrics (
    study_id uuid NOT NULL,
    computed_at timestamp with time zone DEFAULT now(),
    total_events integer DEFAULT 0,
    total_participants integer DEFAULT 0,
    active_participants integer DEFAULT 0,
    first_event_at timestamp with time zone,
    last_event_at timestamp with time zone,
    avg_events_per_day numeric,
    rt_median_ms integer,
    rt_mean_ms integer,
    rt_std_ms integer,
    aberrant_pct numeric,
    rapid_guess_count integer DEFAULT 0,
    disengaged_count integer DEFAULT 0,
    extra jsonb DEFAULT '{}'::jsonb
);


--
-- Name: study_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    study_id uuid,
    role text NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now(),
    CONSTRAINT project_or_study_exclusive CHECK ((((project_id IS NOT NULL) AND (study_id IS NULL)) OR ((project_id IS NULL) AND (study_id IS NOT NULL)))),
    CONSTRAINT study_roles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'supervisor'::text, 'researcher'::text, 'teacher'::text, 'participant'::text])))
);


--
-- Name: study_script_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_script_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid NOT NULL,
    script_id uuid NOT NULL,
    enabled boolean DEFAULT true
);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: consent_records consent_records_participant_study_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_participant_study_unique UNIQUE (participant_id, study_id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: consent_templates consent_templates_name_version_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_name_version_language_key UNIQUE (name, version, language);


--
-- Name: consent_templates consent_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_templates
    ADD CONSTRAINT consent_templates_pkey PRIMARY KEY (id);


--
-- Name: event_schemas event_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schemas
    ADD CONSTRAINT event_schemas_pkey PRIMARY KEY (id);


--
-- Name: event_schemas event_schemas_study_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schemas
    ADD CONSTRAINT event_schemas_study_id_version_key UNIQUE (study_id, version);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: participants participants_pseudonym_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pseudonym_key UNIQUE (pseudonym);


--
-- Name: participants participants_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_user_id_key UNIQUE (user_id);


--
-- Name: pipeline_scripts pipeline_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_scripts
    ADD CONSTRAINT pipeline_scripts_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: script_outputs script_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_outputs
    ADD CONSTRAINT script_outputs_pkey PRIMARY KEY (id);


--
-- Name: script_outputs script_outputs_study_id_output_type_scope_scope_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_outputs
    ADD CONSTRAINT script_outputs_study_id_output_type_scope_scope_id_key UNIQUE (study_id, output_type, scope, scope_id);


--
-- Name: session_metrics session_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_metrics
    ADD CONSTRAINT session_metrics_pkey PRIMARY KEY (id);


--
-- Name: session_metrics session_metrics_study_id_participant_id_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_metrics
    ADD CONSTRAINT session_metrics_study_id_participant_id_session_id_key UNIQUE (study_id, participant_id, session_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: studies studies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_pkey PRIMARY KEY (id);


--
-- Name: study_consent_config study_consent_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_consent_config
    ADD CONSTRAINT study_consent_config_pkey PRIMARY KEY (study_id);


--
-- Name: study_invitations study_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_invitations
    ADD CONSTRAINT study_invitations_pkey PRIMARY KEY (id);


--
-- Name: study_invitations study_invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_invitations
    ADD CONSTRAINT study_invitations_token_key UNIQUE (token);


--
-- Name: study_metrics study_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_metrics
    ADD CONSTRAINT study_metrics_pkey PRIMARY KEY (study_id);


--
-- Name: study_roles study_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_roles
    ADD CONSTRAINT study_roles_pkey PRIMARY KEY (id);


--
-- Name: study_script_config study_script_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_script_config
    ADD CONSTRAINT study_script_config_pkey PRIMARY KEY (id);


--
-- Name: study_script_config study_script_config_study_id_script_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_script_config
    ADD CONSTRAINT study_script_config_study_id_script_id_key UNIQUE (study_id, script_id);


--
-- Name: study_roles unique_user_project; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_roles
    ADD CONSTRAINT unique_user_project UNIQUE (user_id, project_id);


--
-- Name: study_roles unique_user_study; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_roles
    ADD CONSTRAINT unique_user_study UNIQUE (user_id, study_id);


--
-- Name: event_schemas_study_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_schemas_study_idx ON public.event_schemas USING btree (study_id);


--
-- Name: events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_event_type_idx ON public.events USING btree (event_type);


--
-- Name: events_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_item_id_idx ON public.events USING btree (item_id);


--
-- Name: events_participant_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_participant_id_ts_idx ON public.events USING btree (participant_id, ts);


--
-- Name: events_session_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_session_id_ts_idx ON public.events USING btree (session_id, ts);


--
-- Name: events_study_id_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_study_id_ts_idx ON public.events USING btree (study_id, ts);


--
-- Name: idx_consent_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_participant ON public.consent_records USING btree (participant_id);


--
-- Name: idx_consent_participant_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_participant_study ON public.consent_records USING btree (participant_id, study_id);


--
-- Name: idx_consent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_status ON public.consent_records USING btree (consent_status);


--
-- Name: idx_consent_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_study ON public.consent_records USING btree (study_id);


--
-- Name: idx_pipeline_scripts_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_scripts_study ON public.pipeline_scripts USING btree (study_id);


--
-- Name: idx_pipeline_scripts_triggers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_scripts_triggers ON public.pipeline_scripts USING gin (trigger_tables);


--
-- Name: idx_script_outputs_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_script_outputs_scope ON public.script_outputs USING btree (study_id, output_type, scope, scope_id);


--
-- Name: idx_script_outputs_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_script_outputs_study ON public.script_outputs USING btree (study_id);


--
-- Name: idx_script_outputs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_script_outputs_type ON public.script_outputs USING btree (study_id, output_type);


--
-- Name: idx_session_metrics_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_metrics_participant ON public.session_metrics USING btree (study_id, participant_id);


--
-- Name: idx_session_metrics_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_metrics_study ON public.session_metrics USING btree (study_id);


--
-- Name: idx_study_metrics_computed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_metrics_computed ON public.study_metrics USING btree (computed_at);


--
-- Name: idx_study_roles_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_roles_project ON public.study_roles USING btree (project_id);


--
-- Name: idx_study_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_roles_role ON public.study_roles USING btree (role);


--
-- Name: idx_study_roles_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_roles_study ON public.study_roles USING btree (study_id);


--
-- Name: idx_study_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_roles_user ON public.study_roles USING btree (user_id);


--
-- Name: idx_study_script_config_study; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_script_config_study ON public.study_script_config USING btree (study_id);


--
-- Name: sessions_participant_id_study_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_participant_id_study_id_idx ON public.sessions USING btree (participant_id, study_id);


--
-- Name: events events_router; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_router AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('http://kong:8000/functions/v1/event-router', 'POST', '{"Content-Type":"application/json"}', '{}', '5000');


--
-- Name: studies study_owner_role_on_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER study_owner_role_on_insert AFTER INSERT ON public.studies FOR EACH ROW EXECUTE FUNCTION public.create_study_owner_role();


--
-- Name: consent_records sync_participant_consent_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_participant_consent_trigger AFTER INSERT OR UPDATE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION public.sync_participant_consent();


--
-- Name: participants trg_audit_participants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_participants AFTER INSERT OR DELETE OR UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.audit_row();


--
-- Name: projects trg_audit_projects; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_projects AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.audit_row();


--
-- Name: studies trg_audit_studies; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_studies AFTER INSERT OR DELETE OR UPDATE ON public.studies FOR EACH ROW EXECUTE FUNCTION public.audit_row();


--
-- Name: consent_records consent_records_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: event_schemas event_schemas_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schemas
    ADD CONSTRAINT event_schemas_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: events events_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: events events_schema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.event_schemas(id) ON DELETE SET NULL;


--
-- Name: events events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: events events_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: participants participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: pipeline_scripts pipeline_scripts_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_scripts
    ADD CONSTRAINT pipeline_scripts_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: script_outputs script_outputs_script_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_outputs
    ADD CONSTRAINT script_outputs_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.pipeline_scripts(id);


--
-- Name: script_outputs script_outputs_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_outputs
    ADD CONSTRAINT script_outputs_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: session_metrics session_metrics_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_metrics
    ADD CONSTRAINT session_metrics_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: studies studies_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT studies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: study_consent_config study_consent_config_base_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_consent_config
    ADD CONSTRAINT study_consent_config_base_template_id_fkey FOREIGN KEY (base_template_id) REFERENCES public.consent_templates(id);


--
-- Name: study_consent_config study_consent_config_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_consent_config
    ADD CONSTRAINT study_consent_config_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: study_invitations study_invitations_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_invitations
    ADD CONSTRAINT study_invitations_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: study_metrics study_metrics_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_metrics
    ADD CONSTRAINT study_metrics_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: study_roles study_roles_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_roles
    ADD CONSTRAINT study_roles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: study_roles study_roles_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_roles
    ADD CONSTRAINT study_roles_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: study_script_config study_script_config_script_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_script_config
    ADD CONSTRAINT study_script_config_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.pipeline_scripts(id) ON DELETE CASCADE;


--
-- Name: study_script_config study_script_config_study_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_script_config
    ADD CONSTRAINT study_script_config_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_owner_read ON public.audit_log FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((('project:'::text || (p.id)::text) = audit_log.target) AND (p.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((('study:'::text || (s.id)::text) = audit_log.target) AND (s.owner_id = auth.uid()))))));


--
-- Name: audit_log audit_service_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_service_insert ON public.audit_log FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: consent_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records consent_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_self_read ON public.consent_records FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = consent_records.study_id) AND (s.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.study_roles sr
  WHERE ((sr.study_id = consent_records.study_id) AND (sr.user_id = auth.uid()) AND (sr.role = ANY (ARRAY['researcher'::text, 'supervisor'::text])))))));


--
-- Name: consent_records consent_system_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_system_insert ON public.consent_records FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: consent_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_templates consent_templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_templates_read ON public.consent_templates FOR SELECT USING (true);


--
-- Name: consent_templates consent_templates_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_templates_service_write ON public.consent_templates USING ((auth.role() = 'service_role'::text));


--
-- Name: consent_records consent_withdraw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_withdraw ON public.consent_records FOR UPDATE USING ((consent_status = 'granted'::text)) WITH CHECK ((consent_status = 'withdrawn'::text));


--
-- Name: event_schemas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_schemas ENABLE ROW LEVEL SECURITY;

--
-- Name: event_schemas event_schemas_researcher_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_schemas_researcher_read ON public.event_schemas FOR SELECT USING ((EXISTS ( SELECT 1
   FROM unnest(public.get_accessible_study_ids(auth.uid())) study_id(study_id))));


--
-- Name: event_schemas event_schemas_supervisor_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_schemas_supervisor_write ON public.event_schemas USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.user_id = auth.uid()) AND (study_roles.role = ANY (ARRAY['owner'::text, 'supervisor'::text]))))));


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_researcher_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_researcher_read ON public.events FOR SELECT USING (public.has_study_access(auth.uid(), study_id));


--
-- Name: events events_service_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_service_insert ON public.events FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

--
-- Name: participants participants_researcher_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_researcher_read ON public.participants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.participant_id = participants.id) AND public.has_study_access(auth.uid(), e.study_id)))));


--
-- Name: participants participants_service_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_service_create ON public.participants FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: pipeline_scripts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_scripts ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_scripts pipeline_scripts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_scripts_read ON public.pipeline_scripts FOR SELECT USING (((study_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = pipeline_scripts.study_id) AND (study_roles.user_id = auth.uid()))))));


--
-- Name: pipeline_scripts pipeline_scripts_service_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_scripts_service_read ON public.pipeline_scripts FOR SELECT USING (true);


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_owner_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_owner_create ON public.projects FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: projects projects_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_owner_delete ON public.projects FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: projects projects_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_owner_update ON public.projects FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: projects projects_role_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_role_read ON public.projects FOR SELECT USING (public.has_project_access(auth.uid(), id));


--
-- Name: script_outputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.script_outputs ENABLE ROW LEVEL SECURITY;

--
-- Name: script_outputs script_outputs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY script_outputs_read ON public.script_outputs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = script_outputs.study_id) AND (study_roles.user_id = auth.uid())))));


--
-- Name: script_outputs script_outputs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY script_outputs_write ON public.script_outputs USING (true) WITH CHECK (true);


--
-- Name: session_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: session_metrics session_metrics_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_metrics_read ON public.session_metrics FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = session_metrics.study_id) AND (study_roles.user_id = auth.uid())))));


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions sessions_researcher_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_researcher_read ON public.sessions FOR SELECT USING (public.has_study_access(auth.uid(), study_id));


--
-- Name: sessions sessions_service_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_service_create ON public.sessions FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: studies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;

--
-- Name: studies studies_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY studies_owner_delete ON public.studies FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: studies studies_role_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY studies_role_read ON public.studies FOR SELECT USING (public.has_study_access(auth.uid(), id));


--
-- Name: studies studies_supervisor_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY studies_supervisor_create ON public.studies FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = studies.project_id) AND (projects.owner_id = auth.uid())))) OR public.has_role_in_project(auth.uid(), project_id, 'supervisor'::text)));


--
-- Name: studies studies_supervisor_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY studies_supervisor_update ON public.studies FOR UPDATE USING (((auth.uid() = owner_id) OR public.has_role_level(auth.uid(), id, 'supervisor'::text)));


--
-- Name: study_consent_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.study_consent_config ENABLE ROW LEVEL SECURITY;

--
-- Name: study_consent_config study_consent_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_consent_config_read ON public.study_consent_config FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = study_consent_config.study_id) AND (study_roles.user_id = auth.uid())))));


--
-- Name: study_consent_config study_consent_config_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_consent_config_write ON public.study_consent_config USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = study_consent_config.study_id) AND (study_roles.user_id = auth.uid()) AND (study_roles.role = ANY (ARRAY['owner'::text, 'supervisor'::text]))))));


--
-- Name: study_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.study_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: study_metrics study_metrics_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_metrics_read ON public.study_metrics FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = study_metrics.study_id) AND (study_roles.user_id = auth.uid())))));


--
-- Name: study_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.study_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: study_roles study_roles_owner_grant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_roles_owner_grant ON public.study_roles FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = study_roles.project_id) AND (p.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = study_roles.study_id) AND (s.owner_id = auth.uid()))))));


--
-- Name: study_roles study_roles_owner_revoke; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_roles_owner_revoke ON public.study_roles FOR DELETE USING (((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = study_roles.project_id) AND (p.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = study_roles.study_id) AND (s.owner_id = auth.uid()))))));


--
-- Name: study_roles study_roles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_roles_self_read ON public.study_roles FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = study_roles.project_id) AND (p.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = study_roles.study_id) AND (s.owner_id = auth.uid()))))));


--
-- Name: study_script_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.study_script_config ENABLE ROW LEVEL SECURITY;

--
-- Name: study_script_config study_script_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_script_config_read ON public.study_script_config FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = study_script_config.study_id) AND (study_roles.user_id = auth.uid())))));


--
-- Name: study_script_config study_script_config_service_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_script_config_service_read ON public.study_script_config FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: study_script_config study_script_config_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_script_config_write ON public.study_script_config USING ((EXISTS ( SELECT 1
   FROM public.study_roles
  WHERE ((study_roles.study_id = study_script_config.study_id) AND (study_roles.user_id = auth.uid()) AND (study_roles.role = ANY (ARRAY['owner'::text, 'supervisor'::text]))))));


--
-- PostgreSQL database dump complete
--

\unrestrict Rh9AI5L9tRaLMph4NHxOyrIZghVEyEBey4BimdHDdgjVWcyazy76AVXgA23iV2h

