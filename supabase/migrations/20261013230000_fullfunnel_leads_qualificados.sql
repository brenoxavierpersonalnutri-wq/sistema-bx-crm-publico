-- =============================================================
-- Lead qualificado do Breno -> Full Funnel (Inbound Webhook), SEM edge function.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
-- Nasce DESLIGADO: nada sai até gravar a URL e ligar (bloco "LIGAR", no fim).
--
-- MESMA REGRA DO SELLFLUX
--   O envio ao SellFlux mora na edge function submit-form-response: grava a
--   linha em lead_form_responses e, se nivel <> 'DQ' e o Origin/Referer do
--   navegador for novaav/equipe/brenoxavier.com.br, posta no SellFlux.
--   Edge function não publica por git, então o Full Funnel vai por trigger:
--   AFTER INSERT em lead_form_responses, só nivel <> 'DQ', e só quando quem
--   inseriu foi o service_role (= a própria edge function). Insert direto com
--   a chave pública (a policy "Anyone can insert" permite) NÃO dispara: senão
--   qualquer um com a chave do front mandaria template de WhatsApp a número
--   escolhido por ele. Import/ajuste feito no SQL editor (postgres) também não.
--
-- O QUE O TRIGGER NÃO SABE
--   O host de origem não é gravado na linha. Hoje (13/10/2026) só dois sites
--   chamam esta edge function: equipe.brenoxavier.com.br (/avaliacao,
--   /individual) e novaav.brenoxavier.com.br. Se algum site fora da allowlist
--   voltar a chamá-la, o lead dele entraria aqui e não no SellFlux.
--   Conferência: logs da edge function, procurar "sellflux ignorado".
--
-- ENTREGA
--   Cada envio vira uma linha em fullfunnel_envios (fila com status). pg_net
--   posta depois do COMMIT; a cada 5 min o pg_cron confere a resposta HTTP e
--   reenvia até 3 tentativas. Mesmo telefone em 24 h não reenvia (evita template
--   duplicado quando o formulário grava a mesma lead duas vezes).
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 1. Configuração (fechada à API: nem anon nem authenticated leem) ----------
-- A URL do Inbound Webhook dispara automação de WhatsApp: quem a tiver manda
-- mensagem. Por isso NÃO vai em app_settings (que anon lê) nem no git.
CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('fullfunnel_ativo', 'false')
ON CONFLICT (chave) DO NOTHING;

