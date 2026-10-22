// Robô de atendimento por IA com IA FALSA (18/10/2026): processarItemFila é o que o ai-robo-tick roda para cada
// rajada de mensagens da lead, com banco, Claude e WhatsApp injetados. Nada vai para a rede.
import { describe, expect, it, vi } from "vitest";
import {
  calcularResponderApos,
  type ContextoItem,
  enviarComRitmo,
  normalizarRitmo,
  decidirAoReceber,
  type DepsRobo,
  despedidaDoTransferirDaIA,
  ehMensagemDeHumano,
  type EventoRobo,
  type ItemFila,
  lerClassificacao,
  type LinhaMensagem,
  montarClassificacao,
  pedeHumano,
  planoTransferencia,
  processarItemFila,
  PROMPT_TRANSFERENCIA_PADRAO,
  quemAtende,
  type AgenteRobo,
  type ContatoRobo,
} from "../../supabase/functions/_shared/roboAtendimento.ts";
import type { Completar } from "../../supabase/functions/_shared/agenteResponder.ts";
import { ErroIA, type MensagemChat } from "../../supabase/functions/_shared/anthropic.ts";
import { avaliarCondicao, validarFluxo, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";
import { simularArvore, no } from "../../supabase/functions/_shared/fluxoConstrutor.ts";

const NUM = "11111111-1111-1111-1111-111111111111";
const OUTRO_NUM = "22222222-2222-2222-2222-222222222222";
// 17/10/2026 15:00 UTC = 12:00 em Brasília (sábado); 18/10 02:00 UTC = 23:00 de sábado em Brasília
const DENTRO = new Date(Date.UTC(2026, 9, 17, 15, 0));
const FORA = new Date(Date.UTC(2026, 9, 18, 2, 0));

const AGENTE: AgenteRobo = {
  id: "ag1", slug: "avaliacao", nome: "Avaliação", tipo: "atendimento", prompt: "## PAPEL\nVocê confirma a avaliação.",
  base_conhecimento: "Avaliação pelo Meet, 30 minutos.", etapas: [], origens: ["avaliacao"], gatilhos: ["fui qualificada no formulario"],
  modelo: "claude-sonnet-5-5", temperatura: 0.2, ativo: true, horario_inicio: "08:00", horario_fim: "20:00",
  dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15, historico_mensagens: 20, atraso_segundos: 2, numero_id: NUM,
  link_agendamento: "https://equipe.brenoxavier.com.br/avaliacao", mensagem_fora_horario: null, politicas: null,
  frase_transferencia: "Vou chamar a Gabi pra te ajudar, um minutinho", palavras_transferencia: ["preço", "reembolso"],
  prompt_transferencia: PROMPT_TRANSFERENCIA_PADRAO, transferir_para: "Gabi", transferir_tag: "precisa-humano",
  transferir_etapa: "contato", transferir_fluxo_id: "fluxo-1", max_falhas: 3,
};
const CONTATO: ContatoRobo = {
  phone: "5531988887777", name: "Ana Souza", stage: "leads", source: "avaliacao", numero_id: NUM, tags: ["lead-quente"],
  ai_agent_slug: "avaliacao", ai_pausado: false, ai_respostas: 0, ai_falhas: 0,
};
const ITEM: ItemFila = { id: 1, numero_id: NUM, contact_phone: CONTATO.phone, agent_slug: "avaliacao", tentativas: 1 };
const T = (min: number) => new Date(DENTRO.getTime() - (60 - min) * 60_000).toISOString();
const msg = (direction: "inbound" | "outbound", body: string, min: number, sender_type = direction === "inbound" ? "lead" : "bot"): LinhaMensagem =>
  ({ direction, body, sender_type, created_at: T(min) });

type Resposta = { classificacao?: string | Error; resposta?: string | Error };

/** IA falsa: devolve a classificação para o pedido de transferência e o texto para o pedido de resposta. */
function iaFalsa(r: Resposta) {
  const chamadas: { tipo: "classificacao" | "resposta"; mensagens: MensagemChat[] }[] = [];
  const completar: Completar = vi.fn(async (mensagens: MensagemChat[]) => {
    const ehClass = String(mensagens[0]?.content ?? "").includes("## REGRA DE TRANSFERÊNCIA");
    chamadas.push({ tipo: ehClass ? "classificacao" : "resposta", mensagens });
    const v = ehClass ? (r.classificacao ?? '{"transferir": false, "motivo": ""}') : (r.resposta ?? "Oi Ana, tudo certo?");
    if (v instanceof Error) throw v;
    return v;
  });
  return { completar, chamadas };
}

function montar(opts: { ctx?: Partial<ContextoItem>; ia?: Resposta; agora?: Date; enviarFalha?: Error } = {}) {
  const enviados: { tipo: string; conteudo: string }[] = [];
  const eventos: EventoRobo[] = [];
  const patches: Record<string, unknown>[] = [];
  const fluxos: string[] = [];
  const esperas: number[] = [];
  const digitandos: string[] = [];
  const ia = iaFalsa(opts.ia ?? {});
  const ctx: ContextoItem = {
    numero: { id: NUM, robo_ia_ligado: true, robo_ia_max_hora: 60, ativo: true, tipo: "openwa" },
    contato: { ...CONTATO },
    agente: { ...AGENTE },
    historico: [msg("outbound", "Oi Ana, recebi seu formulário", 1), msg("inbound", "oi", 2), msg("inbound", "posso confirmar sim", 3)],
    usoNumeroHora: 0,
    foraHorarioRecente: false,
    etapas: ["leads", "contato", "agendado"],
    ...opts.ctx,
  };
  const deps: DepsRobo = {
    carregar: vi.fn(async () => ctx),
    completar: ia.completar,
    enviar: vi.fn(async (m) => {
      if (opts.enviarFalha) throw opts.enviarFalha;
      enviados.push(m);
    }),
    atualizarContato: vi.fn(async (p) => { patches.push(p); }),
    iniciarFluxo: vi.fn(async (id) => { fluxos.push(id); }),
    registrar: vi.fn(async (e) => { eventos.push(e); }),
    dormir: vi.fn(async (ms) => { esperas.push(ms); }),
    digitando: vi.fn(async (e) => { digitandos.push(e); }),
    agora: () => opts.agora ?? DENTRO,
  };
  return { deps, ctx, enviados, eventos, patches, fluxos, esperas, digitandos, ia };
}

describe("debounce (junta as mensagens picadas da lead)", () => {
  const primeira = new Date(Date.UTC(2026, 9, 17, 15, 0, 0));
  it("responde debounce segundos depois da última mensagem", () => {
    const agora = new Date(primeira.getTime() + 10_000);
    expect(calcularResponderApos(primeira, agora, normalizarRitmo({ debounce_segundos: 30 })).getTime()).toBe(agora.getTime() + 30_000);
  });
  it("lead que não para de digitar: no máximo 90 s (padrão) depois da primeira", () => {
    const agora = new Date(primeira.getTime() + 80_000);
    expect(calcularResponderApos(primeira, agora, normalizarRitmo({})).getTime()).toBe(primeira.getTime() + 90_000);
  });
  it("debounce fora da faixa vira 5..300 s; vazio = 30 s", () => {
    expect(calcularResponderApos(primeira, primeira, normalizarRitmo({ debounce_segundos: 1 })).getTime()).toBe(primeira.getTime() + 5_000);
    expect(calcularResponderApos(primeira, primeira, normalizarRitmo({ debounce_segundos: null })).getTime()).toBe(primeira.getTime() + 30_000);
  });
  it("várias mensagens seguidas viram UMA resposta com todas no contexto", async () => {
    const t = montar({ ctx: { historico: [msg("outbound", "Posso confirmar?", 1), msg("inbound", "oi", 2), msg("inbound", "sim", 3), msg("inbound", "pode confirmar", 4)] } });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r.estado).toBe("feito");
    const pedido = t.ia.chamadas.find((c) => c.tipo === "resposta")!.mensagens;
    expect(pedido[pedido.length - 1]).toEqual({ role: "user", content: "oi\n\nsim\n\npode confirmar" });
    expect(t.enviados).toEqual([{ tipo: "text", conteudo: "Oi Ana, tudo certo?" }]);
  });
});

