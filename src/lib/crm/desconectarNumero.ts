// Desconectar um número de WhatsApp em /crm/conexoes (21/10/2026): POST {acao:"desconectar", sessao} na whatsapp-qr.
// A função pede ao proxy da VPS o logout da sessão no OpenWA (desvincula o aparelho) e o start, para a sessão
// voltar a pedir QR. Nada do CRM é apagado: mensagens, contatos e o número continuam.
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { temComercial } from "@/lib/modules";
import type { NumeroCRM, StatusNumero } from "@/lib/crm/central";

/** logout (até 60 s) + start (até 60 s) no proxy, mais a ida e volta da função. */
export const PRAZO_DESCONECTAR_MS = 140_000;

/** Mostra o botão: número OpenWA ativo, conectado, e a pessoa é admin ou tem a liberação Comercial. */
export function podeVerDesconectar(
  numero: Pick<NumeroCRM, "tipo" | "ativo" | "sessao_openwa">,
  conectado: boolean,
  acesso: { isAdmin: boolean; modulos: ReadonlyArray<string> },
): boolean {
  return numero.tipo === "openwa" && numero.ativo && !!numero.sessao_openwa && conectado
    && temComercial(acesso.isAdmin, acesso.modulos);
}

export type ResultadoDesconexao =
  | { ok: true; state: string; aviso: string | null }
  | { ok: false; erro: string };

/** Texto legível para qualquer falha (a função já manda `error` em português; aqui só o que não veio). */
export function textoErroDesconexao(status: number, corpo: Record<string, unknown> | null): string {
  const e = corpo && typeof corpo.error === "string" ? corpo.error.trim() : "";
  if (e && e !== "Unauthorized" && e !== "Unknown") return e;
  if (status === 401) return "Sua sessão expirou: entre de novo e tente outra vez.";
  if (status === 403) return "Você não tem permissão para desconectar números.";
  if (status === 404) return "A função de desconectar ainda não foi publicada no servidor.";
  if (status === 0) return "Não consegui falar com o servidor. Confira a internet e tente de novo.";
  return `Não consegui desconectar (resposta ${status}).`;
}

export async function desconectarNumero(sessao: string): Promise<ResultadoDesconexao> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, erro: textoErroDesconexao(401, null) };
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  let res: Response;
  try {
    res = await buscarComLimite(`https://${projectId}.supabase.co/functions/v1/whatsapp-qr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "desconectar", sessao }),
    }, PRAZO_DESCONECTAR_MS);
  } catch (e) {
    const tempo = e instanceof Error && /tempo|timeout|abort/i.test(`${e.name} ${e.message}`);
    return {
      ok: false,
      erro: tempo
        ? "O servidor demorou demais para responder. Confira o status do número em 1 minuto antes de tentar de novo."
        : textoErroDesconexao(0, null),
    };
  }
  const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || corpo?.desconectado !== true) return { ok: false, erro: textoErroDesconexao(res.status, corpo) };
  return {
    ok: true,
    state: typeof corpo.state === "string" ? corpo.state : "disconnected",
    aviso: typeof corpo.aviso === "string" ? corpo.aviso : null,
  };
}

/** Status do cartão logo depois de desconectar (antes da próxima leitura): sempre com o botão Conectar. */
export function statusDepoisDeDesconectar(r: { state: string; aviso: string | null }, telefone: string | null): StatusNumero {
  const esperandoQr = r.state === "qr_ready" || r.state === "initializing";
  return {
    estado: esperandoQr ? "qr" : "desconectado",
    rotulo: esperandoQr ? "desconectado / aguardando QR" : "desconectado",
    telefone,
    aviso: r.aviso,
  };
}
