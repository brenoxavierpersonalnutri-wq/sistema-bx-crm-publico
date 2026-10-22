-- =============================================================
-- CRM: automações por gatilho, campanhas com ritmo controlado e tags.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- TUDO NASCE DESLIGADO:
--   crm_envio_config.ligado = false  (nenhuma mensagem não oficial sai)
--   crm_automacoes.ativo    = false  (regra criada fica parada até ligar)
--   crm_campanhas           = rascunho até a confirmação na tela ("vou enviar para N contatos")
--   o pg_cron só chama a edge function quando existe regra ligada, campanha ativa ou item na fila.
--
-- QUEM ENVIA: a edge function crm-automacoes (publicar à mão no Lovable).
--   pg_cron (1/min) -> crm_automacoes_tick() -> pg_net POST na função com o segredo de
--   integracao_config.crm_automacoes_segredo (gerado aqui; a função confere lendo a mesma tabela).
--
-- LIMITES ANTI-BAN (padrão, editáveis na tela dentro dos CHECKs abaixo):
--   30 mensagens/hora, 200/dia, só 8h-20h (Brasília), intervalo aleatório 40-120 s entre envios,
--   pausa automática com 3 falhas seguidas ou sinal de restrição; mesma automação nunca 2x ao mesmo contato.
--
-- TEMPLATE OFICIAL: via Inbound Webhook do Full Funnel; URL em
--   integracao_config.fullfunnel_webhook_crm_url (fechada à API, como fullfunnel_webhook_url).
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 0) integracao_config já existe (20261013230000); garante e deixa a função ler ------------
CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('crm_automacoes_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('crm_automacoes_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/crm-automacoes')
ON CONFLICT (chave) DO NOTHING;

-- 1) Tags no contato + eventos (etapa / tag) ---------------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS whatsapp_contacts_tags_idx ON public.whatsapp_contacts USING gin (tags);

CREATE TABLE IF NOT EXISTS public.crm_contato_eventos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_phone text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('etapa', 'tag')),
  valor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_contato_eventos_idx ON public.crm_contato_eventos (created_at DESC, tipo, valor);

CREATE OR REPLACE FUNCTION public.crm_registrar_eventos_contato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor) VALUES (NEW.phone, 'etapa', NEW.stage);
  END IF;
  FOR t IN
    SELECT unnest(coalesce(NEW.tags, '{}'))
    EXCEPT
    SELECT unnest(CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.tags, '{}') ELSE '{}'::text[] END)
  LOOP
    INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor) VALUES (NEW.phone, 'tag', t);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_registrar_eventos_contato: %', SQLERRM; -- nunca derruba a gravação do contato
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_eventos_contato ON public.whatsapp_contacts;
CREATE TRIGGER trg_crm_eventos_contato
AFTER INSERT OR UPDATE OF stage, tags ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_registrar_eventos_contato();

-- 2) Configuração do envio não oficial (uma linha por número) ----------------------------
CREATE TABLE IF NOT EXISTS public.crm_envio_config (
  numero           text PRIMARY KEY DEFAULT 'principal',
  ligado           boolean NOT NULL DEFAULT false,
  pausado          boolean NOT NULL DEFAULT false,
  pausado_motivo   text,
  max_hora         integer NOT NULL DEFAULT 30  CHECK (max_hora BETWEEN 1 AND 60),
  max_dia          integer NOT NULL DEFAULT 200 CHECK (max_dia BETWEEN 1 AND 500),
  hora_inicio      integer NOT NULL DEFAULT 8   CHECK (hora_inicio BETWEEN 6 AND 22),
  hora_fim         integer NOT NULL DEFAULT 20  CHECK (hora_fim BETWEEN 7 AND 23),
  intervalo_min    integer NOT NULL DEFAULT 40  CHECK (intervalo_min BETWEEN 20 AND 3600),
  intervalo_max    integer NOT NULL DEFAULT 120 CHECK (intervalo_max BETWEEN 20 AND 3600),
  falhas_seguidas  integer NOT NULL DEFAULT 0,
  proximo_envio_em timestamptz,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_envio_config_janela CHECK (hora_inicio < hora_fim),
  CONSTRAINT crm_envio_config_intervalo CHECK (intervalo_min <= intervalo_max)
);
INSERT INTO public.crm_envio_config (numero) VALUES ('principal') ON CONFLICT (numero) DO NOTHING;

