// ============================================================================
// mobile-v1 — versão de ARQUIVO ÚNICO (gerada, não edite à mão)
// ============================================================================
// Cole este arquivo inteiro no editor de Edge Functions do painel do Supabase.
//
// Gerado por scripts/gerar-bundle-edge.mjs a partir de:
//   supabase/functions/mobile-v1/index.ts
//   supabase/functions/mobile-v1/lib.ts
//
// Para mudar o comportamento, edite os originais e rode o script de novo.
// ============================================================================

// Edge Function: mobile-v1
// API do app nativo da aluna (iOS / Android).
//
// Duas decisões que valem explicar:
//
// 1. Uma tela = uma requisição. No 4G, quatro round-trips sequenciais viram
//    dois segundos de tela branca. Cada endpoint aqui devolve tudo o que a
//    tela precisa, já no formato em que ela renderiza.
//
// 2. O cliente é criado com o JWT DA ALUNA, nunca com a service_role. A RLS
//    continua sendo quem decide o que ela pode ver — esta função só agrega.
//    Se um endpoint vazar a query errada, o banco ainda segura.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ---- inline de supabase/functions/mobile-v1/lib.ts -------------------------

// Lógica pura da API mobile, sem nenhuma dependência de Deno ou de rede.
// Fica separada para poder ser testada pelo vitest do projeto
// (`src/test/mobileApi.test.ts`) — o resto do index.ts precisa de runtime Deno.

/**
 * Compara versões no formato "1.2.10". Devolve true quando `atual` é anterior
 * a `minima`. Comparação numérica por segmento: "1.2.10" é MAIOR que "1.2.9",
 * o que a comparação de string erraria.
 */
function versaoMenorQue(atual: string, minima: string): boolean {
  const a = atual.split(".").map((n) => parseInt(n, 10) || 0);
  const m = minima.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, m.length); i++) {
    const x = a[i] ?? 0;
    const y = m[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Extrai a rota do pathname. O Supabase serve a função em
 * `/functions/v1/mobile-v1/...`, mas em dev local ela responde em
 * `/mobile-v1/...` — as duas formas precisam cair na mesma rota.
 */
function normalizarCaminho(pathname: string): string {
  return pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/mobile-v1\/?/, "")
    .replace(/\/+$/, "");
}

/** Achata a linha de prescrição no formato que o app nativo renderiza. */
function formatarExercicio(p: Record<string, any>) {
  const ex = p.exercicios ?? {};
  return {
    id: p.id,
    ordem: p.ordem,
    nome: ex.nome ?? "Exercício",
    equipamento: ex.equipamento ?? null,
    grupo_muscular: ex.grupo_muscular ?? null,
    instrucoes: ex.instrucoes ?? null,
    // Já montado: o app nativo não precisa saber parsear link do YouTube
    video: ex.youtube_id
      ? {
          youtube_id: ex.youtube_id,
          embed_url: `https://www.youtube-nocookie.com/embed/${ex.youtube_id}?rel=0&modestbranding=1&playsinline=1`,
          thumbnail_url: ex.thumbnail_url ?? `https://i.ytimg.com/vi/${ex.youtube_id}/hqdefault.jpg`,
        }
      : null,
    series: p.series,
    repeticoes: p.repeticoes,
    carga_sugerida: p.carga_sugerida ?? null,
    cadencia: p.cadencia ?? null,
    descanso_seg: p.descanso_seg ?? null,
    metodo_avancado: p.metodo_avancado ?? null,
    observacao: p.observacao ?? null,
    // Mesma letra = bi-set / tri-set; o app agrupa por este campo
    agrupamento: p.agrupamento ?? null,
  };
}

/**
 * Agrupa a lista de exercícios em blocos: exercícios seguidos com a mesma
 * letra viram um bi-set/tri-set. O app renderiza cada bloco como um cartão.
 */
function agruparEmBlocos<T extends { agrupamento?: string | null; id: string }>(
  exercicios: T[],
): { chave: string; agrupamento: string | null; itens: T[] }[] {
  const blocos: { chave: string; agrupamento: string | null; itens: T[] }[] = [];
  for (const ex of exercicios) {
    const ultimo = blocos[blocos.length - 1];
    if (ex.agrupamento && ultimo?.agrupamento === ex.agrupamento) {
      ultimo.itens.push(ex);
    } else {
      blocos.push({ chave: ex.id, agrupamento: ex.agrupamento ?? null, itens: [ex] });
    }
  }
  return blocos;
}

/** Valida nota de 0 a 10. Lança RangeError, que o router traduz em HTTP 400. */
function validarNota(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > 10) {
    throw new RangeError("As notas vão de 0 a 10.");
  }
  return Math.round(n);
}

