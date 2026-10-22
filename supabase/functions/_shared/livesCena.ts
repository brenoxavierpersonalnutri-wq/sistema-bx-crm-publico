// Monta a metadata da sala no LiveKit (layout + overlays visíveis + cor) a partir do banco.
// O render (/lives/render/:id) e a prévia do estúdio leem esse JSON com lerEstadoCena().
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function metadataDaSala(db: SupabaseClient, roomId: string): Promise<string> {
  const { data: sala } = await db.from("live_rooms").select("layout, cor").eq("id", roomId).maybeSingle();
  const { data: ovs } = await db
    .from("live_overlays")
    .select("id, tipo, visivel, conteudo, ordem")
    .eq("room_id", roomId)
    .order("ordem");
  return JSON.stringify({
    layout: sala?.layout ?? "grade",
    cor: sala?.cor ?? undefined,
    overlays: (ovs ?? []).map((o) => ({ id: o.id, tipo: o.tipo, visivel: o.visivel, conteudo: o.conteudo ?? {} })),
  });
}
