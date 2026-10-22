import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { DESTINO_BASE_LEADS } from "@/lib/crm/bancoAbas";
import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { PrivacyProvider } from "@/hooks/usePrivacy";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CarregandoRota } from "@/components/CarregandoRota";
import { TelaComErro } from "@/components/TelaComErro";
import { destinoGruposAntigo } from "@/lib/crm/rotasGrupos";
const Privacidade = lazy(() => import("./pages/Privacidade"));
const Termos = lazy(() => import("./pages/Termos"));
const ExclusaoDados = lazy(() => import("./pages/ExclusaoDados"));
const Home = lazy(() => import("./pages/Home"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Index = lazy(() => import("./pages/Index"));
import Login from "./pages/Login";
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const MonthlyDashboard = lazy(() => import("./pages/MonthlyDashboard"));
const AnnualDashboard = lazy(() => import("./pages/AnnualDashboard"));
const Alunas = lazy(() => import("./pages/Alunas"));
const PersonalNutri = lazy(() => import("./pages/PersonalNutri"));
const AlunaFicha = lazy(() => import("./pages/AlunaFicha"));
const Substituicoes = lazy(() => import("./pages/Substituicoes"));
const CollaboratorArea = lazy(() => import("./pages/CollaboratorArea"));
const AdminColaboradores = lazy(() => import("./pages/AdminColaboradores"));
const PageTest = lazy(() => import("./pages/PageTest"));
const Rotator = lazy(() => import("./pages/Rotator"));
const TesteImplementacao = lazy(() => import("./pages/TesteImplementacao"));
const RedirectPage = lazy(() => import("./pages/RedirectPage"));
import NotFound from "./pages/NotFound";

function MapaMentalRedirect() {
  window.location.replace("/mapamental/index.html" + window.location.hash);
  return null;
}

const Conteudo = lazy(() => import("./pages/Conteudo"));
const EstudioReact = lazy(() => import("./pages/conteudo/EstudioReact"));
import AgendarPublic from "./pages/Agendar";
const Parceria = lazy(() => import("./pages/Parceria"));
const ParceriaObrigado = lazy(() => import("./pages/ParceriaObrigado"));
const PropostaParceria = lazy(() => import("./pages/PropostaParceria"));
const VendasMicroinfluencia = lazy(() => import("./pages/VendasMicroinfluencia"));
const AlunasParcerias = lazy(() => import("./pages/AlunasParcerias"));
const TesteAgendamento = lazy(() => import("./pages/TesteAgendamento"));
const WebinarVenda = lazy(() => import("./pages/WebinarVenda"));
const WebinarAvaliacao = lazy(() => import("./pages/WebinarAvaliacao"));
const WebinarDebug = lazy(() => import("./pages/WebinarDebug"));
const WebinarHub = lazy(() => import("./pages/WebinarHub"));
const WebinarSala = lazy(() => import("./pages/WebinarSala"));
const WebinarAnalytics = lazy(() => import("./pages/WebinarAnalytics"));
const LivesHome = lazy(() => import("./pages/lives/LivesHome"));
const LiveEstudio = lazy(() => import("./pages/lives/LiveEstudio"));
const LiveConvite = lazy(() => import("./pages/lives/LiveConvite"));
const LiveRender = lazy(() => import("./pages/lives/LiveRender"));
const YoutubeRetorno = lazy(() => import("./pages/lives/YoutubeRetorno"));
const WebinarEditar = lazy(() => import("./pages/lives/WebinarEditar"));
const WebinarAoVivo = lazy(() => import("./pages/lives/WebinarAoVivo"));
// só em desenvolvimento: telas de Lives com dados fictícios (o Vite remove do build de produção)
const LivesDemo = import.meta.env.DEV ? lazy(() => import("./pages/lives/dev/LivesDemo")) : null;
const CrmConversasDemo = import.meta.env.DEV ? lazy(() => import("./pages/dev/CrmConversasDemo")) : null;
const WebinarInscricao = lazy(() => import("./pages/w/WebinarInscricao"));
const WebinarSalaAoVivo = lazy(() => import("./pages/w/WebinarSalaAoVivo"));
const GatewayDashboard = lazy(() => import("./pages/GatewayDashboard"));
const GatewayCobrancas = lazy(() => import("./pages/GatewayCobrancas"));
const GatewayLinks = lazy(() => import("./pages/GatewayLinks"));
const GatewayEmBreve = lazy(() => import("./pages/GatewayEmBreve"));
const GatewayTransacoes = lazy(() => import("./pages/GatewayTransacoes"));
const GatewayFinanceiro = lazy(() => import("./pages/GatewayFinanceiro"));
const GatewayApi = lazy(() => import("./pages/GatewayApi"));
const GatewayConfig = lazy(() => import("./pages/GatewayConfig"));
const CheckoutPublic = lazy(() => import("./pages/CheckoutPublic"));
const PagamentoSucesso = lazy(() => import("./pages/PagamentoSucesso"));
const VendasFunil = lazy(() => import("./pages/VendasFunil"));
const Funis = lazy(() => import("./pages/Funis"));
const carregarCRM = () => import("./pages/CRM");
const CRM = lazy(carregarCRM);
const CentralAutomacao = lazy(() => import("./pages/CentralAutomacao"));
const FluxoConstrutorPagina = lazy(() => import("./pages/crm/FluxoConstrutor"));
// Telas de fluxo com dados fictícios (screenshots/QA): só existem no build de desenvolvimento.
const DevAutomacaoV2 = import.meta.env.DEV ? lazy(() => import("./pages/dev/DevAutomacaoV2")) : null;
const carregarLayoutCRM = () => import("./components/crm/layout/LayoutCRM");
const LayoutCRM = lazy(carregarLayoutCRM);

// Abrindo direto no CRM (22/10/2026): os pedaços do layout e da página saem JÁ, em paralelo com a validação do
// login. Antes vinham em fila (login → layout → página), ~0,6 s a mais no celular. Falha aqui é silenciosa: a rota
// preguiçosa pede de novo e cuida do erro como sempre.
if (typeof window !== "undefined" && /^\/crm(\/|$)/.test(window.location.pathname)) {
  carregarLayoutCRM().catch(() => undefined);
  if (/^\/crm\/(conversas|kanban|funil)\/?$/.test(window.location.pathname)) carregarCRM().catch(() => undefined);
}
const DashboardCRM = lazy(() => import("./pages/crm/DashboardCRM"));
const ConexoesCRM = lazy(() => import("./pages/crm/ConexoesCRM"));
const BancoCRM = lazy(() => import("./pages/crm/BancoCRM"));
const TreinarIA = lazy(() => import("./pages/crm/TreinarIA"));
const ConfiguracoesCRM = lazy(() => import("./pages/crm/ConfiguracoesCRM"));
const GestaoEquipeCRM = lazy(() => import("./pages/crm/GestaoEquipeCRM"));
const DisparoGruposCRM = lazy(() => import("./pages/crm/DisparoGruposCRM"));
const GrupoLink = lazy(() => import("./pages/GrupoLink"));
const LinkCurtoPublico = lazy(() => import("./pages/LinkCurtoPublico"));
const Disponibilidade = lazy(() => import("./pages/Disponibilidade"));
const PesquisaSatisfacaoForm = lazy(() => import("./pages/PesquisaSatisfacaoForm"));
const PesquisaSatisfacaoDashboard = lazy(() => import("./pages/PesquisaSatisfacaoDashboard"));
import { PRODUTOS } from "@/types/pesquisaSatisfacao";
const FeedbackSemanalForm = lazy(() => import("./pages/FeedbackSemanalForm"));
const FeedbackSemanalDashboard = lazy(() => import("./pages/FeedbackSemanalDashboard"));
const PesquisaTrocas = lazy(() => import("./pages/PesquisaTrocas"));
const TrocaCerta = lazy(() => import("./pages/TrocaCerta"));
import { FEEDBACK_PRODUTOS } from "@/types/feedbackSemanal";
const ImplementacaoV1 = lazy(() => import("./pages/ImplementacaoV1"));
const ImplementacaoV2 = lazy(() => import("./pages/ImplementacaoV2"));
const ImplementacaoV3 = lazy(() => import("./pages/ImplementacaoV3"));
const ImplementacaoV4 = lazy(() => import("./pages/ImplementacaoV4"));
const ImplementacaoV5 = lazy(() => import("./pages/ImplementacaoV5"));
const DesafioPage = lazy(() => import("./pages/DesafioPage"));
import CaptacaoAvaliacao from "./pages/CaptacaoAvaliacao";
import CaptacaoAvaliacaoVersao from "./pages/CaptacaoAvaliacaoVersao";
const RespostasForm = lazy(() => import("./pages/RespostasForm"));
import CaptacaoIndividual from "./pages/CaptacaoIndividual";
import CaptacaoVSL from "./pages/CaptacaoVSL";
import InstallPWABanner from "./components/InstallPWABanner";
const AppAlunas = lazy(() => import("./pages/AppAlunas"));
const AlunaLogin = lazy(() => import("./pages/aluna/AlunaLogin"));
const AlunaTreino = lazy(() => import("./pages/aluna/AlunaTreino"));
const AlunaDieta = lazy(() => import("./pages/aluna/AlunaDieta"));
const AlunaFeedback = lazy(() => import("./pages/aluna/AlunaFeedback"));
const AlunaEvolucao = lazy(() => import("./pages/aluna/AlunaEvolucao"));
const AlunaConteudos = lazy(() => import("./pages/aluna/AlunaConteudos"));
const AlunaAula = lazy(() => import("./pages/aluna/AlunaAula"));
const AlunasConteudos = lazy(() => import("./pages/AlunasConteudos"));
const AnamneseForm = lazy(() => import("./pages/AnamneseForm"));
import { AlunaAuthProvider } from "@/hooks/useAlunaAuth";
import { AlunaProtectedRoute } from "@/components/aluna/AlunaProtectedRoute";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,   // não rebusca ao voltar a aba do navegador
      staleTime: 60_000,             // dado é "fresco" por 1 min — evita flashes de 0
      retry: 1,
    },
  },
});

