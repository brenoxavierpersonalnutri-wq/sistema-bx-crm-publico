import { lazy, Suspense, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Loader2, Settings } from "lucide-react";
import { useNomesGrupos } from "@/hooks/useNomesGrupos";
import { ConversasCRM } from "@/components/crm/conversas/ConversasCRM";
import { ChatConversa } from "@/components/crm/conversas/ChatConversa";
import { useProvedorWhatsApp } from "@/hooks/useProvedorWhatsApp";
import { useConversas } from "@/hooks/useConversas";
import { fonteSupabase, type FonteConversas } from "@/lib/crm/fonteConversas";
import { combinarFontes } from "@/lib/crm/fonteInstagram";
import { chaveConversa, contatoDaSelecao, type ContatoCRM } from "@/lib/crm/conversas";
import { definirDepartamentoDaConversa, useDepartamentos, useMeuAcessoCrm } from "@/hooks/useCrmEquipe";
import { assumirHumano } from "@/lib/crm/roboIA";
import { podeAcao } from "@/lib/crm/acesso";
import { useAuth } from "@/hooks/useAuth";

type Visao = "conversas" | "funil";

// Kanban só em /crm/kanban (22/10/2026): fora do pedaço de JS que /crm/conversas baixa no celular.
const KanbanBoard = lazy(() => import("@/components/crm/KanbanBoard"));
const ConfigurarEtapasModal = lazy(() => import("@/components/crm/etapas/ConfigurarEtapasModal").then((m) => ({ default: m.ConfigurarEtapasModal })));
const KanbanDepartamentos = lazy(() => import("@/components/crm/kanban/KanbanDepartamentos").then((m) => ({ default: m.KanbanDepartamentos })));
const ResizablePanelGroup = lazy(() => import("@/components/ui/resizable").then((m) => ({ default: m.ResizablePanelGroup })));
const ResizablePanel = lazy(() => import("@/components/ui/resizable").then((m) => ({ default: m.ResizablePanel })));
const ResizableHandle = lazy(() => import("@/components/ui/resizable").then((m) => ({ default: m.ResizableHandle })));

const CarregandoKanban = () => (
  <div className="h-full flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" /></div>
);

// WhatsApp + Instagram Direct na mesma lista (17/10/2026). Constante de módulo: os hooks dependem da identidade.
const fontePadrao = combinarFontes(fonteSupabase);

interface CRMProps {
  /** Só a rota de desenvolvimento troca a fonte (dados fictícios). */
  fonte?: FonteConversas;
  agora?: Date;
  abrirInicial?: string | null;
  /** Buscar o nome real dos grupos sem nome (desligado na demo, que não tem banco). */
  resolverGrupos?: boolean;
}