/** Aceita "62,4" e "62.4". Devolve null quando vazio. */
function validarPeso(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (Number.isNaN(n) || n <= 0 || n > 400) {
    throw new RangeError("Peso fora do intervalo esperado.");
  }
  return n;
}

// ---- fim do inline ---------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-versao, x-app-plataforma",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const JSON_HEADERS = { ...CORS, "Content-Type": "application/json; charset=utf-8" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/** Duração das URLs assinadas de PDF/foto. Curta: o app rebusca ao abrir a tela. */
const URL_ASSINADA_SEGUNDOS = 60 * 60;

type Ctx = {
  db: SupabaseClient;
  userId: string;
  alunaId: string;
  plataforma: string | null;
  appVersao: string | null;
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function erro(codigo: string, mensagem: string, status: number) {
  return new Response(JSON.stringify({ erro: { codigo, mensagem } }), {
    status,
    headers: JSON_HEADERS,
  });
}

const hoje = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- endpoints

/**
 * Tudo que o app precisa para abrir: perfil, config, fase atual com a
 * prescrição inteira, dieta vigente, ciclo de feedback e notificações.
 * O app guarda isso em cache e só rebusca o que mudou.
 */
async function bootstrap(ctx: Ctx) {
  const [perfil, config, treino, dieta, ciclo, naoLidas, enviouHoje] = await Promise.all([
    carregarPerfil(ctx),
    carregarConfig(ctx),
    carregarTreino(ctx),
    carregarDieta(ctx),
    carregarCiclo(ctx),
    contarNaoLidas(ctx),
    jaEnviouHoje(ctx),
  ]);

  return ok({
    perfil,
    config,
    treino,
    dieta,
    feedback: { ciclo, ja_enviei_hoje: enviouHoje },
    notificacoes_nao_lidas: naoLidas,
    servidor_em: new Date().toISOString(),
  });
}

async function carregarPerfil(ctx: Ctx) {
  const { data } = await ctx.db.rpc("meu_perfil_aluna");
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) return null;
  return {
    aluna_id: linha.aluna_id,
    nome: linha.nome_completo,
    primeiro_nome: String(linha.nome_completo ?? "").trim().split(" ")[0] ?? "",
    programa: linha.programa,
    vence_em: linha.data_vencimento,
  };
}

async function carregarConfig(ctx: Ctx) {
  const { data } = await ctx.db.from("app_config").select("*").eq("id", 1).maybeSingle();
  if (!data) return { atualizacao_obrigatoria: false, manutencao: false };

  const minima = ctx.plataforma === "ios"
    ? data.versao_minima_ios
    : data.versao_minima_android;

  const precisaAtualizar = !!(ctx.appVersao && minima && versaoMenorQue(ctx.appVersao, minima));

  return {
    atualizacao_obrigatoria: precisaAtualizar,
    versao_minima: minima,
    url_loja: ctx.plataforma === "ios" ? data.url_loja_ios : data.url_loja_android,
    manutencao: data.manutencao,
    manutencao_mensagem: data.manutencao_mensagem,
    aviso: data.aviso_ativo
      ? { titulo: data.aviso_titulo, corpo: data.aviso_corpo }
      : null,
  };
}

