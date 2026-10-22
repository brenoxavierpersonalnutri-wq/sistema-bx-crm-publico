// Permissões do CRM por colaborador (migration 20261123100000). Puro: sem banco.
// Quem barra de verdade é o banco (RLS + RPCs + edge functions); aqui a tela só esconde o menu, trava o que é
// "ver" e monta a tela de Gestão de equipe (níveis, ações, perfis prontos).

export type NivelArea = "nenhum" | "ver" | "editar";

export const AREAS_CRM = [
  { key: "conversas", rotulo: "Conversas", rota: "/crm/conversas" },
  { key: "kanban", rotulo: "Kanban", rota: "/crm/kanban" },
  { key: "automacao", rotulo: "Automação", rota: "/crm/automacao" },
  { key: "disparo", rotulo: "Disparo em grupo", rota: "/crm/disparo-grupos" },
  { key: "agente_ia", rotulo: "Agente IA", rota: "/crm/agente-ia" },
  { key: "banco", rotulo: "Banco de dados", rota: "/crm/banco" },
  // 21/10/2026: a tela Base de leads virou as abas Registros e Importar CSV do Banco de dados (a RLS de base_leads
  // continua pedindo esta área); /crm/base-leads redireciona para /crm/banco?aba=registros.
  { key: "base_leads", rotulo: "Banco de dados: Registros e Importar CSV", rota: "/crm/base-leads" },
  { key: "conexao", rotulo: "Conexão WhatsApp", rota: "/crm/conexoes" },
  { key: "configuracoes", rotulo: "Configurações", rota: "/crm/configuracoes" },
  { key: "lives", rotulo: "Lives", rota: "/lives" },
] as const;
export type AreaCrm = (typeof AREAS_CRM)[number]["key"];

export const ACOES_CRM = [
  { key: "conversas.enviar", area: "conversas", rotulo: "Enviar mensagem" },
  { key: "conversas.transferir", area: "conversas", rotulo: "Transferir (atendente, departamento, IA)" },
  { key: "conversas.assumir_ia", area: "conversas", rotulo: "Assumir da IA" },
  { key: "kanban.mover", area: "kanban", rotulo: "Mover card" },
  { key: "agente_ia.editar_prompt", area: "agente_ia", rotulo: "Editar prompt e base" },
  { key: "disparo.enviar", area: "disparo", rotulo: "Enviar / agendar" },
  { key: "conexao.conectar", area: "conexao", rotulo: "Conectar (QR e código)" },
] as const;
export type AcaoCrm = (typeof ACOES_CRM)[number]["key"];

/** Linha de crm_acessos (o que a tela grava). */
export interface AcessoCrm {
  todos_numeros: boolean;
  numeros: string[];
  areas: Partial<Record<AreaCrm, NivelArea>>;
  acoes: Partial<Record<AcaoCrm, boolean>>;
  so_minhas: boolean;
  so_departamentos: boolean;
  perfil?: string | null;
}

/** Resultado de crm_meu_acesso() (o acesso já resolvido de quem está logado). */
export interface MeuAcesso {
  admin: boolean;
  areas: Record<AreaCrm, NivelArea>;
  acoes: Record<AcaoCrm, boolean>;
  todos_numeros: boolean;
  numeros: string[];
  so_minhas: boolean;
  so_departamentos: boolean;
  departamentos: string[];
}

const PESO: Record<NivelArea, number> = { nenhum: 0, ver: 1, editar: 2 };

export function nivelDe(acesso: Pick<AcessoCrm, "areas"> | null | undefined, area: AreaCrm): NivelArea {
  const n = acesso?.areas?.[area];
  return n === "ver" || n === "editar" ? n : "nenhum";
}

export function pode(meu: MeuAcesso | null | undefined, area: AreaCrm, nivel: Exclude<NivelArea, "nenhum"> = "ver"): boolean {
  if (!meu) return false;
  if (meu.admin) return true;
  return PESO[meu.areas?.[area] ?? "nenhum"] >= PESO[nivel];
}

