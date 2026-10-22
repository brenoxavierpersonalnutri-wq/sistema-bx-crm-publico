-- Mínimo do Supabase/Lovable Cloud para aplicar 20261018100000 + 20261023120000 num Postgres local.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA extensions;
CREATE SCHEMA net;
CREATE TABLE net.chamadas (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.chamadas (url, body, headers) VALUES (url, body, headers) RETURNING id; $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET command = EXCLUDED.command; SELECT 1::bigint; $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL UNIQUE, name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'leads', source text DEFAULT 'whatsapp', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.crm_roteiros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text);
CREATE TABLE public.crm_roteiro_passos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), roteiro_id uuid);
