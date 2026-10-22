import { useEffect, useMemo, useState } from "react";
import { CalendarArrowUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Consultation } from "@/types/consultation";
import { ReferenciaMetaSinal, SinalBadge } from "@/components/shared/SinalBadge";
import { calcularMetricasConsultas, proximoDiaUtil, rotuloDia, sinalConfirmadas, sinalFeitas } from "@/lib/sinalMetricas";

/**
 * "Fluxo do próximo dia útil": agendadas, confirmadas e feitas de UM dia (o
 * próximo útil em São Paulo), com as mesmas contas dos cards e independente do
 * filtro de datas da página. Recebe TODAS as consultas, não as filtradas.
 */
export function FluxoProximoDiaUtil({ consultations, agora }: { consultations: Consultation[]; agora?: Date }) {
  // Relógio próprio: tela aberta que vira a meia-noite passa pro dia seguinte
  // sem recarregar. `agora` fixo só nos testes.
  const [relogio, setRelogio] = useState(() => agora ?? new Date());
  useEffect(() => {
    if (agora) return;
    const id = window.setInterval(() => setRelogio(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [agora]);

  const dia = proximoDiaUtil(agora ?? relogio);
  const m = useMemo(
    () => calcularMetricasConsultas(consultations.filter((c) => c.date === dia)),
    [consultations, dia],
  );

  return (
    <Card className="shadow-sm" data-bloco="fluxo-proximo-dia-util">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarArrowUp className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">Fluxo do próximo dia útil — {rotuloDia(dia)}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/40 bg-background px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Consultas agendadas</p>
            <p className="text-2xl font-display font-bold mt-1">{m.agendadas}</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-background px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Call confirmadas</p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-2xl font-display font-bold">{m.callConfirmadas}</p>
              <SinalBadge regra="confirmadas" nivel={sinalConfirmadas(m.pctConfirmadasDoTotal)}>
                {m.pctConfirmadasDoTotal ?? 0}% do total
              </SinalBadge>
            </div>
            <ReferenciaMetaSinal regra="confirmadas" className="mt-1.5" />
          </div>
          <div className="rounded-lg border border-border/40 bg-background px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Consultas feitas</p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-2xl font-display font-bold">{m.feitas}</p>
              <SinalBadge regra="feitas" nivel={sinalFeitas(m.pctFeitasSobreAgendadas)}>
                {m.pctFeitasSobreAgendadas ?? 0}% das agendadas
              </SinalBadge>
            </div>
            <ReferenciaMetaSinal regra="feitas" className="mt-1.5" />
            <p className="text-xs text-muted-foreground mt-1">Fica em 0 até o dia acontecer</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
