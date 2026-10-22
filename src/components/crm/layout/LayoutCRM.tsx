// Moldura do CRM: menu lateral fixo à esquerda (recolhível no desktop, gaveta no celular), cabeçalho com a
// busca de telas (⌘K / Ctrl+K) e o usuário, e a tela da rota embaixo.
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bot, ChevronsLeft, ChevronsRight, Columns3, Database, Home, Library, LayoutDashboard, Lock, Megaphone, Menu, MessagesSquare, QrCode, Search, Settings, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { AvatarCRM } from "@/components/crm/ui/SecaoCRM";
import { useSegmentos } from "@/hooks/useSegmentos";
import { podeAbrirRota } from "@/lib/modules";
import { useTemaCRM } from "./temaCRM";
import { recarregarMeuAcesso, useMeuAcessoCrm } from "@/hooks/useCrmEquipe";
import { areaDaRota, pode, type MeuAcesso } from "@/lib/crm/acesso";

export interface ItemMenuCRM {
  to: string;
  rotulo: string;
  Icone: LucideIcon;
  /** só ativa na rota exata (Dashboard em /crm) */
  exato?: boolean;
  /** outras rotas que acendem este item */
  tambem?: string[];
}

export const MENU_CRM: ItemMenuCRM[] = [
  { to: "/crm", rotulo: "Dashboard", Icone: LayoutDashboard, exato: true },
  { to: "/crm/conversas", rotulo: "Conversas", Icone: MessagesSquare },
  { to: "/crm/kanban", rotulo: "Kanban", Icone: Columns3, tambem: ["/crm/funil"] },
  { to: "/crm/automacao", rotulo: "Automação", Icone: Workflow },
  { to: "/crm/disparo-grupos", rotulo: "Disparo em grupo", Icone: Megaphone, tambem: ["/crm/grupos"] },
  { to: "/crm/agente-ia", rotulo: "Agente IA", Icone: Bot, tambem: ["/crm/ia"] },
  { to: "/crm/banco", rotulo: "Banco de dados", Icone: Library },
  { to: "/crm/conexoes", rotulo: "Conexão WhatsApp", Icone: QrCode },
];

export const RODAPE_CRM: ItemMenuCRM = { to: "/crm/configuracoes", rotulo: "Configurações", Icone: Settings };

/** Item próprio, só para admin: permissões por colaborador, perfis prontos, departamentos. */
export const ITEM_EQUIPE: ItemMenuCRM = { to: "/crm/equipe", rotulo: "Gestão de equipe", Icone: Users };

/** Itens do menu que esta pessoa vê: área em "ver" ou mais (sem acesso carregado ainda: como hoje). */
export function itensVisiveis(itens: ItemMenuCRM[], meu: MeuAcesso | null): ItemMenuCRM[] {
  if (!meu) return itens;
  return itens.filter((i) => {
    if (i.to === ITEM_EQUIPE.to) return meu.admin;
    const area = areaDaRota(i.to);
    return !area || pode(meu, area);
  });
}

const CHAVE_RECOLHIDO = "crm-menu-recolhido";

export function itemAtivo(item: ItemMenuCRM, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (item.exato) return p === item.to;
  return [item.to, ...(item.tambem ?? [])].some((r) => p === r || p.startsWith(`${r}/`));
}

