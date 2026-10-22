-- Mínimo do Supabase/Lovable Cloud para aplicar 20261024130000_grupos_whatsapp num Postgres local.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
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
-- auth.uid() lê a GUC de teste (vazia = sem login)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user_id IS NOT NULL $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL UNIQUE, name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'leads', source text DEFAULT 'whatsapp', tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.base_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origem text NOT NULL DEFAULT 'sellflux', origem_id text NOT NULL,
  nome text, telefone_e164 text, email text, tags text[] NOT NULL DEFAULT '{}', produto text, status text,
  criado_origem timestamptz, importado_em timestamptz NOT NULL DEFAULT now(), UNIQUE (origem, origem_id));
