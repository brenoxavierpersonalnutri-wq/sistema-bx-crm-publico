-- =============================================================
-- CRM: FLUXOS de várias etapas (igual aos workflows do Full Funnel) + catálogo de templates oficiais.
-- Rodar inteiro no SQL editor do Lovable Cloud DEPOIS da 20261018100000. Idempotente (pode rodar 2x).
--
-- TUDO NASCE DESLIGADO: crm_fluxos.ativo = false; os 5 workflows do Full Funnel entram como RASCUNHO.
-- Quem executa: a edge function crm-automacoes (mesmo pg_cron de 1/min). Mensagem não oficial de um fluxo
-- entra na crm_automacao_fila e respeita os mesmos limites (30/h, 200/dia, 8h-20h, intervalo aleatório).
-- Template oficial continua saindo pelo Full Funnel (POST no Inbound Webhook de fullfunnel_webhook_crm_url).
--
-- Engenharia reversa do Full Funnel (17/10/2026): ~/HEAD TURBO/inteligencia-fullfunnel/00-engenharia-reversa.md
-- =============================================================

BEGIN;

-- 1) Eventos externos (lead qualificado, compra aprovada...) como gatilho -------------------------
ALTER TABLE public.crm_contato_eventos ADD COLUMN IF NOT EXISTS dados jsonb;
ALTER TABLE public.crm_contato_eventos DROP CONSTRAINT IF EXISTS crm_contato_eventos_tipo_check;
ALTER TABLE public.crm_contato_eventos
  ADD CONSTRAINT crm_contato_eventos_tipo_check CHECK (tipo IN ('etapa', 'tag', 'evento'));

