-- =============================================================
-- WhatsApp (OpenWA): mídia no Storage, nome de participante de grupo e backfill completo.
-- Rodar DEPOIS de 20261022100000_crm_fotos_grupos_pareamento.sql. Idempotente.
--
-- 1) whatsapp_messages ganha media_path (caminho no bucket privado whatsapp-media; o front
--    assina na leitura) e media_status/media_tentativas/media_erro (retry de "Error downloading media").
-- 2) whatsapp_wa_nomes: cache WID -> nome/telefone (participantes de grupo, ids @lid).
-- 3) Backfill: whatsapp_backfill_jobs (1 job = 1 passada por TODOS os chats) e
--    whatsapp_backfill_chats (fila, uma linha por chat). Só a service role escreve; aprovado lê
--    (é o que alimenta a barra "importando 120/600 conversas").
-- 4) whatsapp_inserir_mensagens(jsonb): insert em lote sem duplicar (ON CONFLICT DO NOTHING casa
--    com o índice único parcial de message_id) e whatsapp_aplicar_nomes(jsonb).
-- 5) pg_cron 1/min -> whatsapp_backfill_tick() -> pg_net na edge function whatsapp-backfill,
--    SÓ quando há trabalho (job ativo, mídia pendente ou autor sem nome) e a URL foi gravada.
-- 6) Trigger de eventos do contato: contato que nasce de importação/backfill ou é grupo NÃO gera
--    evento de etapa (senão 600 contatos antigos entrariam nas automações de "etapa leads" de uma vez).
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 1) mídia ---------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_status text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_tentativas smallint NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_erro text;
DO $$ BEGIN
  ALTER TABLE public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_media_status_chk
    CHECK (media_status IS NULL OR media_status IN ('pendente', 'ok', 'falhou'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS whatsapp_messages_media_pendente_idx
  ON public.whatsapp_messages (created_at DESC) WHERE media_status = 'pendente';
CREATE INDEX IF NOT EXISTS whatsapp_messages_autor_sem_nome_idx
  ON public.whatsapp_messages (author_id) WHERE author_name IS NULL AND author_id IS NOT NULL;

-- bucket privado (se já existe, não mexe em nada)
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- 2) nomes ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_wa_nomes (
  wid           text PRIMARY KEY CHECK (wid ~ '^\d{5,25}@(c\.us|lid)$'),
  nome          text,
  telefone      text CHECK (telefone IS NULL OR telefone ~ '^\d{10,15}$'),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_wa_nomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Aprovados leem whatsapp_wa_nomes" ON public.whatsapp_wa_nomes;
CREATE POLICY "Aprovados leem whatsapp_wa_nomes" ON public.whatsapp_wa_nomes
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

-- 3) backfill ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_backfill_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status           text NOT NULL DEFAULT 'listando'
                   CHECK (status IN ('listando', 'importando', 'concluido', 'cancelado', 'erro')),
  por_chat         int  NOT NULL DEFAULT 500 CHECK (por_chat BETWEEN 1 AND 2000),
  midias_por_chat  int  NOT NULL DEFAULT 3   CHECK (midias_por_chat BETWEEN 0 AND 30),
  grupos           boolean NOT NULL DEFAULT true,
  offset_lista     int  NOT NULL DEFAULT 0,
  total_chats      int  NOT NULL DEFAULT 0,
  chats_feitos     int  NOT NULL DEFAULT 0,
  chats_erro       int  NOT NULL DEFAULT 0,
  msgs_importadas  int  NOT NULL DEFAULT 0,
  midias           int  NOT NULL DEFAULT 0,
  aviso            text,
  erro             text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em     timestamptz,
  ultimo_tick      timestamptz
);
-- no máximo UM job ativo
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_backfill_um_ativo
  ON public.whatsapp_backfill_jobs ((true)) WHERE status IN ('listando', 'importando');

