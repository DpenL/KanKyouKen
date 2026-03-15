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

-- Register global pipeline scripts (study_id IS NULL = applies to all studies)
insert into public.pipeline_scripts (name, description, script_type, endpoint_url, trigger_tables, writes_to_table, output_type, enabled)
values
  ('rt-stats', 'Computes study-level response time statistics', 'analytics', '/functions/v1/rt-stats', ARRAY['events'], 'study_metrics', null, true),
  ('participant-progress', 'Example: Computes per-participant stats and outputs accuracy chart', 'analytics', '/functions/v1/participant-progress', ARRAY['events'], 'script_outputs', 'participant_progress', false)
on conflict do nothing;
