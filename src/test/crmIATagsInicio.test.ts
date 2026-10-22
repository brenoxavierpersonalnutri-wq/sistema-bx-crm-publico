// "Tags ao começar" do agente de IA (21/10/2026): quando o agente assume a conversa (gatilho, modo "todas"/Ligado,
// passo de fluxo "transferir_ia"), as tags dele entram no contato pela RPC crm_ai_aplicar_tags_inicio. Só adiciona,
// não duplica, e falha ao pôr tag NUNCA impede a IA de atender. O botão "Transferir para IA" aplica dentro da própria
// RPC SQL (migration 20261113100000), conferida aqui no texto e no Postgres local (scripts/teste-sql-tags-ia.sh).
// Banco falso: nada vai para a rede.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// módulos com import remoto (esm.sh) ou envio: fora do teste (nada aqui envia mensagem)
vi.mock("../../supabase/functions/_shared/iaCRM.ts", () => ({ completarChatCRM: vi.fn() }));
vi.mock("../../supabase/functions/_shared/multisessaoWa.ts", () => ({ multisessaoLigada: vi.fn(() => false) }));
vi.mock("../../supabase/functions/_shared/waEnvio.ts", () => ({ enviarDigitando: vi.fn(), enviarWhatsApp: vi.fn() }));
vi.mock("../../supabase/functions/_shared/waNumero.ts", () => ({ sessaoEnvio: vi.fn() }));

import {
  aplicarTagsAoIniciar,
  mesclarTagsAoIniciar,
  normalizarTagsAoIniciar,
  tagsParaAdicionar,
} from "../../supabase/functions/_shared/iaTagsInicio.ts";
import { QUANDO_ATIVAR_AVALIACAO, type AgenteGatilho } from "../../supabase/functions/_shared/iaGatilho.ts";
import { avaliarGatilhoAoReceber, transferirParaIAPorFluxo } from "../../supabase/functions/_shared/iaGatilhoDb.ts";
import { payloadAgente, type AgenteIA } from "@/lib/crm/treinarIA";

// roboAtendimentoDb puxa módulos Deno (esm.sh, Deno.env): import por caminho em variável para o tsc do app (que inclui
// src/test) não seguir o grafo; no vitest os vi.mock acima cobrem esses módulos.
const CAMINHO_ROBO = "../../supabase/functions/_shared/roboAtendimentoDb.ts";
const { roboAoReceber } = (await import(/* @vite-ignore */ CAMINHO_ROBO)) as {
  roboAoReceber: (db: unknown, p: { numeroId: string | null; telefone: string }) => Promise<string>;
};

const NUM = "11111111-1111-1111-1111-111111111111";
const FONE = "5531988887777";
const MSG = "Olá! Fui qualificada no formulário de avaliação! 🎉";

const AGENTE: AgenteGatilho = {
  id: "ag1", slug: "avaliacao", nome: "Avaliação fitness", tipo: "atendimento", prompt: "x", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: ["Fui qualificada no formulário de avaliação!"], modelo: null, temperatura: 0.1,
  ativo: false, horario_inicio: "00:00", horario_fim: "23:59", dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15,
  historico_mensagens: 20, atraso_segundos: 0, numero_id: NUM, ativacao_modo: "gatilho", ativacao_quando: QUANDO_ATIVAR_AVALIACAO,
  ativacao_max_mensagens: 3, ativacao_humano_horas: 12, tags_ao_iniciar: ["ia-avaliacao", "lead-quente"],
};

// ------------------------------------------------------------------ banco falso (cadeia do supabase-js)
type Op = { tabela: string; acao: string; filtros: string[]; valores?: unknown };
type Rpc = { fn: string; args: Record<string, unknown> };
function bancoFalso(
  resolver: (op: Op) => { data?: unknown; error?: { message: string } | null; count?: number },
  rpcResp: (r: Rpc) => { data?: unknown; error?: { message: string } | null } | "lanca" = () => ({ data: 1 }),
) {
  const ops: Op[] = [];
  const rpcs: Rpc[] = [];
  const consulta = (tabela: string) => {
    const op: Op = { tabela, acao: "select", filtros: [] };
    const q: Record<string, unknown> = {};
    const encadeia = (nome: string) => (...a: unknown[]) => { op.filtros.push(`${nome}:${a.map((x) => JSON.stringify(x)).join(",")}`); return q; };
    for (const m of ["eq", "in", "gte", "order", "limit", "is", "or", "not", "select"]) q[m] = encadeia(m);
    for (const m of ["update", "insert", "upsert"]) q[m] = (v: unknown) => { op.acao = m; op.valores = v; return q; };
    const fim = () => { ops.push(op); return Promise.resolve({ data: null, error: null, ...resolver(op) }); };
    q.maybeSingle = fim;
    q.single = fim;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => fim().then(ok, ko);
    return q;
  };
  const db = {
    from: consulta,
    rpc: (fn: string, args: Record<string, unknown>) => {
      const r = { fn, args };
      rpcs.push(r);
      const resp = rpcResp(r);
      if (resp === "lanca") return Promise.reject(new Error("rede caiu"));
      return Promise.resolve({ data: null, error: null, ...resp });
    },
  };
  return { db, ops, rpcs };
}

