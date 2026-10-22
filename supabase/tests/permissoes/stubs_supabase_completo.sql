-- Stubs do Supabase para rodar TODAS as migrations num Postgres local descartável (teste, nunca produção).
-- auth.uid()/auth.role() leem request.jwt.claims, como o PostgREST grava. service_role tem BYPASSRLS, como no Supabase.

ALTER DATABASE postgres SET search_path = public, extensions;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_admin; CREATE ROLE dashboard_user; CREATE ROLE supabase_auth_admin; CREATE ROLE supabase_storage_admin;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA net; CREATE SCHEMA cron; CREATE SCHEMA vault;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}',
  raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz,
  phone text, banned_until timestamptz, deleted_at timestamptz);
-- simula o JWT do Supabase (request.jwt.claims), como o PostgREST faz
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), (auth.jwt() ->> 'sub')), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.role', true), (auth.jwt() ->> 'role')), '')::text $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, owner uuid, public boolean DEFAULT false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), path_tokens text[]);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(name, '.', -1) $$;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (a,b,c) RETURNING jobid $$;
CREATE FUNCTION cron.schedule(b text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(schedule, command) VALUES (b,c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(a text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = a; SELECT true $$;
CREATE FUNCTION cron.unschedule(a bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = a; SELECT true $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE PUBLICATION supabase_realtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000ad', 'exemplo@dominio.com');
