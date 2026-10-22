// Peças visuais do painel "Disparo em grupo" (estilo SendFlow, no tema escuro do CRM, acento amarelo nas ações principais).
import type { ReactNode } from "react";
import { Hourglass, MousePointerClick, LogIn, LogOut, Percent, Users, UsersRound, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, PERIODOS, type MetricasCampanha, type Periodo } from "@/lib/painelGrupos";

/** Botão de ação principal (amarelo). */
export const clsPrimario = "bg-amber-400 text-black hover:bg-amber-300 font-semibold";
export const clsCartao = "rounded-xl border border-border bg-card/60";
export const seletor = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function Cartao({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(clsCartao, "p-4", className)}>{children}</div>;
}

export function Kpi({ icone, valor, rotulo, sub }: { icone: ReactNode; valor: ReactNode; rotulo: string; sub?: ReactNode }) {
  return (
    <div className={cn(clsCartao, "flex items-start gap-3 p-3")}>
      <span className="mt-0.5 text-amber-400">{icone}</span>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-tight">{valor}</div>
        <div className="text-xs text-muted-foreground">{rotulo}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

/** Os 8 indicadores do SendFlow: cliques, entraram, % de entrada, saíram, participantes, grupos, cheios, disponíveis. */
export function KpisGrupos({ m, temPeriodo, periodo }: { m: MetricasCampanha; temPeriodo: boolean; periodo: Periodo }) {
  const sufixo = temPeriodo ? `${periodo} dias` : "total";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icone={<MousePointerClick className="h-5 w-5" />} valor={fmt(m.cliques)} rotulo="Cliques" sub={sufixo} />
        <Kpi icone={<LogIn className="h-5 w-5" />} valor={fmt(m.entradas)} rotulo="Entraram" sub={sufixo} />
        <Kpi icone={<Percent className="h-5 w-5" />} valor={m.pctEntrada.toLocaleString("pt-BR")} rotulo="Percentual de entrada" />
        <Kpi icone={<LogOut className="h-5 w-5" />} valor={fmt(m.saidas)} rotulo="Saíram" sub={sufixo} />
        <Kpi icone={<Users className="h-5 w-5" />} valor={fmt(m.participantes)} rotulo="Participantes" sub="total atual" />
        <Kpi icone={<UsersRound className="h-5 w-5" />} valor={fmt(m.grupos)} rotulo="Grupos" sub={`${fmt(m.vagas)} vagas livres`} />
        <Kpi icone={<CheckSquare className="h-5 w-5" />} valor={fmt(m.cheios)} rotulo="Grupos cheios" />
        <Kpi icone={<Square className="h-5 w-5" />} valor={fmt(m.disponiveis)} rotulo="Grupos disponíveis" />
      </div>
      {!temPeriodo && (
        <p className="text-xs text-muted-foreground">
          Mostrando totais desde o início. Para filtrar por período, rode a migração <code>20261110100000_grupos_painel_sendflow.sql</code>.
        </p>
      )}
    </div>
  );
}

export function SeletorPeriodo({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Período">
      {PERIODOS.map((p) => (
        <button
          key={p} type="button" onClick={() => onChange(p)} aria-pressed={valor === p}
          className={cn("rounded px-2.5 py-1 text-xs", valor === p ? "bg-amber-400 text-black font-semibold" : "text-muted-foreground hover:text-foreground")}
        >{p} dias</button>
      ))}
    </div>
  );
}

/** Métricas compactas do cartão de campanha (cliques · entradas · % · grupos). */
export function MiniMetricas({ m }: { m: MetricasCampanha }) {
  const item = (icone: ReactNode, v: ReactNode, titulo: string) => (
    <span className="inline-flex items-center gap-1" title={titulo}>{icone}{v}</span>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {item(<MousePointerClick className="h-3.5 w-3.5" />, fmt(m.cliques), "Cliques")}
      {item(<LogIn className="h-3.5 w-3.5" />, fmt(m.entradas), "Entradas")}
      {item(<Percent className="h-3.5 w-3.5" />, m.pctEntrada.toLocaleString("pt-BR"), "Percentual de entrada")}
      {item(<UsersRound className="h-3.5 w-3.5" />, fmt(m.grupos), "Grupos")}
      {item(<Users className="h-3.5 w-3.5" />, fmt(m.participantes), "Membros")}
    </div>
  );
}

/** Função do SendFlow que ainda não tem motor aqui: a tela existe e diz o que falta. */
export function EmBreve({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className={cn(clsCartao, "p-4 border-dashed")}>
      <div className="flex items-center gap-2">
        <Hourglass className="h-4 w-4 text-amber-400" />
        <p className="font-medium">{titulo}</p>
        <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">em breve</span>
      </div>
      <div className="mt-2 text-sm text-muted-foreground space-y-1">{children}</div>
    </div>
  );
}

export function PontoStatus({ ok }: { ok: boolean | undefined }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", ok === true ? "bg-green-500" : ok === false ? "bg-red-500" : "bg-muted-foreground/50")}
      title={ok === true ? "Conectado" : ok === false ? "Desconectado" : "Status desconhecido"}
    />
  );
}
