-- =============================================================
-- 17/10/2026 — Conversas antigas no topo da lista (backfill)
-- Rodar no SQL editor do Lovable Cloud, BLOCO A BLOCO, na ordem. Nenhum DELETE/DROP.
-- Depois destes blocos: migration supabase/migrations/20261027120000_crm_conversas_ultimas.sql.
-- =============================================================

-- A) PAUSAR o backfill em curso (sem cancelar: a fila e o progresso ficam).
--    O tick só pega job com ultimo_tick nulo ou antigo; data no futuro = ninguém pega.
--    Se um tick estiver no meio, ele zera ultimo_tick ao terminar: rode A de novo após 2 min e confira.
UPDATE public.whatsapp_backfill_jobs
   SET ultimo_tick = now() + interval '10 years', atualizado_em = now()
 WHERE status IN ('listando', 'importando');
SELECT id, status, ultimo_tick, chats_feitos, total_chats, msgs_importadas
  FROM public.whatsapp_backfill_jobs ORDER BY criado_em DESC LIMIT 1;

-- B) Janela de 90 dias no job EM CURSO (funciona com a edge function já publicada: ela só consome
--    'pendente'). ts vem do WhatsApp em segundos (ou ms; os dois casos cobertos).
INSERT INTO public.integracao_config (chave, valor) VALUES ('backfill_dias', '90')
ON CONFLICT (chave) DO NOTHING;

WITH j AS (
  SELECT id FROM public.whatsapp_backfill_jobs WHERE status IN ('listando', 'importando')
  ORDER BY criado_em DESC LIMIT 1
), corte AS (SELECT extract(epoch FROM now() - interval '90 days') AS seg)
UPDATE public.whatsapp_backfill_chats c
   SET status = 'pulado', erro = 'fora da janela de 90 dias', feito_em = now()
  FROM j, corte
 WHERE c.job_id = j.id AND c.status = 'pendente'
   AND (c.ts < corte.seg OR (c.ts >= 100000000000 AND c.ts < corte.seg * 1000));

UPDATE public.whatsapp_backfill_jobs b
   SET total_chats = (SELECT count(*) FROM public.whatsapp_backfill_chats c WHERE c.job_id = b.id AND c.status <> 'pulado'),
       atualizado_em = now()
 WHERE b.status IN ('listando', 'importando');

SELECT status, count(*) FROM public.whatsapp_backfill_chats
 WHERE job_id = (SELECT id FROM public.whatsapp_backfill_jobs ORDER BY criado_em DESC LIMIT 1)
 GROUP BY status;

-- C) Desfazer o updated_at/created_at = "agora" dos contatos que o backfill/importação CRIOU
--    (kanban ordena e mostra a data por updated_at). Só contato de origem importação, criado a
--    partir do 1º job, e que ninguém mexeu depois (updated_at até 5 min do created_at: etapa
--    movida à mão fica como está). Data nova = última mensagem real; sem mensagem, o horário do
--    chat na fila do backfill; sem os dois, não mexe.
WITH alvo AS (
  SELECT k.id, k.phone
    FROM public.whatsapp_contacts k
   WHERE k.source IN ('whatsapp-backfill', 'whatsapp-grupo', 'whatsapp-importacao')
     AND k.created_at >= (SELECT min(criado_em) FROM public.whatsapp_backfill_jobs)
     AND k.updated_at <= k.created_at + interval '5 minutes'
), datas AS (
  SELECT a.id,
         coalesce(
           (SELECT max(m.created_at) FROM public.whatsapp_messages m WHERE m.contact_phone = a.phone),
           (SELECT to_timestamp(CASE WHEN max(c.ts) >= 100000000000 THEN max(c.ts) / 1000.0 ELSE max(c.ts) END)
              FROM public.whatsapp_backfill_chats c WHERE c.phone = a.phone AND c.ts > 0)
         ) AS quando
    FROM alvo a
)
UPDATE public.whatsapp_contacts k
   SET updated_at = d.quando, created_at = least(k.created_at, d.quando)
  FROM datas d
 WHERE k.id = d.id AND d.quando IS NOT NULL AND d.quando < k.updated_at;

-- conferência: nenhum contato de importação com data de hoje sem mensagem de hoje
SELECT count(*) AS ainda_com_data_de_hoje
  FROM public.whatsapp_contacts k
 WHERE k.source IN ('whatsapp-backfill', 'whatsapp-grupo', 'whatsapp-importacao')
   AND k.updated_at >= date_trunc('day', now())
   AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m
                    WHERE m.contact_phone = k.phone AND m.created_at >= date_trunc('day', now()));

-- D) RETOMAR o backfill (depois de B; com a edge function nova publicada, a janela vale sozinha).
UPDATE public.whatsapp_backfill_jobs SET ultimo_tick = NULL, atualizado_em = now()
 WHERE status IN ('listando', 'importando');
