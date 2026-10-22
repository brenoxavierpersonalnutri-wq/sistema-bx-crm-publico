-- =============================================================
-- Mescla contatos duplicados do CRM de WhatsApp. Rodar DEPOIS de 20261025100000. Idempotente
-- (na segunda vez não acha mais pares).
--
-- De onde vieram (lido no código, 17/10/2026): a importação da UazAPI (até 16/10) tirava o "telefone"
-- dos dígitos de QUALQUER id de chat (`phoneFromJid(c.id ?? c.chatid ...)`), então grupo e @lid
-- viraram contatos com número inventado, nome do grupo, etapa Leads e sem mensagem nenhuma. Quando
-- o OpenWA passou a gravar grupo pelo JID (…@g.us), o grupo apareceu de novo ao lado da cópia velha.
-- Além disso, celular BR com e sem o nono dígito (WhatsApp antigo x formulário) vira dois contatos.
--
-- Pares (removido -> mantido), só quando a regra é inequívoca:
--  A) grupo: contato NÃO-grupo, SEM mensagens, cujo nome é igual (sem caixa/espaço) ao de UM grupo
--     (phone …@g.us) -> mantém o grupo;
--  B) celular BR com/sem 9 (55+DDD+9+8 x 55+DDD+8) -> mantém o que tem mais mensagens
--     (empate: o mais antigo);
--  C) contato SEM mensagens com "telefone" que não é número BR (não começa com 55, 14+ dígitos: id
--     @lid gravado como número) e nome igual ao de EXATAMENTE um contato com mensagens -> mantém esse.
-- No mantido: mensagens e histórico de automação passam pra ele; etapa = a mais avançada entre os
-- dois (se o mantido está em 'leads' e o removido não); tags = união; notas = juntas; nome real
-- no lugar de "Grupo"/número. O trigger de eventos fica desligado durante a mescla (mudar a etapa
-- aqui não pode disparar automação).
-- Backup: bkp_wa_mescla_contatos_20261025 (linha inteira do removido e do mantido ANTES, em jsonb) e
-- bkp_wa_mescla_mensagens_20261025 (id da mensagem e telefone antigo). Ambas com RLS e sem política:
-- só service role / SQL editor leem.
--
-- PRÉVIA (rode antes, só leitura): o bloco "pares" abaixo até o SELECT de conferência, trocando o
-- CREATE TEMP TABLE por um SELECT. Desfazer: ver o fim do arquivo.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.bkp_wa_mescla_contatos_20261025 (
  id           bigserial PRIMARY KEY,
  feito_em     timestamptz NOT NULL DEFAULT now(),
  motivo       text NOT NULL,
  papel        text NOT NULL CHECK (papel IN ('removido', 'mantido_antes')),
  contato_id   uuid NOT NULL,
  phone        text NOT NULL,
  mantido_id   uuid NOT NULL,
  linha        jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public.bkp_wa_mescla_mensagens_20261025 (
  mensagem_id   uuid PRIMARY KEY,
  phone_antigo  text NOT NULL,
  phone_novo    text NOT NULL,
  feito_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bkp_wa_mescla_contatos_20261025 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_wa_mescla_mensagens_20261025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bkp_wa_mescla_contatos_20261025 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bkp_wa_mescla_mensagens_20261025 FROM PUBLIC, anon, authenticated;

-- contagem de mensagens por contato
CREATE TEMP TABLE _wa_qtd ON COMMIT DROP AS
SELECT c.id, c.phone, c.name, c.is_group, c.created_at,
       lower(btrim(c.name)) AS nome_norm,
       coalesce(m.n, 0) AS msgs
  FROM public.whatsapp_contacts c
  LEFT JOIN (SELECT contact_phone, count(*) AS n FROM public.whatsapp_messages GROUP BY contact_phone) m
         ON m.contact_phone = c.phone;

CREATE TEMP TABLE _wa_pares (removido_id uuid, mantido_id uuid, motivo text) ON COMMIT DROP;

-- A) cópia velha de grupo
INSERT INTO _wa_pares
SELECT o.id, g.id, 'A: cópia de grupo sem mensagens'
  FROM _wa_qtd o
  JOIN _wa_qtd g ON g.nome_norm = o.nome_norm AND g.phone ~ '@g\.us$'
 WHERE o.phone !~ '@' AND NOT o.is_group AND o.msgs = 0
   AND o.nome_norm <> '' AND o.nome_norm NOT IN ('grupo', 'participante')
   AND (SELECT count(*) FROM _wa_qtd g2 WHERE g2.nome_norm = o.nome_norm AND g2.phone ~ '@g\.us$') = 1;

-- B) celular BR com e sem o 9
INSERT INTO _wa_pares
SELECT CASE WHEN a.msgs > b.msgs OR (a.msgs = b.msgs AND a.created_at <= b.created_at) THEN b.id ELSE a.id END,
       CASE WHEN a.msgs > b.msgs OR (a.msgs = b.msgs AND a.created_at <= b.created_at) THEN a.id ELSE b.id END,
       'B: celular BR com/sem 9'
  FROM _wa_qtd a
  JOIN _wa_qtd b ON a.phone ~ '^55[1-9][0-9]9[6-9][0-9]{7}$'
                AND b.phone = substr(a.phone, 1, 4) || substr(a.phone, 6)
 WHERE NOT a.is_group AND NOT b.is_group
   AND NOT EXISTS (SELECT 1 FROM _wa_pares p WHERE p.removido_id IN (a.id, b.id) OR p.mantido_id IN (a.id, b.id));

