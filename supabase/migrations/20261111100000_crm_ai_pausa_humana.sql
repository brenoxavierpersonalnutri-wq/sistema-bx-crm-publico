-- Regra geral (21/10/2026): atendimento humano entrou na conversa = a IA para ali (ai_pausado = true, motivo 'humano')
-- e só volta pelo follow-up ou pelo botão "Devolver para IA". O código das edge functions já aplica a regra sem esta
-- migration (motivo começando com "humano" vale como pausa humana); ela só alinha o botão "Assumir (humano)" e a RPC
-- antiga com o mesmo motivo e a mesma linha no histórico ("IA pausada: atendimento humano").
-- Idempotente: só CREATE OR REPLACE de funções; rodar de novo não muda nada. Não mexe em nenhuma conversa existente.
BEGIN;

-- Botão "Assumir (humano)": pausa com motivo 'humano' e tira o selo "Precisa de humano".
CREATE OR REPLACE FUNCTION public.crm_ai_assumir(p_numero_id uuid, p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_slug text;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT ai_agent_slug INTO v_slug FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = 'humano', ai_precisa_humano = false, updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano assumiu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente'
     AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_slug, 'assumido_humano', 'IA pausada: atendimento humano (botão Assumir)', auth.uid());
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_assumir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_assumir(uuid, text) TO authenticated, service_role;

-- Mensagem manual (CRM ou celular): a mesma regra do roboPausa.ts, para quem ainda chamar a RPC.
-- Pausa mesmo se a IA não atendia a conversa (senão o gatilho assumiria depois da janela de horas).
CREATE OR REPLACE FUNCTION public.crm_ai_pausar_por_humano(p_numero_id uuid, p_phone text, p_origem text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_slug text;
  v_n integer;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF p_phone LIKE '%@g.us' THEN RETURN false; END IF;
  UPDATE public.whatsapp_contacts SET ai_precisa_humano = false
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) AND ai_precisa_humano;
  SELECT ai_agent_slug INTO v_slug FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = 'humano', updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id)
     AND coalesce(is_group, false) = false
     AND NOT (ai_pausado AND coalesce(ai_pausado_motivo, '') ~* '^humano');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN false; END IF;
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano respondeu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente' AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe)
  VALUES (p_phone, p_numero_id, v_slug, 'pausado_humano',
          left('IA pausada: atendimento humano' || CASE WHEN coalesce(p_origem, '') <> '' THEN ' (' || p_origem || ')' ELSE '' END, 1000));
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_pausar_por_humano(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_pausar_por_humano(uuid, text, text) TO authenticated, service_role;

COMMIT;
