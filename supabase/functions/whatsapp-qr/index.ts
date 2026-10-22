// Status e QR de pareamento da sessão do OpenWA (VPS), lidos pelo proxy assinado.
// O OpenWA é o único provedor desde 17/10/2026 (UazAPI aposentada).
//
// ?action=status -> { provider, connected, state, phone, qr: null }
// ?action=qr     -> o mesmo, e quando a sessão está esperando pareamento, qr = data URL da imagem
// ?action=disconnect (GET) -> 405: desconectar agora é POST {acao:"desconectar"} (abaixo).
// &sessao=<nome> (Central /crm/central): escolhe a sessão. Vazio/padrão = igual a antes. Outra sessão só
// vai à ponte com WA_PROXY_MULTISESSAO=1 (secret ou integracao_config 'wa_proxy_multisessao'); sem isso responde state "sem_ponte" sem chamar a rede.
// A resposta sempre ecoa `sessao` (o front usa isso para saber que esta versão entende o parâmetro).
//
// POST { acao: "codigo", sessao, telefone } (só usuário aprovado): código de pareamento de 8 caracteres
// (entrar com número de telefone, alternativa ao QR) -> { codigo, telefone, validadeSegundos, sessao, state }.
// `telefone` é o número que foi ao WhatsApp, já no formato da conta (celular BR de DDD 31+ sem o 9).
// `sessao` é obrigatória e não pode ser a padrão (sem ela o proxy cai no closer: código no número errado).
// Só com a sessão em qr_ready; recusa (409) telefone que já está conectado em OUTRO número do CRM, porque no
// whatsapp-web.js pedir código para um número já ligado pode fazer o WhatsApp desligar aquele aparelho.
//
// POST { acao: "desconectar", sessao } (21/10/2026; só aprovado E admin/liberação Comercial): desconecta o número.
// O proxy faz logout da sessão no OpenWA (desvincula o aparelho; a sessão continua existindo) e start, para ela
// voltar a pedir QR -> { desconectado: true, sessao, connected: false, state, aviso? }. A sessão tem que ser de um
// número OpenWA de crm_numeros (o oficial não tem desconectar). Nada do CRM é apagado (mensagens, contatos, número).
// Permissões do CRM (22/11/2026): ver status = Conexão ou Conversas "ver"; QR/código = ação "conectar" no número.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chamarProxy, ErroProxy } from "../_shared/waProxy.ts";
import { corpoComSessao, SESSAO_PADRAO } from "../_shared/numerosWa.ts";
import { multisessaoLigada } from "../_shared/multisessaoWa.ts";
import {
  mensagemErroDesconectar, numeroParaDesconectar, podeDesconectar, resultadoDesconectar, statusErroDesconectar,
} from "../_shared/desconectarWa.ts";
import {
  codigoPareamentoValido, lerStatusParaCodigo, mensagemErroCodigo, mensagemErroStatusCodigo, PRAZO_CODIGO_MS, sessaoDoPedidoDeCodigo, sessaoQueJaTemOTelefone,
  segundosDeEspera, telefonePareamento, telefoneWhatsapp, textoEspera, VALIDADE_CODIGO_SEGUNDOS,
} from "../_shared/codigoPareamentoWa.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const resp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Estados do OpenWA em que faz sentido pedir o QR.
const ESPERANDO_QR = new Set(["qr_ready", "initializing"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return resp({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return resp({ error: "Unauthorized" }, 401);

    if (req.method === "POST") {
      // código de pareamento: só usuário aprovado; desconectar: aprovado E admin/liberação Comercial
      const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
      const { data: aprovado } = await supabase.rpc("is_approved", { _user_id: user.id });
      if (!aprovado) return resp({ error: "Usuário não aprovado" }, 403);
      // permissões do CRM (22/11/2026): código de pareamento e desconectar = ação "conectar" na Conexão
      const pode = await conferirAcessoCrm(supabase, { area: "conexao", acao: "conexao.conectar" });
      if (!pode.ok) return resp({ error: pode.erro }, pode.status);
      if (typeof corpo?.sessao === "string" && await numeroDaSessao(supabase, corpo.sessao) === false) {
        return resp({ error: "Você não tem acesso a este número." }, 403);
      }
      if (corpo?.acao === "desconectar") {
        const { data: comercial } = await supabase.rpc("pode_comercial", { _user_id: user.id });
        if (!podeDesconectar(aprovado, comercial)) {
          return resp({ error: "Só admin ou quem tem a liberação Comercial pode desconectar um número" }, 403);
        }
        return await desconectar(corpo, user.id);
      }
      return await pedirCodigo(corpo);
    }

    const params = new URL(req.url).searchParams;
    const action = params.get("action") || "status"; // status | qr | disconnect
    const padrao = Deno.env.get("WA_SESSAO_PADRAO") || SESSAO_PADRAO;
    const alvo = corpoComSessao({}, params.get("sessao"), {
      padrao,
      multisessao: await multisessaoLigada(),
    });
    const sessao = alvo.decisao.modo === "padrao" ? padrao : alvo.decisao.sessao;

    {
      const numeroId = await numeroDaSessao(supabase, sessao);
      if (numeroId === false) return resp({ error: "Você não tem acesso a este número." }, 403);
      const ver = await conferirAcessoCrm(supabase, { area: "conexao", nivel: 1, numeroId });
      const acesso = ver.ok ? ver : await conferirAcessoCrm(supabase, { area: "conversas", nivel: 1, numeroId });
      if (!acesso.ok) return resp({ error: acesso.erro }, acesso.status);
      if (action === "qr") {
        const conectar = await conferirAcessoCrm(supabase, { area: "conexao", acao: "conexao.conectar", numeroId });
        if (!conectar.ok) return resp({ error: conectar.erro }, conectar.status);
      }
    }

    if (action === "disconnect") {
      return resp({ error: "Para desconectar, use POST {acao: \"desconectar\", sessao}", provider: "openwa" }, 405);
    }

    if (!alvo.corpo) {
      const motivo = alvo.decisao.modo === "indisponivel" ? alvo.decisao.motivo : "sessão indisponível";
      return resp({ provider: "openwa", sessao, connected: false, state: "sem_ponte", phone: null, qr: null, aviso: motivo });
    }

    let state = "desconhecido";
    let phone: string | null = null;
    try {
      const st = await chamarProxy("status", alvo.corpo);
      state = typeof st?.status === "string" ? st.status : "desconhecido";
      phone = typeof st?.phone === "string" ? st.phone : null;
    } catch (e) {
      console.error("whatsapp-qr status:", e instanceof ErroProxy ? e.status : e instanceof Error ? e.message : e);
      if (e instanceof ErroProxy && e.status === 429) {
        const d = (e.detalhe && typeof e.detalhe === "object" ? e.detalhe : {}) as Record<string, unknown>;
        const espera = segundosDeEspera(d.retryAfter) ?? 60;
        return resp({
          provider: "openwa", sessao, connected: false, state: "desconhecido", phone: null, qr: null, retryAfter: espera,
          aviso: `Muitas consultas de status agora; a leitura volta em ${textoEspera(espera)}. O código de pareamento continua funcionando.`,
        });
      }
      return resp({ provider: "openwa", sessao, connected: false, state: "proxy_indisponivel", phone: null, qr: null });
    }

    const connected = state === "ready";
    // Número conectado: grava o telefone em crm_numeros (Central/Conexões) quando ainda não bate. Best-effort.
    const fone = (phone ?? "").replace(/\D/g, "");
    if (connected && /^\d{10,15}$/.test(fone)) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
          auth: { persistSession: false },
        });
        const { error } = await admin.from("crm_numeros").update({ telefone: fone })
          .eq("sessao_openwa", sessao).or(`telefone.is.null,telefone.neq.${fone}`);
        if (error) console.error("whatsapp-qr telefone:", error.message);
      } catch (e) {
        console.error("whatsapp-qr telefone:", e instanceof Error ? e.message : e);
      }
    }
    let qr: string | null = null;
    let aviso: string | null = null;
    if (action === "qr" && !connected) {
      if (ESPERANDO_QR.has(state.toLowerCase())) {
        try {
          const r = await chamarProxy("qr", alvo.corpo);
          qr = typeof r?.qrCode === "string" && r.qrCode.startsWith("data:image/") ? r.qrCode : null;
          if (!qr) aviso = "QR ainda não está pronto, tente de novo em alguns segundos";
        } catch (e) {
          // 400 do OpenWA = "QR não está pronto" ou "já autenticada": não é erro do CRM
          aviso = e instanceof ErroProxy && e.status === 400
            ? "QR ainda não está pronto, tente de novo em alguns segundos"
            : "Não consegui ler o QR agora";
          console.error("whatsapp-qr qr:", e instanceof ErroProxy ? e.status : e);
        }
      } else {
        aviso = `Sessão em "${state}": precisa ser iniciada no painel do OpenWA antes de gerar o QR`;
      }
    }

    return resp({ provider: "openwa", sessao, connected, state, phone, qr, ...(aviso ? { aviso } : {}) });
  } catch (err) {
    console.error("whatsapp-qr error:", err);
    return resp({ error: err instanceof Error ? err.message : "Unknown" }, 500);
  }
});

