// YouTube conectado: login do Google, credenciais, cifra do refresh_token, corpo do broadcast/stream,
// ingestão, regra de transição e o cliente HTTP (fetch falso, nada sai pra rede).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  candidatosCredGoogle, ClienteYouTube, comCredencial, conferirSegredoGoogle, corpoBroadcast, corpoStream, decifrarTokenYt, cifrarTokenYt, erroDoGoogle, ESCOPO_YT,
  estadoDoBroadcast, estadoValido, ingestaoDoStream, lerCredenciaisGoogle, limparCodeGoogle, precisaTransicionarLive,
  urlAutorizacaoGoogle, validarCorpoGoogle, validarDestinoYt,
} from "../../supabase/functions/_shared/youtube";
import { decifrarChave } from "../../supabase/functions/_shared/liveCrypto";
import { detalheDestino, lerMensagemOauth, precisaConferirYt, textoEstadoYt } from "@/lib/lives/youtube";
import type { LiveDestino } from "@/lib/lives/api";

const SEGREDO = "segredo-de-teste-das-lives-0123456789abcdef";
const ID = "123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com";
const SECRET = "GOCSPX-AbCdEfGhIjKlMnOpQrStUvWx12";

describe("login do Google", () => {
  it("URL com escopo force-ssl, offline + consent (pra voltar refresh_token), redirect e state", () => {
    const u = new URL(urlAutorizacaoGoogle({ clientId: ID, redirectUri: "https://x.supabase.co/functions/v1/youtube-oauth", state: "s".repeat(32) }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe(ESCOPO_YT);
    expect(ESCOPO_YT).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toContain("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.supabase.co/functions/v1/youtube-oauth");
    expect(u.searchParams.get("state")).toBe("s".repeat(32));
  });

  it("state e code: aceita o formato real, recusa lixo", () => {
    expect(estadoValido("a".repeat(32))).toBe(true);
    expect(estadoValido("curto")).toBe(false);
    expect(estadoValido("a".repeat(30) + "<>")).toBe(false);
    expect(limparCodeGoogle("4/0AQSTgQExemploDeCode_-x")).toBe("4/0AQSTgQExemploDeCode_-x");
    expect(limparCodeGoogle("4/0A x")).toBeNull();
    expect(limparCodeGoogle(null)).toBeNull();
  });

  it("credenciais: env vence; senão o JSON do pareamento; incompleto = null", () => {
    const guardado = JSON.stringify({ client_id: ID, client_secret: SECRET });
    expect(lerCredenciaisGoogle({ id: "env-id", secret: "env-sec" }, guardado)).toEqual({ clientId: "env-id", clientSecret: "env-sec" });
    expect(lerCredenciaisGoogle({ id: "env-id", secret: "" }, guardado)).toEqual({ clientId: ID, clientSecret: SECRET });
    expect(lerCredenciaisGoogle({}, JSON.stringify({ client_id: ID }))).toBeNull();
    expect(lerCredenciaisGoogle({}, "não é json")).toBeNull();
    expect(lerCredenciaisGoogle({}, null)).toBeNull();
  });

  it("pareamento: valida e devolve o mesmo texto (e hash) que o script Python monta", () => {
    const v = validarCorpoGoogle(JSON.stringify({ client_secret: ` ${SECRET} `, client_id: ID }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // json.dumps({"client_id":..,"client_secret":..}, separators=(",", ":"))
    const python = `{"client_id":"${ID}","client_secret":"${SECRET}"}`;
    expect(v.valor).toBe(python);
    expect(createHash("sha256").update(v.valor).digest("hex").slice(0, 12)).toBe(createHash("sha256").update(python).digest("hex").slice(0, 12));
    expect(validarCorpoGoogle(JSON.stringify({ client_id: "abc", client_secret: SECRET })).ok).toBe(false);
    expect(validarCorpoGoogle(JSON.stringify({ client_id: ID, client_secret: "x" })).ok).toBe(false);
    expect(validarCorpoGoogle("[1]").ok).toBe(false);
  });
});

describe("cifra do refresh_token", () => {
  it("cifra e decifra; formato y1; segredo errado e adulteração falham", async () => {
    const c = await cifrarTokenYt("1//0refresh-token-de-teste", SEGREDO);
    expect(c.startsWith("y1.")).toBe(true);
    expect(c).not.toContain("refresh");
    expect(await decifrarTokenYt(c, SEGREDO)).toBe("1//0refresh-token-de-teste");
    await expect(decifrarTokenYt(c, SEGREDO + "x")).rejects.toThrow();
    const [p, iv, ct] = c.split(".");
    await expect(decifrarTokenYt(`${p}.${iv}.${ct.slice(0, -2)}AA`, SEGREDO)).rejects.toThrow();
    await expect(cifrarTokenYt("t", "curto")).rejects.toThrow();
  });

  it("contexto separado da chave RTMP: o decifrador das chaves não abre o token", async () => {
    const c = await cifrarTokenYt("token", SEGREDO);
    await expect(decifrarChave(c.replace(/^y1\./, "v1."), SEGREDO)).rejects.toThrow();
  });
});

describe("transmissão", () => {
  it("destino: título padrão da sala, privacidade validada, sem < >", () => {
    const v = validarDestinoYt({ titulo: "", privacidade: "public" }, "Live <b>de</b> sábado");
    expect(v).toEqual({ ok: true, cfg: { titulo: "Live bde/b sábado", descricao: "", privacidade: "public" } });
    expect(validarDestinoYt({ titulo: "x", privacidade: "secreta" }, "s").ok).toBe(false);
    const padrao = validarDestinoYt({ titulo: "a".repeat(200) }, "s");
    expect(padrao.ok && padrao.cfg.titulo.length).toBe(100);
    expect(padrao.ok && padrao.cfg.privacidade).toBe("unlisted");
  });

  it("broadcast agendado agora, auto start/stop, sem monitor stream", () => {
    const agora = new Date("2026-10-17T21:00:00Z");
    const b = corpoBroadcast({ titulo: "T", descricao: "D", privacidade: "private" }, agora);
    expect(b.snippet).toEqual({ title: "T", description: "D", scheduledStartTime: "2026-10-17T21:00:00.000Z" });
    expect(b.status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false });
    expect(b.contentDetails).toMatchObject({ enableAutoStart: true, enableAutoStop: true, monitorStream: { enableMonitorStream: false } });
  });

  it("stream RTMP reutilizável com resolução e fps variáveis (o par exigido)", () => {
    expect(corpoStream("Estúdio").cdn).toEqual({ ingestionType: "rtmp", resolution: "variable", frameRate: "variable" });
    expect(corpoStream("Estúdio").contentDetails.isReusable).toBe(true);
  });

  it("ingestão: RTMPS primeiro, RTMP de reserva, nada sem streamName", () => {
    const s = { cdn: { ingestionInfo: { streamName: "abcd-1234", ingestionAddress: "rtmp://a.rtmp.youtube.com/live2", rtmpsIngestionAddress: "rtmps://a.rtmps.youtube.com/live2" } } };
    expect(ingestaoDoStream(s)).toEqual({ servidor: "rtmps://a.rtmps.youtube.com/live2", chave: "abcd-1234" });
    expect(ingestaoDoStream({ cdn: { ingestionInfo: { streamName: "k", ingestionAddress: "rtmp://a/live2" } } })).toEqual({ servidor: "rtmp://a/live2", chave: "k" });
    expect(ingestaoDoStream({ cdn: { ingestionInfo: { ingestionAddress: "rtmp://a/live2" } } })).toBeNull();
    expect(ingestaoDoStream(null)).toBeNull();
  });

  it("transição pra live só com stream ativo e broadcast parado em ready/testing", () => {
    expect(precisaTransicionarLive("active", "ready")).toBe(true);
    expect(precisaTransicionarLive("active", "testing")).toBe(true);
    expect(precisaTransicionarLive("active", "live")).toBe(false);
    expect(precisaTransicionarLive("active", "complete")).toBe(false);
    expect(precisaTransicionarLive("inactive", "ready")).toBe(false);
    expect(precisaTransicionarLive(undefined, "ready")).toBe(false);
    expect(estadoDoBroadcast("liveStarting")).toBe("ao_vivo");
    expect(estadoDoBroadcast("complete")).toBe("encerrado");
    expect(estadoDoBroadcast("ready")).toBe("preparando");
    expect(estadoDoBroadcast(undefined)).toBe("erro");
  });
});

type Chamada = { url: string; init?: RequestInit };
function fetchFalso(respostas: { status: number; corpo: unknown }[]) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift() ?? { status: 500, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { f, chamadas };
}

describe("client secret do app (fetch falso)", () => {
  const OUTRO = "GOCSPX-OutroSegredoDoBanco000000";
  const banco = JSON.stringify({ client_id: ID, client_secret: OUTRO });

  it("candidatos: env e depois banco, sem repetir o mesmo par", () => {
    expect(candidatosCredGoogle({ id: ID, secret: SECRET }, banco).map((c) => c.fonte)).toEqual(["env", "banco"]);
    expect(candidatosCredGoogle({ id: ID, secret: SECRET }, JSON.stringify({ client_id: ID, client_secret: SECRET })).map((c) => c.fonte)).toEqual(["env"]);
    expect(candidatosCredGoogle({}, banco).map((c) => c.fonte)).toEqual(["banco"]);
    expect(candidatosCredGoogle({ id: ID }, null)).toEqual([]);
  });

  it("conferir secret: invalid_grant = aceito, invalid_client = errado, outra coisa = não medido", async () => {
    const cred = { clientId: ID, clientSecret: SECRET };
    const um = (status: number, corpo: unknown) => fetchFalso([{ status, corpo }]).f;
    expect(await conferirSegredoGoogle(cred, "https://r", um(400, { error: "invalid_grant", error_description: "Malformed auth code." }))).toBe("ok");
    expect(await conferirSegredoGoogle(cred, "https://r", um(401, { error: "invalid_client", error_description: "The provided client secret is invalid." }))).toBe("invalido");
    expect(await conferirSegredoGoogle(cred, "https://r", um(500, {}))).toBe("nao_medido");
  });

  it("secret do env errado: cai no par do banco e troca o code; secret do app errado não desconecta a conta", async () => {
    const cands = candidatosCredGoogle({ id: ID, secret: SECRET }, banco);
    const { f, chamadas } = fetchFalso([
      { status: 401, corpo: { error: "invalid_client", error_description: "The provided client secret is invalid." } },
      { status: 200, corpo: { access_token: "ya29.x", refresh_token: "1//r", expires_in: 3599, scope: ESCOPO_YT } },
    ]);
    const r = await comCredencial(cands, (cred) => ClienteYouTube.trocarCode(cred, "4/code", "https://r", f));
    expect(r.fonte).toBe("banco");
    expect(r.valor.accessToken).toBe("ya29.x");
    expect(new URLSearchParams(String(chamadas[1].init?.body)).get("client_secret")).toBe(OUTRO);

    const { f: f2 } = fetchFalso([
      { status: 401, corpo: { error: "invalid_client", error_description: "x" } },
      { status: 401, corpo: { error: "invalid_client", error_description: "x" } },
    ]);
    const e = await comCredencial(cands, (cred) => ClienteYouTube.renovar(cred, "1//r", f2)).catch((x) => x);
    expect(e.razao).toBe("invalid_client");
    expect(e.precisaReconectar).toBe(false);
  });

  it("code/token recusado (invalid_grant) não tenta a outra credencial", async () => {
    const cands = candidatosCredGoogle({ id: ID, secret: SECRET }, banco);
    const { f, chamadas } = fetchFalso([{ status: 400, corpo: { error: "invalid_grant", error_description: "Bad Request" } }]);
    const e = await comCredencial(cands, (cred) => ClienteYouTube.trocarCode(cred, "4/code", "https://r", f)).catch((x) => x);
    expect(e.razao).toBe("invalid_grant");
    expect(chamadas).toHaveLength(1);
  });
});

describe("cliente HTTP (fetch falso)", () => {
  it("troca o code no servidor com client_secret no corpo (nunca na URL)", async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, corpo: { access_token: "ya29.x", refresh_token: "1//r", expires_in: 3599, scope: ESCOPO_YT } }]);
    const t = await ClienteYouTube.trocarCode({ clientId: ID, clientSecret: SECRET }, "4/code", "https://r", f);
    expect(t).toMatchObject({ accessToken: "ya29.x", refreshToken: "1//r", escopos: [ESCOPO_YT] });
    expect(chamadas[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(chamadas[0].url).not.toContain(SECRET);
    const corpo = new URLSearchParams(String(chamadas[0].init?.body));
    expect(corpo.get("grant_type")).toBe("authorization_code");
    expect(corpo.get("client_secret")).toBe(SECRET);
    expect(corpo.get("redirect_uri")).toBe("https://r");
  });

  it("refresh_token revogado vira invalid_grant -> precisa reconectar", async () => {
    const { f } = fetchFalso([{ status: 400, corpo: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
    const e = await ClienteYouTube.renovar({ clientId: ID, clientSecret: SECRET }, "1//r", f).catch((x) => x);
    expect(e.razao).toBe("invalid_grant");
    expect(e.precisaReconectar).toBe(true);
  });

  it("broadcast, bind e transição: endpoints, part e Bearer", async () => {
    const { f, chamadas } = fetchFalso([
      { status: 200, corpo: { id: "VID123" } },
      { status: 200, corpo: { id: "VID123" } },
      { status: 200, corpo: { id: "VID123", status: { lifeCycleStatus: "liveStarting" } } },
    ]);
    const cli = new ClienteYouTube("ya29.tok", f);
    await cli.inserirBroadcast({ titulo: "T", descricao: "", privacidade: "unlisted" }, new Date("2026-10-17T21:00:00Z"));
    await cli.vincular("VID123", "STREAM1");
    await cli.transicionar("VID123", "live");
    const u0 = new URL(chamadas[0].url);
    expect(u0.pathname).toBe("/youtube/v3/liveBroadcasts");
    expect(u0.searchParams.get("part")).toBe("id,snippet,contentDetails,status");
    expect((chamadas[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.tok");
    expect(JSON.parse(String(chamadas[0].init?.body)).status.privacyStatus).toBe("unlisted");
    const u1 = new URL(chamadas[1].url);
    expect(u1.pathname).toBe("/youtube/v3/liveBroadcasts/bind");
    expect(u1.searchParams.get("streamId")).toBe("STREAM1");
    const u2 = new URL(chamadas[2].url);
    expect(u2.pathname).toBe("/youtube/v3/liveBroadcasts/transition");
    expect(u2.searchParams.get("broadcastStatus")).toBe("live");
  });

  it("erro da API: razão do Google e mensagem sem URL RTMP", () => {
    const e = erroDoGoogle(403, { error: { message: "falhou em rtmps://a.rtmps.youtube.com/live2/CHAVE", errors: [{ reason: "redundantTransition" }] } });
    expect(e.razao).toBe("redundantTransition");
    expect(e.message).not.toContain("CHAVE");
    expect(e.precisaReconectar).toBe(false);
  });

  it("canal: id, título e foto do channels.list mine", async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, corpo: { items: [{ id: "UC1", snippet: { title: "Canal BX", thumbnails: { default: { url: "https://yt3/f.jpg" } } } }] } }]);
    expect(await new ClienteYouTube("t", f).canal()).toEqual({ id: "UC1", titulo: "Canal BX", foto: "https://yt3/f.jpg" });
    expect(new URL(chamadas[0].url).searchParams.get("mine")).toBe("true");
  });
});

describe("tela", () => {
  const d = (x: Partial<LiveDestino>): LiveDestino => ({ id: "d", tipo: "youtube", nome: "Y", rtmp_url: "rtmps://a", chave_final: "••••abcd", ativo: true, no_ar: false, ...x });

  it("mensagem do popup: só da mesma origem e no formato certo", () => {
    expect(lerMensagemOauth({ origin: "https://equipe.brenoxavier.com.br", data: { tipo: "youtube-oauth", status: "ok", motivo: "Canal" } }, "https://equipe.brenoxavier.com.br"))
      .toEqual({ tipo: "youtube-oauth", status: "ok", motivo: "Canal" });
    expect(lerMensagemOauth({ origin: "https://mal.com", data: { tipo: "youtube-oauth", status: "ok" } }, "https://equipe.brenoxavier.com.br")).toBeNull();
    expect(lerMensagemOauth({ origin: "https://e", data: { tipo: "outro", status: "ok" } }, "https://e")).toBeNull();
  });

  it("conferência periódica só ao vivo, com destino conectado no ar ainda não ao vivo", () => {
    expect(precisaConferirYt("ao_vivo", [d({ modo: "youtube_api", no_ar: true, yt_estado: "preparando" })])).toBe(true);
    expect(precisaConferirYt("ao_vivo", [d({ modo: "youtube_api", no_ar: true, yt_estado: "ao_vivo" })])).toBe(false);
    expect(precisaConferirYt("ao_vivo", [d({ modo: "manual", no_ar: true })])).toBe(false);
    expect(precisaConferirYt("rascunho", [d({ modo: "youtube_api", no_ar: true })])).toBe(false);
  });

  it("detalhe do destino: conectado mostra privacidade/estado; manual mostra só o final da chave", () => {
    expect(detalheDestino(d({ modo: "youtube_api", yt_privacidade: "public", yt_estado: "ao_vivo" }))).toBe("YouTube conectado · Público · ao vivo no YouTube");
    expect(detalheDestino(d({}))).toBe("YouTube · chave ••••abcd");
    expect(textoEstadoYt({ yt_estado: "preparando", yt_erro: "quota", no_ar: true })).toBe("erro: quota");
  });
});
