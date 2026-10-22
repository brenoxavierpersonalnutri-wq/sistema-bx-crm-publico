// Tela "Treinar IA" e decisões do Breno de 17/10/2026: link com UTM da IA, políticas, horário,
// portão antes do modelo, origem "IA WhatsApp" no funil e a migration 20261027140000.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  casaPalavraTransferencia,
  decidirAntesDoModelo,
  finalizarSaida,
  gerarRefContato,
  interpretarResposta,
  linkAgendamento,
  montarSistema,
  POLITICAS_PADRAO,
  prontoParaLigar,
  textoConhecimento,
  textoExemplos,
  type AgenteIA,
} from "../../supabase/functions/_shared/agentesIA.ts";
import { inferBookingVia, inferFunnelKey } from "@/lib/funnelClassification";
import { ehOrigemIA, filtroOrigemIA, outrasOrigens, taxaEtapa } from "@/lib/crm/origemIA";
import { payloadAgente, recomendacaoNumero } from "@/lib/crm/treinarIA";
import { montarInsercao, usaLinkAgendamento } from "@/lib/crm/roteirosChat";

const agente: AgenteIA = {
  id: "1",
  slug: "individual",
  nome: "Individual",
  prompt: "PROMPT",
  base_conhecimento: null,
  etapas: [],
  origens: [],
  gatilhos: [],
  modelo: null,
  temperatura: 0.1,
  ativo: true,
  horario_inicio: "08:00",
  horario_fim: "20:00",
  dias_semana: [1, 2, 3, 4, 5],
  limite_interacoes: 3,
  historico_mensagens: 20,
  atraso_segundos: 0,
  numero_id: "num-comercial",
  link_agendamento: "https://equipe.brenoxavier.com.br/avaliacao",
  mensagem_fora_horario: "Volto amanhã às 8h",
  politicas: null,
  frase_transferencia: null,
  palavras_transferencia: ["preço", "valor", "quanto custa", "reembolso"],
};

// quarta-feira 15/10/2026, 15:00 em Brasília (18:00 UTC) e 23:00 (02:00 UTC do dia 16)
const QUARTA_15H = new Date("2026-10-15T18:00:00Z");
const QUARTA_23H = new Date("2026-10-16T02:00:00Z");

describe("link de agendamento da IA", () => {
  it("leva as UTMs da IA, o slug do agente e o código opaco, sem PII", () => {
    const u = new URL(linkAgendamento("https://equipe.brenoxavier.com.br/avaliacao", "individual", "k7m2p9xq4a"));
    expect(u.origin + u.pathname).toBe("https://equipe.brenoxavier.com.br/avaliacao");
    expect(u.searchParams.get("utm_source")).toBe("whatsapp");
    expect(u.searchParams.get("utm_medium")).toBe("ia");
    expect(u.searchParams.get("utm_campaign")).toBe("agente_avaliacao");
    expect(u.searchParams.get("utm_content")).toBe("individual");
    expect(u.searchParams.get("utm_term")).toBe("k7m2p9xq4a");
    expect(u.toString()).not.toMatch(/\d{10,}/); // nenhum telefone
  });

  it("base vazia, inválida ou http cai no /avaliacao; UTM antiga da base é trocada", () => {
    expect(linkAgendamento(null, "a")).toMatch(/^https:\/\/equipe\.brenoxavier\.com\.br\/avaliacao\?/);
    expect(linkAgendamento("http://x.com", "a")).toMatch(/^https:\/\/equipe\.brenoxavier\.com\.br\/avaliacao\?/);
    expect(linkAgendamento("lixo", "a")).toMatch(/^https:\/\/equipe\.brenoxavier\.com\.br\/avaliacao\?/);
    const u = new URL(linkAgendamento("https://equipe.brenoxavier.com.br/avaliacao?v=v2&utm_source=ig", "a"));
    expect(u.searchParams.get("v")).toBe("v2");
    expect(u.searchParams.getAll("utm_source")).toEqual(["whatsapp"]);
  });

  it("código que não é opaco (telefone, maiúscula, curto) não entra na URL", () => {
    expect(new URL(linkAgendamento(null, "a", "5531999990000")).searchParams.get("utm_term")).toBeNull();
    expect(new URL(linkAgendamento(null, "a", "31999990000")).searchParams.get("utm_term")).toBeNull();
    expect(new URL(linkAgendamento(null, "a", "abc")).searchParams.get("utm_term")).toBeNull();
    expect(new URL(linkAgendamento(null, "a", "ana@x.com")).searchParams.get("utm_term")).toBeNull();
  });

  it("gerarRefContato: 10 caracteres minúsculos sem 0/o/1/l", () => {
    for (let i = 0; i < 50; i++) expect(gerarRefContato()).toMatch(/^[a-km-np-z][a-km-np-z2-9]{9}$/);
  });

  it("[LINK_AGENDAMENTO] da resposta vira o link da lead; sem link a mensagem é retida", () => {
    const r = interpretarResposta("Fechado! Segue o link:\n\n[LINK_AGENDAMENTO]\n\nAssim que agendar, já fica confirmado.");
    const link = linkAgendamento(null, "individual", "k7m2p9xq4a");
    const ok = finalizarSaida(r, { name: "Ana" }, { link_agendamento: link });
    expect(ok.retidas).toEqual([]);
    expect(ok.mensagens.map((m) => m.conteudo)).toContain(link);
    expect(finalizarSaida(r, { name: "Ana" }).retidas).toEqual(["LINK_AGENDAMENTO"]);
  });

  it("roteiro manual do chat também troca [LINK_AGENDAMENTO]", () => {
    const passos = [{ id: "p", roteiro_id: "r", ordem: 1, tipo: "text" as const, rotulo: null, conteudo: "Segue:\n\n[LINK_AGENDAMENTO]", media_url: null, file_name: null }];
    expect(usaLinkAgendamento(passos)).toBe(true);
    expect(montarInsercao(passos, { name: "Ana" }, { link_agendamento: "https://x.com/a?utm_medium=ia" }).texto).toBe("Segue:\n\nhttps://x.com/a?utm_medium=ia");
  });
});

