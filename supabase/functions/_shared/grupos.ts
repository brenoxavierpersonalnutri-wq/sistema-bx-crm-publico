// Lógica pura do módulo Grupos do CRM (substitui o SendFlow). Sem Deno, sem rede:
// roda igual na edge function grupos-disparo-tick, no front (src/lib/grupos.ts) e no vitest
// (src/test/grupos.test.ts).
//
// A escolha do grupo do LINK PÚBLICO roda no banco (grupos_resolver_link, migration
// 20261024130000), com a linha da campanha travada. escolherGrupo() abaixo é a MESMA regra,
// usada na tela (prévia de "próximo grupo") e nos testes; mudou uma, muda a outra.

export type TipoMensagemGrupo =
  | "texto" | "imagem" | "video" | "audio" | "documento"
  // Fluxo de Grupo (19/10/2026): enquete e ações de admin agendadas (fechar/abrir o grupo)
  | "enquete" | "travar" | "destravar";
export const TIPOS_MENSAGEM: TipoMensagemGrupo[] = ["texto", "imagem", "video", "audio", "documento", "enquete", "travar", "destravar"];
export const TIPOS_COM_MENCAO: TipoMensagemGrupo[] = ["texto", "imagem", "video", "documento", "audio"];

export interface GrupoDaCampanha {
  id: string;
  ordem: number;
  nome?: string | null;
  /** null = grupo importado da sessão sem convite (número não é admin): recebe disparo, fica fora do link. */
  link_convite: string | null;
  chat_id: string | null;
  ativo: boolean;
  cheio: boolean;
  cliques: number;
  cliques_na_contagem: number;
  participantes: number | null;
  created_at?: string;
  /** peso no modo split (1-100, padrão 1). Migration 20261108110000. */
  peso?: number | null;
}

export const LIMITE_WHATSAPP_GRUPO = 1024;
export const LIMITE_PADRAO = 900;
export const INTERVALO_PADRAO = { min: 20, max: 60 };

// ------------------------------------------------------------------ validação

export const slugValido = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(s);

/** "Desafio 21 Dias!" -> "desafio-21-dias" (sem acento, só a-z0-9 e hífen). */
export function slugDe(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const linkConviteValido = (s: unknown): s is string =>
  typeof s === "string" && /^https:\/\/chat\.whatsapp\.com\/(invite\/)?[A-Za-z0-9]{15,30}$/.test(s.trim());

/** Grupo do WhatsApp: 120363...@g.us ou <criador>-<epoch>@g.us. */
export const chatIdGrupoValido = (s: unknown): s is string =>
  typeof s === "string" && /^\d{5,25}(-\d{5,15})?@g\.us$/.test(s);

// ------------------------------------------------------------------ distribuição

/** Ocupação estimada: participantes da última contagem + cliques depois dela (sem contagem: cliques). */
export function ocupacao(g: Pick<GrupoDaCampanha, "participantes" | "cliques" | "cliques_na_contagem">): number {
  return (g.participantes ?? 0) + Math.max(g.cliques - g.cliques_na_contagem, 0);
}

function ordenar<T extends Pick<GrupoDaCampanha, "ordem" | "created_at" | "id">>(grupos: T[]): T[] {
  return [...grupos].sort((a, b) =>
    a.ordem - b.ordem || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id)
  );
}

/**
 * Próximo grupo do link: o primeiro da ordem que está ativo, não marcado cheio e com ocupação
 * abaixo do limite. null = todos lotados (o link põe quem clicou em espera e o disparador cria o próximo grupo).
 */
export function escolherGrupo<T extends GrupoDaCampanha>(grupos: T[], limite: number): T | null {
  const teto = Math.min(Math.max(Math.floor(limite) || 0, 1), LIMITE_WHATSAPP_GRUPO);
  for (const g of ordenar(grupos)) {
    if (g.ativo && !g.cheio && g.link_convite && ocupacao(g) < teto) return g;
  }
  return null;
}