/**
 * id do número desta sessão, lido COM o JWT do usuário (crm_numeros só mostra os números dele).
 * null = sessão sem cadastro em crm_numeros (segue a regra só da área); false = o número existe e não é dele.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function numeroDaSessao(cli: any, sessao: string): Promise<string | null | false> {
  const { data } = await cli.from("crm_numeros").select("id").eq("sessao_openwa", sessao).maybeSingle();
  if (data?.id) return String(data.id);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: existe } = await admin.from("crm_numeros").select("id").eq("sessao_openwa", sessao).maybeSingle();
  return existe?.id ? false : null;
}

/** POST {acao:"desconectar"}: chamado só depois de conferir login, aprovação e permissão. */
async function desconectar(corpo: Record<string, unknown>, userId: string): Promise<Response> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: numeros, error: errNum } = await admin.from("crm_numeros").select("apelido, tipo, sessao_openwa, ativo");
  if (errNum) {
    console.error("whatsapp-qr desconectar crm_numeros:", errNum.message);
    return resp({ error: "Não consegui conferir os números do CRM agora" }, 500);
  }
  const alvoNumero = numeroParaDesconectar(corpo.sessao, numeros ?? []);
  if ("error" in alvoNumero) return resp({ provider: "openwa", error: alvoNumero.error }, alvoNumero.status);

  const padrao = Deno.env.get("WA_SESSAO_PADRAO") || SESSAO_PADRAO;
  // `confirmar` = sessão que vai cair; o proxy confere contra a sessão que ele resolveu (a padrão inclusive)
  const alvo = corpoComSessao({ confirmar: alvoNumero.sessao }, alvoNumero.sessao, {
    padrao,
    multisessao: await multisessaoLigada(),
  });
  const sessao = alvo.decisao.modo === "padrao" ? padrao : alvo.decisao.sessao;
  if (!alvo.corpo) {
    const motivo = alvo.decisao.modo === "indisponivel" ? alvo.decisao.motivo : "sessão indisponível";
    return resp({ provider: "openwa", sessao, state: "sem_ponte", error: motivo }, 409);
  }

  try {
    // logout (até 60 s) + start (até 60 s) no proxy
    const r = await chamarProxy("desconectar", alvo.corpo, { timeoutMs: 130_000 });
    const out = resultadoDesconectar(r);
    console.log("whatsapp-qr desconectar:", JSON.stringify({ sessao, por: userId, state: out.state }));
    return resp({
      provider: "openwa", sessao, connected: false, phone: null, desconectado: true, state: out.state,
      ...(out.aviso ? { aviso: out.aviso } : {}),
    });
  } catch (e) {
    const status = e instanceof ErroProxy ? e.status : 502;
    const detalhe = e instanceof ErroProxy ? e.detalhe : null;
    console.error("whatsapp-qr desconectar:", sessao, status, e instanceof ErroProxy ? "" : e instanceof Error ? e.message : e);
    return resp({ provider: "openwa", sessao, error: mensagemErroDesconectar(status, detalhe) }, statusErroDesconectar(status));
  }
}

