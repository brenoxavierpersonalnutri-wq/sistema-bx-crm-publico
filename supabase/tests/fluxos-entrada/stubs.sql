-- Mínimo para aplicar 20261030100000 num Postgres local (tabelas só com as colunas que a migration usa).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.teste_sessao (uid uuid, admin boolean, aprovado boolean);
INSERT INTO public.teste_sessao VALUES (NULL, false, true);
GRANT SELECT ON public.teste_sessao TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.teste_sessao $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT admin FROM public.teste_sessao $$;
CREATE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT aprovado FROM public.teste_sessao $$;
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numero_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  phone text NOT NULL, name text NOT NULL DEFAULT '', source text, is_group boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}', UNIQUE (numero_id, phone));
CREATE TABLE public.crm_contato_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, contact_phone text NOT NULL, tipo text NOT NULL,
  valor text NOT NULL, dados jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.crm_fluxos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, ativo boolean NOT NULL DEFAULT false,
  excluido_em timestamptz, gatilho_tipo text NOT NULL DEFAULT 'evento', gatilho_valor text,
  gatilhos jsonb NOT NULL DEFAULT '[]', passos jsonb NOT NULL DEFAULT '[]');
CREATE TABLE public.crm_segmentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), filtro jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.lead_form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, telefone text, email text, nivel text NOT NULL DEFAULT 'DQ',
  score int NOT NULL DEFAULT 0, origem text, p1_objetivo text, utm_source text, utm_campaign text, utm_content text,
  utm_term text, utm_medium text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_name text NOT NULL DEFAULT '', client_phone text, client_email text,
  date date NOT NULL DEFAULT current_date, start_time text, status text NOT NULL DEFAULT 'agendado', via text, event_type_name text);
CREATE TABLE public.sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, value numeric NOT NULL, customer_email text, customer_phone text);
CREATE TABLE public.base_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origem text NOT NULL, origem_id text NOT NULL, nome text, telefone_e164 text,
  email text, tags text[] NOT NULL DEFAULT '{}', produto text, nivel text, UNIQUE (origem, origem_id));

CREATE OR REPLACE FUNCTION public.base_leads_tel_e164(bruto text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  -- [^0-9] e não \D: \D deixa passar dígito Unicode (ex.: 𝟗𝟏), que quebra o ::int
  d text := regexp_replace(coalesce(bruto, ''), '[^0-9]', '', 'g');
  ddd int;
  loc text;
BEGIN
  d := regexp_replace(d, '^0+', '');
  IF d = '' THEN RETURN NULL; END IF;
  IF d LIKE '55%' AND length(d) IN (12, 13) THEN
    NULL;
  ELSIF length(d) IN (10, 11) THEN
    d := '55' || d;
  ELSE
    RETURN NULL;
  END IF;
  ddd := substr(d, 3, 2)::int;
  loc := substr(d, 5);
  IF ddd < 11 OR ddd > 99 THEN RETURN NULL; END IF;
  IF length(loc) = 9 AND left(loc, 1) <> '9' THEN RETURN NULL; END IF;
  IF length(loc) = 8 AND left(loc, 1) ~ '[6-9]' THEN loc := '9' || loc; END IF;
  RETURN '+55' || ddd::text || loc;
END $$;

CREATE OR REPLACE FUNCTION public.base_leads_email(bruto text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN position('@' IN coalesce(bruto, '')) > 1 THEN lower(trim(bruto)) END
$$;

CREATE OR REPLACE FUNCTION public.base_leads_form_de_cliente(r public.lead_form_responses)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' ', r.utm_campaign, r.utm_content, r.utm_term, r.utm_medium)
           ~ '(^|\D)120\d{11}(0608|0464|0226|0698)(\D|$)'
      OR coalesce(r.p1_objetivo, '') IN ('reduzir_dores', 'intensificar_rotina', 'treinar_sem_risco', 'emagrecer_rapido')
$$;

CREATE TABLE public.base_leads_unificada_mat (chave text, tags text[]);
CREATE FUNCTION public.crm_segmento_listar(p_slug text, p_filtros jsonb DEFAULT '{}'::jsonb, p_pagina integer DEFAULT 0, p_por_pagina integer DEFAULT 50)
RETURNS TABLE (chave text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  t jsonb := CASE WHEN jsonb_typeof(p_filtros) = 'object' THEN p_filtros ELSE '{}'::jsonb END;
  v_tag text;
BEGIN
  v_tag := nullif(btrim(coalesce(t->>'tag', '')), '');
  RETURN QUERY SELECT m.chave FROM public.base_leads_unificada_mat m
   WHERE (v_tag IS NULL OR m.tags && ARRAY[v_tag]) ORDER BY m.chave;
END $$;
INSERT INTO public.base_leads_unificada_mat VALUES ('a', '{nivel-A}'), ('b', '{nivel-a}'), ('c', '{outra}');
