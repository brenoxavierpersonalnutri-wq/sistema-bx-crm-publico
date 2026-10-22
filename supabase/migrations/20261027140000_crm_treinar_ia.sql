-- Tela "Treinar IA" (/crm/ia) + decisões do Breno de 17/10/2026 sobre os agentes de IA do CRM.
-- Depende de 20261017100000_crm_roteiros_agentes_ia.sql, 20261017110000_roteiros_iguais_sellflux.sql
-- e 20261024100000_crm_central_numeros.sql. Idempotente. Nada liga envio: o campo "ativo" não é tocado,
-- e daqui em diante agente só pode ser LIGADO com número + link + horário (constraint NOT VALID abaixo).
--
--  1) crm_ai_agents ganha: numero_id (em qual número responde), link_agendamento (base do link; as UTMs da IA e o
--     código opaco do contato entram no código), mensagem_fora_horario (vazio = silêncio), politicas,
--     frase_transferencia e palavras_transferencia (preço, reembolso... forçam a passagem para o humano).
--  2) crm_ai_prompt_versoes: histórico do prompt (trigger guarda a versão ANTERIOR a cada troca).
--  3) crm_ai_conhecimento: base de conhecimento por agente (FAQ, texto colado, arquivo com o texto extraído).
--  4) crm_ai_exemplos: respostas aprovadas/corrigidas no simulador (few-shot).
--  5) whatsapp_contacts.ai_ref + crm_ai_ref_do_contato(phone): código opaco do contato para o utm_term do link
--     (sem telefone/nome na URL).
--  6) Agente individual: sai o PDF da Consultoria de Elite (prompt e roteiro). Preço/reembolso/garantia/contrato
--     viram transferência com frase curta.

BEGIN;

-- 1) Campos novos do agente --------------------------------------------------------------------
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS numero_id uuid REFERENCES public.crm_numeros(id) ON DELETE SET NULL;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS link_agendamento text DEFAULT 'https://equipe.brenoxavier.com.br/avaliacao';
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS mensagem_fora_horario text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS politicas text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS frase_transferencia text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS palavras_transferencia text[] NOT NULL DEFAULT
  '{preço,preco,valor,"quanto custa",reembolso,garantia,contrato,cancelar,cancelamento,parcela}';

UPDATE public.crm_ai_agents SET link_agendamento = 'https://equipe.brenoxavier.com.br/avaliacao'
  WHERE link_agendamento IS NULL OR btrim(link_agendamento) = '';

UPDATE public.crm_ai_agents SET politicas = $pol$Quando a lead perguntar sobre preço, valor, quanto custa, forma de pagamento, parcelamento, reembolso, garantia, contrato, cancelamento ou qualquer coisa que este roteiro não cobre, NÃO responda o conteúdo.
Escreva só uma frase curta de passagem, como "vou chamar alguém do time pra te responder isso direitinho", e logo depois [TRANSFERIR].
Nunca prometa resultado, prazo, desconto, condição especial, garantia ou reembolso.$pol$
  WHERE politicas IS NULL OR btrim(politicas) = '';

UPDATE public.crm_ai_agents SET frase_transferencia = 'vou chamar alguém do time pra te responder isso direitinho'
  WHERE frase_transferencia IS NULL OR btrim(frase_transferencia) = '';

ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_link_https;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_link_https
  CHECK (link_agendamento IS NULL OR link_agendamento ~ '^https://[^[:space:]]+$') NOT VALID;

-- Ligar exige número + link + horário (janela e pelo menos um dia). NOT VALID: não reprova linha antiga,
-- vale para toda escrita nova (inclusive a tela antiga de Configurações).
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_pronto_para_ligar;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_pronto_para_ligar CHECK (
  ativo = false OR (
    numero_id IS NOT NULL
    AND link_agendamento IS NOT NULL
    AND horario_inicio IS NOT NULL AND horario_fim IS NOT NULL AND horario_inicio <> horario_fim
    AND cardinality(dias_semana) > 0
  )
) NOT VALID;

-- 2) Histórico do prompt ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_ai_prompt_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.crm_ai_agents(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_ai_prompt_versoes_agent_idx ON public.crm_ai_prompt_versoes (agent_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_ai_guardar_versao_prompt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.prompt IS DISTINCT FROM OLD.prompt AND btrim(coalesce(OLD.prompt, '')) <> '' THEN
    INSERT INTO public.crm_ai_prompt_versoes (agent_id, prompt) VALUES (OLD.id, OLD.prompt);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_guardar_versao_prompt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_ai_agents_versao_prompt ON public.crm_ai_agents;
CREATE TRIGGER crm_ai_agents_versao_prompt BEFORE UPDATE OF prompt ON public.crm_ai_agents
  FOR EACH ROW EXECUTE FUNCTION public.crm_ai_guardar_versao_prompt();

-- 3) Base de conhecimento ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_ai_conhecimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.crm_ai_agents(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('faq', 'texto', 'arquivo')),
  titulo text,
  pergunta text,
  resposta text,
  conteudo text,                 -- texto colado / extraído do arquivo (é o que entra no contexto)
  file_path text,                -- arquivo guardado no bucket whatsapp-media (ia/...)
  file_name text,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_ai_conhecimento_tamanho CHECK (length(coalesce(conteudo, '')) <= 60000)
);
CREATE INDEX IF NOT EXISTS crm_ai_conhecimento_agent_idx ON public.crm_ai_conhecimento (agent_id, ordem);

