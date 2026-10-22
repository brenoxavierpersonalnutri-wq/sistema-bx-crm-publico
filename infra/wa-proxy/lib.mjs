// headturbo-wa-proxy: lógica pura (sem rede, sem disco). Testada pelo vitest do
// repo em src/test/openwa.test.ts. O server.mjs só liga isto ao HTTP.
import { createHmac, timingSafeEqual } from "node:crypto";

export const JANELA_SEGUNDOS = 60;
export const LIMITE_MINUTO = 20;
export const LIMITE_DIA = 300;
/** Leituras (status, qr, chats, histórico, mídia): teto próprio, em memória. */
export const LIMITE_LEITURA_MINUTO = 60;

/** Mesmo texto que supabase/functions/_shared/openwa.ts assina. */
export function textoCanonico(ts, nonce, metodo, caminho, corpo) {
  return `${ts}\n${nonce}\n${String(metodo).toUpperCase()}\n${caminho}\n${corpo}`;
}

export function hmacHex(secret, texto) {
  return createHmac("sha256", secret).update(texto).digest("hex");
}

/** Nonces vistos nos últimos 2 min (o dobro da janela). Recusa repetição. */
export class CacheNonce {
  constructor(ttlMs = 2 * JANELA_SEGUNDOS * 1000, max = 20000) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.vistos = new Map();
  }
  limpar(agora) {
    for (const [n, exp] of this.vistos) if (exp <= agora) this.vistos.delete(n);
  }
  /** true se o nonce é novo (e passa a ser lembrado). */
  registrar(nonce, agora) {
    this.limpar(agora);
    if (this.vistos.has(nonce)) return false;
    if (this.vistos.size >= this.max) return false; // enchente: recusa em vez de esquecer
    this.vistos.set(nonce, agora + this.ttlMs);
    return true;
  }
}

/**
 * Confere assinatura, relógio (≤ 60 s) e nonce. A assinatura vem ANTES do nonce,
 * pra quem não tem o segredo não conseguir encher o cache.
 */
export function conferirChamada({ secret, headers, metodo, caminho, corpo, agoraMs, cache }) {
  if (!secret) return { ok: false, status: 503, motivo: "sem segredo" };
  const ts = String(headers["x-wa-timestamp"] ?? "");
  const nonce = String(headers["x-wa-nonce"] ?? "");
  const assinatura = String(headers["x-wa-signature"] ?? "").toLowerCase();
  if (!/^\d{9,11}$/.test(ts) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(assinatura)) {
    return { ok: false, status: 401, motivo: "cabeçalhos" };
  }
  if (Math.abs(Math.floor(agoraMs / 1000) - Number(ts)) > JANELA_SEGUNDOS) {
    return { ok: false, status: 401, motivo: "relógio" };
  }
  const esperado = Buffer.from(hmacHex(secret, textoCanonico(ts, nonce, metodo, caminho, corpo)), "hex");
  const recebido = Buffer.from(assinatura, "hex");
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    return { ok: false, status: 401, motivo: "assinatura" };
  }
  if (!cache.registrar(nonce, agoraMs)) return { ok: false, status: 401, motivo: "nonce repetido" };
  return { ok: true };
}

