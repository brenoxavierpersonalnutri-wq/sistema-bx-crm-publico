-- -----------------------------------------------------------------------------
-- Telefone da aluna: tolerante ao nono dígito, rigoroso com o DDD.
--
-- O problema do 9: celular no Brasil virou DDD + 9 + 8 dígitos, mas muito
-- cadastro antigo tem DDD + 8, e a aluna às vezes digita de um jeito e o banco
-- tem do outro. Como o 9 entra NA FRENTE do número, comparar os ÚLTIMOS 8
-- dígitos resolve os dois sentidos sozinho.
--
-- O que estava errado: a regra antiga era SÓ os últimos 8 dígitos, então
-- (11) 99000-0107 e (31) 99000-0107 casavam entre si — uma aluna podia cair na
-- ficha de outra. Agora o DDD também precisa bater, quando os dois lados têm
-- DDD. Cadastro sem DDD continua casando pelos 8 dígitos, pra não deixar
-- ninguém de fora.
-- -----------------------------------------------------------------------------

-- Número sem o DDI: descarta um 55 colado na frente, mas só quando sobram mais
-- de 11 dígitos — assim o DDD 55 (Santa Maria) não é mutilado.
CREATE OR REPLACE FUNCTION public.telefone_local(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN length(d) > 11 AND left(d, 2) = '55' THEN substr(d, 3)
           ELSE d
         END
  FROM (SELECT regexp_replace(coalesce(_tel, ''), '\D', '', 'g') AS d) t
$$;

-- Os 8 dígitos finais: o "miolo" do número, que o nono dígito não altera.
CREATE OR REPLACE FUNCTION public.telefone_nucleo(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(l) >= 8 THEN right(l, 8) END
  FROM (SELECT public.telefone_local(_tel) AS l) t
$$;

-- DDD só existe quando o número tem 10 (DDD + 8) ou 11 (DDD + 9 + 8) dígitos.
CREATE OR REPLACE FUNCTION public.telefone_ddd(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(l) IN (10, 11) THEN left(l, 2) END
  FROM (SELECT public.telefone_local(_tel) AS l) t
$$;

CREATE OR REPLACE FUNCTION public.identificar_aluna_por_whatsapp(p_telefone text)
RETURNS TABLE(id uuid, nome_completo text, programa text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.nome_completo, a.programa
  FROM public.alunas a
  WHERE public.telefone_nucleo(p_telefone) IS NOT NULL
    AND public.telefone_nucleo(a.telefone) = public.telefone_nucleo(p_telefone)
    AND (
      public.telefone_ddd(a.telefone) IS NULL
      OR public.telefone_ddd(p_telefone) IS NULL
      OR public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)
    )
  -- Cadastro com o DDD batendo ganha de cadastro sem DDD.
  ORDER BY
    (public.telefone_ddd(a.telefone) IS NOT NULL
      AND public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)) DESC,
    a.created_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.identificar_aluna_por_whatsapp(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
