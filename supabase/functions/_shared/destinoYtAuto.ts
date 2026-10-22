// Destino YouTube automático: toda live nasce (ou passa a ter, ao abrir o estúdio) o canal conectado como destino,
// sem clique. Ativo, "Não listado", título = título da live. Idempotente: nunca duplica (confere antes e, com a
// migração 20261110090000, o índice único (room_id, yt_conta_id) barra a corrida de duas abas abrindo juntas).
//
// Não cria quando: a sala está no ar (não mexe em transmissão rolando), a sala é de um webinário (página própria,
// não vai pro YouTube sozinha), já existe destino YouTube conectado (mesmo desligado: desligar foi escolha de quem
// opera; o botão "Usar meu canal" religa com ativar=true) ou não há conta conectada.
// cliente do Supabase por estrutura (sem importar esm.sh: o arquivo também roda nos testes do front)
// deno-lint-ignore no-explicit-any
type SupabaseClient = { from: (tabela: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SERVIDOR_YT_RTMPS = "rtmps://a.rtmps.youtube.com/live2";

type DestYt = { id: string; ativo: boolean; yt_conta_id?: string | null };
type Conta = { id: string; titulo?: string | null; status?: string | null; padrao?: boolean | null };

export type DecisaoYt =
  | { acao: "nada"; motivo: "no_ar" | "webinario" | "ja_tem" | "sem_conta" }
  | { acao: "criar"; conta: Conta }
  | { acao: "ativar"; destinoId: string };

export function decidirDestinoYt(o: {
  status: string | null | undefined;
  ligadaAWebinar: boolean;
  destinosYt: DestYt[];
  contas: Conta[];
  ativar?: boolean;
  /** canal escolhido (criar live, reprise, semana); sem ele vale o padrão e depois o primeiro conectado */
  contaId?: string | null;
}): DecisaoYt {
  if (o.status === "ao_vivo") return { acao: "nada", motivo: "no_ar" };
  if (o.ligadaAWebinar) return { acao: "nada", motivo: "webinario" };
  const conectadas = o.contas.filter((c) => c.status === "conectado");
  if (o.contaId) {
    // canal escolhido: só olha os destinos DESTE canal (outro canal na mesma live é escolha de quem opera)
    const doCanal = o.destinosYt.filter((d) => d.yt_conta_id === o.contaId);
    if (doCanal.some((d) => d.ativo)) return { acao: "nada", motivo: "ja_tem" };
    if (doCanal.length) return o.ativar ? { acao: "ativar", destinoId: doCanal[0].id } : { acao: "nada", motivo: "ja_tem" };
    const conta = conectadas.find((c) => c.id === o.contaId);
    return conta ? { acao: "criar", conta } : { acao: "nada", motivo: "sem_conta" };
  }
  if (o.destinosYt.some((d) => d.ativo)) return { acao: "nada", motivo: "ja_tem" };
  if (o.destinosYt.length) return o.ativar ? { acao: "ativar", destinoId: o.destinosYt[0].id } : { acao: "nada", motivo: "ja_tem" };
  const conta = canalPadrao(conectadas);
  return conta ? { acao: "criar", conta } : { acao: "nada", motivo: "sem_conta" };
}

/** Canal padrão: o marcado como padrão; sem marca, o primeiro conectado (a lista já vem em ordem de conexão). */
export function canalPadrao<T extends Conta>(contas: T[]): T | null {
  const c = contas.filter((x) => x.status === "conectado");
  return c.find((x) => x.padrao) ?? c[0] ?? null;
}

export function linhaDestinoYtAuto(sala: { id: string; titulo?: string | null }, conta: Conta) {
  const titulo = String(sala.titulo ?? "").replace(/[<>]/g, "").trim().slice(0, 100) || "Ao vivo";
  return {
    room_id: sala.id,
    tipo: "youtube",
    modo: "youtube_api",
    nome: `YouTube · ${String(conta.titulo || "canal")}`.slice(0, 80),
    rtmp_url: SERVIDOR_YT_RTMPS,
    chave_final: "conta conectada",
    yt_conta_id: conta.id,
    yt_titulo: titulo,
    yt_descricao: "",
    yt_privacidade: "unlisted",
    ativo: true,
    updated_at: new Date().toISOString(),
  };
}

export type ResultadoGarantir = { criado: boolean; ativado: boolean; destino_id: string | null; motivo?: string };

/** Garante o destino YouTube na sala. `contas` opcional (o lote do "conectar conta" já tem a lista). */
export async function garantirDestinoYt(
  db: SupabaseClient,
  sala: { id: string; titulo?: string | null; status?: string | null },
  o: { ativar?: boolean; contas?: Conta[]; contaId?: string | null } = {},
): Promise<ResultadoGarantir> {
  const [{ data: dests }, { data: webs }, contas] = await Promise.all([
    db.from("live_destinations").select("id, ativo, yt_conta_id").eq("room_id", sala.id).eq("modo", "youtube_api"),
    db.from("webinars").select("id").eq("live_room_id", sala.id).limit(1),
    o.contas ? Promise.resolve(o.contas) : contasConectadas(db),
  ]);
  const dec = decidirDestinoYt({ status: sala.status, ligadaAWebinar: !!webs?.length, destinosYt: (dests ?? []) as DestYt[], contas, ativar: o.ativar, contaId: o.contaId });
  if (dec.acao === "nada") return { criado: false, ativado: false, destino_id: (dests?.[0] as DestYt | undefined)?.id ?? null, motivo: dec.motivo };
  if (dec.acao === "ativar") {
    const { error } = await db.from("live_destinations").update({ ativo: true, updated_at: new Date().toISOString() }).eq("id", dec.destinoId).eq("no_ar", false);
    if (error) throw new Error(error.message);
    return { criado: false, ativado: true, destino_id: dec.destinoId };
  }
  const { data, error } = await db.from("live_destinations").insert(linhaDestinoYtAuto(sala, dec.conta)).select("id").maybeSingle();
  if (error) {
    // 23505 = outra aba criou no mesmo instante (índice único room_id+yt_conta_id): já existe, não é erro
    if ((error as { code?: string }).code === "23505") return { criado: false, ativado: false, destino_id: null, motivo: "ja_tem" };
    throw new Error(error.message);
  }
  return { criado: true, ativado: false, destino_id: (data as { id?: string } | null)?.id ?? null };
}

/** Contas conectadas em ordem de conexão, com o padrão (sem a migração 20261110120000, sem a coluna). */
export async function contasConectadas(db: SupabaseClient): Promise<Conta[]> {
  const com = await db.from("yt_contas").select("id, titulo, status, padrao").eq("status", "conectado").order("criado_em");
  if (!com.error) return (com.data ?? []) as Conta[];
  const sem = await db.from("yt_contas").select("id, titulo, status").eq("status", "conectado").order("criado_em");
  return (sem.data ?? []) as Conta[];
}

/** Conta conectada agora: vira destino nas lives em rascunho/agendadas que ainda não têm YouTube. */
export async function adicionarContaNasLives(db: SupabaseClient, conta: Conta, limite = 200): Promise<number> {
  const { data: salas } = await db.from("live_rooms").select("id, titulo, status").eq("status", "rascunho").order("created_at", { ascending: false }).limit(limite);
  let n = 0;
  for (const s of salas ?? []) {
    const r = await garantirDestinoYt(db, s as { id: string; titulo: string; status: string }, { contas: [conta] }).catch(() => null);
    if (r?.criado) n++;
  }
  return n;
}