/** Dia no fuso de São Paulo (o limite diário vira à meia-noite BRT). */
export function diaBRT(agoraMs) {
  return new Date(agoraMs - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 20 por minuto (janela deslizante) e 300 por dia, contando tentativas que foram ao OpenWA. */
export class Limitador {
  constructor(estado = {}) {
    this.minuto = Array.isArray(estado.minuto) ? estado.minuto.filter(Number.isFinite) : [];
    this.dia = typeof estado.dia === "string" ? estado.dia : "";
    this.noDia = Number.isFinite(estado.noDia) ? estado.noDia : 0;
  }
  /** Reserva uma vaga; devolve { ok } ou { ok:false, motivo, retryAfter }. */
  reservar(agoraMs) {
    const hoje = diaBRT(agoraMs);
    if (hoje !== this.dia) { this.dia = hoje; this.noDia = 0; }
    this.minuto = this.minuto.filter((t) => t > agoraMs - 60_000);
    if (this.noDia >= LIMITE_DIA) return { ok: false, motivo: "limite diário", retryAfter: 3600 };
    if (this.minuto.length >= LIMITE_MINUTO) {
      const espera = Math.ceil((this.minuto[0] + 60_000 - agoraMs) / 1000);
      return { ok: false, motivo: "limite por minuto", retryAfter: Math.max(1, espera) };
    }
    this.minuto.push(agoraMs);
    this.noDia += 1;
    return { ok: true };
  }
  paraJSON() {
    return { minuto: this.minuto, dia: this.dia, noDia: this.noDia };
  }
}

/** 60 leituras por minuto (janela deslizante). Não persiste: reinício zera, e tudo bem. */
export class LimitadorLeitura {
  constructor(teto = LIMITE_LEITURA_MINUTO) {
    this.teto = teto;
    this.minuto = [];
  }
  reservar(agoraMs) {
    this.minuto = this.minuto.filter((t) => t > agoraMs - 60_000);
    if (this.minuto.length >= this.teto) {
      const espera = Math.ceil((this.minuto[0] + 60_000 - agoraMs) / 1000);
      return { ok: false, motivo: "limite de leitura por minuto", retryAfter: Math.max(1, espera) };
    }
    this.minuto.push(agoraMs);
    return { ok: true };
  }
}

/** Pedido de código de pareamento: teto POR SESSÃO (cada pedido notifica o celular e mexe no WhatsApp Web). */
export const LIMITE_PAREAMENTO_MINUTO = 3;
export const LIMITE_PAREAMENTO_HORA = 15;

/** 3 por minuto e 15 por hora, por sessão (janela deslizante, em memória: reinício zera). */
export class LimitadorPareamento {
  /** `rotulo` só muda o texto do motivo (ex.: "desconexões"); o padrão é o do código de pareamento. */
  constructor(porMinuto = LIMITE_PAREAMENTO_MINUTO, porHora = LIMITE_PAREAMENTO_HORA, rotulo = "códigos") {
    this.porMinuto = porMinuto;
    this.porHora = porHora;
    this.rotulo = rotulo;
    this.porSessao = new Map();
  }
  reservar(sessao, agoraMs) {
    const chave = sessao || "(padrao)";
    const lista = (this.porSessao.get(chave) || []).filter((t) => t > agoraMs - 3_600_000);
    this.porSessao.set(chave, lista);
    const noMinuto = lista.filter((t) => t > agoraMs - 60_000);
    if (lista.length >= this.porHora) {
      return { ok: false, motivo: `limite de ${this.rotulo} por hora`, retryAfter: Math.max(1, Math.ceil((lista[0] + 3_600_000 - agoraMs) / 1000)) };
    }
    if (noMinuto.length >= this.porMinuto) {
      return { ok: false, motivo: `limite de ${this.rotulo} por minuto`, retryAfter: Math.max(1, Math.ceil((noMinuto[0] + 60_000 - agoraMs) / 1000)) };
    }
    lista.push(agoraMs);
    return { ok: true };
  }
}

/**
 * Leituras de ESTADO (rotas status e qr), que as telas consultam em ciclo (modal Conectar, Central, Conexões).
 *
 * Por que existe (20/10/2026, caso Sabrina): o OpenWA tem throttler próprio por IP E POR ROTA (NestJS
 * @nestjs/throttler 6: short 10/s, medium 100/min, long 1000/h; ver /opt/openwa/repo/src/app.module.ts) e, ao
 * estourar, BLOQUEIA a rota por 1 hora inteira (blockDuration = ttl). O proxy é um IP só: dois modais abertos
 * repassavam ~32 leituras/min, o GET /sessions/:id passou de 1000 em 48 min (13:16:58Z) e toda leitura de status
 * voltou 429 por 1 h. O pedido de código lia o status antes e desistia ("Não consegui falar com a ponte").
 *
 * Então: (1) cache curto por sessão (várias telas no mesmo número = 1 ida ao OpenWA a cada TTL); (2) orçamento
 * próprio por rota e por instância do OpenWA, bem abaixo do teto dele, para nunca disparar o bloqueio de 1 h;
 * (3) quando o OpenWA devolve 429, o proxy lembra até quando (Retry-After-*) e para de bater. Sem orçamento,
 * devolve o último valor lido (até IDADE_MAX_VELHO_MS, marcado `velho`) ou 429 com retryAfter.
 * Não mexe nos limites de envio nem de grupos: só status e qr passam por aqui.
 */
export const CACHE_ESTADO_MS = { status: 5_000, qr: 8_000 };
export const ORCAMENTO_ESTADO_HORA = 700;
export const ORCAMENTO_ESTADO_MINUTO = 40;
export const IDADE_MAX_VELHO_MS = 120_000;
export const ROTAS_DE_ESTADO = new Set(["status", "qr"]);

export class LeituraDeEstado {
  constructor({ ttl = CACHE_ESTADO_MS, porHora = ORCAMENTO_ESTADO_HORA, porMinuto = ORCAMENTO_ESTADO_MINUTO, idadeMaxVelho = IDADE_MAX_VELHO_MS } = {}) {
    this.ttl = ttl;
    this.porHora = porHora;
    this.porMinuto = porMinuto;
    this.idadeMaxVelho = idadeMaxVelho;
    this.cache = new Map(); // rota|base|sessao -> { em, corpo }
    this.idas = new Map(); // rota|base -> [ms]
    this.bloqueios = new Map(); // rota|base -> ms até quando o OpenWA disse para esperar
  }
  #chaveCache(rota, base, sessao) { return `${rota}|${base}|${sessao || "(padrao)"}`; }
  #chaveRota(rota, base) { return `${rota}|${base}`; }
  #velhoOuRecusa(entrada, agora, motivo, retryAfter) {
    if (entrada && agora - entrada.em <= this.idadeMaxVelho) {
      return { usar: "velho", corpo: entrada.corpo, idadeS: Math.round((agora - entrada.em) / 1000) };
    }
    return { usar: "recusa", motivo, retryAfter: Math.max(1, Math.ceil(retryAfter)) };
  }
  /**
   * Decide a leitura: { usar: "cache"|"velho", corpo } (responde sem ir ao OpenWA), { usar: "openwa" } (a ida
   * já foi contada no orçamento) ou { usar: "recusa", motivo, retryAfter } (429).
   */
  consultar(rota, base, sessao, agora) {
    const entrada = this.cache.get(this.#chaveCache(rota, base, sessao));
    if (entrada && agora - entrada.em < (this.ttl[rota] ?? 5_000)) return { usar: "cache", corpo: entrada.corpo };
    const kr = this.#chaveRota(rota, base);
    const ate = this.bloqueios.get(kr) || 0;
    if (ate > agora) {
      return this.#velhoOuRecusa(entrada, agora, "o OpenWA limitou as consultas de estado; espere", (ate - agora) / 1000);
    }
    const lista = (this.idas.get(kr) || []).filter((t) => t > agora - 3_600_000);
    this.idas.set(kr, lista);
    if (lista.length >= this.porHora) {
      return this.#velhoOuRecusa(entrada, agora, "muitas consultas de estado nesta hora", (lista[0] + 3_600_000 - agora) / 1000);
    }
    const noMinuto = lista.filter((t) => t > agora - 60_000);
    if (noMinuto.length >= this.porMinuto) {
      return this.#velhoOuRecusa(entrada, agora, "muitas consultas de estado neste minuto", (noMinuto[0] + 60_000 - agora) / 1000);
    }
    lista.push(agora);
    return { usar: "openwa" };
  }
  /**
   * Conta UMA ida ao OpenWA numa rota que não usa cache (desconectar: logout e start), no mesmo orçamento por
   * rota e por instância e respeitando o bloqueio de um 429 anterior. { ok: true } ou { ok: false, motivo, retryAfter }.
   */
  reservarIda(rota, base, agora) {
    const kr = this.#chaveRota(rota, base);
    const ate = this.bloqueios.get(kr) || 0;
    if (ate > agora) return { ok: false, motivo: "o OpenWA limitou esta operação; espere", retryAfter: Math.max(1, Math.ceil((ate - agora) / 1000)) };
    const lista = (this.idas.get(kr) || []).filter((t) => t > agora - 3_600_000);
    this.idas.set(kr, lista);
    if (lista.length >= this.porHora) {
      return { ok: false, motivo: "muitas chamadas nesta hora", retryAfter: Math.max(1, Math.ceil((lista[0] + 3_600_000 - agora) / 1000)) };
    }
    const noMinuto = lista.filter((t) => t > agora - 60_000);
    if (noMinuto.length >= this.porMinuto) {
      return { ok: false, motivo: "muitas chamadas neste minuto", retryAfter: Math.max(1, Math.ceil((noMinuto[0] + 60_000 - agora) / 1000)) };
    }
    lista.push(agora);
    return { ok: true };
  }
  /** Esquece o status e o QR guardados de UMA sessão (depois de desconectar, a próxima leitura vai ao OpenWA). */
  limpar(base, sessao) {
    let n = 0;
    for (const rota of ROTAS_DE_ESTADO) if (this.cache.delete(this.#chaveCache(rota, base, sessao))) n++;
    return n;
  }
  /** Guarda a resposta 200 já filtrada que o proxy devolveu. */
  guardar(rota, base, sessao, corpo, agora) {
    this.cache.set(this.#chaveCache(rota, base, sessao), { em: agora, corpo });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
  }
  /** O OpenWA devolveu 429: não volta a bater nesta rota antes de `segundos`. */
  bloquear(rota, base, segundos, agora) {
    const s = Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 3_600) : 60;
    this.bloqueios.set(this.#chaveRota(rota, base), agora + s * 1000);
    return s;
  }
}

/**
 * Segundos de espera de um 429 do OpenWA: o maior dos cabeçalhos Retry-After / Retry-After-short|medium|long
 * (o throttler do Nest escreve um por faixa). `obter(nome)` lê um cabeçalho (ex.: (n) => r.headers.get(n)).
 * Sem cabeçalho legível: 60.
 */
export function esperaDo429(obter) {
  let maior = 0;
  for (const nome of ["retry-after", "retry-after-short", "retry-after-medium", "retry-after-long"]) {
    const n = Number(obter(nome));
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return maior > 0 ? Math.ceil(maior) : 60;
}

/** Do retorno do OpenWA ({ pairingCode }), só o código: 8 letras/números, maiúsculo, sem hífen. Senão null. */
export function codigoPareamento(dados) {
  const c = typeof dados?.pairingCode === "string" ? dados.pairingCode.replace(/[\s-]/g, "").toUpperCase() : "";
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

const tel = (v) => (typeof v === "string" && /^\d{10,15}$/.test(v) ? v : null);
const urlHttps = (v) => {
  if (typeof v !== "string" || v.length > 2048) return null;
  try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; }
};
/** Conversa individual: telefone@c.us ou id de privacidade @lid. Grupo/canal/status não. */
const chatIndividual = (v) => typeof v === "string" && /^(\d{10,15}@c\.us|\d{5,25}@lid)$/.test(v);
/** Grupo: 120363...@g.us (novo) ou <criador>-<epoch>@g.us (antigo). Canal/status/broadcast não. */
export const chatGrupo = (v) => typeof v === "string" && /^\d{5,25}(-\d{5,15})?@g\.us$/.test(v);
/** Leitura (histórico, mídia, foto): conversa individual ou grupo. */
const chatLeitura = (v) => chatIndividual(v) || chatGrupo(v);
const textoAte = (v, max) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const soCampos = (obj, permitidos) =>
  obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).every((k) => permitidos.includes(k));

export const ROTAS = [
  "send-text", "send-image", "send-document", "send-audio", "history", "media", "status", "qr", "chats",
  "groups", "group-info", "group-invite", "avatar", "chats-page", "contacts-info", "media-id", "chats-recentes",
  "typing", "pairing-code", "desconectar",
];
/** Estados do indicador de presença (POST /sessions/{id}/chats/typing do OpenWA, papel OPERATOR). */
export const ESTADOS_DIGITANDO = new Set(["typing", "recording", "paused"]);

/** chats-recentes: quantas conversas e quantas mensagens de cada (só metadado, sem mídia). */
export const TETO_CHATS_RECENTES = 100;
export const TETO_MSGS_POR_CHAT_RECENTES = 30;

/** Teto do histórico fundo (deep: o WhatsApp Web carrega mensagens antigas sob demanda). */
export const TETO_HISTORICO_FUNDO = 2000;
/** Histórico com mídia em base64: poucas mensagens por vez (cada uma pode ter MBs). */
export const TETO_HISTORICO_COM_MIDIA = 30;
/** Quantos contatos o contacts-info resolve por chamada. */
export const TETO_CONTATOS_INFO = 50;
/** WID de participante/contato aceito no contacts-info: telefone@c.us ou @lid. */
export const widContato = (v) => typeof v === "string" && /^(\d{8,15}@c\.us|\d{5,25}@lid)$/.test(v);
export const ROTAS_DE_ENVIO = new Set(["send-text", "send-image", "send-document", "send-audio"]);

/**
 * Traduz rota fechada + corpo validado no pedido ao OpenWA.
 * Qualquer coisa fora desta lista (send-bulk, envio a grupo, escrita em grupo, criar/apagar sessão, stop,
 * webhooks...) não existe aqui. O logout só entra pela rota "desconectar", com `confirmar`. Grupo só entra nas LEITURAS (history, media, groups, group-info, avatar).
 * Devolve { metodo, caminho, corpo? , binario? } ou { erro }.
 */
export function montarPedidoOpenwa(rota, b, sessionId) {
  const s = encodeURIComponent(sessionId);
  if (!soCampos(b, [
    "phone", "text", "url", "caption", "filename", "limit", "chatId", "messageId", "deep", "includeMedia", "offset", "ids", "ptt",
    "porChat", "state", "confirmar", "gravando",
  ])) {
    return { erro: "corpo inválido" };
  }
  switch (rota) {
    case "send-text": {
      if (!soCampos(b, ["phone", "text"])) return { erro: "campos" };
      const phone = tel(b.phone), text = textoAte(b.text, 4096);
      if (!phone || !text) return { erro: "phone/text" };
      return { metodo: "POST", caminho: `/sessions/${s}/messages/send-text`, corpo: { chatId: `${phone}@c.us`, text } };
    }
    case "typing": {
      // "digitando…" do robô de IA antes de cada bolha (só conversa individual por telefone; nunca grupo).
      // Não manda mensagem: conta no limite de leitura, não no de envio.
      if (!soCampos(b, ["phone", "state"])) return { erro: "campos" };
      const phone = tel(b.phone);
      if (!phone || !ESTADOS_DIGITANDO.has(b.state)) return { erro: "phone/state" };
      return { metodo: "POST", caminho: `/sessions/${s}/chats/typing`, corpo: { chatId: `${phone}@c.us`, state: b.state } };
    }
    case "send-image":
    case "send-document": {
      const permitidos = rota === "send-image" ? ["phone", "url", "caption"] : ["phone", "url", "caption", "filename"];
      if (!soCampos(b, permitidos)) return { erro: "campos" };
      const phone = tel(b.phone), url = urlHttps(b.url);
      if (!phone || !url) return { erro: "phone/url" };
      const corpo = { chatId: `${phone}@c.us`, url };
      if (b.caption !== undefined) {
        const c = textoAte(b.caption, 1024);
        if (!c) return { erro: "caption" };
        corpo.caption = c;
      }
      if (b.filename !== undefined) {
        const f = textoAte(b.filename, 255);
        if (!f) return { erro: "filename" };
        corpo.filename = f;
      }
      return { metodo: "POST", caminho: `/sessions/${s}/messages/${rota}`, corpo };
    }
    case "send-audio": {
      // Nota de voz (ptt: true): o proxy baixa o áudio (mp3, m4a, ogg...), converte para Ogg/Opus mono 48 kHz
      // com ffmpeg (cache por hash em DATA_DIR/voz) e manda em base64 com mimetype explícito (pedido.voz).
      // gravando (padrão true com ptt): "gravando áudio…" na conversa antes, proporcional à duração.
      // Sem ptt: áudio comum (o arquivo toca como faixa), sem conversão.
      if (!soCampos(b, ["phone", "url", "ptt", "gravando"])) return { erro: "campos" };
      if (b.ptt !== undefined && typeof b.ptt !== "boolean") return { erro: "ptt" };
      if (b.gravando !== undefined && typeof b.gravando !== "boolean") return { erro: "gravando" };
      const phone = tel(b.phone), url = urlHttps(b.url);
      if (!phone || !url) return { erro: "phone/url" };
      const corpo = { chatId: `${phone}@c.us`, url };
      if (!b.ptt) return { metodo: "POST", caminho: `/sessions/${s}/messages/send-audio`, corpo };
      corpo.ptt = true;
      corpo.mimetype = MIME_VOZ;
      return {
        metodo: "POST", caminho: `/sessions/${s}/messages/send-audio`, corpo, voz: true,
        ...(b.gravando !== false ? { gravando: corpo.chatId } : {}),
      };
    }
    case "history": {
      // por telefone (vira <tel>@c.us) ou pelo chatId da lista de conversas (@c.us ou @lid)
      // deep: true -> até 2000 mensagens (só metadado); includeMedia: true -> até 30, com a mídia em base64
      if (!soCampos(b, ["phone", "chatId", "limit", "deep", "includeMedia"])) return { erro: "campos" };
      if (b.deep !== undefined && typeof b.deep !== "boolean") return { erro: "deep" };
      if (b.includeMedia !== undefined && typeof b.includeMedia !== "boolean") return { erro: "includeMedia" };
      if (b.deep && b.includeMedia) return { erro: "deep e includeMedia juntos" };
      let chat = null;
      if (b.phone !== undefined && b.chatId === undefined) {
        const phone = tel(b.phone);
        chat = phone ? `${phone}@c.us` : null;
      } else if (b.chatId !== undefined && b.phone === undefined) {
        chat = chatLeitura(b.chatId) ? b.chatId : null;
      }
      if (!chat) return { erro: "phone/chatId" };
      const teto = b.deep ? TETO_HISTORICO_FUNDO : b.includeMedia ? TETO_HISTORICO_COM_MIDIA : 100;
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 50, 1), teto);
      const extra = b.deep ? "&deep=true" : b.includeMedia ? "&includeMedia=true" : "";
      return {
        metodo: "GET",
        caminho: `/sessions/${s}/messages/${encodeURIComponent(chat)}/history?limit=${limit}${extra}`,
        ...(b.includeMedia ? { comMidia: true } : {}),
      };
    }
    case "media": {
      if (!soCampos(b, ["chatId", "messageId"])) return { erro: "campos" };
      const chatOk = chatLeitura(b.chatId);
      const idOk = typeof b.messageId === "string" && /^[A-Za-z0-9_@.:-]{1,200}$/.test(b.messageId);
      if (!chatOk || !idOk) return { erro: "chatId/messageId" };
      return {
        metodo: "GET",
        caminho: `/sessions/${s}/messages/${encodeURIComponent(b.chatId)}/${encodeURIComponent(b.messageId)}/media`,
        binario: true,
      };
    }
    case "media-id": {
      // Mídia de UMA mensagem pelo id, em qualquer posição que o OpenWA v0.24.0 alcance (server.mjs):
      // 1) arquivo guardado (GET :chatId/:messageId/media); 2) sem arquivo: acha a posição da mensagem
      // nas 100 mais recentes (histórico sem mídia) e pede o histórico com mídia SÓ até ela.
      if (!soCampos(b, ["chatId", "messageId"])) return { erro: "campos" };
      const chatOk = chatLeitura(b.chatId);
      const idOk = typeof b.messageId === "string" && /^[A-Za-z0-9_@.:-]{1,200}$/.test(b.messageId);
      if (!chatOk || !idOk) return { erro: "chatId/messageId" };
      const c = encodeURIComponent(b.chatId);
      return {
        midiaPorId: {
          messageId: b.messageId,
          arquivo: `/sessions/${s}/messages/${c}/${encodeURIComponent(b.messageId)}/media`,
          janela: `/sessions/${s}/messages/${c}/history?limit=${JANELA_MIDIA_OPENWA}`,
          comMidia: (n) => `/sessions/${s}/messages/${c}/history?limit=${Math.min(Math.max(n, 1), JANELA_MIDIA_OPENWA)}&includeMedia=true`,
        },
      };
    }
    case "status": {
      if (Object.keys(b).length) return { erro: "campos" };
      return { metodo: "GET", caminho: `/sessions/${s}` };
    }
    case "qr": {
      // QR de pareamento (data URL). Só leitura: iniciar/parar/deslogar a sessão não existe aqui.
      if (Object.keys(b).length) return { erro: "campos" };
      return { metodo: "GET", caminho: `/sessions/${s}/qr` };
    }
    case "desconectar": {
      // Desconectar o número (tela Conexões do CRM): POST /sessions/{id}/logout do OpenWA (papel OPERATOR) desvincula
      // o aparelho e apaga a credencial guardada; depois o server pede POST /sessions/{id}/start para a sessão voltar
      // a mostrar QR. A sessão (linha do OpenWA) NÃO é apagada. `confirmar` = nome da sessão que vai cair; o server
      // confere contra a sessão de fato resolvida (a padrão inclusive), para um corpo sem `sessao` nunca derrubar a
      // padrão por engano.
      if (!soCampos(b, ["confirmar"])) return { erro: "campos" };
      if (!nomeSessaoValido(b.confirmar)) return { erro: "confirmar" };
      return {
        metodo: "POST", caminho: `/sessions/${s}/logout`, desconectar: true, confirmar: b.confirmar,
        reiniciar: `/sessions/${s}/start`,
      };
    }
    case "pairing-code": {
      // Código de pareamento de 8 caracteres (alternativa ao QR): POST /sessions/{id}/pairing-code do OpenWA
      // (papel OPERATOR). Só pede o código; iniciar/parar/deslogar a sessão continua fora daqui.
      // O OpenWA só aceita com a sessão em qr_ready (409 fora disso; 400 se já conectada).
      if (!soCampos(b, ["phone"])) return { erro: "campos" };
      const phone = tel(b.phone);
      if (!phone) return { erro: "phone" };
      return { metodo: "POST", caminho: `/sessions/${s}/pairing-code`, corpo: { phoneNumber: phone }, pareamento: true };
    }
    case "chats": {
      if (!soCampos(b, ["limit"])) return { erro: "campos" };
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 30, 1), 60);
      return { metodo: "GET", caminho: `/sessions/${s}/chats?limit=${limit}` };
    }
    case "groups": {
      // grupos mais recentes, a partir da mesma lista de chats (ordem de atividade, como no app)
      if (!soCampos(b, ["limit"])) return { erro: "campos" };
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 30, 1), 60);
      return { metodo: "GET", caminho: `/sessions/${s}/chats?limit=${Math.min(limit * 3, 180)}`, limiteGrupos: limit };
    }
    case "chats-page": {
      // TODAS as conversas (contatos e grupos), em páginas, para o backfill. Sem prévia de mensagem.
      if (!soCampos(b, ["limit", "offset"])) return { erro: "campos" };
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 200, 1), 500);
      const offset = Math.min(Math.max(parseInt(b.offset, 10) || 0, 0), 100000);
      return { metodo: "GET", caminho: `/sessions/${s}/chats?limit=${limit}&offset=${offset}`, paginaChats: true };
    }
    case "chats-recentes": {
      // Lista primeiro (como o WhatsApp Web): as N conversas mais recentes (contatos e grupos) com as
      // últimas `porChat` mensagens de cada, numa chamada só. O server lê a lista e o histórico de cada
      // conversa direto no OpenWA local (conta como UMA leitura no limitador). Só metadado, sem mídia.
      if (!soCampos(b, ["limit", "porChat"])) return { erro: "campos" };
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 60, 1), TETO_CHATS_RECENTES);
      const porChat = Math.min(Math.max(parseInt(b.porChat, 10) || 1, 1), TETO_MSGS_POR_CHAT_RECENTES);
      // a lista vem em ordem de atividade; pede folga para descartar canal/status/broadcast
      return { metodo: "GET", caminho: `/sessions/${s}/chats?limit=${Math.min(limit * 2, 500)}`, chatsRecentes: { limit, porChat } };
    }
    case "contacts-info": {
      // nome (pushName/nome salvo) e telefone de até 50 participantes/contatos; o server busca um a um
      if (!soCampos(b, ["ids"])) return { erro: "campos" };
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > TETO_CONTATOS_INFO || !b.ids.every(widContato)) {
        return { erro: "ids" };
      }
      return { metodo: "GET", caminho: `/sessions/${s}/contacts`, contatos: [...new Set(b.ids)] };
    }
    case "group-info": {
      if (!soCampos(b, ["chatId"])) return { erro: "campos" };
      if (!chatGrupo(b.chatId)) return { erro: "chatId" };
      return { metodo: "GET", caminho: `/sessions/${s}/groups/${encodeURIComponent(b.chatId)}` };
    }
    case "group-invite": {
      // link de convite do grupo (só leitura; a sessão precisa ser admin do grupo). Revogar não existe aqui.
      if (!soCampos(b, ["chatId"])) return { erro: "campos" };
      if (!chatGrupo(b.chatId)) return { erro: "chatId" };
      return { metodo: "GET", caminho: `/sessions/${s}/groups/${encodeURIComponent(b.chatId)}/invite-code` };
    }
    case "avatar": {
      // foto de perfil (contato) ou do grupo: o server pega a URL e devolve os BYTES (a URL expira)
      if (!soCampos(b, ["chatId"])) return { erro: "campos" };
      if (chatGrupo(b.chatId)) {
        return { metodo: "GET", caminho: `/sessions/${s}/groups/${encodeURIComponent(b.chatId)}/picture`, foto: true };
      }
      if (chatIndividual(b.chatId)) {
        return { metodo: "GET", caminho: `/sessions/${s}/contacts/${encodeURIComponent(b.chatId)}/profile-picture`, foto: true };
      }
      return { erro: "chatId" };
    }
    default:
      return { erro: "rota inexistente" };
  }
}