-- 3) Automações -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_automacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL,
  ativo              boolean NOT NULL DEFAULT false,
  gatilho_tipo       text NOT NULL CHECK (gatilho_tipo IN ('etapa', 'sem_resposta', 'tag')),
  gatilho_valor      text,
  sem_resposta_horas integer CHECK (sem_resposta_horas IS NULL OR sem_resposta_horas BETWEEN 1 AND 1440),
  janela_max_horas   integer NOT NULL DEFAULT 48 CHECK (janela_max_horas BETWEEN 1 AND 336),
  filtro_etapas      text[] NOT NULL DEFAULT '{}',
  acoes              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acoes) = 'array'),
  ligado_em          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ligado_em é do servidor: marca quando a regra foi ligada (gatilho só olha dali pra frente)
CREATE OR REPLACE FUNCTION public.crm_automacoes_marcar_ligado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo AND (TG_OP = 'INSERT' OR NOT OLD.ativo) THEN
    NEW.ligado_em := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.ligado_em := CASE WHEN NEW.ativo THEN OLD.ligado_em ELSE NULL END;
  ELSE
    NEW.ligado_em := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_automacoes_ligado ON public.crm_automacoes;
CREATE TRIGGER trg_crm_automacoes_ligado
BEFORE INSERT OR UPDATE ON public.crm_automacoes
FOR EACH ROW EXECUTE FUNCTION public.crm_automacoes_marcar_ligado();

-- 4) Campanhas (envio em massa com ritmo) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_campanhas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  status        text NOT NULL DEFAULT 'rascunho'
                CHECK (status IN ('rascunho', 'ativa', 'pausada', 'cancelada', 'concluida')),
  filtro        jsonb NOT NULL DEFAULT '{}'::jsonb,
  roteiro_id    uuid REFERENCES public.crm_roteiros(id) ON DELETE SET NULL,
  passo_id      uuid REFERENCES public.crm_roteiro_passos(id) ON DELETE SET NULL,
  lote_por_dia  integer CHECK (lote_por_dia IS NULL OR lote_por_dia BETWEEN 1 AND 500),
  total         integer NOT NULL DEFAULT 0,
  confirmado_em timestamptz,
  confirmado_por uuid,
  pausa_motivo  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 5) Fila e log ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_automacao_fila (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origem        text NOT NULL CHECK (origem IN ('automacao', 'campanha')),
  automacao_id  uuid REFERENCES public.crm_automacoes(id) ON DELETE CASCADE,
  campanha_id   uuid REFERENCES public.crm_campanhas(id) ON DELETE CASCADE,
  contact_phone text NOT NULL,
  gatilho_tipo  text,
  acoes         jsonb NOT NULL,
  usa_whatsapp  boolean NOT NULL DEFAULT false,
  -- pendente | enviando | enviado | erro | ignorado | cancelado
  status        text NOT NULL DEFAULT 'pendente',
  motivo        text,
  tentativas    integer NOT NULL DEFAULT 0,
  agendado_para timestamptz NOT NULL DEFAULT now(),
  enviado_em    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- "não reenviar a mesma automação ao mesmo contato" (NULLs não colidem: campanha usa o outro índice)
CREATE UNIQUE INDEX IF NOT EXISTS crm_fila_automacao_contato_key ON public.crm_automacao_fila (automacao_id, contact_phone);
CREATE UNIQUE INDEX IF NOT EXISTS crm_fila_campanha_contato_key ON public.crm_automacao_fila (campanha_id, contact_phone);
CREATE INDEX IF NOT EXISTS crm_fila_pendente_idx ON public.crm_automacao_fila (status, usa_whatsapp, agendado_para);

CREATE TABLE IF NOT EXISTS public.crm_automacao_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fila_id       bigint REFERENCES public.crm_automacao_fila(id) ON DELETE SET NULL,
  automacao_id  uuid,
  campanha_id   uuid,
  contact_phone text NOT NULL,
  canal         text NOT NULL CHECK (canal IN ('whatsapp', 'oficial', 'crm')),
  tipo          text NOT NULL,           -- text | image | audio | document | etapa | tag | template_oficial
  status        text NOT NULL CHECK (status IN ('ok', 'erro')),
  detalhe       text,
  message_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_log_uso_idx ON public.crm_automacao_log (canal, status, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_log_campanha_idx ON public.crm_automacao_log (campanha_id, created_at DESC);

-- 6) RLS ---------------------------------------------------------------------------------------
ALTER TABLE public.crm_contato_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_envio_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automacao_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automacao_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved read crm_contato_eventos" ON public.crm_contato_eventos;
CREATE POLICY "Approved read crm_contato_eventos" ON public.crm_contato_eventos FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved read crm_envio_config" ON public.crm_envio_config;
CREATE POLICY "Approved read crm_envio_config" ON public.crm_envio_config FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved update crm_envio_config" ON public.crm_envio_config;
CREATE POLICY "Approved update crm_envio_config" ON public.crm_envio_config FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved manage crm_automacoes" ON public.crm_automacoes;
CREATE POLICY "Approved manage crm_automacoes" ON public.crm_automacoes FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

-- Campanha: a tela só cria/edita RASCUNHO. Ativar, pausar, retomar e cancelar passam pela
-- edge function (que confere a contagem confirmada e enfileira).
DROP POLICY IF EXISTS "Approved read crm_campanhas" ON public.crm_campanhas;
CREATE POLICY "Approved read crm_campanhas" ON public.crm_campanhas FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved insert crm_campanhas" ON public.crm_campanhas;
CREATE POLICY "Approved insert crm_campanhas" ON public.crm_campanhas FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()) AND status = 'rascunho' AND total = 0 AND confirmado_em IS NULL);
DROP POLICY IF EXISTS "Approved update crm_campanhas" ON public.crm_campanhas;
CREATE POLICY "Approved update crm_campanhas" ON public.crm_campanhas FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()) AND status = 'rascunho')
  WITH CHECK (public.is_approved(auth.uid()) AND status = 'rascunho' AND confirmado_em IS NULL);
