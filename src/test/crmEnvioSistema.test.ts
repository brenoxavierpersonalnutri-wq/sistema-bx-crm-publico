// 21/10/2026: (5) o simulador conta respostas da IA por turno, como o robô; (6) envio do sistema (robô, automação,
// fluxo, disparo, follow-up, lembrete do webinário) nunca conta como humano e não pausa a IA. Banco falso, sem rede.
import { describe, expect, it } from "vitest";
import { contarRespostasDaIA, decidirAntesDoModelo, type AgenteIA } from "../../supabase/functions/_shared/agentesIA.ts";
import {
  ehMensagemDeHumano,
  fromMeEhHumano,
  registrarEnvioSistema,
  senderTypeDeSistema,
} from "../../supabase/functions/_shared/envioSistema.ts";
import { ehMensagemDeHumano as reexportada } from "../../supabase/functions/_shared/roboAtendimento.ts";

describe("(5) simulador: limite de respostas conta turno, não bolha", () => {
  const A = { role: "assistant" }, L = { role: "user" };
  it("bolhas seguidas do agente = 1 resposta", () => {
    expect(contarRespostasDaIA([])).toBe(0);
    expect(contarRespostasDaIA([L])).toBe(0);
    // conversa da simulação de 21/10: 4 + 8 + 5 bolhas em 3 turnos
    const conversa = [L, ...Array(4).fill(A), L, ...Array(8).fill(A), L, ...Array(5).fill(A), L];
    expect(conversa.filter((m) => m.role === "assistant").length).toBe(17); // o que o simulador contava antes
    expect(contarRespostasDaIA(conversa)).toBe(3);
    expect(contarRespostasDaIA([A, A, L, A])).toBe(2);
  });

  it("com 3 turnos (17 bolhas) e limite 15 o portão deixa responder; com 15 turnos transfere", () => {
    const agente = { ativo: true, limite_interacoes: 15, palavras_transferencia: [] } as unknown as AgenteIA;
    const tresTurnos = [L, ...Array(4).fill(A), L, ...Array(8).fill(A), L, ...Array(5).fill(A), L];
    const ctx = { grupo: false, textoLead: "como funciona?", ignorarHorario: true };
    expect(decidirAntesDoModelo(agente, { ...ctx, respostasDaIA: contarRespostasDaIA(tresTurnos) })).toEqual({ acao: "responder" });
    const quinze = Array.from({ length: 15 }, () => [L, A, A]).flat().concat(L);
    expect(decidirAntesDoModelo(agente, { ...ctx, respostasDaIA: contarRespostasDaIA(quinze) })).toMatchObject({ acao: "transferir", motivo: "limite de 15 respostas" });
  });
});

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
  return { db: { from: consulta }, ops };
}
const semEspera = { dormir: async () => {} };

