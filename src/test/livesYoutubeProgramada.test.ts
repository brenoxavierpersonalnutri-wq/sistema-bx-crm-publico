// Live programada no YouTube: pedidos à API (fetch falso, nada sai pra rede) e o ciclo no banco (banco falso).
//  - programar: stream SÓ da live (isReusable=false), broadcast com a data, bind, miniatura e playlist;
//  - reprogramar ainda não começada: atualiza o mesmo broadcast (mesmo link);
//  - Ir ao vivo / tick: reaproveita o broadcast programado (não cria outro);
//  - miniatura recusada vira aviso, não derruba a programação.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClienteYouTube, corpoAtualizarBroadcast, corpoBroadcast, corpoItemPlaylist, corpoStream, linkCurtoYoutube, cifrarTokenYt,
} from "../../supabase/functions/_shared/youtube";
import { cifrarChave } from "../../supabase/functions/_shared/liveCrypto";
// youtubeDb usa Deno e esm.sh: importado em tempo de execução (com Deno falso) para o tsc do front não seguir o arquivo
const CAMINHO_YT_DB = "../../supabase/functions/_shared/youtubeDb";
type FnDb = (...a: any[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let cancelarProgramacaoYt: FnDb, prepararDestinoYt: FnDb, programarDestinoYt: FnDb;

const SEGREDO = "segredo-de-teste-das-lives-0123456789abcdef";
const QUANDO = new Date("2026-11-10T22:00:00.000Z");
const CFG = { titulo: "Aula 3", descricao: "desc", privacidade: "unlisted" as const };

type Chamada = { metodo: string; url: URL; corpo: unknown; tipo: string | null };

function googleFalso(o: { ciclo?: string; miniatura403?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const f = vi.fn(async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? "GET";
    const tipo = (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? null;
    let corpo: unknown = init?.body;
    if (typeof corpo === "string") {
      try { corpo = JSON.parse(corpo); } catch { /* form */ }
    }
    chamadas.push({ metodo, url, corpo, tipo });
    const r = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
    if (url.hostname === "oauth2.googleapis.com") return r({ access_token: "at", expires_in: 3600 });
    const p = url.pathname;
    if (p.endsWith("/liveStreams") && metodo === "POST") return r({ id: "STREAM_NOVO", cdn: { ingestionInfo: { streamName: "chave-secreta-1234", rtmpsIngestionAddress: "rtmps://a.rtmps.youtube.com/live2" } } });
    if (p.endsWith("/liveBroadcasts") && metodo === "POST") return r({ id: "BCAST1" });
    if (p.endsWith("/liveBroadcasts") && metodo === "PUT") return r({ id: (corpo as { id: string }).id });
    if (p.endsWith("/liveBroadcasts") && metodo === "GET") return r({ items: [{ id: url.searchParams.get("id"), status: { lifeCycleStatus: o.ciclo ?? "ready" } }] });
    if (p.endsWith("/liveBroadcasts") && metodo === "DELETE") return new Response(null, { status: 204 });
    if (p.endsWith("/liveBroadcasts/bind")) return r({ id: "BCAST1" });
    if (p.endsWith("/thumbnails/set")) return o.miniatura403 ? r({ error: { message: "The authenticated user doesnt have permissions to upload and set custom video thumbnails.", errors: [{ reason: "forbidden" }] } }, 403) : r({ items: [] });
    if (p.endsWith("/playlistItems")) return r({ id: "PLI1" });
    if (p.endsWith("/playlists")) return r({ items: [{ id: "PL123", snippet: { title: "Aulas" } }] });
    return r({ error: { message: `rota não prevista ${metodo} ${p}` } }, 500);
  });
  return { f, chamadas };
}

/** Banco falso: só o que youtubeDb usa (yt_contas, integracao_config, live_destinations). */
function bancoFalso(conta: Record<string, unknown>) {
  const updates: { tabela: string; patch: Record<string, unknown> }[] = [];
  const db = {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: tabela === "yt_contas" ? conta : null, error: null }),
        update: (patch: Record<string, unknown>) => {
          updates.push({ tabela, patch });
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
  };
  return { db: db as never, updates };
}

let fetchOriginal: typeof fetch;
beforeEach(async () => {
  fetchOriginal = globalThis.fetch;
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => ({ GOOGLE_CLIENT_ID: "1-x.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "GOCSPX-segredo-de-teste-123" } as Record<string, string>)[k] },
  };
  ({ cancelarProgramacaoYt, prepararDestinoYt, programarDestinoYt } = await import(/* @vite-ignore */ CAMINHO_YT_DB));
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete (globalThis as unknown as { Deno?: unknown }).Deno;
});

async function conta() {
  return { id: "c1", titulo: "Canal", status: "conectado", stream_id: "STREAM_COMPARTILHADO", refresh_token_cifrado: await cifrarTokenYt("rt", SEGREDO) };
}

describe("corpos da API", () => {
  it("broadcast agendado: data escolhida, auto start/stop, sem monitor stream", () => {
    const b = corpoBroadcast(CFG, QUANDO);
    expect(b.snippet.scheduledStartTime).toBe("2026-11-10T22:00:00.000Z");
    expect(b.status.privacyStatus).toBe("unlisted");
    expect(b.contentDetails).toMatchObject({ enableAutoStart: true, enableAutoStop: true, monitorStream: { enableMonitorStream: false } });
  });
  it("stream da live programada não é reutilizável (o do Ir ao vivo é)", () => {
    expect(corpoStream("x", false).contentDetails.isReusable).toBe(false);
    expect(corpoStream("x").contentDetails.isReusable).toBe(true);
  });
  it("update e playlist", () => {
    expect(corpoAtualizarBroadcast("B", CFG, QUANDO)).toEqual({
      id: "B", snippet: { title: "Aula 3", description: "desc", scheduledStartTime: QUANDO.toISOString() },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    expect(corpoItemPlaylist("PL", "V")).toEqual({ snippet: { playlistId: "PL", resourceId: { kind: "youtube#video", videoId: "V" } } });
    expect(linkCurtoYoutube("BCAST1")).toBe("https://youtu.be/BCAST1");
  });
  it("miniatura vai pro endpoint de upload com o tipo da imagem", async () => {
    const g = googleFalso();
    await new ClienteYouTube("at", g.f as unknown as typeof fetch).definirMiniatura("V1", new Uint8Array([1, 2, 3]), "image/png");
    const c = g.chamadas[0];
    expect(c.url.toString()).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/thumbnails\/set\?videoId=V1/);
    expect(c.tipo).toBe("image/png");
  });
  it("playlists do canal", async () => {
    const g = googleFalso();
    expect(await new ClienteYouTube("at", g.f as unknown as typeof fetch).playlists()).toEqual([{ id: "PL123", titulo: "Aulas" }]);
    expect(g.chamadas[0].url.searchParams.get("mine")).toBe("true");
  });
});

describe("programarDestinoYt", () => {
  it("cria stream só dela + broadcast com a data + bind + miniatura + playlist, e guarda a chave cifrada", async () => {
    const g = googleFalso();
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db, updates } = bancoFalso(await conta());
    const r = await programarDestinoYt(db, { id: "d1", room_id: "s1", yt_conta_id: "c1", yt_titulo: "Aula 3", yt_privacidade: "unlisted", nome: "YouTube · Canal" }, SEGREDO, QUANDO, {
      miniatura: { bytes: new Uint8Array([1]), mime: "image/jpeg" }, playlistId: "PL123",
    });
    expect(r).toMatchObject({ video_id: "BCAST1", link: "https://youtu.be/BCAST1", avisos: [] });
    const api = g.chamadas.filter((c) => c.url.hostname === "www.googleapis.com").map((c) => `${c.metodo} ${c.url.pathname.replace(/.*\/v3\//, "")}`);
    expect(api).toEqual(["POST liveStreams", "POST liveBroadcasts", "POST liveBroadcasts/bind", "POST thumbnails/set", "POST playlistItems"]);
    const stream = g.chamadas.find((c) => c.url.pathname.endsWith("/liveStreams"))!;
    expect((stream.corpo as { contentDetails: { isReusable: boolean } }).contentDetails.isReusable).toBe(false);
    const bind = g.chamadas.find((c) => c.url.pathname.endsWith("/bind"))!;
    expect(bind.url.searchParams.get("streamId")).toBe("STREAM_NOVO");
    const patch = updates.find((u) => u.tabela === "live_destinations")!.patch;
    expect(patch).toMatchObject({ yt_broadcast_id: "BCAST1", yt_stream_id: "STREAM_NOVO", yt_estado: "agendado", yt_agendado_para: QUANDO.toISOString(), yt_playlist_id: "PL123", yt_miniatura_ok: true });
    expect(String(patch.chave_cifrada)).toMatch(/^v1\./);
    expect(JSON.stringify(patch)).not.toContain("chave-secreta-1234");
  });

  it("já programada e não começou: atualiza o mesmo broadcast (mesmo link), sem stream novo", async () => {
    const g = googleFalso({ ciclo: "ready" });
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db } = bancoFalso(await conta());
    const r = await programarDestinoYt(db, { id: "d1", room_id: "s1", yt_conta_id: "c1", yt_estado: "agendado", yt_broadcast_id: "BCAST0", yt_playlist_id: "PL123" }, SEGREDO, QUANDO, { playlistId: "PL123" });
    expect(r.video_id).toBe("BCAST0");
    const api = g.chamadas.filter((c) => c.url.hostname === "www.googleapis.com").map((c) => c.metodo + " " + c.url.pathname.split("/v3/")[1]);
    expect(api).toEqual(["GET liveBroadcasts", "PUT liveBroadcasts"]); // nem stream, nem playlist de novo
  });

  it("miniatura recusada (canal sem verificação): aviso, a live continua programada", async () => {
    const g = googleFalso({ miniatura403: true });
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db } = bancoFalso(await conta());
    const r = await programarDestinoYt(db, { id: "d1", room_id: "s1", yt_conta_id: "c1" }, SEGREDO, QUANDO, { miniatura: { bytes: new Uint8Array([1]), mime: "image/png" } });
    expect(r.link).toBe("https://youtu.be/BCAST1");
    expect(r.avisos[0]).toMatch(/miniatura recusada/);
  });

  it("cancelar apaga o broadcast programado e limpa o destino", async () => {
    const g = googleFalso();
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db, updates } = bancoFalso(await conta());
    expect(await cancelarProgramacaoYt(db, { id: "d1", room_id: "s1", yt_conta_id: "c1", yt_estado: "agendado", yt_broadcast_id: "BCAST1" }, SEGREDO)).toBeNull();
    expect(g.chamadas.some((c) => c.metodo === "DELETE" && c.url.searchParams.get("id") === "BCAST1")).toBe(true);
    expect(updates.at(-1)!.patch).toMatchObject({ yt_broadcast_id: null, yt_agendado_para: null });
  });
});