/**
 * Fase corrente com dias e exercícios já aninhados e ordenados.
 * A RLS só devolve fases cuja data de liberação chegou, então a atual é
 * simplesmente a última da fila visível — a de ordem mais alta.
 */
async function carregarTreino(ctx: Ctx) {
  const { data: planos } = await ctx.db
    .from("aluna_planos").select("*").eq("status", "ativo").limit(1);
  const plano = planos?.[0];
  if (!plano) return null;

  const { data: planoFases } = await ctx.db
    .from("aluna_plano_fases")
    .select("*, treino_fases(*)")
    .eq("plano_id", plano.id)
    .order("ordem");

  const atual = planoFases?.[planoFases.length - 1];
  if (!atual) return null;

  const { data: dias } = await ctx.db
    .from("treino_dias").select("*").eq("fase_id", atual.fase_id).order("ordem");

  const idsDias = (dias ?? []).map((d: Record<string, unknown>) => d.id);
  const { data: prescricao } = idsDias.length
    ? await ctx.db
        .from("treino_exercicios")
        .select("*, exercicios(*)")
        .in("dia_id", idsDias)
        .order("ordem")
    : { data: [] };

  // Treinos que ela já marcou hoje, para o app não precisar de outra chamada
  const { data: logsHoje } = await ctx.db
    .from("aluna_treino_logs").select("dia_id").eq("data", hoje());
  const feitosHoje = new Set((logsHoje ?? []).map((l: Record<string, unknown>) => l.dia_id));

  return {
    plano_fase_id: atual.id,
    fase: {
      id: atual.treino_fases?.id,
      nome: atual.treino_fases?.nome,
      ordem: atual.ordem,
      objetivo: atual.treino_fases?.objetivo,
      duracao_semanas: atual.treino_fases?.duracao_semanas,
      liberada_em: atual.data_liberacao,
    },
    total_fases_liberadas: planoFases?.length ?? 0,
    dias: (dias ?? []).map((d: Record<string, unknown>) => ({
      id: d.id,
      nome: d.nome,
      foco: d.foco,
      observacao: d.observacao,
      feito_hoje: feitosHoje.has(d.id),
      exercicios: (prescricao ?? [])
        .filter((p: Record<string, unknown>) => p.dia_id === d.id)
        .map(formatarExercicio),
    })),
  };
}

async function carregarDieta(ctx: Ctx) {
  const { data } = await ctx.db
    .from("aluna_dietas").select("*")
    .eq("ativo", true)
    .lte("vigencia_inicio", hoje())
    .order("vigencia_inicio", { ascending: false })
    .limit(1);

  const d = data?.[0];
  if (!d) return null;
  if (d.vigencia_fim && d.vigencia_fim < hoje()) return null;

  let arquivoUrl: string | null = null;
  if (d.tipo === "pdf" && d.arquivo_path) {
    const { data: assinada } = await ctx.db.storage
      .from("dietas")
      .createSignedUrl(d.arquivo_path, URL_ASSINADA_SEGUNDOS);
    arquivoUrl = assinada?.signedUrl ?? null;
  }

  return {
    id: d.id,
    titulo: d.titulo,
    tipo: d.tipo,
    conteudo: d.conteudo,
    observacao: d.observacao,
    arquivo_url: arquivoUrl,
    arquivo_nome: d.arquivo_nome,
    arquivo_expira_em: arquivoUrl
      ? new Date(Date.now() + URL_ASSINADA_SEGUNDOS * 1000).toISOString()
      : null,
    vigencia_inicio: d.vigencia_inicio,
    vigencia_fim: d.vigencia_fim,
  };
}

async function carregarCiclo(ctx: Ctx) {
  const { data } = await ctx.db.from("feedback_ciclos").select("*").maybeSingle();
  if (!data) return null;
  return {
    periodicidade: data.periodicidade,
    proxima_data: data.proxima_data,
    ativo: data.ativo,
  };
}

async function jaEnviouHoje(ctx: Ctx) {
  const { count } = await ctx.db
    .from("feedback_respostas")
    .select("id", { count: "exact", head: true })
    .eq("data_referencia", hoje());
  return (count ?? 0) > 0;
}

