// Regras do "Ir ao vivo" e da troca de layout que o front decide sozinho, sem chamar o servidor.
import type { LiveDestino } from "@/lib/lives/api";
import type { LayoutLive } from "@/lib/lives/layout";

export const MSG_SEM_DESTINO = "Conecte um destino (YouTube, Facebook, RTMP) antes de ir ao vivo.";
export const MSG_DESTINOS_DESLIGADOS = "Seus destinos estão desligados: ligue pelo menos um na aba Destinos antes de ir ao vivo.";

/** null = pode chamar o ir-ao-vivo; senão, a mensagem para a pessoa. */
export function motivoSemDestino(destinos: Pick<LiveDestino, "ativo">[]): string | null {
  if (!destinos.length) return MSG_SEM_DESTINO;
  if (!destinos.some((d) => d.ativo)) return MSG_DESTINOS_DESLIGADOS;
  return null;
}

/** O CHECK antigo de live_rooms.layout não conhece "tela-cheia" até a migração 20261028120000 rodar. */
export function mensagemErroLayout(layout: LayoutLive, erro: { code?: string; message?: string }): string {
  if (layout === "tela-cheia" && (erro.code === "23514" || /layout_check|check constraint/i.test(erro.message ?? ""))) {
    return "O layout 'Tela cheia' ainda não foi liberado no banco (falta aplicar a migração 20261028120000_lives_layout_tela_cheia). Use 'Tela + pessoa' por enquanto.";
  }
  return erro.message ?? "Não foi possível trocar o layout";
}
