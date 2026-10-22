import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Search, Eye, Check, Undo2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/gateway/StatusBadge";
import { MetodoIcon } from "@/components/gateway/MetodoIcon";
import { formatCurrency } from "@/lib/gateway/formatters";

// Tipo da transação completa
type Transacao = {
  id: string;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string | null;
  cliente_cpf_cnpj: string | null;
  valor_bruto: number;
  valor_liquido: number;
  taxa_fixa: number;
  taxa_percentual: number;
  metodo: string;
  status: string;
  parcelas: number;
  descricao: string | null;
  vencimento: string | null;
  pago_em: string | null;
  created_at: string;
  link_id: string | null;
  gateway_id: string | null;
};

const PAGE_SIZE = 20;

export default function GatewayTransacoes() {
  const { session } = useAuth();
  const [items, setItems] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [metodoFilter, setMetodoFilter] = useState<string>("todos");
  const [periodoFilter, setPeriodoFilter] = useState<string>("30");

  const [detalhes, setDetalhes] = useState<Transacao | null>(null);

  const load = async () => {
    if (!session?.user) return;
    setLoading(true);
    const { data } = await supabase
      .from("gateway_transacoes")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setItems((data ?? []) as Transacao[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [session?.user?.id]);

  // Aplica filtros em memória
  const filtered = useMemo(() => {
    const dias = parseInt(periodoFilter);
    const cutoff = isNaN(dias) ? null : Date.now() - dias * 86400000;
    const q = search.toLowerCase().trim();
    return items.filter((t) => {
      if (statusFilter !== "todos" && t.status !== statusFilter) return false;
      if (metodoFilter !== "todos" && t.metodo !== metodoFilter) return false;
      if (cutoff && new Date(t.created_at).getTime() < cutoff) return false;
      if (q) {
        const blob = `${t.cliente_nome} ${t.cliente_email} ${t.cliente_telefone ?? ""} ${t.id}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, metodoFilter, periodoFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Resumo dos filtros aplicados
  const totais = useMemo(() => {
    const pagas = filtered.filter((t) => t.status === "pago");
    return {
      total: filtered.length,
      bruto: pagas.reduce((s, t) => s + Number(t.valor_bruto), 0),
      liquido: pagas.reduce((s, t) => s + Number(t.valor_liquido), 0),
    };
  }, [filtered]);

  const exportCSV = () => {
    const headers = ["ID", "Data", "Cliente", "Email", "Telefone", "Método", "Status", "Bruto", "Líquido", "Parcelas"];
    const rows = filtered.map((t) => [
      t.id,
      new Date(t.created_at).toLocaleString("pt-BR"),
      t.cliente_nome,
      t.cliente_email,
      t.cliente_telefone ?? "",
      t.metodo,
      t.status,
      Number(t.valor_bruto).toFixed(2),
      Number(t.valor_liquido).toFixed(2),
      t.parcelas,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado", description: `${filtered.length} transações.` });
  };

  // Marca uma transação como paga manualmente
  const marcarPaga = async (id: string) => {
    const { error } = await supabase
      .from("gateway_transacoes")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Marcada como paga" });
    setDetalhes(null);
    load();
  };

  // Estorna uma transação
  const estornar = async (id: string) => {
    const { error } = await supabase
      .from("gateway_transacoes")
      .update({ status: "reembolsado" })
      .eq("id", id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Transação estornada" });
    setDetalhes(null);
    load();
  };

  // Cancela
  const cancelar = async (id: string) => {
    const { error } = await supabase
      .from("gateway_transacoes")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Cobrança cancelada" });
    setDetalhes(null);
    load();
  };

  // Reenvia o link de pagamento (copia para clipboard)
  const reenviarLink = async (t: Transacao) => {
    const url = `${window.location.origin}/checkout/${t.id}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Link copiado", description: "Cole no WhatsApp ou e-mail do cliente." });
  };

  // Envia comprovante por e-mail
  const enviarComprovante = async (t: Transacao) => {
    const { error } = await supabase.functions.invoke("gateway-send-receipt", {
      body: { transacao_id: t.id },
    });
    if (error) return toast({ title: "Erro ao enviar", description: error.message, variant: "destructive" });
    toast({ title: "Comprovante enviado", description: t.cliente_email });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="font-display text-xl font-bold">Transações</h1>
              <p className="text-xs text-muted-foreground">{totais.total} resultado(s) • {formatCurrency(totais.liquido)} líquido</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>
      </header>

      <main className="container max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Filtros */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, e-mail ou ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
                <SelectItem value="reembolsado">Reembolsado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={metodoFilter} onValueChange={(v) => { setMetodoFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos métodos</SelectItem>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="cartao">Cartão</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
              </SelectContent>
            </Select>
            <Select value={periodoFilter} onValueChange={(v) => { setPeriodoFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="365">Último ano</SelectItem>
                <SelectItem value="all">Todo período</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Tabela */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">Nenhuma transação encontrada.</TableCell></TableRow>
                ) : pageItems.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetalhes(t)}>
                    <TableCell>
                      <div className="font-medium">{t.cliente_nome}</div>
                      <div className="text-xs text-muted-foreground">{t.cliente_email}</div>
                    </TableCell>
                    <TableCell><MetodoIcon metodo={t.metodo} withLabel /></TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold">{formatCurrency(Number(t.valor_bruto))}</div>
                      {t.parcelas > 1 && <div className="text-xs text-muted-foreground">{t.parcelas}x</div>}
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Eye className="h-4 w-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
            <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Próxima</Button>
          </div>
        )}
      </main>

      {/* Modal de detalhes */}
      <Dialog open={!!detalhes} onOpenChange={(o) => !o && setDetalhes(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Detalhes da transação</DialogTitle></DialogHeader>
          {detalhes && (
            <div className="space-y-4">
              {/* Timeline simples */}
              <div className="space-y-2">
                <TimelineItem ativo label="Criada" data={detalhes.created_at} />
                <TimelineItem ativo={!!detalhes.pago_em} label="Paga" data={detalhes.pago_em} />
                {detalhes.status === "reembolsado" && <TimelineItem ativo label="Estornada" data={null} />}
                {detalhes.status === "cancelado" && <TimelineItem ativo label="Cancelada" data={null} />}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Cliente" value={detalhes.cliente_nome} />
                <Info label="E-mail" value={detalhes.cliente_email} />
                <Info label="Telefone" value={detalhes.cliente_telefone ?? "—"} />
                <Info label="CPF/CNPJ" value={detalhes.cliente_cpf_cnpj ?? "—"} />
                <Info label="Método" value={detalhes.metodo} />
                <Info label="Parcelas" value={String(detalhes.parcelas)} />
                <Info label="Valor bruto" value={formatCurrency(Number(detalhes.valor_bruto))} />
                <Info label="Valor líquido" value={formatCurrency(Number(detalhes.valor_liquido))} />
                <Info label="ID" value={detalhes.id.slice(0, 8)} />
                <Info label="Status" value={detalhes.status} />
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => reenviarLink(detalhes)}>
                  <Send className="h-3 w-3" /> Reenviar link
                </Button>
                {detalhes.status === "pago" && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => enviarComprovante(detalhes)}>
                      <Send className="h-3 w-3" /> Enviar comprovante
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 text-red-600" onClick={() => estornar(detalhes.id)}>
                      <Undo2 className="h-3 w-3" /> Estornar
                    </Button>
                  </>
                )}
                {detalhes.status === "pendente" && (
                  <>
                    <Button size="sm" className="gap-1" onClick={() => marcarPaga(detalhes.id)}>
                      <Check className="h-3 w-3" /> Marcar como paga
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 text-red-600" onClick={() => cancelar(detalhes.id)}>
                      <X className="h-3 w-3" /> Cancelar
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimelineItem({ ativo, label, data }: { ativo: boolean; label: string; data: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-2 w-2 rounded-full ${ativo ? "bg-emerald-500" : "bg-muted"}`} />
      <div className="flex-1 text-sm">{label}</div>
      <div className="text-xs text-muted-foreground">{data ? new Date(data).toLocaleString("pt-BR") : "—"}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}
