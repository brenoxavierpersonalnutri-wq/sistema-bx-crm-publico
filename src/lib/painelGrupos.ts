// Painel do "Disparo em grupo" no estilo SendFlow: métricas por campanha e período, saúde (alertas),
// diagnóstico do número, filtros de mensagens, calendário e CSV. Tudo puro (testado em src/test/painelGrupos.test.ts).
import type { CampanhaGrupos, GrupoLinha, MensagemAgendada, NumeroWhatsApp } from "@/lib/grupos";
import { FALHAS_PARA_ALERTA, numeroCriaGrupo } from "../../supabase/functions/_shared/grupos.ts";

export const PERIODOS = [7, 14, 21, 28, 90] as const;
export type Periodo = typeof PERIODOS[number];

/** Início do período (meia-noite local de N-1 dias atrás), em ISO. */
export function desdeDe(dias: number, agora = new Date()): string {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (dias - 1));
  return d.toISOString();
}

/** Linha da RPC grupos_metricas_periodo. */
export interface MetricaPeriodo { campanha_id: string; cliques: number; cliques_grupo: number; entradas: number; saidas: number }

export interface MetricasCampanha {
  cliques: number;
  entradas: number;
  saidas: number;
  /** entradas ÷ cliques (0–100, 2 casas). */
  pctEntrada: number;
  participantes: number;
  grupos: number;
  cheios: number;
  disponiveis: number;
  vagas: number;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
export const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : 0);

/**
 * Métricas de uma campanha. Cliques/entradas/saídas vêm da RPC do período quando existir; sem ela
 * (migração ainda não rodada) cai nos acumulados dos grupos (`cliques`, `entradas`, `saidas`).
 */
export function metricasCampanha(
  campanha: Pick<CampanhaGrupos, "id" | "limite_por_grupo">,
  grupos: Pick<GrupoLinha, "campanha_id" | "ativo" | "cheio" | "participantes" | "cliques" | "entradas" | "saidas">[],
  periodo?: MetricaPeriodo | null,
): MetricasCampanha {
  const dela = grupos.filter((g) => g.campanha_id === campanha.id);
  const ativos = dela.filter((g) => g.ativo);
  const somar = (k: "cliques" | "entradas" | "saidas") => dela.reduce((s, g) => s + num(g[k]), 0);
  const cliques = periodo ? num(periodo.cliques) : somar("cliques");
  const entradas = periodo ? num(periodo.entradas) : somar("entradas");
  const saidas = periodo ? num(periodo.saidas) : somar("saidas");
  const limite = campanha.limite_por_grupo || 0;
  return {
    cliques, entradas, saidas,
    pctEntrada: pct(entradas, cliques),
    participantes: dela.reduce((s, g) => s + num(g.participantes), 0),
    grupos: dela.length,
    cheios: ativos.filter((g) => g.cheio).length,
    disponiveis: ativos.filter((g) => !g.cheio).length,
    vagas: ativos.filter((g) => !g.cheio).reduce((s, g) => s + Math.max(0, limite - num(g.participantes)), 0),
  };
}

/** Soma das métricas de várias campanhas (KPIs do topo). */
export function somarMetricas(lista: MetricasCampanha[]): MetricasCampanha {
  const t = lista.reduce((a, m) => ({
    cliques: a.cliques + m.cliques, entradas: a.entradas + m.entradas, saidas: a.saidas + m.saidas,
    participantes: a.participantes + m.participantes, grupos: a.grupos + m.grupos, cheios: a.cheios + m.cheios,
    disponiveis: a.disponiveis + m.disponiveis, vagas: a.vagas + m.vagas, pctEntrada: 0,
  }), { cliques: 0, entradas: 0, saidas: 0, participantes: 0, grupos: 0, cheios: 0, disponiveis: 0, vagas: 0, pctEntrada: 0 });
  return { ...t, pctEntrada: pct(t.entradas, t.cliques) };
}

export type GravidadeAlerta = "alta" | "media";
export interface AlertaSaude { chave: string; gravidade: GravidadeAlerta; titulo: string; detalhe: string; campanhaId?: string; numeroId?: string }

/**
 * "O que precisa de atenção" (o SendFlow chama de sugestões de balanceamento / campanhas expostas):
 * número desconectado com campanha ativa, campanha que não consegue criar o próximo grupo (número que não cria,
 * sem admin), criação travada (teto diário, máximo da campanha), criação falhando seguido, link pausado,
 * campanha sem grupo, grupos em que o número não pode enviar e disparos com erro.
 */
