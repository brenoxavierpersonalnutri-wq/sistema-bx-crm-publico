// Central de Automação do CRM (/crm/central): lógica pura, sem React e sem rede (testada em
// src/test/crmCentral.test.ts). Organiza tudo por NÚMERO de WhatsApp: sessões do OpenWA e o número oficial.
//
// Contrato com os outros módulos (fluxos, grupos, roteiros):
//  - toda tabela que envia algo tem `numero_id` (FK crm_numeros, nullable). NULL = número padrão (sessão closer).
//  - telas que aceitam filtro recebem `?numero=<id>` na URL (ver linkModulo).

export type TipoNumero = "openwa" | "oficial";

export interface NumeroCRM {
  id: string;
  chave: string;
  apelido: string;
  telefone: string | null;
  tipo: TipoNumero;
  sessao_openwa: string | null;
  ativo: boolean;
  max_hora: number;
  max_dia: number;
  hora_inicio: number;
  hora_fim: number;
  ordem: number;
  observacao: string | null;
  /** true quando veio do seed embutido (tabela crm_numeros ainda não criada no banco). */
  provisorio?: boolean;
}

export const SESSAO_PADRAO = "closer";

const base = { ativo: true, max_hora: 30, max_dia: 200, hora_inicio: 8, hora_fim: 20, observacao: null, provisorio: true };

/** Mesmo seed da migration 20261024100000; usado só enquanto a tabela não existe. */
export const NUMEROS_PADRAO: NumeroCRM[] = [
  { ...base, id: "seed-closer", chave: "closer", apelido: "Closer", telefone: null, tipo: "openwa", sessao_openwa: "closer", ordem: 10 },
  { ...base, id: "seed-comercial-fit-2", chave: "comercial-fit-2", apelido: "Comercial Fit 2", telefone: null, tipo: "openwa", sessao_openwa: "comercial-fit-2", ordem: 20 },
  { ...base, id: "seed-suporte-consultoria-1", chave: "suporte-consultoria-1", apelido: "Suporte Consultoria", telefone: null, tipo: "openwa", sessao_openwa: "suporte-consultoria-1", ordem: 30 },
  { ...base, id: "seed-comercial-implementacao-1", chave: "comercial-implementacao-1", apelido: "Comercial Implementação", telefone: null, tipo: "openwa", sessao_openwa: "comercial-implementacao-1", ordem: 40 },
  { ...base, id: "seed-oficial-full-funnel", chave: "oficial-full-funnel", apelido: "Oficial (Full Funnel)", telefone: "553170000102", tipo: "oficial", sessao_openwa: null, ordem: 50 },
];

export const ehProvisorio = (id: string | null | undefined) => typeof id === "string" && id.startsWith("seed-");

/** O número padrão é o que recebe os registros com numero_id NULL (sessão closer). */
export function numeroPadrao(numeros: NumeroCRM[]): NumeroCRM | null {
  return numeros.find((n) => n.tipo === "openwa" && n.sessao_openwa === SESSAO_PADRAO) ?? null;
}

/** numero_id de um registro -> id do número dono na Central (NULL vira o padrão). */
export function donoDoRegistro(numeroId: string | null | undefined, numeros: NumeroCRM[]): string | null {
  if (numeroId && numeros.some((n) => n.id === numeroId)) return numeroId;
  return numeroPadrao(numeros)?.id ?? null;
}

export function pertenceAo<T extends { numero_id?: string | null }>(registro: T, numeroId: string, numeros: NumeroCRM[]): boolean {
  return donoDoRegistro(registro.numero_id ?? null, numeros) === numeroId;
}

/** 553170000102 -> (31) 7000-0102 ; 5531999998888 -> (31) 99999-8888 ; outro formato fica como veio. */
export function formatarTelefone(t: string | null | undefined): string {
  const d = String(t ?? "").replace(/\D/g, "");
  if (!d) return "";
  const local = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}

// ------------------------------------------------------------------ status

export type EstadoConexao = "conectado" | "qr" | "desconectado" | "sem_ponte" | "oficial" | "desconhecido";

export interface StatusNumero {
  estado: EstadoConexao;
  /** texto curto pro cartão */
  rotulo: string;
  telefone: string | null;
  aviso: string | null;
}

/**
 * Interpreta a resposta de whatsapp-qr?action=status&sessao=X para UM número.
 * A versão antiga da função ignora `sessao` e devolve sempre o closer: por isso, para sessão que
 * não é a padrão, só vale a resposta que ecoa a mesma `sessao` (senão "sem ponte").
 */