// ------------------------------------------------------------------ modo de distribuição (20/10/2026)

/** encher = um grupo por vez até lotar (padrão); split = reparte as entradas entre todos os grupos com vaga. */
export type ModoDistribuicao = "encher" | "split";
export const MODOS_DISTRIBUICAO: ModoDistribuicao[] = ["encher", "split"];

export const pesoValido = (p: unknown): number => {
  const n = Math.floor(Number(p));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 1;
};

/**
 * Split: entre os grupos ativos, não cheios, com link e abaixo do limite, o de MENOR ocupação/peso
 * (empate: ordem da campanha). Peso 70 x 30 = o primeiro recebe ~70% enquanto os dois têm vaga.
 * Mesma regra do grupos_resolver_link no banco (migration 20261108110000); mudou uma, muda a outra.
 */
export function escolherGrupoSplit<T extends GrupoDaCampanha>(grupos: T[], limite: number): T | null {
  const teto = Math.min(Math.max(Math.floor(limite) || 0, 1), LIMITE_WHATSAPP_GRUPO);
  let melhor: T | null = null;
  let razao = Infinity;
  for (const g of ordenar(grupos)) {
    if (!g.ativo || g.cheio || !g.link_convite || ocupacao(g) >= teto) continue;
    const r = ocupacao(g) / pesoValido(g.peso ?? 1);
    if (r < razao) { razao = r; melhor = g; }
  }
  return melhor;
}

export function escolherGrupoModo<T extends GrupoDaCampanha>(grupos: T[], limite: number, modo: ModoDistribuicao | null | undefined): T | null {
  return modo === "split" ? escolherGrupoSplit(grupos, limite) : escolherGrupo(grupos, limite);
}

/** Ocupação em % do limite (0-100, arredondado). */
export function ocupacaoPct(g: Pick<GrupoDaCampanha, "participantes" | "cliques" | "cliques_na_contagem">, limite: number): number {
  const teto = Math.min(Math.max(Math.floor(limite) || 0, 1), LIMITE_WHATSAPP_GRUPO);
  return Math.min(100, Math.round((ocupacao(g) / teto) * 100));
}

// ------------------------------------------------------------------ número e permissão no grupo

/**
 * Só o número da 2ª instância do OpenWA (motor Baileys, sessões "grupos-N") cria grupo. Os demais
 * (whatsapp-web.js) mandam e configuram, mas não criam.
 */
export const numeroCriaGrupo = (sessaoOpenwa: string | null | undefined): boolean =>
  typeof sessaoOpenwa === "string" && /^grupos-\d{1,3}$/.test(sessaoOpenwa);

export const MSG_NUMERO_NAO_CRIA = "Este número não cria grupo automaticamente. Só o número Grupos 1 (OpenWA Baileys) cria; aqui, crie o grupo no celular e importe.";

/** O que o número pode fazer no grupo (lido do proxy em group-info). */
export type PermissaoGrupo = "admin" | "so_envio" | "sem_permissao" | "desconhecida";

export function permissaoGrupo(p: { sou_admin?: boolean | null; anuncio?: boolean | null }): PermissaoGrupo {
  if (p.sou_admin === true) return "admin";
  if (p.sou_admin === false) {
    if (p.anuncio === true) return "sem_permissao";
    if (p.anuncio === false) return "so_envio";
  }
  return "desconhecida";
}

export const ROTULO_PERMISSAO: Record<PermissaoGrupo, string> = {
  admin: "admin",
  so_envio: "só envio",
  sem_permissao: "só admins enviam — sem permissão",
  desconhecida: "permissão não lida",
};

/** Ações de configuração precisam de admin; disparo precisa de admin ou grupo aberto. */
export const podeConfigurar = (p: PermissaoGrupo) => p === "admin";
export const podeDisparar = (p: PermissaoGrupo) => p !== "sem_permissao";

