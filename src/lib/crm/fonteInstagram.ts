// Fonte do Instagram Direct para a tela Conversas (tabelas ig_contatos / ig_mensagens, Realtime e a edge
// function instagram-send) e a fonte COMBINADA que a tela usa: WhatsApp + Instagram na mesma lista.
// No Direct o "phone" do contato é "ig:" + IGSID; a fonte combinada despacha pelo prefixo.
import { supabase } from "@/integrations/supabase/client";
import type { ContatoCRM, MensagemCRM } from "@/lib/crm/conversas";
import type { EventosFonte, FonteConversas } from "@/lib/crm/fonteConversas";
import { validarMidia, type TipoMidiaCRM } from "../../../supabase/functions/_shared/instagram";

// ig_* ainda não estão no types.ts gerado
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export const ehPhoneIg = (phone: string | null | undefined): boolean => typeof phone === "string" && phone.startsWith("ig:");

const COLUNAS_CONTATO =
  "id, phone, name, username, avatar_url, avatar_atualizado_em, stage, tags, notes, ai_agent_slug, ai_pausado, ultima_entrada_em, updated_at, created_at";
const COLUNAS_MSG =
  "id, contact_phone, body, caption, created_at, direction, sender_type, status, media_url, media_type, mime_type, file_name, message_id";
const JANELA_RECENTES = 1000;

/** Tabela ainda não existe (migration não rodou): a fonte do Instagram fica vazia sem quebrar a tela. */
const semTabela = (e: unknown) =>
  !!e && typeof e === "object" && ["42P01", "PGRST205", "42501"].includes(String((e as { code?: string }).code));

export const comoContato = (r: Record<string, unknown>): ContatoCRM =>
  ({ ...(r as unknown as ContatoCRM), canal: "instagram", is_group: false });

/** Erro da edge function com o texto que ela devolveu (ex.: fora da janela de 24 h). */
async function erroDaFuncao(error: unknown, padrao: string): Promise<Error> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    const j = await ctx.json().catch(() => null);
    if (j?.error) return new Error(String(j.error));
  }
  return error instanceof Error ? error : new Error(padrao);
}

async function enviar(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("instagram-send", { body });
  if (error) throw await erroDaFuncao(error, "Falha ao enviar no Direct");
  if (data?.error) throw new Error(String(data.error));
}

