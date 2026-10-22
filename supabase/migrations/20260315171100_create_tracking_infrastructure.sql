-- Add tracking fields to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS tracking_token UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token TEXT,
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT;

-- Create page_views table
CREATE TABLE public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT,
  url TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create tracking_events table
CREATE TABLE public.tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT,
  event_name TEXT NOT NULL,
  page_url TEXT,
  value NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for page_views
CREATE POLICY "Users can read own page views"
  ON public.page_views FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Service role can insert page views"
  ON public.page_views FOR INSERT
  TO service_role
  WITH CHECK (true);

-- RLS policies for tracking_events
CREATE POLICY "Users can read own tracking events"
  ON public.tracking_events FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Service role can insert tracking events"
  ON public.tracking_events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Add index for faster counts
CREATE INDEX idx_page_views_profile_id ON public.page_views(profile_id);
CREATE INDEX idx_tracking_events_profile_id ON public.tracking_events(profile_id);
