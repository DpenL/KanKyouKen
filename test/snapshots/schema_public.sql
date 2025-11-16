CREATE SCHEMA public;
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
CREATE FUNCTION public.is_owner(uid uuid, proj_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists(select 1 from public.projects where id = proj_id and owner_id = uid);
$$;
CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id uuid,
    action text,
    target text,
    "timestamp" timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;
CREATE TABLE public.event_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    study_id uuid,
    version text NOT NULL,
    name text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
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
CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pseudonym text,
    consent_status boolean DEFAULT false NOT NULL,
    consent_timestamp timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pseudonym_format CHECK ((pseudonym ~ '^[A-Za-z0-9_\\-\\.]{3,64}$'::text))
);
CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);
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
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
    ADD CONSTRAINT event_schemas_pkey PRIMARY KEY (id);
    ADD CONSTRAINT event_schemas_study_id_version_key UNIQUE (study_id, version);
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);
    ADD CONSTRAINT participants_pseudonym_key UNIQUE (pseudonym);
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
    ADD CONSTRAINT studies_pkey PRIMARY KEY (id);
CREATE INDEX event_schemas_study_idx ON public.event_schemas USING btree (study_id);
CREATE INDEX events_event_type_idx ON public.events USING btree (event_type);
CREATE INDEX events_item_id_idx ON public.events USING btree (item_id);
CREATE INDEX events_participant_id_ts_idx ON public.events USING btree (participant_id, ts);
CREATE INDEX events_session_id_ts_idx ON public.events USING btree (session_id, ts);
CREATE INDEX events_study_id_ts_idx ON public.events USING btree (study_id, ts);
CREATE INDEX sessions_participant_id_study_id_idx ON public.sessions USING btree (participant_id, study_id);
CREATE TRIGGER trg_audit_participants AFTER INSERT OR DELETE OR UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER trg_audit_projects AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER trg_audit_studies AFTER INSERT OR DELETE OR UPDATE ON public.studies FOR EACH ROW EXECUTE FUNCTION public.audit_row();
    ADD CONSTRAINT event_schemas_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;
    ADD CONSTRAINT events_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;
    ADD CONSTRAINT events_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.event_schemas(id) ON DELETE SET NULL;
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;
    ADD CONSTRAINT events_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;
    ADD CONSTRAINT sessions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;
    ADD CONSTRAINT sessions_study_id_fkey FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;
    ADD CONSTRAINT studies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
CREATE POLICY events_owner_read ON public.events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.studies s
  WHERE ((s.id = events.study_id) AND (s.owner_id = auth.uid())))));
CREATE POLICY participants_owner_read ON public.participants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.studies s
     JOIN public.events e ON ((e.study_id = s.id)))
  WHERE ((e.participant_id = participants.id) AND (s.owner_id = auth.uid())))));
CREATE POLICY project_owner_read ON public.projects FOR SELECT USING ((auth.uid() = owner_id));
CREATE POLICY project_owner_update ON public.projects FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY project_owner_write ON public.projects FOR INSERT WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY researcher_read_full ON public.events FOR SELECT USING ((auth.role() = 'researcher'::text));
CREATE POLICY study_owner_all ON public.studies USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY teacher_read_summary ON public.events FOR SELECT USING ((auth.role() = 'teacher'::text));