/**
 * Da lista de chats do OpenWA, devolve só conversas individuais (telefone@c.us ou @lid; nada de
 * grupo, canal ou status) e só chatId, telefone (null se for @lid, o server resolve depois),
 * nome e horário — sem prévia da última mensagem.
 */
export function filtrarChatsIndividuais(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id : "";
    if (c.isGroup === true || (c.kind && c.kind !== "individual")) continue;
    const cus = /^(\d{10,15})@(c\.us|s\.whatsapp\.net)$/.exec(id);
    if (!cus && !/^\d{5,25}@lid$/.test(id)) continue;
    out.push({
      chatId: cus ? `${cus[1]}@c.us` : id,
      phone: cus ? cus[1] : null,
      name: typeof c.name === "string" && c.name.trim() ? c.name.slice(0, 120) : null,
      timestamp: Number.isFinite(c.timestamp) ? c.timestamp : null,
    });
  }
  return out;
}

/**
 * Da lista de chats do OpenWA, só os grupos: chatId, nome (assunto) e horário. Sem prévia.
 */
export function filtrarChatsGrupos(lista, limite = 60) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const c of lista) {
    if (out.length >= limite) break;
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id : "";
    if (!chatGrupo(id)) continue;
    if (c.kind && c.kind !== "group") continue;
    out.push({
      chatId: id,
      name: typeof c.name === "string" && c.name.trim() ? c.name.slice(0, 120) : null,
      timestamp: Number.isFinite(c.timestamp) ? c.timestamp : null,
    });
  }
  return out;
}

