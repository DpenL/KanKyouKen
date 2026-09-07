-- ============================================================
-- 20260907001 · Grant hardening
--
-- Supabase grants ALL on every new table in `public` to anon,
-- authenticated and service_role by default, and relies on RLS to narrow
-- that again. Four objects in this schema have no RLS, so for them the
-- default grant is the whole story:
--
--   study_invitations
--     Single-use tokens that grant a role on acceptance, up to and
--     including 'owner'. 002 documents the table as reachable only by
--     server-side code holding the service role key, but nothing enforced
--     that: with RLS off and the default SELECT grant in place, any caller
--     holding the public anon key could read every unexpired token through
--     PostgREST and promote itself on any study.
--
--   my_events / my_studies / my_projects
--     Views owned by postgres, so they run with the definer's rights and
--     see past RLS on the underlying tables. All three are simple enough
--     that Postgres treats them as auto-updatable, and the default grant
--     carries INSERT/UPDATE/DELETE/TRUNCATE — which routes around both the
--     events RLS policies and 002's own
--         REVOKE INSERT ON public.events FROM anon, authenticated;
--     002 granted SELECT to authenticated and nothing else; this restores
--     that intent against the default grant.
--
-- None of this is specific to one deployment. Hosted Supabase, `supabase
-- start` and the self-hosted stack all apply the same default grants, so
-- this migration is required in every environment.
--
-- Grants only: no table, policy or column is touched, so the schema-parity
-- snapshot (which carries no ACL lines) is unaffected.
-- ============================================================

-- === study_invitations: service role only, as 002 always intended ===
REVOKE ALL ON public.study_invitations FROM anon, authenticated;

-- === my_* views: read-only, and only for signed-in users ===
REVOKE ALL ON public.my_events, public.my_studies, public.my_projects
  FROM anon, authenticated;

GRANT SELECT ON public.my_events, public.my_studies, public.my_projects
  TO authenticated;
