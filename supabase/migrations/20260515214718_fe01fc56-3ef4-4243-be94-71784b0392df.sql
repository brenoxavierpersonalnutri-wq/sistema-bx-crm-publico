
ALTER TABLE public.gateway_transacoes
  ADD COLUMN IF NOT EXISTS order_nsu text,
  ADD COLUMN IF NOT EXISTS transaction_nsu text,
  ADD COLUMN IF NOT EXISTS invoice_slug text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS capture_method text,
  ADD COLUMN IF NOT EXISTS paid_amount numeric,
  ADD COLUMN IF NOT EXISTS copy_origem text;

CREATE UNIQUE INDEX IF NOT EXISTS gateway_transacoes_order_nsu_key ON public.gateway_transacoes(order_nsu) WHERE order_nsu IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_transacoes_transaction_nsu_key ON public.gateway_transacoes(transaction_nsu) WHERE transaction_nsu IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gateway_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  transaction_nsu text,
  order_nsu text,
  validation_result text NOT NULL DEFAULT 'pending',
  notes text
);

CREATE INDEX IF NOT EXISTS gateway_webhook_logs_order_nsu_idx ON public.gateway_webhook_logs(order_nsu);
CREATE INDEX IF NOT EXISTS gateway_webhook_logs_transaction_nsu_idx ON public.gateway_webhook_logs(transaction_nsu);

ALTER TABLE public.gateway_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can insert webhook logs"
  ON public.gateway_webhook_logs FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Owner reads webhook logs"
  ON public.gateway_webhook_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gateway_transacoes t
      WHERE (t.order_nsu = gateway_webhook_logs.order_nsu
             OR t.transaction_nsu = gateway_webhook_logs.transaction_nsu)
        AND t.user_id = auth.uid()
    )
  );
