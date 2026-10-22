// Grupos sem nome na lista de Conversas: busca o assunto (subject) real e grava em whatsapp_contacts.name.
// Ordem: uma chamada "listar_grupos" (até 60 grupos com nome, pela sessão padrão) e, para o que sobrar,
// "info_grupo" um por um (teto por carga). Tudo pelo grupos-disparo-tick, que já fala com o proxy da VPS.
// Falhou? A lista continua mostrando "Grupo"; nada quebra e tenta de novo na próxima abertura da tela.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { contatoEhGrupo, type ContatoCRM } from "@/lib/crm/conversas";

const TETO_INFO_POR_CARGA = 15;

/** Nome que não serve: vazio, igual ao JID ou o rótulo genérico gravado pela importação. */
export function grupoSemNome(c: Pick<ContatoCRM, "phone" | "name" | "is_group">): boolean {
  if (!contatoEhGrupo(c)) return false;
  const n = (c.name ?? "").trim();
  return !n || n === c.phone || n.toLowerCase() === "grupo";
}

/** Da resposta de listar_grupos/info_grupo: mapa JID -> nome (só nomes não vazios). */
export function nomesDaResposta(resposta: unknown): Map<string, string> {
  const m = new Map<string, string>();
  const r = resposta && typeof resposta === "object" ? (resposta as Record<string, unknown>) : {};
  const lista = Array.isArray(r.grupos) ? r.grupos : [r];
  for (const g of lista) {
    if (!g || typeof g !== "object") continue;
    const { chatId, name } = g as { chatId?: unknown; name?: unknown };
    if (typeof chatId === "string" && chatId.endsWith("@g.us") && typeof name === "string" && name.trim()) {
      m.set(chatId, name.trim().slice(0, 120));
    }
  }
  return m;
}

type Invocar = (body: Record<string, unknown>) => Promise<unknown>;

const invocarPadrao: Invocar = async (body) => {
  const { data, error } = await supabase.functions.invoke("grupos-disparo-tick", { body });
  if (error) throw error;
  return data;
};

const gravarPadrao = async (id: string, nome: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("whatsapp_contacts").update({ name: nome, is_group: true }).eq("id", id);
};

/** Resolve os nomes dos grupos e devolve quantos achou. Exportada para teste. */
export async function resolverNomesGrupos(
  contatos: ContatoCRM[],
  aplicar: (id: string, nome: string) => void,
  deps: { invocar?: Invocar; gravar?: (id: string, nome: string) => Promise<void> } = {},
): Promise<number> {
  const invocar = deps.invocar ?? invocarPadrao;
  const gravar = deps.gravar ?? gravarPadrao;
  const faltam = contatos.filter(grupoSemNome);
  if (!faltam.length) return 0;

  let achados = new Map<string, string>();
  try {
    achados = nomesDaResposta(await invocar({ modo: "listar_grupos" }));
  } catch { /* segue para o info_grupo */ }

  let infos = 0;
  for (const c of faltam) {
    if (achados.has(c.phone) || infos >= TETO_INFO_POR_CARGA) continue;
    infos++;
    try {
      const um = nomesDaResposta(await invocar({ modo: "info_grupo", chat_id: c.phone }));
      um.forEach((v, k) => achados.set(k, v));
    } catch { /* grupo que o número já saiu, ponte fora: fica "Grupo" */ }
  }

  let n = 0;
  for (const c of faltam) {
    const nome = achados.get(c.phone);
    if (!nome) continue;
    aplicar(c.id, nome);
    n++;
    try { await gravar(c.id, nome); } catch { /* só local nesta sessão */ }
  }
  return n;
}

/** Roda uma vez por carga da lista (quando os contatos chegam), só com a fonte real. */
export function useNomesGrupos(contatos: ContatoCRM[], carregando: boolean, aplicar: (id: string, nome: string) => void, ligado: boolean) {
  const feito = useRef(false);
  useEffect(() => {
    if (!ligado || carregando || feito.current || !contatos.length) return;
    feito.current = true;
    resolverNomesGrupos(contatos, aplicar).catch(() => {});
  }, [contatos, carregando, aplicar, ligado]);
}
