import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, MousePointerClick, TrendingUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { subDays } from "date-fns";

interface PageView {
  id: string;
  url: string;
  session_id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  created_at: string;
  profile_id: string;
}

interface TrackingEvent {
  id: string;
  session_id: string;
  event_name: string;
  page_url: string;
  value: number | null;
  created_at: string;
  profile_id: string;
}

interface PageStat {
  url: string;
  pageViews: number;
  leads: number;
  conversionRate: number;
}

export function PageStatsTab() {
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [trackingEvents, setTrackingEvents] = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [utmSourceFilter, setUtmSourceFilter] = useState<string>("all");
  const [utmCampaignFilter, setUtmCampaignFilter] = useState<string>("all");
  const [utmMediumFilter, setUtmMediumFilter] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    const from = format(dateFrom, "yyyy-MM-dd");
    const to = format(dateTo, "yyyy-MM-dd") + "T23:59:59";

    const [pvRes, evRes] = await Promise.all([
      supabase.from("page_views" as any).select("*").gte("created_at", from).lte("created_at", to),
      supabase.from("tracking_events" as any).select("*").gte("created_at", from).lte("created_at", to),
    ]);

    setPageViews((pvRes.data as any[]) || []);
    setTrackingEvents((evRes.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo]);

  // Extract unique UTM values for filters
  const utmSources = useMemo(() => {
    const sources = new Set<string>();
    pageViews.forEach(pv => { if (pv.utm_source) sources.add(pv.utm_source); });
    return Array.from(sources).sort();
  }, [pageViews]);

  const utmCampaigns = useMemo(() => {
    const campaigns = new Set<string>();
    pageViews.forEach(pv => { if (pv.utm_campaign) campaigns.add(pv.utm_campaign); });
    return Array.from(campaigns).sort();
  }, [pageViews]);

  const utmMediums = useMemo(() => {
    const mediums = new Set<string>();
    pageViews.forEach(pv => { if (pv.utm_medium) mediums.add(pv.utm_medium); });
    return Array.from(mediums).sort();
  }, [pageViews]);

  // Filter and aggregate data
  const pageStats = useMemo((): PageStat[] => {
    let filteredViews = pageViews;

    if (utmSourceFilter !== "all") {
      filteredViews = filteredViews.filter(pv => pv.utm_source === utmSourceFilter);
    }
    if (utmCampaignFilter !== "all") {
      filteredViews = filteredViews.filter(pv => pv.utm_campaign === utmCampaignFilter);
    }
    if (utmMediumFilter !== "all") {
      filteredViews = filteredViews.filter(pv => pv.utm_medium === utmMediumFilter);
    }

    // Get filtered session IDs
    const filteredSessionIds = new Set(filteredViews.map(pv => pv.session_id));

    // Group page views by URL (strip query params for grouping)
    const urlMap = new Map<string, { views: number; sessions: Set<string> }>();

    filteredViews.forEach(pv => {
      try {
        const parsed = new URL(pv.url);
        const cleanUrl = parsed.origin + parsed.pathname;
        if (!urlMap.has(cleanUrl)) {
          urlMap.set(cleanUrl, { views: 0, sessions: new Set() });
        }
        const entry = urlMap.get(cleanUrl)!;
        entry.views++;
        entry.sessions.add(pv.session_id);
      } catch {
        // fallback for malformed URLs
        if (!urlMap.has(pv.url)) {
          urlMap.set(pv.url, { views: 0, sessions: new Set() });
        }
        const entry = urlMap.get(pv.url)!;
        entry.views++;
        entry.sessions.add(pv.session_id);
      }
    });

    // Count leads (non-page_view events) per URL from filtered sessions
    const filteredEvents = trackingEvents.filter(ev => filteredSessionIds.has(ev.session_id));

    const leadsPerUrl = new Map<string, number>();
    filteredEvents.forEach(ev => {
      try {
        const parsed = new URL(ev.page_url);
        const cleanUrl = parsed.origin + parsed.pathname;
        leadsPerUrl.set(cleanUrl, (leadsPerUrl.get(cleanUrl) || 0) + 1);
      } catch {
        leadsPerUrl.set(ev.page_url, (leadsPerUrl.get(ev.page_url) || 0) + 1);
      }
    });

    const stats: PageStat[] = [];
    urlMap.forEach((data, url) => {
      const leads = leadsPerUrl.get(url) || 0;
      stats.push({
        url,
        pageViews: data.views,
        leads,
        conversionRate: data.views > 0 ? (leads / data.views) * 100 : 0,
      });
    });

    return stats.sort((a, b) => b.pageViews - a.pageViews);
  }, [pageViews, trackingEvents, utmSourceFilter, utmCampaignFilter, utmMediumFilter]);

  const totals = useMemo(() => ({
    views: pageStats.reduce((s, p) => s + p.pageViews, 0),
    leads: pageStats.reduce((s, p) => s + p.leads, 0),
    rate: pageStats.reduce((s, p) => s + p.pageViews, 0) > 0
      ? (pageStats.reduce((s, p) => s + p.leads, 0) / pageStats.reduce((s, p) => s + p.pageViews, 0)) * 100
      : 0,
  }), [pageStats]);

  const shortenUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.pathname === "/" ? parsed.hostname : parsed.hostname + parsed.pathname;
    } catch {
      return url;
    }
  };

  return (
    <div className="space-y-6">
      {/* Date + UTM Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 justify-start text-left font-normal text-sm">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateFrom, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-sm text-muted-foreground">até</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 justify-start text-left font-normal text-sm">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateTo, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <div className="flex gap-1 ml-1">
            {[{ label: "7d", days: 7 }, { label: "30d", days: 30 }, { label: "90d", days: 90 }].map(({ label, days }) => (
              <Button key={label} variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => { setDateFrom(subDays(new Date(), days)); setDateTo(new Date()); }}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={utmSourceFilter} onValueChange={setUtmSourceFilter}>
            <SelectTrigger className="w-[160px] h-9 text-xs">
              <SelectValue placeholder="UTM Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as fontes</SelectItem>
              {utmSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={utmCampaignFilter} onValueChange={setUtmCampaignFilter}>
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="UTM Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as campanhas</SelectItem>
              {utmCampaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={utmMediumFilter} onValueChange={setUtmMediumFilter}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="UTM Medium" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meios</SelectItem>
              {utmMediums.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Visualizações</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.views.toLocaleString("pt-BR")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads / Eventos</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.leads.toLocaleString("pt-BR")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.rate.toFixed(2)}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estatísticas por Página</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando dados...</p>
          ) : pageStats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum dado encontrado. Instale o pixel de rastreamento nas suas páginas para começar a coletar dados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Página</TableHead>
                  <TableHead className="text-right">Cliques (Views)</TableHead>
                  <TableHead className="text-right">Leads (Eventos)</TableHead>
                  <TableHead className="text-right">Taxa de Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageStats.map((stat) => (
                  <TableRow key={stat.url}>
                    <TableCell className="font-medium max-w-[300px] truncate" title={stat.url}>
                      {shortenUrl(stat.url)}
                    </TableCell>
                    <TableCell className="text-right">{stat.pageViews.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">{stat.leads.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={stat.conversionRate > 5 ? "default" : stat.conversionRate > 0 ? "secondary" : "outline"}>
                        {stat.conversionRate.toFixed(2)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
