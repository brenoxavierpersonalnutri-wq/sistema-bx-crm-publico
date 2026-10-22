-- =============================================================
-- Base de leads unificada: junta em public.base_leads as leads do BRENO que estão nas tabelas
-- do próprio banco (formulário de avaliação/individual, agenda, compras, alunas, CRM WhatsApp)
-- e expõe uma visão deduplicada por pessoa (public.base_leads_unificada).
--
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente: pode rodar de novo a qualquer
-- momento para puxar o que entrou depois (upsert por origem + origem_id).
-- NÃO apaga nada de nenhuma tabela. Nada aqui envia mensagem.
--
-- ISOLAMENTO (leads de cliente NÃO entram):
--   lead_form_responses recebeu respostas de sites de clientes da BG Implementação que
--   postavam na mesma edge function (submit-form-response). Elas são reconhecidas por:
--   1) id de campanha Meta nas UTMs terminado no sufixo da conta de anúncio do cliente
--      (conferido no Gerenciador em 17/10/2026):
--        0608 = Arthur Souza (CA -01)      0464 = Jhonny Costa (Jhonny / Layla)
--        0226 = Rhuan Torquato             0698 = Victor Curty Consultoria Fitness
--      (as contas do Breno usam 0262);
--   2) respostas do quiz de joelho do site do Jhonny (p1_objetivo reduzir_dores,
--      intensificar_rotina, treinar_sem_risco, emagrecer_rapido — opções que não existem
--      no formulário do Breno, src/components/novaav/QualificationForm.tsx).
--   Contatos do SellFlux cujo telefone só aparece em formulário de cliente (e em nenhuma
--   fonte do Breno, nem com tag de compra) ficam fora da visão unificada.
--   candidaturas_parceria (influenciadoras) não é lead e não entra.
--   Linhas origem 'pagtrust' (import da PagTrust pela tela da base) entram na visão como fonte do Breno.
-- =============================================================
BEGIN;

-- 1. Colunas novas (não mexe nas existentes) -------------------------------------------------
ALTER TABLE public.base_leads ADD COLUMN IF NOT EXISTS nivel text;
ALTER TABLE public.base_leads ADD COLUMN IF NOT EXISTS score integer;
CREATE INDEX IF NOT EXISTS base_leads_email_idx ON public.base_leads (lower(email));
CREATE INDEX IF NOT EXISTS base_leads_origem_idx ON public.base_leads (origem);

-- 2. Normalização de telefone BR para E.164 (+55DDNNNNNNNNN) ----------------------------------
-- Mesma regra de src/lib/baseLeads.ts (telefoneParaE164), com um acréscimo: celular antigo de
-- 8 dígitos (começa com 6-9) ganha o 9 na frente, para casar com o mesmo número já com 9.
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

-- Lead de site de cliente? (regra do cabeçalho)
CREATE OR REPLACE FUNCTION public.base_leads_form_de_cliente(r public.lead_form_responses)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' ', r.utm_campaign, r.utm_content, r.utm_term, r.utm_medium)
           ~ '(^|\D)120\d{11}(0608|0464|0226|0698)(\D|$)'
      OR coalesce(r.p1_objetivo, '') IN ('reduzir_dores', 'intensificar_rotina', 'treinar_sem_risco', 'emagrecer_rapido')
$$;

-- 3. Upserts por fonte (desde 01/01/2025) ----------------------------------------------------

-- 3a. Formulário de avaliação / consultoria individual (só do Breno)
INSERT INTO public.base_leads AS b
  (origem, origem_id, nome, telefone_e164, email, tags, produto, status, nivel, score, criado_origem)
SELECT
  CASE WHEN l.origem = 'individual' THEN 'individual' ELSE 'avaliacao' END,
  l.id::text,
  nullif(trim(l.nome), ''),
  public.base_leads_tel_e164(l.telefone),
  public.base_leads_email(l.email),
  array_remove(ARRAY[
    CASE WHEN l.origem = 'individual' THEN 'form-individual' ELSE 'form-avaliacao' END,
    CASE WHEN l.nivel IS NOT NULL THEN 'nivel-' || l.nivel END,
    CASE WHEN nullif(trim(l.utm_source), '') IS NOT NULL THEN 'utm-' || lower(trim(l.utm_source)) END,
    CASE WHEN l.p1_objetivo IS NOT NULL THEN 'objetivo-' || l.p1_objetivo END
  ], NULL),
  CASE WHEN l.origem = 'individual' THEN 'consultoria individual' ELSE 'avaliacao gratuita' END,
  l.nivel,
  l.nivel,
  l.score,
  l.created_at
