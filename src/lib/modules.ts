// Módulos que o admin libera por pessoa (uma linha em `user_modules`).
//
// "Comercial" é a área "Monitoramento das Consultas" inteira: a tela de
// consultas (/vendas) e tudo que se abre de dentro dela — abas Funil,
// Microinfluência, Mensal e Anual, e o "Banco de Dados" das respostas do
// formulário (/respostas). Antes eram três liberações soltas ("vendas",
// "mensal", "anual"); viraram uma só, ligada na coluna "Comercial" da lista
// "Quem tem acesso" (Área do Usuário) e também aqui na tela de Usuários.
//
// No banco, as policies de `consultations`, `lead_form_responses` e
// `lead_recovery` conferem `has_module(auth.uid(), 'comercial')` (ou admin).
// Ver supabase/migrations/20261013200000_acesso_comercial.sql.

export const COMERCIAL_MODULE = "comercial";

/**
 * Liberações antigas que viraram "comercial". O SQL da migração converte as
 * linhas e apaga as antigas; até ele rodar, a tela ainda as aceita, pra
 * ninguém que usa a área hoje ser barrado no intervalo entre o deploy do
 * front e o SQL. Depois do SQL não sobra linha com esses nomes.
 */
export const MODULOS_LEGADOS_COMERCIAL: ReadonlyArray<string> = ["vendas", "mensal", "anual"];

/** Rotas da área Comercial (Monitoramento das Consultas e sub-páginas). */
export const ROTAS_COMERCIAL: ReadonlyArray<string> = [
  "/vendas",
  "/vendas/funil",
  "/vendas/microinfluencia",
  "/balanco-mensal",
  "/anual",
  "/respostas",
];

export const APP_MODULES = [
  { key: "comercial", label: "Monitoramento das Consultas (Comercial)", path: "/vendas" },
  { key: "alunas", label: "Gestão de Alunas", path: "/alunas" },
  { key: "app-alunas", label: "App das Alunas", path: "/alunas/app" },
  { key: "financeiro", label: "Dash Financeiro", path: "/financeiro" },
  { key: "teste", label: "BXMetrics / Meta Ads", path: "/teste" },
  { key: "rotator", label: "Rotador de Links", path: "/rotator" },
  { key: "funis", label: "Meus Funis", path: "/funis" },
  { key: "lives", label: "Lives e Webinários", path: "/lives" },
  // Lista detalhada de leads do CRM (/crm/banco e segmentos). O resto do CRM segue livre para aprovado.
  { key: "crm-banco", label: "CRM: Banco de dados (listas de leads)", path: "/crm/banco" },
  // Publicar/agendar no Instagram pela Zernio de dentro do board (/conteudo). O caminho NÃO é rota: o board continua
  // aberto para todo aprovado; o módulo só libera o botão e a lista de agendados. No banco: conteudo_pode() (migration
  // 20261124100000) e o serviço infra/zernio conferem a mesma coisa.
  { key: "conteudo", label: "Conteúdo: publicar e agendar no Instagram", path: "/conteudo/publicar" },
] as const;

export type ModuleKey = (typeof APP_MODULES)[number]["key"];

const semBarraFinal = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

export const getModuleByPath = (path: string): ModuleKey | null => {
  const p = semBarraFinal(path);
  if (ROTAS_COMERCIAL.includes(p)) return "comercial";
  // Subtelas do Teste de Página (ex.: /teste/implementacao) seguem a liberação de /teste.
  if (p.startsWith("/teste/")) return "teste";
  // Estúdio e webinários (/lives/estudio/:id, /lives/webinar/:id/...) seguem a liberação de /lives.
  // /lives/render/:id e /lives/convite/:token são públicas (fora do ProtectedRoute).
  if (p.startsWith("/lives/")) return "lives";
  // Estúdio React (/conteudo/react) segue o módulo Conteúdo (o board /conteudo continua aberto para todo aprovado).
  if (p === "/conteudo/react" || p.startsWith("/conteudo/react/")) return "conteudo";
  // Segmentos do Banco de dados (/crm/banco/:slug) seguem a liberação de /crm/banco.
  if (p.startsWith("/crm/banco/")) return "crm-banco";
  const mod = APP_MODULES.find((m) => m.path === p);
  return mod ? mod.key : null;
};

/** Tem a área Comercial: admin, liberação "comercial" ou uma das antigas. */
export function temComercial(isAdmin: boolean, modulos: ReadonlyArray<string>): boolean {
  return (
    isAdmin ||
    modulos.includes(COMERCIAL_MODULE) ||
    modulos.some((m) => MODULOS_LEGADOS_COMERCIAL.includes(m))
  );
}

/** A pessoa pode abrir esta rota? Rota sem módulo é livre (para aprovado). */
export function podeAbrirRota(path: string, isAdmin: boolean, modulos: ReadonlyArray<string>): boolean {
  if (isAdmin) return true;
  const key = getModuleByPath(path);
  if (!key) return true;
  if (key === "comercial") return temComercial(false, modulos);
  return modulos.includes(key);
}
