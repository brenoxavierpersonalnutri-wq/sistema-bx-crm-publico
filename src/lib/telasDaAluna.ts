// Depois de apagar uma aluna, as telas que guardaram dado dela em cache do
// react-query precisam buscar de novo. O app segura o dado por 1 min
// (staleTime em App.tsx): sem isto, voltar para a Gestão de Alunas mostrava a
// agenda com os avisos da aluna apagada até recarregar a página.
import type { QueryClient } from "@tanstack/react-query";

/**
 * Chaves das consultas que mostram algo ligado a uma aluna. Prefixo: ["tasks"]
 * pega ["tasks", userId] de todo mundo.
 *   tasks / admin-colaboradores-tasks   collaborator_tasks (agenda, check-in do dia, painel do time)
 *   alunas / acessos                     lista de alunas e acessos ao app
 *   feedback-* / feedbacks               feedback_semanal_responses
 */
export const CHAVES_LIGADAS_A_ALUNA: ReadonlyArray<readonly string[]> = [
  ["tasks"],
  ["admin-colaboradores-tasks"],
  ["alunas"],
  ["acessos"],
  ["feedback-semanal-responses"],
  ["feedbacks"],
  ["feedback-ciclo"],
];

/**
 * Marca como velhas todas as consultas ligadas a aluna: a que está na tela
 * busca agora, a que não está busca quando a tela abrir de novo.
 */
export function atualizarTelasDepoisDeApagarAluna(qc: QueryClient): Promise<void> {
  return Promise.all(CHAVES_LIGADAS_A_ALUNA.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] }))).then(
    () => undefined,
  );
}
