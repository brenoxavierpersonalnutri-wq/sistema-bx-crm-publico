// Topo da Central: totais do dia, próximos disparos agendados e alertas.
import { AlertTriangle, CalendarClock, CheckCheck, PauseCircle, Send, XCircle } from "lucide-react";
import type { DadosCentral } from "@/hooks/useCentralAutomacao";
import { donoDoRegistro } from "@/lib/crm/central";

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function VisaoGeral({ dados, onAbrirNumero }: { dados: DadosCentral; onAbrirNumero: (id: string) => void }) {
  const { resumo, agendados, alertas, numeros } = dados;
  const nomeNumero = (id: string | null) => numeros.find((n) => n.id === id)?.apelido ?? "padrão";
  const nomeOrigem = (a: DadosCentral["agendados"][number]) => {
    if (a.automacao_id) return dados.automacoes.find((x) => x.id === a.automacao_id)?.nome ?? "automação";
    if (a.campanha_id) return dados.campanhas.find((x) => x.id === a.campanha_id)?.nome ?? "campanha";
    if (a.fluxo_id) return dados.fluxos.find((x) => x.id === a.fluxo_id)?.nome ?? "fluxo";
    return a.origem;
  };
  const campanhasAtivas = dados.campanhas.filter((c) => c.status === "ativa");

  const totais = [
    { rotulo: "Enviados hoje", valor: resumo.enviados, Icone: Send },
    { rotulo: "Responderam", valor: resumo.respondidos, Icone: CheckCheck },
    { rotulo: "Falhas", valor: resumo.falhas, Icone: XCircle },
    { rotulo: "Pausas automáticas", valor: resumo.pausas, Icone: PauseCircle },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="grid grid-cols-2 gap-3 lg:col-span-1">
        {totais.map(({ rotulo, valor, Icone }) => (
          <div key={rotulo} className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icone className="h-3.5 w-3.5" />{rotulo}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium"><CalendarClock className="h-4 w-4" /> Próximos disparos</div>
        {agendados.length === 0 && campanhasAtivas.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nada agendado na fila.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm max-h-40 overflow-y-auto">
            {campanhasAtivas.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="truncate">Campanha "{c.nome}" enviando</span>
                <span className="text-muted-foreground shrink-0">{nomeNumero(donoDoRegistro(c.numero_id, numeros))}</span>
              </li>
            ))}
            {agendados.slice(0, 8).map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span className="truncate">{fmtHora(a.agendado_para)} · {nomeOrigem(a)} · …{a.contact_phone.slice(-4)}</span>
                <span className="text-muted-foreground shrink-0">{nomeNumero(donoDoRegistro(a.numero_id, numeros))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="h-4 w-4" /> Alertas</div>
        {alertas.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum alerta.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm max-h-40 overflow-y-auto">
            {alertas.map((a, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={!a.numeroId}
                  onClick={() => a.numeroId && onAbrirNumero(a.numeroId)}
                  className={`text-left ${a.nivel === "erro" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"} ${a.numeroId ? "hover:underline" : ""}`}
                >
                  {a.texto}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