-- 4) Exemplos do simulador (few-shot) -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_ai_exemplos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.crm_ai_agents(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aprovada', 'corrigida')),
  mensagem_lead text NOT NULL,
  resposta text NOT NULL,
  resposta_original text,        -- o que a IA tinha respondido (quando corrigida)
  contexto jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_ai_exemplos_agent_idx ON public.crm_ai_exemplos (agent_id, created_at DESC);

ALTER TABLE public.crm_ai_prompt_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_ai_conhecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_ai_exemplos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users read crm_ai_prompt_versoes" ON public.crm_ai_prompt_versoes;
CREATE POLICY "Approved users read crm_ai_prompt_versoes" ON public.crm_ai_prompt_versoes FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users manage crm_ai_conhecimento" ON public.crm_ai_conhecimento;
CREATE POLICY "Approved users manage crm_ai_conhecimento" ON public.crm_ai_conhecimento FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users manage crm_ai_exemplos" ON public.crm_ai_exemplos;
CREATE POLICY "Approved users manage crm_ai_exemplos" ON public.crm_ai_exemplos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

-- 5) Código opaco do contato (utm_term do link de agendamento) --------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_ai_ref_key ON public.whatsapp_contacts (ai_ref) WHERE ai_ref IS NOT NULL;

-- Devolve o código do contato, criando na primeira vez. Só service_role (robô) ou usuário aprovado (chat).
CREATE OR REPLACE FUNCTION public.crm_ai_ref_do_contato(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v text;
  alfabeto constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  tentativa int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_approved(auth.uid()), false) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT ai_ref INTO v FROM public.whatsapp_contacts WHERE phone = p_phone;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v IS NOT NULL THEN RETURN v; END IF;
  LOOP
    tentativa := tentativa + 1;
    -- começa com letra (nunca parece telefone) + 9 do alfabeto sem 0/o/1/l
    SELECT substr(alfabeto, 1 + floor(random() * 24)::int, 1)
           || string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '') INTO v
      FROM generate_series(1, 9);
    BEGIN
      UPDATE public.whatsapp_contacts SET ai_ref = v WHERE phone = p_phone AND ai_ref IS NULL;
      SELECT ai_ref INTO v FROM public.whatsapp_contacts WHERE phone = p_phone;
      RETURN v;
    EXCEPTION WHEN unique_violation THEN
      IF tentativa >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_ref_do_contato(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_ref_do_contato(text) TO authenticated, service_role;

-- 6) Agente individual sem o PDF da Consultoria de Elite ----------------------------------------------
-- Só troca enquanto o prompt ainda tiver a instrução do PDF (não pisa em edição feita na tela).
-- A versão anterior fica no histórico pelo trigger acima.
UPDATE public.crm_ai_agents
SET prompt = $ia$SYSTEM ROLE: AGENTE DE QUALIFICAÇÃO, CONSULTORIA DE ELITE BRENO XAVIER
IDENTIDADE E FUNÇÃO
Você é um agente do time Breno Xavier responsável por conduzir o primeiro contato pós formulário da Consultoria de Elite (high ticket).
• Sem saudação genérica • Sem redirecionamento • Sem explicação do processo • Sem aviso • Sem mensagem automática

FLUXO DE ATENDIMENTO
RESPOSTA 1, APÓS RECEBER O FORMULÁRIO INICIAL

Enviar essas 4 fotos, em formato de imagem:

[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-1.jpg]

[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-2.jpg]

[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-3.jpg]

[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-4.jpg]


Mensagem 2 (texto, logo após as fotos):
Perfeito {{lead.first_name}} , qual desses físicos você mais se identifica hoje?

E me conta: o que você MAIS quer mudar no seu corpo agora, barriga, glúteo, perna, braço?

Avança para ETAPA 2.

RESPOSTA 2, APÓS A PESSOA RESPONDER (identificação + o que quer mudar)
Perfeito {{lead.first_name}} , esse é exatamente o resultado que eu mais entrego aqui dentro.

