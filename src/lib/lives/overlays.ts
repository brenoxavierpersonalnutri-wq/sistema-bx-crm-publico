// Gravação de overlays (logo, faixa, banner) em live_overlays + espelho na sala via live-control "cena".
import { toast } from "sonner";
import { db, type LiveOverlay } from "@/lib/lives/api";
import { acaoLive } from "@/lib/lives/acoes";

export async function sincronizarCena(roomId: string) {
  await acaoLive("cena", { room_id: roomId });
}

/**
 * Banner e faixa: só um visível de cada tipo por vez (como no palco de verdade).
 * Grava no banco e devolve na hora; o espelho na sala (live-control "cena") vai em segundo plano, para a
 * lista não ficar parada esperando o servidor de transmissão. Linha que o banco não alterou (permissão,
 * já apagada) vira aviso em vez de silêncio.
 */
export async function alternarOverlay(roomId: string, o: LiveOverlay, visivel: boolean): Promise<boolean> {
  if (visivel && o.tipo !== "logo") {
    const { error: e1 } = await db.from("live_overlays").update({ visivel: false }).eq("room_id", roomId).eq("tipo", o.tipo).neq("id", o.id);
    if (e1) {
      toast.error(`Não consegui ocultar o ${o.tipo === "banner" ? "banner" : "item"} anterior: ${e1.message}`);
      return false;
    }
  }
  const { data, error } = await db.from("live_overlays").update({ visivel, updated_at: new Date().toISOString() }).eq("id", o.id).select("id");
  if (error) {
    toast.error(`Não consegui ${visivel ? "mostrar" : "ocultar"}: ${error.message}`);
    return false;
  }
  if (Array.isArray(data) && data.length === 0) {
    toast.error("O banco não alterou este item (sem permissão no módulo Lives ou ele já foi apagado). Recarregue a página.");
    return false;
  }
  void sincronizarCena(roomId);
  return true;
}

export async function criarOverlay(roomId: string, tipo: LiveOverlay["tipo"], conteudo: LiveOverlay["conteudo"] & Record<string, unknown>, ordem: number, visivel = false) {
  const { data, error } = await db.from("live_overlays").insert({ room_id: roomId, tipo, conteudo, ordem, visivel }).select("*").single();
  if (error) {
    toast.error(error.message);
    return null;
  }
  return data as LiveOverlay;
}

export async function apagarOverlay(roomId: string, o: LiveOverlay): Promise<boolean> {
  const { data, error } = await db.from("live_overlays").delete().eq("id", o.id).select("id");
  if (error) {
    toast.error(`Não consegui apagar: ${error.message}`);
    return false;
  }
  if (Array.isArray(data) && data.length === 0) {
    toast.error("O banco não apagou este item (sem permissão no módulo Lives ou ele já tinha sido apagado). Recarregue a página.");
    return false;
  }
  if (o.visivel) void sincronizarCena(roomId);
  return true;
}
