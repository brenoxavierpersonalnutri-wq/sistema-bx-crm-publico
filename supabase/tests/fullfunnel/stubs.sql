-- Imita o mínimo do Supabase/Lovable Cloud para testar a migration localmente.
-- pg_net e pg_cron viram stubs: http_post só registra a chamada.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase dá EXECUTE em função nova de public para anon/authenticated por padrão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE SCHEMA extensions;
CREATE SCHEMA net;
CREATE TABLE net.chamadas (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_ms int);
CREATE TABLE net._http_response (id bigint, status_code int, content_type text, headers jsonb,
                                 content text, timed_out boolean, error_msg text, created timestamptz DEFAULT now());
CREATE TABLE net.falhar (sim boolean);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
                              headers jsonb DEFAULT '{"Content-Type":"application/json"}', timeout_milliseconds int DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM net.falhar WHERE sim) THEN RAISE EXCEPTION 'pg_net fora do ar (stub)'; END IF;
  INSERT INTO net.chamadas (url, body, headers, timeout_ms) VALUES (url, body, headers, timeout_milliseconds) RETURNING id INTO v;
  RETURN v;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (n, s, c, true) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command;
  SELECT 1::bigint;
$$;

-- lead_form_responses como no repo (migrations 20260416, 20260625, 20260809 + instagram)
CREATE TABLE public.lead_form_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text, telefone text, email text, instagram text,
  p1_objetivo text, p2_situacao text, p3_profissao text, p4_altura numeric, p4_peso numeric, p4_idade integer,
  p5_estrategias text, p6_caneta text, p7_acompanhamento text, p8_investimento text, p9_prioridade text,
  score integer NOT NULL DEFAULT 0, nivel text NOT NULL DEFAULT 'DQ',
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  consultation_id uuid, renda_mensal text, origem text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_form_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert form responses" ON public.lead_form_responses FOR INSERT TO public WITH CHECK (true);