async function contarNaoLidas(ctx: Ctx) {
  const { count } = await ctx.db
    .from("notificacoes")
    .select("id", { count: "exact", head: true })
    .is("lida_em", null)
    .not("enviada_em", "is", null);
  return count ?? 0;
}

// -------------------------------------------------------------- histórico

async function historicoFeedback(ctx: Ctx) {
  const { data, error } = await ctx.db
    .from("feedback_respostas").select("*")
    .order("data_referencia", { ascending: false })
    .limit(60);
  if (error) throw error;

  return ok({
    ciclo: await carregarCiclo(ctx),
    ja_enviei_hoje: await jaEnviouHoje(ctx),
    respostas: (data ?? []).map((f: Record<string, any>) => ({
      id: f.id,
      data: f.data_referencia,
      peso: f.peso,
      adesao_dieta: f.adesao_dieta,
      adesao_treino: f.adesao_treino,
      energia: f.energia,
      sono: f.sono,
      intestino: f.intestino,
      dificuldades: f.dificuldades,
      observacao: f.observacao,
      resposta_time: f.resposta_time,
      respondido_em: f.respondido_em,
    })),
  });
}

async function evolucao(ctx: Ctx) {
  const [logsRes, feedbacksRes] = await Promise.all([
    ctx.db.from("aluna_treino_logs").select("*").order("data", { ascending: false }).limit(180),
    ctx.db.from("feedback_respostas").select("data_referencia, peso")
      .not("peso", "is", null).order("data_referencia"),
  ]);

  const logs = logsRes.data ?? [];
  const limite = new Date();
  limite.setDate(limite.getDate() - 30);

  return ok({
    treinos_30_dias: logs.filter(
      (l: Record<string, any>) => new Date(`${l.data}T12:00:00`) >= limite,
    ).length,
    serie_peso: (feedbacksRes.data ?? []).map((f: Record<string, any>) => ({
      data: f.data_referencia,
      peso: Number(f.peso),
    })),
    treinos: logs.map((l: Record<string, any>) => ({
      id: l.id,
      data: l.data,
      duracao_min: l.duracao_min,
      intensidade: l.intensidade,
    })),
  });
}

async function listarNotificacoes(ctx: Ctx) {
  const { data, error } = await ctx.db
    .from("notificacoes").select("*")
    .not("enviada_em", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return ok({
    notificacoes: (data ?? []).map((n: Record<string, any>) => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      corpo: n.corpo,
      dados: n.dados,
      enviada_em: n.enviada_em,
      lida: !!n.lida_em,
    })),
  });
}

// ---------------------------------------------------------------- escritas

async function concluirTreino(ctx: Ctx, body: Record<string, any>) {
  if (!body.dia_id) return erro("dia_obrigatorio", "Informe o dia_id do treino.", 400);

  const linha = {
    aluna_id: ctx.alunaId,
    dia_id: body.dia_id,
    plano_fase_id: body.plano_fase_id ?? null,
    data: body.data ?? hoje(),
    concluido: true,
    duracao_min: body.duracao_min ?? null,
    intensidade: body.intensidade ?? null,
    observacao: body.observacao ?? null,
  };

  const { error } = await ctx.db
    .from("aluna_treino_logs")
    .upsert(linha, { onConflict: "aluna_id,dia_id,data" });
  if (error) throw error;

  return ok({ concluido: true, data: linha.data });
}

async function desfazerTreino(ctx: Ctx, body: Record<string, any>) {
  if (!body.dia_id) return erro("dia_obrigatorio", "Informe o dia_id do treino.", 400);

  const { error } = await ctx.db
    .from("aluna_treino_logs").delete()
    .eq("dia_id", body.dia_id)
    .eq("data", body.data ?? hoje());
  if (error) throw error;

  return ok({ concluido: false });
}