const respTags = (r: Rpc) => (r.fn === "crm_ai_aplicar_tags_inicio" ? { data: ["ia-avaliacao", "lead-quente"] } : { data: 1 });
const erroTags = (r: Rpc) => (r.fn === "crm_ai_aplicar_tags_inicio" ? { error: { message: "function crm_ai_aplicar_tags_inicio does not exist" } } : { data: 1 });
const lancaTags = (r: Rpc) => (r.fn === "crm_ai_aplicar_tags_inicio" ? ("lanca" as const) : { data: 1 });
const chamadaTags = (rpcs: Rpc[]) => rpcs.filter((r) => r.fn === "crm_ai_aplicar_tags_inicio");

// ------------------------------------------------------------------ regras puras
describe("tags ao começar: regras puras", () => {
  it("só adiciona o que falta, sem duplicar (maiúscula/acento contam como a mesma tag)", () => {
    expect(tagsParaAdicionar(["Comprou", "IA-Avaliação"], ["ia-avaliacao", "comprou", "lead-quente"])).toEqual(["lead-quente"]);
    expect(tagsParaAdicionar(null, ["Lead Quente", "lead-quente", ""])).toEqual(["lead-quente"]);
    expect(tagsParaAdicionar(["a"], [])).toEqual([]);
  });
  it("nunca remove nem muda a grafia das tags que o contato já tem", () => {
    const atuais = ["Comprou", "vip"];
    const r = mesclarTagsAoIniciar(atuais, ["vip", "ia-avaliacao"]);
    expect(r).toEqual(["Comprou", "vip", "ia-avaliacao"]);
    expect(mesclarTagsAoIniciar(atuais, ["comprou"])).toEqual(atuais);
  });
  it("normaliza a lista da tela: minúsculas-com-hífen, sem repetidas, sem vazias, até 20", () => {
    expect(normalizarTagsAoIniciar(["Lead Quente", "lead-quente", " ", null, "Avaliação"])).toEqual(["lead-quente", "avaliacao"]);
    expect(normalizarTagsAoIniciar("x")).toEqual([]);
    expect(normalizarTagsAoIniciar(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });
});

describe("aplicarTagsAoIniciar: nunca lança", () => {
  it("agente sem tags (ou banco sem a coluna): nenhuma chamada", async () => {
    for (const ag of [{ slug: "a", tags_ao_iniciar: [] }, { slug: "a" }, null]) {
      const { db, rpcs } = bancoFalso(() => ({}));
      expect(await aplicarTagsAoIniciar(db, { numeroId: NUM, phone: FONE, agente: ag, origem: "gatilho" })).toEqual({ adicionadas: [], erro: null });
      expect(rpcs).toHaveLength(0);
    }
  });
  it("chama a RPC com número, telefone, agente e origem e devolve as adicionadas", async () => {
    const { db, rpcs } = bancoFalso(() => ({}), respTags);
    const r = await aplicarTagsAoIniciar(db, { numeroId: NUM, phone: FONE, agente: AGENTE, origem: "todas" });
    expect(r).toEqual({ adicionadas: ["ia-avaliacao", "lead-quente"], erro: null });
    expect(rpcs[0]).toEqual({ fn: "crm_ai_aplicar_tags_inicio", args: { p_numero_id: NUM, p_phone: FONE, p_agent_slug: "avaliacao", p_origem: "todas" } });
  });
  it("erro do banco ou exceção de rede: devolve o erro em texto, sem lançar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await aplicarTagsAoIniciar(bancoFalso(() => ({}), erroTags).db, { numeroId: NUM, phone: FONE, agente: AGENTE, origem: "gatilho" });
    expect(a).toMatchObject({ adicionadas: [], erro: expect.stringMatching(/does not exist/) });
    const b = await aplicarTagsAoIniciar(bancoFalso(() => ({}), lancaTags).db, { numeroId: NUM, phone: FONE, agente: AGENTE, origem: "gatilho" });
    expect(b).toMatchObject({ adicionadas: [], erro: "rede caiu" });
    spy.mockRestore();
  });
});

// ------------------------------------------------------------------ caminho 1: gatilho
describe("caminho 1: IA ativada pelo gatilho", () => {
  const contato = { phone: FONE, name: "Ana", stage: "leads", numero_id: NUM, ai_agent_slug: null, ai_pausado: false, ai_precisa_humano: false, atendente: null };
  const montar = (rpcResp: Parameters<typeof bancoFalso>[1]) => bancoFalso((op) => {
    if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes('"inbound"'))) return { data: [{ body: MSG, created_at: new Date().toISOString() }] };
    if (op.tabela === "whatsapp_messages") return { data: [] };
    if (op.tabela === "crm_ai_eventos" && op.acao === "select") return { data: [], count: 0 };
    if (op.tabela === "whatsapp_contacts" && op.acao === "update") return { data: [{ phone: FONE }] };
    return {};
  }, rpcResp);
  const chamar = (db: unknown) => avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: FONE, completar: vi.fn() });

  it("ativou: enfileira primeiro e depois aplica as tags do agente (origem gatilho)", async () => {
    const { db, rpcs } = montar(respTags);
    expect(await chamar(db)).toBe("ativado por atalho");
    expect(rpcs.map((r) => r.fn)).toEqual(["crm_ai_enfileirar", "crm_ai_aplicar_tags_inicio"]);
    expect(chamadaTags(rpcs)[0].args).toMatchObject({ p_numero_id: NUM, p_phone: FONE, p_agent_slug: "avaliacao", p_origem: "gatilho" });
  });
  it("tag falhou (erro ou exceção): a IA ativa e enfileira do mesmo jeito", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const resp of [erroTags, lancaTags]) {
      const { db, rpcs } = montar(resp);
      expect(await chamar(db)).toBe("ativado por atalho");
      expect(rpcs[0].fn).toBe("crm_ai_enfileirar");
    }
    spy.mockRestore();
  });
  it("não ativou (\"oi\"): nenhuma tag", async () => {
    const { db, rpcs } = bancoFalso((op) => {
      if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes('"inbound"'))) return { data: [{ body: "oi", created_at: new Date().toISOString() }] };
      if (op.tabela === "crm_ai_eventos" && op.acao === "select") return { data: [], count: 0 };
      return { data: [] };
    }, respTags);
    await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [{ ...AGENTE, ativacao_quando: null }], telefone: FONE, completar: vi.fn() });
    expect(chamadaTags(rpcs)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ caminho 2: modo "todas"/Ligado
describe("caminho 2: modo todas/Ligado (roboAoReceber)", () => {
  const LIGADO = { ...AGENTE, ativo: true, ativacao_modo: "todas", gatilhos: ["quero saber"] };
  const montar = (contato: Record<string, unknown>, rpcResp: Parameters<typeof bancoFalso>[1]) => bancoFalso((op) => {
    if (op.tabela === "crm_numeros") return { data: { id: NUM, robo_ia_ligado: true, robo_ia_max_hora: 60, ativo: true, tipo: "openwa" } };
    if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: contato };
    if (op.tabela === "crm_ai_agents") return { data: [LIGADO] };
    if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes("sender_type"))) return { data: null, count: 0 };
    if (op.tabela === "whatsapp_messages") return { data: [{ body: "quero saber do programa", caption: null }] };
    return {};
  }, rpcResp);
  const novo = { phone: FONE, name: "Ana", stage: "leads", numero_id: NUM, ai_agent_slug: null, ai_atribuido_em: null, ai_pausado: false, ai_precisa_humano: false };

  it("conversa nova atribuída agora: aplica as tags (origem todas) depois de enfileirar", async () => {
    const { db, ops, rpcs } = montar(novo, respTags);
    expect(await roboAoReceber(db, { numeroId: NUM, telefone: FONE })).toBe("enfileirado");
    expect(ops.find((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")?.valores).toMatchObject({ ai_agent_slug: "avaliacao" });
    expect(rpcs.map((r) => r.fn)).toEqual(["crm_ai_enfileirar", "crm_ai_aplicar_tags_inicio"]);
    expect(chamadaTags(rpcs)[0].args).toMatchObject({ p_numero_id: NUM, p_phone: FONE, p_agent_slug: "avaliacao", p_origem: "todas" });
  });
  it("conversa que a IA já atendia (mensagem seguinte): não reaplica", async () => {
    const { db, rpcs } = montar({ ...novo, ai_agent_slug: "avaliacao", ai_atribuido_em: new Date().toISOString() }, respTags);
    expect(await roboAoReceber(db, { numeroId: NUM, telefone: FONE })).toBe("enfileirado");
    expect(chamadaTags(rpcs)).toHaveLength(0);
  });
  it("tag falhou: continua enfileirado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const resp of [erroTags, lancaTags]) {
      const { db } = montar(novo, resp);
      expect(await roboAoReceber(db, { numeroId: NUM, telefone: FONE })).toBe("enfileirado");
    }
    spy.mockRestore();
  });
});