FROM public.lead_form_responses l
WHERE l.created_at >= '2025-01-01'
  AND NOT public.base_leads_form_de_cliente(l)
ON CONFLICT (origem, origem_id) DO UPDATE SET
  nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email,
  tags = EXCLUDED.tags, produto = EXCLUDED.produto, status = EXCLUDED.status,
  nivel = EXCLUDED.nivel, score = EXCLUDED.score, criado_origem = EXCLUDED.criado_origem;

-- 3b. Agenda (consultas marcadas)
INSERT INTO public.base_leads AS b
  (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
SELECT
  'agendamento',
  c.id::text,
  nullif(trim(c.client_name), ''),
  public.base_leads_tel_e164(c.client_phone),
  public.base_leads_email(c.client_email),
  array_remove(ARRAY[
    'agendou',
    CASE WHEN nullif(trim(c.via), '') IS NOT NULL THEN 'via-' || lower(trim(c.via)) END,
    CASE WHEN c.attended THEN 'compareceu' END,
    CASE WHEN c.converted THEN 'comprou' END,
    CASE WHEN c.refunded THEN 'reembolso' END,
    CASE WHEN c.disqualified THEN 'desqualificado' END
  ], NULL),
  nullif(trim(c.event_type_name), ''),
  c.status,
  c.created_at
FROM public.consultations c
WHERE c.created_at >= '2025-01-01'
ON CONFLICT (origem, origem_id) DO UPDATE SET
  nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email,
  tags = EXCLUDED.tags, produto = EXCLUDED.produto, status = EXCLUDED.status,
  criado_origem = EXCLUDED.criado_origem;

-- 3c. Compras (webhooks PagTrust gravados em sales_events)
INSERT INTO public.base_leads AS b
  (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
SELECT
  'compra',
  s.id::text,
  NULL,
  public.base_leads_tel_e164(s.customer_phone),
  public.base_leads_email(s.customer_email),
  array_remove(ARRAY['comprou', CASE WHEN s.source IS NOT NULL THEN 'gateway-' || lower(s.source) END], NULL),
  s.source,
  'compra',
  s.created_at
FROM public.sales_events s
WHERE s.created_at >= '2025-01-01'
ON CONFLICT (origem, origem_id) DO UPDATE SET
  telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email, tags = EXCLUDED.tags,
  produto = EXCLUDED.produto, status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem;

-- 3d. Alunas (compradoras do acompanhamento)
INSERT INTO public.base_leads AS b
  (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
SELECT
  'aluna',
  a.id::text,
  nullif(trim(a.nome_completo), ''),
  public.base_leads_tel_e164(a.telefone),
  NULL,
  array_remove(ARRAY['comprou', 'aluna', CASE WHEN a.programa IS NOT NULL THEN 'programa-' || lower(a.programa) END], NULL),
  a.programa,
  a.status,
  coalesce(a.data_compra::timestamptz, a.created_at)
FROM public.alunas a
WHERE coalesce(a.is_teste, false) = false
  AND coalesce(a.data_compra::timestamptz, a.created_at) >= '2025-01-01'
ON CONFLICT (origem, origem_id) DO UPDATE SET
  nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, tags = EXCLUDED.tags,
  produto = EXCLUDED.produto, status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem;

-- 3e. CRM WhatsApp (contatos que vieram do próprio WhatsApp; os que a tela da base empurrou,
--     source = 'base_leads', já estão aqui e não voltam)
INSERT INTO public.base_leads AS b
  (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
SELECT
  'crm_whatsapp',
  w.id::text,
  nullif(trim(w.name), ''),
  public.base_leads_tel_e164(w.phone),
  NULL,
  array_remove(ARRAY['crm-whatsapp', CASE WHEN w.stage IS NOT NULL THEN 'crm-' || lower(w.stage) END], NULL)
    || coalesce(w.tags, '{}'),
  NULL,
  w.stage,
  w.created_at
FROM public.whatsapp_contacts w
WHERE w.created_at >= '2025-01-01'
  AND coalesce(w.source, '') <> 'base_leads'
ON CONFLICT (origem, origem_id) DO UPDATE SET
  nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, tags = EXCLUDED.tags,
  status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem;

-- 4. Visão unificada: uma linha por pessoa -----------------------------------------------------
-- Chave = telefone E.164; sem telefone, o telefone de outra linha com o mesmo e-mail; senão o e-mail.
-- Linha sem telefone e sem e-mail fica de fora (não dá para identificar a pessoa).
CREATE OR REPLACE VIEW public.base_leads_unificada
WITH (security_invoker = true) AS
WITH linhas AS (
  SELECT b.*, lower(b.email) AS email_n FROM public.base_leads b
),
fone_por_email AS (
  SELECT email_n, min(telefone_e164) AS tel
  FROM linhas WHERE email_n IS NOT NULL AND telefone_e164 IS NOT NULL
  GROUP BY email_n
),
chaveadas AS (
  SELECT l.*,
         coalesce(l.telefone_e164, f.tel, 'email:' || l.email_n) AS chave
  FROM linhas l LEFT JOIN fone_por_email f ON f.email_n = l.email_n AND l.telefone_e164 IS NULL
  WHERE coalesce(l.telefone_e164, l.email_n) IS NOT NULL
),
fones_cliente AS (
  SELECT DISTINCT public.base_leads_tel_e164(r.telefone) AS tel
  FROM public.lead_form_responses r
  WHERE public.base_leads_form_de_cliente(r) AND public.base_leads_tel_e164(r.telefone) IS NOT NULL
),
pessoas AS (
  SELECT
    chave,
    CASE WHEN chave LIKE '+%' THEN chave END                                   AS telefone_e164,
    (array_agg(email_n ORDER BY criado_origem NULLS LAST) FILTER (WHERE email_n IS NOT NULL))[1] AS email,
    (array_agg(nome ORDER BY criado_origem DESC NULLS LAST) FILTER (WHERE nome IS NOT NULL))[1]  AS nome,
    min(criado_origem)                                                          AS primeira_entrada,
    max(criado_origem)                                                          AS ultima_entrada,
    array_agg(DISTINCT origem ORDER BY origem)                                  AS origens,
    (array_agg(nivel ORDER BY CASE nivel WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
                                         WHEN 'D' THEN 4 WHEN 'DQ' THEN 5 ELSE 6 END)
       FILTER (WHERE nivel IS NOT NULL))[1]                                      AS nivel,
    max(score)                                                                  AS score,
    bool_or(origem IN ('compra', 'aluna') OR (origem = 'pagtrust' AND status = 'comprador')
            OR tags && ARRAY['comprou', 'compra-realizada', 'comprador-pagtrust'])            AS comprador,
    bool_or(origem <> 'sellflux' OR tags && ARRAY['comprou', 'compra-realizada', 'abandonou-carrinho', 'aguardando-pagamento']) AS tem_fonte_breno,
    count(*)                                                                    AS registros
  FROM chaveadas
  GROUP BY chave
),
tags_por_chave AS (
  SELECT chave, array_agg(DISTINCT t ORDER BY t) AS tags
  FROM chaveadas, unnest(tags) AS t
  GROUP BY chave
)
SELECT p.chave, p.telefone_e164, p.email, p.nome, p.primeira_entrada, p.ultima_entrada,
       p.origens, coalesce(tg.tags, '{}') AS tags, p.nivel, p.score, p.comprador, p.registros
FROM pessoas p
LEFT JOIN tags_por_chave tg ON tg.chave = p.chave
WHERE NOT (p.telefone_e164 IN (SELECT tel FROM fones_cliente) AND NOT p.tem_fonte_breno);

REVOKE ALL ON public.base_leads_unificada FROM PUBLIC, anon;
GRANT SELECT ON public.base_leads_unificada TO authenticated;

COMMIT;
