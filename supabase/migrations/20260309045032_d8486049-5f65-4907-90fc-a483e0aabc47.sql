-- Rotator Links
CREATE TABLE public.rotator_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rotator_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage rotator_links" ON public.rotator_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Rotator Destinations
CREATE TABLE public.rotator_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotator_id uuid NOT NULL REFERENCES public.rotator_links(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text NOT NULL DEFAULT '',
  weight integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rotator_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage rotator_destinations" ON public.rotator_destinations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Rotator Clicks
CREATE TABLE public.rotator_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotator_id uuid NOT NULL REFERENCES public.rotator_links(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.rotator_destinations(id) ON DELETE CASCADE,
  click_id text NOT NULL UNIQUE,
  ip_address text DEFAULT '',
  user_agent text DEFAULT '',
  referer text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rotator_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rotator_clicks" ON public.rotator_clicks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can insert rotator_clicks" ON public.rotator_clicks
  FOR INSERT WITH CHECK (true);

-- Rotator Events
CREATE TABLE public.rotator_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id text NOT NULL,
  event_type text NOT NULL,
  value numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rotator_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rotator_events" ON public.rotator_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anyone can insert rotator_events" ON public.rotator_events
  FOR INSERT WITH CHECK (true);