-- Hardening de segurança em 2 frentes:
--
-- 1) ai_agent_settings: remove leitura pública dos system prompts da IA.
--    A policy "Service can read ai_agent_settings" estava com TO public USING (true),
--    expondo os prompts a qualquer anônimo. O frontend (AIAgentSettingsModal) usa
--    contexto authenticated e a edge function (whatsapp-webhook) usa service_role
--    — nenhum dos dois precisa dessa policy, então é seguro dropar.
--
-- 2) custom_programs: restringe INSERT/UPDATE/DELETE a admins. A migration
--    20260521185130 abriu essas operações pra qualquer authenticated, permitindo
--    que qualquer colaborador adicionasse/editasse/deletasse programas de preço.
--    SELECT continua aberto pra todos authenticated (necessário pra exibir
--    programas no cadastro de aluna).
--
-- IF EXISTS / IF NOT EXISTS em tudo — idempotente.

-- Fix 1
DROP POLICY IF EXISTS "Service can read ai_agent_settings" ON public.ai_agent_settings;

-- Fix 2 — limpa policies antigas (permissivas) e recria restritas a admin
DROP POLICY IF EXISTS "Authenticated can insert programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can update programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can delete programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Admins can insert programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Admins can update programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Admins can delete programs" ON public.custom_programs;

CREATE POLICY "Admins can insert programs"
  ON public.custom_programs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update programs"
  ON public.custom_programs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete programs"
  ON public.custom_programs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