const CRM = ({ fonte = fontePadrao, agora, abrirInicial = null, resolverGrupos = true }: CRMProps) => {
  // Menu lateral (17/10/2026): /crm/conversas = estilo WhatsApp Web, /crm/funil = Kanban + chat.
  // Conexão, automações, roteiros, base de leads e grupos saíram deste cabeçalho e foram para o menu.
  const { pathname } = useLocation();
  // /crm/kanban (antes /crm/funil, que redireciona para cá)
  const visao: Visao = /\/(funil|kanban)$/.test(pathname.replace(/\/+$/, "")) ? "funil" : "conversas";
  const [params] = useSearchParams();
  const [selecionado, setSelecionado] = useState<string | null>(abrirInicial ?? params.get("abrir"));
  const [configEtapas, setConfigEtapas] = useState(false);
  // Conversas pagina pelo servidor (60 por vez + delta); o Kanban precisa de todos os cards e carrega tudo
  // a pré-carga (main.tsx) consulta o banco direto: só vale com a fonte real
  const controle = useConversas(fonte, { paginada: visao === "conversas", preCarga: fonte === fontePadrao && visao === "conversas" });
  // grupo sem nome na lista: busca o assunto real (só com a fonte do banco, nunca na demo)
  useNomesGrupos(controle.contatos, controle.carregando, (id, name) => controle.atualizarContatoLocal(id, { name }), resolverGrupos);

  const contatoKanban: ContatoCRM | null = contatoDaSelecao(controle.contatos, selecionado);
  // Kanban por departamento (parte C); banco sem a migration: o quadro antigo por etapa
  const departamentos = useDepartamentos();
  const meuAcesso = useMeuAcessoCrm();
  const { user } = useAuth();
  const kanbanNovo = departamentos.length > 0;
  const podeMover = !meuAcesso || podeAcao(meuAcesso, "kanban.mover") || podeAcao(meuAcesso, "conversas.transferir");
  const podeAssumir = !meuAcesso || podeAcao(meuAcesso, "conversas.assumir_ia");
  const moverCard = async (c: ContatoCRM, departamentoId: string | null) => {
    const d = departamentos.find((x) => x.id === departamentoId);
    const antes = { departamento_id: c.departamento_id ?? null, stage: c.stage };
    controle.atualizarContatoLocal(c.id, { departamento_id: departamentoId, ...(d?.etapa_origem ? { stage: d.etapa_origem } : {}) });
    try {
      await definirDepartamentoDaConversa(c.id, departamentoId);
    } catch (e) {
      controle.atualizarContatoLocal(c.id, antes);
      throw e;
    }
  };
  const assumirCard = async (c: ContatoCRM) => {
    await assumirHumano(c.numero_id ?? null, c.phone);
    controle.atualizarContatoLocal(c.id, {
      ai_pausado: true, ai_pausado_motivo: "humano", ai_precisa_humano: false, ...(user?.id ? { atendente_id: user.id } : {}),
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-hidden md:p-3">
        {visao === "conversas" ? (
          <div className="h-full md:rounded-xl md:border bg-card overflow-hidden shadow-sm">
            <ConversasCRM
              fonte={fonte}
              controle={controle}
              selecionado={selecionado}
              onSelecionar={setSelecionado}
              agora={agora}
            />
          </div>
        ) : (
          <Suspense fallback={<CarregandoKanban />}>
          <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border bg-card text-card-foreground shadow-sm">
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="h-full flex flex-col">
                <div className="p-3 border-b bg-muted/20 font-medium text-sm flex items-center justify-between gap-2">
                  Kanban
                  {!kanbanNovo && <button
                    type="button"
                    onClick={() => setConfigEtapas(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Configurar etapas"
                    title="Configurar etapas"
                  >
                    <Settings className="h-4 w-4" /> Etapas
                  </button>}
                </div>
                <div className="flex-1 overflow-hidden">
                  {kanbanNovo ? (
                    <KanbanDepartamentos
                      contatos={controle.contatos}
                      departamentos={departamentos}
                      numeros={controle.numeros}
                      carregando={controle.carregando}
                      selecionadoId={contatoKanban?.id}
                      onAbrir={(c) => setSelecionado(chaveConversa(c))}
                      podeMover={podeMover}
                      podeAssumir={podeAssumir}
                      mover={moverCard}
                      assumir={assumirCard}
                    />
                  ) : (
                    <KanbanBoard
                      onCardClick={(c) => setSelecionado(chaveConversa(c as { phone: string; numero_id?: string | null }))}
                      selectedCardId={contatoKanban?.id}
                    />
                  )}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={35} minSize={25}>
              <ChatConversa
                contato={contatoKanban}
                numeros={controle.numeros}
                fonte={fonte}
                ouvir={controle.ouvir}
                previa={controle.previaConversa}
                onLida={controle.marcarLida}
                onContatoAtualizado={controle.atualizarContatoLocal}
                compacto
              />
            </ResizablePanel>
          </ResizablePanelGroup>
          </Suspense>
        )}
        {configEtapas && (
          <Suspense fallback={null}>
            <ConfigurarEtapasModal aberto={configEtapas} onFechar={() => setConfigEtapas(false)} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default CRM;
