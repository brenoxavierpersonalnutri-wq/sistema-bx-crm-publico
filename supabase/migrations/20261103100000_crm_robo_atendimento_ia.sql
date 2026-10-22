-- Robô de atendimento por IA no WhatsApp (OpenWA), 18/10/2026. Idempotente: pode rodar mais de uma vez.
-- NASCE DESLIGADO: nenhum número tem o robô ligado (crm_numeros.robo_ia_ligado = false) e nenhum agente muda de
-- "ativo". Enquanto a chave do número estiver desligada, o webhook não enfileira nada e o tick não chama a função.
--
-- Quem atende a conversa (reaproveita os campos que já existiam em whatsapp_contacts):
--   ai_agent_slug preenchido e ai_pausado = false  -> "ia:<agente>" (a IA responde sozinha)
--   qualquer outro caso                            -> "humano"
-- Histórico das trocas e log por conversa: crm_ai_eventos (já existia; ganha número, agente, modelo, mensagem,
-- tokens e quem fez). Tipos usados: atribuido, transferido_ia (manual), assumido_humano, pausado_humano,
-- resposta, transferido (IA -> humano, com motivo), fora_horario, falha, falha_envio, silencio, ignorado.
--
--  1) crm_numeros: robo_ia_ligado (chave geral por número, padrão desligado) e robo_ia_max_hora (teto do robô).
--  2) crm_ai_agents: transferência para humano (prompt de transferência, despedida, para quem, tag/etapa/fluxo),
--     debounce e máximo de falhas.
--  3) whatsapp_contacts: ai_precisa_humano, contadores e carimbo da transferência.
--  4) crm_ai_eventos: colunas novas.
--  5) crm_ai_fila: fila com debounce (junta mensagens picadas da lead).
--  6) RPCs: enfileirar, pegar da fila, transferir para IA, assumir, pausar por humano.
--  7) Tick do pg_cron (só chama a função quando há item vencido).

BEGIN;

-- 1) Número ------------------------------------------------------------------------------------
ALTER TABLE public.crm_numeros ADD COLUMN IF NOT EXISTS robo_ia_ligado boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_numeros ADD COLUMN IF NOT EXISTS robo_ia_max_hora integer NOT NULL DEFAULT 60;
ALTER TABLE public.crm_numeros DROP CONSTRAINT IF EXISTS crm_numeros_robo_ia_max_hora;
ALTER TABLE public.crm_numeros ADD CONSTRAINT crm_numeros_robo_ia_max_hora CHECK (robo_ia_max_hora BETWEEN 1 AND 300);
COMMENT ON COLUMN public.crm_numeros.robo_ia_ligado IS
  'Chave geral do robô de IA neste número (padrão desligado). Desligado = a IA não responde ninguém neste número.';

-- 2) Agente: transferência para humano ----------------------------------------------------------
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS prompt_transferencia text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS transferir_sem_mensagem boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS transferir_para text;          -- atendente (profiles.full_name); nulo = fila geral
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS transferir_tag text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS transferir_etapa text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS transferir_fluxo_id uuid;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS debounce_segundos integer NOT NULL DEFAULT 30;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS max_falhas integer NOT NULL DEFAULT 3;
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_debounce;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_debounce CHECK (debounce_segundos BETWEEN 10 AND 120);
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_max_falhas;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_max_falhas CHECK (max_falhas BETWEEN 1 AND 10);
DO $fk$
BEGIN
  IF to_regclass('public.crm_fluxos') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_ai_agents_transferir_fluxo_fk'
  ) THEN
    ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_transferir_fluxo_fk
      FOREIGN KEY (transferir_fluxo_id) REFERENCES public.crm_fluxos(id) ON DELETE SET NULL;
  END IF;
END
$fk$;
COMMENT ON COLUMN public.crm_ai_agents.frase_transferencia IS
  'Mensagem de despedida da IA ao transferir para o humano (transferir_sem_mensagem = true: não manda nada).';
COMMENT ON COLUMN public.crm_ai_agents.prompt_transferencia IS
  'Quando a IA passa para o humano: o Claude classifica cada mensagem com este texto ({transferir, motivo}) antes de responder.';

