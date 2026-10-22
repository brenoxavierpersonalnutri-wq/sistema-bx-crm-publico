// Calendário das mensagens de grupo (mês), como a aba Calendário do SendFlow. Só leitura.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { db, type CampanhaGrupos, type MensagemAgendada } from "@/lib/grupos";
import { chaveDia, gradeDoMes, nomeCampanha, porDia } from "@/lib/painelGrupos";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const COR: Record<MensagemAgendada["status"], string> = {
  agendada: "bg-amber-400/20 text-amber-300", enviando: "bg-sky-500/20 text-sky-300", concluida: "bg-green-500/20 text-green-300",
  cancelada: "bg-muted text-muted-foreground line-through", erro: "bg-red-500/20 text-red-300",
};

export function CalendarioMensagens({ campanhas, campanhaId }: { campanhas: CampanhaGrupos[]; campanhaId?: string }) {
  const hoje = new Date();
  const [mes, setMes] = useState({ ano: hoje.getFullYear(), mes: hoje.getMonth() });
  const [lista, setLista] = useState<MensagemAgendada[]>([]);
  const grade = useMemo(() => gradeDoMes(mes.ano, mes.mes), [mes]);

  const carregar = useCallback(async () => {
    const de = grade[0].toISOString();
    const ate = new Date(grade[41].getFullYear(), grade[41].getMonth(), grade[41].getDate() + 1).toISOString();
    let q = db.from("grupos_mensagens").select("id, campanha_id, agendado_para, tipo, texto, status, relativo_evento, offset_min, total_grupos, enviados, falhas")
      .gte("agendado_para", de).lt("agendado_para", ate).order("agendado_para").limit(1000);
    if (campanhaId) q = q.eq("campanha_id", campanhaId);
    const { data } = await q;
    setLista((data ?? []) as MensagemAgendada[]);
  }, [grade, campanhaId]);
  useEffect(() => { carregar(); }, [carregar]);

  const dias = useMemo(() => porDia(lista), [lista]);
  const nomeDe = (id: string) => { const c = campanhas.find((x) => x.id === id); return c ? nomeCampanha(c) : ""; };
  const mover = (d: number) => setMes((m) => { const x = new Date(m.ano, m.mes + d, 1); return { ano: x.getFullYear(), mes: x.getMonth() }; });
  const tituloBruto = new Date(mes.ano, mes.mes, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const titulo = tituloBruto.charAt(0).toUpperCase() + tituloBruto.slice(1);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => mover(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
        <p className="font-semibold min-w-[160px] text-center">{titulo}</p>
        <Button size="icon" variant="ghost" onClick={() => mover(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setMes({ ano: hoje.getFullYear(), mes: hoje.getMonth() })}>Hoje</Button>
      </div>
      <div className="grid grid-cols-7 gap-px rounded-lg border border-border bg-border overflow-hidden text-xs">
        {SEMANA.map((s) => <div key={s} className="bg-card px-2 py-1 text-muted-foreground">{s}.</div>)}
        {grade.map((d) => {
          const k = chaveDia(d);
          const doDia = dias.get(k) ?? [];
          const fora = d.getMonth() !== mes.mes;
          return (
            <div key={k} className={cn("bg-background min-h-[88px] p-1 space-y-0.5", fora && "opacity-40")}>
              <div className={cn("text-right", k === chaveDia(hoje) && "text-amber-400 font-bold")}>{d.getDate()}</div>
              {doDia.slice(0, 3).map((m) => (
                <div key={m.id} className={cn("truncate rounded px-1", COR[m.status])} title={`${nomeDe(m.campanha_id)} — ${m.texto ?? m.tipo}`}>
                  {new Date(m.agendado_para).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {m.texto?.slice(0, 30) || m.tipo}
                </div>
              ))}
              {doDia.length > 3 && <div className="text-muted-foreground">+{doDia.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
