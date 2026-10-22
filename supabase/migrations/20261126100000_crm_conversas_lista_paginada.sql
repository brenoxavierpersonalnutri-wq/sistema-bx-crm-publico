-- =============================================================
-- /crm/conversas: lista paginada pelo servidor (21/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. Não apaga dado nenhum.
--
-- Por quê: a lista baixava ~2 MB a cada abertura e a cada 30 s (todos os contatos + 2000 mensagens + o resumo
-- crm_conversas_ultimas, que fazia um LATERAL por contato: 111 a 2.626 ms). Agora:
--  1) whatsapp_contacts ganha três colunas mantidas pelo banco:
--       ultima_msg_em      = created_at da última mensagem da conversa (a ORDEM da lista; nunca updated_at)
--       ultima_recebida_em = a última que CHEGOU pelo webhook (importada não conta) — não lida sem contar linhas
--       lista_mudou_em     = hora do servidor da última mudança na linha (mensagem nova OU contato editado):
--                            é por ela que a tela busca só o que mudou (delta), sem baixar tudo de novo
--  2) crm_conversas_pagina: 60 conversas por vez, cursor (ultima_msg_em, id), filtros Número / Atendente /
--     aba (Não lidas, Grupos, Sem conversa, departamento, etapa, tag) e busca na lista inteira; também o delta
--     (p_desde) e conversas pedidas pela chave (link ?abrir=).
--  3) crm_conversas_contadores: os números das abas numa consulta leve (só whatsapp_contacts, sem mensagens).
--
-- Segurança: as duas RPCs são SECURITY INVOKER — passam pelas policies "crm_acesso: ler" de whatsapp_contacts e
-- whatsapp_messages (número, atendente, departamento). O usuário restrito só recebe o que já podia ler.
-- Os triggers são SECURITY DEFINER só para gravar as três colunas (o webhook roda como service_role de todo jeito).
-- =============================================================

BEGIN;

-- 1) colunas ----------------------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ultima_msg_em timestamptz;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ultima_recebida_em timestamptz;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS lista_mudou_em timestamptz NOT NULL DEFAULT now();

-- busca sem acento (sem depender da extensão unaccent)
CREATE OR REPLACE FUNCTION public.crm_sem_acento(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$$;

-- 2) contato: lista_mudou_em a cada mudança; ao nascer (ou trocar de telefone/número) lê as últimas do banco ---
CREATE OR REPLACE FUNCTION public.crm_contato_lista_mudou()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.lista_mudou_em := now();
  IF TG_OP = 'INSERT' OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.numero_id IS DISTINCT FROM OLD.numero_id THEN
    NEW.ultima_msg_em := (
      SELECT w.created_at FROM public.whatsapp_messages w
       WHERE w.numero_id = NEW.numero_id AND w.contact_phone = NEW.phone
       ORDER BY w.created_at DESC LIMIT 1);
    NEW.ultima_recebida_em := (
      SELECT w.created_at FROM public.whatsapp_messages w
       WHERE w.numero_id = NEW.numero_id AND w.contact_phone = NEW.phone
         AND w.direction IS DISTINCT FROM 'outbound' AND NOT w.importada
       ORDER BY w.created_at DESC LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_contato_lista_mudou() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_contato_lista_mudou ON public.whatsapp_contacts;
CREATE TRIGGER trg_crm_contato_lista_mudou
BEFORE INSERT OR UPDATE ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_contato_lista_mudou();

-- 3) mensagem nova: avança as colunas do contato (um UPDATE por conversa do lote, não por mensagem) ---------
CREATE OR REPLACE FUNCTION public.crm_contato_ultima_msg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_contacts c
     SET ultima_msg_em = greatest(c.ultima_msg_em, n.ultima),
         ultima_recebida_em = greatest(c.ultima_recebida_em, n.recebida)
    FROM (
      SELECT numero_id, contact_phone,
             max(created_at) AS ultima,
             max(created_at) FILTER (WHERE direction IS DISTINCT FROM 'outbound' AND NOT importada) AS recebida
        FROM novas
       GROUP BY numero_id, contact_phone
    ) n
   WHERE c.numero_id = n.numero_id AND c.phone = n.contact_phone
     -- histórico importado mais velho que a última não mexe no contato (nem dispara Realtime à toa)
     AND (c.ultima_msg_em IS NULL OR n.ultima > c.ultima_msg_em
          OR (n.recebida IS NOT NULL AND (c.ultima_recebida_em IS NULL OR n.recebida > c.ultima_recebida_em)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_contato_ultima_msg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_contato_ultima_msg ON public.whatsapp_messages;
CREATE TRIGGER trg_crm_contato_ultima_msg
AFTER INSERT ON public.whatsapp_messages
REFERENCING NEW TABLE AS novas
FOR EACH STATEMENT EXECUTE FUNCTION public.crm_contato_ultima_msg();

-- 4) preencher o que já existe (só quem ainda não tem: rodar de novo não refaz) ----------------------------
UPDATE public.whatsapp_contacts c
   SET ultima_msg_em = (
         SELECT w.created_at FROM public.whatsapp_messages w
          WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
          ORDER BY w.created_at DESC LIMIT 1),
       ultima_recebida_em = (
         SELECT w.created_at FROM public.whatsapp_messages w
          WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
            AND w.direction IS DISTINCT FROM 'outbound' AND NOT w.importada
          ORDER BY w.created_at DESC LIMIT 1)
 WHERE c.ultima_msg_em IS NULL
   AND EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone);

