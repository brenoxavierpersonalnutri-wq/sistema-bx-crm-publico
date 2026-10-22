// Saídas do Egress (várias URLs RTMP num único RoomComposite) sem dependência de Deno: roda igual
// na edge function e no vitest.
//
//  - montarSaidas: dos destinos ligados e do resultado de cada preparo (Promise.allSettled), separa as
//    URLs que entram no Egress das falhas. Um destino que falhou não derruba os outros.
//  - redigirUrlRtmp: a mesma redação que o LiveKit aplica em StreamInfo.url (protocol/utils/redact.go):
//    "rtmps://host/app/{abc...xyz}". É assim que o webhook descobre QUAL destino caiu sem o LiveKit
//    devolver a chave.
//  - falhasDoEgress: casa os streamResults FAILED do webhook com os destinos da sala.
//  - limparMotivo: tira URL rtmp e a própria chave de qualquer mensagem antes de gravar/mostrar.
// A URL completa (com chave) existe só na memória da função; nada aqui loga.

export interface DestinoSaida {
  id: string;
  nome: string;
}

export interface FalhaSaida {
  id: string;
  nome: string;
  motivo: string;
}

const RE_RTMP = /rtmps?:\/\/[^\s"']+/gi;

/** Mensagem segura: sem URL rtmp, sem os segredos informados, no máximo 240 caracteres. */
export function limparMotivo(msg: unknown, segredos: string[] = []): string {
  let s = typeof msg === "string" ? msg : msg instanceof Error ? msg.message : JSON.stringify(msg ?? "");
  s = s.replace(RE_RTMP, "rtmp://[oculto]");
  for (const seg of segredos) if (seg && seg.length >= 4) s = s.split(seg).join("[oculto]");
  return s.replace(/^"|"$/g, "").slice(0, 240) || "falhou";
}

/** Separa o que entra no Egress (urls, na ordem dos destinos) do que falhou ao preparar. */
export function montarSaidas<D extends DestinoSaida>(
  dests: D[],
  preparos: PromiseSettledResult<string>[],
): { urls: string[]; okIds: string[]; falhas: FalhaSaida[] } {
  const urls: string[] = [];
  const okIds: string[] = [];
  const falhas: FalhaSaida[] = [];
  const vistas = new Set<string>();
  dests.forEach((d, i) => {
    const p = preparos[i];
    if (!p) {
      falhas.push({ id: d.id, nome: d.nome, motivo: "não preparado" });
    } else if (p.status === "fulfilled") {
      // o LiveKit recusa o Egress inteiro com URL repetida ("duplicate stream url")
      if (vistas.has(p.value)) {
        falhas.push({ id: d.id, nome: d.nome, motivo: "mesma chave de outro destino ligado" });
        return;
      }
      vistas.add(p.value);
      urls.push(p.value);
      okIds.push(d.id);
    } else {
      falhas.push({ id: d.id, nome: d.nome, motivo: limparMotivo(p.reason) });
    }
  });
  return { urls, okIds, falhas };
}

// rtmp(s)://{host}(/{path})/{app}/{stream_key}( live=1) — igual ao rtmpRegexp do LiveKit
const RE_REDACAO = /^(rtmps?:\/\/)(.*\/)(.*\/)(\S*)( live=1)?$/;

function redigirIdentificador(id: string): string {
  let pre = "";
  let suf = "";
  for (let i = 3; i > 0; i--) {
    if (id.length >= i * 3) {
      pre = id.slice(0, i);
      suf = id.slice(id.length - i);
      break;
    }
  }
  return `{${pre}...${suf}}`;
}

/** Mesma saída do RedactStreamKey do LiveKit para URLs rtmp(s). null se não casar com o formato. */
export function redigirUrlRtmp(url: string): string | null {
  const m = RE_REDACAO.exec(url);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}${redigirIdentificador(m[4])}${m[5] ?? ""}`;
}

/** Tudo até a última barra: servidor+app, sem a chave. */
const prefixoSemChave = (url: string) => url.slice(0, url.lastIndexOf("/") + 1);

export interface StreamResultado {
  url?: string;
  status?: string | number;
  error?: string;
}

/** StreamInfo.Status: ACTIVE=0, FINISHED=1, FAILED=2 (protojson manda o nome; JSON cru, o número). */
const falhou = (s: StreamResultado) => s.status === "FAILED" || s.status === 2;

/**
 * Destinos (com a URL completa, só em memória) cujo stream o Egress marcou FAILED.
 * Casa primeiro pela URL redigida; se o LiveKit da VPS redigir diferente, cai no servidor+app
 * quando só UM destino usa aquele servidor (dois no mesmo servidor sem casar exato: não chuta).
 */
export function falhasDoEgress(
  resultados: StreamResultado[] | undefined | null,
  destinos: { id: string; nome: string; url: string }[],
): FalhaSaida[] {
  const out: FalhaSaida[] = [];
  const usados = new Set<string>();
  for (const s of resultados ?? []) {
    if (!falhou(s) || typeof s.url !== "string") continue;
    let alvo = destinos.find((d) => !usados.has(d.id) && (redigirUrlRtmp(d.url) === s.url || d.url === s.url));
    if (!alvo) {
      const pre = prefixoSemChave(s.url);
      const mesmos = destinos.filter((d) => !usados.has(d.id) && prefixoSemChave(d.url) === pre);
      if (mesmos.length === 1) alvo = mesmos[0];
    }
    if (!alvo) continue;
    usados.add(alvo.id);
    const chave = alvo.url.slice(alvo.url.lastIndexOf("/") + 1);
    out.push({ id: alvo.id, nome: alvo.nome, motivo: limparMotivo(s.error || "a plataforma recusou o vídeo", [chave]) });
  }
  return out;
}

/** Texto para o painel quando a plataforma derruba a saída no meio da live. */
export function textoFalhaSaida(motivo: string, tipo?: string): string {
  const dica = tipo === "instagram"
    ? " (a chave do Instagram vale para uma live só: gere outra em instagram.com > Criar > Ao vivo)"
    : "";
  return `${motivo}${dica}`.slice(0, 300);
}