describe("prompt: políticas, conhecimento e exemplos", () => {
  it("políticas entram sempre (padrão quando vazio) depois do prompt e mandam transferir preço/reembolso", () => {
    const s = montarSistema(agente, { phone: "1", name: "Ana" }, QUARTA_15H);
    expect(s).toContain("## POLÍTICAS E TRANSFERÊNCIA");
    expect(s).toContain(POLITICAS_PADRAO);
    expect(POLITICAS_PADRAO).toMatch(/preço/);
    expect(POLITICAS_PADRAO).toMatch(/reembolso/);
    expect(POLITICAS_PADRAO).toMatch(/\[TRANSFERIR\]/);
    expect(POLITICAS_PADRAO).toMatch(/vou chamar alguém do time pra te responder isso direitinho/);
    expect(s.indexOf("PROMPT")).toBeLessThan(s.indexOf("## POLÍTICAS"));
    expect(s).toContain("[LINK_AGENDAMENTO]");
    const custom = montarSistema({ ...agente, politicas: "SÓ ISTO" }, { phone: "1" }, QUARTA_15H);
    expect(custom).toContain("SÓ ISTO");
    expect(custom).not.toContain(POLITICAS_PADRAO);
  });

  it("base de conhecimento junta texto livre, FAQ e textos ativos; inativo e FAQ incompleto ficam fora", () => {
    const t = textoConhecimento("Livre", [
      { tipo: "faq", pergunta: "Tem app?", resposta: "Tem sim" },
      { tipo: "faq", pergunta: "Sem resposta", resposta: "" },
      { tipo: "texto", titulo: "Método", conteudo: "Slim e Definida" },
      { tipo: "arquivo", titulo: "x.pdf", conteudo: "texto do pdf", ativo: false },
    ]);
    expect(t).toBe("Livre\n\nP: Tem app?\nR: Tem sim\n\n### Método\nSlim e Definida");
    const s = montarSistema(agente, { phone: "1" }, QUARTA_15H, undefined, { conhecimento: [{ tipo: "faq", pergunta: "Tem app?", resposta: "Tem sim" }] });
    expect(s).toContain("## BASE DE CONHECIMENTO\nP: Tem app?");
  });

  it("exemplos aprovados viram few-shot (até 20, só ativos)", () => {
    expect(textoExemplos([])).toBe("");
    const muitos = Array.from({ length: 30 }, (_, i) => ({ mensagem_lead: `oi ${i}`, resposta: `r ${i}` }));
    const t = textoExemplos([{ mensagem_lead: "x", resposta: "y", ativo: false }, ...muitos]);
    expect(t).toContain("Lead: oi 0\nResposta certa: r 0");
    expect(t).not.toContain("Lead: x");
    expect((t.match(/Lead:/g) ?? []).length).toBe(20);
  });
});