function ListaMenu({ recolhido, onNavegar }: { recolhido: boolean; onNavegar?: () => void }) {
  const { pathname } = useLocation();
  const { isAdmin, allowedModules } = useAuth();
  const meu = useMeuAcessoCrm();
  const podeBanco = podeAbrirRota("/crm/banco", isAdmin, allowedModules);
  const noBanco = pathname.startsWith("/crm/banco");
  // sub-itens do Banco de dados (segmentos): só carrega quando o item está aberto
  const { segmentos } = useSegmentos(podeBanco && noBanco && !recolhido);
  const itens = itensVisiveis([...MENU_CRM, ITEM_EQUIPE], meu).filter((i) => i.to !== "/crm/banco" || podeBanco);
  const rodape = itensVisiveis([RODAPE_CRM], meu);
  const subBanco = noBanco && !recolhido && segmentos ? (
    <div key="sub-banco" className="ml-7 border-l pl-2 space-y-0.5" aria-label="Segmentos">
      {segmentos.map((sg) => {
        const ativo = pathname === `/crm/banco/${sg.slug}` || (pathname.replace(/\/+$/, "") === "/crm/banco" && sg === segmentos[0]);
        return (
          <NavLink
            key={sg.id}
            to={`/crm/banco/${sg.slug}`}
            onClick={onNavegar}
            className={`block truncate rounded-md px-2 h-8 leading-8 text-xs ${sg.filtro.programa ? "ml-3" : ""} ${ativo ? "text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
          >
            {sg.nome}
          </NavLink>
        );
      })}
    </div>
  ) : null;
  const link = (item: ItemMenuCRM) => {
    const ativo = itemAtivo(item, pathname);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.exato}
        onClick={onNavegar}
        title={recolhido ? item.rotulo : undefined}
        aria-current={ativo ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-lg px-3 h-10 text-sm transition-colors ${
          ativo ? "bg-primary/[0.07] text-primary font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        } ${recolhido ? "justify-center px-0" : ""}`}
      >
        {/* barra amarela do item ativo, colada na borda do menu */}
        {ativo && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />}
        <item.Icone className="h-[18px] w-[18px] shrink-0" />
        {!recolhido && <span className="truncate">{item.rotulo}</span>}
      </NavLink>
    );
  };
  return (
    <>
      <nav aria-label="Menu do CRM" className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {itens.map((i) => (i.to === "/crm/banco" ? [link(i), subBanco] : link(i)))}
      </nav>
      <div className="border-t px-3 py-3 space-y-1">
        {rodape.map(link)}
        <Link
          to="/"
          onClick={onNavegar}
          title={recolhido ? "Voltar ao sistema" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 h-9 text-xs text-muted-foreground hover:bg-accent hover:text-foreground ${recolhido ? "justify-center px-0" : ""}`}
        >
          <Home className="h-4 w-4 shrink-0" />
          {!recolhido && <span>Voltar ao sistema</span>}
        </Link>
      </div>
    </>
  );
}

/** Marca do CRM no topo do menu: quadrado amarelo com a inicial + nome. */
function MarcaCRM({ recolhido }: { recolhido?: boolean }) {
  return (
    <Link to="/crm" className="flex items-center gap-2.5 min-w-0" aria-label="CRM, início">
      <span className="h-8 w-8 shrink-0 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center text-sm font-extrabold">C</span>
      {!recolhido && <span className="font-bold tracking-tight truncate">CRM</span>}
    </Link>
  );
}

/** Busca de telas do CRM (⌘K / Ctrl+K): só navega, não executa nada. */
function BuscaCRM({ aberta, onAberta }: { aberta: boolean; onAberta: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { isAdmin, allowedModules } = useAuth();
  const meu = useMeuAcessoCrm();
  const itens = itensVisiveis([...MENU_CRM, ITEM_EQUIPE, RODAPE_CRM], meu)
    .filter((i) => i.to !== "/crm/banco" || podeAbrirRota("/crm/banco", isAdmin, allowedModules));
  return (
    <CommandDialog open={aberta} onOpenChange={onAberta}>
      <CommandInput placeholder="Ir para…" />
      <CommandList>
        <CommandEmpty>Nenhuma tela com esse nome.</CommandEmpty>
        <CommandGroup heading="Telas do CRM">
          {itens.map((i) => (
            <CommandItem key={i.to} value={i.rotulo} onSelect={() => { onAberta(false); navigate(i.to); }}>
              <i.Icone className="mr-2 text-muted-foreground" />
              {i.rotulo}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function UsuarioCRM() {
  const { profile, user } = useAuth() as { profile?: { full_name?: string; avatar_url?: string } | null; user?: { email?: string } | null };
  const nome = profile?.full_name?.trim() || user?.email?.split("@")[0] || "Você";
  return (
    <div className="flex items-center gap-2.5 min-w-0" title={nome}>
      <span className="hidden lg:block text-sm font-semibold truncate max-w-[10rem]">{nome.split(/\s+/)[0]}</span>
      <AvatarCRM nome={nome} foto={profile?.avatar_url} corStatus="bg-success" rotuloStatus="online" tamanho="h-9 w-9" />
    </div>
  );
}

/** Área sem permissão (a tela não abre; o banco também recusa os dados). */
function SemAcessoCRM() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center" data-testid="sem-acesso-crm">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <p className="text-base font-medium">Você não tem acesso a esta área do CRM.</p>
      <p className="text-sm text-muted-foreground max-w-md">Peça ao administrador para liberar em Gestão de equipe.</p>
    </div>
  );
}

export default function LayoutCRM() {
  useTemaCRM();
  const [recolhido, setRecolhido] = useState(() => {
    try { return localStorage.getItem(CHAVE_RECOLHIDO) === "1"; } catch { return false; }
  });
  const [gaveta, setGaveta] = useState(false);
  const [busca, setBusca] = useState(false);
  const { pathname } = useLocation();
  const atual = [...MENU_CRM, ITEM_EQUIPE, RODAPE_CRM].find((i) => itemAtivo(i, pathname));
  const { user } = useAuth();
  const meu = useMeuAcessoCrm();
  // outro login na mesma aba: relê o acesso
  useEffect(() => { if (user?.id) void recarregarMeuAcesso(); }, [user?.id]);
  const area = areaDaRota(pathname);
  const bloqueada = !!meu && (pathname.startsWith(ITEM_EQUIPE.to) ? !meu.admin : !!area && !pode(meu, area));
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    try { localStorage.setItem(CHAVE_RECOLHIDO, recolhido ? "1" : "0"); } catch { /* modo privado */ }
  }, [recolhido]);

  // ⌘K / Ctrl+K abre a busca de telas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setBusca((b) => !b); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <aside
        data-testid="menu-crm"
        data-recolhido={recolhido ? "1" : "0"}
        className={`hidden md:flex flex-col shrink-0 border-r bg-background transition-[width] duration-200 ${recolhido ? "w-[72px]" : "w-64"}`}
      >
        <div className={`flex items-center h-16 border-b px-4 ${recolhido ? "justify-center px-0" : "justify-between"}`}>
          {!recolhido && <MarcaCRM />}
          <button
            type="button"
            onClick={() => setRecolhido((r) => !r)}
            aria-label={recolhido ? "Abrir menu" : "Recolher menu"}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {recolhido ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
        <ListaMenu recolhido={recolhido} />
      </aside>

      <Sheet open={gaveta} onOpenChange={setGaveta}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col bg-background">
          <SheetTitle className="h-16 flex items-center border-b px-4 text-base"><MarcaCRM /></SheetTitle>
          <ListaMenu recolhido={false} onNavegar={() => setGaveta(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-2 h-14 md:h-16 shrink-0 border-b bg-background px-2 md:px-6">
          <button
            type="button"
            onClick={() => setGaveta(true)}
            aria-label="Abrir menu do CRM"
            className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold truncate md:text-[15px] md:text-muted-foreground">{atual?.rotulo ?? "CRM"}</span>
          <div className="ml-auto flex items-center gap-2 md:gap-4">
            <button
              type="button"
              onClick={() => setBusca(true)}
              aria-label="Buscar telas do CRM"
              aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-[#14161b] px-2.5 md:pl-3 md:pr-1.5 text-sm text-muted-foreground transition-colors hover:border-[#3f444e] hover:text-foreground"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline pr-6">Buscar</span>
              <kbd className="hidden sm:inline-flex h-6 items-center rounded-md border border-input px-1.5 font-sans text-[11px] text-muted-foreground">{mac ? "⌘ K" : "Ctrl K"}</kbd>
            </button>
            <UsuarioCRM />
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto">
          {bloqueada ? <SemAcessoCRM /> : <Outlet />}
        </main>
      </div>
      <BuscaCRM aberta={busca} onAberta={setBusca} />
    </div>
  );
}
