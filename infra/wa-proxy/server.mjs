// headturbo-wa-proxy — única porta do CRM (Supabase) para o OpenWA da VPS.
//
// Fica entre o Caddy (wa-gw.brenoxavier.com.br) e o OpenWA (rede docker, nunca exposto).
// Só existem as rotas de lib.mjs (ROTAS): enviar texto/imagem/documento/áudio (nota de voz) a UM telefone,
// ler histórico de um telefone, baixar mídia de uma mensagem, ler o status e o QR da sessão
// listar as conversas individuais (só telefone, nome e horário), a lista paginada de TODOS os chats
// (backfill), nome/telefone de participantes (contacts-info) e, só leitura, os grupos
// (assunto, contagem), o histórico/mídia de grupo e a foto de perfil (contato ou grupo, em bytes).
// Toda chamada vem assinada (HMAC do corpo + timestamp ≤ 60 s + nonce único).
// Código de pareamento (rota pairing-code, alternativa ao QR): só com `sessao` explícita (sem ela, 400: nunca cai
// na padrão), só sessões conhecidas, 3/min e 15/hora por sessão;
// o código nunca vai para o log.
// Desconectar (rota desconectar, 21/10/2026): logout da sessão no OpenWA (desvincula o aparelho; a sessão continua
// existindo) e start para ela voltar a pedir QR. Exige `confirmar` = nome da sessão que cai (a padrão inclusive),
// 2/min e 6/hora por sessão, e conta no orçamento por rota/instância; limpa o status/QR guardados da sessão.
// Limite: 20 envios/min e 300/dia; leituras 60/min. Log: rota, status, tempo e final do telefone; nunca o texto.
//
// Envio a GRUPO (módulo Grupos do CRM): rotas próprias (group-allowlist, send-group-text, send-group-media),
// só para grupos que o CRM gravou na allowlist (DATA_DIR/grupos-permitidos.json), com limite próprio
// (6/min, 200/dia, 8 s entre envios, por sessão).
// Envio MANUAL a grupo (tela Conversas): send-group-manual-text/-media, sem allowlist (qualquer grupo em
// que a sessão é membro), limite anti-loop de 60/min e 1000/dia por sessão (DATA_DIR/limites-grupo-manual.json). A sessão do número vem no campo `sessao` (qualquer rota)
// e só vale se estiver em OPENWA_SESSOES_EXTRAS (lista separada por vírgula); sem ele, a sessão padrão.
// Fluxo de Grupo (19/10/2026): send-group-poll (enquete), menção (mentions/mentionAll) e nota de voz (ptt) no
// disparo; escrita de admin (group-create/-settings/-description/-picture/-promote) com limites próprios por
// sessão (criação 1 a cada 2 min e 10/dia, DATA_DIR/limites-criacao-grupo.json; demais 20/min e 300/dia,
// DATA_DIR/limites-escrita-grupo.json). mentionAll: o proxy lê os participantes do grupo e manda os ids
// em `mentions` sem pôr @ no texto (a lista de participantes nunca sai do proxy).
//
// Chave OPERATOR do OpenWA: OPENWA_OPERATOR_KEY (sessão padrão) no arquivo de ambiente que o dono preenche.
// Cada sessão de OPENWA_SESSOES_EXTRAS usa a SUA chave, restrita a ela: OPENWA_OPERATOR_KEY_<NOME> (ex.:
// OPENWA_OPERATOR_KEY_COMERCIAL_FIT_2) e, opcional, OPENWA_SESSION_ID_<NOME>. Sem chave própria: 503 só nela.
// Sem ela o proxy sobe mas responde 503 a tudo (não tenta nada no OpenWA).
//
// Instância por sessão (19/10/2026): OPENWA_BASE_<NOME> (ex.: OPENWA_BASE_GRUPOS_1) manda a sessão para OUTRA
// instância do OpenWA (a de motor Baileys, só do número de grupos). Sem a variável: OPENWA_BASE, como antes.
// Variável inválida: 503 só naquela sessão. 501 do motor (Baileys sem histórico ao vivo) vira "sem histórico".
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import {
  CacheNonce, LeituraDeEstado, ROTAS_DE_ESTADO, esperaDo429, Limitador, LimitadorGrupo, LimitadorLeitura, LimitadorManualGrupo, LimitadorPareamento, codigoPareamento, ROTAS, ROTAS_DE_ENVIO, ROTAS_ENVIO_GRUPO,
  ROTAS_ENVIO_GRUPO_MANUAL, ROTAS_GRUPO, montarPedidoGrupoManual,
  ROTAS_ADMIN_GRUPO, montarPedidoAdminGrupo, idsParticipantes, grupoCriadoDe, LimitadorPorSessao,
  variantesTelefoneBR, digitosDoId, membrosDoGrupo, statusPorParticipante, textoStatusParticipante,
  LIMITE_CRIACAO_GRUPO, LIMITE_ESCRITA_GRUPO,
  TETO_FOTO, conferirChamada, filtrarChatsGrupos, filtrarChatsIndividuais, filtrarMidiasHistorico, filtrarPaginaChats, filtrarChatsRecentes, mensagemLeve,
  mascarar, montarPedidoGrupo, montarPedidoOpenwa, resumoContato, resumoGrupo, separarSessao, sessoesPermitidas, credencialDaSessao,
  ROTAS_SO_COM_SESSAO,
  telefoneResolvido, urlFotoPermitida, validarAllowlist, linkConviteDe,
  erroOpenwaParaCrm, midiaDaMensagem, posicaoDoFim, JANELA_MIDIA_OPENWA,
  baseDaSessao, sessoesComBasePropria, semSuporteNoMotor, temposDoProxy, timeoutDoPedido, respostaDeFalha,
  LIMITE_DESCONEXAO_MINUTO, LIMITE_DESCONEXAO_HORA, TEMPO_DESCONECTAR_MS, respostaDesconectar,
  MIME_VOZ, TETO_ORIGEM_VOZ, TETO_DURACAO_VOZ_S, TETO_CACHE_VOZ, GRAVANDO_REPETE_MS,
  argsFfmpegVoz, argsFfprobe, lerFfprobe, vozJaPronta, esperaGravandoMs,
} from "./lib.mjs";

