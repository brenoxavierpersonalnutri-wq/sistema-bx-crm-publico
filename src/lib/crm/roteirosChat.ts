// Roteiros dentro do chat (painel "Roteiros" da tela de Conversas): funções puras que
// transformam um passo de roteiro no que vai para a caixa de mensagem (texto com as
// variáveis trocadas + anexos pendentes), filtram a lista e decidem a ordem de envio.
// Sem acesso a banco aqui: dá pra testar sem Supabase.
import { aplicarVariaveis, variaveisPendentes } from "../../../supabase/functions/_shared/agentesIA.ts";
import { ehOggOpus } from "../../../supabase/functions/_shared/notaDeVoz.ts";

export type TipoAnexo = "image" | "audio" | "document" | "video";

/** Anexo esperando o atendente apertar Enviar: veio de um roteiro (url) ou do clipe (arquivo). */
export interface AnexoPendente {
  id: string;
  tipo: TipoAnexo;
  nome: string;
  url?: string;
  arquivo?: File;
  /** Passo de roteiro que originou o anexo (para registrar "já enviado"). */
  passoId?: string;
  /** Nota de voz gravada na barra (Ogg/Opus): vai como ptt, bolha de microfone no WhatsApp. */
  voz?: boolean;
}

/** O que o botão "Usar" joga na caixa de mensagem. */
export interface InsercaoRoteiro {
  id: string;
  texto: string;
  anexos: AnexoPendente[];
  passoIds: string[];
}

interface PassoBase {
  id: string;
  roteiro_id: string;
  ordem: number;
  tipo: "text" | "audio" | "image" | "document";
  rotulo: string | null;
  conteudo: string;
  media_url: string | null;
  file_name: string | null;
}

interface RoteiroBase {
  id: string;
  stage: string;
  funil: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
}

const MARCADOR_MIDIA = /\[(IMAGEM|IMAGE|AUDIO|ÁUDIO|DOCUMENTO|DOCUMENT|VIDEO|VÍDEO):\s*(https?:\/\/[^\]\s]+)\s*\]/gi;

function tipoDoMarcador(m: string): TipoAnexo {
  const t = m.toUpperCase();
  if (t.startsWith("IMAG")) return "image";
  if (t.startsWith("AUD") || t.startsWith("ÁUD")) return "audio";
  if (t.startsWith("VID") || t.startsWith("VÍD")) return "video";
  return "document";
}

/** Nome do arquivo a partir do link (sem query string). */
export function nomeDoLink(url: string): string {
  try {
    const u = new URL(url);
    const ultimo = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
    return ultimo || "arquivo";
  } catch {
    return "arquivo";
  }
}

/** Separa os marcadores [IMAGEM:url] / [AUDIO:url] / [DOCUMENTO:url] do texto. */
export function extrairMidias(texto: string): { texto: string; midias: { tipo: TipoAnexo; url: string }[] } {
  const midias: { tipo: TipoAnexo; url: string }[] = [];
  const limpo = String(texto ?? "").replace(MARCADOR_MIDIA, (_t, tipo: string, url: string) => {
    midias.push({ tipo: tipoDoMarcador(tipo), url });
    return "";
  });
  return { texto: limpo.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), midias };
}

/** Mídias do passo: o arquivo do próprio passo (imagem/áudio/documento) + marcadores no texto. */
export function midiasDoPasso(p: Pick<PassoBase, "tipo" | "conteudo" | "media_url" | "file_name">) {
  const { texto, midias } = extrairMidias(p.conteudo);
  const lista: { tipo: TipoAnexo; url: string; nome: string }[] = [];
  if (p.tipo !== "text" && p.media_url) lista.push({ tipo: p.tipo, url: p.media_url, nome: p.file_name || nomeDoLink(p.media_url) });
  for (const m of midias) lista.push({ ...m, nome: nomeDoLink(m.url) });
  return { texto, midias: lista };
}

/** Passo sem texto e sem mídia: rascunho que o time ainda precisa preencher. */
export function passoParaPreencher(p: Pick<PassoBase, "tipo" | "conteudo" | "media_url" | "file_name" | "rotulo">): boolean {
  const { texto, midias } = midiasDoPasso(p);
  return !texto && midias.length === 0;
}

let contador = 0;
const novoId = () => `a${Date.now().toString(36)}${(contador++).toString(36)}`;