function tipoDoArquivo(file: File): TipoMidiaCRM {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export const fonteInstagram: FonteConversas = {
  async usuarioId() {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "anonimo";
  },

  async listarContatos() {
    const { data, error } = await db.from("ig_contatos").select(COLUNAS_CONTATO)
      .order("updated_at", { ascending: false }).limit(5000);
    if (error) {
      if (semTabela(error)) return [];
      throw error;
    }
    return ((data ?? []) as Record<string, unknown>[]).map(comoContato);
  },

  async mensagensRecentes() {
    const { data, error } = await db.from("ig_mensagens").select(COLUNAS_MSG)
      .order("created_at", { ascending: false }).limit(JANELA_RECENTES);
    if (error) {
      if (semTabela(error)) return [];
      throw error;
    }
    return (data ?? []) as MensagemCRM[];
  },

  async mensagensDoContato(phone, limite, antesDe) {
    let q = db.from("ig_mensagens").select(COLUNAS_MSG).eq("contact_phone", phone)
      .order("created_at", { ascending: false }).limit(limite);
    if (antesDe) q = q.lt("created_at", antesDe);
    const { data, error } = await q;
    if (error) {
      if (semTabela(error)) return [];
      throw error;
    }
    return (data ?? []) as MensagemCRM[];
  },

  assinar({ onMensagem, onContato }: EventosFonte) {
    const canal = supabase
      .channel(`crm_instagram_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_mensagens" }, (p) => onMensagem(p.new as MensagemCRM, "INSERT"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ig_mensagens" }, (p) => onMensagem(p.new as MensagemCRM, "UPDATE"))
      .on("postgres_changes", { event: "*", schema: "public", table: "ig_contatos" }, (p) => {
        const ev = p.eventType as "INSERT" | "UPDATE" | "DELETE";
        onContato(comoContato((ev === "DELETE" ? p.old : p.new) as Record<string, unknown>), ev);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  },

  async enviarTexto(phone, texto) {
    await enviar({ phone, texto });
  },

  async enviarMidia(phone, file, legenda) {
    const tipo = tipoDoArquivo(file);
    const motivo = validarMidia(tipo, { mime: file.type, nome: file.name, tamanho: file.size });
    if (motivo) throw new Error(motivo);
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
    const caminho = `instagram/${phone.slice(3)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("whatsapp-media")
      .upload(caminho, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) throw upErr;
    // a Meta baixa o arquivo pelo link: assinado por 7 dias basta
    const { data: assinado, error: signErr } = await supabase.storage.from("whatsapp-media").createSignedUrl(caminho, 60 * 60 * 24 * 7);
    if (signErr || !assinado?.signedUrl) throw signErr || new Error("Falha ao gerar link do arquivo");
    await enviar({ phone, midia: { url: assinado.signedUrl, tipo, nome: file.name, mime: file.type, tamanho: file.size }, legenda });
  },

  async enviarMidiaUrl(phone, midia, legenda) {
    const motivo = validarMidia(midia.tipo, { nome: midia.nome || midia.url.split("?")[0] });
    if (motivo) throw new Error(motivo);
    await enviar({ phone, midia: { url: midia.url, tipo: midia.tipo, nome: midia.nome }, legenda });
  },

  async importarHistorico() {
    throw new Error("No Direct o histórico chega sozinho a partir da conexão. Mensagens antigas não são importadas.");
  },

  async atualizarContato(id, patch) {
    const { error } = await db.from("ig_contatos")
      .update({ ...patch, ...(patch.stage ? { updated_at: new Date().toISOString() } : {}) }).eq("id", id);
    if (error) throw error;
  },
};

/** WhatsApp + Instagram numa fonte só. Cada operação vai pra fonte do canal do phone. */
export function combinarFontes(wa: FonteConversas, ig: FonteConversas = fonteInstagram): FonteConversas {
  const idsIg = new Set<string>();
  const de = (phone: string) => (ehPhoneIg(phone) ? ig : wa);
  return {
    usuarioId: () => wa.usuarioId(),
    async listarContatos() {
      const [a, b] = await Promise.all([wa.listarContatos(), ig.listarContatos().catch(() => [] as ContatoCRM[])]);
      for (const c of b) idsIg.add(c.id);
      return [...a, ...b];
    },
    async mensagensRecentes(limite) {
      const [a, b] = await Promise.all([wa.mensagensRecentes(limite), ig.mensagensRecentes(limite).catch(() => [] as MensagemCRM[])]);
      return [...a, ...b];
    },
    // lista paginada (21/10/2026): só o WhatsApp pagina no servidor; o Direct vem inteiro por canaisCompletos
    paginaConversas: wa.paginaConversas?.bind(wa),
    contadoresConversas: wa.contadoresConversas?.bind(wa),
    async canaisCompletos() {
      const [contatos, mensagens] = await Promise.all([
        ig.listarContatos().catch(() => [] as ContatoCRM[]),
        ig.mensagensRecentes().catch(() => [] as MensagemCRM[]),
      ]);
      for (const c of contatos) idsIg.add(c.id);
      return { contatos, mensagens };
    },
    // só o WhatsApp tem o resumo no banco; o Direct segue pela janela de mensagens recentes
    resumoConversas: wa.resumoConversas ? (leituras, base) => wa.resumoConversas!(leituras, base) : undefined,
    listarNumeros: wa.listarNumeros?.bind(wa),
    mensagensDoContato: (phone, limite, antesDe, numeroId) => de(phone).mensagensDoContato(phone, limite, antesDe, numeroId),
    ouvirMidiasAssinadas: wa.ouvirMidiasAssinadas?.bind(wa),
    assinar(eventos) {
      const pararWa = wa.assinar(eventos);
      const pararIg = ig.assinar({
        onMensagem: eventos.onMensagem,
        onContato: (c, ev) => { idsIg.add(c.id); eventos.onContato(c, ev); },
      });
      return () => { pararWa(); pararIg(); };
    },
    enviarTexto: (phone, texto, numeroId) => de(phone).enviarTexto(phone, texto, numeroId),
    enviarMidia: (phone, arquivo, legenda, opcoes) => de(phone).enviarMidia(phone, arquivo, legenda, opcoes),
    enviarMidiaUrl: (phone, midia, legenda, numeroId) => {
      const f = de(phone);
      if (!f.enviarMidiaUrl) return Promise.reject(new Error("Envio de mídia por link indisponível."));
      return f.enviarMidiaUrl(phone, midia, legenda, numeroId);
    },
    importarHistorico: (phone, numeroId, opcoes) => de(phone).importarHistorico(phone, numeroId, opcoes),
    sincronizarConversas: wa.sincronizarConversas?.bind(wa),
    atualizarContato: (id, patch) => (idsIg.has(id) ? ig : wa).atualizarContato(id, patch),
    tamanhoArquivo: wa.tamanhoArquivo?.bind(wa),
    baixarMidia: wa.baixarMidia?.bind(wa),
    backfill: wa.backfill,
  };
}
