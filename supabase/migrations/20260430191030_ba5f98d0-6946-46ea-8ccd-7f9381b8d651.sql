CREATE TABLE public.gateway_saques (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  valor NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  dados_bancarios JSONB,
  observacao TEXT,
  processado_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.gateway_saques ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage saques"
ON public.gateway_saques
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_gateway_saques_updated_at
BEFORE UPDATE ON public.gateway_saques
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_gateway_saques_user_status ON public.gateway_saques(user_id, status);