-- C) @lid gravado como número, sem mensagens, com nome igual ao de UM contato com mensagens
INSERT INTO _wa_pares
SELECT o.id, k.id, 'C: id @lid antigo com o mesmo nome'
  FROM _wa_qtd o
  JOIN _wa_qtd k ON k.nome_norm = o.nome_norm AND k.id <> o.id AND k.msgs > 0 AND NOT k.is_group
 WHERE o.msgs = 0 AND NOT o.is_group AND o.phone ~ '^[0-9]{14,}$' AND o.phone !~ '^55'
   AND o.nome_norm <> '' AND o.nome_norm !~ '^[0-9+() -]+$'
   AND (SELECT count(*) FROM _wa_qtd k2 WHERE k2.nome_norm = o.nome_norm AND k2.id <> o.id AND k2.msgs > 0) = 1
   AND NOT EXISTS (SELECT 1 FROM _wa_pares p WHERE p.removido_id IN (o.id, k.id) OR p.mantido_id = o.id);

-- sem cadeia: quem é mantido não pode ser removido em outro par (fica pra uma segunda rodada)
DELETE FROM _wa_pares p WHERE EXISTS (SELECT 1 FROM _wa_pares q WHERE q.removido_id = p.mantido_id);
-- um destino por removido
DELETE FROM _wa_pares p
 WHERE EXISTS (SELECT 1 FROM _wa_pares q WHERE q.removido_id = p.removido_id AND q.ctid < p.ctid);

-- backup ANTES de mexer
INSERT INTO public.bkp_wa_mescla_contatos_20261025 (motivo, papel, contato_id, phone, mantido_id, linha)
SELECT p.motivo, 'removido', c.id, c.phone, p.mantido_id, to_jsonb(c)
  FROM _wa_pares p JOIN public.whatsapp_contacts c ON c.id = p.removido_id;
INSERT INTO public.bkp_wa_mescla_contatos_20261025 (motivo, papel, contato_id, phone, mantido_id, linha)
SELECT DISTINCT ON (c.id) p.motivo, 'mantido_antes', c.id, c.phone, c.id, to_jsonb(c)
  FROM _wa_pares p JOIN public.whatsapp_contacts c ON c.id = p.mantido_id;

CREATE TEMP TABLE _wa_mapa ON COMMIT DROP AS
SELECT r.id AS removido_id, r.phone AS de, k.id AS mantido_id, k.phone AS para
  FROM _wa_pares p
  JOIN public.whatsapp_contacts r ON r.id = p.removido_id
  JOIN public.whatsapp_contacts k ON k.id = p.mantido_id;

INSERT INTO public.bkp_wa_mescla_mensagens_20261025 (mensagem_id, phone_antigo, phone_novo)
SELECT m.id, m.contact_phone, x.para
  FROM public.whatsapp_messages m JOIN _wa_mapa x ON x.de = m.contact_phone
ON CONFLICT (mensagem_id) DO NOTHING;

ALTER TABLE public.whatsapp_contacts DISABLE TRIGGER trg_crm_eventos_contato;

