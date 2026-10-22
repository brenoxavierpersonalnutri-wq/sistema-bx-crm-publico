// Envio de UMA mensagem pelo número não oficial, sem JWT de usuário (worker de automações).
// Mesmas chamadas de whatsapp-send / whatsapp-send-media: o proxy assinado do OpenWA na VPS
// (que tem limite próprio de 20/min e 300/dia por cima do nosso). Vídeo vai como documento. Áudio vai como
// nota de voz (o proxy converte para Ogg/Opus e mostra "gravando áudio…"; notaDeVoz.ts), salvo `ptt: false`.
//
// Sessão: `opcoes.sessao` escolhe o número (crm_numeros.sessao_openwa). Vazio ou a sessão padrão = chamada
// idêntica à de antes. Outra sessão só sai com WA_PROXY_MULTISESSAO=1 (contrato em numerosWa.ts).
import { chamarProxy, ErroProxy } from "./waProxy.ts";
import { corpoComSessao } from "./numerosWa.ts";
import { multisessaoLigada } from "./multisessaoWa.ts";
import { enviarNotaDeVoz } from "./notaDeVoz.ts";

export type TipoEnvio = "text" | "image" | "audio" | "document";

/** Teto da chamada de nota de voz: download + ffmpeg + "gravando áudio…" (até 12 s) + envio. */
export const TEMPO_NOTA_DE_VOZ_MS = 55_000;

export class ErroEnvio extends Error {
  constructor(public status: number, public detalhe: unknown) {
    super(`envio falhou (${status})`);
  }
}

export async function enviarWhatsApp(
  phone: string,
  m: {
    tipo: TipoEnvio; texto: string; url?: string | null; fileName?: string | null;
    /** áudio: false = manda como arquivo; padrão = nota de voz */
    ptt?: boolean;
    /** nota de voz: false = sem "gravando áudio…" antes; padrão = com */
    gravando?: boolean;
  },
  opcoes: { sessao?: string | null } = {},
): Promise<string | null> {
  const number = phone.replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(number)) throw new ErroEnvio(400, "telefone inválido");

  const optsSessao = {
    padrao: Deno.env.get("WA_SESSAO_PADRAO"),
    multisessao: await multisessaoLigada(),
  };
  // Recusa antes da rede quando a sessão não tem ponte (status 0: não é sinal de restrição do WhatsApp).
  const comSessao = (corpo: Record<string, unknown>) => {
    const r = corpoComSessao(corpo, opcoes.sessao, optsSessao);
    if (!r.corpo) throw new ErroEnvio(0, r.decisao.modo === "indisponivel" ? r.decisao.motivo : "sessão indisponível");
    return r.corpo;
  };

  try {
    if (m.tipo === "text") {
      const r = await chamarProxy("send-text", comSessao({ phone: number, text: m.texto }));
      return r?.messageId ? String(r.messageId) : null;
    }
    if (!m.url || !/^https:\/\//.test(m.url)) throw new ErroEnvio(400, "url precisa ser https");
    if (m.tipo === "audio" && m.ptt !== false) {
      // conversão + "gravando" (até 12 s) acontecem no proxy antes do envio: teto maior que o padrão de 25 s
      const v = await enviarNotaDeVoz(
        (rota, corpo) => chamarProxy(rota, comSessao(corpo), { timeoutMs: TEMPO_NOTA_DE_VOZ_MS }),
        { phone: number, url: m.url, filename: m.fileName, gravando: m.gravando },
      );
      return v.messageId;
    }
    const r = m.tipo === "image"
      ? await chamarProxy("send-image", comSessao({ phone: number, url: m.url, ...(m.texto ? { caption: m.texto } : {}) }))
      : await chamarProxy("send-document", comSessao({
          phone: number,
          url: m.url,
          ...(m.fileName ? { filename: m.fileName } : {}),
          ...(m.texto ? { caption: m.texto } : {}),
        }));
    return r?.messageId ? String(r.messageId) : null;
  } catch (e) {
    if (e instanceof ErroEnvio) throw e;
    if (e instanceof ErroProxy) throw new ErroEnvio(e.status, e.detalhe);
    throw new ErroEnvio(0, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Indicador "digitando…" / "gravando áudio…" (ou "paused" para apagar) na conversa, pelo proxy (rota `typing`, que
 * chama POST /sessions/{id}/chats/typing do OpenWA). Melhor esforço: devolve false quando não deu (proxy antigo sem
 * a rota, sessão fora, OpenWA sem o endpoint) e NUNCA lança: o envio da mensagem não depende disso.
 */
export async function enviarDigitando(
  phone: string,
  estado: "typing" | "recording" | "paused",
  opcoes: { sessao?: string | null } = {},
): Promise<boolean> {
  try {
    const number = phone.replace(/\D/g, "");
    if (!/^\d{10,15}$/.test(number)) return false;
    const r = corpoComSessao({ phone: number, state: estado }, opcoes.sessao, {
      padrao: Deno.env.get("WA_SESSAO_PADRAO"),
      multisessao: await multisessaoLigada(),
    });
    if (!r.corpo) return false;
    await chamarProxy("typing", r.corpo, { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}
