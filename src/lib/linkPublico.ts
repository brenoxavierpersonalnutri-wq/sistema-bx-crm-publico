/** O endereço que a aluna vê. É o domínio do Breno, não o do Lovable. */
export const DOMINIO_PUBLICO = "https://equipe.brenoxavier.com.br";

const ehLocal = (origem: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origem);

/**
 * Monta um link pra mandar pra aluna.
 *
 * Não dá pra usar `window.location.origin` aqui: quando o link é gerado de
 * dentro do preview do Lovable (id-preview--….lovable.app), era esse endereço
 * que ia junto na mensagem, e a aluna recebia um link que não é o do Breno.
 * O que sai pra fora é sempre no domínio dele.
 *
 * Em desenvolvimento (localhost) o link segue o endereço local, senão não dá
 * pra testar o formulário rodando na máquina.
 */
export function linkPublico(
  caminho: string,
  origem = typeof window === "undefined" ? "" : window.location.origin,
): string {
  const limpo = caminho.startsWith("/") ? caminho : `/${caminho}`;
  return `${ehLocal(origem) ? origem : DOMINIO_PUBLICO}${limpo}`;
}
