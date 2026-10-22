// Visão geral do "Disparo em grupo" — o "Mapa Contas × Campanhas" do SendFlow: KPIs do período e três
// colunas (Números, Campanhas e O que precisa de atenção). Só leitura; cada cartão leva ao detalhe.
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, PlusCircle, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { alertasSaude, nomeCampanha, somarMetricas, type Periodo } from "@/lib/painelGrupos";
import type { PainelGrupos } from "@/hooks/usePainelGrupos";
import { clsCartao, clsPrimario, KpisGrupos, MiniMetricas, PontoStatus, SeletorPeriodo } from "./ui";

export function VisaoGeralGrupos({ painel, periodo, onPeriodo, onAbrirCampanha, onNovaCampanha, onIr }: {
  painel: PainelGrupos;
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  onAbrirCampanha: (id: string) => void;
  onNovaCampanha: () => void;
  onIr: (aba: string, extra?: Record<string, string>) => void;
}) {
  const { campanhas, numeros, grupos, metricas, status, conectado, comErro, temPeriodo } = painel;
  const [buscaNum, setBuscaNum] = useState("");
  const [buscaCamp, setBuscaCamp] = useState("");
  const ativas = campanhas.filter((c) => !c.encerrada);
  const total = useMemo(() => somarMetricas(ativas.map((c) => metricas.get(c.id)!).filter(Boolean)), [ativas, metricas]);
  const alertas = useMemo(
    () => alertasSaude({ campanhas, grupos, numeros, conectado, mensagensComErro: comErro }),
    [campanhas, grupos, numeros, conectado, comErro],
  );
  const conectados = numeros.filter((n) => conectado[n.id] === true).length;
  const numFiltrados = numeros.filter((n) => n.rotulo.toLowerCase().includes(buscaNum.trim().toLowerCase()));
  const campFiltradas = ativas.filter((c) => nomeCampanha(c).toLowerCase().includes(buscaCamp.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <div className={cn(clsCartao, "flex flex-wrap items-center gap-3 p-4")}>
        <Sparkles className="h-5 w-5 text-amber-400" />
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold">Mapa Números × Campanhas</p>
          <p className="text-xs text-muted-foreground">
            {alertas.length ? `${alertas.length} ponto(s) de atenção` : "Todas as associações estão em ordem"} · {conectados}/{numeros.length} números conectados · {ativas.length} campanhas ativas
          </p>
        </div>
        <SeletorPeriodo valor={periodo} onChange={onPeriodo} />
      </div>

      <KpisGrupos m={total} temPeriodo={temPeriodo} periodo={periodo} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Números */}
        <section className={cn(clsCartao, "p-3 space-y-2")} aria-label="Números">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold flex-1">Números <span className="text-muted-foreground font-normal">{numeros.length}</span></h3>
            <Button size="icon" variant="ghost" title="Conectar número (Conexões)" onClick={() => { window.location.href = "/crm/conexoes"; }}>
              <PlusCircle className="h-5 w-5 text-amber-400" />
            </Button>
          </div>
          <Input placeholder="Buscar" value={buscaNum} onChange={(e) => setBuscaNum(e.target.value)} className="h-8" />
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {!numeros.length && <p className="text-sm text-muted-foreground">Nenhum número do OpenWA ativo.</p>}
            {numFiltrados.map((n) => {
              const dele = campanhas.filter((c) => c.numero_id === n.id && !c.encerrada);
              const qtdGrupos = grupos.filter((g) => dele.some((c) => c.id === g.campanha_id)).length;
              return (
                <div key={n.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{n.rotulo}</span>
                      <PontoStatus ok={conectado[n.id]} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {status[n.id]?.rotulo ?? "verificando…"} · {dele.length} campanha(s) · {qtdGrupos} grupo(s)
                      {n.sessao === "grupos-1" && " · cria grupos"}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" title="Disparar por este número" onClick={() => onIr("disparos", { numero: n.id })}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Campanhas */}
        <section className={cn(clsCartao, "p-3 space-y-2")} aria-label="Campanhas">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold flex-1">Campanhas <span className="text-muted-foreground font-normal">{ativas.length}</span></h3>
            <Button size="icon" variant="ghost" title="Nova campanha" onClick={onNovaCampanha}><PlusCircle className="h-5 w-5 text-amber-400" /></Button>
          </div>
          <Input placeholder="Buscar" value={buscaCamp} onChange={(e) => setBuscaCamp(e.target.value)} className="h-8" />
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {!ativas.length && <p className="text-sm text-muted-foreground">Nenhuma campanha ativa.</p>}
            {campFiltradas.map((c) => {
              const m = metricas.get(c.id);
              const ok = !alertas.some((a) => a.campanhaId === c.id && a.gravidade === "alta");
              return (
                <button key={c.id} type="button" onClick={() => onAbrirCampanha(c.id)} className="w-full text-left rounded-lg border border-border p-3 hover:border-amber-400/60">
                  {m && <MiniMetricas m={m} />}
                  <div className="mt-1.5 flex items-center gap-2">
                    <PontoStatus ok={ok} />
                    <span className="font-medium truncate flex-1">{nomeCampanha(c)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.avulsa ? "grupos importados sem campanha" : `/g/${c.slug}`}{c.projeto ? ` · ${c.projeto}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Atenção */}
        <section className={cn(clsCartao, "p-3 space-y-2")} aria-label="O que precisa de atenção">
          <h3 className="font-semibold">O que precisa de atenção <span className="text-muted-foreground font-normal">{alertas.length}</span></h3>
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {!alertas.length && <p className="text-sm text-muted-foreground">Nada pendente. Números, links e grupos em ordem.</p>}
            {alertas.map((a) => (
              <div key={a.chave} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", a.gravidade === "alta" ? "text-red-500" : "text-amber-400")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.titulo}</p>
                    <p className="text-xs text-muted-foreground">{a.detalhe}</p>
                  </div>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", a.gravidade === "alta" ? "bg-red-500/15 text-red-400" : "bg-amber-400/15 text-amber-400")}>
                    {a.gravidade === "alta" ? "alta" : "média"}
                  </span>
                </div>
                {a.campanhaId && (
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => onAbrirCampanha(a.campanhaId!)}>Ver campanha</Button>
                )}
              </div>
            ))}
          </div>
          <Button className={cn("w-full", clsPrimario)} onClick={() => onIr("disparos")}>Enviar mensagem para grupos</Button>
        </section>
      </div>
    </div>
  );
}
