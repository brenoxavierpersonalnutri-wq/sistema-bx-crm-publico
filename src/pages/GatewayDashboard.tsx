import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Wallet, TrendingUp, Percent, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatCard } from "@/components/gateway/StatCard";
import { StatusBadge } from "@/components/gateway/StatusBadge";
import { MetodoIcon } from "@/components/gateway/MetodoIcon";
import { formatCurrency } from "@/lib/gateway/formatters";
import { NovaCobrancaDialog } from "@/components/gateway/NovaCobrancaDialog";

type Tx = {
  id: string;
  cliente_nome: string;
  valor_bruto: number;
  valor_liquido: number;
  taxa_percentual: number;
  metodo: string;
  status: string;
  created_at: string;
};

export default function GatewayDashboard() {
  const { session } = useAuth();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("gateway_transacoes")
      .select("id,cliente_nome,valor_bruto,valor_liquido,taxa_percentual,metodo,status,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setTxs(data ?? []);
  };
  useEffect(() => { load(); }, [session?.user?.id]);

  const pagas = txs.filter((t) => t.status === "pago");
  const saldo = pagas.reduce((s, t) => s + Number(t.valor_liquido), 0);
  const now = new Date();
  const mes = pagas.filter((t) => new Date(t.created_at).getMonth() === now.getMonth());
  const vendasMes = mes.reduce((s, t) => s + Number(t.valor_bruto), 0);
  const ticket = mes.length ? vendasMes / mes.length : 0;
  const taxaMedia = pagas.length ? pagas.reduce((s, t) => s + Number(t.taxa_percentual), 0) / pagas.length : 0;

  // série últimos 30 dias
  const serie = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const key = d.toISOString().slice(0, 10);
    const total = pagas
      .filter((t) => t.created_at.slice(0, 10) === key)
      .reduce((s, t) => s + Number(t.valor_liquido), 0);
    return { data: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: total };
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="font-display text-xl font-bold">Gateway de Pagamento</h1>
              <p className="text-xs text-muted-foreground">Dashboard</p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Nova Cobrança
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Saldo disponível" value={formatCurrency(saldo)} hint="Total líquido recebido" icon={Wallet} color="emerald" />
          <StatCard title="Vendas do mês" value={formatCurrency(vendasMes)} hint={`${mes.length} transações`} icon={TrendingUp} color="blue" />
          <StatCard title="Taxa média" value={`${taxaMedia.toFixed(2)}%`} hint="Média sobre pagos" icon={Percent} color="amber" />
          <StatCard title="Ticket médio" value={formatCurrency(ticket)} hint="No mês atual" icon={DollarSign} color="purple" />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Vendas dos últimos 30 dias</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  <Line type="monotone" dataKey="valor" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Últimas transações</CardTitle>
            <Link to="/gateway/transacoes"><Button variant="ghost" size="sm">Ver todas</Button></Link>
          </CardHeader>
          <CardContent>
            {txs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma transação ainda. Crie sua primeira cobrança.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txs.slice(0, 5).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium">{t.cliente_nome}</TableCell>
                      <TableCell><MetodoIcon metodo={t.metodo} withLabel /></TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(Number(t.valor_bruto))}</TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <NovaCobrancaDialog open={open} onOpenChange={setOpen} onCreated={load} />
    </div>
  );
}