async function enviarFeedback(ctx: Ctx, body: Record<string, any>) {
  const linha = {
    aluna_id: ctx.alunaId,
    data_referencia: body.data ?? hoje(),
    peso: validarPeso(body.peso),
    medidas: body.medidas ?? {},
    adesao_dieta: validarNota(body.adesao_dieta),
    adesao_treino: validarNota(body.adesao_treino),
    energia: validarNota(body.energia),
    sono: validarNota(body.sono),
    intestino: body.intestino ?? null,
    ciclo_menstrual: body.ciclo_menstrual ?? null,
    dificuldades: body.dificuldades ?? null,
    observacao: body.observacao ?? null,
    fotos: body.fotos ?? [],
    status: "respondido",
  };

  const { error } = await ctx.db
    .from("feedback_respostas")
    .upsert(linha, { onConflict: "aluna_id,data_referencia" });
  if (error) throw error;

  return ok({ enviado: true, data: linha.data_referencia });
}

async function registrarDispositivo(ctx: Ctx, body: Record<string, any>) {
  if (!body.token) return erro("token_obrigatorio", "Informe o token de push.", 400);

  const { data, error } = await ctx.db.rpc("registrar_dispositivo", {
    _token: body.token,
    _plataforma: body.plataforma ?? ctx.plataforma ?? "android",
    _provedor: body.provedor ?? "expo",
    _app_versao: body.app_versao ?? ctx.appVersao ?? null,
    _modelo: body.modelo ?? null,
  });
  if (error) throw error;

  return ok({ dispositivo_id: data });
}

async function removerDispositivo(ctx: Ctx, body: Record<string, any>) {
  if (!body.token) return erro("token_obrigatorio", "Informe o token de push.", 400);
  const { error } = await ctx.db.from("dispositivos").delete().eq("token", body.token);
  if (error) throw error;
  return ok({ removido: true });
}

async function marcarNotificacaoLida(ctx: Ctx, body: Record<string, any>) {
  const agora = new Date().toISOString();
  let q = ctx.db.from("notificacoes").update({ lida_em: agora }).is("lida_em", null);
  if (body.id) q = q.eq("id", body.id);
  const { error } = await q;
  if (error) throw error;
  return ok({ marcadas: true });
}

async function exportarDados(ctx: Ctx) {
  const { data, error } = await ctx.db.rpc("exportar_meus_dados");
  if (error) throw error;
  return ok(data);
}

/**
 * Exclusão de conta — App Store Review 5.1.1(v).
 *
 * Os arquivos saem ANTES da RPC: depois dela o vínculo some e nem o dono
 * consegue mais localizar a própria pasta.
 *
 * Este é o único ponto da API que usa service_role, e só para o storage. A
 * aluna tem SELECT nos buckets dela, não DELETE — de propósito, senão poderia
 * apagar o PDF da dieta que o Breno enviou. Excluir a conta é a exceção
 * legítima, e a identidade já foi verificada: `ctx.alunaId` veio do
 * `vincular_meu_acesso` sobre o JWT dela, não de nada que o cliente mandou.
 */
async function excluirConta(ctx: Ctx, body: Record<string, any>) {
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (chaveServico) {
    const admin = createClient(SUPABASE_URL, chaveServico, {
      auth: { persistSession: false },
    });
    for (const bucket of ["dietas", "feedback-fotos"]) {
      const { data: arquivos } = await admin.storage.from(bucket).list(ctx.alunaId);
      if (arquivos?.length) {
        const { error } = await admin.storage
          .from(bucket)
          .remove(arquivos.map((a: { name: string }) => `${ctx.alunaId}/${a.name}`));
        // Arquivo órfão não pode impedir a exclusão da conta: a Apple exige que
        // o pedido seja atendido. Registra e segue.
        if (error) console.error("não apaguei arquivos de", bucket, error);
      }
    }
  } else {
    console.error("SUPABASE_SERVICE_ROLE_KEY ausente: arquivos ficarão órfãos");
  }

  const { data, error } = await ctx.db.rpc("excluir_minha_conta", {
    _motivo: body?.motivo ?? null,
  });
  if (error) throw error;

  return ok(data);
}

