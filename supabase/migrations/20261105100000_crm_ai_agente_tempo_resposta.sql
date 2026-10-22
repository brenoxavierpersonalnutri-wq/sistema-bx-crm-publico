-- Tempo de resposta (delay) por agente de IA, 19/10/2026. Idempotente: pode rodar mais de uma vez.
-- Tela: CRM > Agente IA > Treinar IA > Configuração > "Tempo de resposta (delay)".
-- Conta e limites em supabase/functions/_shared/ritmoResposta.ts (mesmas faixas dos CHECK abaixo).
--
--  debounce_segundos        espera a lead terminar de escrever (já existia, 10..120; agora 5..300, padrão 30)
--  debounce_max_segundos    máximo esperando mensagens picadas, contado da 1ª mensagem (10..600, padrão 90, >= debounce)
--                           (antes era fixo em 90 s no crm_ai_enfileirar)
--  atraso_min/max_segundos  atraso sorteado antes de responder (0..300, padrão 20..60)
--  digitando_ligado         "digitando…" proporcional ao tamanho da bolha (padrão ligado)
--  digitando_cps            velocidade do "digitando…" em caracteres por segundo (2..30, padrão 8)
--  intervalo_min/max_seg.   pausa entre bolhas quando a IA manda várias (0..60, padrão 3..8)
--
-- crm_ai_enfileirar ganha p_teto (máximo da rajada) e p_atraso (sorteado pelo webhook). A versão de 4 parâmetros sai
-- (senão a chamada antiga fica ambígua); a nova aceita a chamada antiga (p_teto = 90, p_atraso = 0 por padrão), então o
-- openwa-webhook publicado antes desta migration continua enfileirando igual.

BEGIN;

ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS debounce_segundos integer NOT NULL DEFAULT 30;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS debounce_max_segundos integer NOT NULL DEFAULT 90;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS atraso_min_segundos integer NOT NULL DEFAULT 20;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS atraso_max_segundos integer NOT NULL DEFAULT 60;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS digitando_ligado boolean NOT NULL DEFAULT true;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS digitando_cps integer NOT NULL DEFAULT 8;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS intervalo_min_segundos integer NOT NULL DEFAULT 3;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS intervalo_max_segundos integer NOT NULL DEFAULT 8;

-- agente com debounce acima de 90 (a faixa antiga ia até 120): o máximo acompanha, senão o CHECK abaixo recusa
UPDATE public.crm_ai_agents SET debounce_max_segundos = least(600, debounce_segundos)
 WHERE debounce_max_segundos < debounce_segundos;

ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_debounce;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_debounce CHECK (debounce_segundos BETWEEN 5 AND 300);
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_debounce_max;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_debounce_max
  CHECK (debounce_max_segundos BETWEEN 10 AND 600 AND debounce_max_segundos >= debounce_segundos);
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_atraso_resposta;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_atraso_resposta
  CHECK (atraso_min_segundos BETWEEN 0 AND 300 AND atraso_max_segundos BETWEEN 0 AND 300 AND atraso_min_segundos <= atraso_max_segundos);
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_digitando_cps;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_digitando_cps CHECK (digitando_cps BETWEEN 2 AND 30);
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_intervalo_bolhas;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_intervalo_bolhas
  CHECK (intervalo_min_segundos BETWEEN 0 AND 60 AND intervalo_max_segundos BETWEEN 0 AND 60 AND intervalo_min_segundos <= intervalo_max_segundos);

COMMENT ON COLUMN public.crm_ai_agents.debounce_segundos IS 'Espera a lead terminar de escrever (s). Cada mensagem nova reinicia a conta.';
COMMENT ON COLUMN public.crm_ai_agents.debounce_max_segundos IS 'Máximo esperando mensagens picadas, contado da 1ª mensagem da rajada (s).';
COMMENT ON COLUMN public.crm_ai_agents.atraso_min_segundos IS 'Atraso antes de responder: sorteio entre mínimo e máximo (s).';
COMMENT ON COLUMN public.crm_ai_agents.digitando_cps IS '"Digitando…" proporcional ao tamanho: caracteres por segundo.';
COMMENT ON COLUMN public.crm_ai_agents.intervalo_min_segundos IS 'Pausa entre bolhas quando a IA manda várias: sorteio entre mínimo e máximo (s).';

DROP FUNCTION IF EXISTS public.crm_ai_enfileirar(uuid, text, text, integer);

-- Mensagem da lead chegou numa conversa da IA: cria ou estica a pendência.
-- responder_apos = max(agora, min(primeira + teto, agora + debounce)) + atraso
-- (mesma conta de calcularResponderApos em ritmoResposta.ts).
CREATE OR REPLACE FUNCTION public.crm_ai_enfileirar(
  p_numero_id uuid, p_phone text, p_agent_slug text,
  p_debounce integer DEFAULT 30, p_teto integer DEFAULT 90, p_atraso integer DEFAULT 0
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id bigint;
  v_primeira timestamptz;
  v_deb integer := greatest(5, least(300, coalesce(p_debounce, 30)));
  v_teto integer := greatest(v_deb, greatest(10, least(600, coalesce(p_teto, 90))));
  v_atraso integer := greatest(0, least(300, coalesce(p_atraso, 0)));
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_ai_fila:' || coalesce(p_numero_id::text, '') || ':' || p_phone));
  SELECT id, primeira_msg_em INTO v_id, v_primeira FROM public.crm_ai_fila
   WHERE coalesce(numero_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_numero_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND contact_phone = p_phone AND status = 'pendente'
   FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE public.crm_ai_fila
       SET responder_apos = greatest(now(), least(v_primeira + make_interval(secs => v_teto), now() + make_interval(secs => v_deb)))
                            + make_interval(secs => v_atraso),
           ultima_msg_em = now(), n_mensagens = n_mensagens + 1, agent_slug = p_agent_slug, updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;
  -- conversa em processamento: a pendência nova nasce e o worker só a pega quando o processamento terminar
  INSERT INTO public.crm_ai_fila (numero_id, contact_phone, agent_slug, responder_apos)
  VALUES (p_numero_id, p_phone, p_agent_slug, now() + make_interval(secs => v_deb) + make_interval(secs => v_atraso))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_enfileirar(uuid, text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_enfileirar(uuid, text, text, integer, integer, integer) TO authenticated, service_role;

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR: publicar openwa-webhook (enfileira com o tempo do agente) e ai-robo-tick (digitando + intervalo).
-- Conferir: SELECT slug, debounce_segundos, debounce_max_segundos, atraso_min_segundos, atraso_max_segundos,
--                  digitando_ligado, digitando_cps, intervalo_min_segundos, intervalo_max_segundos FROM public.crm_ai_agents;
-- =============================================================
