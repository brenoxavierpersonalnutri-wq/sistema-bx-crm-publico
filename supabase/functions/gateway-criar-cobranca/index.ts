// Edge Function: gateway-criar-cobranca
// Integração real com a InfinitePay (Checkout Links).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HANDLE = Deno.env.get("INFINITEPAY_HANDLE") ?? "";
const BASE_URL = (Deno.env.get("INFINITEPAY_BASE_URL") ?? "https://api.checkout.infinitepay.io").replace(/\/$/, "");
const REDIRECT_URL = "https://equipe.brenoxavier.com.br/pagamento-sucesso";
const WEBHOOK_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gateway-webhook`;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function calcLiquido(bruto: number, metodo: string, parcelas: number, taxas: any) {
  const fixa = Number(taxas.taxa_fixa ?? 0.49);
  let perc = 0;
  if (metodo === "pix") perc = Number(taxas.taxa_pix ?? 0.99);
  else if (metodo === "boleto") perc = Number(taxas.taxa_boleto ?? 2.49);
  else perc = parcelas > 1 ? Number(taxas.taxa_cartao_parcelado ?? 4.99) : Number(taxas.taxa_cartao_vista ?? 3.99);
  return { liquido: +(bruto - bruto * (perc / 100) - fixa).toFixed(2), taxa_percentual: perc, taxa_fixa: fixa };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!HANDLE) throw new Error("INFINITEPAY_HANDLE não configurado");

    const body = await req.json();
    const {
      cliente_nome, cliente_email, cliente_cpf_cnpj, cliente_telefone,
      valor_bruto, metodo, descricao, parcelas = 1, link_id, copy_origem,
      order_nsu: custom_order_nsu, vencimento,
    } = body;

    if (!valor_bruto || !descricao) {
      return new Response(JSON.stringify({ error: "Valor e descrição são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metodoFinal = metodo || "todos";
    const nomeFinal = (cliente_nome && String(cliente_nome).trim()) || "Aguardando pagador";
    const emailFinal = (cliente_email && String(cliente_email).trim()) || "pendente@checkout.local";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Autenticação: API key OU link público OU usuário logado
    const auth = req.headers.get("authorization") ?? "";
    let user_id: string | null = null;

    if (auth.startsWith("Bearer bg_live_")) {
      const key = auth.replace("Bearer ", "").trim();
      const hash = await sha256(key);
      const { data: keyRow } = await supabase
        .from("gateway_api_keys")
        .select("user_id, ativo")
        .eq("key_hash", hash)
        .maybeSingle();
      if (!keyRow?.ativo) {
        return new Response(JSON.stringify({ error: "API key inválida" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user_id = keyRow.user_id;
      await supabase.from("gateway_api_keys").update({ ultimo_uso: new Date().toISOString() }).eq("key_hash", hash);
    } else if (link_id) {
      const { data: link } = await supabase.from("gateway_links").select("user_id").eq("id", link_id).maybeSingle();
      user_id = link?.user_id ?? null;
    } else if (auth.startsWith("Bearer ")) {
      // Usuário autenticado do app
      const token = auth.replace("Bearer ", "").trim();
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data } = await anon.auth.getUser(token);
      user_id = data.user?.id ?? null;
    }

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await supabase.from("gateway_config").select("*").eq("user_id", user_id).maybeSingle();
    const metodoCalc = metodoFinal === "todos" ? "cartao" : metodoFinal;
    const calc = calcLiquido(Number(valor_bruto), metodoCalc, parcelas, cfg ?? {});
    const order_nsu = (custom_order_nsu && String(custom_order_nsu).trim()) || crypto.randomUUID();
    const priceCents = Math.round(Number(valor_bruto) * 100);
    const itemDesc = (descricao && String(descricao).trim()) || `Cobrança ${nomeFinal}`.slice(0, 120);

    // 1) Cria transação local pendente
    const insertPayload: any = {
      user_id,
      link_id: link_id ?? null,
      cliente_nome: nomeFinal,
      cliente_email: emailFinal,
      cliente_cpf_cnpj: cliente_cpf_cnpj ?? null,
      cliente_telefone: cliente_telefone ?? null,
      valor_bruto: Number(valor_bruto),
      valor_liquido: calc.liquido,
      taxa_percentual: calc.taxa_percentual,
      taxa_fixa: calc.taxa_fixa,
      metodo: metodoFinal, parcelas,
      descricao: descricao ?? null,
      status: "pendente",
      order_nsu,
      copy_origem: copy_origem ?? null,
      vencimento: vencimento || null,
    };

    const { data: tx, error: insErr } = await supabase
      .from("gateway_transacoes").insert(insertPayload).select().single();
    if (insErr) throw insErr;

    // 2) Cria link real na InfinitePay
    const ipPayload = {
      handle: HANDLE,
      items: [{ quantity: 1, price: priceCents, description: itemDesc }],
      order_nsu,
      redirect_url: REDIRECT_URL,
      webhook_url: WEBHOOK_URL,
    };

    let ipResp: any = null;
    let ipStatus = 0;
    try {
      const r = await fetch(`${BASE_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ipPayload),
      });
      ipStatus = r.status;
      ipResp = await r.json().catch(() => ({}));
    } catch (e) {
      console.error("[criar-cobranca] erro fetch InfinitePay:", e);
    }

    const payment_url =
      ipResp?.url || ipResp?.link || ipResp?.payment_url || ipResp?.checkout_url || null;
    const invoice_slug =
      ipResp?.slug || ipResp?.invoice_slug || ipResp?.id || null;

    if (ipStatus < 200 || ipStatus >= 300 || !payment_url) {
      // Rollback
      await supabase.from("gateway_transacoes").delete().eq("id", tx.id);
      console.error("[criar-cobranca] InfinitePay falhou:", ipStatus, ipResp);
      return new Response(JSON.stringify({
        error: "Falha ao criar cobrança na InfinitePay",
        gateway_status: ipStatus, gateway_response: ipResp,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Atualiza transação com dados do gateway
    const { data: updated } = await supabase
      .from("gateway_transacoes")
      .update({ link_pagamento: payment_url, invoice_slug, gateway_id: invoice_slug })
      .eq("id", tx.id)
      .select().single();

    return new Response(JSON.stringify({
      success: true,
      transacao: updated ?? tx,
      payment_url,
      order_nsu,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[gateway-criar-cobranca]", e);
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