-- Modelo pronto do prompt de transferência (lógica dos agentes do SellFlux importados em 20261017110000), só onde está vazio.
UPDATE public.crm_ai_agents SET prompt_transferencia = $pt$Transfira para o atendimento humano (fila) quando a lead:
- perguntar preço, valor, quanto custa, forma de pagamento, parcelamento ou desconto;
- quiser fechar, comprar, pedir link de pagamento ou contrato;
- pedir reembolso, cancelamento ou garantia, ou reclamar de alguma coisa;
- pedir para falar com uma pessoa, um atendente ou com o Breno;
- pedir para reagendar, trocar o horário ou mudar o dia da consulta;
- trouxer dúvida clínica ou de saúde (remédio, doença, lesão, gestação, exame), inclusive em áudio;
- fizer a terceira pergunta fora do contexto deste roteiro (as duas primeiras a IA responde com o SUPORTE);
- chegar ao fim do roteiro (agendamento confirmado ou etapa final concluída).
Não transfira por "oi", "ok", "obrigada", confirmação curta ou resposta que o roteiro já cobre.
Depois de transferir, a IA não manda mais nada nesta conversa.$pt$
WHERE (prompt_transferencia IS NULL OR btrim(prompt_transferencia) = '')
  AND coalesce(tipo, 'atendimento') = 'atendimento';

-- 3) Contato -------------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_precisa_humano boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_respostas integer NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_falhas integer NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_transferido_em timestamptz;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_ai_precisa_humano_idx ON public.whatsapp_contacts (numero_id) WHERE ai_precisa_humano;

-- 4) Eventos (histórico das trocas + log por conversa) ---------------------------------------------
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS numero_id uuid;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS mensagem text;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS tokens_entrada integer;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS tokens_saida integer;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS custo_estimado_usd numeric;
ALTER TABLE public.crm_ai_eventos ADD COLUMN IF NOT EXISTS usuario_id uuid;
CREATE INDEX IF NOT EXISTS crm_ai_eventos_numero_idx ON public.crm_ai_eventos (numero_id, contact_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_ai_eventos_tipo_idx ON public.crm_ai_eventos (tipo, created_at DESC);

-- 5) Fila com debounce ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_ai_fila (
  id bigserial PRIMARY KEY,
  numero_id uuid,
  contact_phone text NOT NULL,
  agent_slug text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'processando', 'feito', 'ignorado', 'erro')),
  primeira_msg_em timestamptz NOT NULL DEFAULT now(),
  ultima_msg_em timestamptz NOT NULL DEFAULT now(),
  responder_apos timestamptz NOT NULL DEFAULT now(),
  n_mensagens integer NOT NULL DEFAULT 1,
  tentativas integer NOT NULL DEFAULT 0,
  pego_em timestamptz,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- uma pendência por conversa (número + telefone)
CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_fila_pendente_key
  ON public.crm_ai_fila (coalesce(numero_id, '00000000-0000-0000-0000-000000000000'::uuid), contact_phone)
  WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS crm_ai_fila_vencidos_idx ON public.crm_ai_fila (responder_apos) WHERE status = 'pendente';

ALTER TABLE public.crm_ai_fila ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved users read crm_ai_fila" ON public.crm_ai_fila;
CREATE POLICY "Approved users read crm_ai_fila" ON public.crm_ai_fila FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- 6) RPCs ------------------------------------------------------------------------------------------
-- Só service_role (webhook/robô) ou usuário aprovado (tela).
CREATE OR REPLACE FUNCTION public.crm_ai_pode()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(auth.role(), '') = 'service_role' OR coalesce(public.is_approved(auth.uid()), false);
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_pode() FROM PUBLIC, anon;

