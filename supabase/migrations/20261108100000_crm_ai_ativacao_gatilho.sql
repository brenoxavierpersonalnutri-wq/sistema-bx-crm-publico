-- Ativação da IA por gatilho (20/10/2026). Idempotente: pode rodar mais de uma vez.
-- NÃO LIGA NADA: todo agente continua no modo que já estava (ativo = true vira "todas", o resto "transferidas").
-- Quem escolhe "Ativar sozinha pelo gatilho" é o Breno, na tela (Agente IA > Configuração).
-- Regras e portões: supabase/functions/_shared/iaGatilho.ts (testado em src/test/crmIAGatilho.test.ts).
--
-- crm_ai_agents:
--   ativacao_modo          'transferidas' | 'gatilho' | 'todas' ("todas" = o "Ligado" antigo, ativo = true)
--   ativacao_quando        regra em texto livre para o classificador (Claude Haiku) quando nenhum atalho bate
--   ativacao_max_mensagens mensagens recentes da lead que o gatilho olha e teto de avaliações por conversa/dia (1..10, padrão 3)
--   ativacao_humano_horas  mensagem manual da equipe / humano assumiu nas últimas X horas = não ativa (1..168, padrão 12)
--   Atalhos determinísticos = a coluna gatilhos que já existia (trecho contido na mensagem, ignora acento/pontuação).
-- Histórico: crm_ai_eventos tipos novos 'ativado_gatilho' ("IA ativada por gatilho: <motivo>") e 'gatilho_avaliado'
-- (tipo é texto livre, sem CHECK). O passo de fluxo "transferir_ia" mora no jsonb dos fluxos (sem CHECK por tipo).

BEGIN;

ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS ativacao_modo text NOT NULL DEFAULT 'transferidas';
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS ativacao_quando text;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS ativacao_max_mensagens integer NOT NULL DEFAULT 3;
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS ativacao_humano_horas integer NOT NULL DEFAULT 12;

-- modo atual de cada agente (só na primeira vez: quem já escolheu "gatilho" não é tocado)
UPDATE public.crm_ai_agents SET ativacao_modo = 'todas' WHERE ativo AND ativacao_modo = 'transferidas';

ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_ativacao_modo;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_ativacao_modo CHECK (ativacao_modo IN ('transferidas', 'gatilho', 'todas'));
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_ativacao_faixas;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_ativacao_faixas
  CHECK (ativacao_max_mensagens BETWEEN 1 AND 10 AND ativacao_humano_horas BETWEEN 1 AND 168);
-- modo gatilho só com número + horário (mesma regra de "pronto para ligar"); NOT VALID não reconfere linhas antigas
ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_gatilho_pronto;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_gatilho_pronto CHECK (
  ativacao_modo <> 'gatilho' OR (
    numero_id IS NOT NULL
    AND horario_inicio IS NOT NULL AND horario_fim IS NOT NULL AND horario_inicio <> horario_fim
    AND cardinality(dias_semana) > 0
  )
) NOT VALID;

COMMENT ON COLUMN public.crm_ai_agents.ativacao_modo IS
  'transferidas = só o que alguém transferir; gatilho = assume sozinho conversa sem dono quando bate atalho/regra; todas = Ligado antigo (ativo = true).';
COMMENT ON COLUMN public.crm_ai_agents.ativacao_quando IS
  'Regra "Quando ativar" (texto livre) para o classificador Claude Haiku no modo gatilho. Vazio = só os atalhos (coluna gatilhos).';
COMMENT ON COLUMN public.crm_ai_agents.ativacao_humano_horas IS
  'Não ativa por gatilho/fluxo se a equipe escreveu na conversa (ou assumiu) nas últimas X horas.';

-- Pré-preenche o agente de avaliação com a regra que já está no prompt (só onde está vazio; o modo NÃO muda).
UPDATE public.crm_ai_agents SET ativacao_quando = $q$Ative SÓ quando a lead:
- mandar a mensagem do formulário de avaliação (começa com "Olá! Fui qualificada no formulário de avaliação" e traz o horário agendado e as respostas do questionário); ou
- disser, com as palavras dela, que respondeu o questionário/formulário da avaliação ou que foi aprovada/qualificada na avaliação.
Não ative para "oi", "bom dia", pergunta de preço, dúvida solta, suporte, figurinha, áudio sem contexto ou qualquer outro assunto.$q$
WHERE (slug = 'avaliacao' OR nome ILIKE 'avalia%fitness%')
  AND coalesce(tipo, 'atendimento') = 'atendimento'
  AND (ativacao_quando IS NULL OR btrim(ativacao_quando) = '');

-- Atalhos do agente de avaliação: acrescenta os que faltam (não apaga os que já existem).
UPDATE public.crm_ai_agents a SET gatilhos = (
  SELECT array_agg(g ORDER BY ord) FROM (
    SELECT g, min(ord) AS ord FROM (
      SELECT g, ord FROM unnest(coalesce(a.gatilhos, '{}'::text[])) WITH ORDINALITY AS t(g, ord)
      UNION ALL
      SELECT g, 1000 + ord FROM unnest(ARRAY[
        'Fui qualificada no formulário de avaliação',
        'Fui qualificado no formulário de avaliação',
        'Fui aprovada na avaliação',
        'Fui aprovado na avaliação'
      ]) WITH ORDINALITY AS n(g, ord)
      WHERE NOT EXISTS (SELECT 1 FROM unnest(coalesce(a.gatilhos, '{}'::text[])) x WHERE lower(rtrim(x, '!. ')) = lower(n.g))
    ) u GROUP BY g
  ) d
)
WHERE (a.slug = 'avaliacao' OR a.nome ILIKE 'avalia%fitness%')
  AND coalesce(a.tipo, 'atendimento') = 'atendimento';

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar as edge functions: openwa-webhook (avalia o gatilho ao receber) e crm-automacoes (passo "Transferir
--     para agente IA").
--  2) Conferir (nada mudou de modo):
--     SELECT nome, ativo, ativacao_modo, ativacao_max_mensagens, ativacao_humano_horas, gatilhos,
--            left(ativacao_quando, 60) AS quando FROM public.crm_ai_agents ORDER BY nome;
--  3) Ligar: tela Agente IA > Avaliação fitness > Configuração > "Ativar sozinha pelo gatilho" > Salvar agente.
--  Voltar atrás: UPDATE public.crm_ai_agents SET ativacao_modo = 'transferidas' WHERE ativacao_modo = 'gatilho';
-- =============================================================
