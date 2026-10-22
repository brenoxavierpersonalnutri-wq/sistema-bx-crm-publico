-- =============================================================
-- Conversa por NÚMERO do WhatsApp (17/10/2026)
-- =============================================================
-- O OpenWA tem 4 sessões (closer = número pessoal do Breno; comercial-fit-2, suporte-consultoria-1,
-- comercial-implementacao-1 = números do time), todas com webhook para o openwa-webhook. Até aqui o CRM
-- não sabia de qual número veio a mensagem: tudo caía na caixa do closer.
--
-- 1) crm_numeros.openwa_session_id: o UUID da sessão no OpenWA (campo `sessionId` assinado de todo
--    webhook, v0.24.0). O openwa-webhook grava sozinho quando identifica a sessão (?sessao= na URL do
--    webhook ou o telefone do próprio número no evento); depois disso o UUID assinado manda.
-- 2) numero_id em whatsapp_contacts e whatsapp_messages. Os existentes ficam no número closer
--    (default constante: sem reescrever a tabela, sem disparar Realtime). Depois o default passa a ser
--    crm_numero_padrao_id() (o closer), para quem ainda insere sem dizer o número (tela, PagTrust...).
-- 3) Contato único por (numero_id, phone): o mesmo cliente falando com 2 números do Breno = 2 conversas.
--    Toda função do banco que fazia ON CONFLICT (phone) em whatsapp_contacts passa a (numero_id, phone).
-- 4) whatsapp_inserir_mensagens aceita numero_id; crm_conversas_ultimas devolve numero_id e agrupa por
--    (número, telefone); crm_ai_ref_do_contato grava o código numa linha só; backfill tem um job ativo
--    POR número.
-- Idempotente. Sem o número closer em crm_numeros, para com erro (nada muda).
-- =============================================================

BEGIN;

-- 0) número padrão ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_numero_padrao_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.crm_numeros
   WHERE tipo = 'openwa' AND sessao_openwa = 'closer'
   ORDER BY ordem, created_at
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.crm_numero_padrao_id() TO anon, authenticated, service_role;

ALTER TABLE public.crm_numeros ADD COLUMN IF NOT EXISTS openwa_session_id text
  CHECK (openwa_session_id IS NULL OR openwa_session_id ~ '^[A-Za-z0-9-]{8,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS crm_numeros_openwa_session_id_key
  ON public.crm_numeros (openwa_session_id) WHERE openwa_session_id IS NOT NULL;

-- 1) numero_id nas duas tabelas ------------------------------------------------------------------
DO $$
DECLARE
  v_padrao uuid := public.crm_numero_padrao_id();
  t text;
BEGIN
  IF v_padrao IS NULL THEN
    RAISE EXCEPTION 'crm_numeros sem o número closer (tipo openwa, sessao_openwa closer): rode antes a migration 20261024100000';
  END IF;
  FOREACH t IN ARRAY ARRAY['whatsapp_contacts', 'whatsapp_messages', 'whatsapp_backfill_jobs'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'numero_id') THEN
      -- default CONSTANTE: o Postgres guarda no catálogo, sem reescrever nem tocar as linhas
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN numero_id uuid NOT NULL DEFAULT %L', t, v_padrao);
    ELSE
      EXECUTE format('UPDATE public.%I SET numero_id = %L WHERE numero_id IS NULL', t, v_padrao);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN numero_id SET NOT NULL', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN numero_id SET DEFAULT public.crm_numero_padrao_id()', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_numero_id_fkey') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (numero_id) REFERENCES public.crm_numeros(id) ON DELETE RESTRICT',
                     t, t || '_numero_id_fkey');
    END IF;
  END LOOP;
END $$;

-- 2) contato único por (numero_id, phone) ---------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- a UNIQUE antiga só de phone (whatsapp_contacts_phone_key, do CREATE TABLE)
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.whatsapp_contacts'::regclass
       AND con.contype = 'u'
       AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                WHERE attrelid = 'public.whatsapp_contacts'::regclass AND attname = 'phone')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.whatsapp_contacts DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contacts_numero_phone_key') THEN
    ALTER TABLE public.whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_numero_phone_key UNIQUE (numero_id, phone);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_phone_idx ON public.whatsapp_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_numero_phone_created
  ON public.whatsapp_messages (numero_id, contact_phone, created_at DESC);

-- 3) funções que faziam ON CONFLICT (phone) em whatsapp_contacts (crm_registrar_evento,
--    grupos_resolver_link...): troca só o alvo do conflito, o resto da função fica igual.
DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prosrc ILIKE '%whatsapp_contacts%' AND p.prosrc ILIKE '%ON CONFLICT (phone)%'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'ON CONFLICT (phone)', 'ON CONFLICT (numero_id, phone)');
    EXECUTE def;
  END LOOP;
END $$;

