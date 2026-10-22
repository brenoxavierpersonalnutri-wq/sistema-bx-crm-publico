-- Roteiros do Instagram Direct para o funil fitness (avaliação gratuita), 17/10/2026, como RASCUNHO
-- (ativo = false): o Breno revisa no editor de Roteiros e liga. O painel de Roteiros do chat é o mesmo
-- no WhatsApp e no Direct. Regras de copy: sem emoji, sem travessão, uma pergunta por mensagem,
-- "Slim e Definida" + vida real, inimigo a ficha genérica.
-- Idempotente: cria só o roteiro que não existe (pelo nome); roteiro já existente não é tocado.
DO $seed$
DECLARE r uuid;
BEGIN
  -- 1) Boas-vindas de quem respondeu story ou anúncio
  IF NOT EXISTS (SELECT 1 FROM public.crm_roteiros WHERE nome = 'Direct | Boas-vindas (story ou anúncio)') THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo)
    VALUES ('leads', 'avaliacao', 'Direct | Boas-vindas (story ou anúncio)',
      'Instagram Direct. Primeira resposta para quem respondeu um story ou chamou pelo anúncio. Mande dentro de 24 h da mensagem dela (regra do Instagram). RASCUNHO: revise e ative.',
      201, false)
    RETURNING id INTO r;
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
      (r, 1, 'text', 'Acolhida', $t$Oii, que bom que você chamou aqui no Direct! Vi sua mensagem e quis te responder com calma.$t$, 0, false),
      (r, 2, 'text', 'Pergunta de abertura', $t$Me conta, o que mais te chamou atenção no que você viu por aqui?$t$, 4, true);
  END IF;

  -- 2) Qualificação SPIN curta (Situação, Problema, Implicação, Necessidade), uma pergunta por vez
  IF NOT EXISTS (SELECT 1 FROM public.crm_roteiros WHERE nome = 'Direct | Qualificação rápida') THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo)
    VALUES ('contato', 'avaliacao', 'Direct | Qualificação rápida',
      'Instagram Direct. SPIN curto: um passo por resposta dela, nunca dois de uma vez. Quem trocou 3 ou mais mensagens vai para Negociação. RASCUNHO: revise e ative.',
      202, false)
    RETURNING id INTO r;
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
      (r, 1, 'text', 'Situação', $t$Pra eu te ajudar do jeito certo, como tá hoje a sua rotina de treino e alimentação?$t$, 0, true),
      (r, 2, 'text', 'Problema', $t$Entendi. E o que mais te incomoda hoje quando você se olha no espelho?$t$, 0, true),
      (r, 3, 'text', 'Implicação', $t$Isso já te atrapalhou em alguma coisa do dia a dia, tipo escolher roupa, tirar foto ou até na sua autoestima?$t$, 0, true),
      (r, 4, 'text', 'Necessidade', $t$Se você tivesse um plano feito pro seu corpo e pra sua vida real, sem ficha genérica, faria sentido começar agora?$t$, 0, true);
  END IF;

  -- 3) Envio do link da avaliação gratuita
  IF NOT EXISTS (SELECT 1 FROM public.crm_roteiros WHERE nome = 'Direct | Link da avaliação') THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo)
    VALUES ('contato', 'avaliacao', 'Direct | Link da avaliação',
      'Instagram Direct. Depois da qualificação: explica a avaliação gratuita e manda o link com UTM do Direct. RASCUNHO: revise e ative.',
      203, false)
    RETURNING id INTO r;
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, atraso_segundos, aguarda_resposta) VALUES
      (r, 1, 'text', 'Ponte', $t$Pelo que você me contou, a avaliação gratuita vai te ajudar muito. Nela a gente olha o seu corpo e a sua rotina e monta o caminho pro físico Slim e Definido, sem ficha genérica.$t$, 0, false),
      (r, 2, 'text', 'Link', $t$Preenche por aqui: https://equipe.brenoxavier.com.br/avaliacao?utm_source=instagram&utm_medium=direct&utm_campaign=crm-direct$t$, 3, false),
      (r, 3, 'text', 'Compromisso', $t$Consegue preencher agora? Quando terminar me avisa aqui que eu já olho a sua.$t$, 3, true);
  END IF;
END
$seed$;
