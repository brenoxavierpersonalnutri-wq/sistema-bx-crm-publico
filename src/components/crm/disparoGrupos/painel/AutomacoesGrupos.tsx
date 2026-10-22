// Automações de grupo (estilo /whats/automations do SendFlow): os gatilhos que já rodam aqui (entrou no grupo →
// boas-vindas, grupo enchendo → cria o próximo, data do evento → mensagens relativas) campanha por campanha,
// e os gatilhos do SendFlow que ainda não têm motor (em breve). A edição continua na aba Automações da campanha.
import { useEffect, useState } from "react";
import { CalendarClock, ChevronRight, Hand, UserPlus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db, rotuloRelativo, type CampanhaGrupos } from "@/lib/grupos";
import { nomeCampanha } from "@/lib/painelGrupos";
import { EmBreve } from "./ui";

interface Relativa { campanha_id: string; offset_min: number | null; status: string; agendado_para: string }

export function AutomacoesGrupos({ campanhas, onAbrir }: { campanhas: CampanhaGrupos[]; onAbrir: (id: string, sub: string) => void }) {
  const [relativas, setRelativas] = useState<Relativa[]>([]);
  useEffect(() => {
    db.from("grupos_mensagens").select("campanha_id, offset_min, status, agendado_para").eq("relativo_evento", true)
      .order("agendado_para").limit(1000).then(({ data }: { data: Relativa[] | null }) => setRelativas(data ?? []));
  }, []);
  const ativas = campanhas.filter((c) => !c.encerrada && !c.avulsa);
  const linha = (icone: JSX.Element, titulo: string, gatilho: string, ligado: boolean, detalhe: string, c: CampanhaGrupos, sub: string) => (
    <div key={`${c.id}-${titulo}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <span className="text-amber-400">{icone}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{nomeCampanha(c)} → {titulo}</p>
        <p className="text-xs text-muted-foreground">Acionar ao: {gatilho} · {detalhe}</p>
      </div>
      <span className={ligado ? "text-xs text-green-500" : "text-xs text-muted-foreground"}>{ligado ? "Ativado" : "Desativado"}</span>
      <Button size="icon" variant="ghost" title="Configurar" onClick={() => onAbrir(c.id, sub)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold">Automações</h3>
        <p className="text-sm text-muted-foreground">Gatilhos de cada campanha ativa. Para editar, abra a campanha.</p>
      </div>
      {!ativas.length && <p className="text-sm text-muted-foreground">Nenhuma campanha ativa.</p>}
      <div className="space-y-2">
        {ativas.flatMap((c) => {
          const dela = relativas.filter((r) => r.campanha_id === c.id);
          const pendentes = dela.filter((r) => r.status === "agendada");
          const proxima = pendentes[0];
          return [
            linha(<UserPlus className="h-5 w-5" />, "Boas-vindas", "Participante entrar no grupo", Boolean(c.boas_vindas_ligada),
              c.boas_vindas_mencionar ? "marca quem entrou" : "sem marcar", c, "automacoes"),
            linha(<Layers className="h-5 w-5" />, "Criar o próximo grupo", "Lotou (ou quase), cria grupo — sempre ligado", !c.avulsa,
              `folga de ${c.folga_vagas ?? 30} vagas, até ${c.max_grupos ?? 20} grupos`, c, "criacao"),
            linha(<CalendarClock className="h-5 w-5" />, "Mensagens do evento", "Cronograma relativo à data do evento", Boolean(c.data_evento && pendentes.length),
              c.data_evento
                ? `${dela.length} mensagem(ns), ${pendentes.length} pendente(s)${proxima?.offset_min != null ? ` · próxima: ${rotuloRelativo(proxima.offset_min)}` : ""}`
                : "sem data do evento", c, "automacoes"),
          ];
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <EmBreve titulo="Cronograma recorrente (toda semana / mês)"><p>Ex.: “domingo 20:00 → mensagem”, com início, fim e fuso. Precisa de um agendador recorrente no disparador.</p></EmBreve>
        <EmBreve titulo="Participante sair do grupo / tag condicional"><p>Pôr ou tirar tag, mandar para outra campanha. Os eventos de saída já chegam; falta a ação.</p></EmBreve>
        <EmBreve titulo="Compartilhamento entre grupos"><p>Replicar o que é postado num grupo de origem para os grupos de outras campanhas.</p></EmBreve>
        <EmBreve titulo="Gatilhos de integração (Hotmart, Kiwify, API…)"><p>Compra aprovada → entra no grupo VIP; reembolso → sai. O CRM já recebe esses webhooks em Automação; falta a ponte com grupos.</p></EmBreve>
      </div>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><Hand className="h-3.5 w-3.5" /> Tudo que sai para o WhatsApp passa pelo disparador, com os mesmos limites (6/min, 200/dia, 8 s) e só para grupos da allowlist.</p>
    </div>
  );
}