describe("portão antes do modelo", () => {
  const ctx = { grupo: false, numeroId: "num-comercial", textoLead: "oi", respostasDaIA: 0, agora: QUARTA_15H };

  it("responde quando tudo bate", () => {
    expect(decidirAntesDoModelo(agente, ctx)).toEqual({ acao: "responder" });
  });
  it("grupo nunca", () => {
    expect(decidirAntesDoModelo(agente, { ...ctx, grupo: true }).acao).toBe("ignorar");
  });
  it("desligado, sem número ou outro número: não responde", () => {
    expect(decidirAntesDoModelo({ ...agente, ativo: false }, ctx).acao).toBe("ignorar");
    expect(decidirAntesDoModelo({ ...agente, numero_id: null }, ctx).acao).toBe("ignorar");
    expect(decidirAntesDoModelo(agente, { ...ctx, numeroId: "num-closer" })).toEqual({ acao: "ignorar", motivo: "mensagem chegou em outro número" });
    expect(decidirAntesDoModelo(agente, { ...ctx, numeroId: null }).acao).toBe("ignorar");
  });
  it("fora do horário: só a mensagem configurada; vazia = silêncio", () => {
    expect(decidirAntesDoModelo(agente, { ...ctx, agora: QUARTA_23H })).toEqual({ acao: "fora_horario", mensagem: "Volto amanhã às 8h" });
    expect(decidirAntesDoModelo({ ...agente, mensagem_fora_horario: "  " }, { ...ctx, agora: QUARTA_23H })).toEqual({ acao: "fora_horario", mensagem: null });
    expect(decidirAntesDoModelo(agente, { ...ctx, agora: QUARTA_23H, ignorarHorario: true }).acao).toBe("responder");
  });
  it("limite de respostas e palavra de transferência passam para o humano com a frase curta", () => {
    const lim = decidirAntesDoModelo(agente, { ...ctx, respostasDaIA: 3 });
    expect(lim).toMatchObject({ acao: "transferir", frase: "vou chamar alguém do time pra te responder isso direitinho" });
    const preco = decidirAntesDoModelo(agente, { ...ctx, textoLead: "Qual o VALOR da consultoria?" });
    expect(preco).toMatchObject({ acao: "transferir", motivo: 'palavra "valor"' });
    expect(decidirAntesDoModelo({ ...agente, frase_transferencia: "já te passo pra Gabi" }, { ...ctx, textoLead: "e o reembolso?" }))
      .toMatchObject({ acao: "transferir", frase: "já te passo pra Gabi" });
  });
  it("simulador (numeroId undefined) não exige número nem ligado", () => {
    expect(decidirAntesDoModelo({ ...agente, ativo: false, numero_id: null }, { ...ctx, numeroId: undefined }).acao).toBe("responder");
  });
  it("palavra casa inteira, sem acento e sem pegar pedaço de outra palavra", () => {
    expect(casaPalavraTransferencia(["preço"], "qual o preco?")).toBe("preço");
    expect(casaPalavraTransferencia(["valor"], "me valoriza")).toBeNull();
    expect(casaPalavraTransferencia(["quanto custa"], "Quanto   custa isso")).toBe("quanto custa");
    expect(casaPalavraTransferencia([], "preço")).toBeNull();
  });
});

