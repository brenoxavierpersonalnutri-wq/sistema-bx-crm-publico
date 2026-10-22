-- Mínimo do Supabase/Lovable Cloud para aplicar 20261019100000 + 20261021100000 + 20261026120000 +
-- 20261029110000 (Banco de dados rápido) num Postgres local.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command; SELECT 1::bigint; $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE TABLE public.aprovados (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.user_modules (user_id uuid, module text);
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.aprovados WHERE user_id = _user_id) $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.has_module(_user_id uuid, _module text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module) $$;
CREATE TABLE public.lead_form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origem text, nome text, telefone text, email text, nivel text,
  score int, utm_source text, utm_campaign text, utm_content text, utm_term text, utm_medium text, p1_objetivo text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_name text NOT NULL, client_phone text, client_email text,
  date date NOT NULL DEFAULT current_date, status text NOT NULL DEFAULT 'pendente', via text, attended boolean,
  converted boolean, converted_at timestamptz, refunded boolean, disqualified boolean, event_type_name text,
  program_value text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_phone text, customer_email text, source text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.alunas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, nome_completo text NOT NULL, programa text NOT NULL,
  data_compra date NOT NULL, duracao_plano text NOT NULL DEFAULT '1', data_vencimento date NOT NULL,
  forma_pagamento text NOT NULL DEFAULT 'pix', pago boolean NOT NULL DEFAULT false, telefone text, origem_lead text,
  status text DEFAULT 'ativa', is_teste boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL, name text, stage text, tags text[],
  source text, created_at timestamptz NOT NULL DEFAULT now());
