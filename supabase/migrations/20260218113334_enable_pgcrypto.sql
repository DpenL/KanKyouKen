-- Enable pgcrypto extension for gen_random_bytes() function
-- This is needed for generating secure random tokens for invite links
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