export function alertasSaude(entrada: {
  campanhas: CampanhaGrupos[];
  grupos: Pick<GrupoLinha, "campanha_id" | "ativo" | "cheio" | "participantes" | "chat_id" | "sou_admin" | "anuncio">[];
  numeros: NumeroWhatsApp[];
  conectado: Record<string, boolean | undefined>;
  mensagensComErro?: Pick<MensagemAgendada, "campanha_id">[];
}): AlertaSaude[] {
  const { campanhas, grupos, numeros, conectado } = entrada;
  const ativas = campanhas.filter((c) => !c.encerrada);
  const out: AlertaSaude[] = [];
  for (const n of numeros) {
    const usadas = ativas.filter((c) => c.numero_id === n.id);
    if (conectado[n.id] === false && usadas.length) {
      out.push({ chave: `desc-${n.id}`, gravidade: "alta", numeroId: n.id, titulo: `Número ${n.rotulo} desconectado`, detalhe: `${usadas.length} campanha(s) ativa(s) dependem dele. Reconecte em Conexões.` });
    }
  }
  for (const c of ativas) {
    const nome = c.avulsa ? "Avulsos" : c.nome;
    const dela = grupos.filter((g) => g.campanha_id === c.id);
    const ativos = dela.filter((g) => g.ativo);
    if (!c.avulsa && !dela.length) {
      out.push({ chave: `vazia-${c.id}`, gravidade: "media", campanhaId: c.id, titulo: `"${nome}" não tem grupos`, detalhe: "Com o link aberto, o CRM cria o primeiro grupo sozinho (número Grupos 1 com admin); ou importe grupos." });
      continue;
    }
    if (!c.avulsa) {
      // criação é sempre ligada: o que importa é se ESTE número/campanha consegue criar
      const numero = numeros.find((n) => n.id === c.numero_id);
      const cheia = ativos.length > 0 && ativos.every((g) => g.cheio);
      const motivo = !c.numero_id ? null
        : !numeroCriaGrupo(numero?.sessao) ? "O número da campanha não cria grupo (só o Grupos 1 cria). Troque o número ou crie o grupo no celular e importe."
        : !(c.admins_telefones ?? []).length ? "Sem admin cadastrado: o WhatsApp não cria grupo só com o número. Cadastre pelo menos 1 admin na criação da campanha."
        : null;
      if (motivo) {
        out.push({ chave: `naocria-${c.id}`, gravidade: cheia ? "alta" : "media", campanhaId: c.id, titulo: `"${nome}" não consegue criar o próximo grupo`, detalhe: motivo });
      } else if (c.criacao_bloqueio) {
        // teto diário do número, máximo de grupos da campanha, parada por abandonos (a edge grava o texto)
        out.push({ chave: `bloqueio-${c.id}`, gravidade: "alta", campanhaId: c.id, titulo: `"${nome}": grupo novo esperando`, detalhe: c.criacao_bloqueio });
      }
      if ((c.criacao_falhas_seguidas ?? 0) >= FALHAS_PARA_ALERTA) {
        out.push({
          chave: `falha-${c.id}`, gravidade: "alta", campanhaId: c.id,
          titulo: `"${nome}": criação de grupo falhou ${c.criacao_falhas_seguidas} vezes seguidas`,
          detalhe: c.criacao_ultimo_erro ? `Último erro: ${c.criacao_ultimo_erro}` : "Veja o histórico na aba Criação.",
        });
      }
    }
    if (!c.avulsa && c.link_pausado) {
      out.push({ chave: `pausa-${c.id}`, gravidade: "media", campanhaId: c.id, titulo: `Link de "${nome}" pausado`, detalhe: c.url_lotado ? "Quem clicar vai para a URL de link pausado." : "Quem clicar vê que as entradas estão fechadas." });
    }
    const semPermissao = dela.filter((g) => g.chat_id && g.anuncio === true && g.sou_admin === false).length;
    if (semPermissao) {
      out.push({ chave: `perm-${c.id}`, gravidade: "media", campanhaId: c.id, titulo: `"${nome}": ${semPermissao} grupo(s) sem permissão de envio`, detalhe: "Só admins enviam e o número não é admin. Promova o número ou tire esses grupos do disparo." });
    }
    if (!c.numero_id) {
      out.push({ chave: `semnum-${c.id}`, gravidade: "media", campanhaId: c.id, titulo: `"${nome}" sem número`, detalhe: "Escolha o número da campanha nas configurações." });
    }
  }
  const erros = new Map<string, number>();
  for (const m of entrada.mensagensComErro ?? []) erros.set(m.campanha_id, (erros.get(m.campanha_id) ?? 0) + 1);
  for (const [id, qtd] of erros) {
    const c = campanhas.find((x) => x.id === id);
    out.push({ chave: `erro-${id}`, gravidade: "alta", campanhaId: id, titulo: `${qtd} disparo(s) com erro${c ? ` em "${c.avulsa ? "Avulsos" : c.nome}"` : ""}`, detalhe: "Veja o motivo em Ações." });
  }
  return out.sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === "alta" ? -1 : 1));
}