/** POST {acao:"codigo"}: chamado só depois de conferir login e aprovação. */
async function pedirCodigo(corpo: Record<string, unknown> | null): Promise<Response> {
  if (!corpo || corpo.acao !== "codigo") return resp({ error: "acao inválida" }, 400);
  const digitado = telefonePareamento(corpo.telefone);
  if (!digitado) return resp({ error: "Número inválido: use DDI + DDD + número (ex.: 55 31 99999-8888)" }, 400);
  // o código é amarrado ao número exato da conta: manda no formato do WhatsApp (DDD 31+ sem o 9) e devolve qual foi
  const telefone = telefoneWhatsapp(digitado);

  const padrao = Deno.env.get("WA_SESSAO_PADRAO") || SESSAO_PADRAO;
  // sessão obrigatória e explícita: sem ela o proxy cairia na padrão (closer) e o código nasceria no número errado
  const pedida = sessaoDoPedidoDeCodigo(corpo.sessao, padrao);
  if ("error" in pedida) return resp({ provider: "openwa", error: pedida.error }, pedida.status);
  const alvo = corpoComSessao({}, pedida.sessao, {
    padrao,
    multisessao: await multisessaoLigada(),
  });
  const sessao = alvo.decisao.modo === "padrao" ? padrao : alvo.decisao.sessao;
  if (!alvo.corpo || !("sessao" in alvo.corpo)) {
    const motivo = alvo.decisao.modo === "indisponivel" ? alvo.decisao.motivo : "sessão indisponível";
    return resp({ provider: "openwa", sessao, state: "sem_ponte", error: motivo }, 409);
  }

  // número já ligado em outro cartão do CRM: pedir código pode desligar aquele aparelho (wwjs, OpenWA #1653)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: numeros, error: errNum } = await admin.from("crm_numeros").select("telefone, sessao_openwa")
    .not("telefone", "is", null);
  if (errNum) {
    console.error("whatsapp-qr codigo crm_numeros:", errNum.message);
    return resp({ error: "Não consegui conferir os números do CRM agora" }, 500);
  }
  const outra = sessaoQueJaTemOTelefone(telefone, sessao, numeros ?? []);
  if (outra) {
    return resp({
      provider: "openwa", sessao,
      error: `Este telefone já está conectado em outro número do CRM (sessão ${outra}). Pedir código pode desconectar aquele aparelho.`,
    }, 409);
  }

  // status é só conferência: 429 (limite de consultas) relê uma vez e, se insistir, segue para o código
  // (o OpenWA recusa o código com 400/409 se a sessão não estiver esperando pareamento)
  const lido = await lerStatusParaCodigo(
    () => chamarProxy("status", alvo.corpo!),
    (ms) => new Promise((r) => setTimeout(r, ms)),
  );
  if ("erro" in lido) {
    console.error("whatsapp-qr codigo status:", lido.erro.status);
    return resp({
      provider: "openwa", sessao, state: "proxy_indisponivel",
      error: mensagemErroStatusCodigo(lido.erro.status, lido.erro.detalhe),
    }, 502);
  }
  if (lido.limitado) console.error("whatsapp-qr codigo status: 429, seguindo sem conferir o estado");
  const state = lido.state;
  if (state === "ready") return resp({ provider: "openwa", sessao, state, connected: true, codigo: null });
  if (!lido.limitado && state.toLowerCase() !== "qr_ready") {
    return resp({
      provider: "openwa", sessao, state,
      error: state === "initializing"
        ? "A sessão ainda está iniciando. Espere o QR code aparecer e tente de novo."
        : `Sessão em "${state}": precisa ser iniciada no painel do OpenWA antes de gerar o código`,
    }, 409);
  }

  try {
    const r = await chamarProxy("pairing-code", { ...alvo.corpo, phone: telefone }, { timeoutMs: PRAZO_CODIGO_MS });
    const codigo = codigoPareamentoValido(r?.pairingCode);
    if (!codigo) return resp({ provider: "openwa", sessao, state, error: "O WhatsApp devolveu um código ilegível. Tente de novo." }, 502);
    return resp({ provider: "openwa", sessao, state, codigo, telefone, validadeSegundos: VALIDADE_CODIGO_SEGUNDOS });
  } catch (e) {
    const status = e instanceof ErroProxy ? e.status : 502;
    const detalhe = e instanceof ErroProxy ? e.detalhe : null;
    console.error("whatsapp-qr codigo:", status, e instanceof ErroProxy ? "" : e instanceof Error ? e.message : e);
    const devolve = [400, 404, 409, 429].includes(status) ? (status === 404 ? 501 : status) : 502;
    return resp({ provider: "openwa", sessao, state, error: mensagemErroCodigo(status, detalhe) }, devolve);
  }
}
