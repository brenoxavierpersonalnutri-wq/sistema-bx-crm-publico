// Envia mídia (imagem, vídeo, áudio, documento) pelo proxy do OpenWA na VPS e registra no CRM.
// OpenWA é o único provedor desde 17/10/2026 (UazAPI aposentada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ErroProxy } from "../_shared/waProxy.ts";
import { chamarProxyNaSessao, sessaoEnvio } from "../_shared/waNumero.ts";
// numero_id (17/10/2026): responde pelo MESMO número da conversa; sem ele, o padrão (closer).
import { enviarNotaDeVoz } from "../_shared/notaDeVoz.ts";
// Grupo (…@g.us) só com manual: true (atendente na tela Conversas), pela rota manual do proxy (sem allowlist).
import { avisoLimite, corpoMidiaGrupoManual, destinoEnvio, type TipoMidia } from "../_shared/envioGrupoManual.ts";
// Humano respondeu pelo CRM: pausa o robô de IA nesta conversa (18/10/2026).
import { pausarPorHumano } from "../_shared/roboPausa.ts";
// Permissões do CRM (22/11/2026): número/área/atendente conferidos no banco com o JWT de quem envia.
import { conferirAcessoCrm, marcarAtendenteSeVazio } from "../_shared/acessoCrm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const rotulo = (tipo: string): string =>
  tipo === "image" ? "[foto]" :
  tipo === "audio" ? "[áudio]" :
  tipo === "video" ? "[vídeo]" :
  tipo === "document" ? "[documento]" : "[mídia]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const destino = destinoEnvio(body?.phone, body?.manual);
    const url = typeof body?.url === "string" ? body.url : "";
    const tipoBruto = String(body?.tipo ?? "").toLowerCase();
    const legenda = typeof body?.legenda === "string" ? body.legenda : "";
    const fileName = typeof body?.file_name === "string" ? body.file_name : null;
    // ptt: áudio vai como nota de voz por padrão (o proxy converte mp3/m4a/ogg para Ogg/Opus; 21/10/2026).
    // ptt: false explícito = manda o arquivo de áudio como documento.
    const numeroId = typeof body?.numero_id === "string" && /^[0-9a-f-]{36}$/i.test(body.numero_id) ? body.numero_id : null;

    const tiposValidos = ["image", "video", "audio", "document"];
    const ptt = tipoBruto === "audio" && body?.ptt !== false;
    if ("erro" in destino) return json({ error: destino.erro }, destino.status);
    if (!url) return json({ error: "url obrigatória" }, 400);
    if (!tiposValidos.includes(tipoBruto)) return json({ error: "tipo inválido" }, 400);

    const grupo = destino.tipo === "grupo";
    // telefone: 10 a 15 dígitos com 55; grupo: o próprio JID (é a chave do contato no CRM)
    const number = destino.tipo === "grupo" ? destino.chatId : destino.numero;
    let messageId: unknown = null;

    const acesso = await conferirAcessoCrm(supabase, { conversa: { numeroId, phone: number }, acao: "conversas.enviar" });
    if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);

    // Rotas fechadas do proxy: send-image, send-audio (nota de voz) e send-document.
    // Vídeo (e áudio com ptt: false) segue como documento: o arquivo chega inteiro e abre no celular.
    if (!/^https:\/\//.test(url)) return json({ error: "url precisa ser https" }, 400);
    if (body?.ptt === true && tipoBruto !== "audio") return json({ error: "nota de voz só vale para áudio" }, 400);
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const alvo = await sessaoEnvio(serviceSupabase, numeroId);
    if ("recusa" in alvo) return json({ error: `Não dá pra responder por este número: ${alvo.recusa}` }, 409);
    // 55 s: nota de voz passa pela conversão do proxy (download + ffmpeg) antes do envio
    const proxy = (rota: string, corpo: Record<string, unknown>) => chamarProxyNaSessao(rota, corpo, alvo.sessao, { timeoutMs: 55_000 });
    let comoVoz = false;
    try {
      if (grupo) {
        const r = await proxy("send-group-manual-media", corpoMidiaGrupoManual(number, {
          tipo: tipoBruto as TipoMidia, url, legenda, fileName, ptt,
        }));
        messageId = r?.messageId ?? null;
        comoVoz = ptt;
      } else if (ptt) {
        // envio manual: a pessoa já gravou/escolheu agora, então sem "gravando áudio…" antes; teto maior (conversão)
        const v = await enviarNotaDeVoz(proxy, { phone: number, url, filename: fileName, gravando: false });
        messageId = v.messageId;
        comoVoz = v.como === "voz";
      } else {
        const r = tipoBruto === "image"
          ? await proxy("send-image", { phone: number, url, ...(legenda ? { caption: legenda } : {}) })
          : await proxy("send-document", {
              phone: number,
              url,
              ...(fileName ? { filename: fileName } : {}),
              ...(legenda ? { caption: legenda } : {}),
            });
        messageId = r?.messageId ?? null;
      }
    } catch (e) {
      const status = e instanceof ErroProxy ? e.status : 0;
      console.error("OpenWA proxy media error:", status);
      if (status === 503) return json({ error: `Sem ponte para este número: ${String(e instanceof ErroProxy ? e.detalhe : "")}`.slice(0, 300) }, 409);
      return status === 429
        ? json({ error: avisoLimite(grupo) }, 429)
        : json({ error: "Falha ao enviar mídia", detail: e instanceof ErroProxy ? e.detalhe : undefined }, 502);
    }

    // insert simples (índice parcial de message_id); 23505 = o eco do webhook chegou antes
    const { error: erroLog } = await serviceSupabase.from("whatsapp_messages").insert({
      ...(numeroId ? { numero_id: numeroId } : {}),
      contact_phone: number,
      direction: "outbound",
      sender_type: "user",
      body: legenda || rotulo(tipoBruto),
      media_url: url,
      media_type: tipoBruto,
      file_name: fileName,
      caption: legenda || null,
      message_id: messageId ? String(messageId) : null,
    });
    if (erroLog && erroLog.code !== "23505") console.error("whatsapp-send-media: log falhou", erroLog.message);
    if (!grupo) await pausarPorHumano(serviceSupabase, numeroId, number, "mensagem manual pelo CRM");
    await marcarAtendenteSeVazio(supabase, numeroId, number);

    // como: "voz" (bolha de microfone) ou "documento" (proxy ainda sem a rota send-audio)
    return json({ ok: true, messageId, ...(ptt ? { como: comoVoz ? "voz" : "documento" } : {}) });
  } catch (err) {
    console.error("whatsapp-send-media error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown" }, 500);
  }
});
