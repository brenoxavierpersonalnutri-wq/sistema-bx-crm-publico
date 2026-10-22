import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Link2, ExternalLink, Users, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Candidatura = {
  id: string;
  created_at: string;
  nome: string;
  idade: number | null;
  cidade: string | null;
  whatsapp: string | null;
  instagram: string | null;
  seguidores: number | null;
  media_stories: number | null;
  media_comentarios: number | null;
  publico_cliente: string | null;
  comunidade: string | null;
  objetivo: string | null;
  motivo_interesse: string | null;
  rede_ativo: number | null;
  interesse_crescer: number | null;
  retorno_financeiro: string | null;
  interesse_formato: string[] | null;
  contribuicao: string | null;
  quer_parceria: number | null;
  observacao: string | null;
  status: string;
  slug: string | null;
  checkin: Record<string, boolean>;
  notas: string | null;
};

const CHECKLIST_ITEMS = [
  { key: "story_avaliacao", label: "Story divulgando link de avaliação" },
  { key: "story_individual", label: "Story divulgando link individual" },
  { key: "post_feed", label: "Post no feed sobre a parceria" },
  { key: "reels", label: "Reels sobre a parceria" },
  { key: "indicacao_confirmada", label: "Trouxe ao menos 1 indicação" },
];

// Site unificado. O antigo novaav nao grava a origem da lead, entao parceira
// que divulgava aquele link sumia do relatorio de Individual.
const LINK_AVALIACAO = "https://equipe.brenoxavier.com.br/avaliacao";
const LINK_INDIVIDUAL = "https://equipe.brenoxavier.com.br/individual";

function buildUtm(base: string, slug: string) {
  const url = new URL(base);
  url.searchParams.set("utm_source", "parceira");
  url.searchParams.set("utm_medium", "instagram");
  url.searchParams.set("utm_campaign", "microinfluencer");
  url.searchParams.set("utm_content", slug);
  return url.toString();
}

const STATUS_OPTS = ["pendente", "aprovada", "recusada", "ativa", "pausada"];