/** Simula N cliques seguidos (como o banco faria, um a um). Devolve os ids escolhidos (null = lotado). */
export function simularCliques<T extends GrupoDaCampanha>(grupos: T[], limite: number, n: number, modo: ModoDistribuicao = "encher"): (string | null)[] {
  const copia = grupos.map((g) => ({ ...g }));
  const saida: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const g = escolherGrupoModo(copia, limite, modo);
    if (g) g.cliques += 1;
    saida.push(g ? g.id : null);
  }
  return saida;
}

// ------------------------------------------------------------------ agenda

export function intervaloAleatorioS(min: number, max: number, rand: () => number = Math.random): number {
  const a = Math.max(1, Math.floor(Math.min(min, max)));
  const b = Math.max(a, Math.floor(Math.max(min, max)));
  return a + Math.floor(rand() * (b - a + 1));
}

export interface EnvioPlanejado {
  grupo_id: string;
  chat_id: string;
  ordem: number;
  proximo_em: string;
}

/**
 * Plano de envio de UMA mensagem: grupos ativos com chat_id, na ordem da campanha; o primeiro em
 * `inicio`, cada seguinte depois de um intervalo aleatório [min, max] segundos.
 * Grupo só com link (sem chat_id) não recebe: o CRM não sabe o id dele.
 */
export function planejarEnvios(
  grupos: GrupoDaCampanha[],
  inicio: Date,
  minS: number,
  maxS: number,
  rand: () => number = Math.random,
  /** grupos_mensagens.grupos_alvo: só estes ids (Disparo em grupo). null/vazio = todos da campanha. */
  alvo: string[] | null = null,
): EnvioPlanejado[] {
  const filtro = alvo && alvo.length ? new Set(alvo) : null;
  const alvos = ordenar(grupos).filter((g) => g.ativo && chatIdGrupoValido(g.chat_id) && (!filtro || filtro.has(g.id)));
  const vistos = new Set<string>();
  const saida: EnvioPlanejado[] = [];
  let t = inicio.getTime();
  for (const g of alvos) {
    if (vistos.has(g.chat_id!)) continue; // mesmo grupo cadastrado 2x: uma mensagem só
    vistos.add(g.chat_id!);
    if (saida.length) t += intervaloAleatorioS(minS, maxS, rand) * 1000;
    saida.push({ grupo_id: g.id, chat_id: g.chat_id!, ordem: saida.length, proximo_em: new Date(t).toISOString() });
  }
  return saida;
}

export interface MensagemGrupo {
  tipo: TipoMensagemGrupo;
  texto: string | null;
  midia_path: string | null;
  nome_arquivo?: string | null;
  link_preview?: boolean;
  agendado_para?: string;
  enquete_opcoes?: string[] | null;
  enquete_multipla?: boolean;
  ptt?: boolean;
  mencionar_todos?: boolean;
}

