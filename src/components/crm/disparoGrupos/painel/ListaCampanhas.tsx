// Lista de campanhas (estilo /whats/campaigns do SendFlow): KPIs do período, abas Todas/Ativas/Encerradas,
// filtro por projeto, busca, cartões com métricas e exportação em CSV das métricas.
import { useMemo, useState } from "react";
import { ChevronRight, Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { baixarCsv, nomeCampanha, paraCsv, somarMetricas, type Periodo } from "@/lib/painelGrupos";
import { nomeDoNumero } from "@/lib/disparoGrupos";
import { numeroCriaGrupo } from "@/lib/grupos";
import type { PainelGrupos } from "@/hooks/usePainelGrupos";
import { clsPrimario, KpisGrupos, MiniMetricas, PontoStatus, SeletorPeriodo, seletor } from "./ui";

type Filtro = "todas" | "ativas" | "encerradas";

export function ListaCampanhas({ painel, periodo, onPeriodo, onAbrir, onNova }: {
  painel: PainelGrupos;
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  onAbrir: (id: string) => void;
  onNova: () => void;
}) {
  const { campanhas, numeros, metricas, temPeriodo, carregando } = painel;
  const [filtro, setFiltro] = useState<Filtro>("ativas");
  const [busca, setBusca] = useState("");
  const [projeto, setProjeto] = useState("");
  const projetos = useMemo(() => [...new Set(campanhas.map((c) => c.projeto).filter(Boolean) as string[])].sort(), [campanhas]);

  const visiveis = campanhas.filter((c) =>
    (filtro === "todas" || (filtro === "ativas" ? !c.encerrada : c.encerrada))
    && (!projeto || c.projeto === projeto)
    && `${nomeCampanha(c)} ${c.slug}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const total = somarMetricas(visiveis.map((c) => metricas.get(c.id)!).filter(Boolean));

  function exportar() {
    const linhas = visiveis.map((c) => {
      const m = metricas.get(c.id)!;
      return [nomeCampanha(c), c.slug, c.projeto ?? "", nomeDoNumero(numeros, c.numero_id), c.encerrada ? "encerrada" : "ativa",
        m.cliques, m.entradas, m.pctEntrada, m.saidas, m.participantes, m.grupos, m.cheios, m.disponiveis];
    });
    baixarCsv(`campanhas-grupos-${periodo}d.csv`, paraCsv(
      ["Campanha", "Link", "Projeto", "Número", "Status", "Cliques", "Entraram", "% entrada", "Saíram", "Participantes", "Grupos", "Cheios", "Disponíveis"], linhas,
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold flex-1">Campanhas</h3>
        <SeletorPeriodo valor={periodo} onChange={onPeriodo} />
        <Button variant="outline" onClick={exportar} disabled={!visiveis.length}><Download className="h-4 w-4 mr-1" /> Exportar CSV</Button>
        <Button className={clsPrimario} onClick={onNova}><Plus className="h-4 w-4 mr-1" /> Campanha</Button>
      </div>
      <KpisGrupos m={total} temPeriodo={temPeriodo} periodo={periodo} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {(["todas", "ativas", "encerradas"] as Filtro[]).map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)}
            className={cn("px-3 py-2 text-sm capitalize -mb-px border-b-2", filtro === f ? "border-amber-400 text-foreground font-medium" : "border-transparent text-muted-foreground")}>
            {f === "todas" ? "Campanhas" : f}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar campanha" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select className={seletor} value={projeto} onChange={(e) => setProjeto(e.target.value)} aria-label="Projeto">
          <option value="">Todos os projetos</option>
          {projetos.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {!carregando && !visiveis.length && <p className="text-sm text-muted-foreground">Nenhuma campanha aqui.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visiveis.map((c) => {
          const m = metricas.get(c.id);
          return (
            <button key={c.id} type="button" onClick={() => onAbrir(c.id)} className="text-left rounded-xl border border-border bg-card/60 p-3 hover:border-amber-400/60">
              {m && <MiniMetricas m={m} />}
              <div className="mt-2 flex items-center gap-2">
                <PontoStatus ok={!c.encerrada && !c.link_pausado} />
                <span className="font-medium truncate flex-1">{nomeCampanha(c)}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {c.avulsa ? "grupos importados sem campanha" : `/g/${c.slug}`} · {nomeDoNumero(numeros, c.numero_id)}{c.projeto ? ` · ${c.projeto}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                {c.modo_distribuicao === "split" && <span className="rounded bg-muted px-1.5 py-0.5">split</span>}
                {!c.avulsa && !numeroCriaGrupo(numeros.find((n) => n.id === c.numero_id)?.sessao) && <span className="rounded bg-amber-400/15 text-amber-400 px-1.5 py-0.5">não cria grupos</span>}
                {c.boas_vindas_ligada && <span className="rounded bg-muted px-1.5 py-0.5">boas-vindas</span>}
                {c.encerrada && <span className="rounded bg-muted px-1.5 py-0.5">encerrada</span>}
                {c.link_pausado && !c.avulsa && <span className="rounded bg-amber-400/15 text-amber-400 px-1.5 py-0.5">link pausado</span>}
                {c.disparos_pausados && <span className="rounded bg-amber-400/15 text-amber-400 px-1.5 py-0.5">disparos pausados</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