export function interpretarStatusNumero(numero: Pick<NumeroCRM, "tipo" | "sessao_openwa" | "ativo">, resposta: unknown): StatusNumero {
  if (numero.tipo === "oficial") {
    return { estado: "oficial", rotulo: "API oficial", telefone: null, aviso: "Envia por template aprovado no Full Funnel" };
  }
  const d = (resposta && typeof resposta === "object" ? resposta : {}) as Record<string, unknown>;
  const sessao = numero.sessao_openwa ?? "";
  const ecoou = typeof d.sessao === "string" ? d.sessao : null;
  if (sessao !== SESSAO_PADRAO && ecoou !== sessao) {
    return {
      estado: "sem_ponte",
      rotulo: "não conectado",
      telefone: null,
      aviso: "A ponte da VPS ainda não atende esta sessão (precisa da chave dela)",
    };
  }
  const state = typeof d.state === "string" ? d.state.toLowerCase() : "";
  const telefone = typeof d.phone === "string" ? d.phone : null;
  const aviso = typeof d.aviso === "string" ? d.aviso : typeof d.error === "string" ? d.error : null;
  if (d.connected === true || state === "ready") return { estado: "conectado", rotulo: "conectado", telefone, aviso };
  if (state === "qr_ready" || state === "initializing") return { estado: "qr", rotulo: "desconectado / aguardando QR", telefone, aviso };
  if (state === "sem_ponte") return { estado: "sem_ponte", rotulo: "não conectado", telefone, aviso };
  if (!state || state === "desconhecido" || state === "proxy_indisponivel") {
    return { estado: "desconhecido", rotulo: state === "proxy_indisponivel" ? "ponte fora do ar" : "sem leitura", telefone, aviso };
  }
  return { estado: "desconectado", rotulo: "desconectado", telefone, aviso };
}

// ------------------------------------------------------------------ dia

/** Início do dia de hoje em Brasília (UTC-3, sem horário de verão) como ISO UTC. */
export function inicioDoDiaBRT(agora: Date = new Date()): string {
  const brt = new Date(agora.getTime() - 3 * 3600_000);
  const dia = brt.toISOString().slice(0, 10);
  return new Date(`${dia}T03:00:00.000Z`).toISOString();
}

export interface LinhaLog {
  numero_id?: string | null;
  contact_phone: string;
  canal: string;
  status: string;
  created_at: string;
}

export interface Resposta {
  contact_phone: string;
  created_at: string;
}

export interface ResumoDia {
  enviados: number;
  falhas: number;
  /** contatos que receberam envio hoje e mandaram mensagem DEPOIS do primeiro envio */
  respondidos: number;
  pausas: number;
}

/** Totais do dia. Só conta envio de mensagem (canal whatsapp/oficial), não mudança de etapa/tag. */
export function resumirDia(logs: LinhaLog[], respostas: Resposta[], pausas: number): ResumoDia {
  const msgs = logs.filter((l) => l.canal === "whatsapp" || l.canal === "oficial");
  const primeiroEnvio = new Map<string, string>();
  for (const l of msgs) {
    if (l.status !== "ok") continue;
    const atual = primeiroEnvio.get(l.contact_phone);
    if (!atual || l.created_at < atual) primeiroEnvio.set(l.contact_phone, l.created_at);
  }
  const responderam = new Set<string>();
  for (const r of respostas) {
    const env = primeiroEnvio.get(r.contact_phone);
    if (env && r.created_at > env) responderam.add(r.contact_phone);
  }
  return {
    enviados: msgs.filter((l) => l.status === "ok").length,
    falhas: msgs.filter((l) => l.status === "erro").length,
    respondidos: responderam.size,
    pausas,
  };
}

/** Envios OK de hoje por número (NULL vai pro padrão). */
export function enviosPorNumero(logs: LinhaLog[], numeros: NumeroCRM[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) {
    if (l.status !== "ok" || (l.canal !== "whatsapp" && l.canal !== "oficial")) continue;
    const dono = donoDoRegistro(l.numero_id ?? null, numeros);
    if (dono) m.set(dono, (m.get(dono) ?? 0) + 1);
  }
  return m;
}

export function contarPorNumero<T extends { numero_id?: string | null }>(
  registros: T[],
  numeros: NumeroCRM[],
  filtro: (r: T) => boolean = () => true,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of registros) {
    if (!filtro(r)) continue;
    const dono = donoDoRegistro(r.numero_id ?? null, numeros);
    if (dono) m.set(dono, (m.get(dono) ?? 0) + 1);
  }
  return m;
}

// ------------------------------------------------------------------ alertas

export interface Alerta {
  nivel: "erro" | "aviso";
  numeroId: string | null;
  texto: string;
}