-- 2. Fila de envios (tem telefone de lead: fechada à API) -------------------
CREATE TABLE IF NOT EXISTS public.fullfunnel_envios (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id       uuid REFERENCES public.lead_form_responses(id) ON DELETE SET NULL,
  telefone_e164 text,
  payload       jsonb NOT NULL,
  -- enviado (aguarda resposta) | ok | erro (vai reenviar) | falhou (desistiu)
  -- | sem_telefone | duplicado | amostra_enviada
  status        text NOT NULL DEFAULT 'pendente',
  tentativas    integer NOT NULL DEFAULT 0,
  request_id    bigint,
  http_status   integer,
  erro          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fullfunnel_envios_status_idx   ON public.fullfunnel_envios (status);
CREATE INDEX IF NOT EXISTS fullfunnel_envios_telefone_idx ON public.fullfunnel_envios (telefone_e164, criado_em);
CREATE UNIQUE INDEX IF NOT EXISTS fullfunnel_envios_lead_key
  ON public.fullfunnel_envios (lead_id) WHERE lead_id IS NOT NULL;
ALTER TABLE public.fullfunnel_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fullfunnel_envios FROM PUBLIC, anon, authenticated;

-- 3. Telefone -> E.164 ------------------------------------------------------
-- "+5531999998888", "(31) 99999-8888", "31999998888", "5531999998888",
-- "+351912345678" (DDI estrangeiro só com "+"). Sem DDI e 10/11 dígitos = Brasil.
-- Celular BR antigo de 8 dígitos (começa com 6-9) ganha o 9.
-- Não reconhecido -> NULL (o envio fica como sem_telefone).
CREATE OR REPLACE FUNCTION public.telefone_e164(p_bruto text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_bruto text := btrim(coalesce(p_bruto, ''));
  v_dig   text := regexp_replace(coalesce(p_bruto, ''), '[^0-9]', '', 'g');
  v_nac   text;
BEGIN
  IF v_dig = '' THEN
    RETURN NULL;
  END IF;

  IF left(v_bruto, 1) = '+' OR left(v_dig, 2) = '00' THEN
    v_dig := regexp_replace(v_dig, '^00', '');
    IF left(v_dig, 2) <> '55' THEN
      -- estrangeiro: E.164 tem de 8 a 15 dígitos
      RETURN CASE WHEN length(v_dig) BETWEEN 8 AND 15 THEN '+' || v_dig END;
    END IF;
    v_nac := substr(v_dig, 3);
  ELSIF length(v_dig) IN (10, 11) THEN
    v_nac := v_dig;                       -- DDD + número, sem DDI
  ELSIF length(v_dig) IN (12, 13) AND left(v_dig, 2) = '55' THEN
    v_nac := substr(v_dig, 3);            -- 55 + DDD + número
  ELSE
    RETURN NULL;
  END IF;

  v_nac := regexp_replace(v_nac, '^0', '');   -- "031..." (zero de longa distância)
  IF length(v_nac) = 10 AND substr(v_nac, 3, 1) IN ('6', '7', '8', '9') THEN
    v_nac := left(v_nac, 2) || '9' || substr(v_nac, 3);
  END IF;
  IF length(v_nac) NOT IN (10, 11) OR left(v_nac, 1) = '0' THEN
    RETURN NULL;
  END IF;
  RETURN '+55' || v_nac;
END;
$$;

-- 4. Payload do Inbound Webhook ---------------------------------------------
-- Chaves fixas: o Full Funnel mapeia por nome a partir da requisição de amostra.
CREATE OR REPLACE FUNCTION public.fullfunnel_payload(r public.lead_form_responses, p_teste boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'evento',       'lead_qualificado',
    'teste',        p_teste,
    'site',         'brenoxavier',
    'lead_id',      r.id,
    'name',         coalesce(nullif(btrim(r.nome), ''), 'Lead'),
    'first_name',   split_part(coalesce(nullif(btrim(r.nome), ''), 'Lead'), ' ', 1),
    'last_name',    nullif(btrim(substr(btrim(coalesce(r.nome, '')), length(split_part(btrim(coalesce(r.nome, '')), ' ', 1)) + 1)), ''),
    'phone',        public.telefone_e164(r.telefone),
    'email',        nullif(btrim(r.email), ''),
    'instagram',    nullif(btrim(r.instagram), ''),
    'origem',       r.origem,
    'nivel',        r.nivel,
    'score',        r.score,
    'renda_mensal', r.renda_mensal,
    'utm_source',   r.utm_source,
    'utm_medium',   r.utm_medium,
    'utm_campaign', r.utm_campaign,
    'utm_content',  r.utm_content,
    'utm_term',     r.utm_term,
    'criado_em',    to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tags',         'lead-qualificado-site,nivel-' || lower(coalesce(r.nivel, ''))
  );
$$;

-- 5. Dispara um envio da fila (pg_net) --------------------------------------
CREATE OR REPLACE FUNCTION public.fullfunnel_disparar(p_envio_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_req bigint;
BEGIN
  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'fullfunnel_webhook_url';
  IF v_url IS NULL OR v_url !~ '^https://[^/]+/' THEN
    UPDATE public.fullfunnel_envios
       SET status = CASE WHEN status = 'amostra' THEN 'amostra_sem_url' ELSE 'erro' END,
           erro = 'sem URL https em integracao_config.fullfunnel_webhook_url',
           atualizado_em = now()
     WHERE id = p_envio_id;
    RETURN;
  END IF;

  SELECT net.http_post(
           url                  := v_url,
           body                 := e.payload,
           headers              := '{"Content-Type": "application/json"}'::jsonb,
           timeout_milliseconds := 10000
         )
    INTO v_req
    FROM public.fullfunnel_envios e
   WHERE e.id = p_envio_id;

  UPDATE public.fullfunnel_envios
     SET status = CASE WHEN status = 'amostra' THEN 'amostra_enviada' ELSE 'enviado' END,
         request_id = v_req, tentativas = tentativas + 1, erro = NULL, atualizado_em = now()
   WHERE id = p_envio_id;
END;
$$;

-- 6. Enfileira um lead (chamada pelo trigger) -------------------------------
CREATE OR REPLACE FUNCTION public.fullfunnel_enfileirar(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        public.lead_form_responses;
  v_tel    text;
  v_envio  bigint;
BEGIN
  IF coalesce((SELECT valor FROM public.integracao_config WHERE chave = 'fullfunnel_ativo'), 'false') <> 'true' THEN
    RETURN;
  END IF;

  SELECT * INTO r FROM public.lead_form_responses WHERE id = p_lead_id;
  IF NOT FOUND OR r.nivel IS NULL OR r.nivel = 'DQ' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fullfunnel_envios WHERE lead_id = p_lead_id) THEN
    RETURN;
  END IF;

  v_tel := public.telefone_e164(r.telefone);

  IF v_tel IS NULL THEN
    INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status, erro)
    VALUES (r.id, NULL, public.fullfunnel_payload(r), 'sem_telefone', left(coalesce(r.telefone, '(vazio)'), 40));
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fullfunnel_envios
     WHERE telefone_e164 = v_tel
       AND status IN ('pendente', 'enviado', 'ok', 'erro')
       AND criado_em > now() - interval '24 hours'
  ) THEN
    INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status)
    VALUES (r.id, v_tel, public.fullfunnel_payload(r), 'duplicado');
    RETURN;
  END IF;

  INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status)
  VALUES (r.id, v_tel, public.fullfunnel_payload(r), 'pendente')
  RETURNING id INTO v_envio;

  BEGIN
    PERFORM public.fullfunnel_disparar(v_envio);
  EXCEPTION WHEN OTHERS THEN
    -- pg_net fora do ar: a linha fica em erro e o pg_cron reenvia.
    UPDATE public.fullfunnel_envios
       SET status = 'erro', erro = left(SQLERRM, 300), atualizado_em = now()
     WHERE id = v_envio;
  END;
