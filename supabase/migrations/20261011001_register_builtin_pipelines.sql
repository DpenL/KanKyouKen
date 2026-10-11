-- Register the built-in pipeline scripts.
--
-- event-router fans out to rows in pipeline_scripts. Without a row the scripts never
-- run and study_metrics / script_outputs stay empty, which is indistinguishable from
-- a working pipeline that found nothing. Idempotent: pipeline_scripts has no unique
-- constraint, so these guard on endpoint_url.

insert into public.pipeline_scripts
  (study_id, name, description, script_type, endpoint_url,
   trigger_tables, writes_to_table, output_type, enabled)
select null,
       'Response Time Stats',
       'Response-time distribution, rapid-guess and disengagement counts per study.',
       'analytics',
       '/functions/v1/rt-stats',
       array['events'],
       'study_metrics',
       null,
       true
where not exists (
  select 1 from public.pipeline_scripts
  where endpoint_url = '/functions/v1/rt-stats'
);

-- Global and disabled by default; a researcher opts in per study via study_script_config.
insert into public.pipeline_scripts
  (study_id, name, description, script_type, endpoint_url,
   trigger_tables, writes_to_table, output_type, enabled)
select null,
       'participant-progress',
       'Per-participant stats and a study-level accuracy chart.',
       'analytics',
       '/functions/v1/participant-progress',
       array['events'],
       'script_outputs',
       'participant_progress',
       false
where not exists (
  select 1 from public.pipeline_scripts
  where endpoint_url = '/functions/v1/participant-progress'
);
