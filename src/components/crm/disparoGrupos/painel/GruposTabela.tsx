// Aba Grupos do detalhe da campanha (estilo SendFlow): filtros Todos/Cheios/Não cheios, ocupação, cliques,
// participantes, entradas/saídas, permissão do número, copiar link, seleção em massa (marcar cheio/não cheio,
// mover para outra campanha do MESMO número) e exportar CSV. Só mexe em linhas do banco; nada vai ao WhatsApp.
import { useMemo, useState } from "react";
import { Copy, Download, MoveRight, Search, SignalHigh, SignalZero } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { db, ocupacaoPct, permissaoGrupo, type CampanhaGrupos, type GrupoLinha } from "@/lib/grupos";
import { baixarCsv, fmt, nomeCampanha, paraCsv } from "@/lib/painelGrupos";
import { PermissaoBadge } from "../PermissaoBadge";
import { seletor } from "./ui";

type Filtro = "todos" | "cheios" | "abertos" | "inativos";

export function GruposTabela({ campanha, campanhas, grupos, onMudou }: {
  campanha: CampanhaGrupos;
  campanhas: CampanhaGrupos[];
  grupos: GrupoLinha[];
  onMudou: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState("");
  const [salvando, setSalvando] = useState(false);
  const dela = useMemo(() => grupos.filter((g) => g.campanha_id === campanha.id), [grupos, campanha.id]);
  const visiveis = dela.filter((g) =>
    (filtro === "todos" || (filtro === "cheios" ? g.ativo && g.cheio : filtro === "abertos" ? g.ativo && !g.cheio : !g.ativo))
    && (g.nome || g.chat_id || "").toLowerCase().includes(busca.trim().toLowerCase()));
  // mover só para campanha do mesmo número: o disparo sai pelo número da campanha
  const destinos = campanhas.filter((c) => c.id !== campanha.id && c.numero_id === campanha.numero_id && !c.encerrada);
  const todosMarcados = visiveis.length > 0 && visiveis.every((g) => marcados.has(g.id));

  function alternar(id: string) {
    setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function atualizar(campos: Record<string, unknown>, rotulo: string) {
    const ids = [...marcados];
    if (!ids.length) return;
    if (!confirm(`${rotulo} — ${ids.length} grupo(s)?`)) return;
    setSalvando(true);
    const { error } = await db.from("grupos_campanha_grupos").update(campos).in("id", ids).eq("campanha_id", campanha.id);
    setSalvando(false);
    toast({ title: error ? "Não foi possível salvar" : "Grupos atualizados", description: error?.message, variant: error ? "destructive" : undefined });
    if (!error) { setMarcados(new Set()); await onMudou(); }
  }

  function exportar() {
    baixarCsv(`grupos-${campanha.slug}.csv`, paraCsv(
      ["Grupo", "Id (chat)", "Link", "Ativo", "Cheio", "Participantes", "Limite", "Ocupação %", "Cliques", "Entradas", "Saídas", "Permissão do número", "Importado", "Criado em"],
      dela.map((g) => [g.nome, g.chat_id, g.link_convite, g.ativo ? "sim" : "não", g.cheio ? "sim" : "não", g.participantes, campanha.limite_por_grupo,
        ocupacaoPct(g, campanha.limite_por_grupo), g.cliques, g.entradas ?? 0, g.saidas ?? 0, permissaoGrupo(g), g.importado ? "sim" : "não",
        new Date(g.created_at).toLocaleString("pt-BR")]),
    ));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["todos", "abertos", "cheios", "inativos"] as Filtro[]).map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)}
            className={cn("rounded-md border px-3 py-1.5 text-xs", filtro === f ? "border-amber-400 bg-amber-400/10 text-amber-300" : "border-border text-muted-foreground")}>
            {f === "todos" ? `Todos (${dela.length})` : f === "abertos" ? "Não cheios" : f === "cheios" ? "Cheios" : "Inativos"}
          </button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Buscar grupo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!dela.length}><Download className="h-4 w-4 mr-1" /> Exportar grupos</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={todosMarcados} onCheckedChange={(v) => setMarcados(v ? new Set(visiveis.map((g) => g.id)) : new Set())} aria-label="Selecionar tudo" />
          Selecionar tudo ({marcados.size}/{visiveis.length})
        </label>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={!marcados.size || salvando} onClick={() => atualizar({ cheio: true }, "Marcar como cheio")}><SignalHigh className="h-4 w-4 mr-1" /> Marcar como cheio</Button>
        <Button size="sm" variant="ghost" disabled={!marcados.size || salvando} onClick={() => atualizar({ cheio: false }, "Marcar como não cheio")}><SignalZero className="h-4 w-4 mr-1" /> Marcar como não cheio</Button>
        <select className={cn(seletor, "h-8")} value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Mover para campanha">
          <option value="">Mover para…</option>
          {destinos.map((c) => <option key={c.id} value={c.id}>{nomeCampanha(c)}</option>)}
        </select>
        <Button size="sm" variant="ghost" disabled={!marcados.size || !destino || salvando}
          onClick={() => atualizar({ campanha_id: destino }, `Mover para "${nomeCampanha(destinos.find((c) => c.id === destino)!)}"`)}>
          <MoveRight className="h-4 w-4 mr-1" /> Mover
        </Button>
      </div>

      {!visiveis.length && <p className="text-sm text-muted-foreground">Nenhum grupo neste filtro.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {visiveis.map((g) => {
          const oc = ocupacaoPct(g, campanha.limite_por_grupo);
          return (
            <div key={g.id} className={cn("rounded-xl border bg-card/60 p-3", marcados.has(g.id) ? "border-amber-400/70" : "border-border")}>
              <div className="flex items-start gap-2">
                <Checkbox checked={marcados.has(g.id)} onCheckedChange={() => alternar(g.id)} aria-label={`Selecionar ${g.nome}`} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{g.nome || g.chat_id}</span>
                    {!g.ativo && <span className="text-[10px] uppercase text-muted-foreground">inativo</span>}
                    {g.cheio && <span className="rounded bg-muted px-1.5 text-[10px] uppercase">cheio</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{fmt(g.participantes)}/{fmt(campanha.limite_por_grupo)} membros</span>
                    <span>{fmt(g.cliques)} cliques</span>
                    <span className="text-green-500">+{fmt(g.entradas ?? 0)}</span>
                    <span className="text-red-400">-{fmt(g.saidas ?? 0)}</span>
                    {campanha.modo_distribuicao === "split" && <span>peso {g.peso ?? 1}</span>}
                    {g.importado && <span>importado</span>}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded bg-muted overflow-hidden"><div className={cn("h-full", oc >= 100 ? "bg-red-500" : oc >= 80 ? "bg-amber-400" : "bg-green-500")} style={{ width: `${Math.min(100, oc)}%` }} /></div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {g.chat_id && <PermissaoBadge permissao={permissaoGrupo(g)} />}
                  {g.link_convite && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(g.link_convite!); toast({ title: "Link do grupo copiado" }); }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Link
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
