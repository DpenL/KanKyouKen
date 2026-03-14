-- Link participants to their Supabase auth account.
-- Populated when a participant accepts a study invite (one auth user → one participant record).
-- Nullable: participants created before this migration or via the SDK have no auth account.
ALTER TABLE public.participants
  ADD COLUMN user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
