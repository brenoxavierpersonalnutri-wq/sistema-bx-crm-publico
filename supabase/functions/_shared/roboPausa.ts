// Humano entrou na conversa (mensagem manual pelo CRM ou pelo celular): a IA para naquela conversa, motivo "humano",
// e só volta pelo follow-up ou pelo botão "Devolver para IA" (regra em pausaHumana.ts). Também tira o selo
// "Precisa de humano". Módulo pequeno de propósito: whatsapp-send e whatsapp-send-media importam só isto.
// Toda falha é registrada e engolida: nunca derruba o envio do atendente.
import { planoPausaHumana, planoRetomadaFollowup } from "./pausaHumana.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const conversaDeGrupo = (phone: string | null | undefined): boolean => String(phone ?? "").endsWith("@g.us");

const CAMPOS = "id, phone, numero_id, is_group, ai_agent_slug, ai_pausado, ai_pausado_motivo, ai_precisa_humano";

// deno-lint-ignore no-explicit-any
const doNumero = (q: any, numeroId: string | null) => (numeroId ? q.eq("numero_id", numeroId) : q);

/** true = pausou a IA agora (em alguma linha da conversa). */
export async function pausarPorHumano(db: Db, numeroId: string | null, telefone: string, origem: string, agora = new Date()): Promise<boolean> {
  if (conversaDeGrupo(telefone)) return false;
  try {
    const { data, error } = await doNumero(db.from("whatsapp_contacts").select(CAMPOS).eq("phone", telefone), numeroId);
    if (error) { console.error("robo-ia: pausarPorHumano", error.message); return false; }
    let pausou = false;
    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const plano = planoPausaHumana(c, origem, agora);
      if (!plano.patch) continue;
      const { error: e } = await db.from("whatsapp_contacts").update(plano.patch).eq("id", c.id);
      if (e) { console.error("robo-ia: pausarPorHumano update", e.message); continue; }
      if (!plano.mudou) continue;
      pausou = true;
      const num = (c.numero_id as string | null) ?? numeroId;
      await doNumero(
        db.from("crm_ai_fila").update({ status: "ignorado", motivo: "humano respondeu", updated_at: agora.toISOString() })
          .eq("contact_phone", telefone).eq("status", "pendente"),
        num,
      );
      const { error: eEv } = await db.from("crm_ai_eventos").insert({
        contact_phone: telefone, numero_id: num, agent_slug: (c.ai_agent_slug as string | null) ?? null,
        tipo: plano.evento!.tipo, detalhe: plano.evento!.detalhe,
      });
      if (eEv) console.error("robo-ia: pausarPorHumano evento", eEv.message);
    }
    return pausou;
  } catch (e) {
    console.error("robo-ia: pausarPorHumano", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Passo de follow-up mandou a retomada: tira a pausa humana (só ela) e registra. true = retomou. */
export async function retomarPorFollowup(db: Db, numeroId: string | null, telefone: string, quem: string, agora = new Date()): Promise<boolean> {
  if (conversaDeGrupo(telefone)) return false;
  try {
    const { data, error } = await doNumero(db.from("whatsapp_contacts").select(CAMPOS).eq("phone", telefone), numeroId);
    if (error) { console.error("robo-ia: retomarPorFollowup", error.message); return false; }
    let retomou = false;
    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const plano = planoRetomadaFollowup(c, quem, agora);
      if (!plano.retomar) continue;
      // guarda: só tira se continua pausada por humano (ninguém mexeu no meio)
      const { data: mud, error: e } = await db.from("whatsapp_contacts").update(plano.patch).eq("id", c.id).eq("ai_pausado", true)
        .eq("ai_pausado_motivo", c.ai_pausado_motivo).select("id");
      if (e) { console.error("robo-ia: retomarPorFollowup update", e.message); continue; }
      if (!mud?.length) continue;
      retomou = true;
      const { error: eEv } = await db.from("crm_ai_eventos").insert({
        contact_phone: telefone, numero_id: (c.numero_id as string | null) ?? numeroId, agent_slug: (c.ai_agent_slug as string | null) ?? null,
        tipo: plano.evento!.tipo, detalhe: plano.evento!.detalhe,
      });
      if (eEv) console.error("robo-ia: retomarPorFollowup evento", eEv.message);
    }
    return retomou;
  } catch (e) {
    console.error("robo-ia: retomarPorFollowup", e instanceof Error ? e.message : e);
    return false;
  }
}
