
-- Monthly financial data table
CREATE TABLE public.monthly_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL UNIQUE,
  faturamento numeric NOT NULL DEFAULT 0,
  comissao numeric NOT NULL DEFAULT 0,
  trafego numeric NOT NULL DEFAULT 0,
  campanha_meta numeric NOT NULL DEFAULT 0,
  ferramentas numeric NOT NULL DEFAULT 0,
  colaboradores numeric NOT NULL DEFAULT 0,
  imposto_percent numeric NOT NULL DEFAULT 0,
  whatsapp_cost numeric NOT NULL DEFAULT 0,
  whatsapp_messages_sent integer NOT NULL DEFAULT 0,
  whatsapp_messages_received integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read monthly_data" ON public.monthly_data
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can insert monthly_data" ON public.monthly_data
  FOR INSERT TO authenticated WITH CHECK (is_approved(auth.uid()));

CREATE POLICY "Approved users can update monthly_data" ON public.monthly_data
  FOR UPDATE TO authenticated USING (is_approved(auth.uid()));

INSERT INTO public.monthly_data (month) VALUES
  ('Jan/26'),('Fev/26'),('Mar/26'),('Abr/26'),('Mai/26'),('Jun/26'),
  ('Jul/26'),('Ago/26'),('Set/26'),('Out/26'),('Nov/26'),('Dez/26');

CREATE TABLE public.expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  category text NOT NULL,
  name text NOT NULL DEFAULT '',
  value numeric NOT NULL DEFAULT 0,
  date date,
  recurring boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read expense_items" ON public.expense_items
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can insert expense_items" ON public.expense_items
  FOR INSERT TO authenticated WITH CHECK (is_approved(auth.uid()));

CREATE POLICY "Approved users can update expense_items" ON public.expense_items
  FOR UPDATE TO authenticated USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can delete expense_items" ON public.expense_items
  FOR DELETE TO authenticated USING (is_approved(auth.uid()));
