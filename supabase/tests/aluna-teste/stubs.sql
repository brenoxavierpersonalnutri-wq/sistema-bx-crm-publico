-- Imita o mínimo do Supabase/Lovable Cloud para testar a migration da aluna de teste.
-- Roda como superusuário; as migrations depois rodam como "supa" (sem
-- superusuário, com BYPASSRLS), que é o papel do "postgres" no Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supa LOGIN NOSUPERUSER BYPASSRLS;
GRANT anon, authenticated, service_role TO supa;
GRANT ALL ON SCHEMA public TO supa;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- o Supabase já tem (gen_random_bytes)
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO supa, anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
GRANT SELECT, REFERENCES ON auth.users TO supa;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

SET ROLE supa;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text NOT NULL DEFAULT '', approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
CREATE TABLE public.user_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, module text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, module)
);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND approved = true)
$$;
-- consultations só para as migrations que acrescentam colunas nela e em alunas.
CREATE TABLE public.consultations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
RESET ROLE;

-- storage mínimo (a migration do app cria buckets e policies nele).
CREATE SCHEMA storage AUTHORIZATION supa;
SET ROLE supa;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
RESET ROLE;