describe("pronto para ligar", () => {
  it("só com número + link https + horário (janela e dia)", () => {
    expect(prontoParaLigar(agente)).toEqual({ pronto: true, faltando: [] });
    expect(prontoParaLigar({ ...agente, numero_id: null }).faltando).toEqual(["número"]);
    expect(prontoParaLigar({ ...agente, link_agendamento: "http://x" }).faltando).toEqual(["link de agendamento"]);
    expect(prontoParaLigar({ ...agente, horario_inicio: null }).faltando).toEqual(["horário de atendimento"]);
    expect(prontoParaLigar({ ...agente, dias_semana: [] }).faltando).toEqual(["horário de atendimento"]);
    expect(prontoParaLigar({ ...agente, horario_inicio: "08:00", horario_fim: "08:00" }).pronto).toBe(false);
  });
  it("recomendação de número: comercial sim, closer nunca, oficial indisponível", () => {
    expect(recomendacaoNumero({ chave: "comercial-fit-2", apelido: "Comercial Fit 2", tipo: "openwa", ativo: true }).nivel).toBe("recomendado");
    expect(recomendacaoNumero({ chave: "closer", apelido: "Closer", tipo: "openwa", ativo: true }).nivel).toBe("evitar");
    expect(recomendacaoNumero({ chave: "oficial-full-funnel", apelido: "Oficial", tipo: "oficial", ativo: true }).nivel).toBe("indisponivel");
    expect(recomendacaoNumero({ chave: "comercial-x", apelido: "X", tipo: "openwa", ativo: false }).nivel).toBe("indisponivel");
  });
  it("payload salva só os campos da tela e mensagem fora do horário vazia vira null", () => {
    const p = payloadAgente({ ...agente, mensagem_fora_horario: "   " });
    expect(p.mensagem_fora_horario).toBeNull();
    expect(p).not.toHaveProperty("id");
    expect(p).not.toHaveProperty("slug");
    expect(p).toHaveProperty("numero_id", "num-comercial");
  });
});

describe("origem IA WhatsApp no funil", () => {
  it("utm whatsapp+ia (ou via ia-whatsapp) é IA WhatsApp, não Social Selling", () => {
    expect(inferFunnelKey({ utmSource: "whatsapp", utmMedium: "ia", utmCampaign: "agente_avaliacao" })).toBe("ia_whatsapp");
    expect(inferFunnelKey({ utmSource: "WhatsApp", utmMedium: "IA" })).toBe("ia_whatsapp");
    expect(inferFunnelKey({ via: "ia-whatsapp" })).toBe("ia_whatsapp");
    expect(inferBookingVia({ utmSource: "whatsapp", utmMedium: "ia" })).toBe("ia-whatsapp");
    // o resto continua como era
    expect(inferFunnelKey({ utmSource: "whatsapp", utmMedium: "grupo", utmContent: "avaliacao" })).toBe("grupo_avaliacao");
    expect(inferFunnelKey({ utmSource: "whatsapp" })).toBe("social_selling");
    expect(ehOrigemIA({ utmSource: "whatsapp", utmMedium: "grupo" })).toBe(false);
  });
  it("filtro PostgREST e conta de outras origens", () => {
    expect(filtroOrigemIA(false)).toBe("and(utm_source.ilike.whatsapp,utm_medium.ilike.ia)");
    expect(filtroOrigemIA(true)).toBe("and(utm_source.ilike.whatsapp,utm_medium.ilike.ia),via.eq.ia-whatsapp");
    expect(outrasOrigens({ leads: 10, qualificados: 6, agendados: 4, compareceu: null }, { leads: 3, qualificados: 2, agendados: 1, compareceu: 1 }))
      .toEqual({ leads: 7, qualificados: 4, agendados: 3, compareceu: null });
    expect(taxaEtapa(2, 4)).toBe("50%");
    expect(taxaEtapa(1, 0)).toBe("—");
  });
});

describe("migration 20261027140000_crm_treinar_ia", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261027140000_crm_treinar_ia.sql"), "utf8");
  const promptNovo = sql.slice(sql.indexOf("SET prompt = $ia$") + 17, sql.indexOf("$ia$,", sql.indexOf("SET prompt = $ia$")));

  it("agente individual sem PDF; preço vira transferência; link continua como marcação", () => {
    expect(promptNovo.length).toBeGreaterThan(3000);
    expect(promptNovo).not.toMatch(/PDF/);
    expect(promptNovo).toContain("[LINK_AGENDAMENTO]");
    expect(promptNovo).toContain('Mande só "vou chamar alguém do time pra te responder isso direitinho" e use [TRANSFERIR]');
    expect(promptNovo).not.toContain("Sobre valor e formato a gente conversa direitinho na call");
    expect(sql).toMatch(/WHERE slug = 'individual' AND position\('enviar o PDF de apresentação' in prompt\) > 0/);
  });
  it("não liga nada e protege o ligar", () => {
    expect(sql).not.toMatch(/SET\s+ativo\s*=\s*true/i);
    expect(sql).toMatch(/crm_ai_agents_pronto_para_ligar CHECK/);
    expect(sql).toMatch(/NOT VALID;/);
  });
  it("função do código do contato não abre para anon", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.crm_ai_ref_do_contato\(text\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/auth\.role\(\)/);
  });
});
