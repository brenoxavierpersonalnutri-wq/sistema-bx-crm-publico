-- Imita o mínimo do Supabase/Lovable Cloud para testar a migration do aviso.
-- Roda como superusuário; as migrations depois rodam como "supa" (sem
-- superusuário, com BYPASSRLS), que é o papel do "postgres" no Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supa LOGIN NOSUPERUSER BYPASSRLS;
GRANT anon, authenticated, service_role TO supa;
GRANT ALL ON SCHEMA public TO supa;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO supa, anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
GRANT SELECT ON auth.users TO supa;
-- auth.uid() lê o "sub" do JWT, como no Supabase.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

SET ROLE supa;
-- Supabase dá privilégio de tabela/função nova em public para anon/authenticated.
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
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_modules ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND approved = true)
$$;
CREATE FUNCTION public.aluna_do_usuario(_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- alunas com as colunas que importam aqui (migration 20260309043458 + telefone/status).
CREATE TABLE public.alunas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome_completo text NOT NULL,
  telefone text,
  programa text NOT NULL DEFAULT 'MGMD',
  status text NOT NULL DEFAULT 'ativa',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alunas ENABLE ROW LEVEL SECURITY;
RESET ROLE;