/**
 * Página da lista de chats para o backfill: contatos (telefone@c.us ou @lid) e grupos, com tipo,
 * nome e horário. Canal, status e broadcast ficam de fora. Sem prévia da última mensagem.
 */
export function filtrarPaginaChats(lista) {
  if (!Array.isArray(lista)) return { itens: [], brutos: 0 };
  const itens = [];
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id : "";
    const nome = typeof c.name === "string" && c.name.trim() ? c.name.slice(0, 120) : null;
    const ts = Number.isFinite(c.timestamp) ? c.timestamp : null;
    if (chatGrupo(id) && (!c.kind || c.kind === "group")) {
      itens.push({ chatId: id, kind: "group", phone: null, name: nome, timestamp: ts });
      continue;
    }
    if (c.isGroup === true || (c.kind && c.kind !== "individual")) continue;
    const cus = /^(\d{10,15})@(c\.us|s\.whatsapp\.net)$/.exec(id);
    if (!cus && !/^\d{5,25}@lid$/.test(id)) continue;
    itens.push({ chatId: cus ? `${cus[1]}@c.us` : id, kind: "individual", phone: cus ? cus[1] : null, name: nome, timestamp: ts });
  }
  return { itens, brutos: lista.length };
}

/** chats-recentes: a página de chats filtrada, da mais recente para a mais antiga, até `limite`. */
export function filtrarChatsRecentes(lista, limite) {
  const { itens } = filtrarPaginaChats(lista);
  return itens
    .slice()
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    .slice(0, limite);
}

/**
 * Mensagem do histórico sem o peso: tira o base64 de mídia (se vier) e campos que o CRM não lê.
 * Mantém id, chatId, from, to, author, body, type, timestamp, fromMe, isGroup, kind, contact, media
 * (só mimetype/filename/omitted) e senderPhone.
 */
export function mensagemLeve(m) {
  if (!m || typeof m !== "object") return null;
  const out = {};
  for (const k of ["id", "chatId", "from", "to", "author", "body", "type", "timestamp", "fromMe", "isGroup", "kind", "senderPhone", "isStatusBroadcast"]) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  if (typeof out.body === "string" && out.body.length > 8000) out.body = out.body.slice(0, 8000);
  if (m.contact && typeof m.contact === "object") {
    out.contact = { pushName: m.contact.pushName ?? null, name: m.contact.name ?? null, number: m.contact.number ?? null };
  }
  if (m.media && typeof m.media === "object") {
    out.media = { mimetype: m.media.mimetype ?? null, filename: m.media.filename ?? null, omitted: true };
  }
  return out;
}

/** Do contato do OpenWA (GET /contacts/:id) só o que o CRM usa: nome e telefone. */
export function resumoContato(id, contato, telefone) {
  const c = contato && typeof contato === "object" ? contato : {};
  const txt = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  const num = String(c.number ?? "").replace(/\D/g, "");
  const doId = /^(\d{10,15})@c\.us$/.exec(id);
  return {
    id,
    name: txt(c.name),
    pushName: txt(c.pushName) ?? txt(c.pushname),
    phone: telefone ?? (doId ? doId[1] : /^\d{10,15}$/.test(num) ? num : null),
  };
}

/**
 * Histórico com mídia (includeMedia): devolve só as mensagens que trouxeram a mídia, com id,
 * mimetype, nome e base64 — e para de somar quando passa do teto total de bytes.
 */
export function filtrarMidiasHistorico(lista, tetoBytes = 25 * 1024 * 1024) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  let total = 0;
  for (const m of lista) {
    const md = m && typeof m === "object" && m.media && typeof m.media === "object" ? m.media : null;
    const data = md && typeof md.data === "string" && md.data ? md.data : null;
    if (!data || typeof m.id !== "string") continue;
    const tam = Math.floor((data.length * 3) / 4);
    if (total + tam > tetoBytes) break;
    total += tam;
    out.push({
      id: m.id,
      mimetype: typeof md.mimetype === "string" ? md.mimetype : null,
      filename: typeof md.filename === "string" ? md.filename.slice(0, 255) : null,
      data,
    });
  }
  return out;
}

/**
 * Até onde o OpenWA v0.24.0 baixa mídia de novo: o histórico com includeMedia aceita no máximo 100
 * mensagens (MAX_CHAT_HISTORY_LIMIT) e o deep (até 2000) é só metadado. Mensagem mais antiga que as
 * 100 mais recentes do chat só tem mídia se o OpenWA guardou o arquivo quando ela chegou.
 */
export const JANELA_MIDIA_OPENWA = 100;

/** Mesma mensagem? id serializado igual, ou mesmo fromMe + mesmo id curto (o chat pode vir @lid ou @c.us). */
export function mesmaMensagem(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  if (a === b) return true;
  const partes = (v) => {
    const m = /^(true|false)_.+_([A-Za-z0-9]+)(?:_.+)?$/.exec(v);
    return m ? `${m[1]}:${m[2]}` : null;
  };
  const pa = partes(a), pb = partes(b);
  return Boolean(pa && pa === pb);
}

/**
 * Posição da mensagem contando do FIM do histórico (1 = a mais recente), ou 0 se não está.
 * O histórico do OpenWA vem do mais antigo para o mais novo.
 */
export function posicaoDoFim(lista, messageId) {
  if (!Array.isArray(lista)) return 0;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (mesmaMensagem(lista[i]?.id, messageId)) return lista.length - i;
  }
  return 0;
}

/** A mídia (base64) da mensagem num histórico com includeMedia: { data, mimetype, filename } | { omitida } | null. */
export function midiaDaMensagem(lista, messageId) {
  if (!Array.isArray(lista)) return null;
  const m = lista.find((x) => mesmaMensagem(x?.id, messageId));
  if (!m) return null;
  const md = m.media && typeof m.media === "object" ? m.media : null;
  if (!md) return { semMidia: true };
  if (typeof md.data !== "string" || !md.data) return { omitida: true };
  return {
    data: md.data,
    mimetype: typeof md.mimetype === "string" ? md.mimetype.split(";")[0].trim().toLowerCase() || null : null,
    filename: typeof md.filename === "string" ? md.filename.slice(0, 255) : null,
  };
}

/**
 * Resposta de erro do OpenWA traduzida para o CRM. 409 (ou 400 "not connected/not active") = sessão
 * fora do ar: o CRM espera a sessão e tenta de novo. 5xx = transitório (502). O resto passa o status.
 */
export function erroOpenwaParaCrm(status, mensagem) {
  const msg = typeof mensagem === "string" ? mensagem.slice(0, 200) : "";
  if (status === 409 || (status === 400 && /not (connected|active|ready)|não (está )?conectad/i.test(msg))) {
    return { status: 409, corpo: { error: "sessao-desconectada", status, message: msg || undefined } };
  }
  if (status >= 500) return { status: 502, corpo: { error: "openwa", status, message: msg || undefined } };
  return { status, corpo: { error: "openwa", status, message: msg || undefined } };
}

/**
 * O número da sessão é admin do grupo? Procura o próprio telefone (só dígitos) entre os participantes do
 * GET /groups/:id (campo number, ou o id antes do @). true/false quando achou o número; null quando não
 * dá para saber (sem telefone da sessão, ou participante só com @lid).
 */
