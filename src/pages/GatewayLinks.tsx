import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Copy, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, slugify } from "@/lib/gateway/formatters";

type Link2 = {
  id: string;
  slug: string;
  nome_produto: string;
  descricao: string | null;
  valor: number;
  metodos_aceitos: string[];
  ativo: boolean;
  vendas_count: number;
  total_arrecadado: number;
};

const schema = z.object({
  nome: z.string().trim().min(2, "Nome obrigatório").max(120),
  valor: z.number().positive("Valor inválido"),
  slug: z.string().trim().min(3, "Slug muito curto").max(60),
  metodos: z.array(z.string()).min(1, "Selecione ao menos 1 método"),
});

export default function GatewayLinks() {
  const { session } = useAuth();
  const [items, setItems] = useState<Link2[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [slug, setSlug] = useState("");
  const [metodos, setMetodos] = useState<string[]>(["pix", "cartao", "boleto"]);

  const load = async () => {
    if (!session?.user) return;
    const { data } = await supabase
      .from("gateway_links")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setItems((data as any) ?? []);
  };
  useEffect(() => { load(); }, [session?.user?.id]);

  useEffect(() => {
    if (!open) { setNome(""); setDescricao(""); setValor(""); setSlug(""); setMetodos(["pix","cartao","boleto"]); }
  }, [open]);

  useEffect(() => { if (open && nome && !slug) setSlug(slugify(nome)); }, [nome, open]);

  const toggleMetodo = (m: string) =>
    setMetodos((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const submit = async () => {
    const valorNum = Number(valor.replace(",", "."));
    const parsed = schema.safeParse({ nome, valor: valorNum, slug: slugify(slug), metodos });
    if (!parsed.success) {
      toast({ title: "Verifique os dados", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }
    if (!session?.user) return;
    setLoading(true);
    const { error } = await supabase.from("gateway_links").insert({
      user_id: session.user.id,
      slug: parsed.data.slug,
      nome_produto: nome,
      descricao: descricao || null,
      valor: valorNum,
      metodos_aceitos: metodos,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao criar link", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Link criado!" });
    setOpen(false);
    load();
  };

  const toggleAtivo = async (l: Link2) => {
    await supabase.from("gateway_links").update({ ativo: !l.ativo }).eq("id", l.id);
    load();
  };

  const remover = async (id: string) => {
    if (!confirm("Excluir este link?")) return;
    await supabase.from("gateway_links").delete().eq("id", id);
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="font-display text-xl font-bold">Links de pagamento</h1>
          </div>
          <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Criar link</Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        {items.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum link criado ainda.
          </CardContent></Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((l) => {
              const url = `${window.location.origin}/checkout/${l.slug}`;
              return (
                <Card key={l.id}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{l.nome_produto}</h3>
                        {l.descricao && <p className="text-xs text-muted-foreground line-clamp-2">{l.descricao}</p>}
                      </div>
                      <Switch checked={l.ativo} onCheckedChange={() => toggleAtivo(l)} />
                    </div>
                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(Number(l.valor))}</p>
                    <div className="flex gap-1 flex-wrap">
                      {(l.metodos_aceitos as string[]).map((m) => (
                        <span key={m} className="text-[10px] uppercase bg-muted px-2 py-0.5 rounded">{m}</span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                      <span>{l.vendas_count} vendas · {formatCurrency(Number(l.total_arrecadado))}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => { navigator.clipboard.writeText(url); toast({ title: "Link copiado" }); }}>
                        <Copy className="h-3 w-3" /> Copiar
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remover(l.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo link de pagamento</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Nome do produto</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
            <div><Label>Descrição</Label><Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>
            <div><Label>Valor (R$)</Label><Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
              <p className="text-[11px] text-muted-foreground mt-1">{window.location.origin}/checkout/{slug || "..."}</p>
            </div>
            <div>
              <Label>Métodos aceitos</Label>
              <div className="flex gap-4 pt-2">
                {["pix", "cartao", "boleto"].map((m) => (
                  <Label key={m} className="flex items-center gap-2 capitalize">
                    <Checkbox checked={metodos.includes(m)} onCheckedChange={() => toggleMetodo(m)} />
                    {m}
                  </Label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={loading} className="gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