describe("resposta normal", () => {
  it("classifica (não transferir), gera, manda com ritmo humano e registra o log", async () => {
    const t = montar({ ia: { resposta: "Perfeitooo Ana!\n\nSua avaliação está confirmada [ETAPA:agendado]" } });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r).toMatchObject({ estado: "feito" });
    expect(t.ia.chamadas.map((c) => c.tipo)).toEqual(["classificacao", "resposta"]);
    expect(t.enviados.map((m) => m.conteudo)).toEqual(["Perfeitooo Ana!", "Sua avaliação está confirmada"]);
    // padrão: "digitando…" a 8 cps antes de cada bolha + 3..8 s entre as duas
    expect(t.digitandos).toEqual(["typing", "typing"]);
    expect(t.esperas.length).toBe(3);
    expect(t.esperas[0]).toBe(Math.round(("Perfeitooo Ana!".length / 8) * 10) * 100);
    expect(t.esperas[1]).toBeGreaterThanOrEqual(3000);
    expect(t.esperas[1]).toBeLessThanOrEqual(8000);
    expect(t.patches.at(-1)).toMatchObject({ ai_respostas: 1, ai_falhas: 0, stage: "agendado" });
    expect(t.eventos.at(-1)).toMatchObject({ tipo: "resposta", modelo: "claude-sonnet-5-5" });
    expect(t.eventos.at(-1)!.mensagem).toContain("Perfeitooo Ana!");
  });
  it("usa o tempo do agente: digitando desligado e intervalo fixo de 5 s", async () => {
    const t = montar({
      ctx: { agente: { ...AGENTE, digitando_ligado: false, intervalo_min_segundos: 5, intervalo_max_segundos: 5 } },
      ia: { resposta: "Oi Ana!\n\nTudo certo?\n\nTe espero" },
    });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados.length).toBe(3);
    expect(t.digitandos).toEqual([]);
    expect(t.esperas).toEqual([5000, 5000]);
  });
  it("indicador de digitando que falha não impede o envio", async () => {
    const t = montar();
    t.deps.digitando = vi.fn(async () => { throw new Error("proxy sem a rota typing"); });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r.estado).toBe("feito");
    expect(t.enviados.length).toBe(1);
  });
  it("sem a dependência de digitando (proxy antigo): só espera calado", async () => {
    const enviados: string[] = [];
    const esperas: number[] = [];
    await enviarComRitmo([{ tipo: "text", conteudo: "x".repeat(40) }], normalizarRitmo({}), {
      enviar: async (m) => { enviados.push(m.conteudo); }, dormir: async (ms) => { esperas.push(ms); },
    });
    expect(esperas).toEqual([5000]);
    expect(enviados.length).toBe(1);
  });
  it("áudio: sem gravando local; manda com gravando = digitando do agente (o proxy mostra pela duração)", async () => {
    const enviados: { tipo: string; gravando?: boolean }[] = [];
    const digitandos: string[] = [];
    const deps = {
      enviar: async (m: { tipo: string; conteudo: string; gravando?: boolean }) => { enviados.push({ tipo: m.tipo, gravando: m.gravando }); },
      dormir: async () => {},
      digitando: async (e: string) => { digitandos.push(e); },
    };
    await enviarComRitmo([{ tipo: "audio", conteudo: "https://x/a.mp3" }], normalizarRitmo({}), deps);
    await enviarComRitmo([{ tipo: "audio", conteudo: "https://x/a.mp3" }], normalizarRitmo({ digitando_ligado: false }), deps);
    expect(digitandos).toEqual([]);
    expect(enviados).toEqual([{ tipo: "audio", gravando: true }, { tipo: "audio", gravando: false }]);
  });
  it("[SILENCIO]: não manda nada e registra", async () => {
    const t = montar({ ia: { resposta: "[SILENCIO]" } });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados).toEqual([]);
    expect(t.eventos.at(-1)?.tipo).toBe("silencio");
  });
  it("última mensagem já é nossa: não responde de novo", async () => {
    const t = montar({ ctx: { historico: [msg("inbound", "oi", 1), msg("outbound", "Oi Ana", 2)] } });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r.estado).toBe("ignorado");
    expect(t.ia.completar).not.toHaveBeenCalled();
  });
});

