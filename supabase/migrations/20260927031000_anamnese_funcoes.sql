-- -----------------------------------------------------------------------------
-- As duas portas da aluna pra anamnese. SECURITY DEFINER: o token abre o
-- formulário, não a tabela.
-- -----------------------------------------------------------------------------

-- Abrir: devolve só o necessário pra montar a tela.
CREATE OR REPLACE FUNCTION public.anamnese_abrir(p_token text)
RETURNS TABLE(nome_aluna text, status text, ja_respondida boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.nome_completo, r.status, r.status = 'respondida'
  FROM public.anamnese_respostas r
  JOIN public.alunas a ON a.id = r.aluna_id
  WHERE r.token = p_token
$$;

REVOKE ALL ON FUNCTION public.anamnese_abrir(text) FROM public;
GRANT EXECUTE ON FUNCTION public.anamnese_abrir(text) TO anon, authenticated;

-- Enviar: grava as respostas. Recebe um jsonb pra não virar uma função de 40
-- parâmetros; cada campo é lido pelo nome, então o que não vier fica nulo.
-- Anamnese já respondida não é sobrescrita.
CREATE OR REPLACE FUNCTION public.anamnese_enviar(p_token text, p_dados jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alvo uuid;
BEGIN
  SELECT id INTO alvo
  FROM public.anamnese_respostas
  WHERE token = p_token AND status = 'pendente';

  IF alvo IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.anamnese_respostas SET
    nome_completo            = nullif(p_dados->>'nome_completo', ''),
    instagram                = nullif(p_dados->>'instagram', ''),
    treina_onde              = nullif(p_dados->>'treina_onde', ''),
    data_nascimento          = nullif(p_dados->>'data_nascimento', '')::date,
    profissao                = nullif(p_dados->>'profissao', ''),
    peso_altura              = nullif(p_dados->>'peso_altura', ''),
    restricao_medica         = nullif(p_dados->>'restricao_medica', ''),
    ansiedade                = nullif(p_dados->>'ansiedade', ''),
    horas_trabalho           = nullif(p_dados->>'horas_trabalho', ''),
    esforco_diario           = nullif(p_dados->>'esforco_diario', ''),
    horas_sono               = nullif(p_dados->>'horas_sono', ''),
    qualidade_sono           = nullif(p_dados->>'qualidade_sono', ''),
    intestino                = nullif(p_dados->>'intestino', ''),
    objetivo_atingido        = nullif(p_dados->>'objetivo_atingido', ''),
    tres_incomodos           = nullif(p_dados->>'tres_incomodos', ''),
    modelo_corpo             = nullif(p_dados->>'modelo_corpo', ''),
    historico_corpo          = nullif(p_dados->>'historico_corpo', ''),
    dores                    = nullif(p_dados->>'dores', ''),
    treina_musculacao        = nullif(p_dados->>'treina_musculacao', ''),
    treina_musculacao_outro  = nullif(p_dados->>'treina_musculacao_outro', ''),
    dias_disponiveis         = nullif(p_dados->>'dias_disponiveis', ''),
    tempo_sessao             = nullif(p_dados->>'tempo_sessao', ''),
    outro_exercicio          = nullif(p_dados->>'outro_exercicio', ''),
    comentario_treino        = nullif(p_dados->>'comentario_treino', ''),
    acompanhamento_nutricional = nullif(p_dados->>'acompanhamento_nutricional', ''),
    restricao_alimentar      = nullif(p_dados->>'restricao_alimentar', ''),
    define_alimentacao       = nullif(p_dados->>'define_alimentacao', ''),
    bebida_alcoolica         = nullif(p_dados->>'bebida_alcoolica', ''),
    fuma                     = nullif(p_dados->>'fuma', ''),
    ingestao_doces           = nullif(p_dados->>'ingestao_doces', ''),
    dificuldade_alimentacao  = nullif(p_dados->>'dificuldade_alimentacao', ''),
    leva_refeicoes           = nullif(p_dados->>'leva_refeicoes', ''),
    historico_cardiovascular = nullif(p_dados->>'historico_cardiovascular', ''),
    refeicoes_dia            = nullif(p_dados->>'refeicoes_dia', '')::int,
    suplemento               = nullif(p_dados->>'suplemento', ''),
    medicacao                = nullif(p_dados->>'medicacao', ''),
    desconta_estresse        = nullif(p_dados->>'desconta_estresse', ''),
    pronta_mudanca           = nullif(p_dados->>'pronta_mudanca', '')::int,
    capaz_mudanca            = nullif(p_dados->>'capaz_mudanca', '')::int,
    suporte_ambiente         = nullif(p_dados->>'suporte_ambiente', '')::int,
    rotina_alimentar         = nullif(p_dados->>'rotina_alimentar', ''),
    aceite                   = coalesce((p_dados->>'aceite')::boolean, false),
    status                   = 'respondida',
    respondida_em            = now(),
    updated_at               = now()
  WHERE id = alvo;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.anamnese_enviar(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.anamnese_enviar(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