export function souAdminDe(info, meuTelefone) {
  const meu = String(meuTelefone ?? "").replace(/\D/g, "");
  const lista = Array.isArray(info?.participants) ? info.participants : [];
  if (meu.length < 10 || !lista.length) return null;
  for (const p of lista) {
    if (!p || typeof p !== "object") continue;
    const id = typeof p.id === "string" ? p.id : typeof p.id?._serialized === "string" ? p.id._serialized : "";
    const num = String(p.number ?? (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net") ? id.split("@")[0] : "")).replace(/\D/g, "");
    if (num && num === meu) return Boolean(p.isAdmin || p.isSuperAdmin);
  }
  return null;
}

/**
 * Metadado de grupo que sai do proxy: assunto, contagem e o que o número pode fazer (admin? só admins
 * enviam? só admins editam?). Nunca a lista de participantes.
 */
export function resumoGrupo(g, meuTelefone = null) {
  if (!g || typeof g !== "object") return null;
  const id = typeof g.id === "string" && chatGrupo(g.id) ? g.id : null;
  if (!id) return null;
  const nome = typeof g.name === "string" ? g.name : typeof g.subject === "string" ? g.subject : null;
  const n = Array.isArray(g.participants) ? g.participants.length
    : Number.isFinite(g.participantsCount) ? g.participantsCount : null;
  const bool = (...vs) => { for (const v of vs) if (typeof v === "boolean") return v; return null; };
  return {
    chatId: id,
    name: nome && nome.trim() ? nome.slice(0, 120) : null,
    participants: n,
    souAdmin: souAdminDe(g, meuTelefone),
    announce: bool(g.announce, g.isAnnounce),
    locked: bool(g.locked, g.restrict),
  };
}

/** Teto da foto de perfil (WhatsApp entrega ~640px JPEG, dezenas de KB). */
export const TETO_FOTO = 2 * 1024 * 1024;

/**
 * URL de foto que o proxy aceita buscar: https, host do CDN do WhatsApp/Meta. Qualquer outra coisa
 * (http, IP, host interno) é recusada: o proxy nunca vira um "busque esta URL" genérico.
 */
export function urlFotoPermitida(v) {
  if (typeof v !== "string" || v.length > 4096) return false;
  let u;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  return /(^|\.)(whatsapp\.net|whatsapp\.com|fbcdn\.net|cdninstagram\.com)$/.test(u.hostname);
}

/** Telefone que o OpenWA devolve ao resolver um @lid (só dígitos, 10 a 15), ou null. */
export function telefoneResolvido(resposta) {
  const d = String(resposta?.phone ?? "").replace(/\D/g, "");
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** Telefone mascarado pro log (nunca o texto da mensagem). */
export function mascarar(phone) {
  return typeof phone === "string" && phone.length >= 4 ? `***${phone.slice(-4)}` : "-";
}

// ======================================================================= ENVIO PARA GRUPO
// Módulo "Grupos" do CRM (substitui o SendFlow): mensagem agendada para os grupos de uma
// campanha. Rotas SEPARADAS das de telefone (montarPedidoOpenwa continua recusando grupo):
//   group-allowlist  -> o CRM grava a lista de grupos que podem receber (substitui a anterior)
//   send-group-text  -> { chatId, text, linkPreview?, sessao? }
//   send-group-media -> { chatId, kind: image|video|audio|document, url, caption?, filename?, sessao? }
// Grupo fora da allowlist = 403. Limite próprio (LimitadorGrupo), separado dos 20/min de telefone.
//
// MULTI-SESSÃO (contrato da Central, supabase/functions/_shared/numerosWa.ts): `sessao` = NOME da sessão
// OpenWA do número (crm_numeros.sessao_openwa). Vale em TODAS as rotas (menos group-allowlist), mas só
// nomes listados em OPENWA_SESSOES_EXTRAS (env) passam. Sem `sessao`, usa a sessão padrão do proxy.
// O limite de envio a telefone (20/min, 300/dia) continua UM só para todas as sessões.

//
// ENVIO MANUAL A GRUPO (18/10/2026): o atendente digitando na tela Conversas, um clique = uma mensagem.
//   send-group-manual-text  -> { chatId, text, sessao? }
//   send-group-manual-media -> { chatId, kind: image|video|audio|document, url, caption?, filename?, ptt?, sessao? }
// SEM allowlist: vale qualquer grupo em que a sessão é membro (quem confere a participação é o próprio
// WhatsApp; grupo em que a sessão não está volta erro do OpenWA). Limite anti-loop próprio e alto
// (LimitadorManualGrupo: 60/min e 1000/dia por sessão, sem intervalo mínimo), separado do disparo
// automático do módulo Grupos, que continua com allowlist e 6/min, 200/dia, 8 s.

export const ROTAS_ENVIO_GRUPO_MANUAL = new Set(["send-group-manual-text", "send-group-manual-media"]);
// Fluxo de Grupo (campanha que cria grupos sozinha, 19/10/2026): escrita de ADMIN em grupo.
//   group-create      -> { name, participants: [telefone...] (1-10), sessao? }  cria o grupo (POST /groups)
//   group-settings    -> { chatId, announce?, locked? }   só admins enviam / só admins editam
//   group-description -> { chatId, description }          (vazio limpa)
//   group-picture     -> { chatId, url (https) }          foto do grupo
//   group-promote     -> { chatId, participants: [telefone...] (1-10) }  vira admin
//   group-subject     -> { chatId, subject (1-100) }     nome do grupo (Disparo em grupo, 20/10/2026)
//   group-admins      -> { chatId, participants: [telefone...] (1-10) }  ADICIONA quem não está e PROMOVE
//                        (21/10/2026). Cada telefone é conferido no WhatsApp (contacts/check) com e sem o 9
//                        (variantesTelefoneBR); sem resposta do check vale a regra do 9. Devolve o resultado por
//                        telefone, conferido relendo o grupo no fim. group-promote sozinho falhava quando o
//                        admin não tinha entrado no grupo (número com o 9 a mais: 5531990000103 em vez de
//                        553190000103) e só dizia "proxy 502".
// Tudo menos group-create só vale para grupo da ALLOWLIST (os da campanha). Limites próprios por sessão:
// criação 1 a cada 2 min e 10/dia; demais escritas 20/min e 300/dia.
export const ROTAS_ADMIN_GRUPO = new Set(["group-create", "group-settings", "group-description", "group-picture", "group-promote", "group-subject", "group-admins"]);
export const ROTAS_ENVIO_GRUPO = new Set(["send-group-text", "send-group-media", "send-group-poll"]);
export const ROTAS_GRUPO = ["group-allowlist", ...ROTAS_ENVIO_GRUPO, ...ROTAS_ENVIO_GRUPO_MANUAL, ...ROTAS_ADMIN_GRUPO];
/** Rotas que aceitam o campo `sessao` (sessão do número escolhido): todas, menos a allowlist (que é global). */
/**
 * Rotas que exigem `sessao` explícita: sem ela o proxy usaria a sessão padrão (closer). Código de pareamento
 * pedido sem sessão nasceu no número errado em 20/10/2026; agora é 400.
 */
export const ROTAS_SO_COM_SESSAO = new Set(["pairing-code"]);
export const ROTAS_COM_SESSAO = new Set([...ROTAS, ...ROTAS_ENVIO_GRUPO, ...ROTAS_ENVIO_GRUPO_MANUAL, ...ROTAS_ADMIN_GRUPO]);
export const LIMITE_CRIACAO_GRUPO = { minuto: 1, dia: 10, intervaloMs: 120_000 };
export const LIMITE_ESCRITA_GRUPO = { minuto: 20, dia: 300, intervaloMs: 0 };
/** Teto de menções por mensagem (o OpenWA aceita até 1024; grupo tem no máximo 1024). */
export const MAX_MENCOES = 1024;

/** Do retorno do invite-code do OpenWA, só o link (https://chat.whatsapp.com/<código>), ou null. */
export function linkConviteDe(dados) {
  const code = typeof dados?.inviteCode === "string" ? dados.inviteCode : "";
  return /^[A-Za-z0-9]{15,30}$/.test(code) ? `https://chat.whatsapp.com/${code}` : null;
}
export const LIMITE_GRUPO_MINUTO = 6;
export const LIMITE_GRUPO_DIA = 200;
/** Intervalo mínimo entre dois envios a grupo na MESMA sessão (o CRM já espaça 20-60 s). */
export const INTERVALO_MIN_GRUPO_MS = 8_000;
export const MAX_ALLOWLIST = 500;
/** Envio MANUAL a grupo (atendente): teto anti-loop, não régua de ritmo. Por sessão. */
export const LIMITE_GRUPO_MANUAL_MINUTO = 60;
export const LIMITE_GRUPO_MANUAL_DIA = 1000;
const TIPOS_MIDIA_GRUPO = { image: "send-image", video: "send-video", audio: "send-audio", document: "send-document" };

export const nomeSessaoValido = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/** Lê OPENWA_SESSOES_EXTRAS ("comercial-fit-2,grupos") num Set de nomes válidos. */
export function sessoesPermitidas(env) {
  return new Set(String(env ?? "").split(",").map((s) => s.trim()).filter(nomeSessaoValido));
}

/**
 * Sufixo de variável de ambiente da sessão: "comercial-fit-2" -> "COMERCIAL_FIT_2".
 * Cada sessão extra tem a SUA chave operator (restrita àquela sessão no OpenWA):
 *   OPENWA_OPERATOR_KEY_<SUFIXO>  (obrigatória para a sessão funcionar)
 *   OPENWA_SESSION_ID_<SUFIXO>    (opcional; vazio = o proxy procura pelo nome)
 */
export const sufixoEnvSessao = (nome) => String(nome).toUpperCase().replace(/-/g, "_");

/** Chave e id fixo da sessão `nome` (null = padrão) a partir do env. Sem chave própria: chave null. */
export function credencialDaSessao(nome, env, padrao) {
  if (!nome) return { chave: padrao.chave || null, id: padrao.id || null };
  if (!nomeSessaoValido(nome)) return { chave: null, id: null };
  const suf = sufixoEnvSessao(nome);
  return { chave: env[`OPENWA_OPERATOR_KEY_${suf}`] || null, id: env[`OPENWA_SESSION_ID_${suf}`] || null };
}

/**
 * Instância do OpenWA que atende a sessão (19/10/2026, modelo híbrido: uma 2ª instância com motor Baileys
 * só para o número de grupos). OPENWA_BASE_<SUFIXO> (ex.: OPENWA_BASE_GRUPOS_1=http://headturbo-openwa-grupos-api:2785/api)
 * aponta a sessão para outra instância; sem a variável, a sessão segue na base padrão (OPENWA_BASE), como antes.
 * Variável presente mas inválida devolve null: a sessão fica em 503 (nunca cai na instância errada em silêncio).
 * Só http(s), host simples, porta opcional e caminho sem query/credencial.
 */
const BASE_VALIDA = /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/;
export function baseDaSessao(nome, env, basePadrao) {
  const limpa = (v) => String(v).trim().replace(/\/+$/, "");
  if (!nome) return limpa(basePadrao);
  if (!nomeSessaoValido(nome)) return null;
  const v = env[`OPENWA_BASE_${sufixoEnvSessao(nome)}`];
  if (v === undefined || v === null || String(v).trim() === "") return limpa(basePadrao);
  const b = limpa(v);
  return BASE_VALIDA.test(b) ? b : null;
}

/** Sessões com instância própria (OPENWA_BASE_<SUFIXO> válida e diferente da padrão), pro log de início. */
export function sessoesComBasePropria(sessoes, env, basePadrao) {
  const padrao = baseDaSessao(null, env, basePadrao);
  return [...sessoes].filter((n) => {
    const b = baseDaSessao(n, env, basePadrao);
    return b !== null && b !== padrao;
  });
}

/**
 * 501 do OpenWA = o motor não implementa a operação. No Baileys é o caso do histórico ao vivo
 * (GET /messages/:chatId/history), que o número de grupos não tem. Para o CRM isso é "sem histórico", não falha:
 *  - rota history (com ou sem mídia): 200 com lista vazia (importação lê 0 e segue);
 *  - chats-recentes: a conversa volta com mensagens [] e NÃO marca parcial;
 *  - media-id, passo 2: 404 "sem-historico" (final: o CRM não fica repetindo como faria com 5xx).
 */
export const semSuporteNoMotor = (status) => status === 501;

/**
 * Tira o campo `sessao` do corpo. Só as rotas de ROTAS_COM_SESSAO aceitam, e só nomes permitidos.
 * Devolve { corpo, sessao } (sessao null = padrão) ou { erro }.
 */
export function separarSessao(rota, corpo, permitidas) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo) || !("sessao" in corpo)) {
    return { corpo, sessao: null };
  }
  if (!ROTAS_COM_SESSAO.has(rota)) return { erro: "sessao não aceita nesta rota" };
  const { sessao, ...resto } = corpo;
  if (!nomeSessaoValido(sessao) || !permitidas.has(sessao)) return { erro: "sessao não permitida" };
  return { corpo: resto, sessao };
}