-- Mensagem da lead chegou numa conversa da IA: cria ou estica a pendência (debounce).
-- Mesma regra de src/test (calcularResponderApos): responder_apos = agora + debounce, no máximo 90 s depois
-- da primeira mensagem da rajada (lead que não para de digitar não deixa a IA muda para sempre).
CREATE OR REPLACE FUNCTION public.crm_ai_enfileirar(p_numero_id uuid, p_phone text, p_agent_slug text, p_debounce integer DEFAULT 30)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id bigint;
  v_primeira timestamptz;
  v_deb integer := greatest(10, least(120, coalesce(p_debounce, 30)));
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_ai_fila:' || coalesce(p_numero_id::text, '') || ':' || p_phone));
  SELECT id, primeira_msg_em INTO v_id, v_primeira FROM public.crm_ai_fila
   WHERE coalesce(numero_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_numero_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND contact_phone = p_phone AND status = 'pendente'
   FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE public.crm_ai_fila
       SET responder_apos = least(v_primeira + interval '90 seconds', now() + make_interval(secs => v_deb)),
           ultima_msg_em = now(), n_mensagens = n_mensagens + 1, agent_slug = p_agent_slug, updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;
  -- conversa em processamento: a pendência nova nasce e o worker só a pega quando o processamento terminar
  INSERT INTO public.crm_ai_fila (numero_id, contact_phone, agent_slug, responder_apos)
  VALUES (p_numero_id, p_phone, p_agent_slug, now() + make_interval(secs => v_deb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_enfileirar(uuid, text, text, integer) FROM PUBLIC, anon;

-- Worker: pega itens vencidos (trava por linha; duas execuções não pegam o mesmo). Destrava o que ficou
-- "processando" há mais de 5 min (função caiu no meio).
CREATE OR REPLACE FUNCTION public.crm_ai_fila_pegar(p_limite integer DEFAULT 5)
RETURNS SETOF public.crm_ai_fila LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'sem permissão'; END IF;
  -- travado com pendência nova da mesma conversa: a nova cobre (relê o histórico); o travado vira erro
  UPDATE public.crm_ai_fila SET status = 'erro', motivo = 'processamento parou no meio (há pendência mais nova)', updated_at = now()
   WHERE status = 'processando' AND pego_em < now() - interval '5 minutes'
     AND EXISTS (SELECT 1 FROM public.crm_ai_fila p2 WHERE p2.status = 'pendente'
                  AND coalesce(p2.numero_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(crm_ai_fila.numero_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  AND p2.contact_phone = crm_ai_fila.contact_phone);
  UPDATE public.crm_ai_fila SET status = 'pendente', motivo = 'destravado (processamento parou no meio)', updated_at = now()
   WHERE status = 'processando' AND pego_em < now() - interval '5 minutes';
  RETURN QUERY
  UPDATE public.crm_ai_fila f SET status = 'processando', pego_em = now(), tentativas = f.tentativas + 1, updated_at = now()
   WHERE f.id IN (
     SELECT id FROM public.crm_ai_fila
      WHERE status = 'pendente' AND responder_apos <= now()
        AND NOT EXISTS (SELECT 1 FROM public.crm_ai_fila p3 WHERE p3.status = 'processando'
                         AND coalesce(p3.numero_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(crm_ai_fila.numero_id, '00000000-0000-0000-0000-000000000000'::uuid)
                         AND p3.contact_phone = crm_ai_fila.contact_phone)
      ORDER BY responder_apos
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(1, least(20, coalesce(p_limite, 5)))
   )
  RETURNING f.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_fila_pegar(integer) FROM PUBLIC, anon, authenticated;

-- Botão "Transferir para IA" (tela) ou passo de fluxo: a IA passa a atender a conversa.
CREATE OR REPLACE FUNCTION public.crm_ai_transferir_para_ia(p_numero_id uuid, p_phone text, p_agent_slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ag record;
  v_n integer;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF p_phone LIKE '%@g.us' THEN RAISE EXCEPTION 'a IA nunca atende grupo'; END IF;
  SELECT id, slug, nome, numero_id, coalesce(tipo, 'atendimento') AS tipo INTO v_ag FROM public.crm_ai_agents WHERE slug = p_agent_slug;
  IF v_ag.id IS NULL THEN RAISE EXCEPTION 'agente não existe'; END IF;
  IF v_ag.tipo <> 'atendimento' THEN RAISE EXCEPTION 'agente de follow-up não atende conversa'; END IF;
  IF p_numero_id IS NOT NULL AND v_ag.numero_id IS DISTINCT FROM p_numero_id THEN
    RAISE EXCEPTION 'o agente % responde em outro número', v_ag.nome;
  END IF;
  UPDATE public.whatsapp_contacts
     SET ai_agent_slug = v_ag.slug, ai_pausado = false, ai_pausado_motivo = null, ai_atribuido_em = now(),
         ai_precisa_humano = false, ai_respostas = 0, ai_falhas = 0, updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'conversa não encontrada'; END IF;
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, agent_id, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_ag.slug, v_ag.id, 'transferido_ia', 'transferido para a IA (' || v_ag.nome || ')', auth.uid());
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_transferir_para_ia(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_transferir_para_ia(uuid, text, text) TO authenticated, service_role;

-- Botão "Assumir (humano)": a IA para nesta conversa e o selo "Precisa de humano" sai.
CREATE OR REPLACE FUNCTION public.crm_ai_assumir(p_numero_id uuid, p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_slug text;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT ai_agent_slug INTO v_slug FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = 'humano assumiu', ai_precisa_humano = false, updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano assumiu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente'
     AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_slug, 'assumido_humano', 'humano assumiu a conversa', auth.uid());
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_assumir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_assumir(uuid, text) TO authenticated, service_role;

-- Mensagem de humano (CRM ou celular) numa conversa: pausa a IA se ela estava atendendo e tira o selo
-- "Precisa de humano" (alguém atendeu). Devolve true quando pausou a IA.
CREATE OR REPLACE FUNCTION public.crm_ai_pausar_por_humano(p_numero_id uuid, p_phone text, p_origem text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_slug text;
  v_ativa boolean;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT ai_agent_slug, (ai_agent_slug IS NOT NULL AND NOT ai_pausado) INTO v_slug, v_ativa
    FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts SET ai_precisa_humano = false
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) AND ai_precisa_humano;
  IF NOT coalesce(v_ativa, false) THEN RETURN false; END IF;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = left(coalesce(p_origem, 'humano respondeu'), 200), updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano respondeu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente' AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe)
  VALUES (p_phone, p_numero_id, v_slug, 'pausado_humano', left(coalesce(p_origem, 'humano respondeu'), 200));
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_pausar_por_humano(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_pausar_por_humano(uuid, text, text) TO authenticated, service_role;

-- 7) Tick do pg_cron -------------------------------------------------------------------------------
INSERT INTO public.integracao_config (chave, valor)
VALUES ('ai_robo_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('ai_robo_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/ai-robo-tick')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_ai_robo_tick()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_url text;
  v_segredo text;
BEGIN
  -- só chama quando há item vencido (ou vencendo no próximo minuto); fila vazia = nenhuma chamada
  IF NOT EXISTS (SELECT 1 FROM public.crm_ai_fila WHERE status = 'pendente' AND responder_apos <= now() + interval '1 minute')
     AND NOT EXISTS (SELECT 1 FROM public.crm_ai_fila WHERE status = 'processando' AND pego_em < now() - interval '5 minutes') THEN
    RETURN 'nada a fazer';
  END IF;
  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'ai_robo_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'ai_robo_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN RETURN 'sem url/segredo'; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('modo', 'tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ai-robo-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_robo_tick() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Agenda (fora da transação). Reagendar com o mesmo nome substitui. Com todos os números desligados a fila
-- fica vazia e o tick responde 'nada a fazer' sem chamar a função.
SELECT cron.schedule('crm-ai-robo-tick', '* * * * *', 'SELECT public.crm_ai_robo_tick()');

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar as edge functions: ai-robo-tick (nova, verify_jwt = false), openwa-webhook, whatsapp-send,
--     whatsapp-send-media, ai-agent-simular, crm-automacoes.
--  2) Nada liga sozinho. Para testar num número: CRM > Agente IA > "Robô de IA ligado" no número escolhido,
--     depois "Transferir para IA" numa conversa de teste.
--  Parar tudo de uma vez: UPDATE public.crm_numeros SET robo_ia_ligado = false;
--                         SELECT cron.unschedule('crm-ai-robo-tick');
-- =============================================================
