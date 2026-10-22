// Histórico completo por número (tela Conexões, 18/10/2026): o que o cartão mostra a partir do último job do
// whatsapp-backfill daquele número. Lógica pura (sem React, sem Supabase).
import type { JobBackfill } from "@/lib/crm/fonteConversas";

export type AcaoHistorico = "iniciar" | "pausar" | "retomar" | "cancelar";

export interface EstadoHistorico {
  /** Texto curto do cartão. */
  texto: string;
  /** 0-100; null quando ainda não há total (listando) ou não há job. */
  pct: number | null;
  ativo: boolean;
  acoes: AcaoHistorico[];
  /** Rótulo do botão de iniciar ("Trazer histórico completo" / "Rodar de novo"). */
  rotuloIniciar: string;
}

const pctDe = (j: Pick<JobBackfill, "total_chats" | "chats_feitos">) =>
  j.total_chats > 0 ? Math.min(100, Math.round((j.chats_feitos / j.total_chats) * 100)) : 0;

/** Só o job do histórico completo interessa ao cartão; o de 90 dias tem a faixa dele na tela Conversas. */
export function estadoHistorico(job: JobBackfill | null | undefined): EstadoHistorico {
  const j = job && job.completo ? job : null;
  const base = { rotuloIniciar: "Trazer histórico completo" };
  if (!j) return { ...base, texto: "Traz todas as conversas do celular, das mais recentes para as mais antigas.", pct: null, ativo: false, acoes: ["iniciar"] };
  const n = `${j.chats_feitos}/${j.total_chats} conversas`;
  switch (j.status) {
    case "listando":
      return { ...base, texto: "Listando as conversas do WhatsApp…", pct: null, ativo: true, acoes: ["pausar", "cancelar"] };
    case "importando":
      return { ...base, texto: `Importando ${n}`, pct: pctDe(j), ativo: true, acoes: ["pausar", "cancelar"] };
    case "pausado":
      return { ...base, texto: `Pausado em ${n}`, pct: pctDe(j), ativo: false, acoes: ["retomar", "cancelar"] };
    case "concluido":
      return { texto: `Histórico completo: ${n}`, pct: 100, ativo: false, acoes: ["iniciar"], rotuloIniciar: "Rodar de novo" };
    case "cancelado":
      return { texto: `Cancelado em ${n}`, pct: null, ativo: false, acoes: ["iniciar"], rotuloIniciar: "Começar de novo" };
    default:
      return { texto: j.aviso ? `Parou com erro: ${j.aviso}` : "Parou com erro", pct: null, ativo: false, acoes: ["iniciar"], rotuloIniciar: "Tentar de novo" };
  }
}

/** Linha de detalhe (mensagens, erros). */
export function detalheHistorico(job: JobBackfill | null | undefined): string | null {
  if (!job?.completo) return null;
  const partes = [`${job.msgs_importadas} mensagens`];
  if (job.chats_erro) partes.push(`${job.chats_erro} com erro`);
  return partes.join(" · ");
}