/** Allowlist: { groups: [chatId...] } -> lista única e válida, ou { erro }. */
export function validarAllowlist(b) {
  if (!soCampos(b, ["groups"]) || !Array.isArray(b.groups)) return { erro: "groups" };
  if (b.groups.length > MAX_ALLOWLIST) return { erro: "allowlist grande demais" };
  if (!b.groups.every(chatGrupo)) return { erro: "chatId inválido na allowlist" };
  return { grupos: [...new Set(b.groups)] };
}

/**
 * Pedido ao OpenWA para envio a UM grupo da allowlist. Devolve { metodo, caminho, corpo } ou { erro, status? }.
 */
export function montarPedidoGrupo(rota, b, sessionId, allowlist) {
  const s = encodeURIComponent(sessionId);
  // menções: lista explícita de WIDs (boas-vindas) OU mentionAll (o server lê os participantes na hora)
  const mencoes = (corpo) => {
    if (b.mentions !== undefined && b.mentionAll !== undefined) return "mentions e mentionAll juntos";
    if (b.mentionAll !== undefined) {
      if (typeof b.mentionAll !== "boolean") return "mentionAll";
      return b.mentionAll ? "todos" : null;
    }
    if (b.mentions !== undefined) {
      if (!Array.isArray(b.mentions) || !b.mentions.length || b.mentions.length > 256 || !b.mentions.every(chatIndividual)) return "mentions";
      corpo.mentions = [...new Set(b.mentions)];
    }
    return null;
  };
  if (rota === "send-group-text") {
    if (!soCampos(b, ["chatId", "text", "linkPreview", "mentions", "mentionAll"])) return { erro: "campos" };
    const text = textoAte(b.text, 4096);
    if (!chatGrupo(b.chatId) || !text) return { erro: "chatId/text" };
    if (b.linkPreview !== undefined && typeof b.linkPreview !== "boolean") return { erro: "linkPreview" };
    if (!allowlist.has(b.chatId)) return { erro: "grupo fora da allowlist", status: 403 };
    const corpo = { chatId: b.chatId, text };
    if (b.linkPreview) corpo.linkPreview = true;
    const m = mencoes(corpo);
    if (m && m !== "todos") return { erro: m };
    return { metodo: "POST", caminho: `/sessions/${s}/messages/send-text`, corpo, ...(m === "todos" ? { mencionarTodos: b.chatId } : {}) };
  }
  if (rota === "send-group-media") {
    if (!soCampos(b, ["chatId", "kind", "url", "caption", "filename", "ptt", "mentions", "mentionAll"])) return { erro: "campos" };
    const destino = TIPOS_MIDIA_GRUPO[b.kind];
    const url = urlHttps(b.url);
    if (!chatGrupo(b.chatId) || !destino || !url) return { erro: "chatId/kind/url" };
    if (!allowlist.has(b.chatId)) return { erro: "grupo fora da allowlist", status: 403 };
    if (b.ptt !== undefined && (typeof b.ptt !== "boolean" || b.kind !== "audio")) return { erro: "ptt" };
    const corpo = { chatId: b.chatId, url };
    if (b.caption !== undefined) {
      if (b.kind === "audio") return { erro: "áudio não tem legenda" };
      const c = textoAte(b.caption, 1024);
      if (!c) return { erro: "caption" };
      corpo.caption = c;
    }
    if (b.filename !== undefined) {
      if (b.ptt) return { erro: "nota de voz não tem nome de arquivo" };
      const f = textoAte(b.filename, 255);
      if (!f) return { erro: "filename" };
      corpo.filename = f;
    }
    if (b.ptt) { corpo.ptt = true; corpo.mimetype = MIME_VOZ; }
    const m = mencoes(corpo);
    if (m && m !== "todos") return { erro: m };
    return {
      metodo: "POST", caminho: `/sessions/${s}/messages/${destino}`, corpo,
      ...(m === "todos" ? { mencionarTodos: b.chatId } : {}), ...(b.ptt ? { voz: true } : {}),
    };
  }
  if (rota === "send-group-poll") {
    if (!soCampos(b, ["chatId", "name", "options", "multiple"])) return { erro: "campos" };
    const name = textoAte(typeof b.name === "string" ? b.name.trim() : b.name, 255);
    if (!chatGrupo(b.chatId) || !name) return { erro: "chatId/name" };
    if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 12) return { erro: "options (2 a 12)" };
    const opcoes = b.options.map((o) => (typeof o === "string" ? o.trim() : ""));
    if (!opcoes.every((o) => o.length > 0 && o.length <= 100) || new Set(opcoes).size !== opcoes.length) return { erro: "options" };
    if (b.multiple !== undefined && typeof b.multiple !== "boolean") return { erro: "multiple" };
    if (!allowlist.has(b.chatId)) return { erro: "grupo fora da allowlist", status: 403 };
    return {
      metodo: "POST", caminho: `/sessions/${s}/messages/send-poll`,
      corpo: { chatId: b.chatId, name, options: opcoes, allowMultipleAnswers: Boolean(b.multiple) },
    };
  }
  return { erro: "rota inexistente" };
}

/** Telefones (só dígitos, 10-15) -> WIDs @c.us, sem repetir; null se algum for inválido. */
function telefonesParaWid(lista, max) {
  if (!Array.isArray(lista) || !lista.length || lista.length > max) return null;
  const wids = [];
  for (const p of lista) {
    const t = tel(p);
    if (!t) return null;
    wids.push(`${t}@c.us`);
  }
  return [...new Set(wids)];
}

/**
 * Pedido ao OpenWA para escrita de ADMIN em grupo (Fluxo de Grupo). group-create não precisa de allowlist
 * (o grupo ainda não existe); as outras só para grupo da allowlist. Devolve { metodo, caminho, corpo } ou { erro, status? }.
 */
export function montarPedidoAdminGrupo(rota, b, sessionId, allowlist) {
  const s = encodeURIComponent(sessionId);
  if (rota === "group-create") {
    if (!soCampos(b, ["name", "participants"])) return { erro: "campos" };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 100) return { erro: "name (1 a 100)" };
    const participants = telefonesParaWid(b.participants, 10);
    if (!participants) return { erro: "participants (1 a 10 telefones)" };
    return { metodo: "POST", caminho: `/sessions/${s}/groups`, corpo: { name, participants }, criarGrupo: true };
  }
  if (!b || typeof b !== "object" || !chatGrupo(b.chatId)) return { erro: "chatId" };
  const g = `/sessions/${s}/groups/${encodeURIComponent(b.chatId)}`;
  let pedido;
  if (rota === "group-settings") {
    if (!soCampos(b, ["chatId", "announce", "locked"])) return { erro: "campos" };
    const corpo = {};
    for (const k of ["announce", "locked"]) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "boolean") return { erro: k };
      corpo[k] = b[k];
    }
    if (!Object.keys(corpo).length) return { erro: "announce/locked" };
    pedido = { metodo: "PUT", caminho: `${g}/settings`, corpo };
  } else if (rota === "group-description") {
    if (!soCampos(b, ["chatId", "description"])) return { erro: "campos" };
    if (typeof b.description !== "string" || b.description.length > 1024) return { erro: "description (até 1024)" };
    pedido = { metodo: "PUT", caminho: `${g}/description`, corpo: { description: b.description } };
  } else if (rota === "group-picture") {
    if (!soCampos(b, ["chatId", "url"])) return { erro: "campos" };
    const url = urlHttps(b.url);
    if (!url) return { erro: "url" };
    pedido = { metodo: "PUT", caminho: `${g}/picture`, corpo: { url } };
  } else if (rota === "group-subject") {
    if (!soCampos(b, ["chatId", "subject"])) return { erro: "campos" };
    const subject = typeof b.subject === "string" ? b.subject.trim() : "";
    if (!subject || subject.length > 100) return { erro: "subject (1 a 100)" };
    pedido = { metodo: "PUT", caminho: `${g}/subject`, corpo: { subject } };
  } else if (rota === "group-admins") {
    if (!soCampos(b, ["chatId", "participants"])) return { erro: "campos" };
    const wids = telefonesParaWid(b.participants, 10);
    if (!wids) return { erro: "participants (1 a 10 telefones)" };
    pedido = { admins: { chatId: b.chatId, telefones: wids.map((w) => w.split("@")[0]) } };
  } else if (rota === "group-promote") {
    if (!soCampos(b, ["chatId", "participants"])) return { erro: "campos" };
    const participants = telefonesParaWid(b.participants, 10);
    if (!participants) return { erro: "participants (1 a 10 telefones)" };
    pedido = { metodo: "POST", caminho: `${g}/participants/promote`, corpo: { participants } };
  } else {
    return { erro: "rota inexistente" };
  }
  if (!allowlist.has(b.chatId)) return { erro: "grupo fora da allowlist", status: 403 };
  return pedido;
}

// ------------------------------------------------------------------ admins do grupo (21/10/2026)

