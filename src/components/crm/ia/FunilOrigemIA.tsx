// Cartão "Origem IA WhatsApp": leads → qualificados → agendados → compareceu, da IA separada das outras origens.
// Com `desde` usa o período de quem chama (Dashboard do CRM); sem, tem seletor próprio (Monitoramento das Consultas).
import { useMemo, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { useFunilOrigemIA } from "@/hooks/useFunilOrigemIA";
import { ETAPAS_ORIGEM, ROTULO_IA_WHATSAPP, taxaEtapa, type EtapasOrigem } from "@/lib/crm/origemIA";

const PERIODOS_PROPRIOS = [
  { id: 7, rotulo: "7 dias" },
  { id: 30, rotulo: "30 dias" },
  { id: 90, rotulo: "90 dias" },
];

const num = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR"));

function Coluna({ titulo, etapas, destaque }: { titulo: string; etapas: EtapasOrigem | undefined; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-green-500/50 bg-green-500/5" : ""}`}>
      <p className={`text-xs font-semibold mb-2 ${destaque ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{titulo}</p>
      <ul className="space-y-1.5">
        {ETAPAS_ORIGEM.map((e, i) => {
          const v = etapas ? etapas[e.id] : null;
          const ant = i > 0 && etapas ? etapas[ETAPAS_ORIGEM[i - 1].id] : null;
          return (
            <li key={e.id} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{e.rotulo}</span>
              <span className="tabular-nums font-semibold">
                {num(v)}
                {i > 0 && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{taxaEtapa(v, ant)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FunilOrigemIA({ desde }: { desde?: string }) {
  const [dias, setDias] = useState(30);
  const inicio = useMemo(() => desde ?? new Date(Date.now() - dias * 86_400_000).toISOString(), [desde, dias]);
  const { dados, carregando } = useFunilOrigemIA(inicio);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm" aria-label="Funil por origem IA WhatsApp">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-green-600" /> Origem {ROTULO_IA_WHATSAPP} × outras
          {carregando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </h3>
        {!desde && (
          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Período do funil por origem">
            {PERIODOS_PROPRIOS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={dias === p.id}
                onClick={() => setDias(p.id)}
                className={`h-7 px-2.5 rounded-md text-xs ${dias === p.id ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Coluna titulo={ROTULO_IA_WHATSAPP} etapas={dados?.ia} destaque />
        <Coluna titulo="Outras origens" etapas={dados?.outras} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        IA WhatsApp = link de agendamento mandado pelo agente (utm_source=whatsapp, utm_medium=ia). Leads e qualificados vêm do formulário; agendados e compareceu, das consultas criadas no período.
      </p>
    </section>
  );
}
