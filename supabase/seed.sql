--SET search_path TO public;

-- Minimal seed for local testing
insert into public.projects (owner_id, name, description)
values ('00000000-0000-0000-0000-000000000001', 'Demo Project', 'Seed project')
on conflict do nothing;

insert into public.studies (project_id, owner_id, name)
select id, owner_id, 'Seed Study' from public.projects limit 1
on conflict do nothing;

insert into public.participants (pseudonym, consent_status, consent_timestamp)
values ('demo_participant', true, now())
on conflict do nothing;

-- Built-in pipeline scripts (rt-stats, participant-progress) are registered by migration
-- 20261011001_register_builtin_pipelines.sql. Do not insert them here as well:
-- pipeline_scripts has no unique constraint, so a second insert creates duplicate rows
-- and every event is then dispatched to each script twice.