/** Erros de uma mensagem antes de agendar/editar (vazio = ok). */
export function problemasMensagem(m: MensagemGrupo, agora: Date = new Date()): string[] {
  const erros: string[] = [];
  if (!TIPOS_MENSAGEM.includes(m.tipo)) erros.push("Tipo inválido.");
  const texto = (m.texto ?? "").trim();
  if (m.tipo === "texto") {
    if (!texto) erros.push("Escreva o texto.");
    if (texto.length > 4096) erros.push("Texto passa de 4096 caracteres.");
  } else if (m.tipo === "enquete") {
    if (!texto) erros.push("Escreva a pergunta da enquete.");
    if (texto.length > 255) erros.push("Pergunta passa de 255 caracteres.");
    const ops = (m.enquete_opcoes ?? []).map((o) => o.trim()).filter(Boolean);
    if (ops.length < 2 || ops.length > 12) erros.push("Enquete precisa de 2 a 12 opções.");
    if (ops.some((o) => o.length > 100)) erros.push("Opção passa de 100 caracteres.");
    if (new Set(ops).size !== ops.length) erros.push("Opções repetidas.");
  } else if (m.tipo === "travar" || m.tipo === "destravar") {
    if (texto || m.midia_path) erros.push("Fechar/abrir o grupo não leva texto nem mídia.");
  } else {
    if (!m.midia_path) erros.push("Envie o arquivo da mídia.");
    if (m.tipo === "audio" && texto) erros.push("Áudio não leva legenda (mande o texto numa mensagem separada).");
    if (texto.length > 1024) erros.push("Legenda passa de 1024 caracteres.");
  }
  if (m.ptt && m.tipo !== "audio") erros.push("Nota de voz só vale para áudio.");
  if (m.mencionar_todos && !TIPOS_COM_MENCAO.includes(m.tipo)) erros.push("Mencionar todos não vale para este tipo.");
  if (m.agendado_para !== undefined) {
    const t = Date.parse(m.agendado_para);
    if (!Number.isFinite(t)) erros.push("Data/hora inválida.");
    else if (t < agora.getTime() - 60_000) erros.push("Data/hora já passou.");
  }
  return erros;
}

export type RotaProxyGrupo = "send-group-text" | "send-group-media" | "send-group-poll" | "group-settings";

