-- =============================================================
-- /crm/conversas: crm_conversas_pagina rápida (22/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. Não apaga dado nenhum, não mexe em tabela nem em policy.
--
-- O gargalo (medido com auto_explain num Postgres descartável com 30 mil contatos e 430 mil mensagens):
--   a função era LANGUAGE sql com SET search_path, então o Postgres não a "abre" na consulta de quem chama e
--   planeja o corpo UMA vez com os parâmetros desconhecidos (plano genérico). Sem saber que p_desde, p_chaves e
--   p_busca são nulos, ele não consegue simplificar os OR do WHERE, estima 2 linhas e escolhe:
--     Seq Scan em TODOS os contatos -> última mensagem (LATERAL + RLS) de CADA contato -> Sort -> 60 linhas.
--   Ou seja: a primeira página custava o mesmo que ler a lista inteira (30.000 buscas de última mensagem para
--   devolver 60), e cresce com o número de contatos. Além disso, a condição da busca (que olha a última
--   mensagem) estava no mesmo bloco que os filtros do contato, então nem o filtro de aba rodava antes do LATERAL.
--
-- A correção (mesmo retorno, mesmas colunas, mesma ordem, mesmas regras de permissão):
--   1) LANGUAGE plpgsql com RETURN QUERY e SET plan_cache_mode = force_custom_plan: cada chamada é planejada com
--      os valores de verdade, então os OR com parâmetro nulo somem do plano.
--   2) Duas etapas: primeiro escolhe as 60 conversas só pelo contato (anda no índice whatsapp_contacts_lista_idx,
--      que já existe desde a 20261126100000, e para no LIMIT); depois busca a última mensagem e as não lidas só
--      dessas 60. Antes o LATERAL da última mensagem rodava para todo contato que passava no filtro, ANTES do sort.
--   3) A busca virou uma condição separada: (D OU C OU (F E B)) = (D OU C OU F) E (D OU C OU B), o mesmo
--      resultado; a prévia da última mensagem só é lida quando há busca e o nome/telefone não bateu.
--   Continua SECURITY INVOKER: as policies "crm_acesso: ler" de whatsapp_contacts e whatsapp_messages filtram
--   exatamente como antes (número, atendente, departamento), inclusive a mensagem usada na prévia da busca.
--   Os GRANTs são reaplicados iguais. Índice novo: nenhum (os que o plano usa já existem).
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_conversas_pagina(
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET plan_cache_mode = force_custom_plan
AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY
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
  -- 1) escolhe as conversas da página só pelo contato (anda no índice whatsapp_contacts_lista_idx e para no LIMIT)
  SELECT to_jsonb(s.linha),
         to_jsonb(m),
         CASE WHEN m.id IS NULL OR s.corte IS NULL OR coalesce(s.ultima_recebida_em <= s.corte, false) THEN 0 ELSE (
           SELECT count(*)::int FROM (
             SELECT 1 FROM public.whatsapp_messages n
              WHERE n.numero_id = s.numero_id AND n.contact_phone = s.phone
                AND n.created_at > s.corte AND n.direction IS DISTINCT FROM 'outbound' AND NOT n.importada
              LIMIT 100) x
         ) END,
         s.ultima_msg_em,
         now()
    FROM (
      SELECT c AS linha, c.id, c.numero_id, c.phone, c.ultima_msg_em, c.ultima_recebida_em, k.corte
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
           ))
       -- busca na lista inteira: nome, telefone (3+ dígitos) ou a prévia da última mensagem (a mesma que vai em
       -- "ultima": a mais recente que a pessoa pode ler). Separada da condição de cima — (D OU C OU (F E B)) =
       -- (D OU C OU F) E (D OU C OU B) — para os filtros do contato rodarem antes; a prévia só é lida quando há busca
       -- e nome/telefone não bateram.
       AND (p_desde IS NOT NULL OR p_chaves IS NOT NULL OR (
             ((p.q IS NULL AND length(p.qdig) < 3)
               OR (p.q IS NOT NULL AND position(p.q IN public.crm_sem_acento(c.name)) > 0)
               OR (length(p.qdig) >= 3 AND position(p.qdig IN regexp_replace(c.phone, '\D', '', 'g')) > 0)
               OR (p.q IS NOT NULL AND position(p.q IN public.crm_sem_acento((
                     SELECT coalesce(nullif(w.caption, ''), w.body) FROM public.whatsapp_messages w
                      WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
                      ORDER BY w.created_at DESC
                      LIMIT 1))) > 0))
           ))
       ORDER BY coalesce(c.ultima_msg_em, '-infinity'::timestamptz) DESC, c.id DESC
       LIMIT CASE WHEN p_desde IS NOT NULL THEN 500 ELSE least(greatest(coalesce(p_limite, 60), 1), 200) END
    ) s
    -- 2) a última mensagem (e as não lidas) só das conversas escolhidas
    LEFT JOIN LATERAL (
      SELECT w.id, w.numero_id, w.contact_phone, w.body, w.caption, w.created_at, w.direction, w.sender_type, w.status,
             w.media_url, w.media_type, w.mime_type, w.file_name, w.message_id,
             w.author_name, w.author_phone, w.author_id, w.media_path, w.media_status, w.importada
        FROM public.whatsapp_messages w
       WHERE w.numero_id = s.numero_id AND w.contact_phone = s.phone
       ORDER BY w.created_at DESC
       LIMIT 1
    ) m ON true
   ORDER BY coalesce(s.ultima_msg_em, '-infinity'::timestamptz) DESC, s.id DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_pagina(timestamptz, jsonb, text[], uuid, uuid[], text, text, text, timestamptz, uuid, timestamptz, text[], integer) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir depois (no SQL editor, como admin):
--   SELECT p.prolang::reglanguage, p.proconfig FROM pg_proc p WHERE p.proname = 'crm_conversas_pagina';
--     -> plpgsql | {search_path=public,plan_cache_mode=force_custom_plan}
--   SELECT count(*) FROM crm_conversas_pagina(now() - interval '1 day', '{}', '{}', NULL, '{}', 'todos', 'tudo', NULL, NULL, NULL, NULL, NULL, 60);
-- Desfazer: rodar de novo só a seção 6 da 20261126100000_crm_conversas_lista_paginada.sql (DROP + CREATE da versão sql).
