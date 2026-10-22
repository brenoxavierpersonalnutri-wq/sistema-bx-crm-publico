-- =============================================================
-- Base de leads: política de RLS que não roda por linha.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. Não toca em dado nenhum.
--
-- PROBLEMA (21/10/2026): /crm/base-leads ficava em "Carregando..." com a tabela vazia.
-- A tela lê public.base_leads em páginas de 1000 (~42 mil linhas = ~42 requisições em série).
-- A política usava USING (public.is_approved(auth.uid())). is_approved é SECURITY DEFINER com
-- SET search_path, então o Postgres não consegue "inlinar": chama a função (e o auth.uid(), que
-- faz parse do JWT inteiro) UMA VEZ POR LINHA varrida. Com OFFSET, a página 42 varre 42 mil
-- linhas; a soma das 42 páginas passa de 900 mil chamadas.
-- Reprodução num Postgres 17 local com 42 mil linhas e auth.uid() no formato do Supabase:
--   antes  = 5.339 ms de banco para as 42 páginas (página 42: 247 ms)
--   depois =    87 ms (página 42: 3,8 ms)
-- Num servidor compartilhado do Lovable Cloud o "antes" é várias vezes pior.
--
-- CONSERTO: embrulhar em (SELECT ...) vira InitPlan — avaliado uma vez por consulta, mesmo
-- resultado lógico. Conferido no teste local: aprovado vê 42000, usuário desconhecido 0, sem JWT 0.
-- Padrão recomendado pelo Supabase ("RLS performance: wrap functions with select").
-- =============================================================
BEGIN;

DROP POLICY IF EXISTS "Aprovados leem base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados inserem base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados atualizam base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados apagam base_leads" ON public.base_leads;

CREATE POLICY "Aprovados leem base_leads" ON public.base_leads FOR SELECT TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))));
CREATE POLICY "Aprovados inserem base_leads" ON public.base_leads FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_approved((SELECT auth.uid()))));
CREATE POLICY "Aprovados atualizam base_leads" ON public.base_leads FOR UPDATE TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_approved((SELECT auth.uid()))));
CREATE POLICY "Aprovados apagam base_leads" ON public.base_leads FOR DELETE TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))));

-- Desempate estável para a paginação da tela (ORDER BY criado_origem DESC, id DESC).
CREATE INDEX IF NOT EXISTS base_leads_criado_id_idx ON public.base_leads (criado_origem DESC, id DESC);

COMMIT;
