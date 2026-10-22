// Webhook da PagTrust do teste /r/desafio, numa URL SEM chave.
//
// POR QUE EXISTE
// O receptor é a RPC de nome aleatório do PostgREST (migration
// 20261013180000_pagtrust_webhook_rotator_sem_edge.sql). Chamada direto, ela
// exige ?apikey=<chave> na URL, e quem cadastra o webhook no formulário da
// PagTrust não digita chave em formulário. Esta Pages Function recebe em
// https://equipe.brenoxavier.com.br/api/pagtrust/<nome da RPC>
// e repassa o corpo tal qual para a RPC, pondo a chave ela mesma.
//
// O SEGREDO NÃO ESTÁ NO GIT
// O pedaço final do caminho é o próprio nome da RPC. Aqui fica só o SHA-256
// dele: caminho cujo hash não bate devolve 404, então isto não vira proxy
// genérico para o PostgREST. Trocar o nome da RPC = trocar o hash abaixo.
//
// A chave abaixo é a anon/publishable do projeto (role "anon"), a mesma que
// já vai pública no bundle do site. Não dá acesso a nada além do que o anon
// já tem. Se existir VITE_SUPABASE_PUBLISHABLE_KEY no ambiente do Pages, ela
// vence.
//
// Só POST, corpo até 256 KB. Qualquer outro método ou caminho: 404.

const SUPABASE_URL = "https://SEU_PROJECT_REF.supabase.co";
const ANON_KEY_PUBLICA =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IlNFVV9QUk9KRUNUX1JFRiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzczMDA2MzkxLCJleHAiOjIwODg1ODIzOTF9.ASSINATURA_FICTICIA_troque_pela_sua_anon_key";
const SHA256_DO_NOME_DA_RPC = "351e970060fd642fa4ededd9f0573dbc0c36f6db64068b68d857198b00cc18e8";
export const LIMITE_CORPO = 256 * 1024;

type Contexto = {
  request: Request;
  params: Record<string, string | string[]>;
  env?: Record<string, unknown>;
};

const naoEncontrado = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Lê o corpo com teto, sem confiar só no Content-Length (pode vir chunked).
async function lerCorpoComLimite(request: Request, limite: number): Promise<Uint8Array | null> {
  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > limite) return null;
  if (!request.body) return new Uint8Array(0);
  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    pedacos.push(value);
  }
  const corpo = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    corpo.set(p, pos);
    pos += p.byteLength;
  }
  return corpo;
}

export async function onRequest(ctx: Contexto): Promise<Response> {
  const { request, params } = ctx;
  const segredo = Array.isArray(params.segredo) ? params.segredo.join("/") : params.segredo;
  if (request.method !== "POST" || typeof segredo !== "string" || !/^wh[0-9a-f]{32}$/.test(segredo)) {
    return naoEncontrado();
  }
  if ((await sha256Hex(segredo)) !== SHA256_DO_NOME_DA_RPC) return naoEncontrado();

  const corpo = await lerCorpoComLimite(request, LIMITE_CORPO);
  if (corpo === null) {
    return new Response("Payload too large", { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const envKey = ctx.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  const chave = typeof envKey === "string" && envKey.length > 0 ? envKey : ANON_KEY_PUBLICA;

  let resp: Response;
  try {
    resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${segredo}`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: corpo as unknown as BodyInit,
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, erro: "receptor indisponivel" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(await resp.text(), {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