-- 4) inserir em lote com o número ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_inserir_mensagens(p_linhas jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  v_padrao uuid := public.crm_numero_padrao_id();
BEGIN
  INSERT INTO public.whatsapp_messages (
    numero_id, contact_phone, direction, sender_type, body, media_type, mime_type, file_name, caption,
    message_id, created_at, author_name, author_phone, author_id, media_status
  )
  SELECT coalesce(x.numero_id, v_padrao), x.contact_phone, coalesce(x.direction, 'inbound'), coalesce(x.sender_type, 'lead'),
         coalesce(x.body, ''), x.media_type, x.mime_type, x.file_name, x.caption, x.message_id, coalesce(x.created_at, now()),
         x.author_name, x.author_phone, x.author_id, x.media_status
    FROM jsonb_to_recordset(p_linhas) AS x(
      numero_id uuid, contact_phone text, direction text, sender_type text, body text, media_type text, mime_type text,
      file_name text, caption text, message_id text, created_at timestamptz, author_name text,
      author_phone text, author_id text, media_status text)
   WHERE x.contact_phone IS NOT NULL AND x.message_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_inserir_mensagens(jsonb) FROM PUBLIC, anon, authenticated;

-- 5) resumo da lista por (número, telefone) --------------------------------------------------------
-- leitura: chave "<numero_id>|<phone>" (front novo); sem ela, a antiga só "<phone>".
DROP FUNCTION IF EXISTS public.crm_conversas_ultimas(timestamptz, jsonb);
CREATE FUNCTION public.crm_conversas_ultimas(
  p_base     timestamptz DEFAULT NULL,
  p_leituras jsonb       DEFAULT '{}'::jsonb
)
RETURNS TABLE (contact_phone text, numero_id uuid, ultima_em timestamptz, ultima jsonb, nao_lidas int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.phone,
         c.numero_id,
         m.created_at,
         to_jsonb(m),
         CASE WHEN k.corte IS NULL THEN 0 ELSE (
           SELECT count(*)::int FROM public.whatsapp_messages n
            WHERE n.numero_id = c.numero_id AND n.contact_phone = c.phone
              AND n.created_at > k.corte AND n.direction IS DISTINCT FROM 'outbound'
         ) END
    FROM public.whatsapp_contacts c
    CROSS JOIN LATERAL (
      SELECT w.id, w.numero_id, w.contact_phone, w.body, w.caption, w.created_at, w.direction, w.sender_type, w.status,
             w.media_url, w.media_type, w.mime_type, w.file_name, w.message_id,
             w.author_name, w.author_phone, w.author_id, w.media_path, w.media_status
        FROM public.whatsapp_messages w
       WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
       ORDER BY w.created_at DESC
       LIMIT 1
    ) m
    CROSS JOIN LATERAL (
      SELECT coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone) AS lida
    ) l
    CROSS JOIN LATERAL (
      SELECT greatest(
               CASE WHEN coalesce(l.lida, '') ~ '^\d{4}-\d{2}-\d{2}T' THEN l.lida::timestamptz END,
               p_base) AS corte
    ) k
   ORDER BY m.created_at DESC, c.phone;
$$;
REVOKE ALL ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) TO authenticated, service_role;

-- 6) código opaco do contato (crm_ai_ref_do_contato, migration 20261027140000): com o mesmo telefone em
--    2 números, o UPDATE ... WHERE phone gravava o MESMO código em 2 linhas e batia no índice único de
--    ai_ref. O código é da pessoa: fica numa linha só (a mais antiga), e quem já tem é devolvido.
CREATE OR REPLACE FUNCTION public.crm_ai_ref_do_contato(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v text;
  v_id uuid;
  alfabeto constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  tentativa int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_approved(auth.uid()), false) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT id, ai_ref INTO v_id, v FROM public.whatsapp_contacts
   WHERE phone = p_phone ORDER BY (ai_ref IS NOT NULL) DESC, created_at, id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v IS NOT NULL THEN RETURN v; END IF;
  LOOP
    tentativa := tentativa + 1;
    -- começa com letra (nunca parece telefone) + 9 do alfabeto sem 0/o/1/l
    SELECT substr(alfabeto, 1 + floor(random() * 24)::int, 1)
           || string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '') INTO v
      FROM generate_series(1, 9);
    BEGIN
      UPDATE public.whatsapp_contacts SET ai_ref = v WHERE id = v_id AND ai_ref IS NULL;
      SELECT ai_ref INTO v FROM public.whatsapp_contacts WHERE id = v_id;
      RETURN v;
    EXCEPTION WHEN unique_violation THEN
      IF tentativa >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_ref_do_contato(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_ref_do_contato(text) TO authenticated, service_role;

-- 7) backfill: um job ativo POR número ------------------------------------------------------------
DROP INDEX IF EXISTS public.whatsapp_backfill_um_ativo;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_backfill_um_ativo_por_numero
  ON public.whatsapp_backfill_jobs (numero_id) WHERE status IN ('listando', 'importando');

COMMIT;

-- Conferir:
--   SELECT chave, sessao_openwa, telefone, openwa_session_id FROM crm_numeros ORDER BY ordem;
--   SELECT n.chave, count(*) FROM whatsapp_contacts c JOIN crm_numeros n ON n.id = c.numero_id GROUP BY 1;
--   SELECT n.chave, count(*) FROM whatsapp_messages m JOIN crm_numeros n ON n.id = m.numero_id GROUP BY 1;
--   SELECT contact_phone, numero_id, ultima_em, nao_lidas FROM crm_conversas_ultimas(now() - interval '1 day', '{}') LIMIT 5;
