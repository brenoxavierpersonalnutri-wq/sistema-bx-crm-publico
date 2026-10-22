// Cartão de um agente na tela Agente IA (21/10/2026): avatar com bolinha de status, número, modo de ativação e
// os números do dia. Clicar escolhe o agente (mesmo comportamento dos botões antigos, aria-pressed).
import { ArrowRight, Bot, Hand, MessageSquare, Users } from "lucide-react";
import { formatarTelefone, type NumeroCRM } from "@/lib/crm/central";
import { ehFollowup, modoAtivacao, prontoParaLigar, type AgenteIA } from "@/lib/crm/treinarIA";
import type { MetricasAgente } from "@/lib/crm/metricasAgentes";
import { AvatarCRM } from "@/components/crm/ui/SecaoCRM";

/** Situação curta do agente (o mesmo texto do botão antigo). */
export function rotuloStatusAgente(a: AgenteIA): string {
  if (ehFollowup(a)) return "follow-up · usado nos fluxos";
  const m = modoAtivacao(a);
  if (m === "gatilho") return "ativa pelo gatilho";
  if (a.ativo) return "ligado";
  return prontoParaLigar(a).pronto ? "só transferidas" : "desligado";
}

/** Cor da bolinha: verde atende sozinho, azul só transferidas, violeta follow-up, vermelho desligado. */
export function corStatusAgente(a: AgenteIA): string {
  if (ehFollowup(a)) return "bg-violet-400";
  if (modoAtivacao(a) !== "transferidas") return "bg-success";
  return prontoParaLigar(a).pronto ? "bg-sky-400" : "bg-red-500";
}

const corTexto = (a: AgenteIA) =>
  ehFollowup(a) ? "text-violet-300"
    : modoAtivacao(a) !== "transferidas" ? "text-success"
      : prontoParaLigar(a).pronto ? "text-sky-300" : "text-muted-foreground";

function Metrica({ Icone, valor, rotulo, curto }: { Icone: typeof Bot; valor: number; rotulo: string; curto: string }) {
  return (
    <span className="flex flex-col gap-0.5 rounded-lg bg-secondary px-2 py-1.5" title={rotulo}>
      <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-foreground">
        <Icone className="h-3.5 w-3.5 text-primary" aria-hidden /> {valor}
      </span>
      <span className="text-[11px] leading-tight text-muted-foreground">{curto}</span>
    </span>
  );
}

export function CartaoAgente({ agente, numero, metricas, ativo, onEscolher }: {
  agente: AgenteIA;
  numero: NumeroCRM | null;
  metricas: MetricasAgente | null;
  ativo: boolean;
  onEscolher: () => void;
}) {
  const followup = ehFollowup(agente);
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-pressed={ativo}
      className={`group relative flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 ${
        ativo ? "border-primary ring-1 ring-primary/40" : ""
      }`}
    >
      <span className="flex items-center gap-3">
        <AvatarCRM nome={agente.nome} corStatus={corStatusAgente(agente)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{agente.nome}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {followup ? "entra pelo fluxo" : numero ? `${numero.apelido}${numero.telefone ? ` · ${formatarTelefone(numero.telefone)}` : ""}` : "sem número"}
          </span>
        </span>
        <ArrowRight className={`h-4 w-4 shrink-0 transition-colors ${ativo ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} aria-hidden />
      </span>
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className={`font-medium ${corTexto(agente)}`}>{rotuloStatusAgente(agente)}</span>
      </span>
      {metricas && !followup && (
        <span className="grid grid-cols-4 gap-1.5">
          <Metrica Icone={Bot} valor={metricas.comIA} curto="com a IA" rotulo="conversas com a IA agora" />
          <Metrica Icone={Users} valor={metricas.atendidasHoje} curto="atendidas" rotulo="conversas atendidas hoje" />
          <Metrica Icone={MessageSquare} valor={metricas.respostasHoje} curto="respostas" rotulo="respostas hoje" />
          <Metrica Icone={Hand} valor={metricas.transferidasHoje} curto="p/ humano" rotulo="transferidas para humano hoje" />
        </span>
      )}
    </button>
  );
}