export interface DiagnosticoNumero { total: number; admin: number; soEnvio: number; semPermissao: number; naoVerificado: number; semId: number; pctCompat: number }

/** Diagnóstico estilo SendFlow ("É admin de X/Y grupos") a partir das permissões gravadas por grupo. */
export function diagnosticoNumero(grupos: Pick<GrupoLinha, "chat_id" | "sou_admin" | "anuncio" | "ativo">[]): DiagnosticoNumero {
  const comId = grupos.filter((g) => g.chat_id && g.ativo);
  const admin = comId.filter((g) => g.sou_admin === true).length;
  const semPermissao = comId.filter((g) => g.sou_admin === false && g.anuncio === true).length;
  const soEnvio = comId.filter((g) => g.sou_admin === false && g.anuncio === false).length;
  const naoVerificado = comId.length - admin - semPermissao - soEnvio;
  const verificados = comId.length - naoVerificado;
  return {
    total: comId.length, admin, soEnvio, semPermissao, naoVerificado,
    semId: grupos.filter((g) => !g.chat_id && g.ativo).length,
    pctCompat: verificados ? Math.round(((admin + soEnvio) / verificados) * 100) : 0,
  };
}

export const FILTROS_MENSAGEM = ["todas", "fila", "agendada", "enviando", "concluida", "falhas", "cancelada"] as const;
export type FiltroMensagem = typeof FILTROS_MENSAGEM[number];
export const ROTULO_FILTRO: Record<FiltroMensagem, string> = {
  todas: "Visão geral", fila: "Na fila", agendada: "Agendado", enviando: "Processando", concluida: "Sucesso", falhas: "Falhas", cancelada: "Canceladas",
};

/** Em qual filtro (aba de status) a mensagem aparece. "Na fila" = agendada cuja hora já passou. */
export function noFiltro(m: Pick<MensagemAgendada, "status" | "agendado_para" | "falhas">, f: FiltroMensagem, agora = Date.now()): boolean {
  switch (f) {
    case "todas": return true;
    case "fila": return m.status === "agendada" && Date.parse(m.agendado_para) <= agora;
    case "agendada": return m.status === "agendada" && Date.parse(m.agendado_para) > agora;
    case "enviando": return m.status === "enviando";
    case "concluida": return m.status === "concluida" && !(m.falhas > 0);
    case "falhas": return m.status === "erro" || m.falhas > 0;
    case "cancelada": return m.status === "cancelada";
  }
}

/** Duração legível entre início e fim ("3m 21s"). */
export function duracao(inicio: string | null, fim: string | null): string | null {
  if (!inicio || !fim) return null;
  const s = Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000));
  if (!Number.isFinite(s)) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
}

