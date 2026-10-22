// Regra geral (21/10/2026): atendimento humano entrou = IA pausada com motivo "humano"; só o follow-up (ou o botão
// "Devolver para IA") retoma. Banco falso, nada vai para a rede.
import { describe, expect, it } from "vitest";
import {
  fluxoDeFollowup,
  MOTIVO_HUMANO,
  pausadaPorHumano,
  planoPausaHumana,
  planoRetomadaFollowup,
  podeReativar,
} from "../../supabase/functions/_shared/pausaHumana.ts";
import { pausarPorHumano, retomarPorFollowup } from "../../supabase/functions/_shared/roboPausa.ts";
import { type AgenteGatilho, type ContextoGatilho, decidirTransferenciaFluxo, portoesGatilho } from "../../supabase/functions/_shared/iaGatilho.ts";
import { transferirParaIAPorFluxo } from "../../supabase/functions/_shared/iaGatilhoDb.ts";
import { decidirAoReceber, ehMensagemDeHumano } from "../../supabase/functions/_shared/roboAtendimento.ts";

const NUM = "11111111-1111-1111-1111-111111111111";
const FONE = "5531988887777";
const AGORA = new Date(Date.UTC(2026, 9, 21, 15, 0));
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

const AGENTE: AgenteGatilho = {
  id: "ag1", slug: "avaliacao", nome: "Avaliação fitness", tipo: "atendimento", prompt: "x", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: ["Fui qualificada no formulário de avaliação"], modelo: null, temperatura: 0.1,
  ativo: true, horario_inicio: "00:00", horario_fim: "23:59", dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15,
  historico_mensagens: 20, atraso_segundos: 0, numero_id: NUM, ativacao_modo: "gatilho", ativacao_quando: null,
  ativacao_max_mensagens: 3, ativacao_humano_horas: 12,
};

const CONTATO_IA = {
  id: "c1", phone: FONE, name: "Juliana", stage: "leads", numero_id: NUM, is_group: false,
  ai_agent_slug: "avaliacao", ai_pausado: false, ai_pausado_motivo: null as string | null, ai_precisa_humano: false, atendente: null,
};
const PAUSADA = { ...CONTATO_IA, ai_pausado: true, ai_pausado_motivo: MOTIVO_HUMANO };

type Op = { tabela: string; acao: string; filtros: string[]; valores?: unknown };
function bancoFalso(resolver: (op: Op) => { data?: unknown; error?: { message: string } | null; count?: number }) {
  const ops: Op[] = [];
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
  return { db: { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }) }, ops };
}
const contatoNoBanco = (c: Record<string, unknown> | null) =>
  bancoFalso((op) => {
    if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: c ? [c] : [] };
    if (op.tabela === "whatsapp_contacts" && op.acao === "update") return { data: [{ id: "c1" }] };
    return {};
  });

