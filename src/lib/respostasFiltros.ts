// Filtros do Banco de Dados de respostas (/respostas), fora do componente para
// poder testar. Cada linha de botões ("Todas · Individual · Qualificadas…" e
// "Travou em: …") é uma dimensão. A contagem de um botão é calculada sobre o
// conjunto já filtrado pelas OUTRAS dimensões ativas — assim o número no botão
// é exatamente o que aparece na lista ao clicar nele. Antes o botão dizia
// "Individual (5)" com "Não agendou" ligado e a lista vinha vazia (14/10).

export type FiltroNivel = "all" | "individual" | "qualified" | "disqualified" | "A" | "B" | "C" | "D";
export type FiltroEtapa = "none" | "sem_agendar" | "sem_wpp" | "agendou";

export interface FiltrosRespostas {
  nivel: FiltroNivel;
  etapa: FiltroEtapa;
  imediato: boolean;
  rec: string; // "none" ou um valor de RECOVERY_OPTIONS
  funil: string | null;
  busca: string;
}

export const FILTROS_PADRAO: FiltrosRespostas = {
  nivel: "all",
  etapa: "none",
  imediato: false,
  rec: "none",
  funil: null,
  busca: "",
};

export interface LinhaFiltravel {
  id: string;
  nome: string | null;
  telefone: string | null;
  nivel: string;
  origem: string | null;
  p9_prioridade: string | null;
}

export interface ContextoFiltro<R extends LinhaFiltravel> {
  jornada: (r: R) => { agendou: boolean; foiPraWpp: boolean };
  recuperacao: (r: R) => string;
  casaFunil: (nomeFunil: string, r: R) => boolean;
}

export type Dimensao = "nivel" | "etapa" | "imediato" | "rec" | "funil" | "busca";

export const ehQualificada = (r: Pick<LinhaFiltravel, "nivel">) => ["A", "B", "C", "D"].includes(r.nivel);
export const ehDesqualificada = (r: Pick<LinhaFiltravel, "nivel">) => r.nivel === "DQ";
export const ehIndividual = (r: Pick<LinhaFiltravel, "origem">) => (r.origem || "").toLowerCase() === "individual";
// Só dá pra afirmar "não agendou" de quem passou pelo fluxo unificado
export const ehRastreavel = (r: Pick<LinhaFiltravel, "origem">) => !!r.origem;

export function passaNivel(r: LinhaFiltravel, nivel: FiltroNivel): boolean {
  if (nivel === "individual") return ehIndividual(r);
  if (nivel === "qualified") return ehQualificada(r);
  if (nivel === "disqualified") return ehDesqualificada(r);
  if (nivel === "A" || nivel === "B" || nivel === "C" || nivel === "D") return r.nivel === nivel;
  return true;
}

export function passaEtapa<R extends LinhaFiltravel>(r: R, etapa: FiltroEtapa, ctx: ContextoFiltro<R>): boolean {
  if (etapa === "none") return true;
  // Filas de recuperação: só qualificadas e só quem tem rastreio confiável —
  // chamar quem já agendou por falta de dado é pior que não chamar
  if (!ehQualificada(r) || !ehRastreavel(r)) return false;
  const j = ctx.jornada(r);
  if (etapa === "sem_agendar") return !j.agendou;
  if (etapa === "sem_wpp") return j.agendou && !j.foiPraWpp;
  return j.agendou; // "agendou"
}

export function passaBusca(r: LinhaFiltravel, busca: string): boolean {
  const term = busca.trim().toLowerCase();
  if (!term) return true;
  const nome = (r.nome || "").toLowerCase();
  const tel = (r.telefone || "").replace(/\D/g, "");
  const termDigits = term.replace(/\D/g, "");
  // Casa pelos últimos 8 dígitos: funciona mesmo com DDI/DDD digitado ou não
  const achouTelefone =
    termDigits.length >= 4 &&
    (tel.includes(termDigits) || (termDigits.length >= 8 && tel.endsWith(termDigits.slice(-8))));
  return nome.includes(term) || achouTelefone;
}

