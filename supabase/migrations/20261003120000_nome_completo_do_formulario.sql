-- -----------------------------------------------------------------------------
-- O nome completo que a lead preencheu passa a valer na consulta e na ficha.
--
-- Ela escreve o nome inteiro em "Qual seu nome completo?", mas a consulta nem
-- sempre nasce com ele: quando o link de agendamento chega sem nome, a consulta
-- vira "Futura Aluna"; quando a reuniao vem do Calendly, fica o que ela digitou
-- la, que costuma ser so o primeiro nome. Esse nome curto segue pro
-- monitoramento de consulta e vira o nome_completo dela quando e convertida em
-- aluna.
--
-- A regra e conservadora de proposito: na duvida, NAO troca. Trocar a mais
-- renomeia a pessoa errada numa ficha, e isso ninguem percebe olhando a tela.
-- E a mesma regra que o codigo usa em src/lib/nomeCompleto.ts.
--
-- Rodar no SQL Editor. Os dois UPDATEs sao correcao de dados, de uma vez; rodar
-- de novo nao muda mais nada.
-- -----------------------------------------------------------------------------

-- Sem acento, sem caixa, sem espaco dobrado. translate() em vez da extensao
-- unaccent, que nem sempre esta instalada.
CREATE OR REPLACE FUNCTION public.nome_normalizado(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           btrim(lower(translate(coalesce(p, ''),
             'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
             'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))),
           '\s+', ' ', 'g')
$$;

-- Nomes que o sistema inventa quando nao sabe quem e.
CREATE OR REPLACE FUNCTION public.nome_provisorio(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT public.nome_normalizado(p) = ''
      OR public.nome_normalizado(p) IN ('futura aluna', 'sem nome', 'lead', 'cliente')
$$;

-- Qual nome deve ficar gravado. Troca em dois casos, e so neles:
--   1. o atual e vazio ou provisorio;
--   2. o do formulario tem mais palavras E comeca pelo mesmo primeiro nome
--      (e o caso de "anna" virar "Anna Beatriz Souza").
CREATE OR REPLACE FUNCTION public.nome_melhor(atual text, do_formulario text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.nome_provisorio(do_formulario) THEN atual
    WHEN public.nome_provisorio(atual) THEN btrim(do_formulario)
    WHEN array_length(string_to_array(public.nome_normalizado(do_formulario), ' '), 1)
       > array_length(string_to_array(public.nome_normalizado(atual), ' '), 1)
     AND split_part(public.nome_normalizado(do_formulario), ' ', 1)
       = split_part(public.nome_normalizado(atual), ' ', 1)
      THEN btrim(do_formulario)
    ELSE atual
  END
$$;

-- A resposta de formulario desta consulta: o vinculo por id vale mais que o
-- palpite por telefone, e entre palpites vale a resposta mais recente.
CREATE OR REPLACE VIEW public.consulta_nome_do_formulario AS
  SELECT c.id AS consultation_id,
         c.client_name AS nome_atual,
         f.nome AS nome_do_formulario,
         public.nome_melhor(c.client_name, f.nome) AS nome_corrigido
  FROM public.consultations c
  JOIN LATERAL (
    SELECT r.nome
    FROM public.lead_form_responses r
    WHERE r.consultation_id = c.id
       OR (c.client_phone IS NOT NULL
           AND r.telefone IS NOT NULL
           AND length(regexp_replace(c.client_phone, '\D', '', 'g')) >= 8
           AND right(regexp_replace(r.telefone, '\D', '', 'g'), 8)
             = right(regexp_replace(c.client_phone, '\D', '', 'g'), 8))
    ORDER BY (r.consultation_id = c.id) DESC, r.created_at DESC
    LIMIT 1
  ) f ON true;

-- CONFERENCIA (nao muda nada): o que mudaria, linha a linha.
--   SELECT * FROM public.consulta_nome_do_formulario
--   WHERE nome_corrigido IS DISTINCT FROM nome_atual;

-- 1. Consultas
UPDATE public.consultations c
SET client_name = v.nome_corrigido
FROM public.consulta_nome_do_formulario v
WHERE v.consultation_id = c.id
  AND v.nome_corrigido IS DISTINCT FROM c.client_name;

-- 2. Alunas, a partir da consulta que deu origem a elas (ja corrigida acima).
--    O NOT EXISTS evita bater na unicidade do nome: se corrigir criaria uma
--    aluna com nome igual ao de outra, a linha fica como esta e aparece na
--    conferencia abaixo.
UPDATE public.alunas a
SET nome_completo = public.nome_melhor(a.nome_completo, c.client_name)
FROM public.consultations c
WHERE a.origem_lead = 'consulta:' || c.id::text
  AND public.nome_melhor(a.nome_completo, c.client_name) IS DISTINCT FROM a.nome_completo
  AND NOT EXISTS (
    SELECT 1 FROM public.alunas b
    WHERE b.id <> a.id
      AND public.nome_normalizado(b.nome_completo)
        = public.nome_normalizado(public.nome_melhor(a.nome_completo, c.client_name))
  );

-- CONFERENCIA DEPOIS: alunas que ficaram sem correcao por colisao de nome.
--   SELECT a.id, a.nome_completo, c.client_name
--   FROM public.alunas a
--   JOIN public.consultations c ON a.origem_lead = 'consulta:' || c.id::text
--   WHERE public.nome_melhor(a.nome_completo, c.client_name) IS DISTINCT FROM a.nome_completo;

NOTIFY pgrst, 'reload schema';
