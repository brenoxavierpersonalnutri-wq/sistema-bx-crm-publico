// headturbo-zernio: funções puras (sem rede, sem disco). Testadas em test/lib.test.mjs.
// Fonte da API: https://docs.zernio.com/api/openapi (v1.321.0, lida em 21/10/2026) e https://docs.zernio.com/webhooks.
import crypto from "node:crypto";

export const TIPOS = ["feed", "carrossel", "reels", "story"];
export const STATUS = ["enviando", "agendado", "publicando", "publicado", "erro", "cancelado"];
export const PENDENTES = ["enviando", "agendado", "publicando"];

// MIME que o upload aceita (subconjunto do MediaContentType da Zernio que o Instagram publica).
export const MIME_ACEITOS = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
};

export const LEGENDA_MAX = 2200; // limite do Instagram
export const CARROSSEL_MAX = 10; // Instagram (a Zernio aceita até 20, o app do Instagram mostra 10)
export const AGENDAR_MIN_MS = 2 * 60 * 1000; // agendamento precisa estar pelo menos 2 min à frente
export const AGENDAR_MAX_MS = 120 * 24 * 60 * 60 * 1000; // até 120 dias
export const AGORA_ATRASO_MS = 60 * 1000; // "postar agora" = agendar para daqui a 60 s (ver README)

const OBJECT_ID = /^[a-f0-9]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function ehUuid(v) {
  return typeof v === "string" && UUID.test(v);
}

function textoOpcional(v, max, campo) {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== "string") return { ok: false, erro: `${campo} precisa ser texto` };
  if (v.length > max) return { ok: false, erro: `${campo} passou de ${max} caracteres` };
  return { ok: true, valor: v };
}

function urlHttps(u) {
  if (typeof u !== "string" || u.length > 2000) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !!x.hostname && !x.username && !x.password;
  } catch {
    return false;
  }
}

/**
 * Valida o pedido de publicação que vem do CRM. Devolve { ok, valor } ou { ok:false, erro } com texto legível.
 * `agoraMs` entra como parâmetro para o teste controlar o relógio.
 */