describe("Ir ao vivo com live programada", () => {
  it("reaproveita o broadcast programado (o link divulgado é o que entra no ar)", async () => {
    const g = googleFalso({ ciclo: "ready" });
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db, updates } = bancoFalso(await conta());
    const url = await prepararDestinoYt(db, {
      id: "d1", room_id: "s1", yt_conta_id: "c1", yt_estado: "agendado", yt_broadcast_id: "BCAST1", yt_stream_id: "STREAM_NOVO",
      rtmp_url: "rtmps://a.rtmps.youtube.com/live2", chave_cifrada: await cifrarChave("chave-secreta-1234", SEGREDO),
    }, SEGREDO);
    expect(url).toBe("rtmps://a.rtmps.youtube.com/live2/chave-secreta-1234");
    expect(g.chamadas.some((c) => c.metodo === "POST" && c.url.pathname.endsWith("/liveBroadcasts"))).toBe(false);
    expect(updates.at(-1)!.patch).toMatchObject({ yt_estado: "preparando" });
  });

  it("programada já encerrada/apagada no YouTube: cria uma transmissão nova (comportamento antigo)", async () => {
    const g = googleFalso({ ciclo: "complete" });
    globalThis.fetch = g.f as unknown as typeof fetch;
    const { db } = bancoFalso(await conta());
    await prepararDestinoYt(db, {
      id: "d1", room_id: "s1", yt_conta_id: "c1", yt_estado: "agendado", yt_broadcast_id: "BCAST1", yt_stream_id: "S",
      rtmp_url: "rtmps://x/live2", chave_cifrada: await cifrarChave("k", SEGREDO),
    }, SEGREDO);
    expect(g.chamadas.some((c) => c.metodo === "POST" && c.url.pathname.endsWith("/liveBroadcasts"))).toBe(true);
  });
});
