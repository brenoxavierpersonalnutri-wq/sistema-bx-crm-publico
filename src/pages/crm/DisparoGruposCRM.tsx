// /crm/disparo-grupos — "Disparo em grupo": toda a parte de grupos de WhatsApp, no desenho do SendFlow.
// Seções: Visão geral (Mapa Números × Campanhas) · Campanhas (lista e detalhe com abas) · Enviar mensagem ·
// Ações (todas as mensagens, por status) · Calendário · Automações · Leads · Deep links · Histórico · Segurança.
// Envio real sai pelo disparador que já existe (grupos-disparo-tick), nunca direto desta tela.
// Endereços antigos (?aba=criacao|config|membros) abrem a campanha na aba equivalente.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3, CalendarDays, FolderKanban, History, Link2, Loader2, Megaphone, Send, ShieldAlert, ShieldCheck, Users, Workflow, ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePainelGrupos } from "@/hooks/usePainelGrupos";
import { PERIODOS, type Periodo } from "@/lib/painelGrupos";
import { AbaDisparos } from "@/components/crm/disparoGrupos/AbaDisparos";
import { CampanhaConfig } from "@/components/crm/grupos/CampanhaConfig";
import { VisaoGeralGrupos } from "@/components/crm/disparoGrupos/painel/VisaoGeralGrupos";
import { ListaCampanhas } from "@/components/crm/disparoGrupos/painel/ListaCampanhas";
import { DetalheCampanha, SUBABAS, type SubAba } from "@/components/crm/disparoGrupos/painel/DetalheCampanha";
import { MensagensLista } from "@/components/crm/disparoGrupos/painel/MensagensLista";
import { CalendarioMensagens } from "@/components/crm/disparoGrupos/painel/CalendarioMensagens";
import { AutomacoesGrupos } from "@/components/crm/disparoGrupos/painel/AutomacoesGrupos";
import { DeepLinksGrupos, HistoricoGrupos, LeadsGrupos, SegurancaGrupos } from "@/components/crm/disparoGrupos/painel/PaginasApoio";

const SECOES = [
  { id: "visao", rotulo: "Visão geral", Icone: BarChart3 },
  { id: "campanhas", rotulo: "Campanhas", Icone: FolderKanban },
  { id: "disparos", rotulo: "Enviar mensagem", Icone: Send },
  { id: "acoes", rotulo: "Ações", Icone: ListChecks },
  { id: "calendario", rotulo: "Calendário", Icone: CalendarDays },
  { id: "automacoes", rotulo: "Automações", Icone: Workflow },
  { id: "leads", rotulo: "Leads", Icone: Users },
  { id: "deeplinks", rotulo: "Deep links", Icone: Link2 },
  { id: "historico", rotulo: "Histórico", Icone: History },
  { id: "seguranca", rotulo: "Segurança", Icone: ShieldCheck },
] as const;
type Secao = typeof SECOES[number]["id"] | "nova";
// abas da versão anterior -> aba do detalhe da campanha
const LEGADO: Record<string, SubAba> = { criacao: "criacao", config: "config", membros: "atividades" };