/** Rota e corpo do proxy (infra/wa-proxy) para mandar a mensagem (ou a ação) a um grupo. */
export function pedidoProxyGrupo(
  m: MensagemGrupo,
  chatId: string,
  urlMidia: string | null,
  sessao: string | null,
): { rota: RotaProxyGrupo; corpo: Record<string, unknown> } | { erro: string } {
  if (!chatIdGrupoValido(chatId)) return { erro: "chat_id inválido" };
  const extra = sessao ? { sessao } : {};
  const mencao = m.mencionar_todos && TIPOS_COM_MENCAO.includes(m.tipo) ? { mentionAll: true } : {};
  const texto = (m.texto ?? "").trim();
  if (m.tipo === "texto") {
    if (!texto) return { erro: "texto vazio" };
    return {
      rota: "send-group-text",
      corpo: { chatId, text: texto, ...(m.link_preview !== false && /https:\/\//.test(texto) ? { linkPreview: true } : {}), ...mencao, ...extra },
    };
  }
  if (m.tipo === "enquete") {
    const ops = (m.enquete_opcoes ?? []).map((o) => o.trim()).filter(Boolean);
    if (!texto || ops.length < 2) return { erro: "enquete incompleta" };
    return { rota: "send-group-poll", corpo: { chatId, name: texto.slice(0, 255), options: ops.slice(0, 12), multiple: Boolean(m.enquete_multipla), ...extra } };
  }
  if (m.tipo === "travar" || m.tipo === "destravar") {
    return { rota: "group-settings", corpo: { chatId, announce: m.tipo === "travar", ...extra } };
  }
  if (!urlMidia || !/^https:\/\//.test(urlMidia)) return { erro: "mídia sem link" };
  const kind = ({ imagem: "image", video: "video", audio: "audio", documento: "document" } as Record<string, string>)[m.tipo];
  if (!kind) return { erro: "tipo inválido" };
  return {
    rota: "send-group-media",
    corpo: {
      chatId,
      kind,
      url: urlMidia,
      ...(texto && m.tipo !== "audio" ? { caption: texto } : {}),
      ...(m.tipo === "documento" && m.nome_arquivo ? { filename: m.nome_arquivo.slice(0, 255) } : {}),
      ...(m.tipo === "audio" && m.ptt ? { ptt: true } : {}),
      ...mencao,
      ...extra,
    },
  };
}

/** Resumo de status das linhas de envio de uma mensagem. */
export function resumoEnvios(linhas: { status: string }[]) {
  const r = { total: linhas.length, enviados: 0, falhas: 0, pendentes: 0, cancelados: 0 };
  for (const l of linhas) {
    if (l.status === "enviado") r.enviados++;
    else if (l.status === "falhou") r.falhas++;
    else if (l.status === "cancelado") r.cancelados++;
    else r.pendentes++;
  }
  return r;
}

/** Parâmetros do link público que viram UTM do clique. */
export function utmDaUrl(search: string): Record<string, string> {
  const p = new URLSearchParams(search);
  const saida: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "origem"]) {
    const v = p.get(k);
    if (v) saida[k] = v.slice(0, 200);
  }
  return saida;
}

// ------------------------------------------------------------------ Fluxo de Grupo (19/10/2026)

/** Intervalo entre grupos respeitando o teto por minuto da campanha (ex.: teto 3 -> nunca menos de 20 s). */
export function intervaloEfetivo(minS: number, maxS: number, tetoPorMinuto: number): { min: number; max: number } {
  const teto = Math.min(Math.max(Math.floor(tetoPorMinuto) || 1, 1), 6);
  const piso = Math.ceil(60 / teto);
  const min = Math.max(Math.floor(minS) || 1, piso);
  return { min, max: Math.max(Math.floor(maxS) || 1, min) };
}

export interface RegraCriacao {
  limite_por_grupo: number;
  folga_vagas: number;
  max_grupos: number;
}

/** Vagas somadas dos grupos ativos e não cheios (mesma regra de grupos_vagas() no banco). */
export function vagas(grupos: GrupoDaCampanha[], limite: number): number {
  const teto = Math.min(Math.max(Math.floor(limite) || 0, 1), LIMITE_WHATSAPP_GRUPO);
  return grupos.filter((g) => g.ativo && !g.cheio).reduce((s, g) => s + Math.max(teto - ocupacao(g), 0), 0);
}

/** Cria o próximo grupo quando as vagas ficam abaixo da folga, até o teto de grupos da campanha. */
export function precisaNovoGrupo(grupos: GrupoDaCampanha[], r: RegraCriacao): boolean {
  if (grupos.length >= r.max_grupos) return false;
  return vagas(grupos, r.limite_por_grupo) < r.folga_vagas;
}

/** "Desafio 21D" + 3 -> "Desafio 21D 03" (o WhatsApp corta o assunto em 100). */
export function nomeNovoGrupo(prefixo: string, n: number): string {
  const p = prefixo.trim().replace(/\s+/g, " ");
  return `${p} ${String(Math.max(1, Math.floor(n))).padStart(2, "0")}`.slice(0, 100);
}

/** Telefone de admin: só dígitos com DDI. BR sem DDI (10/11 dígitos) ganha 55. Inválido = null. */
export function telefoneAdmin(bruto: string): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** Resultado do group-admins do proxy (21/10/2026): um por telefone pedido. */
export interface ResultadoAdmin {
  telefone: string;
  numero: string | null;
  verificado?: boolean;
  membro: boolean;
  admin: boolean;
  erro?: string;
}

/**
 * Resposta do group-admins -> { ok, texto }. Texto curto para o aviso da criação e o toast da tela, um trecho por
 * telefone que falhou ("5531990000103 (WhatsApp 553190000103): a privacidade do número não deixa adicionar...").
 */
export function textoResultadoAdmins(resp: unknown): { ok: boolean; texto: string } {
  const r = (resp && typeof resp === "object" ? resp : {}) as { ok?: unknown; resultados?: unknown; conferido?: unknown };
  const lista = (Array.isArray(r.resultados) ? r.resultados : []) as ResultadoAdmin[];
  if (!lista.length) return { ok: false, texto: "o proxy não devolveu o resultado por número (proxy desatualizado?)" };
  const quem = (x: ResultadoAdmin) => (x.numero && x.numero !== x.telefone ? `${x.telefone} (WhatsApp ${x.numero})` : x.telefone);
  const falhas = lista.filter((x) => !x.admin);
  const ok = r.ok === true && falhas.length === 0;
  if (ok) {
    return { ok, texto: `${lista.length} admin(s) no grupo: ${lista.map(quem).join(", ")}${r.conferido === false ? " (sem releitura do grupo)" : ""}` };
  }
  return { ok, texto: falhas.map((x) => `${quem(x)}: ${x.erro ?? "não virou admin"}`).join(" · ") };
}

/** Erro do proxy fora da criação -> "proxy 502 (OpenWA 500): mensagem" (o status e o motivo, nunca só "proxy 502"). */
export function erroProxyLegivel(statusProxy: number, detalhe: unknown): string {
  const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as { error?: unknown; status?: unknown; message?: unknown };
  const orig = typeof d.status === "number" ? d.status : statusProxy;
  const corpo = typeof detalhe === "string" ? detalhe : [d.error, d.message].filter((x) => typeof x === "string" && x && x !== "openwa").join(": ");
  const status = orig !== statusProxy ? `${statusProxy} (OpenWA ${orig})` : String(statusProxy);
  return `proxy ${status}${corpo ? `: ${corpo.slice(0, 200)}` : ""}`;
}

/** Ordem das etapas da criação; retomar começa da primeira que não foi feita. */
export const ETAPAS_CRIACAO = ["criar", "ajustes", "descricao", "foto", "admins", "convite", "pronto"] as const;
export type EtapaCriacao = typeof ETAPAS_CRIACAO[number];
export const etapaDepois = (e: EtapaCriacao, alvo: EtapaCriacao) => ETAPAS_CRIACAO.indexOf(e) <= ETAPAS_CRIACAO.indexOf(alvo);

/**
 * Texto da boas-vindas para um lote de quem entrou. {mencoes} vira "@5511... @5521..." (menção
 * visível, que é o que o WhatsApp mostra como marcação); sem o marcador e com mencionar, as menções
 * vão numa linha no fim. Sem mencionar, o texto sai igual e sem ids.
 */
export function textoBoasVindas(modelo: string, ids: string[], mencionar: boolean): { text: string; mentions: string[] } {
  const base = modelo.trim();
  const validos = [...new Set(ids.filter((i) => /^(\d{8,15}@c\.us|\d{5,25}@lid)$/.test(i)))].slice(0, 50);
  if (!mencionar || !validos.length) return { text: base.replace(/\{mencoes\}/g, "").trim(), mentions: [] };
  const tokens = validos.map((i) => `@${i.split("@")[0]}`).join(" ");
  const text = base.includes("{mencoes}") ? base.replace(/\{mencoes\}/g, tokens) : `${base}\n\n${tokens}`;
  return { text: text.slice(0, 4096), mentions: validos };
}

/** Evento de membros do OpenWA (group.join / group.leave) -> o que o banco grava; null = não é desse tipo. */
export function interpretarEventoGrupo(envelope: unknown): { chatId: string; tipo: "entrada" | "saida"; participantes: string[]; chave: string } | null {
  if (!envelope || typeof envelope !== "object") return null;
  const e = envelope as Record<string, unknown>;
  const ev = String(e.event ?? "");
  if (ev !== "group.join" && ev !== "group.leave") return null;
  const d = (e.data && typeof e.data === "object") ? e.data as Record<string, unknown> : {};
  const chatId = typeof d.groupId === "string" ? d.groupId : typeof d.chatId === "string" ? d.chatId : "";
  if (!chatIdGrupoValido(chatId)) return null;
  const brutos = Array.isArray(d.participantIds) ? d.participantIds : Array.isArray(d.participants) ? d.participants : [];
  const participantes = [...new Set(brutos.filter((p): p is string => typeof p === "string" && /^(\d{8,15}@c\.us|\d{5,25}@lid)$/.test(p)))].slice(0, 256);
  const ts = typeof d.timestamp === "number" || typeof d.timestamp === "string" ? String(d.timestamp) : typeof e.timestamp === "string" ? e.timestamp : "";
  return {
    chatId,
    tipo: ev === "group.join" ? "entrada" : "saida",
    participantes,
    chave: `${ev}|${chatId}|${ts}|${[...participantes].sort().join(",")}`,
  };
}

/** Minutos relativos ao evento -> rótulo curto ("D-1 · 2h antes", "ao vivo", "30 min depois"). */
export function rotuloRelativo(offsetMin: number): string {
  if (offsetMin === 0) return "na hora do evento";
  const abs = Math.abs(offsetMin);
  const d = Math.floor(abs / 1440), h = Math.floor((abs % 1440) / 60), mi = abs % 60;
  const partes = [d ? `${d}d` : "", h ? `${h}h` : "", mi ? `${mi}min` : ""].filter(Boolean).join(" ");
  return `${partes} ${offsetMin < 0 ? "antes" : "depois"} do evento`;
}

/** Dias/horas/minutos + sentido -> offset em minutos (limitado a ±30 dias). */
export function offsetDe(dias: number, horas: number, minutos: number, antes: boolean): number {
  const t = Math.max(0, Math.floor(dias || 0)) * 1440 + Math.max(0, Math.floor(horas || 0)) * 60 + Math.max(0, Math.floor(minutos || 0));
  return Math.min(t, 43200) * (antes ? -1 : 1);
}

export const MSG_CRIAR_GRUPO_NAO_SUPORTADO =
  "Este número não consegue criar grupo automaticamente (motor do WhatsApp atual não suporta). Crie o grupo no celular e cadastre na aba Grupos.";

/**
 * Erro legível para falha do group-create no proxy. O proxy converte 5xx do OpenWA em 502, mas o corpo
 * guarda o status original ({ error, status, message }); 501 ou corpo "não suportado" = motor sem criação de grupo.
 */
export function erroCriacaoGrupo(statusProxy: number, detalhe: unknown): string {
  const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as { error?: unknown; status?: unknown; message?: unknown };
  const orig = typeof d.status === "number" ? d.status : statusProxy;
  const corpo = typeof detalhe === "string" ? detalhe : [d.error, d.message].filter((x) => typeof x === "string" && x).join(": ");
  if (statusProxy === 501 || orig === 501 || /n[aã]o suportad|not (supported|implemented)|unsupported/i.test(corpo)) {
    return MSG_CRIAR_GRUPO_NAO_SUPORTADO;
  }
  const status = orig !== statusProxy ? `${statusProxy} (OpenWA ${orig})` : String(statusProxy);
  return `proxy ${status}${corpo ? `: ${corpo.slice(0, 200)}` : ""}`;
}

// ------------------------------------------------------------------ Lotou, cria grupo (21/10/2026)
//
// Plano B de lotado é SEMPRE criar o próximo grupo (pedido do Breno): não existe mais liga/desliga nem URL de
// lotado. Quem clica sem vaga espera na página ("Preparando seu grupo…") até o grupo novo ter convite.
// Travas anti-ban, todas por NÚMERO (o WhatsApp bane o número, não a campanha):
//  - 1 criação em andamento por campanha (índice único em grupos_criacoes, migration 20261122100000);
//  - pausa mínima entre criações do mesmo número;
//  - teto diário de grupos criados por número (dia de Brasília).
// Só o número de grupos (sessão grupos-N, "Grupos 1") cria: numeroCriaGrupo().

export const PAUSA_ENTRE_CRIACOES_MS = 2 * 60_000;
export const TETO_CRIACOES_DIA_POR_NUMERO = 10;
/** Falhas seguidas de criação que acendem o alerta no painel. */
export const FALHAS_PARA_ALERTA = 3;

/** 00:00 de hoje em Brasília (UTC-3 fixo: o Brasil não tem horário de verão desde 2019), em UTC. */
export function inicioDoDiaSP(agora: Date): Date {
  const sp = agora.getTime() - 3 * 3600_000;
  const meiaNoite = Math.floor(sp / 86_400_000) * 86_400_000;
  return new Date(meiaNoite + 3 * 3600_000);
}

/** Nome do grupo novo: prefixo da campanha; sem prefixo, o nome da campanha. */
export function nomeGrupoDaCampanha(prefixo: string | null | undefined, nomeCampanha: string, n: number): string {
  const base = (prefixo ?? "").trim() || nomeCampanha.trim() || "Grupo";
  return nomeNovoGrupo(base, n);
}

export interface EstadoTravaCriacao {
  agora: Date;
  /** o número da campanha é o de grupos (grupos-N)? */
  numeroCria: boolean;
  admins: number;
  gruposNaCampanha: number;
  maxGrupos: number;
  /** created_at da criação mais recente do número (qualquer campanha), ou null */
  ultimaCriacaoNumero: string | null;
  /** criações do número desde 00:00 de Brasília (qualquer campanha, qualquer status) */
  criadasHojeNumero: number;
  pausaMs?: number;
  tetoDia?: number;
}

export type CodigoTrava = "numero_nao_cria" | "sem_admin" | "teto_campanha" | "teto_dia" | "pausa";
export type DecisaoTrava =
  | { pode: true }
  | { pode: false; codigo: CodigoTrava; mensagem: string; retomarEm: string | null; alerta: boolean };

/**
 * Pode começar uma criação de grupo AGORA? Não decide se precisa (isso é precisaNovoGrupo / botão "criar agora"):
 * decide se é seguro. `alerta` = o painel "O que precisa de atenção" deve mostrar (o que é passageiro não alerta).
 * "1 criação em andamento por campanha" não passa por aqui: quem tem criação pendente RETOMA a pendente
 * (criarProximoGrupo) e o banco recusa a segunda (índice único grupos_criacoes_uma_em_andamento).
 */
export function travaCriacao(e: EstadoTravaCriacao): DecisaoTrava {
  const pausa = e.pausaMs ?? PAUSA_ENTRE_CRIACOES_MS;
  const teto = e.tetoDia ?? TETO_CRIACOES_DIA_POR_NUMERO;
  const nao = (codigo: CodigoTrava, mensagem: string, alerta: boolean, retomarEm: Date | null = null): DecisaoTrava =>
    ({ pode: false, codigo, mensagem, alerta, retomarEm: retomarEm ? retomarEm.toISOString() : null });
  if (!e.numeroCria) return nao("numero_nao_cria", MSG_NUMERO_NAO_CRIA, true);
  if (e.admins < 1) {
    return nao("sem_admin", "Cadastre pelo menos 1 admin na configuração de criação da campanha: o WhatsApp não cria grupo só com o número.", true);
  }
  if (e.gruposNaCampanha >= e.maxGrupos) {
    return nao("teto_campanha", `A campanha chegou ao máximo de ${e.maxGrupos} grupos. Aumente o máximo na configuração de criação.`, true);
  }
  if (e.criadasHojeNumero >= teto) {
    const amanha = new Date(inicioDoDiaSP(e.agora).getTime() + 86_400_000);
    return nao("teto_dia", `O número já criou ${e.criadasHojeNumero} grupos hoje (teto diário de ${teto}). O próximo grupo nasce depois da meia-noite (Brasília).`, true, amanha);
  }
  if (e.ultimaCriacaoNumero) {
    const libera = Date.parse(e.ultimaCriacaoNumero) + pausa;
    if (Number.isFinite(libera) && libera > e.agora.getTime()) {
      return nao("pausa", `Pausa de ${Math.round(pausa / 60_000)} min entre criações do mesmo número.`, false, new Date(libera));
    }
  }
  return { pode: true };
}