export function passaFiltros<R extends LinhaFiltravel>(
  r: R,
  f: FiltrosRespostas,
  ctx: ContextoFiltro<R>,
  ignorar: readonly Dimensao[] = [],
): boolean {
  const usa = (d: Dimensao) => !ignorar.includes(d);
  if (usa("imediato") && f.imediato && r.p9_prioridade !== "imediato") return false;
  if (usa("nivel") && !passaNivel(r, f.nivel)) return false;
  if (usa("etapa") && !passaEtapa(r, f.etapa, ctx)) return false;
  if (usa("rec") && f.rec !== "none") {
    if (!ehQualificada(r) || !ehRastreavel(r)) return false;
    if (ctx.recuperacao(r) !== f.rec) return false;
  }
  if (usa("funil") && f.funil && !ctx.casaFunil(f.funil, r)) return false;
  if (usa("busca") && !passaBusca(r, f.busca)) return false;
  return true;
}

export interface ContagemChips {
  todas: number;
  individual: number;
  individualQualificadas: number;
  qualificadas: number;
  naoQualificadas: number;
  semAgendar: number;
  agendou: number;
  semWpp: number;
  imediato: number;
}

export function contarChips<R extends LinhaFiltravel>(
  linhas: readonly R[],
  f: FiltrosRespostas,
  ctx: ContextoFiltro<R>,
): ContagemChips {
  const c: ContagemChips = {
    todas: 0, individual: 0, individualQualificadas: 0, qualificadas: 0, naoQualificadas: 0,
    semAgendar: 0, agendou: 0, semWpp: 0, imediato: 0,
  };
  for (const r of linhas) {
    // Linha 1: o botão "Todas" também limpa funil e busca, então o número dele
    // ignora as três; os demais respeitam funil e busca ativos.
    if (passaFiltros(r, f, ctx, ["nivel", "funil", "busca"])) c.todas++;
    if (passaFiltros(r, f, ctx, ["nivel"])) {
      if (ehIndividual(r)) {
        c.individual++;
        if (ehQualificada(r)) c.individualQualificadas++;
      }
      if (ehQualificada(r)) c.qualificadas++;
      if (ehDesqualificada(r)) c.naoQualificadas++;
    }
    // Linha 2 ("Travou em"): etapa é escolha única; "Quer começar já" soma por cima
    if (passaFiltros(r, f, ctx, ["etapa"])) {
      if (passaEtapa(r, "sem_agendar", ctx)) c.semAgendar++;
      if (passaEtapa(r, "agendou", ctx)) c.agendou++;
      if (passaEtapa(r, "sem_wpp", ctx)) c.semWpp++;
    }
    if (passaFiltros(r, f, ctx, ["imediato"]) && r.p9_prioridade === "imediato") c.imediato++;
  }
  return c;
}

const ROTULO_NIVEL: Record<FiltroNivel, string> = {
  all: "",
  individual: "Individual",
  qualified: "Qualificadas",
  disqualified: "Não qualificadas",
  A: "Nível A",
  B: "Nível B",
  C: "Nível C",
  D: "Nível D",
};

const ROTULO_ETAPA: Record<FiltroEtapa, string> = {
  none: "",
  sem_agendar: "Não agendou",
  agendou: "Todas que agendaram",
  sem_wpp: "Agendou · não apertou o WPP",
};

// Nomes dos filtros ligados, na ordem da tela, para o estado vazio
export function filtrosAtivos(f: FiltrosRespostas, rotuloRec?: (v: string) => string): string[] {
  const out: string[] = [];
  if (f.funil) out.push(`Funil: ${f.funil}`);
  if (f.nivel !== "all") out.push(ROTULO_NIVEL[f.nivel]);
  if (f.etapa !== "none") out.push(`Travou em: ${ROTULO_ETAPA[f.etapa]}`);
  if (f.imediato) out.push("Travou em: Quer começar já");
  if (f.rec !== "none") out.push(`Recuperação: ${rotuloRec ? rotuloRec(f.rec) : f.rec}`);
  if (f.busca.trim()) out.push(`Busca: "${f.busca.trim()}"`);
  return out;
}

export const travouEmAtivo = (f: FiltrosRespostas) => f.etapa !== "none" || f.imediato;