describe("horário", () => {
  it("fora do horário sem mensagem configurada: silêncio, sem chamar a IA", async () => {
    const t = montar({ agora: FORA });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r.estado).toBe("ignorado");
    expect(t.enviados).toEqual([]);
    expect(t.ia.completar).not.toHaveBeenCalled();
    expect(t.eventos.at(-1)?.tipo).toBe("fora_horario");
  });
  it("fora do horário com mensagem: manda só ela, uma vez", async () => {
    const ag = { ...AGENTE, mensagem_fora_horario: "Nosso time atende das 8h às 20h, amanhã cedo te respondo" };
    const t = montar({ agora: FORA, ctx: { agente: ag } });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados).toEqual([{ tipo: "text", conteudo: ag.mensagem_fora_horario }]);
    expect(t.ia.completar).not.toHaveBeenCalled();
    const t2 = montar({ agora: FORA, ctx: { agente: ag, foraHorarioRecente: true } });
    await processarItemFila(ITEM, t2.deps);
    expect(t2.enviados).toEqual([]);
  });
  it("dia da semana fora da lista também é fora do horário", async () => {
    const t = montar({ ctx: { agente: { ...AGENTE, dias_semana: [1, 2, 3, 4, 5] } } }); // DENTRO é sábado
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados).toEqual([]);
    expect(t.eventos.at(-1)?.tipo).toBe("fora_horario");
  });
});

