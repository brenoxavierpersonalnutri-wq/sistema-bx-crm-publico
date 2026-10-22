ALTER TABLE public.feedback_semanal_responses ADD COLUMN IF NOT EXISTS aluna_id uuid;

CREATE INDEX IF NOT EXISTS idx_feedback_semanal_aluna ON public.feedback_semanal_responses (aluna_id);

CREATE OR REPLACE FUNCTION public.identificar_aluna_por_whatsapp(p_telefone text)
RETURNS TABLE(id uuid, nome_completo text, programa text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.nome_completo, a.programa
  FROM public.alunas a
  WHERE length(regexp_replace(coalesce(a.telefone,''), '\D', '', 'g')) >= 8
    AND right(regexp_replace(coalesce(a.telefone,''), '\D', '', 'g'), 8)
        = right(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), 8)
    AND length(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')) >= 10
  ORDER BY a.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.identificar_aluna_por_whatsapp(text) TO anon, authenticated;