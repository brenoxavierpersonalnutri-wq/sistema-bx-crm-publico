-- Mínimo do Supabase para aplicar 20261101100000_crm_etapas_configuraveis num Postgres local, com dado "de produção"
-- simulado: os 5 stages de sempre, um stage extra válido ("pos_venda") e um fora do formato ("Lixo Antigo").
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.sessao (uid uuid, admin boolean);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.sessao TO anon, authenticated, service_role;
INSERT INTO auth.sessao VALUES (NULL, false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.sessao LIMIT 1 $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user_id IS NOT NULL $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _user_id IS NOT NULL AND _role = 'admin' AND (SELECT admin FROM auth.sessao LIMIT 1) $$;
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL UNIQUE, name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'leads', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ig_contatos (phone text PRIMARY KEY, stage text NOT NULL DEFAULT 'leads');
CREATE TABLE public.crm_roteiros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage text NOT NULL, nome text);
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
INSERT INTO public.whatsapp_contacts (phone, stage) VALUES
  ('1', 'leads'), ('2', 'contato'), ('3', 'agendado'), ('4', 'compareceu'), ('5', 'fechou'), ('6', 'pos_venda'), ('7', 'Lixo Antigo');
INSERT INTO public.ig_contatos VALUES ('ig:1', 'leads'), ('ig:2', 'pos_venda');
INSERT INTO public.crm_roteiros (stage, nome) VALUES ('leads', 'r1'), ('fechou', 'r2');