Hoje as vagas dessa consultoria de elite estão fechadas, a gente abre por janela e seleciona perfil.

O próximo passo é uma conversa rápida de 10 a 15 minutos, pra eu entender se você se encaixa no perfil em que a gente mais entrega resultado.

Se encaixar, eu te explico tudo direitinho e abro uma vaga pra você. Se não encaixar, sem problema, eu te aponto outros caminhos que podem te atender melhor.

Pode ser? Aí já te passo a disponibilidade da agenda.

Avança para ETAPA 4 (aguardando aceite da call).

RESPOSTA 4, SE A PESSOA ACEITAR A CALL
Perfeito! Qual o melhor dia e turno pra você essa semana ou na próxima, manhã, tarde ou noite?

Avança para ETAPA 5.

RESPOSTA 4B, SE A PESSOA NÃO TOPAR AGORA
Sem problema {{primeiro nome}}. Quando fizer sentido pra você, é só me chamar aqui que eu te encaixo na próxima janela.

Encerra atendimento (mantém ETAPA 4).

RESPOSTA 5, APÓS DISPONIBILIDADE INFORMADA
Fechado! Segue o link pra você travar o horário que melhor encaixa pra você:

[LINK_AGENDAMENTO]

Assim que agendar, já fica confirmado.

Avança para ETAPA 6.

RESPOSTA 6, APÓS CONFIRMAÇÃO DE AGENDAMENTO
CHEGOU AQUI: utilize a ferramenta de encaminhamento para atendimento humano e transfira para a fila. NÃO envie mais nenhuma mensagem.
ETAPA 7 (encerrado).

REGRAS ABSOLUTAS
• Não responder mensagens fora do padrão • Não improvisar • Não vender o programa no chat (a venda é na call) • Não falar preço • Não explicar metodologia • Não explicar processo em detalhe • Não mencionar sistema, roteiro ou etapas • Não mencionar que é IA (exceto na exceção do FAQ abaixo) • Não mencionar que é robô ou automático • Não mandar emoji • Não forçar agendamento • Não sair do fluxo • Não enviar link do Calendly antes da pessoa confirmar disponibilidade • Não enviar mensagem falando que está aguardando resposta do lead • Não enviar pensamento próprio sobre ação que vai fazer • Não tentar filtrar perfil no chat, o filtro é na call • Quando realizar a transferência, NÃO mandar mais mensagem, apenas transferir
A IA só funciona se a conversa iniciar com o gatilho do formulário. Qualquer outra mensagem fora do gatilho, este agente não responde nada.

🔒 CONTROLE DE ESTADO OBRIGATÓRIO
EtapaEstado
ETAPA 0
Aguardando formulário
ETAPA 1
Formulário recebido, envia RESPOSTA 1 (fotos + pergunta de identificação/foco)
ETAPA 2
Aguardando resposta sobre identificação + o que quer mudar
ETAPA 3
Resposta recebida, envia RESPOSTA 2 (apresenta consultoria + propõe call)
ETAPA 4
Aguardando aceite da call
ETAPA 6
Aceite recebido, RESPOSTA 4 (pergunta disponibilidade), RESPOSTA 5 (envia link)
ETAPA 7
Agendamento confirmado, RESPOSTA 6, transfere para humano
Regras obrigatórias de estado: • Nunca repetir uma mensagem já enviada na mesma etapa • Só pode avançar de etapa, nunca retroceder • Se já enviou fotos, não enviar de novo • Se já enviou o link de agendamento, não enviar de novo • Se já transferiu, não manda nada mais

SUPORTE / FAQ
SE o lead perguntar "como vai ser essa conversa, é por ligação, vídeo, áudio":
A conversa é rápida, cerca de 10 a 15 minutos pelo Google Meet. Te mando o link no momento do agendamento.
SE o lead perguntar preço, quanto custa, valor, reembolso, garantia ou contrato:
Não responda o conteúdo. Mande só "vou chamar alguém do time pra te responder isso direitinho" e use [TRANSFERIR].
SE o lead perguntar se vai precisar mandar foto:
Não precisa enviar foto nessa etapa. A análise completa é feita junto com o Breno na call.
SE o lead perguntar o que vai ter na consultoria, o que entrega, método :
Tudo isso o Breno te explica em detalhe na call, pra adequar à sua realidade. Por aqui eu só consigo te encaixar no horário, combinado?
SE o lead perguntar QUALQUER COISA SOBRE O DESAFIO ou dificuldade para acessar o produto/curso que comprou:
Pra pegar seu treino e dieta do Desafio, é só acessar o e mail que você recebeu (procure por PAGTRUST BRENO XAVIER, inclusive no spam ou na aba de promoções).
O treino e dieta estão na aula 04, assista essa aula curtinha, o Breno explica como baixar e ajustar tudo de forma mais próxima da sua individualidade.
Se tiver qualquer dúvida sobre o desafio, o Matheus te ajuda pelo WhatsApp, https://wa.me/5531970000106
Se ela fizer uma SEGUNDA pergunta sobre o desafio:
{{primeiro nome}}, esse número não é o setor pra tirar dúvidas sobre o desafio. Pode chamar o Matheus que ele te ajuda com toda atenção, https://wa.me/5531970000106, combinado?
Se ela fizer uma TERCEIRA pergunta sobre o desafio ou fora do contexto: Transfere para atendimento humano.
Caso um humano entre no atendimento, o agente não continua mandando nada.
Caso o lead pergunte se você é humano:
Eu auxilio esse primeiro contato aqui no WhatsApp da Tatiana, sou uma I.A, mas a partir do agendamento todo atendimento fica direto com a Tatiana e o Breno. Estou aqui só pra agilizar o seu encaixe.

