// Criação do próximo grupo de uma campanha (Disparo em grupo). Sem Deno, sem rede: o banco e o proxy
// entram por uma "porta" (PortaCriacao). A edge grupos-disparo-tick liga a porta no Supabase e no proxy da
// VPS; o vitest (src/test/grupoCriacao.test.ts) liga num banco falso em memória e num proxy falso.
//
// Regra desde 21/10/2026 (Breno: "esse plano B tem que ser sempre criar um grupo"): toda campanha que não
// é a "Avulsos" cria o próximo grupo quando as vagas ficam abaixo da folga. Não há liga/desliga. O que segura
// a criação são as travas anti-ban de travaCriacao() (número de grupos, admin, máximo da campanha, teto
// diário e pausa por número) e a regra de 1 criação em andamento por campanha (retoma a pendente; o banco
// recusa a segunda). Cada bloqueio que precisa de gente vira criacao_bloqueio na campanha (painel "O que
// precisa de atenção"); falha conta em criacao_falhas_seguidas (alerta a partir de FALHAS_PARA_ALERTA).
import {
  type GrupoDaCampanha,
  type EtapaCriacao,
  chatIdGrupoValido,
  inicioDoDiaSP,
  nomeGrupoDaCampanha,
  PAUSA_ENTRE_CRIACOES_MS,
  TETO_CRIACOES_DIA_POR_NUMERO,
  textoResultadoAdmins,
  travaCriacao,
  vagas,
} from "./grupos.ts";

export interface CampanhaFluxo {
  id: string;
  nome: string;
  numero_id: string | null;
  limite_por_grupo: number;
  prefixo_nome: string | null;
  proximo_numero: number;
  descricao_grupo: string | null;
  foto_path: string | null;
  admins_telefones: string[] | null;
  so_admins_enviam: boolean;
  so_admins_editam: boolean;
  folga_vagas: number;
  max_grupos: number;
  encerrada: boolean;
  link_pausado: boolean;
  avulsa?: boolean;
  // migration 20261122100000 (sem ela, undefined: a criação funciona, só o painel não recebe o estado)
  criacao_falhas_seguidas?: number;
  criacao_bloqueio?: string | null;
  criacao_ultimo_erro?: string | null;
}

export interface Criacao {
  id: string;
  numero: number;
  nome: string;
  chat_id: string | null;
  etapa: EtapaCriacao;
  status: string;
  tentativas: number;
  avisos: string[];
  erro?: string | null;
  updated_at: string;
}

export interface LinhaGrupoNovo {
  campanha_id: string;
  ordem: number;
  nome: string;
  link_convite: string;
  chat_id: string;
  criado_pelo_crm: true;
  travado: boolean;
  participantes: number;
  participantes_em: string;
  cliques: 0;
  cliques_na_contagem: 0;
}

export interface EstadoCriacaoCampanha {
  criacao_bloqueio?: string | null;
  criacao_bloqueio_em?: string | null;
  criacao_retomar_em?: string | null;
  criacao_falhas_seguidas?: number;
  criacao_ultimo_erro?: string | null;
}

export interface PortaCriacao {
  agora(): Date;
  grupos(campanhaId: string): Promise<GrupoDaCampanha[]>;
  numeroCria(numeroId: string | null): Promise<boolean>;
  /** criação "criando"/"erro" mais recente da campanha (retomável), ou null */
  pendente(campanhaId: string): Promise<Criacao | null>;
  abandonadas24h(campanhaId: string): Promise<number>;
  /** criações do número (todas as campanhas dele) desde `desde`, sem a `excluir` */
  historicoNumero(numeroId: string, desde: Date, inicioDia: Date, excluir?: string): Promise<{ ultima: string | null; hoje: number }>;
  /** proximo_numero: numero -> numero+1 só se ainda for `numero` (concorrência) */
  reservarNumero(campanhaId: string, numero: number): Promise<boolean>;
  devolverNumero(campanhaId: string, numero: number): Promise<void>;
  /** duplicada = o banco recusou porque já há criação em andamento nesta campanha */
  inserirCriacao(campanhaId: string, numero: number, nome: string): Promise<{ criacao?: Criacao; duplicada?: boolean; erro?: string }>;
  atualizarCriacao(id: string, patch: Record<string, unknown>): Promise<void>;
  gravarGrupo(linha: LinhaGrupoNovo): Promise<string | null>;
  estadoCampanha(campanhaId: string, patch: EstadoCriacaoCampanha): Promise<void>;
  // JSON livre do proxy; cada etapa valida o que lê
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proxy(rota: string, corpo: Record<string, unknown>, opcoes?: { timeoutMs?: number }): Promise<any>;
  /** sessão do número (null = padrão); lança erro legível quando não dá */
  sessao(numeroId: string | null): Promise<string | null>;
  allowlist(extras: string[]): Promise<unknown>;
  urlAssinada(path: string): Promise<string>;
  /** erro -> texto curto e legível (o painel mostra) */
  erroLegivel(e: unknown, etapa: EtapaCriacao): string;
}

