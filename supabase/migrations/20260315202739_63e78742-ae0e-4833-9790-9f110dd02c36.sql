
-- Add tracking_token to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tracking_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

-- Create page_views table
CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create tracking_events table
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  page_url TEXT NOT NULL,
  value NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for page_views
CREATE POLICY "Approved users can read page_views" ON public.page_views FOR SELECT TO authenticated USING (is_approved(auth.uid()));
CREATE POLICY "Service can insert page_views" ON public.page_views FOR INSERT TO public WITH CHECK (true);

-- RLS policies for tracking_events
CREATE POLICY "Approved users can read tracking_events" ON public.tracking_events FOR SELECT TO authenticated USING (is_approved(auth.uid()));
CREATE POLICY "Service can insert tracking_events" ON public.tracking_events FOR INSERT TO public WITH CHECK (true);

-- Backfill existing profiles with tracking tokens
UPDATE public.profiles SET tracking_token = gen_random_uuid()::text WHERE tracking_token IS NULL;
