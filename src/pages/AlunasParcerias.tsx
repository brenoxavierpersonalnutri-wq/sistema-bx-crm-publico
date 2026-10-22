import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Users, Copy, Check, Plus, ExternalLink,
  Star, CalendarDays, ShoppingBag, Megaphone, FileText,
  ChevronRight, Edit2, Trash2, LayoutGrid,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MicroinfluenciaTab } from "@/components/funnels/MicroinfluenciaTab";
import { linksDaParceria } from "@/lib/linksDeParceria";

interface Influencer {
  id: string;
  name: string;
  instagram: string;
  phone: string;
  email: string;
  status: string;
  feed_post_date: string | null;
  stories_rating: number | null;
  stories_active: boolean | null;
  sales_count: number;
  notes: string;
  created_at: string;
}

const STEPS = ["contato", "proposta", "aceita", "postou", "ativa"] as const;
const STEP_LABELS: Record<string, string> = {
  contato: "Contato",
  proposta: "Proposta",
  aceita: "Aceita",
  postou: "1º Post",
  ativa: "Ativa",
};
const STEP_IDX: Record<string, number> = {
  contato: 0, proposta: 1, aceita: 2, postou: 3, ativa: 4, inativa: -1,
};
const STATUS_COLORS: Record<string, string> = {
  contato: "bg-gray-100 text-gray-700",
  proposta: "bg-blue-100 text-blue-700",
  aceita: "bg-green-100 text-green-700",
  postou: "bg-purple-100 text-purple-700",
  ativa: "bg-emerald-100 text-emerald-700",
  inativa: "bg-red-100 text-red-700",
};