-- 5) índices: a ordem da lista (cursor) e o delta ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS whatsapp_contacts_lista_idx
  ON public.whatsapp_contacts ((coalesce(ultima_msg_em, '-infinity'::timestamptz)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_lista_mudou_idx ON public.whatsapp_contacts (lista_mudou_em);
-- o LATERAL da última mensagem e a contagem de não lidas usam este (já existe desde 20261028100000)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_numero_phone_created
  ON public.whatsapp_messages (numero_id, contact_phone, created_at DESC);

-- 6) página da lista -------------------------------------------------------------------------------------
-- p_filtro: tudo · nao-lidas · grupos · sem-conversa · canal:whatsapp · canal:instagram · etapa:<slug> ·
--           tag:<nome> · dep:<uuid>       p_atendente: todos · sem · ia · u:<uuid>
-- p_desde: só o que mudou depois (delta; ignora filtros e busca)  p_chaves: estas conversas ("<numero>|<phone>" ou phone)
-- Cursor: (p_cursor_em, p_cursor_id) = ordem_em e contato.id da última linha recebida; ordem_em nulo vira '-infinity'.
DROP FUNCTION IF EXISTS public.crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer);
CREATE FUNCTION public.crm_conversas_pagina(
  p_base       timestamptz DEFAULT NULL,
  p_leituras   jsonb       DEFAULT '{}'::jsonb,
  p_marcadas   text[]      DEFAULT '{}'::text[],
  p_numero_id  uuid        DEFAULT NULL,
  p_ocultos    uuid[]      DEFAULT '{}'::uuid[],
  p_atendente  text        DEFAULT 'todos',
  p_filtro     text        DEFAULT 'tudo',
  p_busca      text        DEFAULT NULL,
  p_cursor_em  timestamptz DEFAULT NULL,
  p_cursor_id  uuid        DEFAULT NULL,
  p_desde      timestamptz DEFAULT NULL,
  p_chaves     text[]      DEFAULT NULL,
  p_limite     integer     DEFAULT 60
)
RETURNS TABLE (contato jsonb, ultima jsonb, nao_lidas integer, ordem_em timestamptz, consultado_em timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH prm AS (
    SELECT nullif(public.crm_sem_acento(btrim(coalesce(p_busca, ''))), '') AS q,
           regexp_replace(coalesce(p_busca, ''), '\D', '', 'g') AS qdig,
           coalesce(p_filtro, 'tudo') AS f,
           coalesce(p_atendente, 'todos') AS a,
           CASE WHEN p_filtro ~ '^dep:[0-9a-fA-F-]{36}$' THEN substr(p_filtro, 5)::uuid END AS dep_id
  ),
  dep AS (
    SELECT prm.*, (SELECT d.regra FROM public.crm_departamentos d WHERE d.id = prm.dep_id) AS dep_regra FROM prm
  )
  SELECT to_jsonb(c),
         to_jsonb(m),
         CASE WHEN m.id IS NULL OR k.corte IS NULL OR coalesce(c.ultima_recebida_em <= k.corte, false) THEN 0 ELSE (
           SELECT count(*)::int FROM (
             SELECT 1 FROM public.whatsapp_messages n
              WHERE n.numero_id = c.numero_id AND n.contact_phone = c.phone
                AND n.created_at > k.corte AND n.direction IS DISTINCT FROM 'outbound' AND NOT n.importada
              LIMIT 100) s
         ) END,
         c.ultima_msg_em,
         now()
    FROM public.whatsapp_contacts c
    CROSS JOIN dep p
    CROSS JOIN LATERAL (
      SELECT c.numero_id::text || '|' || c.phone AS chave,
             (nullif(c.ai_agent_slug, '') IS NOT NULL AND NOT coalesce(c.ai_pausado, false)) AS ia,
             (coalesce(c.is_group, false)
               OR (c.phone NOT LIKE 'ig:%' AND (c.phone ~* '@g\.us$' OR c.phone ~ '^\d+-\d+$'
                   OR length(regexp_replace(c.phone, '\D', '', 'g')) >= 18))) AS grupo,
             greatest(
               CASE WHEN coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone, '')
                         ~ '^\d{4}-\d{2}-\d{2}T'
                    THEN coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone)::timestamptz END,
               p_base) AS corte
    ) k
    LEFT JOIN LATERAL (
      SELECT w.id, w.numero_id, w.contact_phone, w.body, w.caption, w.created_at, w.direction, w.sender_type, w.status,
             w.media_url, w.media_type, w.mime_type, w.file_name, w.message_id,
             w.author_name, w.author_phone, w.author_id, w.media_path, w.media_status, w.importada
        FROM public.whatsapp_messages w
       WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
       ORDER BY w.created_at DESC
       LIMIT 1
    ) m ON true
   WHERE (c.numero_id IS NULL OR NOT (c.numero_id = ANY (coalesce(p_ocultos, '{}'::uuid[]))))
     -- cursor: (ordem, id) depois da última linha recebida
     AND (coalesce(c.ultima_msg_em, '-infinity'::timestamptz), c.id)
         < (coalesce(p_cursor_em, 'infinity'::timestamptz), coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     AND (p_desde IS NULL OR c.lista_mudou_em > p_desde)
     AND (p_chaves IS NULL OR k.chave = ANY (p_chaves) OR c.phone = ANY (p_chaves))
     -- delta e conversa pedida pela chave ignoram filtros e busca (a tela filtra o que recebe)
     AND (p_desde IS NOT NULL OR p_chaves IS NOT NULL OR (
           -- Número
           (p_numero_id IS NULL OR c.numero_id = p_numero_id)
           -- Atendente
           AND (p.a = 'todos'
             OR (p.a = 'ia' AND k.ia)
             OR (p.a = 'sem' AND c.atendente_id IS NULL AND NOT k.ia)
             OR (p.a LIKE 'u:%' AND c.atendente_id::text = substr(p.a, 3)))
           -- aba
           AND CASE
             WHEN p.f = 'sem-conversa' THEN c.ultima_msg_em IS NULL
             WHEN c.ultima_msg_em IS NULL AND p.q IS NULL AND length(p.qdig) < 3 THEN false  -- sem conversa só aparece na busca
             WHEN p.f = 'nao-lidas' THEN coalesce(c.ultima_recebida_em > k.corte, false)
                                         OR k.chave = ANY (coalesce(p_marcadas, '{}'::text[]))
                                         OR c.phone = ANY (coalesce(p_marcadas, '{}'::text[]))
             WHEN p.f = 'grupos' THEN k.grupo
             WHEN p.f = 'canal:instagram' THEN false
             WHEN p.f LIKE 'etapa:%' THEN c.stage = substr(p.f, 7)
             WHEN p.f LIKE 'tag:%' THEN substr(p.f, 5) = ANY (coalesce(c.tags, '{}'::text[]))
             WHEN p.f LIKE 'dep:%' THEN NOT k.grupo AND p.dep_regra IS NOT NULL AND (
               (p.dep_regra = 'ia' AND k.ia)
               OR (p.dep_regra <> 'ia' AND NOT k.ia AND c.departamento_id = p.dep_id))
             ELSE true
           END
           -- busca na lista inteira: nome, telefone (3+ dígitos) ou a prévia da última mensagem
           AND ((p.q IS NULL AND length(p.qdig) < 3)
             OR (p.q IS NOT NULL AND position(p.q IN public.crm_sem_acento(c.name)) > 0)
             OR (length(p.qdig) >= 3 AND position(p.qdig IN regexp_replace(c.phone, '\D', '', 'g')) > 0)
             OR (p.q IS NOT NULL AND position(p.q IN public.crm_sem_acento(coalesce(nullif(m.caption, ''), m.body))) > 0))
         ))
   ORDER BY coalesce(c.ultima_msg_em, '-infinity'::timestamptz) DESC, c.id DESC
   LIMIT CASE WHEN p_desde IS NOT NULL THEN 500 ELSE least(greatest(coalesce(p_limite, 60), 1), 200) END;
$$;
REVOKE ALL ON FUNCTION public.crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer) TO authenticated, service_role;