/** Ação ligada: área em "editar" e a ação não desligada (ausente = liberada). Mesma regra de crm_acao(). */
export function acaoLigada(acesso: Pick<AcessoCrm, "areas" | "acoes"> | null | undefined, acao: AcaoCrm): boolean {
  if (!acesso) return false;
  const area = ACOES_CRM.find((a) => a.key === acao)!.area as AreaCrm;
  if (nivelDe(acesso, area) !== "editar") return false;
  return acesso.acoes?.[acao] !== false;
}

export function podeAcao(meu: MeuAcesso | null | undefined, acao: AcaoCrm): boolean {
  if (!meu) return false;
  if (meu.admin) return true;
  return meu.acoes?.[acao] === true;
}

/** Acesso total (o que todo usuário que já existia ganhou na migration). */
export function acessoTotal(): MeuAcesso {
  return {
    admin: false,
    areas: Object.fromEntries(AREAS_CRM.map((a) => [a.key, "editar"])) as Record<AreaCrm, NivelArea>,
    acoes: Object.fromEntries(ACOES_CRM.map((a) => [a.key, true])) as Record<AcaoCrm, boolean>,
    todos_numeros: true, numeros: [], so_minhas: false, so_departamentos: false, departamentos: [],
  };
}

/** Área de uma rota do CRM (null = rota sem área própria: Dashboard, Gestão de equipe). */
export function areaDaRota(path: string): AreaCrm | null {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/crm/funil" || p.startsWith("/crm/kanban")) return "kanban";
  if (p === "/crm/ia" || p.startsWith("/crm/agente-ia")) return "agente_ia";
  if (p === "/crm/grupos") return "disparo";
  if (p === "/crm/central" || p.startsWith("/crm/automacao")) return "automacao";
  const a = AREAS_CRM.find((x) => p === x.rota || p.startsWith(`${x.rota}/`));
  return a ? a.key : null;
}

// ------------------------------------------------------------------------------------------- perfis prontos
// Números e departamentos são escolhidos pelo nome/chave na hora de aplicar (cada instalação tem os seus).
// Depois de aplicado, o admin ajusta; a tela mostra "SDR (ajustado)" quando algo difere do que o perfil daria.

export interface NumeroRef { id: string; chave: string; apelido: string; sessao_openwa?: string | null }
export interface DepartamentoRef { id: string; nome: string; regra?: string | null }

