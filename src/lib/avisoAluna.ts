// Aviso automático na agenda: "Anamnese preenchida: <nome>" e
// "Feedback enviado: <nome>". Quem cria é o banco (gatilhos da migration
// 20261014120000_aviso_anamnese_feedback.sql), na hora em que a aluna envia;
// o front só mostra e leva até a ficha dela.

import type { CollaboratorTask } from "./taskTypes";

export const TIPO_AVISO = "aviso" as const;

/** Caminho da ficha da aluna ligada ao aviso, ou null (aluna fora do cadastro). */
export function linkDaFicha(task: Pick<CollaboratorTask, "type" | "metadata">): string | null {
    if (task.type !== TIPO_AVISO) return null;
    const id = task.metadata?.alunaId;
    // Só id no formato uuid vira link: o caminho é montado aqui, nunca copiado do metadata.
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return `/alunas/ficha/${id}`;
}

/**
 * Chave pra não mostrar a mesma tarefa de aluna duas vezes quando ela chega
 * por agendas diferentes. Aviso tem chave própria (uma por resposta), senão
 * dois feedbacks no mesmo dia virariam um só.
 */
export function chaveDeduplicacao(task: Pick<CollaboratorTask, "type" | "metadata" | "dueDate">): string {
    if (task.type === TIPO_AVISO && task.metadata?.avisoChave) return `aviso:${task.metadata.avisoChave}`;
    return `${task.type}:${task.metadata?.alunaId}:${task.dueDate?.slice(0, 10)}`;
}
