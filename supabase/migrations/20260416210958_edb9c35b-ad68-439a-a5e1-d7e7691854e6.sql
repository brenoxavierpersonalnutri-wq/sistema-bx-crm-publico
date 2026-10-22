-- Tabela para armazenar respostas individuais do formulário de qualificação
CREATE TABLE public.lead_form_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Dados do lead
  nome TEXT,
  telefone TEXT,
  email TEXT,
  
  -- Respostas P1-P9
  p1_objetivo TEXT,                    -- "emagrecer" | "perder_gordura_definir" | "definido_slim" | "volume_muscular"
  p2_situacao TEXT,                    -- texto livre
  p3_profissao TEXT,                   -- texto livre
  p4_altura NUMERIC,                   -- em cm
  p4_peso NUMERIC,                     -- em kg
  p4_idade INTEGER,
  p5_estrategias TEXT,                 -- "nao_entregam" | "demoro_muito" | "consigo_resultado"
  p6_caneta TEXT,                      -- "uso_atual" | "ja_usei" | "nunca_usei"
  p7_acompanhamento TEXT,              -- "nutricional" | "treino" | "ambos" | "nunca"
  p8_investimento TEXT,                -- "abaixo_100" | "100_250" | "250_400" | "400_600" | "600_1000" | "acima_1000"
  p9_prioridade TEXT,                  -- "imediato" | "futuramente" | "pensar"
  
  -- Score e nível calculados
  score INTEGER NOT NULL DEFAULT 0,
  nivel TEXT NOT NULL DEFAULT 'DQ',    -- "A" | "B" | "C" | "D" | "DQ"
  
  -- UTMs
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  
  -- Vínculo opcional com consulta (preenchido quando lead agenda)
  consultation_id UUID,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices para queries de análise
CREATE INDEX idx_lfr_created_at ON public.lead_form_responses(created_at DESC);
CREATE INDEX idx_lfr_nivel ON public.lead_form_responses(nivel);
CREATE INDEX idx_lfr_telefone ON public.lead_form_responses(telefone);
CREATE INDEX idx_lfr_consultation_id ON public.lead_form_responses(consultation_id);

ALTER TABLE public.lead_form_responses ENABLE ROW LEVEL SECURITY;

-- Inserção pública (formulário externo via edge function com service role, mas mantemos política aberta para flexibilidade)
CREATE POLICY "Anyone can insert form responses"
ON public.lead_form_responses
FOR INSERT
TO public
WITH CHECK (true);

-- Equipe interna pode ler/atualizar/deletar
CREATE POLICY "Approved users can read form responses"
ON public.lead_form_responses
FOR SELECT
TO authenticated
USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can update form responses"
ON public.lead_form_responses
FOR UPDATE
TO authenticated
USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can delete form responses"
ON public.lead_form_responses
FOR DELETE
TO authenticated
USING (is_approved(auth.uid()));

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lfr_updated_at
BEFORE UPDATE ON public.lead_form_responses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Função para vincular submissão de form a uma consulta por telefone (últimas 24h sem vínculo)
CREATE OR REPLACE FUNCTION public.link_latest_form_response_to_consultation(
  p_consultation_id UUID,
  p_telefone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_response_id UUID;
  v_clean_phone TEXT;
BEGIN
  v_clean_phone := regexp_replace(COALESCE(p_telefone, ''), '[^0-9]', '', 'g');
  
  IF length(v_clean_phone) < 8 THEN
    RETURN NULL;
  END IF;
  
  SELECT id INTO v_response_id
  FROM public.lead_form_responses
  WHERE consultation_id IS NULL
    AND regexp_replace(COALESCE(telefone, ''), '[^0-9]', '', 'g') LIKE '%' || right(v_clean_phone, 8)
    AND created_at >= now() - interval '24 hours'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF v_response_id IS NOT NULL THEN
    UPDATE public.lead_form_responses
    SET consultation_id = p_consultation_id
    WHERE id = v_response_id;
  END IF;
  
  RETURN v_response_id;
END;
$$;