-- Quem produz o evento (edge function do PagTrust, trigger do formulário...) chama esta função com a
-- service_role. Cria o contato se não existir (só telefone/nome) e grava o evento com os dados livres
-- (email, produto...) que o fluxo pode usar como {dados.email} nas variáveis do template.
CREATE OR REPLACE FUNCTION public.crm_registrar_evento(
  p_phone  text,
  p_evento text,
  p_nome   text DEFAULT NULL,
  p_dados  jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_evento text := left(trim(both '_' from regexp_replace(lower(coalesce(p_evento, '')), '[^a-z0-9_]+', '_', 'g')), 60);
  v_id     bigint;
BEGIN
  IF length(v_phone) < 10 OR length(v_phone) > 15 THEN
    RAISE EXCEPTION 'telefone inválido';
  END IF;
  IF v_evento = '' THEN
    RAISE EXCEPTION 'evento vazio';
  END IF;
  -- celular BR sem DDI vira 55...
  IF length(v_phone) IN (10, 11) THEN v_phone := '55' || v_phone; END IF;

  INSERT INTO public.whatsapp_contacts (phone, name, source)
  VALUES (v_phone, coalesce(nullif(btrim(p_nome), ''), ''), 'evento')
  ON CONFLICT (phone) DO UPDATE
    SET name = CASE WHEN coalesce(public.whatsapp_contacts.name, '') = '' THEN EXCLUDED.name ELSE public.whatsapp_contacts.name END;

  INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor, dados)
  VALUES (v_phone, 'evento', v_evento, coalesce(p_dados, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_registrar_evento(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_registrar_evento(text, text, text, jsonb) TO service_role;

-- 2) Catálogo de templates oficiais (espelho do Full Funnel) ---------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_wa_templates (
  nome            text PRIMARY KEY,                 -- nome do template na Meta (o mesmo do If/Else no Full Funnel)
  meta_id         text,
  categoria       text NOT NULL DEFAULT 'UTILITY' CHECK (categoria IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  idioma          text NOT NULL DEFAULT 'pt_BR',
  status          text NOT NULL DEFAULT 'APPROVED',  -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  corpo           text NOT NULL,
  cabecalho       jsonb,                            -- null = sem cabeçalho/mídia
  botoes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  rotulos_variaveis jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"1":"nome","2":"email"}
  origem          text NOT NULL DEFAULT 'fullfunnel',
  numero_id       uuid,                             -- número (crm_numeros) dono do template; FK no bloco 8
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_wa_templates ADD COLUMN IF NOT EXISTS numero_id uuid;
ALTER TABLE public.crm_wa_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved manage crm_wa_templates" ON public.crm_wa_templates;
CREATE POLICY "Approved manage crm_wa_templates" ON public.crm_wa_templates FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

INSERT INTO public.crm_wa_templates (nome, meta_id, categoria, status, corpo, botoes, rotulos_variaveis) VALUES
('01boas_vindas', '100000000000001', 'MARKETING', 'APPROVED',
 E'Sua compra no *DESAFIO MAGRA E DEFINIDA 14 DIAS* acaba de ser confirmada, agora você já é minha aluna!!\n\n\nMeus parabéns, tô muito feliz em te receber {{1}} 🥳🤩🥰\n\nSuas instruções de acesso foram enviados para o seguinte email👇\n\nO treino e a dieta estão na descrição da aula 04 (não deixe de assistir as aulas, são bem curtas e diretas)\n\nEmail: {{2}} \n\nAntes de continuarmos, me confirma se o seu email está correto',
 '[]', '{"1":"nome","2":"email"}'),
('b1', '100000000000002', 'UTILITY', 'APPROVED',
 E'Olá, {{1}}! 🎉\n\nSeu pagamento do DESAFIO MAIS SLIM 14 DIAS foi confirmado com sucesso.\n\nAs instruções de acesso já foram enviadas para o e-mail cadastrado.\nPoderia verificar e me confirmar se recebeu?',
 '[]', '{"1":"nome"}'),
('boasvindas', '100000000000003', 'MARKETING', 'APPROVED',
 E'Sua compra na oferta especial do meu *{{1}}* acaba de ser confirmada, agora você já é minha aluna!!\n\nMeus parabéns, tô muito feliz em te receber {{2}} 🥳🤩🥰\n\nSuas instruções de acesso foram enviados para o seguinte email👇\n\nEmail: {{3}} \n\n*Antes de continuarmos, me confirma se o seu email está correto*',
 '[]', '{"1":"produto","2":"nome","3":"email"}'),
('boasvindas000novo', '100000000000004', 'MARKETING', 'APPROVED',
 E'Sua compra na oferta especial do meu *{{1}}* acaba de ser confirmada, agora você já é minha aluna!!\n\nMeus parabéns, tô muito feliz em te receber {{2}} 🥳🤩🥰\n\nSuas instruções de acesso foram enviados para o seguinte email👇\n\nEmail: {{3}} \n\n*Antes de continuarmos, me confirma se o seu email está correto*',
 '[]', '{"1":"produto","2":"nome","3":"email"}'),
('boasvindas0326', '100000000000005', 'MARKETING', 'APPROVED',
 E'Olá, {{1}}. Seu pagamento referente ao DESAFIO MAIS SLIM 14 DIAS foi processado com sucesso.\n\nAs orientações de acesso já estão disponíveis no endereço de e-mail cadastrado.\n\nPoderia confirmar se o e-mail foi recebido?',
 '[]', '{"1":"nome"}'),
('bv2', '100000000000006', 'UTILITY', 'APPROVED',
 E'Olá, {{1}}! 👋\n\nSeu pagamento do DESAFIO MAIS SLIM 14 DIAS foi aprovado.\n\nAs orientações de acesso já estão no seu e-mail cadastrado.\nQuando puder, me confirme se recebeu.',
 '[]', '{"1":"nome"}'),
('confirmacao_03', '100000000000007', 'MARKETING', 'APPROVED',
 E'Sua compra na oferta especial do meu *{{1}}* acaba de ser confirmada, agora você já é minha aluna!!\n\nMeus parabéns, tô muito feliz em te receber {{2}} 🥳🤩🥰\n\nSuas instruções de acesso foram enviados para o seguinte email👇\n\nEmail: {{3}} \n\n*Antes de continuarmos, me confirma se o seu email está correto*',
 '[]', '{"1":"produto","2":"nome","3":"email"}'),
('novo_boas_vindas', '100000000000008', 'MARKETING', 'APPROVED',
 E'Sua compra no *DESAFIO MAGRA E DEFINIDA 14 DIAS* acaba de ser confirmada, agora você já é minha aluna!!\n\n\nMeus parabéns, tô muito feliz em te receber {{1}} 🥳🤩🥰\n\nSuas instruções de acesso foram enviados para o seguinte email👇\n\nO treino e a dieta estão na descrição da aula 04 (não deixe de assistir as aulas, são bem curtas e diretas)\n\nEmail: {{2}} \n\nAntes de continuarmos, me confirma se o seu email está correto',
 '[]', '{"1":"nome","2":"email"}'),
('qualificadoavaliacao', '100000000000009', 'UTILITY', 'APPROVED',
 E'Olá, {{1}}! 👋\n\nRecebemos o seu formulário de avaliação com sucesso. ✅\n\nAgora é só tocar no botão abaixo para iniciar a sua avaliação.',
 '[{"type":"URL","text":"Iniciar avaliação","url":"https://bgimplementacao.brenoxavier.com.br/avaliacao"}]', '{"1":"nome"}'),
('acesso_desafio_grupo_v1', '100000000000010', 'UTILITY', 'APPROVED',
 'Olá, {{1}}! Seu pagamento do DESAFIO MAIS SLIM 14 DIAS foi aprovado. As orientações de acesso já foram enviadas para o seu e-mail. Para receber os avisos e o passo a passo do desafio, toque no botão abaixo e entre no grupo das participantes.',
 '[{"type":"URL","text":"Entrar no grupo","url":"https://equipe.brenoxavier.com.br/r/grupo-desafio"}]', '{"1":"nome"}')
ON CONFLICT (nome) DO UPDATE SET
  meta_id = EXCLUDED.meta_id, categoria = EXCLUDED.categoria, status = EXCLUDED.status, corpo = EXCLUDED.corpo,
  botoes = EXCLUDED.botoes, rotulos_variaveis = EXCLUDED.rotulos_variaveis, sincronizado_em = now()
WHERE public.crm_wa_templates.origem = 'fullfunnel';

-- 3) Fluxos ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_fluxos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text NOT NULL,
  descricao             text,
  ativo                 boolean NOT NULL DEFAULT false,
  gatilho_tipo          text NOT NULL CHECK (gatilho_tipo IN ('tag', 'etapa', 'evento')),
  gatilho_valor         text,
  parar_se_responder    boolean NOT NULL DEFAULT false,
  permitir_repetir      boolean NOT NULL DEFAULT false,
  passos                jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(passos) = 'array' AND jsonb_array_length(passos) <= 30),
  origem_ff_workflow_id text UNIQUE,              -- workflow do Full Funnel que este rascunho espelha
  numero_id             uuid,                     -- número de WhatsApp do fluxo (crm_numeros); FK no bloco 8
  ligado_em             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_fluxos ADD COLUMN IF NOT EXISTS numero_id uuid;
-- mesmo carimbo das automações: ligado_em é do servidor (gatilho só olha dali pra frente)
DROP TRIGGER IF EXISTS trg_crm_fluxos_ligado ON public.crm_fluxos;
CREATE TRIGGER trg_crm_fluxos_ligado
BEFORE INSERT OR UPDATE ON public.crm_fluxos
FOR EACH ROW EXECUTE FUNCTION public.crm_automacoes_marcar_ligado();

CREATE TABLE IF NOT EXISTS public.crm_fluxo_execucoes (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fluxo_id            uuid NOT NULL REFERENCES public.crm_fluxos(id) ON DELETE CASCADE,
  contact_phone       text NOT NULL,
  passo_idx           integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'concluido', 'parado', 'erro', 'cancelado')),
  proximo_em          timestamptz NOT NULL DEFAULT now(),
  aguardando_resposta boolean NOT NULL DEFAULT false,
  iniciado_em         timestamptz NOT NULL DEFAULT now(),
  ultimo_envio_em     timestamptz,
  dados               jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo              text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- no máximo UMA execução ativa por contato em cada fluxo
