// Roteiros por etapa e agentes de IA do CRM: tipos, acesso ao banco e envio manual.
// As tabelas (crm_roteiros, crm_roteiro_passos, crm_roteiro_envios, crm_ai_agents)
// vêm da migration 20261017100000 e ainda não estão no types.ts gerado.
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { envioManual } from "@/lib/crm/envioGrupo";
import { ehOggOpus } from "../../supabase/functions/_shared/notaDeVoz.ts";
export {
  aplicarVariaveis,
  primeiroNome,
  interpretarResposta,
  variaveisPendentes,
  ETAPAS_PADRAO,
  type AgenteIA,
  type RespostaInterpretada,
} from "../../supabase/functions/_shared/agentesIA.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (tabela: string) => any };

export type TipoPasso = "text" | "audio" | "image" | "document";

export interface Roteiro {
  id: string;
  stage: string;
  funil: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
}

export interface PassoRoteiro {
  id: string;
  roteiro_id: string;
  ordem: number;
  tipo: TipoPasso;
  rotulo: string | null;
  conteudo: string;
  media_url: string | null;
  media_path: string | null;
  file_name: string | null;
  atraso_segundos: number;
  aguarda_resposta: boolean;
}

export const FUNIS = [
  { id: "avaliacao", nome: "Avaliação" },
  { id: "individual", nome: "Individual" },
  { id: "geral", nome: "Geral" },
];

export const TIPOS_PASSO: { id: TipoPasso; nome: string }[] = [
  { id: "text", nome: "Texto" },
  { id: "audio", nome: "Áudio" },
  { id: "image", nome: "Imagem" },
  { id: "document", nome: "Documento" },
];

/** "agora", "6 s", "5 min", "1 dia" — atraso sugerido legível. */
export function formatarAtraso(segundos: number): string {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  if (s === 0) return "agora";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return `${d} dia${d > 1 ? "s" : ""}`;
}

/** Passo de mídia sem arquivo não pode ser enviado. */
export function passoEnviavel(p: Pick<PassoRoteiro, "tipo" | "conteudo" | "media_url">, texto: string): boolean {
  if (p.tipo === "text") return texto.trim().length > 0;
  return Boolean(p.media_url);
}

/** Sobe arquivo do roteiro para o bucket whatsapp-media e devolve link assinado de 5 anos. */
export async function subirMidiaRoteiro(roteiroId: string, file: File): Promise<{ url: string; path: string }> {
  if (file.size > 16 * 1024 * 1024) throw new Error("O WhatsApp aceita no máximo 16 MB.");
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `roteiros/${roteiroId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("whatsapp-media")
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  const { data, error: e2 } = await supabase.storage
    .from("whatsapp-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (e2 || !data?.signedUrl) throw e2 || new Error("Falha ao gerar link do arquivo");
  return { url: data.signedUrl, path };
}

/**
 * Envia UM passo para UM contato pelas funções já existentes (whatsapp-send /
 * whatsapp-send-media). Envio manual, um clique = uma mensagem. Nada em massa.
 */
export async function enviarPasso(phone: string, passo: PassoRoteiro, texto: string, numeroId: string | null = null): Promise<void> {
  // numeroId: sai pelo MESMO número da conversa (sem ele, o padrão)
  // grupo (…@g.us): manual: true, a função só aceita grupo assim (atendente logado)
  const doNumero = { ...(numeroId ? { numero_id: numeroId } : {}), ...envioManual(phone) };
  if (passo.tipo === "text") {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada. Faça login novamente.");
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await buscarComLimite(`https://${projectId}.supabase.co/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ phone, message: texto, ...doNumero }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || "Falha ao enviar");
  } else {
    if (!passo.media_url) throw new Error("Passo sem arquivo: suba o arquivo no editor de roteiros.");
    const { error } = await supabase.functions.invoke("whatsapp-send-media", {
      body: {
        phone,
        url: passo.media_url,
        tipo: passo.tipo,
        legenda: texto.trim(),
        file_name: passo.file_name || undefined,
        ...(passo.tipo === "audio" && ehOggOpus(passo.file_name, passo.media_url) ? { ptt: true } : {}),
        ...doNumero,
      },
    });
    if (error) throw error;
  }
  await db.from("crm_roteiro_envios").insert({ passo_id: passo.id, contact_phone: phone });
}

/** Registra que estes passos foram enviados para o contato (mostra o ✓ no painel). */
export async function registrarEnvios(phone: string, passoIds: string[]): Promise<void> {
  const ids = [...new Set(passoIds)].filter(Boolean);
  if (!ids.length) return;
  await db.from("crm_roteiro_envios").insert(ids.map((passo_id) => ({ passo_id, contact_phone: phone })));
}
