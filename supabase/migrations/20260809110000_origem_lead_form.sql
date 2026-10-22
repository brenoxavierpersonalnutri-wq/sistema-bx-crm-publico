-- Origem da captação: "avaliacao" (funil padrão) ou "individual" (consultoria
-- de elite — lead mais quente). Preenchida pelo submit-form-response.
ALTER TABLE public.lead_form_responses ADD COLUMN IF NOT EXISTS origem text;
CREATE INDEX IF NOT EXISTS lead_form_responses_origem_idx
  ON public.lead_form_responses(origem);
NOTIFY pgrst, 'reload schema';
