// Edge function: envia comprovante de pagamento por e-mail (via Lovable Emails)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { transacao_id } = await req.json();
    if (!transacao_id) {
      return new Response(JSON.stringify({ error: "transacao_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tx, error } = await supabase
      .from("gateway_transacoes")
      .select("*")
      .eq("id", transacao_id)
      .single();
    if (error || !tx) {
      return new Response(JSON.stringify({ error: "Transação não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca config do dono pra usar nome da empresa
    const { data: cfg } = await supabase
      .from("gateway_config")
      .select("nome_empresa")
      .eq("user_id", tx.user_id)
      .maybeSingle();
    const empresa = cfg?.nome_empresa || "BG Fitness";

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #10b981;">Pagamento confirmado ✓</h2>
        <p>Olá, <strong>${tx.cliente_nome}</strong>!</p>
        <p>Seu pagamento foi recebido com sucesso. Segue o comprovante:</p>
        <div style="background: #f4f4f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Valor:</strong> ${formatCurrency(Number(tx.valor_bruto))}</p>
          <p><strong>Método:</strong> ${tx.metodo}</p>
          ${tx.parcelas > 1 ? `<p><strong>Parcelas:</strong> ${tx.parcelas}x</p>` : ""}
          ${tx.descricao ? `<p><strong>Descrição:</strong> ${tx.descricao}</p>` : ""}
          <p><strong>ID:</strong> ${tx.id.slice(0, 8)}</p>
          <p><strong>Pago em:</strong> ${new Date(tx.pago_em ?? tx.created_at).toLocaleString("pt-BR")}</p>
        </div>
        <p style="color: #71717a; font-size: 13px;">Guarde este e-mail como comprovante.</p>
        <p style="color: #71717a; font-size: 13px;">— ${empresa}</p>
      </div>
    `;

    // Envia via fila de e-mails da plataforma
    const { error: mailError } = await supabase.rpc("enqueue_email", {
      p_purpose: "transactional",
      p_to: tx.cliente_email,
      p_subject: `Comprovante de pagamento — ${empresa}`,
      p_html: html,
      p_idempotency_key: `receipt-${tx.id}`,
    });

    if (mailError) {
      console.error("Falha ao enfileirar e-mail:", mailError);
      return new Response(JSON.stringify({
        error: "E-mail não pôde ser enviado. Verifique se o domínio de e-mail está configurado.",
        details: mailError.message,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
