
ALTER TABLE public.rotator_links ADD COLUMN IF NOT EXISTS conversion_rule jsonb;
ALTER TABLE public.rotator_events ADD COLUMN IF NOT EXISTS page_url text;
