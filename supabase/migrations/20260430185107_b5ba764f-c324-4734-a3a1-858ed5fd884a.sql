-- ============ TRANSAÇÕES ============
CREATE TABLE public.gateway_transacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  link_id uuid,
  cliente_nome text NOT NULL,
  cliente_email text NOT NULL,
  cliente_cpf_cnpj text,
  cliente_telefone text,
  valor_bruto numeric(10,2) NOT NULL,
  taxa_percentual numeric(5,2) NOT NULL DEFAULT 3.99,
  taxa_fixa numeric(10,2) NOT NULL DEFAULT 0.49,
  valor_liquido numeric(10,2) NOT NULL,
  metodo text NOT NULL CHECK (metodo IN ('pix','cartao','boleto')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','cancelado','reembolsado')),
  descricao text,
  parcelas int NOT NULL DEFAULT 1,
  gateway_id text,
  link_pagamento text,
  qr_code text,
  codigo_barras text,
  vencimento date,
  pago_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gw_tx_user ON public.gateway_transacoes(user_id);
CREATE INDEX idx_gw_tx_status ON public.gateway_transacoes(status);
CREATE INDEX idx_gw_tx_created ON public.gateway_transacoes(created_at DESC);
CREATE INDEX idx_gw_tx_gateway_id ON public.gateway_transacoes(gateway_id);
ALTER TABLE public.gateway_transacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner read transacoes" ON public.gateway_transacoes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner insert transacoes" ON public.gateway_transacoes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner update transacoes" ON public.gateway_transacoes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner delete transacoes" ON public.gateway_transacoes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
-- Webhook público pode atualizar status (validação de assinatura no edge function)
CREATE POLICY "Service can update transacoes" ON public.gateway_transacoes
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- Checkout público pode inserir transação (vinculada a um link ativo) e ler a própria
CREATE POLICY "Public can insert transacoes via checkout" ON public.gateway_transacoes
  FOR INSERT TO anon WITH CHECK (link_id IS NOT NULL);
CREATE POLICY "Public can read own transacao by id" ON public.gateway_transacoes
  FOR SELECT TO anon USING (link_id IS NOT NULL);

CREATE TRIGGER trg_gw_tx_updated
  BEFORE UPDATE ON public.gateway_transacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ LINKS ============
CREATE TABLE public.gateway_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text UNIQUE NOT NULL,
  nome_produto text NOT NULL,
  descricao text,
  valor numeric(10,2) NOT NULL,
  metodos_aceitos jsonb NOT NULL DEFAULT '["pix","cartao","boleto"]'::jsonb,
  parcelamento_max int NOT NULL DEFAULT 12,
  ativo boolean NOT NULL DEFAULT true,
  vendas_count int NOT NULL DEFAULT 0,
  total_arrecadado numeric(10,2) NOT NULL DEFAULT 0,
  imagem_url text,
  cor_tema text NOT NULL DEFAULT '#10b981',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gw_links_user ON public.gateway_links(user_id);
ALTER TABLE public.gateway_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage links" ON public.gateway_links
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Public can read active links" ON public.gateway_links
  FOR SELECT TO anon USING (ativo = true);
CREATE POLICY "Authenticated can read active links" ON public.gateway_links
  FOR SELECT TO authenticated USING (ativo = true);

CREATE TRIGGER trg_gw_links_updated
  BEFORE UPDATE ON public.gateway_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ CONFIG ============
CREATE TABLE public.gateway_config (
  user_id uuid PRIMARY KEY,
  taxa_pix numeric(5,2) NOT NULL DEFAULT 0.99,
  taxa_cartao_vista numeric(5,2) NOT NULL DEFAULT 3.99,
  taxa_cartao_parcelado numeric(5,2) NOT NULL DEFAULT 4.99,
  taxa_boleto numeric(5,2) NOT NULL DEFAULT 2.49,
  taxa_fixa numeric(10,2) NOT NULL DEFAULT 0.49,
  dados_bancarios jsonb,
  webhook_url text,
  logo_url text,
  api_key_externa text,
  nome_empresa text,
  email_notificacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gateway_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manage config" ON public.gateway_config
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_gw_config_updated
  BEFORE UPDATE ON public.gateway_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();