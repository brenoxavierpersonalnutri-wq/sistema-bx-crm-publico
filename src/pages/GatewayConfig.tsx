import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function GatewayConfig() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome_empresa: "",
    email_notificacoes: "",
    webhook_url: "",
    taxa_pix: 0.99,
    taxa_cartao_vista: 3.99,
    taxa_cartao_parcelado: 4.99,
    taxa_boleto: 2.49,
    taxa_fixa: 0.49,
  });

  useEffect(() => {
    if (!session?.user) return;
    supabase.from("gateway_config").select("*").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => {
        if (data) setForm({
          nome_empresa: data.nome_empresa ?? "",
          email_notificacoes: data.email_notificacoes ?? "",
          webhook_url: data.webhook_url ?? "",
          taxa_pix: Number(data.taxa_pix),
          taxa_cartao_vista: Number(data.taxa_cartao_vista),
          taxa_cartao_parcelado: Number(data.taxa_cartao_parcelado),
          taxa_boleto: Number(data.taxa_boleto),
          taxa_fixa: Number(data.taxa_fixa),
        });
      });
  }, [session?.user?.id]);

  const salvar = async () => {
    if (!session?.user) return;
    setLoading(true);
    const { error } = await supabase.from("gateway_config").upsert({
      user_id: session.user.id,
      ...form,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setLoading(false);
    if (error) toast.error("Erro ao salvar"); else toast.success("Configurações salvas");
  };

  const set = (k: keyof typeof form, v: any) => setForm({ ...form, [k]: v });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/gateway/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="font-display text-xl font-bold">Configurações</h1>
            <p className="text-xs text-muted-foreground">Empresa, taxas e webhooks</p>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Empresa</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Nome da empresa</Label><Input value={form.nome_empresa} onChange={(e) => set("nome_empresa", e.target.value)} /></div>
            <div><Label>E-mail de notificações</Label><Input type="email" value={form.email_notificacoes} onChange={(e) => set("email_notificacoes", e.target.value)} /></div>
            <div><Label>Webhook URL (opcional)</Label><Input value={form.webhook_url} onChange={(e) => set("webhook_url", e.target.value)} placeholder="https://seusite.com/webhook" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Taxas</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><Label>Pix (%)</Label><Input type="number" step="0.01" value={form.taxa_pix} onChange={(e) => set("taxa_pix", parseFloat(e.target.value))} /></div>
            <div><Label>Cartão à vista (%)</Label><Input type="number" step="0.01" value={form.taxa_cartao_vista} onChange={(e) => set("taxa_cartao_vista", parseFloat(e.target.value))} /></div>
            <div><Label>Cartão parcelado (%)</Label><Input type="number" step="0.01" value={form.taxa_cartao_parcelado} onChange={(e) => set("taxa_cartao_parcelado", parseFloat(e.target.value))} /></div>
            <div><Label>Boleto (%)</Label><Input type="number" step="0.01" value={form.taxa_boleto} onChange={(e) => set("taxa_boleto", parseFloat(e.target.value))} /></div>
            <div><Label>Taxa fixa (R$)</Label><Input type="number" step="0.01" value={form.taxa_fixa} onChange={(e) => set("taxa_fixa", parseFloat(e.target.value))} /></div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={salvar} disabled={loading} className="gap-2">
            <Save className="h-4 w-4" /> {loading ? "Salvando..." : "Salvar configurações"}
          </Button>
        </div>
      </main>
    </div>
  );
}