CREATE TABLE IF NOT EXISTS public.whatsapp_backfill_chats (
  id          bigserial PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES public.whatsapp_backfill_jobs(id) ON DELETE CASCADE,
  chat_id     text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('individual', 'group')),
  phone       text,
  nome        text,
  ts          bigint,
  status      text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'feito', 'erro', 'pulado')),
  mensagens   int  NOT NULL DEFAULT 0,
  tentativas  smallint NOT NULL DEFAULT 0,
  erro        text,
  feito_em    timestamptz,
  UNIQUE (job_id, chat_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_backfill_chats_fila_idx
  ON public.whatsapp_backfill_chats (job_id, ts DESC NULLS LAST) WHERE status = 'pendente';

ALTER TABLE public.whatsapp_backfill_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_backfill_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Aprovados leem whatsapp_backfill_jobs" ON public.whatsapp_backfill_jobs;
CREATE POLICY "Aprovados leem whatsapp_backfill_jobs" ON public.whatsapp_backfill_jobs
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados leem whatsapp_backfill_chats" ON public.whatsapp_backfill_chats;
CREATE POLICY "Aprovados leem whatsapp_backfill_chats" ON public.whatsapp_backfill_chats
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

-- 4) RPCs (só service role) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_inserir_mensagens(p_linhas jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  INSERT INTO public.whatsapp_messages (
    contact_phone, direction, sender_type, body, media_type, mime_type, file_name, caption,
    message_id, created_at, author_name, author_phone, author_id, media_status
  )
  SELECT x.contact_phone, coalesce(x.direction, 'inbound'), coalesce(x.sender_type, 'lead'), coalesce(x.body, ''),
         x.media_type, x.mime_type, x.file_name, x.caption, x.message_id, coalesce(x.created_at, now()),
         x.author_name, x.author_phone, x.author_id, x.media_status
    FROM jsonb_to_recordset(p_linhas) AS x(
      contact_phone text, direction text, sender_type text, body text, media_type text, mime_type text,
      file_name text, caption text, message_id text, created_at timestamptz, author_name text,
      author_phone text, author_id text, media_status text)
   WHERE x.contact_phone IS NOT NULL AND x.message_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_inserir_mensagens(jsonb) FROM PUBLIC, anon, authenticated;

-- p_nomes = [{wid, nome, telefone}]: grava o cache e preenche as mensagens que estavam sem autor
CREATE OR REPLACE FUNCTION public.whatsapp_aplicar_nomes(p_nomes jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  INSERT INTO public.whatsapp_wa_nomes (wid, nome, telefone, atualizado_em)
  SELECT x.wid, nullif(btrim(x.nome), ''),
         CASE WHEN x.telefone ~ '^\d{10,15}$' THEN x.telefone END, now()
    FROM jsonb_to_recordset(p_nomes) AS x(wid text, nome text, telefone text)
   WHERE x.wid ~ '^\d{5,25}@(c\.us|lid)$'
  ON CONFLICT (wid) DO UPDATE
    SET nome = coalesce(EXCLUDED.nome, whatsapp_wa_nomes.nome),
        telefone = coalesce(EXCLUDED.telefone, whatsapp_wa_nomes.telefone),
        atualizado_em = now();

  UPDATE public.whatsapp_messages m
     SET author_name  = coalesce(m.author_name, c.nome),
         author_phone = coalesce(m.author_phone, c.telefone)
    FROM public.whatsapp_wa_nomes c
   WHERE m.author_id = c.wid
     AND c.wid IN (SELECT x.wid FROM jsonb_to_recordset(p_nomes) AS x(wid text))
     AND ((m.author_name IS NULL AND c.nome IS NOT NULL) OR (m.author_phone IS NULL AND c.telefone IS NOT NULL));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_aplicar_nomes(jsonb) FROM PUBLIC, anon, authenticated;

-- 5) cron ----------------------------------------------------------------------------------
INSERT INTO public.integracao_config (chave, valor)
VALUES ('whatsapp_backfill_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;
GRANT SELECT, UPDATE ON TABLE public.integracao_config TO service_role; -- a trava abaixo é UPDATE pela função
-- trava "um tick por vez" (o valor é o horário em que o tick pegou; 1970 = livre)
INSERT INTO public.integracao_config (chave, valor)
VALUES ('whatsapp_backfill_tick_em', '1970-01-01T00:00:00.000Z')
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('whatsapp_backfill_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-backfill')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.whatsapp_backfill_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_backfill_jobs
                  WHERE status IN ('listando', 'importando')
                    AND (ultimo_tick IS NULL OR ultimo_tick < now() - interval '150 seconds'))
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages
                      WHERE media_status = 'pendente' AND media_tentativas < 3)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m
                      WHERE m.author_name IS NULL AND m.author_id IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM public.whatsapp_wa_nomes c
                                         WHERE c.wid = m.author_id AND c.atualizado_em > now() - interval '7 days'))
  THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'whatsapp_backfill_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'whatsapp_backfill_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-backfill-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_backfill_tick() FROM PUBLIC, anon, authenticated;

-- 6) eventos do contato: importação/backfill e grupo não entram nas automações ------------------
CREATE OR REPLACE FUNCTION public.crm_registrar_eventos_contato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  -- grupo nunca é lead; contato que nasceu da importação do histórico não é lead NOVO
  IF coalesce(NEW.is_group, false)
     OR (TG_OP = 'INSERT' AND NEW.source IN ('whatsapp-backfill', 'whatsapp-importacao', 'whatsapp-grupo')) THEN
    RETURN NEW;
  END IF;
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

COMMIT;

-- Realtime da barra de progresso (ignora se já estiver na publicação)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_backfill_jobs;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

SELECT cron.unschedule('whatsapp-backfill-tick')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-backfill-tick');
SELECT cron.schedule('whatsapp-backfill-tick', '* * * * *', 'SELECT public.whatsapp_backfill_tick()');

-- Conferência:
--   SELECT public.whatsapp_backfill_tick();            -- 'nada a fazer' / 'chamado'
--   SELECT status, total_chats, chats_feitos, msgs_importadas, midias FROM whatsapp_backfill_jobs ORDER BY criado_em DESC LIMIT 1;
