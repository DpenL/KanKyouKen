-- The audit_row() trigger function must run as SECURITY DEFINER so that
-- RLS (audit_service_insert: auth.role() = 'service_role') does not block
-- the insert when triggered by an authenticated user.
-- auth.uid() still resolves correctly because Supabase sets it via
-- request.jwt.claims, which persists across SECURITY DEFINER boundaries.

create or replace function public.audit_row()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid := auth.uid();
begin
  insert into public.audit_log(user_id, action, target)
  values (who, tg_op, tg_table_name);
  return new;
end;
$$;
