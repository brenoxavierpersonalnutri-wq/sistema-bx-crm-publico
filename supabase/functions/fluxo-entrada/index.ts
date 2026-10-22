// fluxo-entrada: URL de entrada de leads de UM fluxo (gatilho "Webhook / API (entrada)", igual ao SellFlux).
//
//   POST .../functions/v1/fluxo-entrada?f=<id_publico>&k=<token>
//   corpo: JSON ou formulário (x-www-form-urlencoded / multipart) com nome, telefone, email, tags e o que mais vier.
//
// verify_jwt = false: quem chama é sistema de fora. A credencial é o token do fluxo (crm_fluxo_entradas, gerado
// no banco, só admin vê). Assinatura HMAC-SHA256 do corpo é opcional (header x-assinatura, "sha256=<hex>" ou hex).
// Rate limit por fluxo (crm_fluxo_entrada_bater, janela de 1 min). Toda requisição autenticada vira a "última
// requisição recebida" (amostra) que a tela usa para o mapeamento de campos.
//
// Fluxo PUBLICADO: cria/atualiza o contato (whatsapp_contacts + base_leads com origem webhook:<fluxo>), aplica as
// tags e grava o evento webhook_<fluxo>; o motor (crm-automacoes, 1/min) inscreve respeitando o limite por dia.
// Fluxo em RASCUNHO: só guarda a amostra e devolve a prévia do mapeamento (não cria contato).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_CORPO_BYTES,
  amostraSegura,
  assinaturaConfere,
  extrairLead,
  formParaObjeto,
  tokenConfere,
  type MapeamentoEntrada,
} from "../_shared/fluxoEntrada.ts";
import { eventoWebhook } from "../_shared/fluxos.ts";
import { normalizarTag } from "../_shared/automacoes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-fluxo-token, x-assinatura, x-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

interface Entrada {
  fluxo_id: string;
  id_publico: string;
  token: string;
  segredo_assinatura: string | null;
  ativo: boolean;
  mapeamento: MapeamentoEntrada | null;
  tags: string[] | null;
  origem: string;
  total: number;
}

