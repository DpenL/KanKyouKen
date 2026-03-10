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

-- Register generic pipeline scripts (global, apply to all studies)
insert into public.pipeline_scripts (name, script_type, endpoint_url, trigger_tables, writes_to_table)
values ('Response Time Stats', 'analytics', '/functions/v1/rt-stats', ARRAY['events'], 'study_metrics')
on conflict do nothing;
