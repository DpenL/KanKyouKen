-- 20260909001_rls_hardening.sql
--
-- Three policies granted the public anon key rights it should never have had.
-- The anon key is not a secret: it is compiled into every client bundle and served
-- from www/*/config.json, so "anon" here means "anyone on the internet".
--
-- Found by audit 2026-09-09; the first was reproduced against the live deployment.

BEGIN;

-- 1. consent_records: anyone could withdraw everyone's consent -----------------
--
-- CREATE POLICY consent_withdraw ON public.consent_records FOR UPDATE
--   USING (consent_status = 'granted') WITH CHECK (consent_status = 'withdrawn');
--
-- No identity predicate and no TO clause, so it applied to anon, which holds the
-- default UPDATE grant. A single
--   PATCH /rest/v1/consent_records?consent_status=eq.granted
-- would flip every granted consent in the database to withdrawn, and the
-- sync_participant_consent trigger would propagate that to participants. WITH CHECK
-- constrained only consent_status, so the same request could also rewrite
-- consent_text, metadata, participant_id and study_id.
--
-- Nothing needs it. Withdrawal goes through consent/index.ts, which authenticates
-- the caller and uses the service key; the dashboard inserts via the service client.
DROP POLICY IF EXISTS consent_withdraw ON public.consent_records;
REVOKE UPDATE, DELETE ON public.consent_records FROM anon, authenticated;

-- 2. script_outputs: world-readable AND world-writable -------------------------
--
-- CREATE POLICY "script_outputs_write" ON public.script_outputs FOR ALL
--   USING (true) WITH CHECK (true);
--
-- The comment above it reasoned that scripts run with the service role and so
-- bypass RLS -- which is true, and is exactly why this policy was never needed.
-- FOR ALL includes SELECT and DELETE, policies are OR-ed, and there is no
-- TO service_role clause, so it resolved for anon. That table holds per-participant
-- analytics: accuracy, items_seen, last_active.
--
-- Replaced rather than simply dropped: the dashboard reads this table from the
-- browser with the researcher's own JWT (components/study/live-analytics.tsx),
-- so authenticated researchers still need SELECT. Same predicate as
-- events_researcher_read.
DROP POLICY IF EXISTS "script_outputs_write" ON public.script_outputs;
CREATE POLICY script_outputs_researcher_read ON public.script_outputs
  FOR SELECT USING (public.has_study_access(auth.uid(), study_id));

REVOKE ALL ON public.script_outputs FROM anon, authenticated;
GRANT SELECT ON public.script_outputs TO authenticated;

-- 3. pipeline_scripts: world-readable ------------------------------------------
--
-- CREATE POLICY "pipeline_scripts_service_read" ON public.pipeline_scripts
--   FOR SELECT USING (true);
--
-- Named for the service role but with no role check, so it leaked endpoint_url and
-- config to anon. Dropped outright: the only reader is the settings page, which
-- uses createServiceClient() and bypasses RLS.
DROP POLICY IF EXISTS "pipeline_scripts_service_read" ON public.pipeline_scripts;
REVOKE ALL ON public.pipeline_scripts FROM anon, authenticated;

COMMIT;

-- Verify (expect no rows):
--   SELECT polname, relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE polname IN ('consent_withdraw','script_outputs_write','pipeline_scripts_service_read');
