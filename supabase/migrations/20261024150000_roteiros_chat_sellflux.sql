-- Roteiros do CHAT do SellFlux (bloco "Roteiros" da lateral do chat) como RASCUNHO.
-- GERADO por scripts/gerar-roteiros-chat-sellflux.py. Não editar à mão: rode o gerador de novo.
-- Idempotente: cria só o que não existe (pelo nome); troca passos só de rascunho ainda vazio;
-- roteiro que o time já preencheu não é tocado. Depende de 20261017100000_crm_roteiros_agentes_ia.sql.
DO $seed$
DECLARE r uuid; vazio boolean;
BEGIN
  -- Avaliação | Qual o Valor?
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$Avaliação | Qual o Valor?$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$contato$rc$, $rc$avaliacao$rc$, $rc$Avaliação | Qual o Valor?$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 101, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

  -- Dúvidas sobre Desafio/Plataforma
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$Dúvidas sobre Desafio/Plataforma$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$contato$rc$, $rc$geral$rc$, $rc$Dúvidas sobre Desafio/Plataforma$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 102, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

  -- Confirmação final | 1h
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$Confirmação final | 1h$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$agendado$rc$, $rc$avaliacao$rc$, $rc$Confirmação final | 1h$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 103, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

  -- 1º Contato
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$1º Contato$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$leads$rc$, $rc$geral$rc$, $rc$1º Contato$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 104, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

  -- Liberação de Horário
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$Liberação de Horário$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$contato$rc$, $rc$avaliacao$rc$, $rc$Liberação de Horário$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 105, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

  -- Nutrição
  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower($rc$Nutrição$rc$) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ($rc$contato$rc$, $rc$geral$rc$, $rc$Nutrição$rc$, $rc$Roteiro do chat do SellFlux (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.$rc$, 106, false) RETURNING id INTO r;
    vazio := true;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;
  END IF;
  IF vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r) THEN
    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES
      (r, 1, $rc$text$rc$, $rc$PREENCHER$rc$, $rc$$rc$, NULL, NULL);
  END IF;

END
$seed$;