async function hmacHex(segredo: string, corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lerCorpo(req: Request, bruto: string): Promise<unknown> {
  const tipo = (req.headers.get("content-type") ?? "").toLowerCase();
  // JSON mandado com content-type de formulário (curl -d, Zapier mal configurado): o corpo manda
  if (/^\s*[[{]/.test(bruto)) {
    try { return JSON.parse(bruto); } catch { /* segue pelo content-type */ }
  }
  if (tipo.includes("application/x-www-form-urlencoded")) return formParaObjeto(new URLSearchParams(bruto));
  if (tipo.includes("multipart/form-data")) {
    const fd = await new Response(bruto, { headers: { "content-type": req.headers.get("content-type")! } }).formData();
    return formParaObjeto([...fd.entries()].filter(([, v]) => typeof v === "string") as [string, string][]);
  }
  try {
    return JSON.parse(bruto);
  } catch {
    // sem content-type certo: tenta formulário
    return bruto.includes("=") ? formParaObjeto(new URLSearchParams(bruto)) : null;
  }
}

async function anotar(e: Entrada, campos: Record<string, unknown>) {
  await db.from("crm_fluxo_entradas").update({ ...campos, total: (e.total ?? 0) + 1, ultima_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("fluxo_id", e.fluxo_id);
}

/** Cria o contato (número padrão) ou atualiza todos os registros dele: nome se vazio, tags somadas. */
async function gravarContato(telefone: string, nome: string | null, tags: string[]): Promise<"criado" | "atualizado"> {
  const { data: ja, error } = await db.from("whatsapp_contacts").select("id, name, tags").eq("phone", telefone);
  if (error) throw new Error(`contato: ${error.message}`);
  if (!ja?.length) {
    const { error: e } = await db.from("whatsapp_contacts").insert({ phone: telefone, name: nome ?? "", source: "webhook", tags });
    if (e && e.code !== "23505") throw new Error(`contato: ${e.message}`);
    if (!e) return "criado";
  }
  for (const c of (ja ?? []) as { id: string; name: string | null; tags: string[] | null }[]) {
    const atuais = (c.tags ?? []).map(normalizarTag);
    const novas = [...new Set([...atuais, ...tags])];
    const mud: Record<string, unknown> = {};
    if (novas.length !== atuais.length) mud.tags = novas;
    if (nome && !String(c.name ?? "").trim()) mud.name = nome;
    if (Object.keys(mud).length) {
      mud.updated_at = new Date().toISOString();
      const { error: e } = await db.from("whatsapp_contacts").update(mud).eq("id", c.id);
      if (e) throw new Error(`contato: ${e.message}`);
    }
  }
  return "atualizado";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);

  const url = new URL(req.url);
  const idPublico = (url.searchParams.get("f") ?? "").trim();
  const token = url.searchParams.get("k") ?? req.headers.get("x-fluxo-token") ?? "";
  if (!/^[0-9a-f]{6,64}$/.test(idPublico)) return json({ ok: false, erro: "parâmetro f inválido" }, 400);

  const { data: linha } = await db.from("crm_fluxo_entradas")
    .select("fluxo_id, id_publico, token, segredo_assinatura, ativo, mapeamento, tags, origem, total")
    .eq("id_publico", idPublico).maybeSingle();
  const e = linha as Entrada | null;
  // mesma resposta para "não existe" e "token errado" (não confirma id válido)
  if (!e || !tokenConfere(token, e.token)) return json({ ok: false, erro: "não autorizado" }, 401);
  if (!e.ativo) return json({ ok: false, erro: "entrada desligada" }, 403);

  const { data: pode } = await db.rpc("crm_fluxo_entrada_bater", { p_id_publico: idPublico });
  if (pode !== true) {
    await db.from("crm_fluxo_entradas").update({ ultimo_status: "limite", ultimo_erro: "limite por minuto" }).eq("fluxo_id", e.fluxo_id);
    return json({ ok: false, erro: "limite de requisições por minuto" }, 429);
  }

  const bruto = await req.text();
  if (new TextEncoder().encode(bruto).length > MAX_CORPO_BYTES) return json({ ok: false, erro: "corpo maior que 64 KB" }, 413);

  if (e.segredo_assinatura) {
    const recebida = req.headers.get("x-assinatura") ?? req.headers.get("x-signature") ?? req.headers.get("x-hub-signature-256");
    if (!assinaturaConfere(recebida, await hmacHex(e.segredo_assinatura, bruto))) {
      await anotar(e, { ultimo_status: "recusado", ultimo_erro: "assinatura não confere" });
      return json({ ok: false, erro: "assinatura não confere" }, 401);
    }
  }

  const corpo = await lerCorpo(req, bruto);
  const amostra = amostraSegura(corpo);
  const r = extrairLead(corpo, e.mapeamento ?? {}, (e.tags ?? []).map(normalizarTag).filter(Boolean));
  if (!r.ok) {
    await anotar(e, { ultima_amostra: amostra, ultimo_status: "erro", ultimo_erro: r.erro });
    return json({ ok: false, erro: r.erro }, 422);
  }
  const lead = r.lead;

  const { data: fluxo } = await db.from("crm_fluxos").select("id, nome, ativo, excluido_em, gatilhos").eq("id", e.fluxo_id).maybeSingle();
  if (!fluxo || fluxo.excluido_em) {
    await anotar(e, { ultima_amostra: amostra, ultimo_status: "erro", ultimo_erro: "fluxo excluído" });
    return json({ ok: false, erro: "fluxo excluído" }, 410);
  }
  const temGatilho = Array.isArray(fluxo.gatilhos) && fluxo.gatilhos.some((g: { tipo?: string }) => g?.tipo === "webhook");
  if (!fluxo.ativo || !temGatilho) {
    const aviso = !fluxo.ativo ? "fluxo não publicado: só guardei a amostra" : "o fluxo não tem gatilho Webhook: só guardei a amostra";
    await anotar(e, { ultima_amostra: amostra, ultimo_status: "rascunho", ultimo_erro: fluxo.ativo ? aviso : null });
    return json({ ok: true, modo: "rascunho", aviso, previa: { telefone: lead.telefone, nome: lead.nome, email: lead.email, tags: lead.tags, evento: lead.evento } });
  }

  try {
    const contato = await gravarContato(lead.telefone, lead.nome, lead.tags);
    const { error: eb } = await db.from("base_leads").upsert({
      origem: e.origem, origem_id: lead.telefone, nome: lead.nome, telefone_e164: `+${lead.telefone}`,
      email: lead.email, tags: lead.tags, produto: lead.dados.produto ?? null,
    }, { onConflict: "origem,origem_id" });
    if (eb) console.error("base_leads:", eb.message); // a base é secundária: não impede a inscrição
    // evento direto (o contato já foi garantido acima; crm_registrar_evento criaria outro no número padrão
    // quando o contato só existe em outro número)
    const eventos = [{ contact_phone: lead.telefone, tipo: "evento", valor: eventoWebhook(e.fluxo_id), dados: lead.dados }];
    if (lead.evento) eventos.push({ contact_phone: lead.telefone, tipo: "evento", valor: lead.evento, dados: lead.dados });
    const { error: ev } = await db.from("crm_contato_eventos").insert(eventos);
    if (ev) throw new Error(`evento: ${ev.message}`);
    await anotar(e, { ultima_amostra: amostra, ultimo_status: "ok", ultimo_erro: null });
    return json({ ok: true, contato, telefone: lead.telefone, tags: lead.tags, evento_extra: lead.evento, inscricao: "o fluxo inscreve em até 1 minuto (respeita o limite por dia)" });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    await anotar(e, { ultima_amostra: amostra, ultimo_status: "erro", ultimo_erro: msg });
    return json({ ok: false, erro: msg }, 500);
  }
});
