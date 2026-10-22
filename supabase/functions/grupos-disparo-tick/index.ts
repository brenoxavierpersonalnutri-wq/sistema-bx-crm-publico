// Módulo Grupos do CRM (substitui o SendFlow): disparo agendado para os grupos de uma campanha.
//
// Duas portas:
//  - pg_cron (1/min, public.grupos_disparo_tick) com header x-grupos-segredo =
//    integracao_config.grupos_disparo_segredo -> tick:
//      1. mensagem "agendada" vencida vira uma linha por grupo (grupos_envios) com horário
//         espaçado por intervalo aleatório (campanha.intervalo_min_s..max_s, padrão 20-60 s);
//      2. grava no proxy a allowlist dos grupos cadastrados (o proxy recusa grupo fora dela);
//      3. envia, um grupo por vez, o que vence nos próximos ~95 s (dorme até cada horário);
//      4. reconta participantes dos grupos com id (até 10 por tick, no máx. a cada 10 min).
//  - a tela (JWT de usuário aprovado): listar os grupos da sessão do número, ler um grupo,
//    recontar participantes de uma campanha, criar o próximo grupo agora.
//
// Fluxo de Grupo (19/10/2026):
//  5. cria o próximo grupo quando as vagas ficam abaixo da folga. SEMPRE LIGADO desde 21/10/2026 (toda campanha
//     menos a Avulsos; não existe mais auto_criar na tela): group-create pelo número da campanha (só o de
//     grupos, "Grupos 1"), só-admins/descrição/foto/admins, convite, e o grupo entra no fim da fila do link.
//     Um por tick; etapas registradas em grupos_criacoes (retoma de onde parou, 3 tentativas). Travas anti-ban
//     (1 em andamento por campanha, 2 min entre criações e 10 por dia por número) em _shared/grupoCriacao.ts.
//  6. boas-vindas: junta quem entrou (eventos group.join do openwa-webhook) e manda uma mensagem por
//     grupo, no máximo 1 a cada boas_vindas_intervalo_min, mencionando quem chegou.
//  Mensagens novas: enquete (send-group-poll), fechar/abrir grupo (group-settings announce), nota de
//  voz (ptt) e "mencionar todos" (o proxy menciona os participantes sem @ no texto). O intervalo entre
//  grupos respeita o teto por minuto da campanha (intervaloEfetivo).
//
// Disparo em grupo (20/10/2026, seção /crm/disparo-grupos): mensagem com grupos_alvo só vai para aqueles
// grupos da campanha; criação agendada (criacao_agendada_para) cria o próximo grupo uma vez na hora; a tela
// lê a permissão do número em cada grupo (permissoes) e aplica nome/descrição/foto/ajustes/admins num grupo
// por chamada (configurar_grupo). Criar grupo só no número "grupos-N" (Baileys): numeroCriaGrupo().
//
// Envio a grupo usa a sessão OpenWA do NÚMERO da campanha (crm_numeros.sessao_openwa), pelo mesmo contrato
// da Central (_shared/numerosWa.ts): sessão padrão não vai no corpo; outra sessão só com WA_PROXY_MULTISESSAO=1.
// Número oficial, desativado ou sem ponte = não envia (nunca cai na sessão padrão por engano).
// numero_id NULL = sessão padrão.
// Permissões do CRM (22/11/2026): área/número/ação conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chamarProxy, ErroProxy } from "../_shared/waProxy.ts";
import { erroCriacaoGrupo, erroProxyLegivel } from "../_shared/grupos.ts";
import {
  type GrupoDaCampanha,
  type MensagemGrupo,
  chatIdGrupoValido,
  pedidoProxyGrupo,
  planejarEnvios,
  intervaloEfetivo,
  textoBoasVindas,
  numeroCriaGrupo,
  telefoneAdmin,
} from "../_shared/grupos.ts";
import {
  type CampanhaFluxo,
  type Criacao,
  type PortaCriacao,
  criarProximoGrupo as criarProximoGrupoPorta,
  aplicarAdmins,
} from "../_shared/grupoCriacao.ts";
import { decidirSessao, type NumeroEnvio, sessaoParaEnvio } from "../_shared/numerosWa.ts";
import { multisessaoLigada } from "../_shared/multisessaoWa.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const JANELA_ENVIO_MS = 95_000;
/** A tela confere esta versão antes de oferecer disparo com grupos escolhidos (edge velha mandaria para todos). */
export const VERSAO_DISPARO = 2;
/** Mensagem/envio atrasado mais que isto (proxy fora, cron parado) não sai: aviso velho no grupo é pior que nenhum. */
export const ATRASO_MAXIMO_MS = 30 * 60_000;
const BUCKET = "grupos-midia";

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function configIntegracao(chave: string): Promise<string | null> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

const msgErro = (e: unknown): string => {
  if (e instanceof ErroProxy) {
    const d = e.detalhe as { error?: string; message?: string } | string;
    const txt = typeof d === "string" ? d : [d?.error, d?.message].filter(Boolean).join(": ");
    return `proxy ${e.status}${txt ? ` ${txt}` : ""}`.slice(0, 300);
  }
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
};

// ------------------------------------------------------------------ sessão do número

class SemSessao extends Error {}

