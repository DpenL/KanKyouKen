-- Trigger: fire event-router edge function on every INSERT to public.events
-- The 2s debounce in rt-stats absorbs bursts (only first call per window computes).
--
-- URL uses Kong's internal Docker hostname (http://kong:8000) so pg_net can
-- resolve it in local dev and CI. On hosted Supabase the trigger was created
-- via the dashboard using the project's absolute HTTPS URL instead.
CREATE TRIGGER "events_router"
AFTER INSERT
ON "public"."events"
FOR EACH ROW
EXECUTE FUNCTION "supabase_functions"."http_request"(
  'http://kong:8000/functions/v1/event-router',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);
