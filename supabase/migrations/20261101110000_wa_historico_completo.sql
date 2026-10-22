-- =============================================================
-- WhatsApp: histórico completo por número, com pausa (18/10/2026)
-- =============================================================
-- 1) whatsapp_backfill_jobs.completo: job do botão "Trazer histórico completo" (tela Conexões). Sem janela de
--    dias (backfill_dias), até 2000 mensagens por conversa, sem baixar mídia.
-- 2) status 'pausado' (o tick e o pg_cron só pegam listando/importando: pausado fica parado até "retomar").
-- 3) Contato que nasce do histórico completo tem source 'whatsapp-historico' e NÃO gera evento: nem de etapa
--    (crm_registrar_eventos_contato) nem de "contato novo do WhatsApp" para fluxos (crm_evt_contato_whatsapp).
--    Conversa de anos atrás não é lead novo; sem isso, um fluxo de "contato novo" mandaria mensagem para
--    milhares de contatos antigos. A troca é por texto dentro da função que está no banco (não reescreve o
--    resto dela); se o trecho esperado não existir, avisa e não muda nada.
-- Idempotente. Rodar DEPOIS de 20261101100100_wa_placeholder_reparo_importada.sql.
-- =============================================================

BEGIN;

ALTER TABLE public.whatsapp_backfill_jobs ADD COLUMN IF NOT EXISTS completo boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  r record;
BEGIN
  -- o CHECK de status (criado inline em 20261025100000) ganha 'pausado'
  FOR r IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.whatsapp_backfill_jobs'::regclass AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%' AND pg_get_constraintdef(con.oid) NOT ILIKE '%pausado%'
  LOOP
    EXECUTE format('ALTER TABLE public.whatsapp_backfill_jobs DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_backfill_jobs_status_chk') THEN
    ALTER TABLE public.whatsapp_backfill_jobs ADD CONSTRAINT whatsapp_backfill_jobs_status_chk
      CHECK (status IN ('listando', 'importando', 'pausado', 'concluido', 'cancelado', 'erro'));
  END IF;
END $$;

-- 3) eventos: 'whatsapp-historico' fora -------------------------------------------------------------
DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.crm_registrar_eventos_contato()'::regprocedure);
  IF def NOT ILIKE '%whatsapp-historico%' THEN
    novo := replace(def, '''whatsapp-grupo'')', '''whatsapp-grupo'', ''whatsapp-historico'')');
    IF novo = def THEN
      RAISE WARNING 'crm_registrar_eventos_contato: trecho esperado não encontrado, nada mudou (conferir à mão)';
    ELSE
      EXECUTE novo;
    END IF;
  END IF;

  def := pg_get_functiondef('public.crm_evt_contato_whatsapp()'::regprocedure);
  IF def NOT ILIKE '%whatsapp-historico%' THEN
    novo := replace(def, 'IF coalesce(NEW.is_group, false) OR NEW.phone LIKE ''%@%'' THEN',
                         'IF coalesce(NEW.is_group, false) OR NEW.phone LIKE ''%@%'' OR NEW.source = ''whatsapp-historico'' THEN');
    IF novo = def THEN
      RAISE WARNING 'crm_evt_contato_whatsapp: trecho esperado não encontrado, nada mudou (conferir à mão)';
    ELSE
      EXECUTE novo;
    END IF;
  END IF;
END $$;

COMMIT;

-- Conferir:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'whatsapp_backfill_jobs_status_chk';
--   SELECT prosrc ILIKE '%whatsapp-historico%' FROM pg_proc WHERE proname IN ('crm_registrar_eventos_contato', 'crm_evt_contato_whatsapp');
--   SELECT id, numero_id, status, completo, total_chats, chats_feitos FROM whatsapp_backfill_jobs ORDER BY criado_em DESC LIMIT 5;