const PORTA = Number(process.env.PORT || 8080);
const SEGREDO = process.env.WA_PROXY_SECRET || "";
const CHAVE = process.env.OPENWA_OPERATOR_KEY || "";
const BASE = (process.env.OPENWA_BASE || "http://headturbo-openwa-api:2785/api").replace(/\/+$/, "");
const SESSAO_ID_FIXO = process.env.OPENWA_SESSION_ID || "";
const SESSAO_NOME = process.env.OPENWA_SESSION_NAME || "closer";
const DADOS = process.env.DATA_DIR || "/data";
const ARQ_LIMITE = path.join(DADOS, "limites.json");
const ARQ_LIMITE_GRUPO = path.join(DADOS, "limites-grupo.json");
const ARQ_ALLOWLIST = path.join(DADOS, "grupos-permitidos.json");
const ARQ_LIMITE_GRUPO_MANUAL = path.join(DADOS, "limites-grupo-manual.json");
const ARQ_LIMITE_CRIACAO = path.join(DADOS, "limites-criacao-grupo.json");
const ARQ_LIMITE_ESCRITA = path.join(DADOS, "limites-escrita-grupo.json");
const SESSOES_EXTRAS = sessoesPermitidas(process.env.OPENWA_SESSOES_EXTRAS);
const TEMPOS = temposDoProxy(process.env);
const DIR_VOZ = path.join(DADOS, "voz");
const TMP = process.env.TMPDIR || "/tmp";
const TETO_CORPO = 64 * 1024;
const TETO_MIDIA = 25 * 1024 * 1024;

const pronto = Boolean(SEGREDO.length >= 32 && CHAVE);
const cache = new CacheNonce();
const leituras = new LimitadorLeitura();
const pareamentos = new LimitadorPareamento();
// desconectar: teto por sessão (cada pedido derruba o aparelho e reinicia o navegador da sessão)
const desconexoes = new LimitadorPareamento(LIMITE_DESCONEXAO_MINUTO, LIMITE_DESCONEXAO_HORA, "desconexões");
// status/qr: cache curto por sessão + orçamento abaixo do throttler do OpenWA (1000/h por rota, bloqueio de 1 h)
const estados = new LeituraDeEstado();

let limitador;
try {
  limitador = new Limitador(JSON.parse(fs.readFileSync(ARQ_LIMITE, "utf8")));
} catch {
  limitador = new Limitador();
}
const lerJSON = (arq, padrao) => {
  try { return JSON.parse(fs.readFileSync(arq, "utf8")); } catch { return padrao; }
};
const gravarJSON = (arq, dados) => {
  fs.writeFileSync(`${arq}.tmp`, JSON.stringify(dados));
  fs.renameSync(`${arq}.tmp`, arq);
};
const limitadorGrupo = new LimitadorGrupo(lerJSON(ARQ_LIMITE_GRUPO, {}));
const limitadorManual = new LimitadorManualGrupo(lerJSON(ARQ_LIMITE_GRUPO_MANUAL, {}));
const salvarLimiteManual = () => {
  try { gravarJSON(ARQ_LIMITE_GRUPO_MANUAL, limitadorManual.paraJSON()); } catch (e) { log({ evento: "limite_manual_nao_salvo", erro: e.code || "?" }); }
};
const limitadorCriacao = new LimitadorPorSessao(LIMITE_CRIACAO_GRUPO, lerJSON(ARQ_LIMITE_CRIACAO, {}), "criação de grupo");
const limitadorEscrita = new LimitadorPorSessao(LIMITE_ESCRITA_GRUPO, lerJSON(ARQ_LIMITE_ESCRITA, {}), "edição de grupo");
const allowlistSalva = lerJSON(ARQ_ALLOWLIST, []);
let allowlist = new Set(Array.isArray(allowlistSalva) ? allowlistSalva : []);
const salvarLimiteGrupo = () => {
  try { gravarJSON(ARQ_LIMITE_GRUPO, limitadorGrupo.paraJSON()); } catch (e) { log({ evento: "limite_grupo_nao_salvo", erro: e.code || "?" }); }
};
const salvarLimite = () => {
  try {
    fs.writeFileSync(`${ARQ_LIMITE}.tmp`, JSON.stringify(limitador.paraJSON()));
    fs.renameSync(`${ARQ_LIMITE}.tmp`, ARQ_LIMITE);
  } catch (e) {
    log({ evento: "limite_nao_salvo", erro: e.code || "?" });
  }
};