const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS influencers_parceria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  instagram text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'contato',
  feed_post_date date,
  stories_rating int CHECK (stories_rating >= 0 AND stories_rating <= 10),
  stories_active boolean,
  sales_count int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE influencers_parceria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON influencers_parceria FOR ALL TO authenticated
  USING (true) WITH CHECK (true);`;

const emptyForm = {
  name: "", instagram: "", phone: "", email: "", notes: "", status: "contato",
};

// ─── Influencer Card ──────────────────────────────────────────────────────────
function InfluencerCard({
  inf, expanded, onToggle, onEdit, onUpdate, onRemove, copied, onCopy,
}: {
  inf: Influencer;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onUpdate: (field: string, value: unknown) => void;
  onRemove: () => void;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const links = linksDaParceria(inf.instagram);
  const stepIdx = STEP_IDX[inf.status] ?? 0;

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-sm">{inf.name}</p>
            {inf.instagram && (
              <p className="text-xs text-muted-foreground">
                {inf.instagram.startsWith("@") ? inf.instagram : `@${inf.instagram}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Badge className={`text-[10px] px-2 ${STATUS_COLORS[inf.status] ?? "bg-gray-100 text-gray-700"}`}>
              {STEP_LABELS[inf.status] ?? inf.status}
            </Badge>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Kanban stepper — click pra avançar */}
        <div className="flex items-center gap-0.5 flex-wrap">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdate("status", step)}
                className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${
                  idx <= stepIdx
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {STEP_LABELS[step]}
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Toggle monitoramento */}
        <button onClick={onToggle} className="text-[11px] text-primary hover:underline">
          {expanded ? "▲ Ocultar monitoramento" : "▼ Ver monitoramento"}
        </button>

        {expanded && (
          <div className="space-y-3 pt-2 border-t border-border/40">
            {/* Feed post date */}
            <div className="flex items-center gap-3">
              <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Post no feed</span>
              <input
                type="date"
                value={inf.feed_post_date ?? ""}
                onChange={e => onUpdate("feed_post_date", e.target.value || null)}
                className="text-xs border border-border/60 rounded px-2 py-1 bg-background"
              />
            </div>

            {/* Stories rating */}
            <div className="flex items-center gap-3">
              <Star className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Retorno (0–10)</span>
              <div className="flex gap-0.5 flex-wrap">
                {Array.from({ length: 11 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => onUpdate("stories_rating", i)}
                    className={`h-6 w-6 rounded text-[10px] font-semibold transition-colors ${
                      inf.stories_rating === i
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-primary/20"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>

            {/* Sales count */}
            <div className="flex items-center gap-3">
              <ShoppingBag className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Vendas via ela</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate("sales_count", Math.max(0, (inf.sales_count || 0) - 1))}
                  className="h-6 w-6 rounded bg-muted text-sm font-bold hover:bg-muted/80"
                >–</button>
                <span className="text-sm font-semibold w-6 text-center">{inf.sales_count ?? 0}</span>
                <button
                  onClick={() => onUpdate("sales_count", (inf.sales_count || 0) + 1)}
                  className="h-6 w-6 rounded bg-muted text-sm font-bold hover:bg-muted/80"
                >+</button>
              </div>
            </div>

            {/* Stories active */}
            <div className="flex items-center gap-3">
              <Megaphone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Ativa nos Stories?</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => onUpdate("stories_active", true)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    inf.stories_active === true
                      ? "bg-green-100 text-green-700"
                      : "bg-muted text-muted-foreground hover:bg-green-50"
                  }`}
                >Sim</button>
                <button
                  onClick={() => onUpdate("stories_active", false)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    inf.stories_active === false
                      ? "bg-red-100 text-red-700"
                      : "bg-muted text-muted-foreground hover:bg-red-50"
                  }`}
                >Não</button>
              </div>
            </div>

            {inf.notes && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-border/40 pl-2">{inf.notes}</p>
            )}

            <div className="flex justify-end pt-1">
              <Button
                variant="ghost" size="sm"
                className="text-destructive hover:text-destructive text-xs gap-1 h-7"
                onClick={onRemove}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remover
              </Button>
            </div>
          </div>
        )}

        {/* UTM Links */}
        <div className="border-t border-border/40 pt-3 space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Links rastreados
          </p>
          {[
            { label: "Avaliação", url: links.avaliacao, key: `av-${inf.id}` },
            { label: "Individual", url: links.individual, key: `ind-${inf.id}` },
          ].map(({ label, url, key }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">{label}</span>
              <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex-1 truncate min-w-0">{url}</code>
              <button onClick={() => onCopy(url, key)} className="flex-shrink-0 p-0.5">
                {copied === key
                  ? <Check className="h-3.5 w-3.5 text-green-500" />
                  : <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                }
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2 text-xs mt-1"
            onClick={() => onCopy(
              `Oi! Segue seus links rastreados da parceria Breno Xavier 💚\n\n📌 1 chamada nos Stories → Avaliação gratuita:\n${links.avaliacao}\n\n📌 1 chamada nos Stories → Consultoria individual:\n${links.individual}`,
              `ambos-${inf.id}`
            )}
          >
            {copied === `ambos-${inf.id}`
              ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copiado!</>
              : <><Copy className="h-3.5 w-3.5" /> Copiar os 2 links com texto (WhatsApp)</>
            }
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AlunasParcerias() {
  const { toast } = useToast();
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Influencer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("influencers_parceria")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        setTableError(true);
      } else {
        toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      }
    } else {
      setInfluencers(data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setSheetOpen(true);
  };

  const openEdit = (inf: Influencer) => {
    setEditing(inf);
    setForm({
      name: inf.name,
      instagram: inf.instagram || "",
      phone: inf.phone || "",
      email: inf.email || "",
      notes: inf.notes || "",
      status: inf.status,
    });
    setSheetOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      return toast({ title: "Nome obrigatório", variant: "destructive" });
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      instagram: form.instagram.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      notes: form.notes.trim(),
      status: form.status,
    };
    let error: any;
    if (editing) {
      ({ error } = await (supabase as any).from("influencers_parceria").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await (supabase as any).from("influencers_parceria").insert([payload]));
    }
    setSaving(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    setSheetOpen(false);
    load();
  };

  const updateField = async (id: string, field: string, value: unknown) => {
    const { error } = await (supabase as any)
      .from("influencers_parceria")
      .update({ [field]: value })
      .eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setInfluencers(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
    }
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("influencers_parceria").delete().eq("id", id);
    if (!error) setInfluencers(prev => prev.filter(i => i.id !== id));
    else toast({ title: "Erro ao remover", variant: "destructive" });
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/alunas">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Users className="h-5 w-5 text-primary" />
          <span className="font-semibold text-base">Parcerias & Influencers</span>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        {/* Tabela não criada ainda */}
        {tableError && (
          <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm space-y-2">
            <p><strong>Configure o banco antes de usar.</strong> Execute o SQL abaixo no Supabase → SQL Editor:</p>
            <pre className="text-xs bg-amber-100 p-3 rounded overflow-x-auto font-mono">{MIGRATION_SQL}</pre>
          </div>
        )}

        <Tabs defaultValue="influencers">
          <TabsList className="mb-6">
            <TabsTrigger value="influencers" className="gap-2">
              <Users className="h-4 w-4" /> Influencers
            </TabsTrigger>
            <TabsTrigger value="candidaturas" className="gap-2">
              <LayoutGrid className="h-4 w-4" /> Candidaturas
            </TabsTrigger>
            <TabsTrigger value="proposta" className="gap-2">
              <FileText className="h-4 w-4" /> Proposta
            </TabsTrigger>
          </TabsList>

          {/* === INFLUENCERS === */}
          <TabsContent value="influencers">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-foreground/70">
                {influencers.length} influencer{influencers.length !== 1 ? "s" : ""} cadastrada{influencers.length !== 1 ? "s" : ""}
              </h2>
              <Button onClick={openAdd} className="gap-2">
                <Plus className="h-4 w-4" /> Nova influencer
              </Button>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-12">Carregando...</p>
            ) : influencers.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm">Nenhuma influencer cadastrada ainda.</p>
                <Button onClick={openAdd} variant="outline" className="mt-4 gap-2">
                  <Plus className="h-4 w-4" /> Cadastrar primeira influencer
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {influencers.map(inf => (
                  <InfluencerCard
                    key={inf.id}
                    inf={inf}
                    expanded={expandedId === inf.id}
                    onToggle={() => setExpandedId(prev => prev === inf.id ? null : inf.id)}
                    onEdit={() => openEdit(inf)}
                    onUpdate={(field, value) => updateField(inf.id, field, value)}
                    onRemove={() => remove(inf.id)}
                    copied={copied}
                    onCopy={copy}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* === CANDIDATURAS === */}
          <TabsContent value="candidaturas">
            <MicroinfluenciaTab />
          </TabsContent>

          {/* === PROPOSTA === */}
          <TabsContent value="proposta">
            <div className="max-w-lg mx-auto text-center py-16 space-y-4">
              <FileText className="h-12 w-12 mx-auto text-primary opacity-50" />
              <h2 className="text-lg font-semibold">Proposta de Parceria</h2>
              <p className="text-muted-foreground text-sm">
                Página pública com comissão, entregáveis e benefícios. Copie o link e mande pra influencer.
              </p>
              <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                <code className="text-xs bg-muted px-3 py-2 rounded-md">
                  https://equipe.brenoxavier.com.br/proposta-parceria
                </code>
                <Button
                  size="sm" variant="outline"
                  onClick={() => copy("https://equipe.brenoxavier.com.br/proposta-parceria", "proposta")}
                  className="gap-2"
                >
                  {copied === "proposta" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Copiar
                </Button>
                <a href="https://equipe.brenoxavier.com.br/proposta-parceria" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" /> Abrir
                  </Button>
                </a>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* === Sheet: Cadastrar / Editar === */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar influencer" : "Nova influencer"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ana Paula"
                className="mt-1"
              />
            </div>
            <div>
              <Label>@ Instagram *</Label>
              <Input
                value={form.instagram}
                onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
                placeholder="@anapaula"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(31) 9 0000-0000"
                className="mt-1"
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="ana@email.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Status inicial</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contato">Contato feito</SelectItem>
                  <SelectItem value="proposta">Proposta enviada</SelectItem>
                  <SelectItem value="aceita">Parceria aceita</SelectItem>
                  <SelectItem value="postou">1º post no feed</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="inativa">Inativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="mt-1 resize-none"
                rows={3}
                placeholder="Nicho, seguidores, histórico..."
              />
            </div>
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
