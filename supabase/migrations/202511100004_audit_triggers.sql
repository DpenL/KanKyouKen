-- Unified audit trigger for sensitive tables

create or replace function public.audit_row()
returns trigger language plpgsql as $$
declare
  who uuid := auth.uid();
begin
  insert into public.audit_log(user_id, action, target)
  values (who, tg_op, tg_table_name);
  return new;
end;
$$;

-- Attach triggers
drop trigger if exists trg_audit_projects on public.projects;
create trigger trg_audit_projects after insert or update or delete
  on public.projects for each row execute function public.audit_row();

drop trigger if exists trg_audit_studies on public.studies;
create trigger trg_audit_studies after insert or update or delete
  on public.studies for each row execute function public.audit_row();

drop trigger if exists trg_audit_participants on public.participants;
create trigger trg_audit_participants after insert or update or delete
  on public.participants for each row execute function public.audit_row();