function log(obj) {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...obj })}\n`);
}

function responder(res, status, corpo, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(corpo));
}

let sessaoId = SESSAO_ID_FIXO;
const idsPorNome = new Map();
/** Chave operator da sessão: a padrão usa OPENWA_OPERATOR_KEY; cada extra, a SUA (OPENWA_OPERATOR_KEY_<NOME>). */
function chaveDaSessao(nome = null) {
  return credencialDaSessao(nome, process.env, { chave: CHAVE, id: SESSAO_ID_FIXO }).chave;
}
/** Base do OpenWA da sessão (OPENWA_BASE_<NOME> ou a padrão). null = variável inválida: 503 só nela. */
function baseDe(nome = null) {
  return baseDaSessao(nome, process.env, BASE);
}
/** id da sessão padrão; com `nome` (sessão de outro número, já conferida contra OPENWA_SESSOES_EXTRAS), a dela. */
async function idDaSessao(nome = null) {
  if (!nome && sessaoId) return sessaoId;
  const base = baseDe(nome);
  if (!base) throw Object.assign(new Error("base do OpenWA inválida para a sessão"), { status: 503 });
  const alvo = nome || SESSAO_NOME;
  if (idsPorNome.has(alvo)) return idsPorNome.get(alvo);
  const cred = credencialDaSessao(nome, process.env, { chave: CHAVE, id: SESSAO_ID_FIXO });
  if (!cred.chave) throw Object.assign(new Error("sessão sem chave no proxy"), { status: 503 });
  if (nome && cred.id) { idsPorNome.set(alvo, String(cred.id)); return String(cred.id); }
  const r = await fetch(`${base}/sessions`, { headers: { "X-API-Key": cred.chave }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`sessions ${r.status}`);
  const lista = await r.json();
  const s = Array.isArray(lista) ? lista.find((x) => x && x.name === alvo) : null;
  if (!s?.id) throw Object.assign(new Error("sessão não encontrada"), { status: 404 });
  idsPorNome.set(alvo, String(s.id));
  if (!nome) sessaoId = String(s.id);
  return String(s.id);
}

/**
 * Rota media-id: a mídia de UMA mensagem pelo id. Até 3 idas ao OpenWA, nesta ordem:
 *  1) arquivo guardado quando a mensagem chegou (não depende da idade da mensagem);
 *  2) histórico SEM mídia das 100 mais recentes, só para achar a posição da mensagem;
 *  3) histórico COM mídia só até essa posição (o WhatsApp Web baixa de novo; ela é a primeira da lista).
 * Fora das 100 mais recentes e sem arquivo: 404 "fora-da-janela" (o OpenWA v0.24.0 não alcança).
 * Devolve { status, bytes?, mime?, fonte? } ou { status, corpo } (erro, sem cabeçalho do OpenWA).
 */
async function midiaPorId(p, chave, base) {
  const hdr = { "X-API-Key": chave };
  const erroDe = async (r) => {
    const d = await r.json().catch(() => ({}));
    return erroOpenwaParaCrm(r.status, typeof d?.message === "string" ? d.message : Array.isArray(d?.message) ? d.message.join("; ") : "");
  };
  const r1 = await fetch(`${base}${p.arquivo}`, { headers: hdr, signal: AbortSignal.timeout(40_000) });
  if (r1.ok) {
    const buf = Buffer.from(await r1.arrayBuffer());
    if (buf.length > TETO_MIDIA) return { status: 413, corpo: { error: "mídia grande demais" } };
    if (buf.length) {
      const ct = (r1.headers.get("content-type") || "").split(";")[0].trim();
      return { status: 200, bytes: buf, mime: ct || null, fonte: "arquivo" };
    }
  } else if (r1.status !== 404) {
    return await erroDe(r1);
  } else {
    await r1.arrayBuffer().catch(() => null);
  }

  const r2 = await fetch(`${base}${p.janela}`, { headers: hdr, signal: AbortSignal.timeout(30_000) });
  if (semSuporteNoMotor(r2.status)) {
    // motor sem histórico ao vivo (Baileys): sem arquivo guardado, não há de onde tirar a mídia
    await r2.arrayBuffer().catch(() => null);
    return { status: 404, corpo: { error: "sem-historico" } };
  }
  if (!r2.ok) return await erroDe(r2);
  const posicao = posicaoDoFim(await r2.json().catch(() => []), p.messageId);
  if (!posicao) {
    return { status: 404, corpo: { error: "fora-da-janela", janela: JANELA_MIDIA_OPENWA } };
  }

  const r3 = await fetch(`${base}${p.comMidia(posicao)}`, { headers: hdr, signal: AbortSignal.timeout(100_000) });
  if (!r3.ok) return await erroDe(r3);
  const m = midiaDaMensagem(await r3.json().catch(() => []), p.messageId);
  if (!m || m.semMidia) return { status: 404, corpo: { error: "sem-midia", posicao } };
  if (m.omitida) return { status: 404, corpo: { error: "midia-indisponivel", posicao } };
  const buf = Buffer.from(m.data.replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length) return { status: 404, corpo: { error: "midia-indisponivel", posicao } };
  if (buf.length > TETO_MIDIA) return { status: 413, corpo: { error: "mídia grande demais" } };
  return { status: 200, bytes: buf, mime: m.mimetype, fonte: `historico-${posicao}` };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on("data", (c) => {
      tam += c.length;
      if (tam > TETO_CORPO) { reject(Object.assign(new Error("grande"), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  const inicio = Date.now();
  const url = new URL(req.url, "http://x");
  let rota = "-";
  let destino = "-";
  let status = 500;
  let origem = null; // status/qr: "cache" | "velho" | "openwa" (só no log)
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      status = pronto ? 200 : 503;
      return responder(res, status, { ok: pronto });
    }
    const m = /^\/v1\/([a-z-]+)$/.exec(url.pathname);
    if (req.method !== "POST" || !m || !(ROTAS.includes(m[1]) || ROTAS_GRUPO.includes(m[1])) || url.search) {
      status = 404;
      return responder(res, 404, { error: "não existe" });
    }
    rota = m[1];
    if (!pronto) {
      status = 503;
      return responder(res, 503, { error: "proxy sem chave do OpenWA" });
    }

    const corpoCru = await lerCorpo(req);
    const conf = conferirChamada({
      secret: SEGREDO, headers: req.headers, metodo: "POST", caminho: url.pathname,
      corpo: corpoCru, agoraMs: Date.now(), cache,
    });
    if (!conf.ok) {
      status = conf.status;
      log({ rota, status, recusa: conf.motivo });
      return responder(res, conf.status, { error: "não autorizado" });
    }

    let corpo;
    try { corpo = corpoCru ? JSON.parse(corpoCru) : {}; } catch { corpo = null; }
    destino = mascarar(corpo?.phone ?? String(corpo?.chatId ?? "").split("@")[0]);

    if (rota === "group-allowlist") {
      const v = validarAllowlist(corpo);
      if (v.erro) { status = 400; return responder(res, 400, { error: v.erro }); }
      gravarJSON(ARQ_ALLOWLIST, v.grupos);
      allowlist = new Set(v.grupos);
      status = 200;
      return responder(res, 200, { ok: true, total: v.grupos.length });
    }

    const sep = separarSessao(rota, corpo, SESSOES_EXTRAS);
    if (sep.erro) { status = 400; return responder(res, 400, { error: sep.erro }); }
    if (ROTAS_SO_COM_SESSAO.has(rota) && !sep.sessao) { status = 400; return responder(res, 400, { error: "sessao obrigatória" }); }
    corpo = sep.corpo;
    const base = baseDe(sep.sessao);
    if (!base) { status = 503; return responder(res, 503, { error: "sessão sem instância válida no proxy" }); }
    const sid = await idDaSessao(sep.sessao);
    const chave = chaveDaSessao(sep.sessao);
    const pedido = ROTAS_ADMIN_GRUPO.has(rota)
      ? montarPedidoAdminGrupo(rota, corpo, sid, allowlist)
      : ROTAS_ENVIO_GRUPO_MANUAL.has(rota)
      ? montarPedidoGrupoManual(rota, corpo, sid)
      : ROTAS_ENVIO_GRUPO.has(rota)
        ? montarPedidoGrupo(rota, corpo, sid, allowlist)
        : montarPedidoOpenwa(rota, corpo, sid);
    if (pedido.erro) {
      status = pedido.status || 400;
      return responder(res, status, { error: pedido.erro });
    }

    // nota de voz: converte (ou pega do cache) ANTES de gastar vaga de envio; falhou = 422 e o CRM cai p/ documento
    let duracaoVoz = null;
    if (pedido.voz) {
      try {
        const v = await prepararVoz(pedido.corpo.url);
        delete pedido.corpo.url;
        pedido.corpo.base64 = v.base64;
        pedido.corpo.mimetype = MIME_VOZ;
        duracaoVoz = v.duracaoS;
        origem = v.origem;
      } catch (e) {
        status = 422;
        log({ evento: "voz_falhou", rota, motivo: e?.motivo || e?.code || e?.name || "?" });
        return responder(res, 422, { error: "não consegui converter o áudio em nota de voz", motivo: "conversao", detalhe: e?.motivo || null });
      }
    }

    const deEstado = ROTAS_DE_ESTADO.has(rota);
    if (deEstado) {
      const d = estados.consultar(rota, base, sep.sessao, Date.now());
      origem = d.usar;
      if (d.usar === "cache" || d.usar === "velho") {
        status = 200;
        return responder(res, 200, d.usar === "velho" ? { ...d.corpo, cache: "velho", idadeS: d.idadeS } : d.corpo, { "X-Cache": d.usar });
      }
      if (d.usar === "recusa") {
        status = 429;
        return responder(res, 429, { error: d.motivo, retryAfter: d.retryAfter }, { "Retry-After": String(d.retryAfter) });
      }
    }

    if (pedido.desconectar) {
      // o nome confirmado tem que ser o da sessão que vai cair (a padrão inclusive): corpo sem `sessao` com
      // confirmar de outra sessão é recusado antes de qualquer ida ao OpenWA
      const alvo = sep.sessao || SESSAO_NOME;
      if (pedido.confirmar !== alvo) { status = 400; return responder(res, 400, { error: "confirmar não é a sessão pedida" }); }
      const vaga = desconexoes.reservar(alvo, Date.now());
      if (!vaga.ok) { status = 429; return responder(res, 429, { error: vaga.motivo, retryAfter: vaga.retryAfter }, { "Retry-After": String(vaga.retryAfter) }); }
      const ida = estados.reservarIda("logout", base, Date.now());
      if (!ida.ok) { status = 429; return responder(res, 429, { error: ida.motivo, retryAfter: ida.retryAfter }, { "Retry-After": String(ida.retryAfter) }); }
      const out = await desconectarSessao(pedido, base, sid, chave, sep.sessao);
      status = out.status;
      return responder(res, out.status, out.corpo, out.status === 429 ? { "Retry-After": String(out.corpo.retryAfter) } : {});
    }

    if (pedido.pareamento) {
      const vaga = pareamentos.reservar(sep.sessao, Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
    } else if (ROTAS_ADMIN_GRUPO.has(rota)) {
      const lim = rota === "group-create" ? limitadorCriacao : limitadorEscrita;
      const vaga = lim.reservar(sep.sessao, Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
      try { gravarJSON(rota === "group-create" ? ARQ_LIMITE_CRIACAO : ARQ_LIMITE_ESCRITA, lim.paraJSON()); } catch (e) { log({ evento: "limite_admin_nao_salvo", erro: e.code || "?" }); }
    } else if (ROTAS_ENVIO_GRUPO_MANUAL.has(rota)) {
      const vaga = limitadorManual.reservar(sep.sessao, Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
      salvarLimiteManual();
    } else if (ROTAS_ENVIO_GRUPO.has(rota)) {
      const vaga = limitadorGrupo.reservar(sep.sessao, Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
      salvarLimiteGrupo();
    } else if (ROTAS_DE_ENVIO.has(rota)) {
      const vaga = limitador.reservar(Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
      salvarLimite();
    } else if (!deEstado) {
      // status/qr já passaram pelo orçamento próprio acima (leitura barata, não disputa com histórico/mídia)
      const vaga = leituras.reservar(Date.now());
      if (!vaga.ok) {
        status = 429;
        return responder(res, 429, { error: vaga.motivo }, { "Retry-After": String(vaga.retryAfter) });
      }
    }

    if (pedido.admins) {
      const out = await aplicarAdmins(pedido.admins, base, sid, chave);
      status = out.status;
      log({ evento: "group-admins", dest: mascarar(pedido.admins.chatId.split("@")[0]), status: out.status, ok: out.corpo?.ok ?? false,
        admins: (out.corpo?.resultados ?? []).filter((r) => r.admin).length, pedidos: pedido.admins.telefones.length });
      return responder(res, out.status, out.corpo);
    }

    if (pedido.criarGrupo) {
      // participantes no formato que o WhatsApp conhece (com/sem o 9): sem isso o grupo nasce sem os admins
      const resolvidos = [];
      for (const t of pedido.corpo.participants.map((w) => w.split("@")[0])) {
        const r = await resolverTelefone(t, base, sid, chave);
        resolvidos.push(`${r.numero ?? t}@c.us`);
      }
      pedido.corpo.participants = [...new Set(resolvidos)];
    }

    if (pedido.contatos) {
      // um GET por contato (rápido: lê o cache do WhatsApp Web) e, se não veio telefone, o /phone.
      // Teto de 20 s no total; o que sobrar volta só com o id.
      const fim = Date.now() + 20_000;
      const saida = [];
      for (const id of pedido.contatos) {
        if (Date.now() > fim) { saida.push({ id, name: null, pushName: null, phone: null }); continue; }
        const urlContato = `${base}/sessions/${encodeURIComponent(sid)}/contacts/${encodeURIComponent(id)}`;
        let contato = null;
        let tel = null;
        try {
          const rc = await fetch(urlContato, { headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(4_000) });
          contato = rc.ok ? await rc.json().catch(() => null) : null;
          const r0 = resumoContato(id, contato, null);
          if (!r0.phone && id.endsWith("@lid")) {
            const rp = await fetch(`${urlContato}/phone`, { headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(4_000) });
            tel = rp.ok ? telefoneResolvido(await rp.json().catch(() => null)) : null;
          }
        } catch { /* fica sem */ }
        saida.push(resumoContato(id, contato, tel));
      }
      status = 200;
      return responder(res, 200, saida);
    }

    if (pedido.midiaPorId) {
      const out = await midiaPorId(pedido.midiaPorId, chave, base);
      status = out.status;
      if (out.bytes) {
        res.writeHead(200, {
          "Content-Type": out.mime || "application/octet-stream",
          "Content-Length": String(out.bytes.length),
          "Cache-Control": "no-store",
          "X-Midia-Fonte": out.fonte,
        });
        return res.end(out.bytes);
      }
      return responder(res, out.status, out.corpo);
    }

    if (pedido.mencionarTodos) {
      // "mencionar todos" sem @ no texto: ids dos participantes direto do OpenWA, só dentro do proxy
      const ri = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/groups/${encodeURIComponent(pedido.mencionarTodos)}`, {
        headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(15_000),
      });
      const ids = ri.ok ? idsParticipantes(await ri.json().catch(() => null)) : [];
      if (!ids.length) {
        status = 502;
        return responder(res, 502, { error: "não consegui ler os participantes para mencionar todos", status: ri.status });
      }
      pedido.corpo.mentions = ids;
    }

    if (pedido.gravando) {
      // "gravando áudio…" proporcional à duração (melhor esforço: falhou, segue e manda do mesmo jeito)
      await mostrarGravando(base, sid, chave, pedido.gravando, esperaGravandoMs(duracaoVoz));
    }

    const r = await fetch(`${base}${pedido.caminho}`, {
      method: pedido.metodo,
      headers: {
        "X-API-Key": chave,
        ...(pedido.corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: pedido.corpo ? JSON.stringify(pedido.corpo) : undefined,
      // pareamento: o OpenWA (whatsapp-web.js) tenta até 4x15 s + 3x3 s enquanto a página do QR recarrega
      signal: AbortSignal.timeout(timeoutDoPedido(pedido, TEMPOS)),
    });
    status = r.status;

    if (pedido.binario && r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > TETO_MIDIA) { status = 413; return responder(res, 413, { error: "mídia grande demais" }); }
      res.writeHead(200, {
        "Content-Type": r.headers.get("content-type") || "application/octet-stream",
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      });
      return res.end(buf);
    }

    if (rota === "history" && semSuporteNoMotor(r.status)) {
      // Baileys não tem histórico ao vivo: "sem histórico", não falha (a importação lê 0 e segue)
      await r.arrayBuffer().catch(() => null);
      status = 200;
      return responder(res, 200, [], { "X-Sem-Historico": "1" });
    }
    const dados = await r.json().catch(() => ({}));
    if (pedido.foto && r.ok) {
      // {url} -> bytes. Sem foto (ou escondida pela privacidade) = 404 "sem foto".
      const fotoUrl = dados?.url;
      if (!fotoUrl) { status = 404; return responder(res, 404, { error: "sem foto" }); }
      if (!urlFotoPermitida(fotoUrl)) { status = 502; return responder(res, 502, { error: "url de foto fora do CDN" }); }
      const rf = await fetch(fotoUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      const tipo = (rf.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!rf.ok || !/^image\/(jpeg|png|webp)$/.test(tipo)) {
        status = 502;
        return responder(res, 502, { error: "foto indisponível", status: rf.status });
      }
      const buf = Buffer.from(await rf.arrayBuffer());
      if (!buf.length || buf.length > TETO_FOTO) { status = 413; return responder(res, 413, { error: "foto grande demais" }); }
      status = 200;
      res.writeHead(200, { "Content-Type": tipo, "Content-Length": String(buf.length), "Cache-Control": "no-store" });
      return res.end(buf);
    }
    if (!r.ok) {
      // repassa só o status e a mensagem curta do OpenWA, nunca cabeçalhos
      const msg = typeof dados?.message === "string" ? dados.message.slice(0, 200) : undefined;
      if (r.status === 429) {
        // throttler do OpenWA: repassa quanto esperar e, em status/qr, para de bater até lá
        const espera = esperaDo429((n) => r.headers.get(n));
        if (deEstado) estados.bloquear(rota, base, espera, Date.now());
        return responder(res, 429, { error: "openwa", status: 429, message: msg, retryAfter: espera }, { "Retry-After": String(espera) });
      }
      return responder(res, r.status >= 500 ? 502 : r.status, { error: "openwa", status: r.status, message: msg });
    }
    if (rota === "status") {
      const corpoStatus = { status: dados?.status ?? null, phone: dados?.phone ?? null };
      estados.guardar("status", base, sep.sessao, corpoStatus, Date.now());
      return responder(res, 200, corpoStatus);
    }
    if (rota === "pairing-code") {
      const codigo = codigoPareamento(dados);
      if (!codigo) { status = 502; return responder(res, 502, { error: "código ilegível" }); }
      return responder(res, 200, { pairingCode: codigo, status: dados?.status ?? null });
    }
    if (rota === "qr") {
      const qr = typeof dados?.qrCode === "string" && dados.qrCode.startsWith("data:image/") ? dados.qrCode : null;
      const corpoQr = { qrCode: qr, status: dados?.status ?? null };
      if (qr) estados.guardar("qr", base, sep.sessao, corpoQr, Date.now());
      return responder(res, 200, corpoQr);
    }
    if (rota === "chats") {
      // @lid (id de privacidade): resolve o telefone um a um, na sequência, best-effort.
      // Sem telefone a conversa sai com phone null e o CRM pula (não há como gravar sem número).
      // Teto de 15 s no total pra caber no timeout de quem chamou (25 s); o que sobrar fica null.
      const chats = filtrarChatsIndividuais(dados);
      const fim = Date.now() + 15_000;
      for (const c of chats) {
        if (c.phone) continue;
        if (Date.now() > fim) break;
        try {
          const rr = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/contacts/${encodeURIComponent(c.chatId)}/phone`, {
            headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(4_000),
          });
          c.phone = rr.ok ? telefoneResolvido(await rr.json().catch(() => null)) : null;
        } catch {
          c.phone = null;
        }
      }
      return responder(res, 200, chats);
    }
    if (rota === "chats-page") {
      return responder(res, 200, filtrarPaginaChats(dados));
    }
    if (pedido.chatsRecentes) {
      // histórico de cada conversa no OpenWA local, 4 por vez, teto de 45 s no total (quem chama espera 80 s);
      // @lid sem telefone tenta o /phone. O que não coube no tempo volta sem mensagens e com parcial: true.
      const { limit, porChat } = pedido.chatsRecentes;
      const chats = filtrarChatsRecentes(dados, limit);
      // histórico: até 45 s, sem passar do orçamento total do pedido (a lista pode ter levado até 50 s)
      const fim = Math.min(Date.now() + 45_000, inicio + TEMPOS.totalRecentes);
      let parcial = false;
      const umChat = async (c) => {
        if (Date.now() > fim) { parcial = true; return { ...c, mensagens: [] }; }
        let phone = c.phone;
        if (!phone && c.kind === "individual" && c.chatId.endsWith("@lid")) {
          try {
            const rr = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/contacts/${encodeURIComponent(c.chatId)}/phone`, {
              headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(4_000),
            });
            phone = rr.ok ? telefoneResolvido(await rr.json().catch(() => null)) : null;
          } catch { phone = null; }
        }
        try {
          const rh = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/messages/${encodeURIComponent(c.chatId)}/history?limit=${porChat}`, {
            headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(Math.max(1_000, Math.min(15_000, fim - Date.now()))),
          });
          // 501 (motor sem histórico ao vivo): conversa sem mensagens, sem marcar parcial
          const lista = rh.ok ? await rh.json().catch(() => []) : [];
          if (!rh.ok) await rh.arrayBuffer().catch(() => null);
          const msgs = (Array.isArray(lista) ? lista : Array.isArray(lista?.messages) ? lista.messages : [])
            .map(mensagemLeve).filter(Boolean);
          return { ...c, phone, mensagens: msgs };
        } catch {
          parcial = true;
          return { ...c, phone, mensagens: [] };
        }
      };
      const saida = new Array(chats.length);
      let proximo = 0;
      await Promise.all(Array.from({ length: Math.min(4, chats.length) }, async () => {
        while (proximo < chats.length) {
          const i = proximo++;
          saida[i] = await umChat(chats[i]);
        }
      }));
      status = 200;
      return responder(res, 200, { itens: saida, parcial });
    }
    if (pedido.comMidia) {
      return responder(res, 200, filtrarMidiasHistorico(dados));
    }
    if (rota === "groups") {
      return responder(res, 200, filtrarChatsGrupos(dados, pedido.limiteGrupos));
    }
    if (rota === "group-invite") {
      const link = linkConviteDe(dados);
      return link ? responder(res, 200, { inviteLink: link }) : responder(res, 502, { error: "convite ilegível" });
    }
    if (rota === "group-create") {
      const g = grupoCriadoDe(dados);
      return g ? responder(res, 200, g) : responder(res, 502, { error: "grupo criado com resposta ilegível" });
    }
    if (ROTAS_ADMIN_GRUPO.has(rota)) {
      return responder(res, 200, { ok: dados?.success !== false, message: typeof dados?.message === "string" ? dados.message.slice(0, 200) : null });
    }
    if (rota === "group-info") {
      const g = resumoGrupo(dados, await telefoneDaSessao(base, sid, chave));
      return g ? responder(res, 200, g) : responder(res, 502, { error: "grupo ilegível" });
    }
    if (ROTAS_DE_ENVIO.has(rota) || ROTAS_ENVIO_GRUPO.has(rota) || ROTAS_ENVIO_GRUPO_MANUAL.has(rota)) {
      return responder(res, 200, {
        messageId: dados?.messageId ?? null, timestamp: dados?.timestamp ?? null,
        ...(pedido.voz ? { voz: true, duracaoS: duracaoVoz } : {}),
      });
    }
    return responder(res, 200, dados);
  } catch (e) {
    const falha = respostaDeFalha(e);
    status = falha.status;
    return responder(res, status, falha.corpo);
  } finally {
    log({ rota, status, ms: Date.now() - inicio, dest: destino, ...(origem ? { origem } : {}) });
  }
});

/**
 * Rota desconectar: logout no OpenWA (desvincula o aparelho e apaga a credencial; a linha da sessão fica) e, se deu
 * certo, start para a sessão voltar a mostrar QR. Limpa o status/QR guardados dessa sessão em qualquer resultado
 * (o estado mudou ou pode ter mudado). O start também entra no orçamento; sem vaga, não tenta e avisa.
 */
async function desconectarSessao(pedido, base, sid, chave, sessao) {
  const hdr = { "X-API-Key": chave };
  let logout;
  try {
    const r = await fetch(`${base}${pedido.caminho}`, { method: "POST", headers: hdr, signal: AbortSignal.timeout(TEMPO_DESCONECTAR_MS) });
    if (r.status === 429) {
      await r.arrayBuffer().catch(() => null);
      const espera = esperaDo429((n) => r.headers.get(n));
      estados.bloquear("logout", base, espera, Date.now());
      return { status: 429, corpo: { error: "o OpenWA limitou esta operação; espere", retryAfter: espera } };
    }
    logout = { status: r.status, dados: await r.json().catch(() => ({})) };
  } finally {
    estados.limpar(base, sessao);
    cacheTelefoneSessao.delete(`${base}|${sid}`);
  }
  let start = null;
  if (logout.status >= 200 && logout.status < 300) {
    const ida = estados.reservarIda("start", base, Date.now());
    if (ida.ok) {
      try {
        const rs = await fetch(`${base}${pedido.reiniciar}`, { method: "POST", headers: hdr, signal: AbortSignal.timeout(TEMPO_DESCONECTAR_MS) });
        if (rs.status === 429) estados.bloquear("start", base, esperaDo429((n) => rs.headers.get(n)), Date.now());
        start = { status: rs.status, dados: await rs.json().catch(() => ({})) };
      } catch {
        start = { status: 0 };
      }
      estados.limpar(base, sessao);
    }
    log({ evento: "desconectar", sessao: sessao || SESSAO_NOME, logout: logout.status, start: start ? start.status : "sem-orcamento" });
  }
  return respostaDesconectar(logout, start);
}

// ------------------------------------------------------------------ nota de voz (21/10/2026)

function rodar(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
      if (err) return reject(Object.assign(new Error(`${bin} falhou`), { motivo: `${bin}${err.killed ? "-timeout" : ""}` }));
      resolve(stdout);
    });
  });
}

async function sondar(arquivo) {
  return lerFfprobe(await rodar("ffprobe", argsFfprobe(arquivo), 15_000));
}

/** Tira os convertidos mais antigos quando o cache passa do teto (melhor esforço). */
function podarCacheVoz() {
  try {
    const arqs = fs.readdirSync(DIR_VOZ).filter((n) => n.endsWith(".ogg"))
      .map((n) => ({ n, t: fs.statSync(path.join(DIR_VOZ, n)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    for (const { n } of arqs.slice(0, Math.max(0, arqs.length - TETO_CACHE_VOZ))) {
      fs.rmSync(path.join(DIR_VOZ, n), { force: true });
      fs.rmSync(path.join(DIR_VOZ, n.replace(/\.ogg$/, ".json")), { force: true });
    }
  } catch { /* cache é só atalho */ }
}

/**
 * Baixa o áudio da URL (https, até 16 MB), converte para Ogg/Opus mono 48 kHz e devolve { base64, duracaoS, origem }.
 * Cache por sha256 dos bytes em DATA_DIR/voz/<hash>.ogg (+ .json com a duração). Erro sai com `motivo` curto.
 */
async function prepararVoz(url) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw Object.assign(new Error("download"), { motivo: `download-${r.status}` });
  if (!/^https:\/\//.test(r.url)) throw Object.assign(new Error("download"), { motivo: "redirecionou-para-http" });
  const tam = Number(r.headers.get("content-length") || 0);
  if (tam > TETO_ORIGEM_VOZ) throw Object.assign(new Error("grande"), { motivo: "audio-grande-demais" });
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length || bytes.length > TETO_ORIGEM_VOZ) throw Object.assign(new Error("grande"), { motivo: "audio-vazio-ou-grande" });

  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const arqOgg = path.join(DIR_VOZ, `${hash}.ogg`);
  const arqMeta = path.join(DIR_VOZ, `${hash}.json`);
  try {
    const ogg = fs.readFileSync(arqOgg);
    const meta = lerJSON(arqMeta, {});
    const agora = new Date();
    fs.utimesSync(arqOgg, agora, agora);
    return { base64: ogg.toString("base64"), duracaoS: Number(meta.duracaoS) || null, origem: "voz-cache" };
  } catch { /* não está no cache: converte */ }

  fs.mkdirSync(DIR_VOZ, { recursive: true });
  const id = `${hash.slice(0, 16)}-${process.pid}-${Date.now()}`;
  const entrada = path.join(TMP, `voz-${id}.in`);
  const saida = path.join(TMP, `voz-${id}.ogg`);
  try {
    fs.writeFileSync(entrada, bytes);
    const sonda = await sondar(entrada);
    if (!sonda) throw Object.assign(new Error("sem áudio"), { motivo: "arquivo-sem-audio" });
    if (sonda.duracaoS && sonda.duracaoS > TETO_DURACAO_VOZ_S) throw Object.assign(new Error("longo"), { motivo: "audio-longo-demais" });
    let origem = "voz-convertida";
    if (vozJaPronta(sonda)) {
      fs.copyFileSync(entrada, saida);
      origem = "voz-ja-opus";
    } else {
      await rodar("ffmpeg", argsFfmpegVoz(entrada, saida), 60_000);
    }
    const final = await sondar(saida);
    if (!vozJaPronta(final)) throw Object.assign(new Error("saída"), { motivo: "conversao-fora-do-formato" });
    const ogg = fs.readFileSync(saida);
    const duracaoS = final.duracaoS ?? sonda.duracaoS ?? null;
    // /tmp é tmpfs e /data é volume: copia para um temporário em /data e renomeia (atômico no mesmo disco)
    fs.writeFileSync(`${arqOgg}.tmp`, ogg);
    fs.renameSync(`${arqOgg}.tmp`, arqOgg);
    gravarJSON(arqMeta, { duracaoS, bytesOrigem: bytes.length, bytesOgg: ogg.length, em: new Date().toISOString() });
    podarCacheVoz();
    log({ evento: "voz_convertida", origem, bytesOrigem: bytes.length, bytesOgg: ogg.length, duracaoS });
    return { base64: ogg.toString("base64"), duracaoS, origem };
  } finally {
    fs.rmSync(entrada, { force: true });
    fs.rmSync(saida, { force: true });
  }
}

/** "gravando áudio…" na conversa por `ms`, reenviado a cada 8 s; nunca lança. */
async function mostrarGravando(base, sid, chave, chatId, ms) {
  const fim = Date.now() + ms;
  const enviar = async (state) => {
    try {
      const r = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/chats/typing`, {
        method: "POST",
        headers: { "X-API-Key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, state }),
        signal: AbortSignal.timeout(4_000),
      });
      await r.arrayBuffer().catch(() => null);
      return r.ok;
    } catch { return false; }
  };
  while (Date.now() < fim) {
    const ok = await enviar("recording");
    if (!ok) { log({ evento: "gravando_sem_presenca" }); }
    await new Promise((res) => setTimeout(res, Math.max(0, Math.min(GRAVANDO_REPETE_MS, fim - Date.now()))));
  }
}

