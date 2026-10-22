-- Stubs mínimos do Supabase para rodar as migrations de grupos num Postgres local (teste, nunca produção).
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA net; CREATE SCHEMA cron;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT _user_id IS NOT NULL $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION cron.unschedule(a text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.crm_numeros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chave text UNIQUE, apelido text, telefone text,
  tipo text, sessao_openwa text, ordem int, observacao text, ativo boolean DEFAULT true);
CREATE TABLE public.base_leads (id bigserial, origem text, origem_id text, nome text, telefone_e164 text, email text, tags text[],
  produto text, status text, criado_origem timestamptz, UNIQUE (origem, origem_id));
CREATE TABLE public.whatsapp_contacts (phone text PRIMARY KEY, name text, source text, tags text[], updated_at timestamptz);