// ------------------------------------------------------------------ router

type Rota = {
  metodo: string;
  caminho: string;
  handler: (ctx: Ctx, body: Record<string, any>) => Promise<Response>;
};

const ROTAS: Rota[] = [
  { metodo: "GET",  caminho: "bootstrap",     handler: (c) => bootstrap(c) },
  { metodo: "GET",  caminho: "treino",        handler: async (c) => ok({ treino: await carregarTreino(c) }) },
  { metodo: "GET",  caminho: "dieta",         handler: async (c) => ok({ dieta: await carregarDieta(c) }) },
  { metodo: "GET",  caminho: "feedback",      handler: (c) => historicoFeedback(c) },
  { metodo: "GET",  caminho: "evolucao",      handler: (c) => evolucao(c) },
  { metodo: "GET",  caminho: "notificacoes",  handler: (c) => listarNotificacoes(c) },
  { metodo: "GET",  caminho: "exportar",      handler: (c) => exportarDados(c) },

  { metodo: "POST", caminho: "treino/concluir", handler: concluirTreino },
  { metodo: "POST", caminho: "treino/desfazer", handler: desfazerTreino },
  { metodo: "POST", caminho: "feedback",        handler: enviarFeedback },
  { metodo: "POST", caminho: "dispositivo",     handler: registrarDispositivo },
  { metodo: "POST", caminho: "notificacoes/lida", handler: marcarNotificacaoLida },

  { metodo: "DELETE", caminho: "dispositivo", handler: removerDispositivo },
  { metodo: "DELETE", caminho: "conta",       handler: excluirConta },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // /functions/v1/mobile-v1/treino/concluir -> "treino/concluir"
  const caminho = normalizarCaminho(new URL(req.url).pathname);

  const plataforma = req.headers.get("x-app-plataforma");
  const appVersao = req.headers.get("x-app-versao");

  try {
    const autorizacao = req.headers.get("authorization") ?? "";
    if (!autorizacao.toLowerCase().startsWith("bearer ")) {
      return erro("sem_token", "Faça login para continuar.", 401);
    }

    // Cliente com o token DELA: a RLS segue valendo dentro desta função.
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: autorizacao } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: usuario, error: erroAuth } = await db.auth.getUser();
    if (erroAuth || !usuario?.user) {
      return erro("token_invalido", "Sua sessão expirou. Entre de novo.", 401);
    }

    // Amarra o login à aluna no primeiro acesso (idempotente).
    const { data: alunaId } = await db.rpc("vincular_meu_acesso");
    if (!alunaId) {
      return erro(
        "sem_acesso",
        "Seu e-mail ainda não está vinculado a uma consultoria ativa.",
        403,
      );
    }

    const ctx: Ctx = {
      db,
      userId: usuario.user.id,
      alunaId: alunaId as string,
      plataforma,
      appVersao,
    };

    const rota = ROTAS.find((r) => r.caminho === caminho && r.metodo === req.method);
    if (!rota) {
      return erro("rota_desconhecida", `${req.method} /${caminho} não existe nesta API.`, 404);
    }

    // Manutenção derruba tudo menos o bootstrap, que é como o app descobre
    // que está em manutenção e mostra a tela certa.
    if (caminho !== "bootstrap") {
      const { data: cfg } = await db.from("app_config").select("manutencao").eq("id", 1).maybeSingle();
      if (cfg?.manutencao) {
        return erro("manutencao", "O app está em manutenção. Tente em alguns minutos.", 503);
      }
    }

    let body: Record<string, any> = {};
    if (req.method === "POST" || req.method === "DELETE") {
      body = await req.json().catch(() => ({}));
    }

    return await rota.handler(ctx, body);
  } catch (e) {
    if (e instanceof RangeError) {
      return erro("valor_invalido", e.message, 400);
    }
    console.error("mobile-v1 falhou:", caminho, e);
    return erro("erro_interno", "Não consegui completar agora. Tente de novo.", 500);
  }
});