CREATE UNIQUE INDEX IF NOT EXISTS crm_fluxo_exec_ativa_key ON public.crm_fluxo_execucoes (fluxo_id, contact_phone) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS crm_fluxo_exec_proximo_idx ON public.crm_fluxo_execucoes (status, proximo_em);
CREATE INDEX IF NOT EXISTS crm_fluxo_exec_fluxo_idx ON public.crm_fluxo_execucoes (fluxo_id, contact_phone);

-- 4) Fila e log aceitam itens de fluxo ---------------------------------------------------------------
ALTER TABLE public.crm_automacao_fila DROP CONSTRAINT IF EXISTS crm_automacao_fila_origem_check;
ALTER TABLE public.crm_automacao_fila
  ADD CONSTRAINT crm_automacao_fila_origem_check CHECK (origem IN ('automacao', 'campanha', 'fluxo'));
ALTER TABLE public.crm_automacao_fila ADD COLUMN IF NOT EXISTS fluxo_id uuid REFERENCES public.crm_fluxos(id) ON DELETE CASCADE;
ALTER TABLE public.crm_automacao_fila ADD COLUMN IF NOT EXISTS fluxo_execucao_id bigint REFERENCES public.crm_fluxo_execucoes(id) ON DELETE CASCADE;
ALTER TABLE public.crm_automacao_fila ADD COLUMN IF NOT EXISTS passo_idx integer;
-- cada passo de cada execução entra na fila uma vez só
CREATE UNIQUE INDEX IF NOT EXISTS crm_fila_fluxo_passo_key ON public.crm_automacao_fila (fluxo_execucao_id, passo_idx);
ALTER TABLE public.crm_automacao_log ADD COLUMN IF NOT EXISTS fluxo_id uuid;