-- 7) contadores das abas (só whatsapp_contacts: nenhuma mensagem é lida) -----------------------------------
DROP FUNCTION IF EXISTS public.crm_conversas_contadores(timestamptz, jsonb, text[], uuid, uuid[], text);
CREATE FUNCTION public.crm_conversas_contadores(
  p_base      timestamptz DEFAULT NULL,
  p_leituras  jsonb       DEFAULT '{}'::jsonb,
  p_marcadas  text[]      DEFAULT '{}'::text[],
  p_numero_id uuid        DEFAULT NULL,
  p_ocultos   uuid[]      DEFAULT '{}'::uuid[],
  p_atendente text        DEFAULT 'todos'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH b AS (
    SELECT c.stage, c.tags, c.departamento_id,
           c.ultima_msg_em IS NULL AS sem,
           x.ia,
           (coalesce(c.is_group, false)
             OR (c.phone NOT LIKE 'ig:%' AND (c.phone ~* '@g\.us$' OR c.phone ~ '^\d+-\d+$'
                 OR length(regexp_replace(c.phone, '\D', '', 'g')) >= 18))) AS grupo,
           (coalesce(c.ultima_recebida_em > greatest(
               CASE WHEN coalesce(coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone), '')
                         ~ '^\d{4}-\d{2}-\d{2}T'
                    THEN coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone)::timestamptz END,
               p_base), false)
             OR (c.numero_id::text || '|' || c.phone) = ANY (coalesce(p_marcadas, '{}'::text[]))
             OR c.phone = ANY (coalesce(p_marcadas, '{}'::text[]))) AS nao_lida
      FROM public.whatsapp_contacts c
     CROSS JOIN LATERAL (SELECT (nullif(c.ai_agent_slug, '') IS NOT NULL AND NOT coalesce(c.ai_pausado, false)) AS ia) x
     WHERE (c.numero_id IS NULL OR NOT (c.numero_id = ANY (coalesce(p_ocultos, '{}'::uuid[]))))
       AND (p_numero_id IS NULL OR c.numero_id = p_numero_id)
       AND (coalesce(p_atendente, 'todos') = 'todos'
         OR (p_atendente = 'ia' AND x.ia)
         OR (p_atendente = 'sem' AND c.atendente_id IS NULL AND NOT x.ia)
         OR (p_atendente LIKE 'u:%' AND c.atendente_id::text = substr(p_atendente, 3)))
  )
  SELECT jsonb_build_object(
    'nao_lidas', (SELECT count(*) FROM b WHERE b.nao_lida),
    'sem_conversa', (SELECT count(*) FROM b WHERE b.sem),
    'por_departamento', coalesce((
      SELECT jsonb_object_agg(d.id, (
        SELECT count(*) FROM b
         WHERE NOT b.grupo AND NOT b.sem AND b.nao_lida
           AND ((d.regra = 'ia' AND b.ia) OR (d.regra <> 'ia' AND NOT b.ia AND b.departamento_id = d.id))))
        FROM public.crm_departamentos d), '{}'::jsonb),
    'tags', coalesce((SELECT jsonb_agg(t ORDER BY t) FROM (SELECT DISTINCT t FROM b, unnest(b.tags) t WHERE t <> '') s), '[]'::jsonb),
    'etapas', coalesce((SELECT jsonb_agg(s.stage) FROM (SELECT DISTINCT b.stage FROM b WHERE b.stage IS NOT NULL) s), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.crm_conversas_contadores(timestamptz, jsonb, text[], uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_contadores(timestamptz, jsonb, text[], uuid, uuid[], text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir depois (no SQL editor, como admin):
--   SELECT count(*) FILTER (WHERE ultima_msg_em IS NOT NULL) AS com_msg, count(*) AS total FROM whatsapp_contacts;
--   EXPLAIN ANALYZE SELECT * FROM crm_conversas_pagina(now() - interval '1 day', '{}', '{}', NULL, '{}', 'todos', 'tudo', NULL, NULL, NULL, NULL, NULL, 60);
--   SELECT crm_conversas_contadores(now() - interval '1 day', '{}');
-- Desfazer (a tela volta sozinha ao modo antigo quando a RPC some):
--   DROP FUNCTION crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer);
--   DROP FUNCTION crm_conversas_contadores(timestamptz, jsonb, text[], uuid, uuid[], text);
--   DROP TRIGGER trg_crm_contato_ultima_msg ON whatsapp_messages; DROP TRIGGER trg_crm_contato_lista_mudou ON whatsapp_contacts;