describe("transferência para humano", () => {
  it("palavra de transferência: atalho sem IA, despedida, tag/etapa/atendente/fluxo e motivo", async () => {
    const t = montar({ ctx: { historico: [msg("outbound", "Posso confirmar?", 1), msg("inbound", "qual o preço?", 2)] } });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r).toMatchObject({ estado: "feito" });
    expect(t.ia.completar).not.toHaveBeenCalled();
    expect(t.enviados).toEqual([{ tipo: "text", conteudo: "Vou chamar a Gabi pra te ajudar, um minutinho" }]);
    const p = t.patches.at(-1)!;
    expect(p).toMatchObject({ ai_pausado: true, ai_precisa_humano: true, atendente: "Gabi", stage: "contato" });
    expect(p.tags).toEqual(["lead-quente", "precisa-humano"]);
    expect(t.fluxos).toEqual(["fluxo-1"]);
    const ev = t.eventos.at(-1)!;
    expect(ev.tipo).toBe("transferido");
    expect(ev.detalhe).toContain('palavra de transferência "preço"');
    expect(ev.detalhe).toContain("para Gabi");
  });
  it("só olha o que a lead mandou depois da nossa última resposta", async () => {
    const t = montar({ ctx: { historico: [msg("inbound", "quanto é o preço?", 1), msg("outbound", "Vamos ver na call", 2), msg("inbound", "ok, combinado", 3)] } });
    await processarItemFila(ITEM, t.deps);
    expect(t.eventos.at(-1)?.tipo).toBe("resposta");
  });
  it("classificação do Claude com o prompt de transferência decide ANTES da resposta", async () => {
    const t = montar({ ia: { classificacao: '```json\n{"transferir": true, "motivo": "quer fechar a compra"}\n```' } });
    await processarItemFila(ITEM, t.deps);
    expect(t.ia.chamadas.map((c) => c.tipo)).toEqual(["classificacao"]);
    expect(String(t.ia.chamadas[0].mensagens[0].content)).toContain(PROMPT_TRANSFERENCIA_PADRAO.split("\n")[0]);
    expect(t.eventos.at(-1)).toMatchObject({ tipo: "transferido" });
    expect(t.eventos.at(-1)!.detalhe).toContain("IA decidiu transferir: quer fechar a compra");
    expect(t.patches.at(-1)).toMatchObject({ ai_precisa_humano: true });
  });
  it("prompt de transferência do agente entra no pedido de classificação", () => {
    const m = montarClassificacao({ nome: "X", prompt_transferencia: "Transfira quando mandar áudio longo com dúvida clínica" }, [{ role: "user", content: "oi" }]);
    expect(m[0].content).toContain("áudio longo com dúvida clínica");
    expect(m[0].content).toContain('{"transferir"');
    expect(m.at(-1)).toEqual({ role: "user", content: "oi" });
  });
  it("lê a classificação com texto em volta; formato errado = null", () => {
    expect(lerClassificacao('Claro: {"transferir": false, "motivo": ""} pronto')).toEqual({ transferir: false, motivo: "" });
    expect(lerClassificacao('{"transferir": "sim"}')).toBeNull();
    expect(lerClassificacao("não sei")).toBeNull();
  });
  it("lead pede humano: transfere sem chamar a IA", async () => {
    expect(pedeHumano("quero falar com um atendente")).toBe(true);
    expect(pedeHumano("Prefiro falar com uma pessoa de verdade")).toBe(true);
    expect(pedeHumano("quero emagrecer 5 kg")).toBe(false);
    const t = montar({ ctx: { historico: [msg("outbound", "Oi", 1), msg("inbound", "posso falar com uma pessoa?", 2)] } });
    await processarItemFila(ITEM, t.deps);
    expect(t.ia.completar).not.toHaveBeenCalled();
    expect(t.eventos.at(-1)!.detalhe).toContain("pediu para falar com uma pessoa");
  });
  it("máximo de respostas atingido: transfere", async () => {
    const t = montar({ ctx: { contato: { ...CONTATO, ai_respostas: 15 } } });
    await processarItemFila(ITEM, t.deps);
    expect(t.eventos.at(-1)!.detalhe).toContain("máximo de 15 respostas");
  });
  it("[TRANSFERIR] da resposta: manda a frase que a IA escreveu e NÃO repete a despedida", async () => {
    const t = montar({ ia: { resposta: "vou chamar alguém do time pra te responder isso direitinho\n\n[TRANSFERIR]" } });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados.map((m) => m.conteudo)).toEqual(["vou chamar alguém do time pra te responder isso direitinho"]);
    expect(t.eventos.map((e) => e.tipo)).toEqual(["resposta", "transferido"]);
  });
  it("IA devolve só [TRANSFERIR]: manda a despedida configurada (a lead não fica sem resposta)", async () => {
    const t = montar({ ia: { resposta: "[TRANSFERIR]" } });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados.map((m) => m.conteudo)).toEqual(["Vou chamar a Gabi pra te ajudar, um minutinho"]);
    expect(t.eventos.at(-1)).toMatchObject({ tipo: "transferido", mensagem: "Vou chamar a Gabi pra te ajudar, um minutinho" });
    expect(t.patches.at(-1)).toMatchObject({ ai_pausado: true, ai_precisa_humano: true });
  });
  it("despedidaDoTransferirDaIA: só sai quando a IA não escreveu texto (regra do robô usada pelo simulador)", () => {
    const ag = { frase_transferencia: "Vou chamar alguém do time pra te ajudar", transferir_sem_mensagem: false };
    expect(despedidaDoTransferirDaIA(ag, { mensagens: [], transferir: true })).toBe("Vou chamar alguém do time pra te ajudar");
    expect(despedidaDoTransferirDaIA(ag, { mensagens: [{ tipo: "text", conteudo: "vou chamar alguém" }], transferir: true })).toBeNull();
    expect(despedidaDoTransferirDaIA(ag, { mensagens: [], transferir: false })).toBeNull();
    expect(despedidaDoTransferirDaIA(ag, { mensagens: [], transferir: true, silencio: true })).toBeNull();
    expect(despedidaDoTransferirDaIA({ ...ag, transferir_sem_mensagem: true }, { mensagens: [], transferir: true })).toBeNull();
    expect(despedidaDoTransferirDaIA({ frase_transferencia: " " }, { mensagens: [], transferir: true }))
      .toBe("vou chamar alguém do time pra te responder isso direitinho");
  });
  it("sem mensagem de despedida quando o agente pede para não mandar nada", async () => {
    const t = montar({ ctx: { agente: { ...AGENTE, transferir_sem_mensagem: true }, historico: [msg("inbound", "quero reembolso", 1)] } });
    await processarItemFila(ITEM, t.deps);
    expect(t.enviados).toEqual([]);
    expect(t.patches.at(-1)).toMatchObject({ ai_pausado: true });
  });
  it("plano: fila geral sem atendente; tag repetida não duplica; sem etapa não mexe", () => {
    const p = planoTransferencia({ transferir_tag: "Lead-Quente" }, { tags: ["lead-quente"] }, "x", DENTRO);
    expect(p.contato.atendente).toBeUndefined();
    expect(p.contato.tags).toEqual(["lead-quente"]);
    expect(p.contato.stage).toBeUndefined();
    expect(p.fluxoId).toBeNull();
    expect(p.despedida).toBe("vou chamar alguém do time pra te responder isso direitinho");
  });
});

