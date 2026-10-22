import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Copy, CheckCircle2, AlertCircle, Webhook } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GatewayEntry {
  id: string;
  label: string;
  source: string; // valor gravado em sales_events.source
  url: string;
  description: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://SEU_PROJECT_REF.supabase.co";

const GATEWAYS: GatewayEntry[] = [
  {
    id: "pagtrust",
    label: "PagTrust — Conta 1",
    source: "PAGTRUST",
    url: `${SUPABASE_URL}/functions/v1/pagtrust-webhook`,
    description: "Conta principal antiga (vai ser desativada).",
  },
  {
    id: "pagtrust-2",
    label: "PagTrust — Conta 2",
    source: "PAGTRUST_2",
    url: `${SUPABASE_URL}/functions/v1/pagtrust-webhook-2`,
    description: "Conta atual em uso.",
  },
  {
    id: "pagtrust-3",
    label: "PagTrust — Conta 3 (nova)",
    source: "PAGTRUST_3",
    url: `${SUPABASE_URL}/functions/v1/pagtrust-webhook?account=3`,
    description: "Cole esta URL no painel da nova conta PagTrust para ativar.",
  },
  {
    id: "kiwify",
    label: "Kiwify",
    source: "KIWIFY",
    url: `${SUPABASE_URL}/functions/v1/webhook-receiver`,
    description: "Pagamento aprovado (Order Paid).",
  },
  {
    id: "hotmart",
    label: "Hotmart",
    source: "HOTMART",
    url: `${SUPABASE_URL}/functions/v1/webhook-receiver`,
    description: "Compra aprovada (versão 2.0).",
  },
];

export function GatewayWebhooksDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [activity, setActivity] = useState<Record<string, { count: number; last: string | null }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await supabase
        .from("sales_events")
        .select("source, created_at")
        .gte("created_at", since.toISOString());

      const map: Record<string, { count: number; last: string | null }> = {};
      for (const ev of (data || []) as any[]) {
        const src = String(ev.source || "").toUpperCase();
        if (!map[src]) map[src] = { count: 0, last: null };
        map[src].count += 1;
        if (!map[src].last || ev.created_at > map[src].last) {
          map[src].last = ev.created_at;
        }
      }
      setActivity(map);
      setLoading(false);
    };
    load();
  }, [open]);

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "URL copiada!" });
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            Webhooks de Gateway
          </DialogTitle>
          <DialogDescription>
            Integre seus gateways de pagamento. O status mostra quais webhooks
            receberam eventos nos últimos 30 dias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando status...</p>
          ) : (
            GATEWAYS.map((gw) => {
              const act = activity[gw.source];
              const isActive = !!act && act.count > 0;
              return (
                <div
                  key={gw.id}
                  className="rounded-lg border border-border/60 bg-card/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{gw.label}</span>
                      {isActive ? (
                        <Badge variant="outline" className="text-success border-success/40 bg-success/5 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Puxando
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground border-border gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Sem eventos
                        </Badge>
                      )}
                    </div>
                    {isActive && (
                      <span className="text-[11px] text-muted-foreground">
                        {act.count} ev. • último: {fmtDate(act.last)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{gw.description}</p>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={gw.url}
                      className="font-mono text-[11px] h-8 bg-background"
                    />
                    <Button size="icon" variant="secondary" className="h-8 w-8 shrink-0" onClick={() => copy(gw.url)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