END;
$$;

-- 7. Trigger --------------------------------------------------------------
-- SECURITY INVOKER de propósito: current_user aqui é o papel de quem inseriu.
-- A edge function insere como service_role; o front com a chave pública, como anon.
CREATE OR REPLACE FUNCTION public.fullfunnel_on_lead_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'service_role' THEN
    BEGIN
      PERFORM public.fullfunnel_enfileirar(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Nunca derrubar a gravação do lead por causa do Full Funnel.
      RAISE WARNING 'fullfunnel_enfileirar falhou para %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fullfunnel_lead_qualificado ON public.lead_form_responses;
CREATE TRIGGER trg_fullfunnel_lead_qualificado
AFTER INSERT ON public.lead_form_responses
FOR EACH ROW
WHEN (NEW.nivel IS DISTINCT FROM 'DQ')
EXECUTE FUNCTION public.fullfunnel_on_lead_insert();

-- 8. Confere respostas e reenvia (pg_cron, a cada 5 min) ---------------------
CREATE OR REPLACE FUNCTION public.fullfunnel_conferir()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  e        record;
  v_status integer;
  v_achou  boolean;
  v_erro   text;
  v_n      integer := 0;
BEGIN
  FOR e IN
    SELECT * FROM public.fullfunnel_envios
     WHERE status IN ('enviado', 'erro')
       AND criado_em > now() - interval '3 days'
     ORDER BY id
     LIMIT 200
  LOOP
    v_achou := false;
    IF e.status = 'enviado' AND e.request_id IS NOT NULL THEN
      SELECT true, r.status_code,
             coalesce(r.error_msg, CASE WHEN r.timed_out THEN 'timeout' END, left(r.content, 300))
        INTO v_achou, v_status, v_erro
        FROM net._http_response r
       WHERE r.id = e.request_id;
      v_achou := coalesce(v_achou, false);

      IF v_achou AND v_status BETWEEN 200 AND 299 THEN
        UPDATE public.fullfunnel_envios
           SET status = 'ok', http_status = v_status, erro = NULL, atualizado_em = now()
         WHERE id = e.id;
        v_n := v_n + 1;
        CONTINUE;
      END IF;
      -- sem resposta ainda: espera até 30 min antes de considerar perdido
      IF NOT v_achou AND e.atualizado_em > now() - interval '30 minutes' THEN
        CONTINUE;
      END IF;
      UPDATE public.fullfunnel_envios
         SET status = 'erro', http_status = v_status,
             erro = coalesce(v_erro, 'sem resposta do pg_net'), atualizado_em = now()
       WHERE id = e.id;
    END IF;

    IF e.tentativas >= 3 THEN
      UPDATE public.fullfunnel_envios SET status = 'falhou', atualizado_em = now() WHERE id = e.id;
    ELSE
      BEGIN
        PERFORM public.fullfunnel_disparar(e.id);
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.fullfunnel_envios
           SET status = 'erro', erro = left(SQLERRM, 300), atualizado_em = now()
         WHERE id = e.id;
      END;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- 9. Amostra (dados FALSOS) para o Full Funnel salvar o gatilho -------------
-- Mesmo formato do envio real, com "teste": true e telefone de DDD inexistente.
CREATE OR REPLACE FUNCTION public.fullfunnel_enviar_amostra()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       public.lead_form_responses;
  v_envio bigint;
BEGIN
  r.id           := '00000000-0000-4000-8000-000000000000';
  r.nome         := 'Amostra Teste Fullfunnel';
  r.telefone     := '+5500900000000';
  r.email        := 'amostra@exemplo.invalid';
  r.instagram    := '@amostra.teste';
  r.origem       := 'avaliacao';
  r.nivel        := 'A';
  r.score        := 70;
  r.renda_mensal := '5k_8k';
  r.utm_source   := 'amostra';
  r.utm_medium   := 'amostra';
  r.utm_campaign := 'amostra';
  r.utm_content  := 'amostra';
  r.utm_term     := 'amostra';
  r.created_at   := now();

  INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status)
  VALUES (NULL, '+5500900000000',
          public.fullfunnel_payload(r, true) || jsonb_build_object('phone', '+5500900000000'),
          'amostra')
  RETURNING id INTO v_envio;

  PERFORM public.fullfunnel_disparar(v_envio);
  RETURN v_envio;
