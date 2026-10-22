import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MonthlyData } from "@/data/dashboardData";

type DrillType = "faturamento" | "gastos" | null;

interface Props {
  open: boolean;
  onClose: () => void;
  type: DrillType;
  monthsInScope: string[];
  data: MonthlyData[];
}

const MONTH_NUM: Record<string, number> = {
  Jan: 1, Fev: 2, Mar: 3, Abr: 4, Mai: 5, Jun: 6,
  Jul: 7, Ago: 8, Set: 9, Out: 10, Nov: 11, Dez: 12,
};

function monthRange(monthStr: string): { from: string; to: string } {
  const [m, y] = monthStr.split("/");
  const month = MONTH_NUM[m];
  const year = 2000 + parseInt(y);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  return { from, to };
}

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const normalizeKey = (s: string | null | undefined): string => {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
};

const phoneTail = (s: string | null | undefined): string => {
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
};

export function FinanceDrillDialog({ open, onClose, type, monthsInScope, data }: Props) {
  const [sales, setSales] = useState<any[]>([]);
  const [manualSales, setManualSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || type !== "faturamento" || monthsInScope.length === 0) return;

    const load = async () => {
      setLoading(true);
      const ranges = monthsInScope.map(monthRange);
      const from = ranges.map(r => r.from).sort()[0];
      const to = ranges.map(r => r.to).sort().reverse()[0];

      const [salesRes, convertedRes] = await Promise.all([
        supabase
          .from("sales_events")
          .select("id, value, source, customer_email, customer_phone, created_at")
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase
          .from("consultations")
          .select("id, client_name, client_email, client_phone, ticket_value, payment_method, converted_at")
          .eq("converted", true)
          .gte("converted_at", `${from}T00:00:00`)
          .lte("converted_at", `${to}T23:59:59`)
          .not("ticket_value", "is", null)
          .order("converted_at", { ascending: false }),
      ]);

      const salesRows = salesRes.data || [];
      const convertedRows = convertedRes.data || [];

      // Build dedup index from sales_events by email/phone tail
      const emailIdx = new Set<string>();
      const phoneIdx = new Set<string>();
      for (const s of salesRows) {
        const e = normalizeKey(s.customer_email);
        const p = phoneTail(s.customer_phone);
        if (e) emailIdx.add(e);
        if (p) phoneIdx.add(p);
      }

      // Keep only consults NOT matched by gateway
      const onlyManual = convertedRows.filter((c: any) => {
        if (!c.ticket_value || Number(c.ticket_value) <= 0) return false;
        const e = normalizeKey(c.client_email);
        const p = phoneTail(c.client_phone);
        if (e && emailIdx.has(e)) return false;
        if (p && phoneIdx.has(p)) return false;
        return true;
      });

      setSales(salesRows);
      setManualSales(onlyManual);
      setLoading(false);
    };

    load();
  }, [open, type, monthsInScope]);

  if (!type) return null;

  const isFat = type === "faturamento";
  const title = isFat ? "Detalhamento do Faturamento" : "Detalhamento dos Gastos";
  const description = isFat
    ? "Vendas registradas no período (gateway + marcadas manualmente no Vendas)."
    : "Composição dos gastos no período por categoria.";

  // Gastos breakdown
  const totalTrafego = data.reduce((s, d) => s + d.trafego, 0);
  const totalCampanha = data.reduce((s, d) => s + d.campanhaMeta, 0);
  const totalFerramentas = data.reduce((s, d) => s + d.ferramentas, 0);
  const totalColaboradores = data.reduce((s, d) => s + d.colaboradores, 0);
  const totalImposto = data.reduce((s, d) => s + (d.faturamento * d.impostoPercent / 100), 0);
  const totalWhatsapp = data.reduce((s, d) => s + d.whatsappCost, 0);
  const gastosTotal = totalTrafego + totalCampanha + totalFerramentas + totalColaboradores + totalImposto + totalWhatsapp;

  const gastosRows = [
    { label: "Tráfego (Meta Ads)", value: totalTrafego },
    { label: "13,83% Meta (Campanhas)", value: totalCampanha },
    { label: "Ferramentas", value: totalFerramentas },
    { label: "Colaboradores", value: totalColaboradores },
    { label: "Imposto", value: totalImposto },
    { label: "WhatsApp Business", value: totalWhatsapp },
  ];

  const totalSales = sales.reduce((s, r) => s + Number(r.value || 0), 0);
  const totalManual = manualSales.reduce((s, r) => s + Number(r.ticket_value || 0), 0);
  const grandTotal = totalSales + totalManual;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description} {monthsInScope.length > 0 && (
              <span className="block mt-1 text-xs">
                Período: {monthsInScope.join(", ")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isFat ? (
          <div className="space-y-6">
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Carregando vendas...</p>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <span className="text-sm font-semibold">Total Geral</span>
                  <span className="text-base font-bold text-success">{fmtBRL(grandTotal)}</span>
                </div>

                {/* Gateway sales */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Vendas via Gateway (PagTrust)</h4>
                    <span className="text-xs text-muted-foreground">
                      {sales.length} venda(s) • {fmtBRL(totalSales)}
                    </span>
                  </div>
                  {sales.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">
                      Nenhuma venda via gateway no período.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Origem</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sales.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="text-xs">
                              {format(parseISO(s.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </TableCell>
                            <TableCell className="text-xs">
                              {s.customer_email || s.customer_phone || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[10px]">{s.source}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">
                              {fmtBRL(Number(s.value || 0))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Manual sales */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Vendas marcadas manualmente (Consultas convertidas)</h4>
                    <span className="text-xs text-muted-foreground">
                      {manualSales.length} venda(s) • {fmtBRL(totalManual)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Apenas vendas que não tiveram correspondência no gateway (evita duplicação).
                  </p>
                  {manualSales.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">
                      Nenhuma venda manual sem correspondência no gateway.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Pagamento</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {manualSales.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="text-xs">
                              {c.converted_at ? format(parseISO(c.converted_at), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                            </TableCell>
                            <TableCell className="text-xs">{c.client_name || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {c.payment_method || "manual"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">
                              {fmtBRL(Number(c.ticket_value || 0))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
              <span className="text-sm font-medium">Total de Gastos</span>
              <span className="text-sm font-semibold text-destructive">{fmtBRL(gastosTotal)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">% do Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gastosRows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="text-sm">{r.label}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtBRL(r.value)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {gastosTotal > 0 ? `${((r.value / gastosTotal) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
