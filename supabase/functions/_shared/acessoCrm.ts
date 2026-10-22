// Permissões do CRM nas edge functions (migration 20261123100000): a mesma regra das policies do banco.
// Quem confere é o banco, com o JWT de quem chamou (RPC crm_acesso_conferir, SECURITY DEFINER com auth.uid()):
// área + nível, número, "só as dele" e "só dos departamentos". service_role (ticks, webhooks) nunca passa por aqui.
//
// Banco sem a migration ainda (RPC inexistente): deixa passar e registra no log — sem a migration não existe
// restrição nenhuma para conferir, e a ordem certa é rodar o SQL ANTES de publicar as funções.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteUsuario = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type AreaCrm =
  | "conversas" | "kanban" | "automacao" | "disparo" | "agente_ia" | "banco" | "base_leads" | "conexao" | "configuracoes" | "lives";
export type AcaoCrm =
  | "conversas.enviar" | "conversas.transferir" | "conversas.assumir_ia" | "kanban.mover"
  | "agente_ia.editar_prompt" | "disparo.enviar" | "conexao.conectar";

export type Pedido =
  /** uma conversa (número + telefone): Conversas/Kanban, número dele, atendente e departamento */
  | { conversa: { numeroId: string | null; phone: string | null }; nivel?: 1 | 2; acao?: AcaoCrm }
  /** uma área (opcionalmente restrita a um número) */
  | { area: AreaCrm; nivel?: 1 | 2; numeroId?: string | null; acao?: AcaoCrm };

export type Resultado = { ok: true } | { ok: false; status: 403 | 500; erro: string };

const RPC_AUSENTE = new Set(["PGRST202", "42883"]);

/** Erro de "função não existe" (migration pendente). */
export const rpcAusente = (e: unknown): boolean =>
  !!e && typeof e === "object" && RPC_AUSENTE.has(String((e as { code?: string }).code));

export async function conferirAcessoCrm(cli: ClienteUsuario, pedido: Pedido): Promise<Resultado> {
  const nivel = pedido.nivel ?? 2;
  const args = "conversa" in pedido
    ? { p_area: "conversa", p_nivel: nivel, p_numero_id: pedido.conversa.numeroId, p_phone: pedido.conversa.phone }
    : { p_area: pedido.area, p_nivel: nivel, p_numero_id: pedido.numeroId ?? null, p_phone: null };
  const { data, error } = await cli.rpc("crm_acesso_conferir", args);
  if (error) {
    if (rpcAusente(error)) {
      console.warn("acessoCrm: crm_acesso_conferir não existe (migration pendente); seguindo sem restrição");
      return { ok: true };
    }
    console.error("acessoCrm: conferir falhou", error.message ?? error);
    return { ok: false, status: 500, erro: "Não consegui conferir sua permissão agora. Tente de novo." };
  }
  if (data !== true) {
    return {
      ok: false, status: 403,
      erro: "conversa" in pedido
        ? "Você não tem permissão nesta conversa (número, atendente ou departamento)."
        : "Você não tem permissão nesta área do CRM.",
    };
  }
  if (pedido.acao) {
    const r = await cli.rpc("crm_acao_minha", { p_acao: pedido.acao });
    if (r.error && !rpcAusente(r.error)) {
      console.error("acessoCrm: ação falhou", r.error.message ?? r.error);
      return { ok: false, status: 500, erro: "Não consegui conferir sua permissão agora. Tente de novo." };
    }
    if (!r.error && r.data !== true) return { ok: false, status: 403, erro: "Essa ação está desligada para o seu usuário." };
  }
  return { ok: true };
}

/** Mensagem manual pelo CRM: quem mandou vira o atendente, se a conversa ainda não tem. Falha não derruba o envio. */
export async function marcarAtendenteSeVazio(cli: ClienteUsuario, numeroId: string | null, phone: string): Promise<void> {
  const { error } = await cli.rpc("crm_atendente_assumir_se_vazio", { p_numero_id: numeroId, p_phone: phone });
  if (error && !rpcAusente(error)) console.error("acessoCrm: marcar atendente falhou", error.message ?? error);
}