// /crm/central virou /crm/automacao (menu lateral do CRM, 17/10/2026): link antigo continua abrindo, com ?numero=&aba=.
function RedirecionaKanban() {
  const { search } = useLocation();
  return <Navigate to={`/crm/kanban${search}`} replace />;
}

function RedirecionaCentral() {
  const { search } = useLocation();
  return <Navigate to={`/crm/automacao${search}`} replace />;
}

// /crm/ia (Treinar IA, botão em Automação) virou /crm/agente-ia, item próprio do menu (18/10/2026): link antigo
// continua abrindo, com ?agente=&aba=.
// /crm/grupos virou a seção "Disparo em grupo" (/crm/disparo-grupos, 20/10/2026): link antigo (e o
// ?numero= da Central) abre a aba Campanhas.
function RedirecionaGrupos() {
  const { search } = useLocation();
  return <Navigate to={destinoGruposAntigo(search)} replace />;
}

function RedirecionaAgenteIA() {
  const { search } = useLocation();
  return <Navigate to={`/crm/agente-ia${search}`} replace />;
}

// Erro numa tela vira aviso com "Tentar de novo", não tela branca + recarga.
// Trocar de rota limpa o erro.
function TelaComErroPorRota({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <TelaComErro chave={pathname}>{children}</TelaComErro>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <PrivacyProvider>
          <TelaComErroPorRota>
          <Suspense fallback={<CarregandoRota />}>
          <Routes>
            {/* App da aluna: contexto de sessão próprio, separado do painel do time */}
            <Route
              path="/aluna/*"
              element={
                <AlunaAuthProvider>
                  <Routes>
                    <Route path="entrar" element={<AlunaLogin />} />
                    <Route index element={<AlunaProtectedRoute><AlunaTreino /></AlunaProtectedRoute>} />
                    <Route path="dieta" element={<AlunaProtectedRoute><AlunaDieta /></AlunaProtectedRoute>} />
                    <Route path="feedback" element={<AlunaProtectedRoute><AlunaFeedback /></AlunaProtectedRoute>} />
                    <Route path="evolucao" element={<AlunaProtectedRoute><AlunaEvolucao /></AlunaProtectedRoute>} />
                    <Route path="conteudos" element={<AlunaProtectedRoute><AlunaConteudos /></AlunaProtectedRoute>} />
                    <Route path="substituicoes" element={<Substituicoes />} />
                    <Route path="conteudos/:aulaId" element={<AlunaProtectedRoute><AlunaAula /></AlunaProtectedRoute>} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AlunaAuthProvider>
              }
            />
            <Route path="/agendar" element={<AgendarPublic />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="/politica-de-privacidade" element={<Privacidade />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/exclusao-de-dados" element={<ExclusaoDados />} />
            <Route path="/avaliacao" element={<CaptacaoAvaliacao />} />
            {/* Teste de título/foto: v1..v6 (a /avaliacao acima é o controle) */}
            <Route path="/avaliacao/:versao" element={<CaptacaoAvaliacaoVersao />} />
            <Route path="/individual" element={<CaptacaoIndividual />} />
            <Route path="/vsl" element={<CaptacaoVSL />} />
            <Route path="/parceria" element={<Parceria />} />
            <Route path="/parceria/obrigado" element={<ParceriaObrigado />} />
            <Route path="/proposta-parceria" element={<PropostaParceria />} />
            <Route path="/implementacao/v1" element={<ImplementacaoV1 />} />
            <Route path="/implementacao/v2" element={<ImplementacaoV2 />} />
            <Route path="/implementacao/v3" element={<ImplementacaoV3 />} />
            <Route path="/implementacao/v4" element={<ImplementacaoV4 />} />
            <Route path="/implementacao/v5" element={<ImplementacaoV5 />} />
            {/* Desafio Magra e Definida: 5 promessas (v1..v5), split em /r/desafio */}
            <Route path="/desafio/:variante" element={<DesafioPage />} />
            <Route path="/teste-agendamento" element={<TesteAgendamento />} />
            <Route path="/pesquisa-satisfacao/mgmd" element={<PesquisaSatisfacaoForm produto={PRODUTOS.mgmd} />} />
            <Route path="/pesquisa-satisfacao/elite" element={<PesquisaSatisfacaoForm produto={PRODUTOS.elite} />} />
            {/* Mantém rota antiga funcionando (default MGMD) pra não quebrar link compartilhado */}
            <Route path="/pesquisa-satisfacao" element={<PesquisaSatisfacaoForm produto={PRODUTOS.mgmd} />} />
            <Route path="/feedback/mgmd" element={<FeedbackSemanalForm produto={FEEDBACK_PRODUTOS.mgmd} />} />
            <Route path="/feedback/elite" element={<FeedbackSemanalForm produto={FEEDBACK_PRODUTOS.elite} />} />
            <Route path="/anamnese/:token" element={<AnamneseForm />} />
            {/* Substituições de alimento — link curto pra mandar pra aluna */}
            <Route path="/substituicoes" element={<Substituicoes />} />
            {/* Troca Certa — substituição de alimentos, mesmo portão de WhatsApp do feedback */}
            <Route path="/troca" element={<TrocaCerta />} />
            <Route path="/feedback/plataforma" element={<FeedbackSemanalForm produto={FEEDBACK_PRODUTOS.plataforma} />} />
            {/* Rota base do feedback (default MGMD) — link curto pra mandar no WhatsApp */}
            <Route path="/feedback" element={<FeedbackSemanalForm produto={FEEDBACK_PRODUTOS.mgmd} />} />
            <Route path="/webinar" element={<ProtectedRoute><WebinarHub /></ProtectedRoute>} />
            <Route path="/webinar/sala" element={<WebinarSala />} />
            <Route path="/webinar/analytics" element={<ProtectedRoute><WebinarAnalytics /></ProtectedRoute>} />
            <Route path="/webinar/venda" element={<WebinarVenda />} />
            <Route path="/webinar/avaliacao" element={<WebinarAvaliacao />} />
            <Route path="/webinar/debug" element={<WebinarDebug />} />
            {/* Lives e webinário ao vivo: render (template do Egress), convite e páginas /w são públicas */}
            <Route path="/lives" element={<ProtectedRoute><LivesHome /></ProtectedRoute>} />
            <Route path="/lives/estudio/:id" element={<ProtectedRoute><LiveEstudio /></ProtectedRoute>} />
            <Route path="/lives/webinar/:id/editar" element={<ProtectedRoute><WebinarEditar /></ProtectedRoute>} />
            <Route path="/lives/webinar/:id/ao-vivo" element={<ProtectedRoute><WebinarAoVivo /></ProtectedRoute>} />
            <Route path="/lives/convite/:token" element={<LiveConvite />} />
            <Route path="/lives/render/:id" element={<LiveRender />} />
            <Route path="/lives/youtube-retorno" element={<YoutubeRetorno />} />
            {LivesDemo && <Route path="/dev/lives" element={<LivesDemo />} />}
            {CrmConversasDemo && <Route path="/dev/crm-conversas" element={<CrmConversasDemo />} />}
            <Route path="/w/:slug" element={<WebinarInscricao />} />
            <Route path="/w/:slug/sala" element={<WebinarSalaAoVivo />} />
            <Route path="/checkout/:linkId" element={<CheckoutPublic />} />
            <Route path="/pagamento-sucesso" element={<PagamentoSucesso />} />
            <Route path="/gateway/dashboard" element={<ProtectedRoute requireAdmin><GatewayDashboard /></ProtectedRoute>} />
            <Route path="/gateway/cobrancas" element={<ProtectedRoute requireAdmin><GatewayCobrancas /></ProtectedRoute>} />
            <Route path="/gateway/links" element={<ProtectedRoute requireAdmin><GatewayLinks /></ProtectedRoute>} />
            <Route path="/gateway/transacoes" element={<ProtectedRoute requireAdmin><GatewayTransacoes /></ProtectedRoute>} />
            <Route path="/gateway/financeiro" element={<ProtectedRoute requireAdmin><GatewayFinanceiro /></ProtectedRoute>} />
            <Route path="/gateway/api" element={<ProtectedRoute requireAdmin><GatewayApi /></ProtectedRoute>} />
            <Route path="/gateway/configuracoes" element={<ProtectedRoute requireAdmin><GatewayConfig /></ProtectedRoute>} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/pending" element={<PendingApproval />} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/vendas" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/respostas" element={<ProtectedRoute><RespostasForm /></ProtectedRoute>} />
            <Route path="/vendas/funil" element={<ProtectedRoute><VendasFunil /></ProtectedRoute>} />
            <Route path="/vendas/microinfluencia" element={<ProtectedRoute><VendasMicroinfluencia /></ProtectedRoute>} />
            <Route path="/funis" element={<ProtectedRoute><Funis /></ProtectedRoute>} />
            <Route path="/balanco-mensal" element={<ProtectedRoute><MonthlyDashboard /></ProtectedRoute>} />
            <Route path="/anual" element={<ProtectedRoute><AnnualDashboard /></ProtectedRoute>} />
            <Route path="/alunas" element={<ProtectedRoute><Alunas /></ProtectedRoute>} />
            <Route path="/alunas/app" element={<ProtectedRoute><AppAlunas /></ProtectedRoute>} />
            <Route path="/alunas/personal-nutri" element={<ProtectedRoute><PersonalNutri /></ProtectedRoute>} />
            <Route path="/alunas/ficha/:id" element={<ProtectedRoute><AlunaFicha /></ProtectedRoute>} />
            <Route path="/alunas/parcerias" element={<ProtectedRoute><AlunasParcerias /></ProtectedRoute>} />
            <Route path="/alunas/pesquisa-satisfacao" element={<ProtectedRoute><PesquisaSatisfacaoDashboard /></ProtectedRoute>} />
            <Route path="/alunas/feedback" element={<ProtectedRoute><FeedbackSemanalDashboard /></ProtectedRoute>} />
            <Route path="/alunas/pesquisa-trocas" element={<ProtectedRoute><PesquisaTrocas /></ProtectedRoute>} />
            <Route path="/alunas/conteudos" element={<ProtectedRoute><AlunasConteudos /></ProtectedRoute>} />
            <Route path="/colaborador" element={<ProtectedRoute><CollaboratorArea /></ProtectedRoute>} />
            <Route path="/financeiro" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
            {/* CRM com menu lateral (layout de app): /crm = Dashboard */}
            <Route path="/crm" element={<ProtectedRoute><LayoutCRM /></ProtectedRoute>}>
              <Route index element={<DashboardCRM />} />
              <Route path="conversas" element={<CRM />} />
              <Route path="kanban" element={<CRM />} />
              {/* "Contatos e funil" virou "Kanban" (22/11/2026): link antigo continua abrindo */}
              <Route path="funil" element={<RedirecionaKanban />} />
              <Route path="equipe" element={<GestaoEquipeCRM />} />
              <Route path="configuracoes/equipe" element={<Navigate to="/crm/equipe" replace />} />
              <Route path="automacao" element={<CentralAutomacao />} />
              <Route path="agente-ia" element={<TreinarIA />} />
              <Route path="ia" element={<RedirecionaAgenteIA />} />
              <Route path="automacao/fluxos/:id" element={<FluxoConstrutorPagina />} />
              <Route path="central" element={<RedirecionaCentral />} />
              {/* Base de leads virou a aba Registros do Banco de dados (21/10/2026) */}
              <Route path="base-leads" element={<Navigate to={DESTINO_BASE_LEADS} replace />} />
              <Route path="banco" element={<BancoCRM />} />
              <Route path="banco/:slug" element={<BancoCRM />} />
              <Route path="conexoes" element={<ConexoesCRM />} />
              <Route path="configuracoes" element={<ConfiguracoesCRM />} />
              <Route path="disparo-grupos" element={<DisparoGruposCRM />} />
              <Route path="grupos" element={<RedirecionaGrupos />} />
            </Route>
            <Route path="/g/:slug" element={<GrupoLink />} />
            {/* Links curtos públicos (crm_grupo_links): botão do template oficial do WhatsApp. Sem login. */}
            <Route path="/grupo/:slug" element={<LinkCurtoPublico tipo="grupo" />} />
            <Route path="/ir/:slug" element={<LinkCurtoPublico tipo="link" />} />
            {DevAutomacaoV2 && <Route path="/dev/automacao-v2/*" element={<DevAutomacaoV2 />} />}
            <Route path="/disponibilidade" element={<ProtectedRoute><Disponibilidade /></ProtectedRoute>} />
            <Route path="/teste" element={<ProtectedRoute><PageTest /></ProtectedRoute>} />
            <Route path="/teste/implementacao" element={<ProtectedRoute><TesteImplementacao /></ProtectedRoute>} />
            <Route path="/rotator" element={<ProtectedRoute><Rotator /></ProtectedRoute>} />
            <Route path="/r/:slug" element={<RedirectPage />} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/colaboradores" element={<ProtectedRoute requireAdmin><AdminColaboradores /></ProtectedRoute>} />
            {/* Mapa mental: página estática em /public — sai do React e vai no arquivo */}
            <Route path="/mapamental" element={<MapaMentalRedirect />} />
            <Route path="/mapamental/" element={<MapaMentalRedirect />} />
            {/* Board de conteúdo: só logado (HTML embutido num iframe, fora de /public) */}
            <Route path="/conteudo" element={<ProtectedRoute><Conteudo /></ProtectedRoute>} />
            {/* Estúdio React: grava a reação e a VPS monta o Reels (infra/react). Exige o módulo Conteúdo. */}
            <Route path="/conteudo/react" element={<ProtectedRoute><EstudioReact /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </TelaComErroPorRota>
          <InstallPWABanner />
          </PrivacyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