export function validarPublicacao(e, agoraMs = Date.now()) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, erro: "corpo inválido" };

  const cardRef = e.card_ref;
  if (typeof cardRef !== "string" || !cardRef.trim() || cardRef.length > 200) {
    return { ok: false, erro: "card_ref ausente ou longo demais" };
  }
  const perfil = textoOpcional(e.perfil, 40, "perfil");
  if (!perfil.ok) return perfil;
  const cardTexto = textoOpcional(e.card_texto, 2000, "texto do card");
  if (!cardTexto.ok) return cardTexto;

  if (typeof e.conta_id !== "string" || !OBJECT_ID.test(e.conta_id)) {
    return { ok: false, erro: "escolha uma conta do Instagram" };
  }
  const contaNome = textoOpcional(e.conta_nome, 100, "nome da conta");
  if (!contaNome.ok) return contaNome;

  if (!TIPOS.includes(e.tipo)) return { ok: false, erro: "tipo precisa ser feed, carrossel, reels ou story" };

  const legenda = textoOpcional(e.legenda, LEGENDA_MAX, "legenda");
  if (!legenda.ok) return legenda;

  if (!Array.isArray(e.midias) || e.midias.length === 0) return { ok: false, erro: "falta a mídia" };
  if (e.midias.length > CARROSSEL_MAX) return { ok: false, erro: `no máximo ${CARROSSEL_MAX} mídias` };
  const midias = [];
  for (const [i, m] of e.midias.entries()) {
    if (!m || typeof m !== "object") return { ok: false, erro: `mídia ${i + 1} inválida` };
    if (!urlHttps(m.url)) return { ok: false, erro: `mídia ${i + 1}: o endereço precisa ser https` };
    if (m.tipo !== "image" && m.tipo !== "video") return { ok: false, erro: `mídia ${i + 1}: tipo precisa ser imagem ou vídeo` };
    midias.push({ url: m.url, tipo: m.tipo });
  }
  const imagens = midias.filter((m) => m.tipo === "image").length;
  const videos = midias.length - imagens;
  if (e.tipo === "feed" && !(midias.length === 1 && imagens === 1)) {
    return { ok: false, erro: "feed leva exatamente 1 imagem (vídeo vai como reels; várias, como carrossel)" };
  }
  if (e.tipo === "carrossel" && midias.length < 2) return { ok: false, erro: "carrossel precisa de 2 a 10 mídias" };
  if (e.tipo === "reels" && !(midias.length === 1 && videos === 1)) return { ok: false, erro: "reels leva exatamente 1 vídeo" };
  if (e.tipo === "story" && midias.length !== 1) return { ok: false, erro: "story leva exatamente 1 imagem ou vídeo" };

  let agendarPara = null;
  let agora = false;
  if (e.agendar_para === null || e.agendar_para === undefined || e.agendar_para === "") {
    agora = true;
  } else {
    if (typeof e.agendar_para !== "string") return { ok: false, erro: "data de agendamento inválida" };
    // Exige fuso explícito: sem Z/offset a Zernio leria no fuso do perfil, e o horário escolhido mudaria.
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(e.agendar_para)) return { ok: false, erro: "data de agendamento sem fuso" };
    const ms = Date.parse(e.agendar_para);
    if (!Number.isFinite(ms)) return { ok: false, erro: "data de agendamento inválida" };
    // A Zernio publica NA HORA um scheduledFor no passado. Por isso o passado é recusado aqui, nunca repassado.
    if (ms < agoraMs + AGENDAR_MIN_MS) return { ok: false, erro: "o horário precisa estar pelo menos 2 minutos no futuro" };
    if (ms > agoraMs + AGENDAR_MAX_MS) return { ok: false, erro: "agendamento até 120 dias à frente" };
    agendarPara = new Date(ms).toISOString();
  }

  return {
    ok: true,
    valor: {
      card_ref: cardRef.trim(),
      perfil: perfil.valor,
      card_texto: cardTexto.valor,
      conta_id: e.conta_id,
      conta_nome: contaNome.valor,
      tipo: e.tipo,
      legenda: e.tipo === "story" ? null : legenda.valor, // story não tem legenda no Instagram
      midias,
      agora,
      agendado_para: agendarPara,
    },
  };
}

/** Corpo do POST /v1/posts da Zernio. `agoraMs` define o horário quando é "postar agora". */
export function montarPostZernio(v, publicacaoId, agoraMs = Date.now()) {
  const scheduledFor = v.agora ? new Date(agoraMs + AGORA_ATRASO_MS).toISOString() : v.agendado_para;
  const plataforma = { platform: "instagram", accountId: v.conta_id };
  if (v.tipo === "story") plataforma.platformSpecificData = { contentType: "story" };
  if (v.tipo === "reels") plataforma.platformSpecificData = { shareToFeed: true };
  const corpo = {
    mediaItems: v.midias.map((m) => ({ type: m.tipo, url: m.url })),
    platforms: [plataforma],
    scheduledFor,
    timezone: "America/Sao_Paulo",
    metadata: { crm_publicacao_id: publicacaoId, origem: "equipe.brenoxavier.com.br" },
  };
  if (v.legenda) corpo.content = v.legenda;
  return corpo;
}

const ERRO_CATEGORIA = {
  auth_expired: "o acesso da conta expirou: reconecte o Instagram na Zernio",
  account_issue: "problema na conta do Instagram (confira na Zernio)",
  user_content: "o Instagram recusou o conteúdo",
  user_abuse: "o Instagram limitou a conta por excesso de posts",
  platform_rejected: "o Instagram recusou a publicação",
  platform_error: "erro do Instagram",
  platform_rate_limit: "limite de publicações do Instagram atingido",
  quota_exhausted: "cota da Zernio esgotada",
  system_error: "erro interno da Zernio",
};

function erroDaPlataforma(p) {
  const msg = p?.errorMessage || p?.error || "";
  const cat = ERRO_CATEGORIA[p?.errorCategory];
  if (cat && msg) return `${cat}: ${msg}`.slice(0, 600);
  return (msg || cat || "falhou sem mensagem da Zernio").slice(0, 600);
}