/**
 * Variantes de um telefone brasileiro de celular, com e sem o 9, na ordem em que vale tentar.
 * Regra do 9: conta de WhatsApp de DDD 31 para cima costuma ter ficado SEM o 9 (553190000103); DDD 11 a 28,
 * COM o 9 (5511999998888). O check do WhatsApp decide; a ordem só importa quando ele não responde.
 * Fixo, 0800 ou estrangeiro: só o próprio número.
 */
export function variantesTelefoneBR(t) {
  if (typeof t !== "string" || !/^\d{10,15}$/.test(t)) return [];
  const com9 = /^55([1-9]\d)9([6-9]\d{7})$/.exec(t);
  if (com9) {
    const sem = `55${com9[1]}${com9[2]}`;
    return Number(com9[1]) >= 31 ? [sem, t] : [t, sem];
  }
  const sem9 = /^55([1-9]\d)([6-9]\d{7})$/.exec(t);
  if (sem9) {
    const com = `55${sem9[1]}9${sem9[2]}`;
    return Number(sem9[1]) >= 31 ? [t, com] : [com, t];
  }
  return [t];
}

/** Dígitos do id de um contato/participante (`553190000103@c.us`, `...@s.whatsapp.net`, só dígitos) ou null. @lid não conta. */
export function digitosDoId(v) {
  if (typeof v !== "string" || /@lid$/.test(v)) return null;
  const d = v.split("@")[0].split(":")[0];
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** GET /groups/:id -> { membros: Set(dígitos), admins: Set(dígitos), total } (participante @lid sem telefone fica de fora). */
export function membrosDoGrupo(info) {
  const membros = new Set();
  const admins = new Set();
  const lista = Array.isArray(info?.participants) ? info.participants : [];
  for (const p of lista) {
    const id = typeof p === "string" ? p : typeof p?.id === "string" ? p.id : typeof p?.id?._serialized === "string" ? p.id._serialized : null;
    const d = digitosDoId(id) ?? (typeof p?.number === "string" && /^\d{10,15}$/.test(p.number) ? p.number : null);
    if (!d) continue;
    membros.add(d);
    if (p?.isAdmin === true || p?.isSuperAdmin === true || p?.admin === "admin" || p?.admin === "superadmin") admins.add(d);
  }
  return { membros, admins, total: lista.length };
}

/** Resultados por participante do OpenWA ({ results: [{ id, success, status }] }) -> Map(dígitos -> status numérico). */
export function statusPorParticipante(dados) {
  const m = new Map();
  const lista = Array.isArray(dados?.results) ? dados.results : [];
  for (const r of lista) {
    const d = digitosDoId(r?.id);
    if (!d) continue;
    m.set(d, r?.success === true ? 200 : Number.isFinite(Number(r?.status)) ? Number(r.status) : 0);
  }
  return m;
}

/** Código do WhatsApp para adicionar/promover -> frase curta em português. */
export function textoStatusParticipante(acao, st) {
  if (acao === "add") {
    if (st === 403) return "a privacidade do número não deixa adicionar em grupo (mande o link de convite para ele)";
    if (st === 408) return "o número saiu deste grupo há pouco; o WhatsApp não deixa adicionar de novo agora";
    if (st === 401) return "o número bloqueou o WhatsApp de grupos";
    if (st === 404 || st === 400) return "o número não tem WhatsApp";
    if (st === 409) return "já estava no grupo";
  } else {
    if (st === 404 || st === 406) return "o número não está no grupo, então não dá para promover";
    if (st === 403 || st === 401) return "o WhatsApp não deixou promover (o número de grupos é admin?)";
  }
  return `o WhatsApp recusou (código ${st || "?"})`;
}

/** Ids dos participantes (para mencionar todos) a partir do GET /groups/:id do OpenWA. Só @c.us/@lid. */
export function idsParticipantes(info, max = MAX_MENCOES) {
  const lista = Array.isArray(info?.participants) ? info.participants : [];
  const ids = [];
  for (const p of lista) {
    const id = typeof p === "string" ? p : typeof p?.id === "string" ? p.id : typeof p?.id?._serialized === "string" ? p.id._serialized : null;
    if (chatIndividual(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

/** Do retorno do POST /groups: { chatId, name } ou null. */
export function grupoCriadoDe(dados) {
  const id = typeof dados?.id === "string" ? dados.id : typeof dados?.id?._serialized === "string" ? dados.id._serialized
    : typeof dados?.gid?._serialized === "string" ? dados.gid._serialized : null;
  if (!chatGrupo(id)) return null;
  return { chatId: id, name: typeof dados?.name === "string" ? dados.name.slice(0, 120) : null };
}

/** Limite genérico por sessão: { minuto, dia, intervaloMs }. Persistível (paraJSON). */
export class LimitadorPorSessao {
  constructor(cfg, estado = {}, rotulo = "grupo") {
    this.cfg = cfg;
    this.rotulo = rotulo;
    this.porSessao = estado && typeof estado === "object" && !Array.isArray(estado) ? { ...estado } : {};
  }
  reservar(sessao, agoraMs) {
    const k = sessao || "_padrao";
    const e = this.porSessao[k] ?? { minuto: [], dia: "", noDia: 0, ultimo: 0 };
    const hoje = diaBRT(agoraMs);
    if (hoje !== e.dia) { e.dia = hoje; e.noDia = 0; }
    e.minuto = (Array.isArray(e.minuto) ? e.minuto : []).filter((t) => t > agoraMs - 60_000);
    if (e.noDia >= this.cfg.dia) return { ok: false, motivo: `limite diário de ${this.rotulo}`, retryAfter: 3600 };
    if (this.cfg.intervaloMs && e.ultimo && agoraMs - e.ultimo < this.cfg.intervaloMs) {
      return { ok: false, motivo: `intervalo mínimo de ${this.rotulo}`, retryAfter: Math.ceil((e.ultimo + this.cfg.intervaloMs - agoraMs) / 1000) };
    }
    if (e.minuto.length >= this.cfg.minuto) {
      return { ok: false, motivo: `limite de ${this.rotulo} por minuto`, retryAfter: Math.max(1, Math.ceil((e.minuto[0] + 60_000 - agoraMs) / 1000)) };
    }
    e.minuto.push(agoraMs);
    e.noDia += 1;
    e.ultimo = agoraMs;
    this.porSessao[k] = e;
    return { ok: true };
  }
  paraJSON() {
    return this.porSessao;
  }
}

/**
 * Pedido ao OpenWA para envio MANUAL a UM grupo (sem allowlist). Áudio com ptt: true sai como nota de voz
 * (Ogg/Opus, mimetype explícito, como a rota send-audio de telefone). Devolve { metodo, caminho, corpo } ou { erro }.
 */
export function montarPedidoGrupoManual(rota, b, sessionId) {
  const s = encodeURIComponent(sessionId);
  if (rota === "send-group-manual-text") {
    if (!soCampos(b, ["chatId", "text"])) return { erro: "campos" };
    const text = textoAte(b.text, 4096);
    if (!chatGrupo(b.chatId) || !text) return { erro: "chatId/text" };
    return { metodo: "POST", caminho: `/sessions/${s}/messages/send-text`, corpo: { chatId: b.chatId, text } };
  }
  if (rota === "send-group-manual-media") {
    if (!soCampos(b, ["chatId", "kind", "url", "caption", "filename", "ptt"])) return { erro: "campos" };
    const destino = TIPOS_MIDIA_GRUPO[b.kind];
    const url = urlHttps(b.url);
    if (!chatGrupo(b.chatId) || !destino || !url) return { erro: "chatId/kind/url" };
    if (b.ptt !== undefined && (typeof b.ptt !== "boolean" || b.kind !== "audio")) return { erro: "ptt" };
    const corpo = { chatId: b.chatId, url };
    if (b.caption !== undefined) {
      if (b.kind === "audio") return { erro: "áudio não tem legenda" };
      const c = textoAte(b.caption, 1024);
      if (!c) return { erro: "caption" };
      corpo.caption = c;
    }
    if (b.filename !== undefined) {
      if (b.ptt) return { erro: "nota de voz não tem nome de arquivo" };
      const f = textoAte(b.filename, 255);
      if (!f) return { erro: "filename" };
      corpo.filename = f;
    }
    if (b.ptt) { corpo.ptt = true; corpo.mimetype = MIME_VOZ; }
    return { metodo: "POST", caminho: `/sessions/${s}/messages/${destino}`, corpo, ...(b.ptt ? { voz: true } : {}) };
  }
  return { erro: "rota inexistente" };
}

/** Envio manual a grupo: 60/min e 1000/dia POR SESSÃO, sem intervalo mínimo (é gente digitando). */
export class LimitadorManualGrupo {
  constructor(estado = {}) {
    this.porSessao = estado && typeof estado === "object" && !Array.isArray(estado) ? { ...estado } : {};
  }
  reservar(sessao, agoraMs) {
    const k = sessao || "_padrao";
    const e = this.porSessao[k] ?? { minuto: [], dia: "", noDia: 0 };
    const hoje = diaBRT(agoraMs);
    if (hoje !== e.dia) { e.dia = hoje; e.noDia = 0; }
    e.minuto = (Array.isArray(e.minuto) ? e.minuto : []).filter((t) => t > agoraMs - 60_000);
    if (e.noDia >= LIMITE_GRUPO_MANUAL_DIA) return { ok: false, motivo: "limite diário de envio manual em grupo", retryAfter: 3600 };
    if (e.minuto.length >= LIMITE_GRUPO_MANUAL_MINUTO) {
      return { ok: false, motivo: "limite de envio manual em grupo por minuto", retryAfter: Math.max(1, Math.ceil((e.minuto[0] + 60_000 - agoraMs) / 1000)) };
    }
    e.minuto.push(agoraMs);
    e.noDia += 1;
    this.porSessao[k] = e;
    return { ok: true };
  }
  paraJSON() {
    return this.porSessao;
  }
}

/** 6/min, 200/dia e 8 s entre envios, POR SESSÃO. Persistível (paraJSON). */
export class LimitadorGrupo {
  constructor(estado = {}) {
    this.porSessao = estado && typeof estado === "object" && !Array.isArray(estado) ? { ...estado } : {};
  }
  reservar(sessao, agoraMs) {
    const k = sessao || "_padrao";
    const e = this.porSessao[k] ?? { minuto: [], dia: "", noDia: 0, ultimo: 0 };
    const hoje = diaBRT(agoraMs);
    if (hoje !== e.dia) { e.dia = hoje; e.noDia = 0; }
    e.minuto = (Array.isArray(e.minuto) ? e.minuto : []).filter((t) => t > agoraMs - 60_000);
    if (e.noDia >= LIMITE_GRUPO_DIA) return { ok: false, motivo: "limite diário de grupo", retryAfter: 3600 };
    if (e.ultimo && agoraMs - e.ultimo < INTERVALO_MIN_GRUPO_MS) {
      return { ok: false, motivo: "intervalo mínimo entre grupos", retryAfter: Math.ceil((e.ultimo + INTERVALO_MIN_GRUPO_MS - agoraMs) / 1000) };
    }
    if (e.minuto.length >= LIMITE_GRUPO_MINUTO) {
      return { ok: false, motivo: "limite de grupo por minuto", retryAfter: Math.max(1, Math.ceil((e.minuto[0] + 60_000 - agoraMs) / 1000)) };
    }
    e.minuto.push(agoraMs);
    e.noDia += 1;
    e.ultimo = agoraMs;
    this.porSessao[k] = e;
    return { ok: true };
  }
  paraJSON() {
    return this.porSessao;
  }
}

/**
 * Tempos de espera pelo OpenWA (20/10/2026). Logo depois de reconectar um número grande, o whatsapp-web.js leva
 * mais de 25 s para devolver a lista de conversas (está sincronizando): o chats-recentes caía no teto fixo de 25 s
 * e voltava 502 "falha no proxy", que o CRM mostrava como "non-2xx". A lista do chats-recentes ganha teto próprio
 * (50 s; quem chama espera 80 s) e o orçamento TOTAL do pedido fica em 72 s (lista + histórico das conversas).
 * Os números vêm do ambiente só para o teste ponta a ponta encurtar; valor inválido = padrão.
 */
export function temposDoProxy(env = {}) {
  const ms = (v, padrao) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 50 && n <= 120_000 ? n : padrao;
  };
  return {
    padrao: ms(env.OPENWA_TIMEOUT_PADRAO_MS, 25_000),
    listaRecentes: ms(env.OPENWA_TIMEOUT_LISTA_RECENTES_MS, 50_000),
    totalRecentes: ms(env.OPENWA_TIMEOUT_TOTAL_RECENTES_MS, 72_000),
  };
}

/** Teto da chamada principal ao OpenWA para este pedido. */
export function timeoutDoPedido(pedido, tempos) {
  if (pedido.pareamento) return 80_000;
  // logout: whatsapp-web.js espera o Client.logout(); Baileys espera o ack do remove-companion-device
  if (pedido.desconectar) return TEMPO_DESCONECTAR_MS;
  if (pedido.binario) return 40_000;
  if (pedido.comMidia) return 55_000;
  if (pedido.chatsRecentes) return tempos.listaRecentes;
  return tempos.padrao;
}

/**
 * Exceção no meio do pedido -> status e corpo legíveis (nunca a mensagem crua do erro, que pode ter URL interna).
 * Timeout do OpenWA = 504 com o motivo (o CRM mostra ao Chefe e pode tentar de novo); OpenWA fora do ar = 502.
 */
export function respostaDeFalha(e) {
  const st = e?.status;
  if (st === 413) return { status: 413, corpo: { error: "corpo grande demais" } };
  if (st === 503) return { status: 503, corpo: { error: "sessão sem chave no proxy" } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return {
      status: 504,
      corpo: {
        error: "O WhatsApp demorou para responder (o número acabou de conectar e ainda está sincronizando, ou está ocupado). Tente de novo em 1 minuto.",
        motivo: "timeout",
      },
    };
  }
  if (e instanceof TypeError && /fetch failed/i.test(String(e.message))) {
    return { status: 502, corpo: { error: "O OpenWA não respondeu (fora do ar ou reiniciando).", motivo: "openwa-fora" } };
  }
  return { status: typeof st === "number" && st >= 400 && st < 600 ? st : 502, corpo: { error: "falha no proxy" } };
}

// ------------------------------------------------------------------ desconectar (21/10/2026)

/** Teto de cada ida do desconectar ao OpenWA (logout e, depois, start). */
export const TEMPO_DESCONECTAR_MS = 60_000;
/** Desconexões por sessão: 2 por minuto e 6 por hora (cada uma derruba o aparelho e reinicia o navegador). */
export const LIMITE_DESCONEXAO_MINUTO = 2;
export const LIMITE_DESCONEXAO_HORA = 6;

const msgOpenwa = (d) =>
  typeof d?.message === "string" ? d.message.slice(0, 200) : Array.isArray(d?.message) ? d.message.join("; ").slice(0, 200) : null;

/**
 * Resposta do proxy para a rota desconectar, a partir do que o OpenWA devolveu.
 *  logout: { status, dados }  (POST /sessions/:id/logout)
 *  start:  { status, dados } | { status: 0 } (falha de rede/tempo) | null (não tentou: sem orçamento)
 * Sempre { status, corpo } com texto legível em `error`/`aviso` (o CRM mostra para a pessoa).
 */
export function respostaDesconectar(logout, start) {
  const st = logout?.status ?? 0;
  if (st >= 200 && st < 300) {
    if (start && start.status >= 200 && start.status < 300) {
      const estado = typeof start.dados?.status === "string" ? start.dados.status : "initializing";
      return { status: 200, corpo: { desconectado: true, reiniciada: true, status: estado } };
    }
    return {
      status: 200,
      corpo: {
        desconectado: true, reiniciada: false, status: "disconnected",
        aviso: "Número desconectado, mas a sessão não voltou a pedir QR sozinha. Use Conectar daqui a pouco ou inicie a sessão no painel do OpenWA.",
      },
    };
  }
  const msg = msgOpenwa(logout?.dados);
  if (st === 400) {
    return { status: 409, corpo: { error: "A sessão não está ligada no servidor: o número já estava desconectado.", status: 400, message: msg } };
  }
  if (st === 404) return { status: 404, corpo: { error: "Sessão não encontrada no OpenWA.", status: 404 } };
  if (st === 403) return { status: 403, corpo: { error: "A chave do proxy não tem permissão para desconectar esta sessão.", status: 403 } };
  if (st === 409) {
    return { status: 409, corpo: { error: "O OpenWA ainda está terminando outra operação nesta sessão. Tente de novo em alguns segundos.", status: 409, message: msg } };
  }
  if (st === 502) {
    return {
      status: 502,
      corpo: {
        error: "O WhatsApp não confirmou a desconexão. A sessão foi parada no servidor; conecte de novo e, se precisar, desconecte outra vez.",
        status: 502, message: msg,
      },
    };
  }
  return { status: 502, corpo: { error: "O OpenWA não conseguiu desconectar agora. Tente de novo em 1 minuto.", status: st, message: msg } };
}

// ------------------------------------------------------------------ nota de voz (21/10/2026)
// Todo áudio com ptt sai como nota de voz de verdade: o WhatsApp só mostra a bolha de microfone (com onda e
// "gravado na hora") para Ogg/Opus. MP3 com sendAudioAsVoice chega mudo em parte dos celulares, e sem ptt o
// whatsapp-web.js manda como arquivo. Por isso o proxy converte TUDO o que tem ptt (telefone e grupo), com
// cache por sha256 dos bytes de origem (o mesmo áudio do agente converte uma vez só).

export const MIME_VOZ = "audio/ogg; codecs=opus";
/** Teto do arquivo de origem baixado para converter. */
export const TETO_ORIGEM_VOZ = 16 * 1024 * 1024;
/** Teto da duração de uma nota de voz (o WhatsApp aceita mais, mas ninguém grava isso ao vivo). */
export const TETO_DURACAO_VOZ_S = 15 * 60;
/** "gravando áudio…": no mínimo 2 s, no máximo 12 s (cabe no tempo de quem chama) e reenviado a cada 8 s. */
export const GRAVANDO_MIN_MS = 2_000;
export const GRAVANDO_MAX_MS = 12_000;
export const GRAVANDO_REPETE_MS = 8_000;
/** Quantos arquivos convertidos o cache guarda (os mais antigos saem). */
export const TETO_CACHE_VOZ = 400;

/** Argumentos do ffmpeg: Ogg/Opus mono 48 kHz, voz (32 kb/s VBR), sem metadado nem capa. */
export function argsFfmpegVoz(entrada, saida) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", entrada,
    "-vn", "-sn", "-dn", "-map_metadata", "-1",
    "-ac", "1", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "32k", "-vbr", "on", "-application", "voip",
    "-f", "ogg", saida,
  ];
}

/** Argumentos do ffprobe que devolvem formato, duração e o 1º fluxo de áudio em JSON. */
export function argsFfprobe(arquivo) {
  return [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "format=format_name,duration:stream=codec_name,channels,sample_rate",
    "-of", "json", arquivo,
  ];
}

/** Lê a saída JSON do ffprobe: { formato, duracaoS, codec, canais, taxa } ou null (sem áudio / ilegível). */
export function lerFfprobe(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { return null; }
  const st = Array.isArray(d?.streams) ? d.streams[0] : null;
  if (!st || typeof st.codec_name !== "string") return null;
  const dur = Number(d?.format?.duration);
  return {
    formato: String(d?.format?.format_name ?? ""),
    duracaoS: Number.isFinite(dur) && dur > 0 ? dur : null,
    codec: st.codec_name,
    canais: Number(st.channels) || null,
    taxa: Number(st.sample_rate) || null,
  };
}

/** Já está no formato exato da nota de voz (Ogg + Opus + mono + 48 kHz): não precisa reconverter. */
export function vozJaPronta(p) {
  return !!p && /(^|,)ogg(,|$)/.test(p.formato) && p.codec === "opus" && p.canais === 1 && p.taxa === 48000;
}

/** Quanto tempo mostrar "gravando áudio…" antes de mandar: a duração do áudio, entre 2 s e 12 s. */
export function esperaGravandoMs(duracaoS) {
  const ms = Number.isFinite(duracaoS) && duracaoS > 0 ? Math.round(duracaoS * 1000) : GRAVANDO_MIN_MS;
  return Math.min(GRAVANDO_MAX_MS, Math.max(GRAVANDO_MIN_MS, ms));
}
