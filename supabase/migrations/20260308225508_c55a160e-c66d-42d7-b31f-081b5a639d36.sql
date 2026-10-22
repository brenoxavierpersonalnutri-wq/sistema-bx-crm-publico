
CREATE TABLE public.consultations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  calendly_event_uri TEXT UNIQUE,
  client_name TEXT NOT NULL,
  client_email TEXT,
  date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'não convertido' CHECK (status IN ('convertido', 'não convertido', 'no-show')),
  lead_quality TEXT NOT NULL DEFAULT 'morno' CHECK (lead_quality IN ('quente', 'morno', 'frio')),
  observation TEXT DEFAULT '',
  event_type_name TEXT,
  calendly_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

-- Public read/write for now (no auth required since it's a single-user dashboard)
CREATE POLICY "Allow all access" ON public.consultations FOR ALL USING (true) WITH CHECK (true);