describe("falha de IA", () => {
  it("erro do Claude: não envia, registra a falha e tenta de novo depois", async () => {
    const t = montar({ ia: { classificacao: new ErroIA(529, "a Anthropic está sobrecarregada agora (529)") } });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r).toMatchObject({ estado: "adiar" });
    expect(t.enviados).toEqual([]);
    expect(t.eventos.at(-1)).toMatchObject({ tipo: "falha" });
    expect(t.eventos.at(-1)!.detalhe).toContain("HTTP 529");
    expect(t.patches.at(-1)).toEqual({ ai_falhas: 1 });
  });
  it("sem chave (503) na N-ésima falha: passa para humano sem mandar despedida", async () => {
    const t = montar({
      ctx: { contato: { ...CONTATO, ai_falhas: 2 } },
      ia: { resposta: new ErroIA(503, "chave da Anthropic não configurada") },
    });
    const r = await processarItemFila(ITEM, t.deps);
    expect(r.estado).toBe("feito");
    expect(t.enviados).toEqual([]);
    expect(t.eventos.map((e) => e.tipo)).toEqual(["falha", "transferido"]);
    expect(t.eventos.at(-1)!.detalhe).toContain("a IA falhou 3 vezes");
    expect(t.patches.at(-1)).toMatchObject({ ai_precisa_humano: true });
  });
  it("classificação fora do formato conta como falha", async () => {
    const t = montar({ ia: { classificacao: "acho que sim" } });
    await processarItemFila(ITEM, t.deps);
    expect(t.eventos.at(-1)!.detalhe).toContain("fora do formato");
    expect(t.enviados).toEqual([]);
  });
  it("WhatsApp recusou o envio: registra e conta falha", async () => {
    const t = montar({ enviarFalha: new Error("proxy 429") });
    await processarItemFila(ITEM, t.deps);
    expect(t.eventos.map((e) => e.tipo)).toEqual(["falha_envio", "falha"]);
  });
});