const cacheSessao = new Map<string, { sessao: string | null } | { recusa: string }>();
/** null = sessão padrão (campanha sem número ou número da sessão padrão). Lança SemSessao quando não dá. */
async function sessaoDaCampanha(numeroId: string | null): Promise<string | null> {
  if (!numeroId) return null;
  if (!cacheSessao.has(numeroId)) {
    const { data, error } = await db.from("crm_numeros").select("tipo, sessao_openwa, ativo").eq("id", numeroId).maybeSingle();
    let r: { sessao: string | null } | { recusa: string };
    if (error) r = { recusa: `crm_numeros: ${error.message}` };
    else if (!data) r = { recusa: "o número da campanha não existe mais na Central" };
    else {
      const n = sessaoParaEnvio(data as NumeroEnvio);
      if ("recusa" in n) r = n;
      else {
        const d = decidirSessao(n.sessao, {
          padrao: Deno.env.get("WA_SESSAO_PADRAO"),
          multisessao: await multisessaoLigada(),
        });
        r = d.modo === "indisponivel" ? { recusa: d.motivo } : { sessao: d.modo === "explicita" ? d.sessao : null };
      }
    }
    cacheSessao.set(numeroId, r);
  }
  const r = cacheSessao.get(numeroId)!;
  if ("recusa" in r) throw new SemSessao(r.recusa);
  return r.sessao;
}

// ------------------------------------------------------------------ trava

async function reservarTrava(segundos: number): Promise<boolean> {
  const agora = new Date();
  const { data } = await db
    .from("grupos_disparo_estado")
    .update({ trava_ate: new Date(agora.getTime() + segundos * 1000).toISOString(), ultimo_tick: agora.toISOString() })
    .eq("id", 1)
    .or(`trava_ate.is.null,trava_ate.lt.${agora.toISOString()}`)
    .select("id");
  return Boolean(data?.length);
}

async function soltarTrava(resultado: unknown) {
  await db.from("grupos_disparo_estado")
    .update({ trava_ate: null, ultimo_resultado: resultado as Record<string, unknown> })
    .eq("id", 1);
}

// ------------------------------------------------------------------ 1. materializar

interface Campanha {
  id: string;
  numero_id: string | null;
  intervalo_min_s: number;
  intervalo_max_s: number;
  teto_por_minuto?: number;
  disparos_pausados: boolean;
  encerrada: boolean;
}
const COLS_CAMPANHA = "id, numero_id, intervalo_min_s, intervalo_max_s, teto_por_minuto, disparos_pausados, encerrada";