function statusColor(s: string) {
  switch (s) {
    case "aprovada":
    case "ativa":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "recusada":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "pausada":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function copy(text: string, msg = "Copiado") {
  navigator.clipboard.writeText(text).then(() => toast({ title: msg }));
}

export function MicroinfluenciaTab() {
  const [items, setItems] = useState<Candidatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pendente");
  const [search, setSearch] = useState("");

  const formUrl = "https://equipe.brenoxavier.com.br/parceria";

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("candidaturas_parceria" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    } else {
      setItems((data as unknown as Candidatura[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (filter === "pendente" && c.status !== "pendente") return false;
      if (filter === "aprovada" && c.status !== "aprovada" && c.status !== "ativa") return false;
      if (filter === "recusada" && c.status !== "recusada") return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !c.nome?.toLowerCase().includes(s) &&
          !c.instagram?.toLowerCase().includes(s) &&
          !c.cidade?.toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [items, filter, search]);

  const stats = useMemo(() => {
    const total = items.length;
    const pendentes = items.filter((i) => i.status === "pendente").length;
    const aprovadas = items.filter((i) => i.status === "aprovada" || i.status === "ativa").length;
    const recusadas = items.filter((i) => i.status === "recusada").length;
    return { total, pendentes, aprovadas, recusadas };
  }, [items]);

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase
      .from("candidaturas_parceria" as never)
      .update({ status } as never)
      .eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setItems((p) => p.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  async function updateCheckin(id: string, key: string, value: boolean) {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    const next = { ...(target.checkin || {}), [key]: value };
    const { error } = await supabase
      .from("candidaturas_parceria" as never)
      .update({ checkin: next } as never)
      .eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setItems((p) => p.map((i) => (i.id === id ? { ...i, checkin: next } : i)));
  }

  async function updateNotas(id: string, notas: string) {
    const { error } = await supabase
      .from("candidaturas_parceria" as never)
      .update({ notas } as never)
      .eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setItems((p) => p.map((i) => (i.id === id ? { ...i, notas } : i)));
  }

  return (
    <div className="space-y-6">
      {/* Header / Link público */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5" />
            Funil de Microinfluência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Link público do formulário de pré seleção. Compartilhe com candidatas a parceira.
          </p>
          <div className="flex flex-col md:flex-row gap-2">
            <Input readOnly value={formUrl} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => copy(formUrl, "Link copiado")}>
                <Copy className="h-4 w-4 mr-2" />
                Copiar
              </Button>
              <Button variant="outline" asChild>
                <a href={formUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, icon: Users, color: "text-foreground" },
          { label: "Pendentes", value: stats.pendentes, icon: Clock, color: "text-yellow-400" },
          { label: "Aprovadas", value: stats.aprovadas, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Recusadas", value: stats.recusadas, icon: XCircle, color: "text-red-400" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon className={`h-8 w-8 ${s.color} opacity-50`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="space-y-3">
        <Input
          placeholder="Buscar por nome, @ ou cidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="pendente" className="gap-2">
              Pendentes
              <span className="ml-1 bg-yellow-400/20 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {stats.pendentes}
              </span>
            </TabsTrigger>
            <TabsTrigger value="aprovada" className="gap-2">
              Aprovadas
              <span className="ml-1 bg-emerald-400/20 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {stats.aprovadas}
              </span>
            </TabsTrigger>
            <TabsTrigger value="recusada" className="gap-2">
              Recusadas
              <span className="ml-1 bg-red-400/20 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {stats.recusadas}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Nenhuma candidatura ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ParceiraRow
              key={c.id}
              c={c}
              onStatus={(s) => updateStatus(c.id, s)}
              onCheckin={(k, v) => updateCheckin(c.id, k, v)}
              onNotas={(n) => updateNotas(c.id, n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParceiraRow({
  c,
  onStatus,
  onCheckin,
  onNotas,
}: {
  c: Candidatura;
  onStatus: (s: string) => void;
  onCheckin: (k: string, v: boolean) => void;
  onNotas: (n: string) => void;
}) {
  const [notasLocal, setNotasLocal] = useState(c.notas || "");
  const slug = c.slug || c.id.slice(0, 8);
  const linkAv = buildUtm(LINK_AVALIACAO, slug);
  const linkInd = buildUtm(LINK_INDIVIDUAL, slug);
  const checked = Object.values(c.checkin || {}).filter(Boolean).length;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{c.nome}</h3>
              <Badge variant="outline" className={statusColor(c.status)}>{c.status}</Badge>
              {(c.notas || "").includes("interesse=nao") && (
                <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30">
                  disse que não tem interesse
                </Badge>
              )}
              {c.quer_parceria !== null && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                  quer {c.quer_parceria}/10
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {c.instagram} · {c.seguidores?.toLocaleString("pt-BR")} seguidores · {c.cidade}
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={c.status} onValueChange={onStatus}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">Detalhes</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{c.nome} · {c.instagram}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <DetailRow label="WhatsApp" value={c.whatsapp} />
                  <DetailRow label="Idade / Cidade" value={`${c.idade ?? "—"} · ${c.cidade ?? "—"}`} />
                  <DetailRow label="Seguidores" value={c.seguidores?.toLocaleString("pt-BR")} />
                  <DetailRow label="Média stories" value={c.media_stories?.toLocaleString("pt-BR")} />
                  <DetailRow label="Média comentários" value={c.media_comentarios?.toLocaleString("pt-BR")} />
                  <DetailRow label="Público cliente potencial" value={c.publico_cliente} />
                  <DetailRow label="Comunidade fechada" value={c.comunidade} />
                  <DetailRow label="Objetivo com o corpo" value={c.objetivo} />
                  <DetailRow label="Motivo do interesse" value={c.motivo_interesse} />
                  <DetailRow label="Rede como ativo (0-10)" value={c.rede_ativo} />
                  <DetailRow label="Interesse em crescer (0-10)" value={c.interesse_crescer} />
                  <DetailRow label="Retorno financeiro hoje" value={c.retorno_financeiro} />
                  <DetailRow label="Formatos de interesse" value={(c.interesse_formato || []).join(" · ")} />
                  <DetailRow label="Contribuição" value={c.contribuicao} />
                  <DetailRow label="Quer parceria (0-10)" value={c.quer_parceria} />
                  <DetailRow label="Observação" value={c.observacao} />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* UTM links */}
        <div className="pt-2 border-t border-border space-y-2">
          <div className="grid md:grid-cols-2 gap-2">
            <UtmField label="Link de avaliação" url={linkAv} />
            <UtmField label="Link individual" url={linkInd} />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2 text-xs"
            onClick={() => copy(
              `Oi! Segue seus links rastreados da parceria Breno Xavier 💚\n\n📌 1 chamada nos Stories → Avaliação gratuita:\n${linkAv}\n\n📌 1 chamada nos Stories → Consultoria individual:\n${linkInd}`,
              "Os 2 links copiados com texto!"
            )}
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar os 2 links com texto (para enviar pra parceira)
          </Button>
        </div>

        {/* Checklist */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Check-in de conteúdo · {checked}/{CHECKLIST_ITEMS.length}
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {CHECKLIST_ITEMS.map((item) => (
              <label key={item.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={!!c.checkin?.[item.key]}
                  onCheckedChange={(v) => onCheckin(item.key, !!v)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div className="pt-2 border-t border-border">
          <Textarea
            placeholder="Notas internas sobre essa parceira..."
            value={notasLocal}
            onChange={(e) => setNotasLocal(e.target.value)}
            onBlur={() => notasLocal !== (c.notas || "") && onNotas(notasLocal)}
            rows={2}
            className="text-sm"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function UtmField({ label, url }: { label: string; url: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-1">
        <Input readOnly value={url} className="font-mono text-[10px] h-8" />
        <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => copy(url, "UTM copiado")}>
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