-- 5) RLS ---------------------------------------------------------------------------------------------
ALTER TABLE public.crm_fluxos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_fluxo_execucoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved manage crm_fluxos" ON public.crm_fluxos;
CREATE POLICY "Approved manage crm_fluxos" ON public.crm_fluxos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved read crm_fluxo_execucoes" ON public.crm_fluxo_execucoes;
CREATE POLICY "Approved read crm_fluxo_execucoes" ON public.crm_fluxo_execucoes FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
-- cancelar uma execução pela tela (só muda status de ativo para cancelado)
DROP POLICY IF EXISTS "Approved cancel crm_fluxo_execucoes" ON public.crm_fluxo_execucoes;
CREATE POLICY "Approved cancel crm_fluxo_execucoes" ON public.crm_fluxo_execucoes FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()) AND status = 'ativo')
  WITH CHECK (public.is_approved(auth.uid()) AND status = 'cancelado');

-- 6) Tick: também acorda com fluxo ligado ou execução ativa ----------------------------------------
CREATE OR REPLACE FUNCTION public.crm_automacoes_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_automacoes WHERE ativo)
     AND NOT EXISTS (SELECT 1 FROM public.crm_campanhas WHERE status = 'ativa')
     AND NOT EXISTS (SELECT 1 FROM public.crm_automacao_fila WHERE status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.crm_fluxos WHERE ativo)
     AND NOT EXISTS (SELECT 1 FROM public.crm_fluxo_execucoes WHERE status = 'ativo') THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'crm_automacoes_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'crm_automacoes_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-automacao-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.crm_automacoes_tick() FROM PUBLIC, anon, authenticated;

-- 7) Os 5 workflows do Full Funnel como RASCUNHO desligado -------------------------------------------
-- ON CONFLICT DO NOTHING: rodar de novo não sobrescreve o que o Breno editou na tela.
INSERT INTO public.crm_fluxos (nome, descricao, ativo, gatilho_tipo, gatilho_valor, parar_se_responder, permitir_repetir, passos, origem_ff_workflow_id) VALUES
('Leads qualificados – Breno Xavier (FF)',
 'Espelho do workflow 621465f1 do Full Funnel: Inbound Webhook → cria contato → tags → template qualificadoavaliacao (ramos Entregue/Não entregue vazios). Evento produzido pelo formulário da avaliação (nível ≠ DQ). NÃO ligar junto com o workflow do Full Funnel: a lead receberia 2x.',
 false, 'evento', 'lead_qualificado', false, true,
 '[{"tipo":"tag","acao":"por","tag":"lead-qualificado-breno"},
   {"tipo":"tag","acao":"por","tag":"lead-qualificado-avaliacao"},
   {"tipo":"template_oficial","template":"qualificadoavaliacao","variaveis":{"1":"{primeiro_nome}"}}]'::jsonb,
 '621465f1-a79b-41a0-9c94-54553b23ae3c'),
('PagTrust Desafio – Carrinho abandonado (FF)',
 'Espelho do workflow 2cde495b: Inbound Webhook do PagTrust → cria contato (nome, e-mail, +telefone) → tag. Sem mensagem no Full Funnel.',
 false, 'evento', 'pagtrust_desafio_carrinho_abandonado', false, true,
 '[{"tipo":"tag","acao":"por","tag":"desafio-carrinho-abandonado"}]'::jsonb,
 '2cde495b-5650-4d0d-af57-121a605c2cf6'),
