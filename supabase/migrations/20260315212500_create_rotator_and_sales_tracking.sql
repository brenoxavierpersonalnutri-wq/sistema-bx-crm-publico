-- Create leads_tracking table
CREATE TABLE leads_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    click_id TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_medium TEXT,
    utm_source TEXT,
    page_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for leads_tracking
ALTER TABLE leads_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tracked leads"
    ON leads_tracking FOR SELECT
    USING (auth.uid() = profile_id);

CREATE POLICY "Service role can insert leads"
    ON leads_tracking FOR INSERT
    WITH CHECK (true);


-- Create sales_events table
CREATE TABLE sales_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads_tracking(id) ON DELETE SET NULL,
    value NUMERIC NOT NULL DEFAULT 0,
    source TEXT NOT NULL, -- 'HOTMART', 'KIWIFY', 'MANUAL'
    customer_email TEXT,
    customer_phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for sales_events
ALTER TABLE sales_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sales events"
    ON sales_events FOR SELECT
    USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own sales events"
    ON sales_events FOR INSERT
    WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Service role can insert sales"
    ON sales_events FOR INSERT
    WITH CHECK (true);