export interface PerfilPronto {
  slug: "sdr" | "closer" | "cs" | "admin";
  nome: string;
  descricao: string;
  areas: Partial<Record<AreaCrm, NivelArea>>;
  acoes: Partial<Record<AcaoCrm, boolean>>;
  so_minhas: boolean;
  /** null = todos os números */
  numeros: ((n: NumeroRef) => boolean) | null;
  /** null = todos os departamentos (sem "só dos departamentos") */
  departamentos: ((d: DepartamentoRef) => boolean) | null;
  /** liberações fora do CRM (user_modules), ex.: Gestão de Alunas para o CS */
  modulos?: string[];
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nomeCasa = (re: RegExp) => (d: DepartamentoRef) => re.test(sem(d.nome));
const suporte = (n: NumeroRef) => /suporte|consultoria/.test(n.chave) || /suporte|consultoria|sabrina/.test(sem(n.apelido));
// o de suporte se chama "Comercial Consultoria Sabrina": suporte nunca conta como comercial
const comercial = (n: NumeroRef) => !suporte(n) && (/^comercial/.test(n.chave) || /comercial/.test(sem(n.apelido)));

const NADA = Object.fromEntries(AREAS_CRM.map((a) => [a.key, "nenhum"])) as Record<AreaCrm, NivelArea>;

export const PERFIS_PRONTOS: PerfilPronto[] = [
  {
    slug: "sdr", nome: "SDR",
    descricao: "Conversas (enviar, assumir da IA, transferir) e Kanban (mover), só nos números comerciais e no departamento de leads/qualificação. Vê as dele e as sem atendente.",
    areas: { ...NADA, conversas: "editar", kanban: "editar" },
    acoes: { "conversas.enviar": true, "conversas.transferir": true, "conversas.assumir_ia": true, "kanban.mover": true },
    so_minhas: true,
    numeros: comercial,
    departamentos: nomeCasa(/lead|qualifica/),
  },
  {
    slug: "closer", nome: "Closer",
    descricao: "Como o SDR, nos departamentos de negociação/agendado, mais leitura do Banco de dados (Pessoas e Registros) e do histórico da IA.",
    areas: { ...NADA, conversas: "editar", kanban: "editar", banco: "ver", base_leads: "ver", agente_ia: "ver" },
    acoes: { "conversas.enviar": true, "conversas.transferir": true, "conversas.assumir_ia": true, "kanban.mover": true },
    so_minhas: true,
    numeros: comercial,
    departamentos: nomeCasa(/negocia|agendad/),
  },
  {
    slug: "cs", nome: "CS",
    descricao: "Conversas e Kanban só no número de suporte e nos departamentos de alunas/suporte, mais a Gestão de Alunas. Sem comercial.",
    areas: { ...NADA, conversas: "editar", kanban: "editar" },
    acoes: { "conversas.enviar": true, "conversas.transferir": true, "conversas.assumir_ia": true, "kanban.mover": true },
    so_minhas: false,
    numeros: suporte,
    departamentos: nomeCasa(/aluna|suporte|\bcs\b|sucesso/),
    modulos: ["alunas"],
  },
  {
    slug: "admin", nome: "Admin",
    descricao: "Tudo: todas as áreas em editar, todas as ações, todos os números e conversas. (Não dá o papel de admin do sistema.)",
    areas: Object.fromEntries(AREAS_CRM.map((a) => [a.key, "editar"])) as Record<AreaCrm, NivelArea>,
    acoes: Object.fromEntries(ACOES_CRM.map((a) => [a.key, true])) as Record<AcaoCrm, boolean>,
    so_minhas: false,
    numeros: null,
    departamentos: null,
  },
];

export interface AplicacaoPerfil {
  acesso: AcessoCrm;
  /** departamentos de que a pessoa passa a ser membro */
  departamentos: string[];
  modulos: string[];
}

export function aplicarPerfil(perfil: PerfilPronto, numeros: NumeroRef[], departamentos: DepartamentoRef[]): AplicacaoPerfil {
  const manuais = departamentos.filter((d) => (d.regra ?? "manual") === "manual");
  const deps = perfil.departamentos ? manuais.filter(perfil.departamentos).map((d) => d.id) : [];
  return {
    acesso: {
      todos_numeros: perfil.numeros === null,
      numeros: perfil.numeros ? numeros.filter(perfil.numeros).map((n) => n.id) : [],
      areas: { ...perfil.areas },
      acoes: { ...perfil.acoes },
      so_minhas: perfil.so_minhas,
      so_departamentos: perfil.departamentos !== null,
      perfil: perfil.slug,
    },
    departamentos: deps,
    modulos: perfil.modulos ?? [],
  };
}

const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Rótulo do perfil no usuário: "SDR", "SDR (ajustado)" ou null (nenhum perfil aplicado). */
export function rotuloPerfil(
  acesso: AcessoCrm, membroDe: string[], numeros: NumeroRef[], departamentos: DepartamentoRef[],
): string | null {
  const perfil = PERFIS_PRONTOS.find((p) => p.slug === acesso.perfil);
  if (!perfil) return null;
  const esperado = aplicarPerfil(perfil, numeros, departamentos);
  const e = esperado.acesso;
  const igual =
    e.todos_numeros === acesso.todos_numeros &&
    (e.todos_numeros || mesmoConjunto(e.numeros, acesso.numeros)) &&
    AREAS_CRM.every((a) => nivelDe(e, a.key) === nivelDe(acesso, a.key)) &&
    ACOES_CRM.every((a) => acaoLigada(e, a.key) === acaoLigada(acesso, a.key)) &&
    e.so_minhas === acesso.so_minhas &&
    e.so_departamentos === acesso.so_departamentos &&
    (!e.so_departamentos || mesmoConjunto(esperado.departamentos, membroDe));
  return igual ? perfil.nome : `${perfil.nome} (ajustado)`;
}
