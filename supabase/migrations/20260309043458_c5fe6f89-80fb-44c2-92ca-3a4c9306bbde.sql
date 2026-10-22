CREATE TABLE public.alunas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome_completo TEXT NOT NULL,
  programa TEXT NOT NULL,
  data_compra DATE NOT NULL,
  duracao_plano TEXT NOT NULL,
  data_vencimento DATE NOT NULL,
  forma_pagamento TEXT NOT NULL,
  pago BOOLEAN NOT NULL DEFAULT false,
  deu_sinal BOOLEAN DEFAULT false,
  valor_sinal NUMERIC DEFAULT 0,
  data_cobranca_sinal TIMESTAMPTZ,
  telefone TEXT,
  origem_lead TEXT,
  fotos_anamnese BOOLEAN DEFAULT false,
  data_fotos_anamnese TIMESTAMPTZ,
  liberou_treino_dieta BOOLEAN DEFAULT false,
  liberou_fotos BOOLEAN DEFAULT false,
  data_avaliacao TIMESTAMPTZ,
  avaliacao_enviada BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alunas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read alunas"
  ON public.alunas FOR SELECT
  TO authenticated
  USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can insert alunas"
  ON public.alunas FOR INSERT
  TO authenticated
  WITH CHECK (is_approved(auth.uid()));

CREATE POLICY "Approved users can update alunas"
  ON public.alunas FOR UPDATE
  TO authenticated
  USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can delete alunas"
  ON public.alunas FOR DELETE
  TO authenticated
  USING (is_approved(auth.uid()));