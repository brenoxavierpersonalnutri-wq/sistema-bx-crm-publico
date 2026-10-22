// Pré-carga das fotos de perfil do WhatsApp (contatos e grupos) para o CRM.
// Quem chama: o pg_cron (whatsapp_avatars_tick, 1/min, header x-avatars-segredo) ou o dono, à mão com o
// mesmo segredo. Cada tick pega, via RPC whatsapp_avatars_pendentes, as conversas com mensagem nos
// últimos 90 dias (integracao_config 'avatars_dias') sem foto ou com foto de mais de 7 dias, da mais
// recente pra mais antiga, e busca no máximo 35 por minuto pelo proxy (o proxy corta em 60/min contando
// webhook e backfill). A busca em si é _shared/avatarWa.ts: grava no bucket whatsapp-avatars (privado,
// link assinado de 1 ano) e em whatsapp_contacts.avatar_url; 404 do WhatsApp = "sem foto", só olha de
// novo daqui a 7 dias; outra falha reagenda pra ~1 dia.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { iguaisTempoConstante } from "../_shared/openwa.ts";
import { OrcamentoLeituras } from "../_shared/waBackfill.ts";
import { sessaoLeitura } from "../_shared/waNumero.ts";
import { atualizarAvatar } from "../_shared/avatarWa.ts";
import { processarLoteAvatares, type AlvoAvatar } from "../_shared/avatarLote.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ORCAMENTO_MS = 100_000;
const POR_MINUTO = 35;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function config(db: SupabaseClient, chave: string): Promise<string> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return typeof data?.valor === "string" ? data.valor : "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const veio = req.headers.get("x-avatars-segredo");
  const esperado = await config(db, "whatsapp_avatars_segredo");
  if (!veio || !esperado || !iguaisTempoConstante(veio, esperado)) return json({ error: "segredo" }, 401);

  try {
    const dias = Math.max(1, Math.min(365, Number(await config(db, "avatars_dias")) || 90));
    const { data, error } = await db.rpc("whatsapp_avatars_pendentes", { p_limite: POR_MINUTO + 5, p_dias: dias });
    if (error) throw new Error(error.message);
    const alvos = (data ?? []) as AlvoAvatar[];

    const fim = Date.now() + ORCAMENTO_MS;
    const orc = new OrcamentoLeituras(POR_MINUTO);
    const r = await processarLoteAvatares(alvos, {
      reservar: async () => {
        const espera = orc.reservar();
        if (espera <= 0) return true;
        if (Date.now() + espera > fim - 15_000) return false;
        await dormir(espera);
        return true;
      },
      atualizar: async (a) => atualizarAvatar(db, a.phone, { sessao: await sessaoLeitura(db, a.numero_id) }),
    });
    return json({ ok: true, fila: alvos.length, ...r });
  } catch (e) {
    console.error("avatars-tick:", e instanceof Error ? e.message : e);
    return json({ error: "erro interno" }, 500);
  }
});