/**
 * Traduz um post da Zernio (GET /v1/posts/{id}, resposta do POST ou `post` do webhook) para o estado do CRM.
 * Olha a entrada do Instagram em platforms[]: link em platformPostUrl (GET/POST) ou publishedUrl (webhook);
 * erro em errorMessage (GET/POST) ou error (webhook).
 */
export function interpretarPost(post) {
  const st = post?.status;
  const ig = (Array.isArray(post?.platforms) ? post.platforms : []).find((p) => p?.platform === "instagram") || null;
  const link = ig?.platformPostUrl || ig?.publishedUrl || null;
  if (ig?.status === "published" || st === "published") {
    return { status: "publicado", link, erro: null };
  }
  if (ig?.status === "failed" || st === "failed") return { status: "erro", link: null, erro: erroDaPlataforma(ig) };
  if (st === "partial") return { status: "erro", link, erro: erroDaPlataforma(ig) };
  if (st === "cancelled") return { status: "cancelado", link: null, erro: null };
  if (st === "publishing") return { status: "publicando", link: null, erro: null };
  if (st === "scheduled") return { status: "agendado", link: null, erro: null }; // inclui erro transitório (Zernio repete)
  if (st === "draft") return { status: "erro", link: null, erro: "a Zernio guardou como rascunho em vez de agendar" };
  return null; // desconhecido: não mexe no estado
}

const CODIGO_403 = {
  ACCOUNT_DISCONNECTED: "conta desconectada na Zernio: reconecte o Instagram e tente de novo",
  ACCOUNT_NOT_ENABLED_FOR_POSTING: "essa conta foi conectada só para anúncios; conecte como conta de publicação na Zernio",
  PROFILE_OVER_LIMIT: "a conta está num perfil acima do limite do plano da Zernio",
};

/** Mensagem legível para um erro HTTP da Zernio. */
export function interpretarErroHttp(status, corpo) {
  const msg = typeof corpo?.error === "string" ? corpo.error.slice(0, 400) : "";
  if (status === 401) return "a chave da Zernio foi recusada (troque a chave no cofre)";
  if (status === 403) return CODIGO_403[corpo?.code] || (msg ? `Zernio recusou: ${msg}` : "a conta não pertence a esta chave da Zernio");
  if (status === 409) return msg ? `duplicado: ${msg}` : "conteúdo idêntico já foi enviado para essa conta nas últimas 24 h";
  if (status === 429) return msg ? `limite de envio: ${msg}` : "limite de envio da Zernio (até 25 posts por hora por conta)";
  if (status === 400) return msg ? `a Zernio recusou: ${msg}` : "a Zernio recusou o pedido";
  return `a Zernio não respondeu direito (HTTP ${status})${msg ? `: ${msg}` : ""}`;
}

/** X-Zernio-Signature = HMAC-SHA256 do corpo cru, hex minúsculo, sem prefixo (docs.zernio.com/webhooks). */
export function assinaturaOk(corpoCru, cabecalho, segredo) {
  if (!segredo || typeof cabecalho !== "string" || !/^[0-9a-f]{64}$/.test(cabecalho)) return false;
  const calc = crypto.createHmac("sha256", segredo).update(corpoCru).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(calc, "hex"), Buffer.from(cabecalho, "hex"));
}

export function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function corsCabecalhos(origem, permitidas) {
  if (!origem || !permitidas.includes(origem)) return {};
  return {
    "access-control-allow-origin": origem,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-nome-arquivo",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** Nome de arquivo seguro para o presign (a extensão decide o tipo na Zernio). */
export function nomeArquivo(nome, mime) {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov" }[mime];
  let base = String(nome || "midia").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  base = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "midia"}.${ext}`;
}

/** Só o que o CRM precisa da conta (nada de token, nada de metadata). */
export function resumirConta(a) {
  return {
    id: a._id,
    usuario: a.username || null,
    nome: a.displayName || null,
    foto: a.profilePicture || null,
    ativa: a.isActive === true && a.needsReconnection !== true && a.enabled !== false,
  };
}