/** Passo → texto (variáveis do contato trocadas, marcadores removidos) + anexos pendentes. */
export function montarInsercao(
  passos: PassoBase[],
  contato: { name?: string | null; phone?: string | null },
  extras: Record<string, string> = {},
): InsercaoRoteiro {
  const textos: string[] = [];
  const anexos: AnexoPendente[] = [];
  for (const p of passos) {
    const { texto, midias } = midiasDoPasso(p);
    if (texto) textos.push(aplicarVariaveis(texto, contato, extras));
    for (const m of midias) anexos.push({
      id: novoId(), tipo: m.tipo, url: m.url, nome: m.nome, passoId: p.id,
      // áudio OGG/Opus do roteiro sai como nota de voz (bolha de microfone)
      ...(m.tipo === "audio" && ehOggOpus(m.nome, m.url) ? { voz: true } : {}),
    });
  }
  return { id: novoId(), texto: textos.join("\n\n"), anexos, passoIds: passos.map((p) => p.id) };
}

/** O passo usa o link de agendamento ([LINK_AGENDAMENTO]): quem chama busca o link do contato antes. */
export function usaLinkAgendamento(passos: Pick<PassoBase, "conteudo">[]): boolean {
  return passos.some((p) => /\[LINK_AGENDAMENTO\]/.test(p.conteudo ?? ""));
}

/** Texto final com as variáveis que ainda faltam ({data}, [LINK_AGENDAMENTO]...). */
export function pendenciasDoTexto(texto: string): string[] {
  return variaveisPendentes(texto);
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, descrição e texto dos passos, sem diferenciar acento/maiúscula. */
export function filtrarRoteiros<R extends RoteiroBase>(roteiros: R[], passos: PassoBase[], busca: string): R[] {
  const termos = semAcento(busca.trim()).split(/\s+/).filter(Boolean);
  if (!termos.length) return roteiros;
  const textoPorRoteiro = new Map<string, string>();
  for (const p of passos) {
    textoPorRoteiro.set(p.roteiro_id, `${textoPorRoteiro.get(p.roteiro_id) ?? ""} ${p.rotulo ?? ""} ${p.conteudo}`);
  }
  return roteiros.filter((r) => {
    const alvo = semAcento(`${r.nome} ${r.descricao ?? ""} ${textoPorRoteiro.get(r.id) ?? ""}`);
    return termos.every((t) => alvo.includes(t));
  });
}

/** Os da etapa do contato primeiro; depois pela ordem das colunas e pela ordem do roteiro. */
export function ordenarRoteiros<R extends RoteiroBase>(roteiros: R[], etapaContato: string | null, etapas: string[]): R[] {
  const pos = (s: string) => {
    const i = etapas.indexOf(s);
    return i < 0 ? etapas.length : i;
  };
  return [...roteiros].sort((a, b) => {
    const da = a.stage === etapaContato ? 0 : 1;
    const dbb = b.stage === etapaContato ? 0 : 1;
    if (da !== dbb) return da - dbb;
    if (a.stage !== b.stage) return pos(a.stage) - pos(b.stage);
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export type AcaoEnvio =
  | { tipo: "texto"; texto: string }
  | { tipo: "anexo"; anexo: AnexoPendente; legenda: string };

/**
 * Ordem de envio da caixa: um único anexo de imagem/vídeo/documento leva o texto como
 * legenda (igual ao WhatsApp). Áudio não tem legenda e vários anexos não dividem uma;
 * nesses casos o texto vai primeiro, depois cada anexo na ordem.
 */
export function planejarEnvio(texto: string, anexos: AnexoPendente[]): AcaoEnvio[] {
  const t = texto.trim();
  if (anexos.length === 1 && anexos[0].tipo !== "audio") return [{ tipo: "anexo", anexo: anexos[0], legenda: t }];
  const acoes: AcaoEnvio[] = [];
  if (t) acoes.push({ tipo: "texto", texto: t });
  for (const a of anexos) acoes.push({ tipo: "anexo", anexo: a, legenda: "" });
  return acoes;
}

/** Tipo do anexo pelo MIME do arquivo escolhido no clipe. */
export function tipoDoArquivo(f: File): TipoAnexo {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  return "document";
}

export function anexoDeArquivo(f: File): AnexoPendente {
  return { id: novoId(), tipo: tipoDoArquivo(f), nome: f.name, arquivo: f };
}