/** Grade do calendário (6 semanas × 7 dias, começa no domingo) do mês (0–11). */
export function gradeDoMes(ano: number, mes: number): Date[] {
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(ano, mes, 1 - primeiro.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

export const chaveDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Mensagens agrupadas pelo dia local em que estão agendadas. */
export function porDia<T extends Pick<MensagemAgendada, "agendado_para">>(lista: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of lista) {
    const k = chaveDia(new Date(x.agendado_para));
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  for (const v of m.values()) v.sort((a, b) => Date.parse(a.agendado_para) - Date.parse(b.agendado_para));
  return m;
}

/** Série diária completa (dias sem dado = 0), para o gráfico. */
export function serieCompleta(
  linhas: { dia: string; cliques: number; entradas: number; saidas: number }[], dias: number, agora = new Date(),
): { dia: string; rotulo: string; cliques: number; entradas: number; saidas: number }[] {
  const porChave = new Map(linhas.map((l) => [String(l.dia).slice(0, 10), l]));
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - i);
    const k = chaveDia(d);
    const l = porChave.get(k);
    out.push({ dia: k, rotulo: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`, cliques: num(l?.cliques), entradas: num(l?.entradas), saidas: num(l?.saidas) });
  }
  return out;
}

/** CSV com ; (abre direto no Excel em pt-BR), aspas quando precisa e BOM. */
export function paraCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  const cel = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
}

export function baixarCsv(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Campos copiados ao duplicar uma campanha (sem grupos, sem link: slug novo, começa com link pausado). */
export function copiaDeCampanha(c: CampanhaGrupos, slugsExistentes: string[]): Record<string, unknown> {
  const base = `${c.slug.slice(0, 50).replace(/-+$/, "")}-copia`;
  let slug = base, i = 2;
  while (slugsExistentes.includes(slug)) slug = `${base}-${i++}`;
  return {
    nome: `${c.nome} (cópia)`.slice(0, 120), slug, numero_id: c.numero_id, limite_por_grupo: c.limite_por_grupo, tag: c.tag,
    url_lotado: c.url_lotado, intervalo_min_s: c.intervalo_min_s, intervalo_max_s: c.intervalo_max_s,
    link_pausado: true, disparos_pausados: false, encerrada: false, modo_distribuicao: c.modo_distribuicao ?? "encher",
    prefixo_nome: c.prefixo_nome, proximo_numero: 1, descricao_grupo: c.descricao_grupo, foto_path: c.foto_path,
    admins_telefones: c.admins_telefones ?? [], so_admins_enviam: c.so_admins_enviam, so_admins_editam: c.so_admins_editam,
    folga_vagas: c.folga_vagas, max_grupos: c.max_grupos, teto_por_minuto: c.teto_por_minuto,
    boas_vindas_ligada: false, boas_vindas_texto: c.boas_vindas_texto, boas_vindas_mencionar: c.boas_vindas_mencionar,
    boas_vindas_intervalo_min: c.boas_vindas_intervalo_min,
  };
}

export const nomeCampanha = (c: Pick<CampanhaGrupos, "nome" | "avulsa">) => (c.avulsa ? "Avulsos" : c.nome);
export const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Itens do menu "Configurações da campanha" (o que existe aqui e o que é só do SendFlow por enquanto). */
export interface Recurso { chave: string; titulo: string; descricao: string; ligado?: boolean; aba?: string; emBreve?: boolean }

export function recursosDaCampanha(c: CampanhaGrupos): Recurso[] {
  return [
    { chave: "link", titulo: "Link de convite /g/", descricao: "Distribui quem clica entre os grupos com vaga.", ligado: !c.link_pausado && !c.encerrada, aba: "ajustes" },
    { chave: "split", titulo: c.modo_distribuicao === "split" ? "Distribuição: split por peso" : "Distribuição: encher em ordem", descricao: "Encher um grupo por vez ou dividir pelo peso de cada grupo.", ligado: true, aba: "ajustes" },
    { chave: "pausado", titulo: "URL de link pausado", descricao: "Para onde vai quem clica com o link pausado. Lotado não usa: o CRM cria o próximo grupo.", ligado: Boolean(c.url_lotado), aba: "ajustes" },
    { chave: "criacao", titulo: "Criação automática de grupos", descricao: "Sempre ligada: lotou (ou quase), cria o próximo grupo. Só o número Grupos 1 cria.", ligado: !c.avulsa, aba: "criacao" },
    { chave: "boasvindas", titulo: "Boas-vindas", descricao: "Mensagem quando alguém entra, marcando quem chegou.", ligado: Boolean(c.boas_vindas_ligada), aba: "automacoes" },
    { chave: "evento", titulo: "Mensagens relativas ao evento", descricao: "Agenda D-1, H-1, “ao vivo agora”… a partir da data do evento.", ligado: Boolean(c.data_evento), aba: "automacoes" },
    { chave: "admins", titulo: "Só admins enviam / editam", descricao: "Ajustes aplicados aos grupos novos; nos existentes, pela aba Configuração dos grupos.", ligado: Boolean(c.so_admins_enviam), aba: "config" },
    { chave: "pausa", titulo: "Pausar disparos", descricao: "Segura todo envio desta campanha.", ligado: Boolean(c.disparos_pausados), aba: "ajustes" },
    { chave: "tags", titulo: "Tags ao entrar/sair", descricao: "Pôr ou tirar tag do lead quando entra ou sai de um grupo.", emBreve: true },
    { chave: "cookie", titulo: "Cookie de redirecionamento", descricao: "Quem já clicou volta sempre para o mesmo grupo.", emBreve: true },
    { chave: "antihacker", titulo: "Anti-hacker", descricao: "Apaga mensagem de não-admin com grupo fechado e remove o autor.", emBreve: true },
    { chave: "verificacao", titulo: "Verificação de colaboradores", descricao: "Página pública para o lead conferir se o número é da equipe.", emBreve: true },
    { chave: "entrega", titulo: "Confirmação de entrega", descricao: "Outro número da campanha confirma que a mensagem chegou.", emBreve: true },
    { chave: "vip", titulo: "Grupo VIP (Hotmart)", descricao: "Compra aprovada entra; reembolso/cancelamento sai.", emBreve: true },
    { chave: "links", titulo: "Atualização de links", descricao: "Renovar convites periodicamente ou quando o número é banido; revogar link ao encher.", emBreve: true },
    { chave: "anteriores", titulo: "Remover lead de campanhas anteriores", descricao: "Ao entrar aqui, sai dos grupos das campanhas escolhidas.", emBreve: true },
    { chave: "duplicados", titulo: "Participantes duplicados", descricao: "Remove o mesmo número que está em mais de um grupo.", emBreve: true },
    { chave: "pixel", titulo: "Pixel Meta/TikTok e anti-bot no link", descricao: "Eventos de conversão e desafio antes de mandar pro grupo.", emBreve: true },
  ];
}

