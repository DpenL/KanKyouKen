-- Fix pseudonym_format check constraint (KN-184)
-- The original regex '^[A-Za-z0-9_\\-\\.]{3,64}$' was written for
-- standard_conforming_strings = off. With modern Postgres (on by default),
-- \\- inside [...] is backslash + range-operator, not an escaped hyphen,
-- so hyphens were unintentionally blocked.
-- Fix: place hyphen at the end of the character class where it is always
-- treated as a literal, and use a plain . for dot (literal inside [...]).
ALTER TABLE public.participants
  DROP CONSTRAINT pseudonym_format;

ALTER TABLE public.participants
  ADD CONSTRAINT pseudonym_format
  CHECK (pseudonym ~ '^[A-Za-z0-9_.-]{3,64}$');