export const ESPERA_RETENTATIVA_MS = 5 * 60_000;
export const TENTATIVAS_POR_CRIACAO = 3;

/** As vagas pedem grupo novo? (sem olhar o máximo da campanha: bater no máximo é alerta, não "vagas suficientes") */
export const vagasPedemGrupo = (grupos: GrupoDaCampanha[], c: Pick<CampanhaFluxo, "limite_por_grupo" | "folga_vagas">) =>
  vagas(grupos, c.limite_por_grupo) < c.folga_vagas;

/**
 * Cria (ou retoma) o próximo grupo de UMA campanha. `forcar` = botão "criar agora" / criação agendada: ignora a
 * folga e a parada por abandonos, mas NUNCA as travas anti-ban. Devolve um resumo curto do que aconteceu.
 */
export async function criarProximoGrupo(p: PortaCriacao, c: CampanhaFluxo, forcar = false): Promise<string> {
  const agora = p.agora();
  const grupos = await p.grupos(c.id);
  let cr = await p.pendente(c.id);
  const admins = (c.admins_telefones ?? []).filter(Boolean);
  const limparBloqueio = async () => {
    if (c.criacao_bloqueio) await p.estadoCampanha(c.id, { criacao_bloqueio: null, criacao_bloqueio_em: null, criacao_retomar_em: null });
  };

  if (!cr && !forcar && !vagasPedemGrupo(grupos, c)) {
    await limparBloqueio();
    return "vagas suficientes";
  }
  if (cr && cr.status === "erro" && agora.getTime() - Date.parse(cr.updated_at) < ESPERA_RETENTATIVA_MS) return "aguardando nova tentativa";
  if (cr && cr.tentativas >= TENTATIVAS_POR_CRIACAO) {
    await p.atualizarCriacao(cr.id, { status: "abandonada" });
    return `criação abandonada depois de ${TENTATIVAS_POR_CRIACAO} tentativas (veja o log)`;
  }

  // vai chamar group-create no WhatsApp? (criação nova, ou retomada que não passou da 1ª etapa)
  if (!cr || cr.etapa === "criar" || !cr.chat_id) {
    if (!cr && !forcar && (await p.abandonadas24h(c.id)) >= 2) {
      const msg = "Criação parada: 2 tentativas abandonadas nas últimas 24 h (veja o erro no histórico da aba Criação). Volta sozinha, ou use \"Criar o próximo grupo agora\".";
      await p.estadoCampanha(c.id, { criacao_bloqueio: msg, criacao_bloqueio_em: agora.toISOString(), criacao_retomar_em: null });
      return "criação parada: 2 abandonadas em 24 h";
    }
    const numeroCria = await p.numeroCria(c.numero_id);
    const inicioDia = inicioDoDiaSP(agora);
    const desde = new Date(Math.min(inicioDia.getTime(), agora.getTime() - PAUSA_ENTRE_CRIACOES_MS));
    const hist = numeroCria && c.numero_id
      ? await p.historicoNumero(c.numero_id, desde, inicioDia, cr?.id)
      : { ultima: null, hoje: 0 };
    const d = travaCriacao({
      agora, numeroCria, admins: admins.length,
      gruposNaCampanha: grupos.length,
      maxGrupos: c.max_grupos, ultimaCriacaoNumero: hist.ultima, criadasHojeNumero: hist.hoje,
      pausaMs: PAUSA_ENTRE_CRIACOES_MS, tetoDia: TETO_CRIACOES_DIA_POR_NUMERO,
    });
    if ("codigo" in d) { // travado ("in": o tsconfig do app não estreita união por boolean)
      await p.estadoCampanha(c.id, {
        criacao_bloqueio: d.alerta ? d.mensagem : null,
        criacao_bloqueio_em: d.alerta ? agora.toISOString() : null,
        criacao_retomar_em: d.retomarEm,
      });
      return `trava (${d.codigo}): ${d.mensagem}`;
    }
  }

  if (!cr) {
    const numero = c.proximo_numero;
    const nome = nomeGrupoDaCampanha(c.prefixo_nome, c.nome, numero);
    if (!(await p.reservarNumero(c.id, numero))) return "número do grupo mudou; tenta no próximo tick";
    const r = await p.inserirCriacao(c.id, numero, nome);
    if (!r.criacao) {
      await p.devolverNumero(c.id, numero);
      return r.duplicada ? "já tem uma criação em andamento nesta campanha" : `log de criação: ${r.erro ?? "?"}`;
    }
    cr = r.criacao;
  }

  const atual = cr;
  const avisos = [...(atual.avisos ?? [])];
  let etapa: EtapaCriacao = atual.etapa;
  try {
    const sessao = await p.sessao(c.numero_id);
    const extra = sessao ? { sessao } : {};
    let chatId = atual.chat_id;
    if (etapa === "criar" || !chatId) {
      etapa = "criar";
      const r = await p.proxy("group-create", { name: atual.nome, participants: admins, ...extra }, { timeoutMs: 45_000 });
      if (!chatIdGrupoValido(r?.chatId)) throw new Error("o proxy não devolveu o id do grupo criado");
      chatId = r.chatId as string;
      etapa = "ajustes";
      await p.atualizarCriacao(atual.id, { chat_id: chatId, etapa, status: "criando" });
    }
    await p.allowlist([chatId!]);
    // etapas opcionais: falhou vira aviso e segue (o grupo funciona sem elas)
    const opcional = async (nome: EtapaCriacao, proxima: EtapaCriacao, fazer: () => Promise<unknown>) => {
      if (etapa !== nome) return;
      try { await fazer(); } catch (e) { avisos.push(`${nome}: ${p.erroLegivel(e, nome)}`.slice(0, 300)); }
      etapa = proxima;
      await p.atualizarCriacao(atual.id, { etapa, avisos });
    };
    await opcional("ajustes", "descricao", () =>
      p.proxy("group-settings", { chatId, announce: c.so_admins_enviam, locked: c.so_admins_editam, ...extra }));
    await opcional("descricao", "foto", async () => {
      if (c.descricao_grupo?.trim()) await p.proxy("group-description", { chatId, description: c.descricao_grupo.slice(0, 1024), ...extra });
    });
    await opcional("foto", "admins", async () => {
      if (c.foto_path) await p.proxy("group-picture", { chatId, url: await p.urlAssinada(c.foto_path), ...extra }, { timeoutMs: 40_000 });
    });
    // admins: ADICIONA quem não entrou na criação e PROMOVE (group-admins confere o número com/sem o 9 no WhatsApp)
    await opcional("admins", "convite", () => aplicarAdmins(p, chatId!, admins, extra));
    if (etapa === "convite" || etapa === "pronto") {
      const { inviteLink } = (await p.proxy("group-invite", { chatId, ...extra })) ?? {};
      if (typeof inviteLink !== "string" || !/^https:\/\/chat\.whatsapp\.com\//.test(inviteLink)) throw new Error("convite ilegível");
      const ordem = grupos.reduce((mx, g) => Math.max(mx, g.ordem), -1) + 1;
      const grupoId = await p.gravarGrupo({
        campanha_id: c.id, ordem, nome: atual.nome, link_convite: inviteLink, chat_id: chatId!, criado_pelo_crm: true,
        travado: c.so_admins_enviam, participantes: admins.length + 1, participantes_em: agora.toISOString(),
        cliques: 0, cliques_na_contagem: 0,
      });
      etapa = "pronto";
      await p.atualizarCriacao(atual.id, { etapa, status: "ok", erro: null, grupo_id: grupoId, avisos });
    }
    await p.estadoCampanha(c.id, {
      criacao_falhas_seguidas: 0, criacao_ultimo_erro: null, criacao_bloqueio: null, criacao_bloqueio_em: null, criacao_retomar_em: null,
    });
    return `grupo criado: ${atual.nome}${avisos.length ? ` (${avisos.length} aviso(s))` : ""}`;
  } catch (e) {
    const erro = p.erroLegivel(e, etapa).slice(0, 300);
    await p.atualizarCriacao(atual.id, { status: "erro", erro, etapa, tentativas: atual.tentativas + 1, avisos });
    await p.estadoCampanha(c.id, { criacao_falhas_seguidas: (c.criacao_falhas_seguidas ?? 0) + 1, criacao_ultimo_erro: erro });
    return `erro na criação (${etapa}): ${erro}`;
  }
}

/**
 * Adiciona e promove os admins num grupo (etapa "admins" e botão "Refazer admins"). Lança erro legível quando
 * algum não virou admin; devolve o texto do que deu certo.
 */
export async function aplicarAdmins(
  p: Pick<PortaCriacao, "proxy">, chatId: string, admins: string[], extra: Record<string, unknown>,
): Promise<string> {
  if (!admins.length) return "campanha sem admins";
  const resp = await p.proxy("group-admins", { chatId, participants: admins.slice(0, 10), ...extra }, { timeoutMs: 60_000 });
  const r = textoResultadoAdmins(resp);
  if (!r.ok) throw new Error(r.texto);
  return r.texto;
}