export interface EntradaAlertas {
  numeros: NumeroCRM[];
  status: Map<string, StatusNumero>;
  /** automações/fluxos ligados por número (só alerta desconexão de número que tem algo ligado) */
  ligados: Map<string, number>;
  envioConfig: { ligado: boolean; pausado: boolean; pausado_motivo: string | null } | null;
  campanhasPausadas: { nome: string; pausa_motivo: string | null; numero_id?: string | null }[];
  envios: Map<string, number>;
}

export function montarAlertas(e: EntradaAlertas): Alerta[] {
  const out: Alerta[] = [];
  if (e.envioConfig?.pausado) {
    out.push({
      nivel: "erro",
      numeroId: numeroPadrao(e.numeros)?.id ?? null,
      texto: `Envio não oficial PAUSADO automaticamente${e.envioConfig.pausado_motivo ? `: ${e.envioConfig.pausado_motivo}` : ""}`,
    });
  } else if (e.envioConfig && !e.envioConfig.ligado) {
    out.push({ nivel: "aviso", numeroId: null, texto: "Envio não oficial desligado (Automações > Limites): nada sai pelo OpenWA" });
  }
  for (const n of e.numeros) {
    if (!n.ativo) continue;
    const st = e.status.get(n.id);
    const ligados = e.ligados.get(n.id) ?? 0;
    if (st && (st.estado === "desconectado" || st.estado === "qr") && ligados > 0) {
      out.push({ nivel: "erro", numeroId: n.id, texto: `${n.apelido} ${st.rotulo} com ${ligados} automação(ões)/fluxo(s) ligado(s)` });
    } else if (st && st.estado === "sem_ponte" && ligados > 0) {
      out.push({ nivel: "aviso", numeroId: n.id, texto: `${n.apelido}: ${ligados} ligado(s), mas a ponte ainda não envia por esta sessão` });
    }
    const usados = e.envios.get(n.id) ?? 0;
    if (usados >= n.max_dia) out.push({ nivel: "aviso", numeroId: n.id, texto: `${n.apelido} bateu o limite do dia (${usados}/${n.max_dia})` });
    else if (usados >= Math.ceil(n.max_dia * 0.8)) out.push({ nivel: "aviso", numeroId: n.id, texto: `${n.apelido} em ${usados}/${n.max_dia} envios hoje` });
  }
  for (const c of e.campanhasPausadas) {
    out.push({
      nivel: "aviso",
      numeroId: donoDoRegistro(c.numero_id ?? null, e.numeros),
      texto: `Campanha "${c.nome}" pausada${c.pausa_motivo ? `: ${c.pausa_motivo}` : ""}`,
    });
  }
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "erro" ? -1 : 1));
}

// ------------------------------------------------------------------ links

export type ModuloCentral = "fluxos" | "automacoes" | "disparos" | "grupos" | "roteiros" | "limites";

export const ABAS_CENTRAL: { id: ModuloCentral; rotulo: string }[] = [
  { id: "fluxos", rotulo: "Fluxos" },
  { id: "automacoes", rotulo: "Automações" },
  { id: "disparos", rotulo: "Disparos" },
  { id: "grupos", rotulo: "Grupos" },
  { id: "roteiros", rotulo: "Roteiros" },
  { id: "limites", rotulo: "Limites e horários" },
];

/** Rota de um módulo externo filtrada pelo número (contrato `?numero=`). */
export function linkModulo(caminho: string, numeroId: string | null): string {
  if (!numeroId || ehProvisorio(numeroId)) return caminho;
  const sep = caminho.includes("?") ? "&" : "?";
  return `${caminho}${sep}numero=${encodeURIComponent(numeroId)}`;
}

/** Valida a edição de limites antes de gravar (mesmos CHECKs da migration). */
export function validarLimites(v: { max_hora: number; max_dia: number; hora_inicio: number; hora_fim: number }): string | null {
  const inteiro = (x: number) => Number.isInteger(x);
  if (![v.max_hora, v.max_dia, v.hora_inicio, v.hora_fim].every(inteiro)) return "use números inteiros";
  if (v.max_hora < 1 || v.max_hora > 60) return "máx. por hora entre 1 e 60";
  if (v.max_dia < 1 || v.max_dia > 1000) return "máx. por dia entre 1 e 1000";
  if (v.hora_inicio < 0 || v.hora_inicio > 23) return "início entre 0 e 23 h";
  if (v.hora_fim < 1 || v.hora_fim > 24) return "fim entre 1 e 24 h";
  if (v.hora_inicio >= v.hora_fim) return "o início precisa ser antes do fim";
  if (v.max_hora > v.max_dia) return "máx. por hora não pode passar o do dia";
  return null;
}
