-- Liga a resposta do formulário à consulta agendada por ID, em vez de depender
-- de cruzamento por telefone/nome (que falha quando o telefone vem vazio).
-- SECURITY DEFINER porque quem chama é a visitante anônima na tela de agendamento;
-- a função só escreve consultation_id e nada mais.
CREATE OR REPLACE FUNCTION public.link_form_response_to_consultation(
  p_form_response_id uuid,
  p_consultation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lead_form_responses
     SET consultation_id = p_consultation_id,
         updated_at = now()
   WHERE id = p_form_response_id
     AND consultation_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_form_response_to_consultation(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.link_form_response_to_consultation(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