END;
$$;

-- 10. Permissões: nada disso é chamável pela API pública ---------------------
REVOKE ALL ON FUNCTION public.fullfunnel_disparar(bigint)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fullfunnel_enfileirar(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fullfunnel_conferir()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fullfunnel_enviar_amostra()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fullfunnel_payload(public.lead_form_responses, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fullfunnel_enfileirar(uuid) TO service_role;

COMMIT;

-- 11. Agenda a conferência (fora da transação: pg_cron grava em cron.job) ----
SELECT cron.schedule('fullfunnel-conferir', '*/5 * * * *', 'SELECT public.fullfunnel_conferir()');

-- =============================================================
-- LIGAR (rodar SÓ depois de criar o Inbound Webhook no Full Funnel):
--
--   INSERT INTO public.integracao_config (chave, valor)
--   VALUES ('fullfunnel_webhook_url', 'https://services.leadconnectorhq.com/hooks/pP45b6VEFnJQMr5ez4X0/webhook-trigger/<ID>')
--   ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
--
--   SELECT public.fullfunnel_enviar_amostra();   -- 1 requisição falsa; o Full Funnel salva o formato
--   -- 10 s depois:
--   SELECT id, status, http_status, erro FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 3;
--   SELECT id, status_code, left(content, 200) FROM net._http_response ORDER BY id DESC LIMIT 3;
--
--   -- só quando o workflow estiver pronto:
--   UPDATE public.integracao_config SET valor = 'true', atualizado_em = now() WHERE chave = 'fullfunnel_ativo';
--
-- DESLIGAR: UPDATE public.integracao_config SET valor = 'false', atualizado_em = now() WHERE chave = 'fullfunnel_ativo';
--
-- ACOMPANHAR:
--   SELECT status, count(*) FROM public.fullfunnel_envios GROUP BY 1;
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'fullfunnel-conferir';
-- =============================================================
