// Edge Function: mobile-push
// Worker de envio das notificações enfileiradas em `public.notificacoes`.
//
// Chamado por cron (pg_cron ou agendador externo), não pelo app. Roda com
// service_role porque precisa ler a fila de todas as alunas e casar com os
// tokens de dispositivo — nenhuma sessão de usuário alcança isso.
//
// Protegido por segredo compartilhado no header, senão a URL pública viraria
// um gatilho de spam.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json; charset=utf-8" };

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
/** O Expo aceita no máximo 100 mensagens por chamada. */
const LOTE_EXPO = 100;
/** Depois disso a notificação é dada como perdida — não vale insistir. */
const MAX_TENTATIVAS = 3;

type Notificacao = {
  id: string;
  aluna_id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown>;
  tentativas: number;
};

type Dispositivo = { token: string; aluna_id: string; provedor: string };

function pedacos<T>(lista: T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) {
    return new Response(JSON.stringify({ erro: "nao_autorizado" }), {
      status: 401, headers: JSON_HEADERS,
    });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // Pendentes cuja hora já chegou. O push da fase que abre daqui a 30 dias
    // fica parado aqui até lá — é o que segura o "uma fase por mês".
    const { data: pendentes, error: erroFila } = await db
      .from("notificacoes")
      .select("id, aluna_id, tipo, titulo, corpo, dados, tentativas")
      .is("enviada_em", null)
      .lt("tentativas", MAX_TENTATIVAS)
      .lte("agendada_para", new Date().toISOString())
      .order("agendada_para")
      .limit(500);
    if (erroFila) throw erroFila;

    const fila = (pendentes ?? []) as Notificacao[];
    if (fila.length === 0) {
      return new Response(JSON.stringify({ enviadas: 0, sem_dispositivo: 0, falhas: 0 }), {
        headers: JSON_HEADERS,
      });
    }

    const alunas = [...new Set(fila.map((n) => n.aluna_id))];
    const { data: dispositivos, error: erroDisp } = await db
      .from("dispositivos")
      .select("token, aluna_id, provedor")
      .in("aluna_id", alunas)
      .eq("ativo", true);
    if (erroDisp) throw erroDisp;

    const porAluna = new Map<string, Dispositivo[]>();
    for (const d of (dispositivos ?? []) as Dispositivo[]) {
      const lista = porAluna.get(d.aluna_id) ?? [];
      lista.push(d);
      porAluna.set(d.aluna_id, lista);
    }

    const mensagens: { to: string; title: string; body: string; data: unknown; sound: string }[] = [];
    const notificacaoDaMensagem: string[] = [];
    const semDispositivo: string[] = [];

    for (const n of fila) {
      const aparelhos = (porAluna.get(n.aluna_id) ?? []).filter((d) => d.provedor === "expo");
      if (aparelhos.length === 0) {
        // Ninguém para receber: marca como resolvida em vez de tentar para sempre.
        semDispositivo.push(n.id);
        continue;
      }
      for (const d of aparelhos) {
        mensagens.push({
          to: d.token,
          title: n.titulo,
          body: n.corpo,
          data: { ...n.dados, tipo: n.tipo, notificacao_id: n.id },
          sound: "default",
        });
        notificacaoDaMensagem.push(n.id);
      }
    }

    if (semDispositivo.length) {
      await db.from("notificacoes")
        .update({ enviada_em: new Date().toISOString(), erro: "sem dispositivo registrado" })
        .in("id", semDispositivo);
    }

    const entregues = new Set<string>();
    const falhadas = new Map<string, string>();
    const tokensInvalidos: string[] = [];

    let deslocamento = 0;
    for (const lote of pedacos(mensagens, LOTE_EXPO)) {
      const inicio = deslocamento;
      deslocamento += lote.length;

      try {
        const resposta = await fetch(EXPO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip, deflate" },
          body: JSON.stringify(lote),
        });
        const corpo = await resposta.json();
        const tickets = corpo?.data ?? [];

        lote.forEach((msg, i) => {
          const idNotificacao = notificacaoDaMensagem[inicio + i];
          const ticket = tickets[i];
          if (ticket?.status === "ok") {
            entregues.add(idNotificacao);
            return;
          }
          const motivo = ticket?.details?.error ?? ticket?.message ?? "falha desconhecida";
          falhadas.set(idNotificacao, String(motivo));
          // Aparelho desinstalou o app: desliga o token para não insistir.
          if (ticket?.details?.error === "DeviceNotRegistered") {
            tokensInvalidos.push(msg.to);
          }
        });
      } catch (e) {
        lote.forEach((_, i) => {
          falhadas.set(notificacaoDaMensagem[inicio + i], String(e));
        });
      }
    }

    if (tokensInvalidos.length) {
      await db.from("dispositivos").update({ ativo: false }).in("token", tokensInvalidos);
    }

    // Uma entrega bem-sucedida em qualquer aparelho já resolve a notificação.
    if (entregues.size) {
      await db.from("notificacoes")
        .update({ enviada_em: new Date().toISOString(), erro: null })
        .in("id", [...entregues]);
    }

    const paraReprocessar = [...falhadas.keys()].filter((id) => !entregues.has(id));
    for (const id of paraReprocessar) {
      const original = fila.find((n) => n.id === id);
      await db.from("notificacoes")
        .update({ tentativas: (original?.tentativas ?? 0) + 1, erro: falhadas.get(id) })
        .eq("id", id);
    }

    return new Response(JSON.stringify({
      enviadas: entregues.size,
      sem_dispositivo: semDispositivo.length,
      falhas: paraReprocessar.length,
      tokens_desativados: tokensInvalidos.length,
    }), { headers: JSON_HEADERS });
  } catch (e) {
    console.error("mobile-push falhou:", e);
    return new Response(JSON.stringify({ erro: "erro_interno" }), {
      status: 500, headers: JSON_HEADERS,
    });
  }
});