describe("(6) envio do sistema nunca é humano", () => {
  it("sender_type de sistema ou log de envio = sistema; 'human'/'user'/vazio sem log = pessoa", () => {
    for (const t of ["bot", "BOT", "ia", "automacao", "sistema", "lembrete"]) {
      expect(senderTypeDeSistema(t)).toBe(true);
      expect(ehMensagemDeHumano({ senderTypeDaLinha: t, temLogDeAutomacao: false })).toBe(false);
    }
    for (const t of ["human", "user", null]) expect(ehMensagemDeHumano({ senderTypeDaLinha: t, temLogDeAutomacao: false })).toBe(true);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "human", temLogDeAutomacao: true })).toBe(false);
    expect(reexportada).toBe(ehMensagemDeHumano); // o robô usa a mesma regra
  });

  it("eco do lembrete do webinário: a linha do webhook é 'human', mas o log do lembrete existe -> não é humano e a linha vira 'bot'", async () => {
    const { db, ops } = bancoFalso((op) => {
      if (op.tabela === "whatsapp_messages" && op.acao === "select") return { data: { sender_type: "human" } };
      if (op.tabela === "crm_automacao_log") return { count: 1 };
      return {};
    });
    expect(await fromMeEhHumano(db, "wamid.LEMBRETE", semEspera)).toBe(false);
    const up = ops.find((o) => o.tabela === "whatsapp_messages" && o.acao === "update")!;
    expect(up.valores).toEqual({ sender_type: "bot" });
    expect(up.filtros).toContain('eq:"message_id","wamid.LEMBRETE"');
    expect(up.filtros).toContain('eq:"sender_type","human"');
  });

  it("registro que chega atrasado (resposta lenta do proxy): a 2ª conferência acha e não pausa", async () => {
    let conferencia = 0;
    const esperas: number[] = [];
    const { db } = bancoFalso((op) => {
      if (op.tabela === "whatsapp_messages" && op.acao === "select") { conferencia++; return { data: { sender_type: "human" } }; }
      if (op.tabela === "crm_automacao_log") return { count: conferencia >= 2 ? 1 : 0 };
      return {};
    });
    expect(await fromMeEhHumano(db, "wamid.X", { dormir: async (ms) => { esperas.push(ms); } })).toBe(false);
    expect(esperas).toEqual([6000, 8000]);
  });

  it("robô (linha 'bot' com o message_id) e automação/fluxo/disparo/follow-up (log com o message_id): não é humano", async () => {
    const robo = bancoFalso((op) => (op.tabela === "whatsapp_messages" ? { data: { sender_type: "bot" } } : { count: 0 }));
    expect(await fromMeEhHumano(robo.db, "wamid.R", semEspera)).toBe(false);
    expect(robo.ops.some((o) => o.acao === "update")).toBe(false);
    const auto = bancoFalso((op) => (op.tabela === "whatsapp_messages" ? { data: null } : { count: 1 }));
    expect(await fromMeEhHumano(auto.db, "wamid.A", semEspera)).toBe(false);
  });

  it("mensagem do celular (sem registro nenhum nas duas conferências): é humano", async () => {
    const { db, ops } = bancoFalso((op) => (op.tabela === "whatsapp_messages" ? { data: { sender_type: "human" } } : { count: 0 }));
    expect(await fromMeEhHumano(db, "wamid.CEL", semEspera)).toBe(true);
    expect(ops.filter((o) => o.tabela === "crm_automacao_log").length).toBe(2);
    expect(ops.some((o) => o.acao === "update")).toBe(false);
    expect(await fromMeEhHumano(db, null, semEspera)).toBe(true); // sem message_id não dá para conferir (como antes)
  });

  it("registrarEnvioSistema: grava o log com o message_id e corrige a linha 'human' do eco; sem id não grava", async () => {
    const { db, ops } = bancoFalso(() => ({}));
    expect(await registrarEnvioSistema(db, { messageId: "wamid.L", telefone: "+55 (31) 90000-0000", origem: "lembrete do webinário (1h): Aula" })).toBe(true);
    const log = ops.find((o) => o.tabela === "crm_automacao_log" && o.acao === "insert")!;
    expect(log.valores).toMatchObject({ canal: "whatsapp", tipo: "text", status: "ok", message_id: "wamid.L", contact_phone: "5531900000000", detalhe: "lembrete do webinário (1h): Aula" });
    const up = ops.find((o) => o.tabela === "whatsapp_messages" && o.acao === "update")!;
    expect(up.valores).toEqual({ sender_type: "bot" });
    expect(up.filtros).toContain('eq:"sender_type","human"');

    const vazio = bancoFalso(() => ({}));
    expect(await registrarEnvioSistema(vazio.db, { messageId: null, telefone: "5531900000000", origem: "x" })).toBe(false);
    expect(vazio.ops).toEqual([]);
  });

  it("registrarEnvioSistema nunca lança (o envio já saiu)", async () => {
    const db = { from: () => { throw new Error("rede caiu"); } };
    await expect(registrarEnvioSistema(db, { messageId: "wamid.Z", telefone: "5531900000000", origem: "x" })).resolves.toBe(false);
  });
});