('PagTrust Desafio – Compra aprovada (FF)',
 'Espelho do workflow fcb742cf: Inbound Webhook do PagTrust → cria contato (nome, e-mail, +55 checkout_phone) → tag. Sem mensagem no Full Funnel.',
 false, 'evento', 'pagtrust_desafio_compra_aprovada', false, true,
 '[{"tipo":"tag","acao":"por","tag":"desafio-compradora"}]'::jsonb,
 'fcb742cf-88cb-4546-9ed3-b03f9ef24bae'),
('PagTrust Low Ticket – Carrinho abandonado (FF)',
 'Espelho do workflow 005c66c3: Inbound Webhook do PagTrust → cria contato → tag. Sem mensagem no Full Funnel.',
 false, 'evento', 'pagtrust_lowticket_carrinho_abandonado', false, true,
 '[{"tipo":"tag","acao":"por","tag":"lowticket-carrinho-abandonado"}]'::jsonb,
 '005c66c3-50d6-483c-9880-7dab49371a7f'),
('PagTrust Low Ticket – Compra aprovada (FF)',
 'Espelho do workflow 0aadc5a9: Inbound Webhook do PagTrust → cria contato → tag. Sem mensagem no Full Funnel.',
 false, 'evento', 'pagtrust_lowticket_compra_aprovada', false, true,
 '[{"tipo":"tag","acao":"por","tag":"lowticket-comprador"}]'::jsonb,
 '0aadc5a9-f954-49b6-ac40-6c80e17b5022')
ON CONFLICT (origem_ff_workflow_id) DO NOTHING;

-- 8) Número de WhatsApp (crm_numeros, criada por outra migration da Central /crm/central) ------------
-- Se a tabela já existir: liga a FK e aponta os espelhos do Full Funnel + o catálogo para o número OFICIAL
-- (31) 7000-0102. Se ainda não existir: as colunas ficam sem FK; rode esta migration de novo depois
-- da crm_numeros (é idempotente) para ligar.
DO $$
DECLARE
  v_oficial uuid;
BEGIN
  IF to_regclass('public.crm_numeros') IS NULL THEN
    RAISE NOTICE 'crm_numeros ainda não existe: numero_id sem FK (rode de novo depois)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_fluxos_numero_id_fkey') THEN
    ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_numero_id_fkey
      FOREIGN KEY (numero_id) REFERENCES public.crm_numeros(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_wa_templates_numero_id_fkey') THEN
    ALTER TABLE public.crm_wa_templates ADD CONSTRAINT crm_wa_templates_numero_id_fkey
      FOREIGN KEY (numero_id) REFERENCES public.crm_numeros(id) ON DELETE SET NULL;
  END IF;
  EXECUTE $q$SELECT id FROM public.crm_numeros
             WHERE regexp_replace(coalesce(telefone, ''), '\D', '', 'g') LIKE '%3170000102'
             ORDER BY (tipo = 'oficial') DESC LIMIT 1$q$ INTO v_oficial;
  IF v_oficial IS NULL THEN
    RAISE NOTICE 'número oficial (31) 7000-0102 não cadastrado em crm_numeros: espelhos sem número';
    RETURN;
  END IF;
  UPDATE public.crm_fluxos SET numero_id = v_oficial WHERE origem_ff_workflow_id IS NOT NULL AND numero_id IS NULL;
  UPDATE public.crm_wa_templates SET numero_id = v_oficial WHERE origem = 'fullfunnel' AND numero_id IS NULL;
END $$;

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar de novo a edge function crm-automacoes (o motor dos fluxos está nela).
--  2) Ligar um fluxo = switch na tela Automações > Fluxos (só vale para eventos a partir daí).
--  3) Para o gatilho "evento" disparar, o produtor precisa chamar (service_role):
--       SELECT public.crm_registrar_evento('5531999998888', 'lead_qualificado', 'Maria', '{"email":"..."}');
--     Hoje NENHUM produtor chama isso (fase 3): os rascunhos ficam parados até alguém ligar o produtor.
--  Desligar tudo: UPDATE public.crm_fluxos SET ativo = false;
--                 UPDATE public.crm_fluxo_execucoes SET status = 'cancelado', motivo = 'desligado à mão' WHERE status = 'ativo';
-- =============================================================
