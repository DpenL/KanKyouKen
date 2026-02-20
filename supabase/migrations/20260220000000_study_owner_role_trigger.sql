-- Trigger: automatically grant the study creator an explicit 'owner' role in
-- study_roles when a new study is inserted. This ensures that queries which
-- list accessible studies via study_roles (e.g. the /events schema page) can
-- find studies for their creator without requiring a separate application-level
-- insert.
--
-- The trigger runs AFTER INSERT so that the new studies row is committed and
-- visible to any RLS checks before the study_roles row is created.
-- It uses SECURITY DEFINER to bypass RLS on study_roles (the trigger function
-- acts as the table owner, not the end-user session).

CREATE OR REPLACE FUNCTION public.create_study_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.study_roles (user_id, study_id, role, granted_by)
  VALUES (NEW.owner_id, NEW.id, 'owner', NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER study_owner_role_on_insert
  AFTER INSERT ON public.studies
  FOR EACH ROW
  EXECUTE FUNCTION public.create_study_owner_role();
