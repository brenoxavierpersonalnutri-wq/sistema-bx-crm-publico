// Lembretes do webinário no WhatsApp (verify_jwt = false). Só o pg_cron chama, com
// x-lembretes-segredo = integracao_config.webinar_lembretes_segredo (webinar_lembretes_tick()).
// Por chamada: até 5 lembretes vencidos de webinários com lembretes_ativos, 3-6 s entre envios
// (o proxy da VPS ainda limita 20/min e 300/dia). Vencido há mais de 2 h vira "expirado".
// Cada envio fica registrado (message_id em crm_automacao_log, envioSistema.ts): lembrete nunca conta como humano.
import { tokenInscricao, iguaisTempoConstante } from "../_shared/liveCrypto.ts";
import { admin, configIntegracao, json, siteUrl } from "../_shared/livesHttp.ts";
import { segredoInscricao } from "../_shared/webinarComum.ts";
import { enviarWhatsApp, ErroEnvio } from "../_shared/waEnvio.ts";
import { registrarEnvioSistema } from "../_shared/envioSistema.ts";

const db = admin();
const POR_CHAMADA = 5;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PADRAO: Record<string, string> = {
  confirmacao: "Oi {nome}! Sua vaga na aula \"{titulo}\" está garantida para {data} às {hora}. Seu link de acesso: {link}",
  "24h": "{nome}, amanhã às {hora} tem a aula \"{titulo}\". Guarde seu link: {link}",
  "1h": "{nome}, falta 1 hora para a aula \"{titulo}\". Seu link: {link}",
  "15min": "{nome}, começamos em 15 minutos! Entra pelo link: {link}",
  ao_vivo: "{nome}, estamos AO VIVO agora na aula \"{titulo}\": {link}",
};

function preencher(modelo: string, v: Record<string, string>) {
  return modelo.replace(/\{(nome|titulo|link|data|hora)\}/g, (_, k) => v[k] ?? "");
}

function dataHoraSP(iso: string) {
  const d = new Date(iso);
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(d);
  return { data, hora };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const esperado = await configIntegracao(db, "webinar_lembretes_segredo");
  const veio = req.headers.get("x-lembretes-segredo") ?? "";
  if (!esperado || !iguaisTempoConstante(veio, esperado)) return json({ error: "segredo" }, 401);

  const agora = Date.now();
  const { data: itens } = await db
    .from("webinar_reminders_queue")
    .select("id, tipo, enviar_em, tentativas, registration_id, session_id, webinar_registrations!inner(id, nome, whatsapp, webinar_id, webinars!inner(slug, titulo, lembretes, lembretes_ativos)), webinar_sessions!inner(inicia_em, status)")
    .eq("status", "pendente")
    .lte("enviar_em", new Date(agora).toISOString())
    .eq("webinar_registrations.webinars.lembretes_ativos", true)
    .order("enviar_em")
    .limit(POR_CHAMADA);

  const resultado = { enviados: 0, falhas: 0, expirados: 0 };
  const segredo = await segredoInscricao(db);

  for (const [i, it] of (itens ?? []).entries()) {
    const r = (it as any).webinar_registrations;
    const w = r.webinars;
    const s = (it as any).webinar_sessions;
    // trava: só segue quem conseguir mudar pendente -> enviando
    const { data: travado } = await db.from("webinar_reminders_queue").update({ status: "enviando" })
      .eq("id", it.id).eq("status", "pendente").select("id").maybeSingle();
    if (!travado) continue;

    if (agora - Date.parse(it.enviar_em) > 2 * 3600_000 || s.status === "encerrada" || !r.whatsapp) {
      await db.from("webinar_reminders_queue").update({ status: "expirado" }).eq("id", it.id);
      resultado.expirados++;
      continue;
    }
    const token = await tokenInscricao(r.id, segredo);
    const { data, hora } = dataHoraSP(s.inicia_em);
    const modelo = (w.lembretes && typeof w.lembretes[it.tipo] === "string" && w.lembretes[it.tipo].trim()) || PADRAO[it.tipo];
    const texto = preencher(modelo, {
      nome: String(r.nome).split(" ")[0],
      titulo: w.titulo,
      link: `${siteUrl()}/w/${w.slug}/sala?r=${encodeURIComponent(token)}`,
      data,
      hora,
    });
    try {
      if (i > 0) await dormir(3000 + Math.floor(Math.random() * 3000));
      const messageId = await enviarWhatsApp(r.whatsapp, { tipo: "text", texto });
      // o eco deste envio volta pelo openwa-webhook como fromMe: sem o registro ele era lido como mensagem manual
      // do celular e pausava a IA da conversa (regra "humano entrou = IA pausada", 21/10/2026)
      await registrarEnvioSistema(db, { messageId, telefone: r.whatsapp, origem: `lembrete do webinário (${it.tipo}): ${w.titulo}` });
      await db.from("webinar_reminders_queue").update({ status: "enviado", enviado_em: new Date().toISOString(), erro: null }).eq("id", it.id);
      resultado.enviados++;
    } catch (e) {
      const tent = (it.tentativas ?? 0) + 1;
      const erro = e instanceof ErroEnvio ? `${e.status}: ${JSON.stringify(e.detalhe).slice(0, 200)}` : String(e).slice(0, 200);
      await db.from("webinar_reminders_queue").update({ status: tent >= 3 ? "falhou" : "pendente", tentativas: tent, erro }).eq("id", it.id);
      resultado.falhas++;
    }
  }
  return json({ ok: true, ...resultado });
});
