-- CRM: roteiros por etapa + agentes de IA (engenharia copiada do SellFlux, 16/10/2026).
-- Idempotente (IF NOT EXISTS / ON CONFLICT / seed só com tabela vazia).
-- Tudo nasce DESLIGADO: crm_ai_agents.ativo = false. O Breno liga na tela do CRM.
-- RLS: usuários aprovados (is_approved) gerenciam; as edge functions usam service_role.

-- 1) Roteiros por etapa ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_roteiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,                       -- id da coluna do kanban (leads, contato, ...)
  funil text NOT NULL DEFAULT 'geral',       -- avaliacao | individual | geral
  nome text NOT NULL,
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_roteiros_stage_idx ON public.crm_roteiros (stage, ordem);

CREATE TABLE IF NOT EXISTS public.crm_roteiro_passos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roteiro_id uuid NOT NULL REFERENCES public.crm_roteiros(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  tipo text NOT NULL DEFAULT 'text' CHECK (tipo IN ('text', 'audio', 'image', 'document')),
  rotulo text,                               -- nome curto do passo
  conteudo text NOT NULL DEFAULT '',         -- texto (tipo text) ou legenda (mídia)
  media_url text,                            -- link público/assinado do arquivo
  media_path text,                           -- caminho no bucket whatsapp-media, quando subiu por upload
  file_name text,
  atraso_segundos integer NOT NULL DEFAULT 0, -- espera sugerida antes deste passo
  aguarda_resposta boolean NOT NULL DEFAULT false, -- só enviar depois que a lead responder
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_roteiro_passos_roteiro_idx ON public.crm_roteiro_passos (roteiro_id, ordem);

-- Registro de envio manual (mostra "já enviado" por contato; não dispara nada)
CREATE TABLE IF NOT EXISTS public.crm_roteiro_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passo_id uuid NOT NULL REFERENCES public.crm_roteiro_passos(id) ON DELETE CASCADE,
  contact_phone text NOT NULL,
  enviado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_roteiro_envios_phone_idx ON public.crm_roteiro_envios (contact_phone, passo_id);

-- 2) Agentes de IA ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,                 -- avaliacao | individual (= funil dos roteiros)
  nome text NOT NULL,
  descricao text,
  prompt text NOT NULL DEFAULT '',
  base_conhecimento text,
  etapas text[] NOT NULL DEFAULT '{}',       -- etapas do kanban em que responde (vazio = todas)
  origens text[] NOT NULL DEFAULT '{}',      -- whatsapp_contacts.source que atribuem o agente
  gatilhos text[] NOT NULL DEFAULT '{}',     -- frases da mensagem que atribuem o agente (TRIAGEM)
  modelo text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  temperatura numeric NOT NULL DEFAULT 0.2,
  ativo boolean NOT NULL DEFAULT false,
  horario_inicio time,                       -- nulo = 24h (horário de Brasília)
  horario_fim time,
  dias_semana integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}', -- 0 = domingo
  limite_interacoes integer NOT NULL DEFAULT 15,
  historico_mensagens integer NOT NULL DEFAULT 20,
  atraso_segundos integer NOT NULL DEFAULT 6,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_ai_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_phone text NOT NULL,
  agent_slug text,
  tipo text NOT NULL,                        -- atribuido | resposta | transferido | pausado_humano | limite | fora_horario
  detalhe text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_ai_eventos_phone_idx ON public.crm_ai_eventos (contact_phone, created_at DESC);

ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_agent_slug text;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_pausado boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_pausado_motivo text;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS ai_atribuido_em timestamptz;