DROP POLICY IF EXISTS "Approved delete crm_campanhas" ON public.crm_campanhas;
CREATE POLICY "Approved delete crm_campanhas" ON public.crm_campanhas FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()) AND status IN ('rascunho', 'cancelada', 'concluida'));

DROP POLICY IF EXISTS "Approved read crm_automacao_fila" ON public.crm_automacao_fila;
CREATE POLICY "Approved read crm_automacao_fila" ON public.crm_automacao_fila FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved read crm_automacao_log" ON public.crm_automacao_log;
CREATE POLICY "Approved read crm_automacao_log" ON public.crm_automacao_log FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- 7) Tick do pg_cron: só chama a função quando há trabalho -----------------------------------
CREATE OR REPLACE FUNCTION public.crm_automacoes_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_automacoes WHERE ativo)
     AND NOT EXISTS (SELECT 1 FROM public.crm_campanhas WHERE status = 'ativa')
     AND NOT EXISTS (SELECT 1 FROM public.crm_automacao_fila WHERE status = 'pendente') THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'crm_automacoes_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'crm_automacoes_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-automacao-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.crm_automacoes_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_registrar_eventos_contato() FROM PUBLIC, anon, authenticated;

COMMIT;

-- 8) Agenda (fora da transação). Reagendar com o mesmo nome substitui. -----------------------
SELECT cron.schedule('crm-automacoes-tick', '* * * * *', 'SELECT public.crm_automacoes_tick()');

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar a edge function crm-automacoes (Lovable) com verify_jwt = false.
--  2) Template oficial (opcional): gravar a URL do Inbound Webhook do workflow do Full Funnel:
--     INSERT INTO public.integracao_config (chave, valor)
--     VALUES ('fullfunnel_webhook_crm_url', 'https://services.leadconnectorhq.com/hooks/.../webhook-trigger/<ID>')
--     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
--  3) Ligar o envio não oficial pela tela Automações > Limites (ou: UPDATE crm_envio_config SET ligado = true).
--  Desligar tudo de uma vez: UPDATE public.crm_envio_config SET ligado = false;
--                            UPDATE public.crm_automacoes SET ativo = false;
-- =============================================================