export default function DisparoGruposCRM() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") ?? "visao";
  const legado = LEGADO[abaUrl];
  const secao: Secao = legado ? "campanhas" : abaUrl === "nova" || SECOES.some((s) => s.id === abaUrl) ? abaUrl as Secao : "visao";
  const subUrl = params.get("sub") ?? legado ?? "visao";
  const sub: SubAba = (SUBABAS.map(([k]) => k) as string[]).includes(subUrl) ? subUrl as SubAba : "visao";
  const campanhaId = params.get("campanha");
  const [periodo, setPeriodoEstado] = useState<Periodo>(() => {
    const p = Number(params.get("periodo"));
    return (PERIODOS as readonly number[]).includes(p) ? p as Periodo : 7;
  });
  const painel = usePainelGrupos(periodo);
  const atual = useMemo(() => painel.campanhas.find((c) => c.id === campanhaId) ?? null, [painel.campanhas, campanhaId]);

  function ir(aba: string, extra: Record<string, string | null> = {}) {
    const p = new URLSearchParams();
    p.set("aba", aba);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    if (periodo !== 7) p.set("periodo", String(periodo));
    setParams(p, { replace: false });
  }
  const setPeriodo = (p: Periodo) => { setPeriodoEstado(p); const n = new URLSearchParams(params); n.set("periodo", String(p)); setParams(n, { replace: true }); };
  const abrirCampanha = (id: string, s: string = "visao") => ir("campanhas", { campanha: id, sub: s });

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Megaphone className="h-6 w-6 text-amber-400" /> Disparo em grupo</h2>
          <p className="text-muted-foreground text-sm">
            Campanhas com link que distribui entre grupos, criação e configuração dos grupos, mensagens agendadas, automações e métricas.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="note">
        <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
        <p>
          Disparo em massa pode <b>banir o número</b>. Use um <b>número dedicado</b> a grupos, nunca o pessoal. O envio sai grupo a grupo
          (até 6/min, 200/dia, 8 s entre envios) e o proxy só aceita grupos cadastrados aqui.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Seções do disparo em grupo" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {SECOES.map(({ id, rotulo, Icone }) => (
            <button key={id} type="button" onClick={() => ir(id)} aria-current={secao === id ? "page" : undefined}
              className={cn("flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-left",
                secao === id ? "bg-amber-400/15 text-amber-300 font-medium border-l-2 border-amber-400" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
              <Icone className="h-4 w-4" /> {rotulo}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {painel.carregando && <Loader2 className="h-4 w-4 animate-spin" />}
          {painel.erro && <p className="text-sm text-destructive">Erro ao carregar campanhas: {painel.erro}</p>}

          {secao === "visao" && (
            <VisaoGeralGrupos painel={painel} periodo={periodo} onPeriodo={setPeriodo} onAbrirCampanha={(id) => abrirCampanha(id)}
              onNovaCampanha={() => ir("nova")} onIr={(a, extra) => ir(a, extra)} />
          )}
          {secao === "campanhas" && !campanhaId && (
            <ListaCampanhas painel={painel} periodo={periodo} onPeriodo={setPeriodo} onAbrir={(id) => abrirCampanha(id)} onNova={() => ir("nova")} />
          )}
          {secao === "campanhas" && campanhaId && !atual && !painel.carregando && <p className="text-sm text-muted-foreground">Campanha não encontrada.</p>}
          {secao === "campanhas" && atual && (
            <DetalheCampanha
              key={atual.id} campanha={atual} painel={painel} periodo={periodo} onPeriodo={setPeriodo} sub={sub}
              onSub={(s) => abrirCampanha(atual.id, s)} onVoltar={() => ir("campanhas")} onAbrir={(id) => abrirCampanha(id)}
              onEnviar={(numeroId) => ir("disparos", { numero: numeroId })}
            />
          )}
          {secao === "nova" && (
            <div className="max-w-3xl space-y-3">
              <h3 className="text-xl font-semibold">Nova campanha</h3>
              <CampanhaConfig campanha={null} numeros={painel.numeros} numeroInicial={params.get("numero")}
                onSalvo={async (id) => { await painel.recarregar(); abrirCampanha(id, "grupos"); }} />
            </div>
          )}
          {secao === "disparos" && (
            <AbaDisparos key={params.get("numero") ?? "padrao"} campanhas={painel.campanhas} numeros={painel.numeros}
              numeroInicial={params.get("numero")} onMudou={painel.recarregarBase} />
          )}
          {secao === "acoes" && (
            <div className="space-y-3">
              <h3 className="text-xl font-semibold">Ações</h3>
              <MensagensLista campanhas={painel.campanhas} onEnviar={() => ir("disparos")} />
            </div>
          )}
          {secao === "calendario" && (
            <div className="space-y-3">
              <h3 className="text-xl font-semibold">Calendário</h3>
              <CalendarioMensagens campanhas={painel.campanhas} />
            </div>
          )}
          {secao === "automacoes" && <AutomacoesGrupos campanhas={painel.campanhas} onAbrir={(id, s) => abrirCampanha(id, s)} />}
          {secao === "leads" && <LeadsGrupos campanhas={painel.campanhas} />}
          {secao === "deeplinks" && <DeepLinksGrupos campanhas={painel.campanhas} />}
          {secao === "historico" && <HistoricoGrupos campanhas={painel.campanhas} />}
          {secao === "seguranca" && <SegurancaGrupos />}
        </section>
      </div>
    </div>
  );
}
