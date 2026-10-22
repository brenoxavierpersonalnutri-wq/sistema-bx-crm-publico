import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { NovaCobrancaDialog } from "@/components/gateway/NovaCobrancaDialog";
import { StatusBadge } from "@/components/gateway/StatusBadge";
import { MetodoIcon } from "@/components/gateway/MetodoIcon";
import { formatCurrency } from "@/lib/gateway/formatters";

type Cob = {
  id: string;
  cliente_nome: string;
  cliente_email: string;
  valor_bruto: number;
  metodo: string;
  status: string;
  vencimento: string | null;
  created_at: string;
};

export default function GatewayCobrancas() {
  const { session } = useAuth();
  const [items, setItems] = useState<Cob[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("gateway_transacoes")
      .select("id,cliente_nome,cliente_email,valor_bruto,metodo,status,vencimento,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, [session?.user?.id]);

  const cancelar = async (id: string) => {
    await supabase.from("gateway_transacoes").update({ status: "cancelado" }).eq("id", id);
    toast({ title: "Cobrança cancelada" });
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="font-display text-xl font-bold">Cobranças</h1>
          </div>
          <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nova cobrança</Button>
        </div>
      </header>
      <main className="container max-w-5xl mx-auto px-4 py-8">
        {items.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma cobrança ainda.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {items.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-semibold">{c.cliente_nome}</p>
                    <p className="text-xs text-muted-foreground">{c.cliente_email}</p>
                  </div>
                  <MetodoIcon metodo={c.metodo} withLabel />
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(Number(c.valor_bruto))}</p>
                    {c.vencimento && <p className="text-xs text-muted-foreground">vence {new Date(c.vencimento).toLocaleDateString("pt-BR")}</p>}
                  </div>
                  <StatusBadge status={c.status} />
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/checkout/${c.id}`); toast({ title: "Link copiado" }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    {c.status === "pendente" && (
                      <Button size="icon" variant="ghost" onClick={() => cancelar(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <NovaCobrancaDialog open={open} onOpenChange={setOpen} onCreated={load} />
    </div>
  );
}
