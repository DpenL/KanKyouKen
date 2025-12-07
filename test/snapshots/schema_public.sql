--
-- PostgreSQL database dump
--

\restrict gQ5RHcrUh2Bzxcn8dCEGKrrOrjBvtmAEY7sE2rMw8Y4CyV7oKJzTU99Y4j2EIKz

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1 (Ubuntu 18.1-1.pgdg22.04+2)

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
    LANGUAGE plpgsql
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
-- Name: is_owner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner(uid uuid, proj_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid);
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
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pseudonym text,
    consent_status boolean DEFAULT false NOT NULL,
    consent_timestamp timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pseudonym_format CHECK ((pseudonym ~ '^[A-Za-z0-9_\\-\\.]{3,64}$'::text))
);


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
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


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
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


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
-- Name: sessions_participant_id_study_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_participant_id_study_id_idx ON public.sessions USING btree (participant_id, study_id);


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
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: event_schemas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_schemas ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_owner_read ON public.events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = events.study_id) AND (s.owner_id = auth.uid())))));


--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

--
-- Name: participants participants_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_owner_read ON public.participants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.studies s
     JOIN public.events e ON ((e.study_id = s.id)))
  WHERE ((e.participant_id = participants.id) AND (s.owner_id = auth.uid())))));


--
-- Name: projects project_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_owner_read ON public.projects FOR SELECT USING ((auth.uid() = owner_id));


--
-- Name: projects project_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_owner_update ON public.projects FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: projects project_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_owner_write ON public.projects FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: events researcher_read_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY researcher_read_full ON public.events FOR SELECT USING ((auth.role() = 'researcher'::text));


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: studies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;

--
-- Name: studies study_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY study_owner_all ON public.studies USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: events teacher_read_summary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_read_summary ON public.events FOR SELECT USING ((auth.role() = 'teacher'::text));


--
-- PostgreSQL database dump complete
--

\unrestrict gQ5RHcrUh2Bzxcn8dCEGKrrOrjBvtmAEY7sE2rMw8Y4CyV7oKJzTU99Y4j2EIKz