-- 3) RLS ----------------------------------------------------------------------------
ALTER TABLE public.crm_roteiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_roteiro_passos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_roteiro_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_ai_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users manage crm_roteiros" ON public.crm_roteiros;
CREATE POLICY "Approved users manage crm_roteiros" ON public.crm_roteiros FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users manage crm_roteiro_passos" ON public.crm_roteiro_passos;
CREATE POLICY "Approved users manage crm_roteiro_passos" ON public.crm_roteiro_passos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users manage crm_roteiro_envios" ON public.crm_roteiro_envios;
CREATE POLICY "Approved users manage crm_roteiro_envios" ON public.crm_roteiro_envios FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users manage crm_ai_agents" ON public.crm_ai_agents;
CREATE POLICY "Approved users manage crm_ai_agents" ON public.crm_ai_agents FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users read crm_ai_eventos" ON public.crm_ai_eventos;
CREATE POLICY "Approved users read crm_ai_eventos" ON public.crm_ai_eventos FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- 4) Agentes pré-carregados (DESLIGADOS) ----------------------------------------------
INSERT INTO public.crm_ai_agents (slug, nome, descricao, etapas, origens, gatilhos, modelo, temperatura, ativo, limite_interacoes, atraso_segundos, prompt, base_conhecimento)
VALUES (
  'avaliacao',
  'Avaliação fitness',
  'Confirma a avaliação gratuita agendada pelo formulário, manda os físicos de referência, pergunta treino e dieta e passa para o humano. Base: SellFlux "Avaliação - Pós Low" (211 atendimentos) + TRIAGEM.',
  '{leads,contato,agendado}',
  '{avaliacao}',
  '{"Fui qualificada no formulário de avaliação","agendar minha avaliação gratuita"}',
  'google/gemini-2.5-flash', 0.1, false, 15, 6,
$p$## PAPEL
Você é do time do Breno Xavier e confirma no WhatsApp a avaliação gratuita que a lead agendou pelo formulário. O método é o Slim e Definida, para a mulher da vida real que quer um corpo mais slim e definido (não só emagrecer).

Sem saudação automática. Sem explicar processo. Sem mencionar IA, robô, sistema ou roteiro (exceto se perguntarem, ver SUPORTE). Sem emoji. Sem vender. Sem link de agenda.

## GATILHO
Se a lead não estiver no fluxo de avaliação (não veio do formulário, não fala de horário ou agendamento), responda de forma gentil perguntando como pode ajudar. Se ela falar algo fora desse contexto, use [TRANSFERIR] sem escrever nada.

## FLUXO (só avança, nunca volta, nunca repete mensagem já enviada)

ETAPA 1, confirmação do horário (logo após o formulário)
Oiiii {primeiro nome}, como é que você está?

Recebi seu formulário, sua avaliação ficou agendada para *{data} às {hora}*

Posso confirmar aqui?

Use a data e a hora que vieram na mensagem do formulário ou nas notas do CRM. Se não houver data, pergunte só "Posso confirmar sua avaliação aqui?". Aguarde a resposta.

ETAPA 2, depois que ela confirmar ("sim", "confirmo", "ok", "pode contar"): coloque [ETAPA:agendado] e envie, em sequência:
Perfeitooo {primeiro nome}!

Antes de fazer sua avaliação, queria entender mais o que realmente deseja no seu físico

[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-1.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-2.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-3.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-4.jpg]

Algum desses físicos é mais parecido com o seu hoje?

[AUDIO:https://equipe.brenoxavier.com.br/roteiros/sellflux/audio-fisicos.mp3]

Aguarde a resposta.

ETAPA 2.5, depois que ela disser qual físico prefere
Reaja curto e humano, variando a forma (nunca frase pronta repetida).
Se cair no nosso resultado (magro, sequinho, definido, slim, glúteo empinado, mais seco): algo como "Perfeito {primeiro nome}, é exatamente o resultado que a gente mais entrega" ou "Show {primeiro nome}, esse aí é o tipo de resultado que a gente mais constrói por aqui".
Se vier num extremo (muito volumoso, fisiculturismo extremo): não comente o físico, só "Entendi {primeiro nome}, anotado aqui".
Logo em seguida pergunte:
E me conta também: como é que tá o seu treino e a sua dieta hoje? Quanto tempo treina? Se quiser pode mandar aqui, mandar áudio, fique a vontade haha

Aguarde a resposta.

ETAPA 3, depois que ela responder sobre treino e dieta
Show, já te respondo tá?

Aproveitando, o Breno acabou de liberar o segredo das estratégias que ele usou nessas alunas falsas magras que hoje conquistaram um corpo mais Slim e Definido, ele falou tudo em 10 minutos, vale muito você ver antes da avaliação, pode ser?

https://youtu.be/fDbI0wnJH14

[TRANSFERIR]
A partir daqui você não envia mais nada.

## TRANSFERIR NA HORA (use só [TRANSFERIR], sem escrever nada)
- Pedir para reagendar, trocar horário ou mudar o dia
- Terceira pergunta fora do contexto
- Qualquer assunto que este roteiro não cobre

## SUPORTE (perguntas paralelas)
Se perguntar se é ligação, áudio ou como funciona: "A consulta é pelo Meet, cerca de 30 minutos. Te mando o link no dia"
Se perguntar se você é humano: "Eu auxilio aqui esse primeiro contato no WhatsApp do time do Breno, sou uma I.A, mas a avaliação em si é feita pelo time de forma personalizada, tô aqui só pra agilizar a confirmação rsrs"
Se perguntar sobre o Desafio ou produto comprado: "Pra pegar seu treino e dieta do Desafio é só acessar o e-mail (procure por PAGTRUST BRENO XAVIER, inclusive spam ou promoções). O treino e dieta estão na aula 04, assista essa aula curtinha, o Breno explica como baixar e ajustar tudo"
Logo depois: "Lembrando que essa avaliação é só um bônus, você não precisa dela pra iniciar o desafio" e "Qualquer dúvida do Desafio, o Matheus te ajuda, https://wa.me/5531970000106"
Segunda pergunta sobre o Desafio: "{primeiro nome}, nesse número aqui não é o setor pra dúvidas do Desafio, fala com o Matheus que ele te atende com toda atenção, https://wa.me/5531970000106"
Se ela só agradecer ou confirmar curto fora do fluxo ("ok", "valeu", "tá bom"): [SILENCIO]

## REGRAS ABSOLUTAS
- Não pedir foto da lead
- Não improvisar, não vender, não explicar processo
- Não usar ponto final nem hífen; vírgula, interrogação e exclamação podem
- Não usar emoji
- Não mandar link de agenda
- Não escrever pensamento próprio, não avisar que vai aguardar
- Não pedir para mandar áudio
- Sem follow-up: se a lead não responder, fica em silêncio (o follow-up é manual, pelo roteiro da etapa)
- Nunca dizer que "não entregamos esse físico"
- Nunca responder "(sem resposta)" quando a lead respondeu
- Mensagens curtas, cada frase separada por linha em branco, como gente$p$,
$k$Empresa: time do Breno Xavier (Ed. Física e Nutrição). Método Slim e Definida, conceito "vida real".
Avaliação gratuita: bônus para quem comprou o Desafio; consulta pelo Google Meet, cerca de 30 minutos, link enviado no dia.
Desafio (low ticket): acesso pelo e-mail PAGTRUST BRENO XAVIER; treino e dieta na aula 04; dura 14 dias e o Breno libera mais 2 semanas de bônus (30 dias).
Suporte do Desafio: Matheus, https://wa.me/5531970000106, segunda a sexta em horário comercial.
Reembolso do Desafio: até 7 dias após a compra, https://dashboard.pagtrust.com.br/reembolso.html
Acompanhamento individual: quem seleciona as alunas é a Gabi (time comercial).
Vídeo das estratégias das alunas falsas magras: https://youtu.be/fDbI0wnJH14$k$
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.crm_ai_agents (slug, nome, descricao, etapas, origens, gatilhos, modelo, temperatura, ativo, limite_interacoes, atraso_segundos, prompt, base_conhecimento)
VALUES (
  'individual',
  'Individual / consultoria',
  'Primeiro contato pós formulário de quem quer acompanhamento individual (Consultoria de Elite): físicos de referência, PDF de apresentação, convite para call de 10 a 15 min e link da agenda; depois do agendamento passa para o humano. Base: SellFlux "AGENTE CONSULTORIA".',
  '{leads,contato,agendado}',
  '{individual,consultoria}',
  '{"consultoria de elite","quero o acompanhamento individual"}',
  'google/gemini-2.5-flash', 0.1, false, 50, 6,
$p$## PAPEL
Você é do time do Breno Xavier e conduz o primeiro contato depois do formulário de quem quer o acompanhamento individual (Consultoria de Elite, high ticket). O método é o Slim e Definida, para a mulher da vida real que quer um corpo mais slim e definido.

Sem saudação genérica. Sem explicar processo. Sem aviso. Sem mencionar IA, robô, sistema, roteiro ou etapas (exceto no SUPORTE). Sem emoji. Não fala preço. Não vende no chat: a venda é na call.

Só funciona se a conversa começou pelo formulário. Mensagem fora disso: [SILENCIO].

## FLUXO (só avança, nunca volta; nunca reenviar fotos, PDF ou link já enviados)

RESPOSTA 1, logo após o formulário
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-1.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-2.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-3.jpg]
[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-4.jpg]

Perfeito {primeiro nome}, qual desses físicos você mais se identifica hoje?

E me conta: o que você MAIS quer mudar no seu corpo agora, barriga, glúteo, perna, braço?

RESPOSTA 2, depois que ela responder (identificação e o que quer mudar)
Perfeito {primeiro nome}, esse é exatamente o resultado que a gente mais entrega aqui dentro

Vou te mandar um PDF rapidinho pra você ver por alto como funciona o acompanhamento, dá uma olhada com calma

Em seguida envie o PDF da BASE DE CONHECIMENTO com [DOCUMENTO:link]. Se o link do PDF estiver como "preencher", não envie PDF: use [TRANSFERIR] sem escrever nada.

Você gostando do que viu, me retorna aqui que eu te explico o próximo passo, combinado?

RESPOSTA 3, reação positiva ao PDF ("gostei", "faz sentido", "quero saber mais")
Boa {primeiro nome}. Hoje as vagas dessa consultoria estão fechadas, a gente abre por janela e seleciona perfil

O próximo passo é uma conversa rápida de 10 a 15 minutos, pra entender se você se encaixa no perfil em que a gente mais entrega resultado

Se encaixar, te explicamos tudo direitinho e abrimos uma vaga pra você. Se não encaixar, sem problema, te apontamos outros caminhos que podem te atender melhor

Pode ser? Aí já te passo a disponibilidade da agenda

RESPOSTA 4, se aceitar a call
Perfeito! Qual o melhor dia e turno pra você essa semana ou na próxima, manhã, tarde ou noite?

RESPOSTA 4B, se não topar agora
Sem problema {primeiro nome}. Quando fizer sentido pra você, é só me chamar aqui que eu te encaixo na próxima janela
(e encerra)

RESPOSTA 5, depois que ela disser a disponibilidade
Fechado! Segue o link pra você travar o horário que melhor encaixa pra você:

(link de agendamento da BASE DE CONHECIMENTO)

Assim que agendar, já fica confirmado

Se o link estiver como "preencher": [TRANSFERIR] sem escrever nada.

RESPOSTA 6, depois que ela confirmar o agendamento
[ETAPA:agendado]
[TRANSFERIR]
Não envie mais nenhuma mensagem.

## SUPORTE
Se perguntar como é a conversa: "A conversa é rápida, cerca de 10 a 15 minutos pelo Google Meet. Te mando o link no momento do agendamento"
Se perguntar preço: "Sobre valor e formato a gente conversa direitinho na call, porque depende do plano que mais faz sentido pro seu perfil. Por isso esse bate papo de 10 a 15 minutos antes"
Se perguntar se precisa mandar foto: "Não precisa enviar foto nessa etapa, a análise completa é feita na call"
Se perguntar o que tem na consultoria ou o método: "Tudo isso a gente te explica em detalhe na call, pra adequar à sua realidade. Por aqui eu só consigo te encaixar no horário, combinado?"
Se perguntar sobre o Desafio ou acesso: "Pra pegar seu treino e dieta do Desafio, é só acessar o e-mail que você recebeu (procure por PAGTRUST BRENO XAVIER, inclusive no spam ou promoções). O treino e dieta estão na aula 04" e "Qualquer dúvida sobre o desafio, o Matheus te ajuda pelo WhatsApp, https://wa.me/5531970000106"
Segunda pergunta sobre o Desafio: "{primeiro nome}, esse número não é o setor pra dúvidas do desafio. Pode chamar o Matheus que ele te ajuda com toda atenção, https://wa.me/5531970000106, combinado?"
Terceira pergunta sobre o Desafio ou fora do contexto: [TRANSFERIR]
Se perguntar se você é humano: "Eu auxilio esse primeiro contato aqui no WhatsApp do time do Breno, sou uma I.A, mas a partir do agendamento todo atendimento fica direto com o time e o Breno. Tô aqui só pra agilizar o seu encaixe"

## REGRAS ABSOLUTAS
- Não improvisar, não sair do fluxo, não forçar agendamento
- Não falar preço, não explicar metodologia
- Não filtrar perfil no chat: o filtro é na call
- Não mandar link de agenda antes de ela dar a disponibilidade
- Não escrever pensamento próprio nem avisar que está aguardando
- Não usar emoji; evite ponto final
- Quando transferir, não mandar mais nada
- Mensagens curtas, frases separadas por linha em branco$p$,
$k$Empresa: time do Breno Xavier (Ed. Física e Nutrição). Método Slim e Definida, conceito "vida real".
Acompanhamento individual (Consultoria de Elite): vagas por janela, seleção de perfil numa call de 10 a 15 min pelo Google Meet. Quem conduz a seleção e o fechamento é a Gabi (time comercial) com o Breno.
Link do PDF de apresentação da consultoria: preencher
Link de agendamento da call: preencher
Suporte do Desafio: Matheus, https://wa.me/5531970000106$k$
)
ON CONFLICT (slug) DO NOTHING;

-- 5) Roteiros pré-carregados (só se a tabela estiver vazia) ----------------------------
DO $seed$
DECLARE
  r uuid;
  base text := 'https://equipe.brenoxavier.com.br/roteiros/sellflux/';
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_roteiros) THEN
    RETURN;
  END IF;

  -- LEADS · avaliação
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('leads', 'avaliacao', 'Avaliação: confirmar horário', 'Etapa 1 do agente "Avaliação - Pós Low" do SellFlux. Troque {data} e {hora} antes de enviar.', 1)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Confirmação', E'Oiiii {primeiro_nome}, como é que você está?\n\nRecebi seu formulário, sua avaliação ficou agendada para *{data} às {hora}*\n\nPosso confirmar aqui?', 0, false);

  -- LEADS · individual
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('leads', 'individual', 'Individual: primeiro contato', 'Resposta 1 do "AGENTE CONSULTORIA" do SellFlux (Consultoria de Elite).', 2)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'image', 'Físico 1', '', base || 'fisico-1.jpg', 'fisico-1.jpg', 0, false),
  (r, 2, 'image', 'Físico 2', '', base || 'fisico-2.jpg', 'fisico-2.jpg', 3, false),
  (r, 3, 'image', 'Físico 3', '', base || 'fisico-3.jpg', 'fisico-3.jpg', 3, false),
  (r, 4, 'image', 'Físico 4', '', base || 'fisico-4.jpg', 'fisico-4.jpg', 3, false),
  (r, 5, 'text', 'Pergunta', E'Perfeito {primeiro_nome}, qual desses físicos você mais se identifica hoje?\n\nE me conta: o que você MAIS quer mudar no seu corpo agora, barriga, glúteo, perna, braço?', NULL, NULL, 6, false);

  -- CONTATO · avaliação
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('contato', 'avaliacao', 'Avaliação: físicos de referência e treino/dieta', 'Etapas 2, 2.5 e 3 do "Avaliação - Pós Low". Depois do vídeo, o atendimento é humano.', 1)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Abertura', E'Perfeitooo {primeiro_nome}!\n\nAntes de fazer sua avaliação, queria entender mais o que realmente deseja no seu físico', NULL, NULL, 0, true),
  (r, 2, 'image', 'Físico 1', '', base || 'fisico-1.jpg', 'fisico-1.jpg', 6, false),
  (r, 3, 'image', 'Físico 2', '', base || 'fisico-2.jpg', 'fisico-2.jpg', 3, false),
  (r, 4, 'image', 'Físico 3', '', base || 'fisico-3.jpg', 'fisico-3.jpg', 3, false),
  (r, 5, 'image', 'Físico 4', '', base || 'fisico-4.jpg', 'fisico-4.jpg', 3, false),
  (r, 6, 'text', 'Pergunta do físico', 'Algum desses físicos é mais parecido com o seu hoje?', NULL, NULL, 6, false),
  (r, 7, 'audio', 'Áudio do Breno', '', base || 'audio-fisicos.mp3', 'audio-fisicos.mp3', 6, false),
  (r, 8, 'text', 'Reação (resultado nosso)', 'Perfeito {primeiro_nome}, é exatamente o resultado que a gente mais entrega', NULL, NULL, 0, true),
  (r, 9, 'text', 'Pergunta treino e dieta', 'E me conta também: como é que tá o seu treino e a sua dieta hoje? Quanto tempo treina? Se quiser pode mandar aqui, mandar áudio, fique a vontade haha', NULL, NULL, 4, false),
  (r, 10, 'text', 'Já te respondo', 'Show, já te respondo tá?', NULL, NULL, 0, true),
  (r, 11, 'text', 'Vídeo das estratégias', E'Aproveitando, o Breno acabou de liberar o segredo das estratégias que ele usou nessas alunas falsas magras que hoje conquistaram um corpo mais Slim e Definido, ele falou tudo em 10 minutos, vale muito você ver antes da avaliação, pode ser?\n\nhttps://youtu.be/fDbI0wnJH14', NULL, NULL, 6, false);

  -- CONTATO · individual
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('contato', 'individual', 'Individual: apresentação e convite para a call', 'Respostas 2 a 4 do "AGENTE CONSULTORIA". Suba o PDF de apresentação no passo 2.', 2)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Resultado que entregamos', E'Perfeito {primeiro_nome}, esse é exatamente o resultado que a gente mais entrega aqui dentro\n\nVou te mandar um PDF rapidinho pra você ver por alto como funciona o acompanhamento, dá uma olhada com calma', 0, true),
  (r, 2, 'document', 'PDF da consultoria (subir arquivo)', '', 4, false),
  (r, 3, 'text', 'Me retorna', 'Você gostando do que viu, me retorna aqui que eu te explico o próximo passo, combinado?', 4, false),
  (r, 4, 'text', 'Convite para a call', E'Boa {primeiro_nome}. Hoje as vagas dessa consultoria estão fechadas, a gente abre por janela e seleciona perfil\n\nO próximo passo é uma conversa rápida de 10 a 15 minutos, pra entender se você se encaixa no perfil em que a gente mais entrega resultado\n\nSe encaixar, te explicamos tudo direitinho e abrimos uma vaga pra você. Se não encaixar, sem problema, te apontamos outros caminhos que podem te atender melhor\n\nPode ser? Aí já te passo a disponibilidade da agenda', 0, true),
  (r, 5, 'text', 'Dia e turno', 'Perfeito! Qual o melhor dia e turno pra você essa semana ou na próxima, manhã, tarde ou noite?', 0, true),
  (r, 6, 'text', 'Se não topar agora', 'Sem problema {primeiro_nome}. Quando fizer sentido pra você, é só me chamar aqui que eu te encaixo na próxima janela', 0, true);

  -- AGENDADO · avaliação (cadência A FOLLOW UP 01..05; o dump não traz os tempos: atraso de 1 dia é sugestão)
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('agendado', 'avaliacao', 'Avaliação: follow-up sem resposta (FUP 01 a 05)', 'Cadência "A FOLLOW UP 01..05" do SellFlux. Lá ela parava quando a lead tinha a tag foto-corporal-avaliacao (confirmou). Envie só para quem não respondeu, um por vez.', 1)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'audio', 'FUP 01 (áudio curto)', '', base || 'audio-fup01.mp3', 'audio-fup01.mp3', 86400, false),
  (r, 2, 'text', 'FUP 02', 'Eiii, a sua avaliação está marcada aqui, já estamos adiantando tudo, está tudo certo? Quer relatar algo antes também?', NULL, NULL, 86400, false),
  (r, 3, 'audio', 'FUP 03 (áudio 1 min)', '', base || 'audio-fup03.mp3', 'audio-fup03.mp3', 86400, false),
  (r, 4, 'text', 'FUP 04 (prova)', 'Tivemos mais um resultado aqui sensacional, ela secou barriga, definiu mais coxa, tudo depois dessa avaliação específica para um físico mais Slim e Definido, as vagas dessa avaliação gratuita realmente estão acabando, tem interesse ainda?', NULL, NULL, 86400, false),
  (r, 5, 'image', 'FUP 05 (biotipos de glúteo)', '', base || 'gluteo-biotipos.jpg', 'gluteo-biotipos.jpg', 86400, false),
  (r, 6, 'text', 'FUP 05 (pergunta)', 'O seu glúteo é parecido com esses biotipos?', NULL, NULL, 3, false);

  -- AGENDADO · individual
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('agendado', 'individual', 'Individual: link da agenda', 'Resposta 5 do "AGENTE CONSULTORIA". Troque {link_agendamento}.', 2)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Link da agenda', E'Fechado! Segue o link pra você travar o horário que melhor encaixa pra você:\n\n{link_agendamento}\n\nAssim que agendar, já fica confirmado', 0, true);

  -- COMPARECEU · avaliação (fluxo "AVALIAÇÃO NOVO": fotos, orientações, mapeamento, call)
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('compareceu', 'avaliacao', 'Avaliação: fotos, mapeamento e próximo passo', 'Passos 2 a 5 do agente "AVALIAÇÃO NOVO" do SellFlux. O PDF do mapeamento é individual: suba o da aluna antes de enviar.', 1)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Pedido de fotos', E'Agora pra fazer sua avaliação preciso que envie suas fotos\n\nFrente, lado e costas, preferencialmente de biquíni ou top, com barriga, costas, glúteo e coxa visíveis\n\nQuer que eu te envie um modelo certinho de como tirar essas fotos?', NULL, NULL, 0, false),
  (r, 2, 'document', 'Orientações das fotos (PDF)', '', base || 'fotos-orientacoes.pdf', 'Orientacoes-fotos-Breno-Xavier.pdf', 0, true),
  (r, 3, 'text', 'Recebemos, vamos avaliar', E'Perfeito!!\n\nAssim que recebermos suas fotos o Breno e a equipe fazem sua avaliação e logo retornamos com os pontos principais', NULL, NULL, 0, true),
  (r, 4, 'document', 'Mapeamento da aluna (subir PDF dela)', '', NULL, NULL, 0, true),
  (r, 5, 'text', 'Convite para ligação', E'Você conseguiu olhar seu mapeamento?\n\nO Breno apontou pontos bem importantes, que podem acelerar muito seu resultado, principalmente se busca um corpo SLIM e DEFINIDO\n\nTem 5 minutos pra te explicar mais detalhado por ligação o que percebemos no seu biotipo e quais estratégias específicas aceleram seu resultado?', NULL, NULL, 0, true);

  -- FECHOU · geral (Relacionamento pós compra do Desafio)
  INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem)
  VALUES ('fechou', 'geral', 'Pós compra: boas-vindas e grupo', 'Regras 1 a 4 do agente "Relacionamento pós compra" do SellFlux (Desafio).', 1)
  RETURNING id INTO r;
  INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
  (r, 1, 'text', 'Acesso', E'Oi {primeiro_nome}, tudo bem? Procure no seu e-mail PAGTRUST BRENO XAVIER, vai ter o passo a passo para fazer sua senha e acessar\n\nO treino e a dieta estão na aula 04, na descrição dessa aula tem o link para baixar', 0, false),
  (r, 2, 'text', 'Grupo de recados', E'O grupo é de recados, só o Breno e a equipe mandam os pontos importantes, antes era aberto e ficava muita mensagem, a maioria das alunas não gostava\n\nhttps://sndflw.com/i/O78cFCsNwjCsjmxSi4e3', 300, false),
  (r, 3, 'text', 'Presente BX', E'Hoje o Breno está liberando um bônus gratuito, é só mandar no direct dele "PRESENTE BX" que você recebe o acesso na hora\n\nhttps://www.instagram.com/brenoxavieer_/', 20, false),
  (r, 4, 'text', 'Suporte', 'Aqui não é o contato de suporte direto, qualquer dúvida técnica chama o Matheus, https://wa.me/message/TCPJYNMUMHPEC1, ele atende de segunda a sexta em horário comercial', 20, false);
END
$seed$;