describe("mensagem manual da equipe pausa a IA", () => {
  it("mensagem pelo CRM numa conversa da IA: pausa com motivo 'humano', cancela a fila e grava no histórico", async () => {
    const { db, ops } = contatoNoBanco(CONTATO_IA);
    expect(await pausarPorHumano(db, NUM, FONE, "mensagem manual pelo CRM", AGORA)).toBe(true);
    const up = ops.find((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")!;
    expect(up.valores).toMatchObject({ ai_pausado: true, ai_pausado_motivo: "humano", ai_precisa_humano: false });
    const fila = ops.find((o) => o.tabela === "crm_ai_fila" && o.acao === "update")!;
    expect(fila.valores).toMatchObject({ status: "ignorado" });
    expect(fila.filtros.join(" ")).toContain('"pendente"');
    const ev = ops.find((o) => o.tabela === "crm_ai_eventos" && o.acao === "insert")!;
    expect(ev.valores).toMatchObject({ tipo: "pausado_humano", detalhe: "IA pausada: atendimento humano (mensagem manual pelo CRM)", agent_slug: "avaliacao" });
  });

  it("conversa que a IA ainda não atendia também fica pausada (senão o gatilho entraria depois de 12 h)", async () => {
    const { db, ops } = contatoNoBanco({ ...CONTATO_IA, ai_agent_slug: null });
    expect(await pausarPorHumano(db, NUM, FONE, "mensagem manual pelo celular do número", AGORA)).toBe(true);
    expect(ops.find((o) => o.acao === "update" && o.tabela === "whatsapp_contacts")!.valores).toMatchObject({ ai_pausado: true, ai_pausado_motivo: "humano" });
  });

  it("já pausada por humano: não duplica o histórico (só tira o selo 'Precisa de humano' se houver)", async () => {
    const { db, ops } = contatoNoBanco({ ...PAUSADA, ai_precisa_humano: true });
    expect(await pausarPorHumano(db, NUM, FONE, "mensagem manual pelo CRM", AGORA)).toBe(false);
    expect(ops.find((o) => o.acao === "update" && o.tabela === "whatsapp_contacts")!.valores).toEqual({ ai_precisa_humano: false, updated_at: AGORA.toISOString() });
    expect(ops.some((o) => o.tabela === "crm_ai_eventos")).toBe(false);
  });

  it("IA transferiu para humano e o humano respondeu: motivo vira 'humano'", () => {
    const p = planoPausaHumana({ ...CONTATO_IA, ai_pausado: true, ai_pausado_motivo: "transferido: perguntou preço", ai_precisa_humano: true }, "x", AGORA);
    expect(p.mudou).toBe(true);
    expect(p.patch).toMatchObject({ ai_pausado: true, ai_pausado_motivo: "humano", ai_precisa_humano: false });
  });

  it("grupo nunca entra na regra", async () => {
    const { db, ops } = contatoNoBanco(CONTATO_IA);
    expect(await pausarPorHumano(db, NUM, "1203630@g.us", "x", AGORA)).toBe(false);
    expect(ops).toEqual([]);
  });

  it("motivos antigos do botão Assumir e da RPC também contam como atendimento humano", () => {
    for (const m of ["humano", "humano assumiu", "humano respondeu pelo CRM", "Humano respondeu pelo celular"]) {
      expect(pausadaPorHumano({ ai_pausado: true, ai_pausado_motivo: m })).toBe(true);
    }
    expect(pausadaPorHumano({ ai_pausado: true, ai_pausado_motivo: "pausado por fluxo" })).toBe(false);
    expect(pausadaPorHumano({ ai_pausado: false, ai_pausado_motivo: "humano" })).toBe(false);
  });
});

describe("a IA não pausa a si mesma", () => {
  it("eco do robô (linha 'bot') e envio de automação/follow-up (log com o message_id) não são humanos", () => {
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "bot", temLogDeAutomacao: false })).toBe(false);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "human", temLogDeAutomacao: true })).toBe(false);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "human", temLogDeAutomacao: false })).toBe(true);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: null, temLogDeAutomacao: false })).toBe(true);
  });
});

describe("com motivo 'humano', gatilho / robô / fluxo comum não reativam", () => {
  const ctx = (o: Partial<ContextoGatilho> = {}): ContextoGatilho => ({
    numero: { id: NUM, robo_ia_ligado: true }, contato: { ...PAUSADA, ai_agent_slug: null }, agentes: [AGENTE],
    mensagensLead: ["Fui qualificada no formulário de avaliação"], mensagemImportada: false, mensagemEm: AGORA.toISOString(),
    ultimaAcaoHumanaEm: horasAtras(48), avaliacoesRecentes: 0, agora: AGORA, ...o,
  });

  it("gatilho: barra mesmo 48 h depois da mensagem manual (não existe mais a volta depois de 12 h)", () => {
    const g = portoesGatilho(ctx());
    expect(g).toMatchObject({ ok: false });
    expect((g as { motivo: string }).motivo).toMatch(/atendimento humano/);
    expect(portoesGatilho(ctx({ ultimaAcaoHumanaEm: null }))).toMatchObject({ ok: false });
    // sem pausa e sem humano: o gatilho segue funcionando como antes
    expect(portoesGatilho(ctx({ contato: { ...CONTATO_IA, ai_agent_slug: null }, ultimaAcaoHumanaEm: null }))).toMatchObject({ ok: true });
  });

  it("robô no modo 'assumir conversas novas': não reassume", () => {
    const d = decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: { ...PAUSADA, ai_agent_slug: null }, agentes: [AGENTE], primeiraMensagemLead: "oi", humanoJaRespondeu: false });
    expect(d).toEqual({ enfileirar: false, motivo: "IA pausada: atendimento humano" });
  });

  it("passo de fluxo comum 'Transferir para agente IA': barra, até com 'mesmo com humano'", () => {
    const base = { agente: AGENTE, phone: FONE, contato: PAUSADA, ultimaAcaoHumanaEm: horasAtras(48), agora: AGORA };
    expect(decidirTransferenciaFluxo(base)).toMatchObject({ ok: false, motivo: expect.stringMatching(/só o follow-up/) });
    expect(decidirTransferenciaFluxo({ ...base, mesmoComHumano: true })).toMatchObject({ ok: false });
    expect(podeReativar(PAUSADA, "gatilho")).toMatchObject({ ok: false });
    expect(podeReativar(PAUSADA, "robo")).toMatchObject({ ok: false });
    expect(podeReativar(PAUSADA, "fluxo")).toMatchObject({ ok: false });
  });

  it("fluxo comum no banco: não mexe no contato e diz o porquê", async () => {
    const { db, ops } = bancoFalso((op) => {
      if (op.tabela === "crm_ai_agents") return { data: AGENTE };
      if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: PAUSADA };
      return { data: [] };
    });
    const r = await transferirParaIAPorFluxo(db, { phone: FONE, agenteSlug: "avaliacao", motivo: "fluxo X, passo 2" });
    expect(r.ok).toBe(false);
    expect(r.detalhe).toMatch(/atendimento humano/);
    expect(ops.some((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")).toBe(false);
  });
});