/**
 * Telefone -> número que o WhatsApp conhece. Tenta as variantes com/sem o 9 no contacts/check (onWhatsApp);
 * a primeira que existe vence. Sem resposta do check: regra do 9 (verificado: false). Todas "não existe": erro.
 */
async function resolverTelefone(telefone, base, sid, chave) {
  const variantes = variantesTelefoneBR(telefone);
  let semResposta = false;
  for (const v of variantes) {
    try {
      const r = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/contacts/check/${encodeURIComponent(v)}`, {
        headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) { await r.arrayBuffer().catch(() => null); semResposta = true; continue; }
      const d = await r.json().catch(() => null);
      if (d?.exists === true) return { telefone, numero: digitosDoId(d.whatsappId) ?? v, verificado: true };
      if (d?.exists !== false) semResposta = true;
    } catch { semResposta = true; }
  }
  if (semResposta) return { telefone, numero: variantes[0] ?? telefone, verificado: false };
  return { telefone, numero: null, verificado: true, erro: `não tem WhatsApp (testei ${variantes.join(" e ")})` };
}

async function lerGrupo(base, sid, chave, chatId) {
  const r = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/groups/${encodeURIComponent(chatId)}`, {
    headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(10_000),
  });
  const d = await r.json().catch(() => null);
  return r.ok ? membrosDoGrupo(d) : { erro: r.status, message: typeof d?.message === "string" ? d.message.slice(0, 160) : null };
}

async function escreverParticipantes(base, sid, chave, chatId, sufixo, numeros) {
  const r = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/groups/${encodeURIComponent(chatId)}/participants${sufixo}`, {
    method: "POST",
    headers: { "X-API-Key": chave, "Content-Type": "application/json" },
    body: JSON.stringify({ participants: numeros.map((n) => `${n}@c.us`) }),
    signal: AbortSignal.timeout(20_000),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, porNumero: statusPorParticipante(d), message: typeof d?.message === "string" ? d.message.slice(0, 200) : null };
}

/**
 * group-admins: confere os números, ADICIONA quem não está no grupo, PROMOVE e relê o grupo para dizer a verdade.
 * Resposta 200 { ok, resultados: [{ telefone, numero, verificado, membro, admin, erro? }], participantes };
 * 502 só quando nem o grupo deu para ler.
 */
async function aplicarAdmins({ chatId, telefones }, base, sid, chave) {
  const antes = await lerGrupo(base, sid, chave, chatId);
  if (antes.erro) return { status: 502, corpo: { error: `não consegui ler o grupo (OpenWA ${antes.erro})`, message: antes.message } };
  const res = [];
  for (const t of telefones) res.push({ ...(await resolverTelefone(t, base, sid, chave)), membro: false, admin: false });
  for (const r of res) if (r.numero) { r.membro = antes.membros.has(r.numero); r.admin = antes.admins.has(r.numero); }

  const adicionar = [...new Set(res.filter((r) => r.numero && !r.membro).map((r) => r.numero))];
  if (adicionar.length) {
    const a = await escreverParticipantes(base, sid, chave, chatId, "", adicionar);
    for (const r of res) {
      if (!r.numero || r.membro) continue;
      const st = a.porNumero.get(r.numero);
      if (st === 200 || st === 409) r.membro = true;
      else r.erro = st ? `adicionar: ${textoStatusParticipante("add", st)}` : `adicionar: OpenWA ${a.status}${a.message ? ` (${a.message})` : ""}`;
    }
  }
  const promover = [...new Set(res.filter((r) => r.membro && !r.admin).map((r) => r.numero))];
  if (promover.length) {
    const pr = await escreverParticipantes(base, sid, chave, chatId, "/promote", promover);
    for (const r of res) {
      if (!r.membro || r.admin) continue;
      const st = pr.porNumero.get(r.numero);
      if (st === 200) r.admin = true;
      else r.erro = st ? `promover: ${textoStatusParticipante("promote", st)}` : `promover: OpenWA ${pr.status}${pr.message ? ` (${pr.message})` : ""}`;
    }
  }
  // a verdade é o grupo relido (o WhatsApp às vezes responde 200 e não aplica)
  const depois = await lerGrupo(base, sid, chave, chatId).catch(() => ({ erro: 0 }));
  if (!depois.erro) {
    for (const r of res) {
      if (!r.numero) continue;
      r.membro = depois.membros.has(r.numero);
      r.admin = depois.admins.has(r.numero);
      if (r.admin) delete r.erro;
      else if (!r.erro) r.erro = r.membro ? "entrou, mas não virou admin" : "não está no grupo";
    }
  }
  return {
    status: 200,
    corpo: { ok: res.every((r) => r.admin), conferido: !depois.erro, participantes: depois.erro ? null : depois.total, resultados: res },
  };
}

/**
 * Telefone da própria sessão (GET /sessions/:id -> phone), para dizer se ela é admin do grupo.
 * Cache de 10 min por instância+sessão; falhou = null (a permissão vira "não sei", nunca "admin").
 */
const cacheTelefoneSessao = new Map();
async function telefoneDaSessao(base, sid, chave) {
  const k = `${base}|${sid}`;
  const c = cacheTelefoneSessao.get(k);
  if (c && Date.now() - c.em < 600_000) return c.phone;
  let phone = null;
  try {
    const r = await fetch(`${base}/sessions/${encodeURIComponent(sid)}`, {
      headers: { "X-API-Key": chave }, signal: AbortSignal.timeout(4_000),
    });
    const d = r.ok ? await r.json().catch(() => null) : null;
    const dig = String(d?.phone ?? "").replace(/\D/g, "");
    phone = /^\d{10,15}$/.test(dig) ? dig : null;
  } catch { phone = null; }
  if (phone) cacheTelefoneSessao.set(k, { phone, em: Date.now() });
  return phone;
}

servidor.headersTimeout = 15_000;
servidor.requestTimeout = 60_000;
servidor.listen(PORTA, "0.0.0.0", () => {
  log({
    evento: "inicio", porta: PORTA, pronto, sessao: SESSAO_ID_FIXO ? "id fixo" : `nome ${SESSAO_NOME}`,
    sessoesExtras: SESSOES_EXTRAS.size,
    sessoesExtrasComChave: [...SESSOES_EXTRAS].filter((n) => chaveDaSessao(n)).length,
    sessoesComInstanciaPropria: sessoesComBasePropria(SESSOES_EXTRAS, process.env, BASE),
    sessoesComInstanciaInvalida: [...SESSOES_EXTRAS].filter((n) => !baseDe(n)),
    gruposPermitidos: allowlist.size,
  });
});
for (const sinal of ["SIGTERM", "SIGINT"]) process.on(sinal, () => servidor.close(() => process.exit(0)));
