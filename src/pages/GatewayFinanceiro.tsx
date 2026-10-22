import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Wallet, Clock, TrendingUp, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatCard } from "@/components/gateway/StatCard";
import { SaqueDialog } from "@/components/gateway/SaqueDialog";
import { formatCurrency } from "@/lib/gateway/formatters";

type Tx = { valor_liquido: number; valor_bruto: number; status: string; created_at: string; pago_em: string | null };
type Saque = { id: string; valor: number; status: string; created_at: string; processado_em: string | null };

const STATUS_SAQUE: Record<string, string> = {
  pendente: "bg-amber-500/15 text-amber-600",
  processando: "bg-blue-500/15 text-blue-600",
  pago: "bg-emerald-500/15 text-emerald-600",
  rejeitado: "bg-red-500/15 text-red-600",
};

export default function GatewayFinanceiro() {
  const { session } = useAuth();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [saques, setSaques] = useState<Saque[]>([]);
  const [periodo, setPeriodo] = useState<30 | 90>(30);
  const [openSaque, setOpenSaque] = useState(false);

  const loadAll = async () => {
    if (!session?.user) return;
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from("gateway_transacoes")
        .select("valor_liquido,valor_bruto,status,created_at,pago_em")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false }),
      supabase.from("gateway_saques")
        .select("id,valor,status,created_at,processado_em")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false }),
    ]);
    setTxs(t ?? []);
    setSaques(s ?? []);
  };

  useEffect(() => { loadAll(); }, [session?.user?.id]);

  // Saldos
  const recebido = txs.filter((t) => t.status === "pago").reduce((s, t) => s + Number(t.valor_liquido), 0);
  const sacado = saques.filter((s) => s.status === "pago").reduce((acc, s) => acc + Number(s.valor), 0);
  const bloqueado = saques.filter((s) => s.status === "pendente" || s.status === "processando").reduce((acc, s) => acc + Number(s.valor), 0);
  const disponivel = recebido - sacado - bloqueado;
  const aReceber = txs.filter((t) => t.status === "pendente").reduce((s, t) => s + Number(t.valor_liquido), 0);

  const serie = Array.from({ length: periodo }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (periodo - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const valor = txs
      .filter((t) => t.status === "pago" && (t.pago_em ?? t.created_at).slice(0, 10) === key)
      .reduce((s, t) => s + Number(t.valor_liquido), 0);
    return { data: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor };
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="font-display text-xl font-bold">Financeiro</h1>
              <p className="text-xs text-muted-foreground">Saldo, fluxo de caixa e saques</p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => setOpenSaque(true)} disabled={disponivel <= 0}>
            <Banknote className="h-4 w-4" /> Solicitar saque
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Saldo disponível" value={formatCurrency(disponivel)} hint="Líquido pronto pra sacar" icon={Wallet} color="emerald" />
          <StatCard title="A receber" value={formatCurrency(aReceber)} hint="Cobranças pendentes" icon={Clock} color="amber" />
          <StatCard title="Bloqueado em saques" value={formatCurrency(bloqueado)} hint="Saques em processamento" icon={TrendingUp} color="blue" />
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Fluxo de caixa</CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant={periodo === 30 ? "default" : "ghost"} onClick={() => setPeriodo(30)}>30d</Button>
              <Button size="sm" variant={periodo === 90 ? "default" : "ghost"} onClick={() => setPeriodo(90)}>90d</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={serie}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} interval={Math.floor(periodo / 10)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  <Area type="monotone" dataKey="valor" stroke="#10b981" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Histórico de saques */}
        <Card>
          <CardHeader><CardTitle className="text-base">Saques solicitados</CardTitle></CardHeader>
          <CardContent>
            {saques.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum saque solicitado ainda.</p>
            ) : (
              <div className="space-y-2">
                {saques.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div>
                      <p className="font-semibold">{formatCurrency(Number(s.valor))}</p>
                      <p className="text-xs text-muted-foreground">
                        Solicitado em {new Date(s.created_at).toLocaleString("pt-BR")}
                        {s.processado_em && ` • Processado em ${new Date(s.processado_em).toLocaleString("pt-BR")}`}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_SAQUE[s.status] ?? "bg-muted"}`}>
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <SaqueDialog
        open={openSaque}
        onOpenChange={setOpenSaque}
        saldoDisponivel={disponivel}
        onCreated={loadAll}
      />
    </div>
  );
}