-- mensagens e históricos
UPDATE public.whatsapp_messages m SET contact_phone = x.para FROM _wa_mapa x WHERE m.contact_phone = x.de;
UPDATE public.crm_contato_eventos t SET contact_phone = x.para FROM _wa_mapa x WHERE t.contact_phone = x.de;
UPDATE public.crm_automacao_log t SET contact_phone = x.para FROM _wa_mapa x WHERE t.contact_phone = x.de;
UPDATE public.crm_roteiro_envios t SET contact_phone = x.para FROM _wa_mapa x WHERE t.contact_phone = x.de;
UPDATE public.crm_ai_eventos t SET contact_phone = x.para FROM _wa_mapa x WHERE t.contact_phone = x.de;
-- fila e execuções têm índice único por contato: só move o que não colide
UPDATE public.crm_automacao_fila t SET contact_phone = x.para FROM _wa_mapa x
 WHERE t.contact_phone = x.de
   AND NOT EXISTS (SELECT 1 FROM public.crm_automacao_fila f WHERE f.contact_phone = x.para
                    AND ((f.automacao_id IS NOT NULL AND f.automacao_id = t.automacao_id)
                      OR (f.campanha_id IS NOT NULL AND f.campanha_id = t.campanha_id)));
UPDATE public.crm_fluxo_execucoes t SET contact_phone = x.para FROM _wa_mapa x
 WHERE t.contact_phone = x.de
   AND NOT (t.status = 'ativo' AND EXISTS (SELECT 1 FROM public.crm_fluxo_execucoes f
                                             WHERE f.contact_phone = x.para AND f.fluxo_id = t.fluxo_id AND f.status = 'ativo'));

-- o mantido herda o que o removido tinha de mais completo
UPDATE public.whatsapp_contacts k
   SET stage = CASE WHEN k.stage = 'leads' AND r.stage <> 'leads' THEN r.stage ELSE k.stage END,
       tags  = (SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}') FROM unnest(coalesce(k.tags, '{}') || coalesce(r.tags, '{}')) AS t),
       notes = CASE WHEN coalesce(btrim(r.notes), '') = '' OR coalesce(k.notes, '') LIKE '%' || r.notes || '%' THEN k.notes
                    WHEN coalesce(btrim(k.notes), '') = '' THEN r.notes
                    ELSE k.notes || E'\n' || r.notes END,
       name  = CASE WHEN (k.name IS NULL OR btrim(k.name) IN ('', 'Grupo') OR k.name ~ '^[0-9+() -]+$')
                         AND coalesce(btrim(r.name), '') <> '' AND r.name !~ '^[0-9+() -]+$'
                    THEN r.name ELSE k.name END,
       ai_agent_slug = coalesce(k.ai_agent_slug, r.ai_agent_slug),
       updated_at = greatest(k.updated_at, r.updated_at)
  FROM _wa_mapa x JOIN public.whatsapp_contacts r ON r.id = x.removido_id
 WHERE k.id = x.mantido_id;

DELETE FROM public.whatsapp_contacts c USING _wa_mapa x WHERE c.id = x.removido_id;

ALTER TABLE public.whatsapp_contacts ENABLE TRIGGER trg_crm_eventos_contato;

-- conferência (aparece no resultado do SQL editor)
SELECT motivo, count(*) AS pares
  FROM public.bkp_wa_mescla_contatos_20261025
 WHERE papel = 'removido' AND feito_em = now()  -- só os desta execução
 GROUP BY motivo ORDER BY motivo;

COMMIT;

-- DESFAZER (se precisar), numa transação:
--   ALTER TABLE whatsapp_contacts DISABLE TRIGGER trg_crm_eventos_contato;
--   INSERT INTO whatsapp_contacts
--     SELECT (jsonb_populate_record(NULL::public.whatsapp_contacts, linha)).*
--       FROM bkp_wa_mescla_contatos_20261025 WHERE papel = 'removido';
--   UPDATE whatsapp_messages m SET contact_phone = b.phone_antigo
--     FROM bkp_wa_mescla_mensagens_20261025 b WHERE b.mensagem_id = m.id;
--   UPDATE whatsapp_contacts c SET stage = (b.linha->>'stage'), name = (b.linha->>'name'), notes = (b.linha->>'notes'),
--          tags = ARRAY(SELECT jsonb_array_elements_text(b.linha->'tags'))
--     FROM bkp_wa_mescla_contatos_20261025 b WHERE b.papel = 'mantido_antes' AND b.contato_id = c.id;
--   ALTER TABLE whatsapp_contacts ENABLE TRIGGER trg_crm_eventos_contato;
