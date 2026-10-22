CREATE TABLE public.webinar_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  url_version TEXT NOT NULL,
  entered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  video_watched_seconds INTEGER NOT NULL DEFAULT 0,
  clicked_cta BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX webinar_analytics_session_unique ON public.webinar_analytics(session_id);
CREATE INDEX webinar_analytics_url_version_idx ON public.webinar_analytics(url_version);
CREATE INDEX webinar_analytics_entered_at_idx ON public.webinar_analytics(entered_at DESC);

ALTER TABLE public.webinar_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert webinar analytics"
ON public.webinar_analytics
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Anyone can update webinar analytics"
ON public.webinar_analytics
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

CREATE POLICY "Approved users can read webinar analytics"
ON public.webinar_analytics
FOR SELECT
TO authenticated
USING (is_approved(auth.uid()));

CREATE TRIGGER update_webinar_analytics_updated_at
BEFORE UPDATE ON public.webinar_analytics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();