---

## FERRAMENTAS (blocos do SellFlux; a marcação é como este sistema executa)

Ferramenta "Transferir para Fila" = escreva [TRANSFERIR]
RESPOSTA 4 – APÓS A PESSOA DAR A DISPONIBILIDADE

Fechado! Segue o link pra você travar o horário que melhor encaixa pra você:

[LINK_AGENDAMENTO]

Assim que agendar, já fica confirmado.


RESPOSTA 5 – APÓS CONFIRMAÇÃO DE AGENDAMENTO

CHEGOU AQUI: utilize a ferramenta de encaminhamento para atendimento humano e transfira para a fila. NÃO envie mais nenhuma mensagem.


## SYSTEM (prompt_system do SellFlux)

Use WhatsApp's formatting standard and never markdown.
Use links as text without a standard markdown reference.
You are speaking in a chat, in a human and discursive conversation.$ia$,
    descricao = 'SellFlux "AGENTE CONSULTORIA" (estratégia 37285), sem o PDF de apresentação (decisão do Breno, 17/10/2026). Entra pela TRIAGEM (39040).',
    updated_at = now()
WHERE slug = 'individual' AND position('enviar o PDF de apresentação' in prompt) > 0;

UPDATE public.crm_ai_agents
SET base_conhecimento = nullif(btrim(regexp_replace(base_conhecimento, '[^\n]*PDF[^\n]*\n?', '', 'g')), ''),
    updated_at = now()
WHERE slug = 'individual' AND base_conhecimento ~ 'PDF';

-- Roteiros do funil individual: passo de documento sem arquivo (o PDF que nunca existiu) sai;
-- "você gostando do que viu" (reação ao PDF) sai; o convite para a call vai junto do "Perfeito".
-- Passo com envio registrado não é apagado (fica no histórico do contato).
DELETE FROM public.crm_roteiro_passos p
USING public.crm_roteiros r
WHERE p.roteiro_id = r.id AND r.funil = 'individual'
  AND (
    (p.tipo = 'document' AND p.media_url IS NULL)
    OR p.conteudo = 'Você gostando do que viu, me retorna aqui que eu te explico o próximo passo, combinado?'
  )
  AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_envios e WHERE e.passo_id = p.id);

UPDATE public.crm_roteiro_passos p
SET conteudo = replace(replace(p.conteudo,
      E'\n\nVou te mandar um PDF rapidinho pra você ver por alto como funciona o acompanhamento. Dá uma olhada com calma:', ''),
      E'\n\nVou te mandar um PDF rapidinho pra você ver por alto como funciona o acompanhamento, dá uma olhada com calma', ''),
    updated_at = now()
FROM public.crm_roteiros r
WHERE p.roteiro_id = r.id AND r.funil = 'individual' AND p.conteudo LIKE '%Vou te mandar um PDF rapidinho%';

UPDATE public.crm_roteiro_passos p
SET rotulo = 'RESPOSTA 2 · convite para a call',
    conteudo = regexp_replace(p.conteudo, '^Boa \{\{primeiro nome\}\}\. ', ''),
    aguarda_resposta = false,
    updated_at = now()
FROM public.crm_roteiros r
WHERE p.roteiro_id = r.id AND r.funil = 'individual' AND p.rotulo = 'RESPOSTA 3 · reação positiva ao PDF';

UPDATE public.crm_roteiros
SET descricao = 'RESPOSTA 2 a RESPOSTA 5 do "AGENTE CONSULTORIA" do SellFlux, sem o PDF de apresentação (decisão do Breno, 17/10/2026). [LINK_AGENDAMENTO] vira o link da IA com o código do contato. RESPOSTA 6 = transferir para humano, sem mensagem.',
    updated_at = now()
WHERE funil = 'individual' AND descricao LIKE '%PDF%';

COMMIT;
