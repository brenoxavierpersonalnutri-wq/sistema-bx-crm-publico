
-- Create leads_tracking table
CREATE TABLE public.leads_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  click_id TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_medium TEXT,
  utm_source TEXT,
  page_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.leads_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can insert leads_tracking" ON public.leads_tracking
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Approved users can read leads_tracking" ON public.leads_tracking
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));

-- Create sales_events table
CREATE TABLE public.sales_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  lead_id UUID REFERENCES public.leads_tracking(id),
  value NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  customer_email TEXT,
  customer_phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can insert sales_events" ON public.sales_events
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Approved users can read sales_events" ON public.sales_events
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can insert sales_events" ON public.sales_events
  FOR INSERT TO authenticated WITH CHECK (is_approved(auth.uid()));