// ------------------------------------------------------------------ caminho 4: passo de fluxo "transferir_ia"
describe("caminho 4: passo de fluxo transferir_ia", () => {
  const montar = (rpcResp: Parameters<typeof bancoFalso>[1], agente: AgenteGatilho = AGENTE) => bancoFalso((op) => {
    if (op.tabela === "crm_ai_agents") return { data: agente };
    if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: null };
    if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes("sender_type"))) return { data: [] };
    if (op.tabela === "whatsapp_messages") return { data: [{ direction: "inbound", created_at: new Date().toISOString(), importada: false }] };
    if (op.tabela === "crm_numeros") return { data: { robo_ia_ligado: true } };
    return {};
  }, rpcResp);

  it("transferiu: aplica as tags (origem fluxo_transferir_ia) e devolve as adicionadas", async () => {
    const { db, rpcs } = montar(respTags);
    const r = await transferirParaIAPorFluxo(db, { phone: FONE, nome: "Ana", agenteSlug: "avaliacao", motivo: "fluxo X, passo 2" });
    expect(r.ok).toBe(true);
    expect(r.tagsAdicionadas).toEqual(["ia-avaliacao", "lead-quente"]);
    expect(r.detalhe).toMatch(/tags: ia-avaliacao, lead-quente/);
    expect(chamadaTags(rpcs)[0].args).toMatchObject({ p_numero_id: NUM, p_phone: FONE, p_agent_slug: "avaliacao", p_origem: "fluxo_transferir_ia" });
  });
  it("tag falhou: a transferência continua ok", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const resp of [erroTags, lancaTags]) {
      const { db } = montar(resp);
      const r = await transferirParaIAPorFluxo(db, { phone: FONE, agenteSlug: "avaliacao", motivo: "fluxo X, passo 2" });
      expect(r.ok).toBe(true);
      expect(r.detalhe).toMatch(/resposta da IA na fila; tags não aplicadas/);
    }
    spy.mockRestore();
  });
  it("transferência barrada (atendente na conversa): nenhuma tag", async () => {
    const { db, rpcs } = bancoFalso((op) => {
      if (op.tabela === "crm_ai_agents") return { data: AGENTE };
      if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: { phone: FONE, atendente: "Gabi", ai_agent_slug: null, ai_pausado: false } };
      return { data: [] };
    }, respTags);
    const r = await transferirParaIAPorFluxo(db, { phone: FONE, agenteSlug: "avaliacao", motivo: "fluxo X" });
    expect(r.ok).toBe(false);
    expect(chamadaTags(rpcs)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ caminho 3: botão "Transferir para IA" (RPC SQL)
describe("caminho 3: botão Transferir para IA (migration)", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261113100000_crm_ai_tags_ao_iniciar.sql"), "utf8");
  it("a RPC do botão aplica as tags num bloco protegido (falha vira evento tags_falha, transferência fica)", () => {
    const corpo = sql.slice(sql.indexOf("FUNCTION public.crm_ai_transferir_para_ia"));
    expect(corpo).toMatch(/BEGIN\s+PERFORM public\.crm_ai_aplicar_tags_inicio\(p_numero_id, p_phone, v_ag\.slug, 'transferencia_manual'\);\s+EXCEPTION WHEN OTHERS THEN/);
    expect(corpo).toMatch(/'tags_falha'/);
    expect(corpo.indexOf("'transferido_ia'")).toBeLessThan(corpo.indexOf("crm_ai_aplicar_tags_inicio"));
  });
  it("idempotente: coluna com IF NOT EXISTS e funções com CREATE OR REPLACE", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tags_ao_iniciar text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).not.toMatch(/CREATE FUNCTION(?! OR)/);
    expect(sql).toMatch(/'tags_aplicadas'/);
  });
});

// ------------------------------------------------------------------ salvar o campo
describe("salvar o agente: tags_ao_iniciar", () => {
  const base = { ...AGENTE, link_agendamento: null, politicas: null, frase_transferencia: null, palavras_transferencia: [], mensagem_fora_horario: null } as unknown as AgenteIA;
  it("grava normalizado e sem repetir, sem mexer nos outros campos", () => {
    const p = payloadAgente({ ...base, tags_ao_iniciar: ["Lead Quente", "lead-quente", "IA Avaliação"] });
    expect(p.tags_ao_iniciar).toEqual(["lead-quente", "ia-avaliacao"]);
    expect(p).toMatchObject({ nome: "Avaliação fitness", ativacao_modo: "gatilho", gatilhos: AGENTE.gatilhos });
  });
  it("lista vazia/nula vira {}; banco sem a coluna = campo fora do update", () => {
    expect(payloadAgente({ ...base, tags_ao_iniciar: null }).tags_ao_iniciar).toEqual([]);
    const semColuna = { ...base } as Record<string, unknown>;
    delete semColuna.tags_ao_iniciar;
    expect(payloadAgente(semColuna as unknown as AgenteIA)).not.toHaveProperty("tags_ao_iniciar");
  });
});