describe("portões: nunca em grupo, só com o robô do número ligado, nunca por cima do humano", () => {
  it("grupo é ignorado no worker", async () => {
    const t = montar({ ctx: { contato: { ...CONTATO, phone: "1203630@g.us", is_group: true } } });
    const r = await processarItemFila({ ...ITEM, contact_phone: "1203630@g.us" }, t.deps);
    expect(r.estado).toBe("ignorado");
    expect(t.ia.completar).not.toHaveBeenCalled();
    expect(t.enviados).toEqual([]);
  });
  it("grupo nunca entra na fila", () => {
    const d = decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: { ...CONTATO, phone: "x@g.us", is_group: true }, agentes: [AGENTE], primeiraMensagemLead: "", humanoJaRespondeu: false });
    expect(d).toMatchObject({ enfileirar: false });
  });
  it("robô do número desligado (padrão): nada acontece", async () => {
    const t = montar({ ctx: { numero: { id: NUM, robo_ia_ligado: false } } });
    expect((await processarItemFila(ITEM, t.deps)).estado).toBe("ignorado");
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: false }, contato: CONTATO, agentes: [AGENTE], primeiraMensagemLead: "", humanoJaRespondeu: false }))
      .toMatchObject({ enfileirar: false, motivo: "robô de IA desligado neste número" });
  });
  it("humano assumiu (ai_pausado) entre a fila e o worker: não responde", async () => {
    const t = montar({ ctx: { contato: { ...CONTATO, ai_pausado: true } } });
    expect((await processarItemFila(ITEM, t.deps)).estado).toBe("ignorado");
    expect(t.enviados).toEqual([]);
  });
  it("agente de outro número não responde aqui", async () => {
    const t = montar({ ctx: { agente: { ...AGENTE, numero_id: OUTRO_NUM } } });
    expect((await processarItemFila(ITEM, t.deps)).estado).toBe("ignorado");
  });
  it("teto do robô no número / envio pausado por restrição: adia", async () => {
    expect((await processarItemFila(ITEM, montar({ ctx: { usoNumeroHora: 60 } }).deps)).estado).toBe("adiar");
    expect((await processarItemFila(ITEM, montar({ ctx: { envioPausado: "banido?" } }).deps)).estado).toBe("adiar");
  });
});