describe("só o follow-up (ou o botão) retoma", () => {
  it("passo de follow-up enviado: tira a pausa humana e registra 'IA retomada pelo follow-up'", async () => {
    const { db, ops } = contatoNoBanco(PAUSADA);
    expect(await retomarPorFollowup(db, NUM, FONE, "fluxo Reaquecer", AGORA)).toBe(true);
    const up = ops.find((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")!;
    expect(up.valores).toMatchObject({ ai_pausado: false, ai_pausado_motivo: null });
    expect(up.filtros.join(" ")).toContain('eq:"ai_pausado",true'); // guarda: só se continua pausada por humano
    const ev = ops.find((o) => o.tabela === "crm_ai_eventos" && o.acao === "insert")!;
    expect(ev.valores).toMatchObject({ tipo: "retomado_followup", detalhe: "IA retomada pelo follow-up (fluxo Reaquecer)" });
  });

  it("follow-up não mexe em pausa que não é humana (fluxo/transferência) nem em conversa ativa", async () => {
    expect(planoRetomadaFollowup({ ...CONTATO_IA, ai_pausado: true, ai_pausado_motivo: "pausado por fluxo" }, "x", AGORA).retomar).toBe(false);
    expect(planoRetomadaFollowup(CONTATO_IA, "x", AGORA).retomar).toBe(false);
    const { db, ops } = contatoNoBanco(CONTATO_IA);
    expect(await retomarPorFollowup(db, NUM, FONE, "x", AGORA)).toBe(false);
    expect(ops.some((o) => o.acao !== "select")).toBe(false);
  });

  it("fluxo de follow-up (tem passo 'Mensagem da IA'): o 'Transferir para agente IA' retoma e registra", async () => {
    expect(fluxoDeFollowup([{ tipo: "esperar" }, { tipo: "ia_followup" }, { tipo: "transferir_ia" }])).toBe(true);
    expect(fluxoDeFollowup([{ tipo: "mensagem" }, { tipo: "transferir_ia" }])).toBe(false);
    const base = { agente: AGENTE, phone: FONE, contato: PAUSADA, ultimaAcaoHumanaEm: horasAtras(1), agora: AGORA };
    expect(decidirTransferenciaFluxo({ ...base, followup: true })).toEqual({ ok: true });

    const { db, ops } = bancoFalso((op) => {
      if (op.tabela === "crm_ai_agents") return { data: AGENTE };
      if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: PAUSADA };
      if (op.tabela === "crm_numeros") return { data: { robo_ia_ligado: true } };
      return { data: [] };
    });
    const r = await transferirParaIAPorFluxo(db, { phone: FONE, agenteSlug: "avaliacao", followup: true, motivo: "fluxo Reaquecer, passo 3" });
    expect(r.ok).toBe(true);
    expect(ops.find((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")!.valores).toMatchObject({ ai_pausado: false, ai_pausado_motivo: null });
    const tipos = ops.filter((o) => o.tabela === "crm_ai_eventos" && o.acao === "insert").map((o) => (o.valores as { tipo: string }).tipo);
    expect(tipos).toContain("retomado_followup");
  });

  it("botão 'Devolver para IA' (manual) continua podendo", () => {
    expect(podeReativar(PAUSADA, "manual")).toEqual({ ok: true });
    expect(podeReativar(PAUSADA, "followup")).toEqual({ ok: true });
  });
});
