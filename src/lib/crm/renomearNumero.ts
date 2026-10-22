// Renomear um número do WhatsApp (/crm/conexoes): muda SÓ o rótulo `apelido` de crm_numeros.
// A sessão do OpenWA (`sessao_openwa`) é a ligação com a VPS e nunca é renomeada por aqui.
//
// Caminho principal: RPC crm_numero_renomear (migration 20261102110000) — valida 2-40, trim e nome único
// no banco. Sem a RPC ainda no banco (migration não rodada), cai no UPDATE direto do apelido, que a RLS de
// UPDATE para aprovado já permite; a validação da tela vale nos dois caminhos.
import { db as dbTabelas } from "@/lib/crmAutomacoes";

type RespostaBanco = { data: unknown; error: { code?: string; message?: string } | null };
// `db` é o mesmo cliente supabase (tipado só com from); a RPC é nova e ainda não está no types.ts gerado
const db = dbTabelas as typeof dbTabelas & { rpc: (fn: string, args?: Record<string, unknown>) => Promise<RespostaBanco> };

export const NOME_NUMERO_MIN = 2;
export const NOME_NUMERO_MAX = 40;

/** Evento de janela disparado depois de renomear: telas abertas (Conversas) releem os números. */
export const EVENTO_NUMEROS_ALTERADOS = "crm-numeros-alterados";

export function normalizarNomeNumero(nome: string): string {
  return (nome ?? "").replace(/\s+/g, " ").trim();
}

/** Erro em português ou null quando o nome serve. `outros` = os demais números (para checar repetido). */
export function validarNomeNumero(
  nome: string,
  outros: ReadonlyArray<{ id: string; apelido: string }>,
  idAtual: string,
): string | null {
  const n = normalizarNomeNumero(nome);
  if (n.length < NOME_NUMERO_MIN) return `O nome precisa ter pelo menos ${NOME_NUMERO_MIN} caracteres.`;
  if (n.length > NOME_NUMERO_MAX) return `O nome pode ter no máximo ${NOME_NUMERO_MAX} caracteres.`;
  const chave = n.toLocaleLowerCase("pt-BR");
  if (outros.some((o) => o.id !== idAtual && normalizarNomeNumero(o.apelido).toLocaleLowerCase("pt-BR") === chave)) {
    return `Já existe um número com o nome "${n}".`;
  }
  return null;
}

type ErroBanco = { code?: string; message?: string } | null | undefined;

/** A RPC ainda não existe no banco (PostgREST PGRST202 / Postgres 42883). */
export function rpcAusente(erro: ErroBanco): boolean {
  if (!erro) return false;
  return erro.code === "PGRST202" || erro.code === "42883" || /crm_numero_renomear/.test(String(erro.message ?? "")) && /not find|does not exist|não existe/i.test(String(erro.message ?? ""));
}

function mensagemDoErro(erro: ErroBanco): string {
  if (!erro) return "Não consegui salvar o nome.";
  if (erro.code === "23505") return erro.message || "Já existe um número com esse nome.";
  if (erro.code === "42501") return "Sem permissão para renomear números.";
  return erro.message || "Não consegui salvar o nome.";
}

/** Salva o nome e devolve o nome gravado (já normalizado). Lança Error com mensagem em português. */
export async function renomearNumero(id: string, nome: string): Promise<string> {
  const limpo = normalizarNomeNumero(nome);
  const rpc = await db.rpc("crm_numero_renomear", { p_id: id, p_nome: limpo });
  if (!rpc.error) {
    const linha = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { apelido?: string } | null;
    return linha?.apelido ?? limpo;
  }
  if (!rpcAusente(rpc.error)) throw new Error(mensagemDoErro(rpc.error));

  // migration ainda não rodou: só o apelido, nada mais
  const { data, error } = await db.from("crm_numeros").update({ apelido: limpo }).eq("id", id).select("id, apelido");
  if (error) throw new Error(mensagemDoErro(error));
  const linhas = (data ?? []) as { apelido: string }[];
  if (!linhas.length) throw new Error("Sem permissão para renomear este número.");
  return linhas[0].apelido;
}

/** Avisa as telas abertas que os números mudaram. */
export function avisarNumerosAlterados(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO_NUMEROS_ALTERADOS));
}