describe("humano pausando a IA", () => {
  it("mensagem do celular (sem log de automação, linha não é do robô) é humano", () => {
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "human", temLogDeAutomacao: false })).toBe(true);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: null, temLogDeAutomacao: false })).toBe(true);
  });
  it("eco do robô ou de automação não pausa", () => {
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "bot", temLogDeAutomacao: false })).toBe(false);
    expect(ehMensagemDeHumano({ senderTypeDaLinha: "human", temLogDeAutomacao: true })).toBe(false);
  });
  it("conversa pausada por humano não volta para a IA sozinha", () => {
    const d = decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: { ...CONTATO, ai_pausado: true }, agentes: [AGENTE], primeiraMensagemLead: "", humanoJaRespondeu: true });
    expect(d).toEqual({ enfileirar: false, motivo: "conversa com humano" });
    expect(quemAtende({ ai_agent_slug: "avaliacao", ai_pausado: true })).toBe("humano");
    expect(quemAtende({ ai_agent_slug: "avaliacao", ai_pausado: false })).toBe("ia:avaliacao");
  });
});

describe("atribuição automática (conversa nova)", () => {
  const novo: ContatoRobo = { phone: "5531900000001", name: "Bia", stage: "leads", source: null, numero_id: NUM, ai_agent_slug: null, ai_pausado: false };
  it("agente ligado do número + gatilho da 1ª mensagem: assume", () => {
    const d = decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: novo, agentes: [AGENTE], primeiraMensagemLead: "Fui qualificada no formulário de avaliação", humanoJaRespondeu: false });
    expect(d).toMatchObject({ enfileirar: true, atribuirAgora: true, motivo: "atribuído por gatilho" });
  });
  it("agente desligado não assume conversa nova (mas atende a transferida à mão)", () => {
    const off = { ...AGENTE, ativo: false };
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: novo, agentes: [off], primeiraMensagemLead: "Fui qualificada no formulário", humanoJaRespondeu: false }))
      .toMatchObject({ enfileirar: false });
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: CONTATO, agentes: [off], primeiraMensagemLead: "", humanoJaRespondeu: false }))
      .toMatchObject({ enfileirar: true, atribuirAgora: false });
  });
  it("humano já respondeu ou conversa já passou pela IA: não assume", () => {
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: novo, agentes: [AGENTE], primeiraMensagemLead: "Fui qualificada no formulário", humanoJaRespondeu: true }))
      .toMatchObject({ enfileirar: false });
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: { ...novo, ai_atribuido_em: T(0) }, agentes: [AGENTE], primeiraMensagemLead: "Fui qualificada no formulário", humanoJaRespondeu: false }))
      .toMatchObject({ enfileirar: false });
  });
  it("agente de outro número não assume", () => {
    expect(decidirAoReceber({ numero: { id: NUM, robo_ia_ligado: true }, contato: novo, agentes: [{ ...AGENTE, numero_id: OUTRO_NUM }], primeiraMensagemLead: "Fui qualificada no formulário", humanoJaRespondeu: false }))
      .toMatchObject({ enfileirar: false });
  });
});

