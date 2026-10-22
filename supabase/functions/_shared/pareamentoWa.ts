// Lógica pura do pareamento CRM <-> VPS (sem Deno, sem rede): roda no Deno e no vitest
// (src/test/pareamentoWa.test.ts).
//
// O pareamento entrega à VPS, UMA vez, os dois segredos que o CRM usa com ela
// (WA_PROXY_SECRET e OPENWA_WEBHOOK_SECRET), sem ninguém copiar e colar valor.
// Três travas, todas obrigatórias:
//   1. janela: só até `abertoAte` (a migration abre 30 min; reabrir é um UPDATE no SQL);
//   2. uso único: depois de entregue, `pareadoEm` fica gravado e a resposta é 410 para sempre;
//   3. origem: o `cf-connecting-ip` tem de ser o IP da VPS.
//
// A trava 3 decide SÓ por `cf-connecting-ip`. A Cloudflare na frente da Supabase SOBRESCREVE
// esse cabeçalho com o IP de quem abriu a conexão com ela: o cliente não consegue forjá-lo.
// `x-forwarded-for` / `x-real-ip` / `x-envoy-external-address` NÃO entram na decisão (vão só
// pro log): o cliente escreve o que quiser no XFF e a infraestrutura da Supabase ainda
// acrescenta saltos próprios (ex.: um IP da AWS no fim), o que fazia a regra antiga
// ("todo IP público tem de ser o da VPS") recusar a própria VPS (403 em 17/10/2026).
// Sem `cf-connecting-ip`, ou com valor ilegível, a função recusa (403), nunca libera.
// As travas 1 e 2 limitam o estrago de um erro aqui.

export const IP_VPS = "203.0.113.10";
export const CABECALHOS_IP = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for", "x-envoy-external-address"] as const;

// Faixas publicadas pela Cloudflare (https://www.cloudflare.com/ips-v4 e ips-v6).
const CF_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CF_V6_PREFIXOS = ["2400:cb00:", "2606:4700:", "2803:f800:", "2405:b500:", "2405:8100:", "2a06:98c", "2c0f:f248:"];

function v4ParaNumero(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function naFaixaV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const a = v4ParaNumero(ip), b = v4ParaNumero(base);
  if (a === null || b === null) return false;
  const n = Number(bits);
  const mascara = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return ((a & mascara) >>> 0) === ((b & mascara) >>> 0);
}

/** Tira porta, colchetes e o prefixo ::ffff: de IPv4 mapeado em IPv6. */
export function normalizarIp(bruto: string): string | null {
  let s = bruto.trim().toLowerCase();
  if (!s) return null;
  const colchete = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (colchete) s = colchete[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
  if (s.startsWith("::ffff:") && v4ParaNumero(s.slice(7)) !== null) s = s.slice(7);
  if (v4ParaNumero(s) !== null) return s;
  if (/^[0-9a-f:]+$/.test(s) && s.includes(":")) return s;
  return null;
}

/** Interno/privado/loopback: salto da própria infraestrutura, não diz nada sobre o cliente. */
export function ipInterno(ip: string): boolean {
  if (v4ParaNumero(ip) !== null) {
    return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10", "0.0.0.0/8"]
      .some((c) => naFaixaV4(ip, c));
  }
  return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
}

export function ipCloudflare(ip: string): boolean {
  if (v4ParaNumero(ip) !== null) return CF_V4.some((c) => naFaixaV4(ip, c));
  return CF_V6_PREFIXOS.some((p) => ip.startsWith(p));
}

/**
 * Diz se a chamada veio do IP permitido, olhando SÓ `cf-connecting-ip`.
 * `vistos` volta sempre com todos os cabeçalhos de IP (pro log de diagnóstico; IP não é segredo),
 * e o primeiro item, quando existe, é sempre o `cf-connecting-ip`.
 */
export function origemPermitida(
  ler: (nome: string) => string | null | undefined,
  permitido: string = IP_VPS,
): { ok: boolean; motivo: string; vistos: string[] } {
  const vistos: string[] = [];
  for (const nome of CABECALHOS_IP) {
    const valor = ler(nome);
    if (!valor) continue;
    for (const parte of String(valor).split(",")) {
      const ip = normalizarIp(parte);
      if (ip) vistos.push(`${nome}=${ip}`);
      else if (parte.trim()) vistos.push(`${nome}=ilegivel`);
    }
  }
  const bruto = ler("cf-connecting-ip");
  if (!bruto || !String(bruto).trim()) return { ok: false, motivo: "sem cf-connecting-ip", vistos };
  const partes = String(bruto).split(",").map((p) => p.trim()).filter(Boolean);
  if (partes.length !== 1) return { ok: false, motivo: "cf-connecting-ip com mais de um valor", vistos };
  const ip = normalizarIp(partes[0]);
  if (!ip) return { ok: false, motivo: "cf-connecting-ip ilegível", vistos };
  if (ip !== permitido) return { ok: false, motivo: "IP de origem não é o da VPS", vistos };
  return { ok: true, motivo: "ok", vistos };
}

export type EstadoPareamento = { abertoAte: string | null; pareadoEm: string | null };

/**
 * Decide a resposta antes de consumir (a função SQL refaz a checagem de janela e uso único
 * dentro de um UPDATE atômico, então duas chamadas simultâneas não levam os dois segredos).
 *  410 = já pareado (sempre, para sempre) · 403 = janela fechada/ausente ou origem errada · 200 = pode.
 */
export function decidirPareamento(
  estado: EstadoPareamento,
  origem: { ok: boolean },
  agoraMs: number,
): { status: 200 | 403 | 410; motivo: string } {
  if (estado.pareadoEm) return { status: 410, motivo: "já pareado" };
  const ate = estado.abertoAte ? Date.parse(estado.abertoAte) : NaN;
  if (!Number.isFinite(ate)) return { status: 403, motivo: "janela de pareamento não aberta" };
  if (agoraMs > ate) return { status: 403, motivo: "janela de pareamento fechada" };
  if (!origem.ok) return { status: 403, motivo: "origem recusada" };
  return { status: 200, motivo: "ok" };
}
