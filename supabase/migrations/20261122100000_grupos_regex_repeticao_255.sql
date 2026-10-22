-- Conserto: "invalid regular expression: invalid repetition count(s)" ao salvar o fluxo de criação de grupos.
--
-- Causa: no Postgres o quantificador {n,m} de regex aceita no máximo 255 (DUPMAX). Dois CHECK usavam
-- '^[A-Za-z0-9/_.-]{3,300}$':
--   * grupos_campanhas.grupos_campanhas_fluxo_ok (foto_path)  - 20261106100000_grupos_fluxo_campanha.sql:49
--   * grupos_mensagens.midia_path (CHECK de coluna)           - 20261024130000_grupos_whatsapp.sql:120
-- O regex só é compilado quando o valor não é NULL, por isso estourava ao salvar com foto/mídia.
--
-- Mesma regra de antes (só [A-Za-z0-9/_.-], de 3 a 300 caracteres), escrita como charset + length().
-- Idempotente: pode rodar mais de uma vez. Não mexe em dado.

BEGIN;

-- 1) grupos_campanhas: recria o CHECK do fluxo com a mesma regra
ALTER TABLE public.grupos_campanhas DROP CONSTRAINT IF EXISTS grupos_campanhas_fluxo_ok;
ALTER TABLE public.grupos_campanhas ADD CONSTRAINT grupos_campanhas_fluxo_ok CHECK (
  length(prefixo_nome) <= 80
  AND proximo_numero BETWEEN 1 AND 9999
  AND (descricao_grupo IS NULL OR length(descricao_grupo) <= 1024)
  AND (foto_path IS NULL OR (foto_path ~ '^[A-Za-z0-9/_.-]+$' AND length(foto_path) BETWEEN 3 AND 300))
  AND cardinality(admins_telefones) <= 10
  AND folga_vagas BETWEEN 1 AND 500
  AND max_grupos BETWEEN 1 AND 200
  AND teto_por_minuto BETWEEN 1 AND 6
  AND (boas_vindas_texto IS NULL OR length(boas_vindas_texto) <= 2000)
  AND boas_vindas_intervalo_min BETWEEN 2 AND 240
  AND (NOT auto_criar OR (length(trim(prefixo_nome)) > 0 AND cardinality(admins_telefones) >= 1))
  AND (NOT boas_vindas_ligada OR length(trim(coalesce(boas_vindas_texto, ''))) > 0)
);

-- 2) grupos_mensagens: derruba o CHECK de coluna de midia_path (nome gerado pelo Postgres) e recria nomeado
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.grupos_mensagens'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%midia_path%'
  LOOP
    EXECUTE format('ALTER TABLE public.grupos_mensagens DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.grupos_mensagens ADD CONSTRAINT grupos_mensagens_midia_path_ok CHECK (
  midia_path IS NULL OR (midia_path ~ '^[A-Za-z0-9/_.-]+$' AND length(midia_path) BETWEEN 3 AND 300)
);

COMMIT;