async function materializar(agora: Date): Promise<number> {
  const { data: msgs } = await db
    .from("grupos_mensagens")
    // "*": grupos_alvo (migration 20261108110000) vem quando existir, sem quebrar o banco antigo
    .select("*")
    .eq("status", "agendada")
    .lte("agendado_para", agora.toISOString())
    .order("agendado_para", { ascending: true })
    .limit(20);
  let n = 0;
  for (const m of msgs ?? []) {
    const { data: camp } = await db.from("grupos_campanhas")
      .select(COLS_CAMPANHA)
      .eq("id", m.campanha_id).maybeSingle() as { data: Campanha | null };
    if (!camp || camp.disparos_pausados || camp.encerrada) continue;
    const { data: agendada } = await db.from("grupos_mensagens").select("agendado_para").eq("id", m.id).maybeSingle();
    if (agendada && agora.getTime() - Date.parse(agendada.agendado_para) > ATRASO_MAXIMO_MS) {
      await db.from("grupos_mensagens").update({
        status: "erro", motivo: "horário passou há mais de 30 min sem o disparador rodar; não enviada",
        concluido_em: agora.toISOString(), updated_at: agora.toISOString(),
      }).eq("id", m.id).eq("status", "agendada");
      continue;
    }

    // reivindica a mensagem (agendada -> enviando) antes de criar as linhas
    const { data: pega } = await db.from("grupos_mensagens")
      .update({ status: "enviando", iniciado_em: agora.toISOString(), updated_at: agora.toISOString() })
      .eq("id", m.id).eq("status", "agendada").select("id");
    if (!pega?.length) continue;

    const { data: grupos } = await db.from("grupos_campanha_grupos")
      .select("id, ordem, link_convite, chat_id, ativo, cheio, cliques, cliques_na_contagem, participantes, created_at")
      .eq("campanha_id", camp.id);

    // começa depois do último envio pendente (outra mensagem na fila), para não atropelar
    const { data: ultimo } = await db.from("grupos_envios").select("proximo_em")
      .eq("status", "pendente").order("proximo_em", { ascending: false }).limit(1);
    const ritmo = intervaloEfetivo(camp.intervalo_min_s, camp.intervalo_max_s, camp.teto_por_minuto ?? 6);
    const fimFila = ultimo?.[0]?.proximo_em ? Date.parse(ultimo[0].proximo_em) + ritmo.min * 1000 : 0;
    const inicio = new Date(Math.max(agora.getTime(), fimFila));

    const alvo = Array.isArray((m as { grupos_alvo?: unknown }).grupos_alvo) ? (m as { grupos_alvo: string[] }).grupos_alvo : null;
    const plano = planejarEnvios((grupos ?? []) as GrupoDaCampanha[], inicio, ritmo.min, ritmo.max, Math.random, alvo);
    if (!plano.length) {
      await db.from("grupos_mensagens").update({
        status: "erro",
        motivo: alvo?.length
          ? "nenhum dos grupos escolhidos está ativo com id (@g.us) na campanha"
          : "campanha sem grupo com id (@g.us): escolha os grupos da sessão do número",
        concluido_em: agora.toISOString(), updated_at: agora.toISOString(),
      }).eq("id", m.id);
      continue;
    }
    const { error } = await db.from("grupos_envios").upsert(
      plano.map((p) => ({ mensagem_id: m.id, ...p })),
      { onConflict: "mensagem_id,grupo_id", ignoreDuplicates: true },
    );
    if (error) {
      await db.from("grupos_mensagens").update({ status: "erro", motivo: `falha ao montar fila: ${error.message}`, updated_at: agora.toISOString() }).eq("id", m.id);
      continue;
    }
    await db.from("grupos_mensagens").update({ total_grupos: plano.length }).eq("id", m.id);
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ 2. allowlist

async function sincronizarAllowlist(extras: string[] = []): Promise<number> {
  const { data } = await db
    .from("grupos_campanha_grupos")
    .select("chat_id, grupos_campanhas!inner(encerrada)")
    .not("chat_id", "is", null)
    .eq("grupos_campanhas.encerrada", false)
    .limit(500);
  // grupo que o CRM acabou de criar e ainda está nas etapas (sem linha na campanha)
  const { data: criando } = await db.from("grupos_criacoes").select("chat_id")
    .in("status", ["criando", "erro"]).not("chat_id", "is", null).limit(50);
  const grupos = [...new Set([
    ...(data ?? []).map((g: { chat_id: string }) => g.chat_id),
    ...(criando ?? []).map((g: { chat_id: string }) => g.chat_id),
    ...extras,
  ].filter(chatIdGrupoValido))].slice(0, 500);
  await chamarProxy("group-allowlist", { groups: grupos });
  return grupos.length;
}

// ------------------------------------------------------------------ 3. enviar

interface LinhaEnvio {
  id: string;
  mensagem_id: string;
  grupo_id: string;
  chat_id: string;
  proximo_em: string;
  tentativas: number;
}

const cacheMsg = new Map<string, (MensagemGrupo & { status: string; campanha_id: string }) | null>();
const cacheUrl = new Map<string, string>();
const cacheCamp = new Map<string, Campanha | null>();

async function mensagem(id: string, recarregar = false) {
  if (!recarregar && cacheMsg.has(id)) return cacheMsg.get(id)!;
  const { data } = await db.from("grupos_mensagens")
    .select("tipo, texto, midia_path, nome_arquivo, link_preview, status, campanha_id, enquete_opcoes, enquete_multipla, ptt, mencionar_todos")
    .eq("id", id).maybeSingle();
  cacheMsg.set(id, data as never);
  return data as (MensagemGrupo & { status: string; campanha_id: string }) | null;
}

async function campanha(id: string): Promise<Campanha | null> {
  if (cacheCamp.has(id)) return cacheCamp.get(id)!;
  const { data } = await db.from("grupos_campanhas")
    .select(COLS_CAMPANHA).eq("id", id).maybeSingle();
  cacheCamp.set(id, data as Campanha | null);
  return data as Campanha | null;
}

async function urlAssinada(path: string): Promise<string> {
  if (cacheUrl.has(path)) return cacheUrl.get(path)!;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`mídia: ${error?.message ?? "sem link"}`);
  cacheUrl.set(path, data.signedUrl);
  return data.signedUrl;
}

async function fecharMensagemSePronta(mensagemId: string) {
  const { data } = await db.from("grupos_envios").select("status").eq("mensagem_id", mensagemId);
  const linhas = data ?? [];
  const enviados = linhas.filter((l) => l.status === "enviado").length;
  const falhas = linhas.filter((l) => l.status === "falhou").length;
  const abertos = linhas.filter((l) => l.status === "pendente" || l.status === "enviando").length;
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { enviados, falhas, updated_at: agora };
  if (!abertos) {
    patch.concluido_em = agora;
    patch.status = enviados === 0 && falhas > 0 ? "erro" : "concluida";
    if (patch.status === "erro") patch.motivo = "nenhum grupo recebeu (veja o erro por grupo)";
  }
  // não sobrescreve "cancelada"
  await db.from("grupos_mensagens").update(patch).eq("id", mensagemId).eq("status", "enviando");
}

async function enviarUm(l: LinhaEnvio): Promise<string> {
  const agora = new Date().toISOString();
  const { data: pega } = await db.from("grupos_envios")
    .update({ status: "enviando", tentativas: l.tentativas + 1, updated_at: agora })
    .eq("id", l.id).eq("status", "pendente").select("id");
  if (!pega?.length) return "já pego";

  const m = await mensagem(l.mensagem_id, true);
  const finalizar = async (patch: Record<string, unknown>) => {
    await db.from("grupos_envios").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", l.id);
    await fecharMensagemSePronta(l.mensagem_id);
  };
  if (!m || m.status !== "enviando") {
    await finalizar({ status: "cancelado", erro: "mensagem cancelada" });
    return "cancelado";
  }
  const camp = await campanha(m.campanha_id);
  if (!camp || camp.encerrada) {
    await finalizar({ status: "cancelado", erro: "campanha encerrada" });
    return "cancelado";
  }
  if (camp.disparos_pausados) {
    // volta pra fila; sai quando despausar
    await db.from("grupos_envios").update({
      status: "pendente", tentativas: l.tentativas, proximo_em: new Date(Date.now() + 60_000).toISOString(), updated_at: agora,
    }).eq("id", l.id);
    return "pausado";
  }

  try {
    const sessao = await sessaoDaCampanha(camp.numero_id);
    const url = m.midia_path ? await urlAssinada(m.midia_path) : null;
    const pedido = pedidoProxyGrupo(m, l.chat_id, url, sessao);
    if ("erro" in pedido) {
      await finalizar({ status: "falhou", erro: pedido.erro });
      return "falhou";
    }
    const r = await chamarProxy(pedido.rota, pedido.corpo, { timeoutMs: 40_000 });
    await finalizar({ status: "enviado", enviado_em: new Date().toISOString(), message_id: r?.messageId ?? null, erro: null });
    if (m.tipo === "travar" || m.tipo === "destravar") {
      await db.from("grupos_campanha_grupos").update({ travado: m.tipo === "travar" }).eq("id", l.grupo_id);
    }
    return "enviado";
  } catch (e) {
    if (e instanceof ErroProxy && e.status === 429 && l.tentativas < 5) {
      await db.from("grupos_envios").update({
        status: "pendente", erro: msgErro(e), proximo_em: new Date(Date.now() + 20_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", l.id);
      return "adiado (limite do proxy)";
    }
    await finalizar({ status: "falhou", erro: msgErro(e) });
    return "falhou";
  }
}

async function enviarFila(inicioMs: number): Promise<Record<string, number>> {
  const contagem: Record<string, number> = {};
  const fim = inicioMs + JANELA_ENVIO_MS;
  for (let i = 0; i < 40; i++) {
    const { data } = await db.from("grupos_envios")
      .select("id, mensagem_id, grupo_id, chat_id, proximo_em, tentativas")
      .eq("status", "pendente")
      .order("proximo_em", { ascending: true })
      .limit(1);
    const l = data?.[0] as LinhaEnvio | undefined;
    if (!l) break;
    const quando = Date.parse(l.proximo_em);
    if (quando > fim) break;
    if (Date.now() - quando > ATRASO_MAXIMO_MS) {
      const { data: pega } = await db.from("grupos_envios")
        .update({ status: "falhou", erro: "atrasado mais de 30 min (proxy fora ou disparador parado); não enviado", updated_at: new Date().toISOString() })
        .eq("id", l.id).eq("status", "pendente").select("id");
      if (pega?.length) await fecharMensagemSePronta(l.mensagem_id);
      contagem["atrasado"] = (contagem["atrasado"] ?? 0) + 1;
      continue;
    }
    const espera = quando - Date.now();
    if (espera > 0) await dormir(espera);
    const r = await enviarUm(l);
    contagem[r] = (contagem[r] ?? 0) + 1;
  }
  return contagem;
}

// ------------------------------------------------------------------ 4. contagem de participantes

async function recontar(filtroCampanha?: string, maximo = 10): Promise<number> {
  let q = db.from("grupos_campanha_grupos")
    .select("id, chat_id, cliques, campanha_id, grupos_campanhas!inner(numero_id, encerrada)")
    .eq("ativo", true).not("chat_id", "is", null).eq("grupos_campanhas.encerrada", false)
    .order("participantes_em", { ascending: true, nullsFirst: true })
    .limit(maximo);
  if (filtroCampanha) q = q.eq("campanha_id", filtroCampanha);
  else q = q.or(`participantes_em.is.null,participantes_em.lt.${new Date(Date.now() - 10 * 60_000).toISOString()}`);
  const { data } = await q;
  let n = 0;
  for (const g of (data ?? []) as unknown as { id: string; chat_id: string; cliques: number; grupos_campanhas: { numero_id: string | null } }[]) {
    try {
      const sessao = await sessaoDaCampanha(g.grupos_campanhas.numero_id);
      const info = await chamarProxy("group-info", { chatId: g.chat_id, ...(sessao ? { sessao } : {}) });
      const participantes = Number.isFinite(info?.participants) ? Number(info.participants) : null;
      await db.from("grupos_campanha_grupos").update({
        participantes, participantes_em: new Date().toISOString(), cliques_na_contagem: g.cliques,
        ...(participantes !== null && participantes >= 1024 ? { cheio: true } : {}),
      }).eq("id", g.id);
      n++;
    } catch (e) {
      console.error("recontar", g.id, msgErro(e));
      // marca a tentativa para não martelar o mesmo grupo a cada minuto
      await db.from("grupos_campanha_grupos").update({ participantes_em: new Date().toISOString() }).eq("id", g.id);
    }
  }
  return n;
}

// ------------------------------------------------------------------ 5. criação de grupos (sempre ligada)

// A regra (o que pode, quando, travas anti-ban) mora em _shared/grupoCriacao.ts e _shared/grupos.ts, testada no
// vitest com banco e proxy falsos. Aqui só a porta: Supabase + proxy da VPS.
// "*" na campanha: banco sem a migration 20261122100000 ainda cria (só não grava o estado para o painel).

const cacheCria = new Map<string, boolean>();
/** Só o número "grupos-N" (OpenWA Baileys, "Grupos 1") cria grupo; sessão padrão/sem número não cria. */
async function numeroPodeCriar(numeroId: string | null): Promise<boolean> {
  if (!numeroId) return false;
  if (!cacheCria.has(numeroId)) {
    const { data } = await db.from("crm_numeros").select("sessao_openwa").eq("id", numeroId).maybeSingle();
    cacheCria.set(numeroId, numeroCriaGrupo(data?.sessao_openwa ?? null));
  }
  return cacheCria.get(numeroId)!;
}

const COLS_CRIACAO = "id, numero, nome, chat_id, etapa, status, tentativas, avisos, erro, updated_at";

const portaCriacao: PortaCriacao = {
  agora: () => new Date(),
  async grupos(campanhaId) {
    const { data } = await db.from("grupos_campanha_grupos")
      .select("id, ordem, link_convite, chat_id, ativo, cheio, cliques, cliques_na_contagem, participantes, created_at")
      .eq("campanha_id", campanhaId);
    return (data ?? []) as GrupoDaCampanha[];
  },
  numeroCria: numeroPodeCriar,
  async pendente(campanhaId) {
    const { data } = await db.from("grupos_criacoes").select(COLS_CRIACAO)
      .eq("campanha_id", campanhaId).in("status", ["criando", "erro"]).order("created_at", { ascending: false }).limit(1);
    return (data?.[0] as Criacao | undefined) ?? null;
  },
  async abandonadas24h(campanhaId) {
    const { count } = await db.from("grupos_criacoes").select("id", { count: "exact", head: true })
      .eq("campanha_id", campanhaId).eq("status", "abandonada").gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    return count ?? 0;
  },
  async historicoNumero(numeroId, desde, inicioDia, excluir) {
    let q = db.from("grupos_criacoes").select("id, created_at, grupos_campanhas!inner(numero_id)")
      .eq("grupos_campanhas.numero_id", numeroId).gte("created_at", desde.toISOString())
      .order("created_at", { ascending: false }).limit(500);
    if (excluir) q = q.neq("id", excluir);
    const { data, error } = await q;
    // sem conseguir medir, não cria (trava fechada é o lado seguro)
    if (error) throw new Error(`histórico de criações do número: ${error.message}`);
    const linhas = (data ?? []) as { created_at: string }[];
    return {
      ultima: linhas[0]?.created_at ?? null,
      hoje: linhas.filter((l) => Date.parse(l.created_at) >= inicioDia.getTime()).length,
    };
  },
  async reservarNumero(campanhaId, numero) {
    const { data } = await db.from("grupos_campanhas").update({ proximo_numero: numero + 1 })
      .eq("id", campanhaId).eq("proximo_numero", numero).select("id");
    return Boolean(data?.length);
  },
  async devolverNumero(campanhaId, numero) {
    await db.from("grupos_campanhas").update({ proximo_numero: numero }).eq("id", campanhaId).eq("proximo_numero", numero + 1);
  },
  async inserirCriacao(campanhaId, numero, nome) {
    const { data, error } = await db.from("grupos_criacoes").insert({ campanha_id: campanhaId, numero, nome }).select(COLS_CRIACAO).single();
    if (error || !data) return { duplicada: error?.code === "23505", erro: error?.message ?? "?" };
    return { criacao: data as Criacao };
  },
  async atualizarCriacao(id, patch) {
    await db.from("grupos_criacoes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  },
  async gravarGrupo(linha) {
    const { data, error } = await db.from("grupos_campanha_grupos").upsert(linha, { onConflict: "campanha_id,link_convite" }).select("id").single();
    if (error) throw new Error(`gravar grupo: ${error.message}`);
    return data?.id ?? null;
  },
  async estadoCampanha(campanhaId, patch) {
    const { error } = await db.from("grupos_campanhas").update(patch).eq("id", campanhaId);
    if (error) console.error("estado da criação (rodou a migration 20261122100000?)", error.message);
  },
  proxy: (rota, corpo, opcoes) => chamarProxy(rota, corpo, opcoes ?? {}),
  sessao: sessaoDaCampanha,
  allowlist: (extras) => sincronizarAllowlist(extras),
  urlAssinada,
  erroLegivel: (e, etapa) =>
    e instanceof SemSessao ? e.message
      : e instanceof ErroProxy ? (etapa === "criar" ? erroCriacaoGrupo(e.status, e.detalhe) : erroProxyLegivel(e.status, e.detalhe))
      : msgErro(e),
};

const criarProximoGrupo = (c: CampanhaFluxo, forcar = false) => criarProximoGrupoPorta(portaCriacao, c, forcar);

/** Criação agendada na tela: vence -> cria o próximo grupo uma vez (forçado) e limpa o horário. */
async function criacoesAgendadas(): Promise<string[]> {
  const { data } = await db.from("grupos_campanhas").select("*")
    .not("criacao_agendada_para", "is", null).lte("criacao_agendada_para", new Date().toISOString())
    .eq("encerrada", false).limit(5);
  const saida: string[] = [];
  for (const c of (data ?? []) as (CampanhaFluxo & { criacao_agendada_para: string })[]) {
    // limpa antes: mesmo que a criação falhe, não repete a cada minuto (a tela mostra o erro no log)
    const { data: pega } = await db.from("grupos_campanhas").update({ criacao_agendada_para: null })
      .eq("id", c.id).eq("criacao_agendada_para", c.criacao_agendada_para).select("id");
    if (!pega?.length) continue;
    const r = await criarProximoGrupo(c, true);
    saida.push(`${c.id.slice(0, 8)} (agendada): ${r}`);
    if (r.startsWith("grupo criado") || r.startsWith("erro na criação")) break;
  }
  return saida;
}

/** Toda campanha (menos a Avulsos) com link aberto: cria o próximo grupo quando as vagas pedem. Um por tick. */
async function garantirGrupos(): Promise<string[]> {
  const { data } = await db.from("grupos_campanhas").select("*")
    .eq("avulsa", false).eq("encerrada", false).eq("link_pausado", false)
    .order("updated_at", { ascending: true }).limit(50);
  const saida: string[] = [];
  const agora = Date.now();
  for (const c of (data ?? []) as (CampanhaFluxo & { criacao_retomar_em?: string | null })[]) {
    // trava com hora marcada (teto diário, pausa): não gasta consulta até lá
    if (c.criacao_retomar_em && Date.parse(c.criacao_retomar_em) > agora) continue;
    const r = await criarProximoGrupo(c);
    if (r !== "vagas suficientes") saida.push(`${c.id.slice(0, 8)}: ${r}`);
    if (r.startsWith("grupo criado") || r.startsWith("erro na criação")) break; // um por tick (proxy: 1 a cada 2 min)
  }
  return saida;
}

// ------------------------------------------------------------------ 6. boas-vindas

async function boasVindas(): Promise<number> {
  const seisHoras = new Date(Date.now() - 6 * 3600_000).toISOString();
  // velhas: não dá mais boas-vindas (chegaria fora de hora)
  await db.from("grupos_membros_eventos").update({ boas_vindas_pendente: false, participantes: [] })
    .eq("boas_vindas_pendente", true).lt("created_at", seisHoras);
  const { data } = await db.from("grupos_membros_eventos").select("id, grupo_id, campanha_id, participantes")
    .eq("boas_vindas_pendente", true).order("created_at").limit(500);
  const porGrupo = new Map<string, { ids: number[]; participantes: string[]; campanha_id: string }>();
  for (const e of (data ?? []) as { id: number; grupo_id: string; campanha_id: string; participantes: string[] }[]) {
    const g = porGrupo.get(e.grupo_id) ?? { ids: [], participantes: [], campanha_id: e.campanha_id };
    g.ids.push(e.id);
    g.participantes.push(...(e.participantes ?? []));
    porGrupo.set(e.grupo_id, g);
  }
  if (!porGrupo.size) return 0;
  const limpar = (ids: number[]) =>
    db.from("grupos_membros_eventos").update({ boas_vindas_pendente: false, participantes: [] }).in("id", ids);
  let enviadas = 0;
  let allowlistOk = false;
  for (const [grupoId, lote] of porGrupo) {
    if (enviadas >= 3) break;
    const { data: g } = await db.from("grupos_campanha_grupos").select("id, chat_id, ativo, boas_vindas_em").eq("id", grupoId).maybeSingle();
    const { data: c } = await db.from("grupos_campanhas")
      .select("numero_id, encerrada, disparos_pausados, boas_vindas_ligada, boas_vindas_texto, boas_vindas_mencionar, boas_vindas_intervalo_min")
      .eq("id", lote.campanha_id).maybeSingle();
    if (!g || !c || !g.ativo || !g.chat_id || c.encerrada || !c.boas_vindas_ligada || !c.boas_vindas_texto?.trim()) {
      await limpar(lote.ids);
      continue;
    }
    if (c.disparos_pausados) continue;
    if (g.boas_vindas_em && Date.now() - Date.parse(g.boas_vindas_em) < c.boas_vindas_intervalo_min * 60_000) continue;
    const { text, mentions } = textoBoasVindas(c.boas_vindas_texto, lote.participantes, c.boas_vindas_mencionar);
    if (!text) { await limpar(lote.ids); continue; }
    try {
      if (!allowlistOk) { await sincronizarAllowlist(); allowlistOk = true; }
      const sessao = await sessaoDaCampanha(c.numero_id);
      await chamarProxy("send-group-text", {
        chatId: g.chat_id, text, ...(mentions.length ? { mentions } : {}), ...(sessao ? { sessao } : {}),
      }, { timeoutMs: 30_000 });
      await limpar(lote.ids);
      await db.from("grupos_campanha_grupos").update({ boas_vindas_em: new Date().toISOString() }).eq("id", grupoId);
      enviadas++;
    } catch (e) {
      console.error("boas-vindas", grupoId, msgErro(e));
      if (e instanceof ErroProxy && e.status === 429) break;
      // segura o grupo pelo intervalo para não martelar; o lote espera (até 6 h)
      await db.from("grupos_campanha_grupos").update({ boas_vindas_em: new Date().toISOString() }).eq("id", grupoId);
    }
  }
  return enviadas;
}

// ------------------------------------------------------------------ manutenção

async function manutencao() {
  // linha presa em "enviando" (função caiu no meio): vira falha, NÃO reenvia (evita duplicar no grupo)
  const { data } = await db.from("grupos_envios")
    .update({ status: "falhou", erro: "interrompido no meio do envio (não reenviado para não duplicar)" })
    .eq("status", "enviando").lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .select("mensagem_id");
  for (const id of new Set((data ?? []).map((d) => d.mensagem_id))) await fecharMensagemSePronta(id);
  // ids de quem entrou só servem para a boas-vindas: some depois de 1 dia
  await db.from("grupos_membros_eventos").update({ participantes: [], boas_vindas_pendente: false })
    .lt("created_at", new Date(Date.now() - 86_400_000).toISOString()).neq("participantes", "{}");
}

async function tick() {
  const inicio = Date.now();
  if (!(await reservarTrava(130))) return { ok: true, pulado: "outro tick em andamento" };
  const resultado: Record<string, unknown> = {};
  try {
    resultado.materializadas = await materializar(new Date());
    try {
      const agendadas = await criacoesAgendadas().catch((e) => [`erro: ${msgErro(e)}`]);
      const criados = agendadas.some((r) => r.includes("grupo criado") || r.includes("erro na criação")) ? agendadas : [...agendadas, ...await garantirGrupos()];
      if (criados.length) resultado.criacao = criados;
    } catch (e) {
      resultado.erro_criacao = msgErro(e);
    }
    const { count } = await db.from("grupos_envios").select("id", { count: "exact", head: true }).eq("status", "pendente");
    if (count) {
      try {
        resultado.allowlist = await sincronizarAllowlist();
        resultado.envios = await enviarFila(inicio);
      } catch (e) {
        resultado.erro_allowlist = msgErro(e); // proxy fora/antigo: não envia nada neste tick
      }
    }
    if (Date.now() - inicio < 100_000) {
      try {
        const bv = await boasVindas();
        if (bv) resultado.boas_vindas = bv;
      } catch (e) {
        resultado.erro_boas_vindas = msgErro(e);
      }
    }
    if (Date.now() - inicio < 110_000) resultado.recontados = await recontar();
    await manutencao();
    return { ok: true, ...resultado };
  } finally {
    await soltarTrava({ ...resultado, em: new Date().toISOString() });
  }
}

// ------------------------------------------------------------------ servidor

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const segredoRecebido = req.headers.get("x-grupos-segredo");
    if (segredoRecebido) {
      const segredo = await configIntegracao("grupos_disparo_segredo");
      if (!segredo || !iguais(segredo, segredoRecebido)) return json({ error: "Unauthorized" }, 401);
      return json(await tick());
    }

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await usuario.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: aprovado } = await db.rpc("is_approved", { _user_id: user.id });
    if (!aprovado) return json({ error: "Forbidden" }, 403);

    const numeroId = typeof body?.numero_id === "string" && body.numero_id ? body.numero_id : null;
    {
      // ler (listar/info/versão) = Disparo "ver"; o resto mexe em grupo do WhatsApp = ação "enviar" naquele número
      const leitura = ["listar_grupos", "info_grupo", "versao"].includes(String(body?.modo));
      const acesso = await conferirAcessoCrm(usuario, leitura
        ? { area: "disparo", nivel: 1, numeroId }
        : { area: "disparo", acao: "disparo.enviar", numeroId });
      if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);
    }
    switch (body?.modo) {
      case "listar_grupos": {
        const sessao = await sessaoDaCampanha(numeroId);
        const lista = await chamarProxy("groups", { limit: 60, ...(sessao ? { sessao } : {}) });
        return json({ grupos: Array.isArray(lista) ? lista : [] });
      }
      case "info_grupo": {
        if (!chatIdGrupoValido(body?.chat_id)) return json({ error: "chat_id inválido" }, 400);
        const sessao = await sessaoDaCampanha(numeroId);
        return json(await chamarProxy("group-info", { chatId: body.chat_id, ...(sessao ? { sessao } : {}) }));
      }
      case "convite_grupo": {
        if (!chatIdGrupoValido(body?.chat_id)) return json({ error: "chat_id inválido" }, 400);
        const sessao = await sessaoDaCampanha(numeroId);
        return json(await chamarProxy("group-invite", { chatId: body.chat_id, ...(sessao ? { sessao } : {}) }));
      }
      case "criar_grupo": {
        const id = String(body?.campanha_id ?? "");
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "campanha_id" }, 400);
        const { data: c } = await db.from("grupos_campanhas").select("*").eq("id", id).maybeSingle();
        if (!c) return json({ error: "campanha não encontrada" }, 404);
        if ((c as CampanhaFluxo).encerrada) return json({ error: "campanha encerrada" }, 409);
        // mesma trava do tick: nunca duas criações ao mesmo tempo
        if (!(await reservarTrava(90))) return json({ error: "o disparador está rodando agora; tente em 1 minuto" }, 409);
        try {
          return json({ ok: true, resultado: await criarProximoGrupo(c as CampanhaFluxo, true) });
        } finally {
          await soltarTrava({ modo: "criar_grupo", campanha: id, em: new Date().toISOString() });
        }
      }
      case "recontar": {
        const id = String(body?.campanha_id ?? "");
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "campanha_id" }, 400);
        return json({ ok: true, recontados: await recontar(id, 30) });
      }
      case "versao":
        return json({ versao: VERSAO_DISPARO, grupos_alvo: true, configurar_grupo: true, permissoes: true, refazer_admins: true });
      case "refazer_admins": {
        // Refaz SÓ a etapa admins de um grupo criado pelo CRM (botão "Refazer admins" no Histórico): adiciona os
        // admins da campanha que não estão no grupo e promove. Ação real no WhatsApp; quem clica é o dono.
        const id = String(body?.criacao_id ?? "");
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "criacao_id" }, 400);
        const { data: cr } = await db.from("grupos_criacoes").select("id, campanha_id, chat_id, avisos").eq("id", id).maybeSingle();
        if (!cr) return json({ error: "criação não encontrada" }, 404);
        if (!chatIdGrupoValido(cr.chat_id)) return json({ error: "esta criação não chegou a criar o grupo (sem @g.us)" }, 400);
        const { data: c } = await db.from("grupos_campanhas").select("numero_id, encerrada, admins_telefones").eq("id", cr.campanha_id).maybeSingle();
        if (!c) return json({ error: "campanha não encontrada" }, 404);
        if (c.encerrada) return json({ error: "campanha encerrada" }, 409);
        const admins = ((c.admins_telefones ?? []) as string[]).map((t) => telefoneAdmin(String(t))).filter((t): t is string => Boolean(t));
        if (!admins.length) return json({ error: "a campanha não tem admins cadastrados" }, 400);
        const sessao = await sessaoDaCampanha(c.numero_id);
        await sincronizarAllowlist([cr.chat_id]);
        let ok = true;
        let texto: string;
        try {
          texto = await aplicarAdmins(portaCriacao, cr.chat_id, admins, sessao ? { sessao } : {});
        } catch (e) {
          if (e instanceof SemSessao) throw e;
          ok = false;
          texto = e instanceof ErroProxy ? erroProxyLegivel(e.status, e.detalhe) : msgErro(e);
        }
        // o aviso antigo de admins sai; se ainda falhou, entra o novo (legível)
        const avisos = ((cr.avisos ?? []) as string[]).filter((a) => !a.startsWith("admins:"));
        if (!ok) avisos.push(`admins: ${texto}`.slice(0, 300));
        await db.from("grupos_criacoes").update({ avisos, updated_at: new Date().toISOString() }).eq("id", id);
        return json({ ok, texto });
      }
      case "permissoes": {
        // só leitura: group-info de até 20 grupos (o proxy novo diz se o número é admin e se só admins enviam)
        const ids = Array.isArray(body?.chat_ids) ? [...new Set((body.chat_ids as unknown[]).filter(chatIdGrupoValido))].slice(0, 20) : [];
        if (!ids.length) return json({ error: "chat_ids" }, 400);
        const sessao = await sessaoDaCampanha(numeroId);
        // a permissão é DESTE número: só grava nos grupos das campanhas dele
        const qc = db.from("grupos_campanhas").select("id");
        const { data: campsDoNumero } = await (numeroId ? qc.eq("numero_id", numeroId) : qc.is("numero_id", null));
        const idsCamp = (campsDoNumero ?? []).map((c: { id: string }) => c.id);
        const grupos: Record<string, unknown>[] = [];
        for (const chatId of ids) {
          try {
            const info = await chamarProxy("group-info", { chatId, ...(sessao ? { sessao } : {}) });
            const r = {
              chatId, name: info?.name ?? null, participants: Number.isFinite(info?.participants) ? info.participants : null,
              souAdmin: typeof info?.souAdmin === "boolean" ? info.souAdmin : null,
              announce: typeof info?.announce === "boolean" ? info.announce : null,
              locked: typeof info?.locked === "boolean" ? info.locked : null,
            };
            grupos.push(r);
            // guarda no grupo (em todas as campanhas em que ele está) para a tela mostrar sem reler
            if ((r.souAdmin !== null || r.announce !== null) && idsCamp.length) {
              await db.from("grupos_campanha_grupos").update({
                sou_admin: r.souAdmin, anuncio: r.announce, permissao_em: new Date().toISOString(),
              }).eq("chat_id", chatId).in("campanha_id", idsCamp);
            }
          } catch (e) {
            if (e instanceof ErroProxy && e.status === 429) { grupos.push({ chatId, erro: "limite de leitura do proxy; tente em 1 min" }); break; }
            grupos.push({ chatId, erro: msgErro(e) });
          }
        }
        return json({ grupos });
      }
      case "configurar_grupo": {
        const id = String(body?.grupo_id ?? "");
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "grupo_id" }, 400);
        const acoes = (body?.acoes && typeof body.acoes === "object" ? body.acoes : {}) as Record<string, unknown>;
        const { data: g } = await db.from("grupos_campanha_grupos")
          .select("id, chat_id, campanha_id, grupos_campanhas!inner(numero_id, encerrada)").eq("id", id).maybeSingle();
        if (!g?.chat_id) return json({ error: "grupo sem id (@g.us)" }, 400);
        const camp = (g as unknown as { grupos_campanhas: { numero_id: string | null; encerrada: boolean } }).grupos_campanhas;
        if (camp.encerrada) return json({ error: "campanha encerrada" }, 409);
        const sessao = await sessaoDaCampanha(camp.numero_id);
        const extra = sessao ? { sessao } : {};
        await sincronizarAllowlist([g.chat_id]);
        const feito: string[] = [];
        const erros: string[] = [];
        const tentar = async (nome: string, fazer: () => Promise<unknown>) => {
          try { await fazer(); feito.push(nome); } catch (e) {
            erros.push(`${nome}: ${msgErro(e)}`);
            if (e instanceof ErroProxy && e.status === 429) throw e;
          }
        };
        const patch: Record<string, unknown> = {};
        try {
          if (typeof acoes.nome === "string" && acoes.nome.trim()) {
            const nome = acoes.nome.trim().slice(0, 100);
            await tentar("nome", () => chamarProxy("group-subject", { chatId: g.chat_id, subject: nome, ...extra }));
            if (feito.includes("nome")) patch.nome = nome.slice(0, 120);
          }
          if (typeof acoes.descricao === "string") {
            await tentar("descrição", () => chamarProxy("group-description", { chatId: g.chat_id, description: (acoes.descricao as string).slice(0, 1024), ...extra }));
          }
          if (typeof acoes.foto_path === "string" && /^[A-Za-z0-9/_.-]{3,300}$/.test(acoes.foto_path)) {
            await tentar("foto", async () => chamarProxy("group-picture", { chatId: g.chat_id, url: await urlAssinada(acoes.foto_path as string), ...extra }, { timeoutMs: 40_000 }));
          }
          const ajustes: Record<string, boolean> = {};
          if (typeof acoes.so_admins_enviam === "boolean") ajustes.announce = acoes.so_admins_enviam;
          if (typeof acoes.so_admins_editam === "boolean") ajustes.locked = acoes.so_admins_editam;
          if (Object.keys(ajustes).length) {
            await tentar("ajustes", () => chamarProxy("group-settings", { chatId: g.chat_id, ...ajustes, ...extra }));
            if (feito.includes("ajustes") && "announce" in ajustes) { patch.travado = ajustes.announce; patch.anuncio = ajustes.announce; }
          }
          if (Array.isArray(acoes.promover) && acoes.promover.length) {
            const tels = (acoes.promover as unknown[]).map((t) => telefoneAdmin(String(t))).filter((t): t is string => Boolean(t)).slice(0, 10);
            // adiciona quem não está e promove (21/10/2026; antes só promovia e falhava com "proxy 502")
            if (tels.length) await tentar("admins", () => aplicarAdmins(portaCriacao, g.chat_id, tels, extra));
          }
        } catch (e) {
          // 429: para aqui; o que já foi feito fica registrado
          erros.push(`parado: ${msgErro(e)}`);
        }
        if (Object.keys(patch).length) await db.from("grupos_campanha_grupos").update(patch).eq("id", id);
        return json({ ok: erros.length === 0, feito, erros });
      }
      default:
        return json({ error: "modo inválido" }, 400);
    }
  } catch (e) {
    if (e instanceof SemSessao) return json({ error: e.message }, 409);
    console.error("grupos-disparo-tick", msgErro(e));
    return json({ error: msgErro(e) }, e instanceof ErroProxy ? 502 : 500);
  }
});