describe("fluxos: passo Transferir para humano e condição A IA transferiu?", () => {
  const fluxo = (passos: Fluxo["passos"]): Partial<Fluxo> => ({ nome: "F", gatilho_tipo: "tag", gatilho_valor: "x", passos });
  it("valida o passo e a condição", () => {
    expect(validarFluxo(fluxo([{ tipo: "transferir_humano", despedida: "Um minutinho", para: "Gabi", tag: "humano", etapa: "contato" }]))).toEqual([]);
    expect(validarFluxo(fluxo([{ tipo: "transferir_humano", etapa: "nao-existe" }])).join(" ")).toContain("etapa da transferência inválida");
    expect(validarFluxo(fluxo([{ tipo: "condicao", condicao: { tipo: "ia_transferiu" }, se_sim: "continuar", se_nao: "parar" }]))).toEqual([]);
  });
  it("A IA transferiu? usa a última transferência depois do início da execução", () => {
    const ex = { iniciado_em: T(0), ultimo_envio_em: null };
    const ctx = (quando: number) => ({ contato: { phone: "1" }, respondeuDesde: () => false, iaTransferiuDesde: (d: string) => quando > new Date(d).getTime() });
    expect(avaliarCondicao({ tipo: "ia_transferiu" }, ex, ctx(new Date(T(5)).getTime()))).toBe(true);
    expect(avaliarCondicao({ tipo: "ia_transferiu" }, ex, ctx(new Date(T(0)).getTime() - 1))).toBe(false);
    expect(avaliarCondicao({ tipo: "ia_transferiu" }, ex, { contato: { phone: "1" }, respondeuDesde: () => false })).toBe(false);
  });
  it("Testar fluxo segue o ramo certo e aplica tag/etapa da transferência", () => {
    const arvore = [no({ tipo: "se", condicao: { tipo: "ia_transferiu" }, sim: [no({ tipo: "transferir_humano", para: "Gabi", tag: "humano" })], nao: [no({ tipo: "parar" })] })];
    expect(simularArvore(arvore, { respondeu: false, tags: [], etapa: "leads", iaTransferiu: true }).map((c) => c.texto)).toEqual(["Se: SIM", "Transferir para humano (Gabi)", "FIM"]);
    expect(simularArvore(arvore, { respondeu: false, tags: [], etapa: "leads" }).map((c) => c.texto)).toEqual(["Se: SENÃO", "Parar"]);
  });
});
