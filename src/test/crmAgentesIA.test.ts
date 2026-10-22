import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarVariaveis,
  dentroDoHorario,
  escolherAgente,
  finalizarSaida,
  historicoParaChat,
  interpretarResposta,
  montarSistema,
  type AgenteIA,
} from "../../supabase/functions/_shared/agentesIA.ts";
import { formatarAtraso, passoEnviavel, variaveisPendentes } from "@/lib/crmRoteiros";

const base: AgenteIA = {
  id: "1",
  slug: "avaliacao",
  nome: "Avaliação fitness",
  prompt: "PROMPT AVALIACAO",
  base_conhecimento: "Matheus: wa.me/5531970000106",
  etapas: ["leads", "contato", "agendado"],
  origens: ["avaliacao"],
  gatilhos: ["Fui qualificada no formulário de avaliação!"],
  modelo: null,
  temperatura: 0.1,
  ativo: true,
  horario_inicio: null,
  horario_fim: null,
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  limite_interacoes: 15,
  historico_mensagens: 20,
  atraso_segundos: 6,
};
const individual: AgenteIA = {
  ...base,
  id: "2",
  slug: "individual",
  nome: "Individual",
  origens: ["individual"],
  gatilhos: ["consultoria de elite"],
};

describe("escolherAgente (TRIAGEM do SellFlux)", () => {
  const contato = { phone: "5531999990000", stage: "leads" };

  it("gatilho da mensagem atribui o agente certo, sem depender de acento ou caixa", () => {
    expect(escolherAgente([base, individual], contato, "oi! fui QUALIFICADA no formulario de avaliacao!")?.agente.slug).toBe("avaliacao");
    expect(escolherAgente([base, individual], contato, "Quero saber da Consultoria de Elite")?.agente.slug).toBe("individual");
  });

  it("sem gatilho nem origem, ninguém responde (gatilho é o texto exato do filtro da TRIAGEM)", () => {
    expect(escolherAgente([base, individual], contato, "boa tarde")).toBeNull();
    expect(escolherAgente([base], contato, "fui qualificada no formulário de avaliação")).toBeNull();
  });

  it("origem do contato atribui quando não há gatilho", () => {
    const r = escolherAgente([base, individual], { ...contato, source: "Individual" }, "oi");
    expect(r?.agente.slug).toBe("individual");
    expect(r?.motivo).toBe("origem");
  });

  it("agente já atribuído continua, e não troca se estiver desligado", () => {
    expect(escolherAgente([base, individual], { ...contato, ai_agent_slug: "individual" }, "fui qualificada no formulário de avaliação!")?.agente.slug).toBe("individual");
    expect(escolherAgente([base, { ...individual, ativo: false }], { ...contato, ai_agent_slug: "individual" }, "fui qualificada no formulário de avaliação!")).toBeNull();
  });

  it("respeita as etapas e o liga/desliga", () => {
    expect(escolherAgente([base], { ...contato, stage: "fechou" }, "fui qualificada no formulário de avaliação!")).toBeNull();
    expect(escolherAgente([{ ...base, ativo: false }], contato, "fui qualificada no formulário de avaliação!")).toBeNull();
    expect(escolherAgente([{ ...base, etapas: [] }], { ...contato, stage: "fechou" }, "fui qualificada no formulário de avaliação!")).not.toBeNull();
  });
});

describe("dentroDoHorario (America/Sao_Paulo)", () => {
  // 2026-10-16 é sexta. 13:00Z = 10:00 em Brasília.
  const sexta10h = new Date("2026-10-16T13:00:00Z");
  it("sem horário = 24h", () => expect(dentroDoHorario(base, sexta10h)).toBe(true));
  it("janela normal", () => {
    expect(dentroDoHorario({ ...base, horario_inicio: "08:00", horario_fim: "18:00" }, sexta10h)).toBe(true);
    expect(dentroDoHorario({ ...base, horario_inicio: "11:00:00", horario_fim: "18:00:00" }, sexta10h)).toBe(false);
  });
  it("janela que vira a noite", () => {
    expect(dentroDoHorario({ ...base, horario_inicio: "22:00", horario_fim: "06:00" }, new Date("2026-10-17T02:00:00Z"))).toBe(true); // 23h
    expect(dentroDoHorario({ ...base, horario_inicio: "22:00", horario_fim: "06:00" }, sexta10h)).toBe(false);
  });
  it("dias da semana", () => {
    expect(dentroDoHorario({ ...base, dias_semana: [1, 2, 3, 4] }, sexta10h)).toBe(false);
    expect(dentroDoHorario({ ...base, dias_semana: [5] }, sexta10h)).toBe(true);
  });
});

describe("interpretarResposta (ações do agente)", () => {
  it("separa mensagens por linha em branco e envia mídias na ordem", () => {
    const r = interpretarResposta(
      "Perfeitooo Maria!\n\nAntes da avaliação, queria entender\n[IMAGEM:https://x.com/1.jpg]\n[IMAGEM:https://x.com/2.jpg]\nAlgum desses físicos é mais parecido com o seu?\n[AUDIO:https://x.com/a.mp3]",
    );
    expect(r.mensagens.map((m) => m.tipo)).toEqual(["text", "text", "image", "image", "text", "audio"]);
    expect(r.mensagens[2].conteudo).toBe("https://x.com/1.jpg");
    expect(r.transferir).toBe(false);
  });

  it("[TRANSFERIR] e [ETAPA:x] viram ações e somem do texto", () => {
    const r = interpretarResposta("Show, já te respondo tá?\n\nhttps://youtu.be/fDbI0wnJH14\n[ETAPA:agendado]\n[TRANSFERIR]");
    expect(r.transferir).toBe(true);
    expect(r.etapa).toBe("agendado");
    expect(r.mensagens.map((m) => m.conteudo).join(" ")).not.toMatch(/TRANSFERIR|ETAPA/);
  });

  it("etapa inválida é ignorada; [SILENCIO] não manda nada", () => {
    expect(interpretarResposta("oi [ETAPA:inexistente]").etapa).toBeNull();
    expect(interpretarResposta("ok\n[SILENCIO]").mensagens).toEqual([]);
  });

  it("limpa markdown como o SellFlux e descarta '(sem resposta)'", () => {
    const r = interpretarResposta("**Oi**\n---\n[clique](https://a.com)\n\n(sem resposta)");
    expect(r.mensagens.map((m) => m.conteudo)).toEqual(["*Oi*\nhttps://a.com"]);
  });
});

describe("prompt e histórico", () => {
  it("montarSistema junta prompt, base, dados do contato e protocolo de ações", () => {
    const s = montarSistema(base, { phone: "5531999990000", name: "maria souza", stage: "contato" }, new Date("2026-10-16T13:00:00Z"));
    expect(s).toContain("PROMPT AVALIACAO");
    expect(s).toContain("BASE DE CONHECIMENTO");
    expect(s).toContain("Primeiro nome: Maria");
    expect(s).toContain("16/10/2026 10:00");
    expect(s).toContain("[TRANSFERIR]");
  });

  it("historicoParaChat junta mensagens seguidas do mesmo lado", () => {
    const h = historicoParaChat([
      { direction: "inbound", body: "oi" },
      { direction: "inbound", body: "tudo bem?" },
      { direction: "outbound", sender_type: "bot", body: "Oiii" },
      { direction: "outbound", sender_type: "bot", body: "" },
    ]);
    expect(h).toEqual([
      { role: "user", content: "oi\n\ntudo bem?" },
      { role: "assistant", content: "Oiii" },
    ]);
  });
});

describe("roteiros", () => {
  it("aplicarVariaveis troca primeiro nome (inclusive {{lead.first_name}}) e mantém as desconhecidas", () => {
    const t = aplicarVariaveis("Oiiii {primeiro_nome}, {{lead.first_name}}! dia {data}", { name: "ANA paula", phone: "55319" });
    expect(t).toBe("Oiiii Ana, Ana! dia {data}");
    expect(aplicarVariaveis("dia {data} às {hora}", { name: "Ana" }, { data: "20/10", hora: "15h" })).toBe("dia 20/10 às 15h");
  });

  it("nome igual ao telefone não vira primeiro nome", () => {
    expect(aplicarVariaveis("Oi {primeiro_nome}", { name: "5531999990000", phone: "5531999990000" })).toBe("Oi {primeiro_nome}");
  });

  it("variaveisPendentes, formatarAtraso e passoEnviavel", () => {
    expect(variaveisPendentes("x {data} y {hora} {data}")).toEqual(["data", "hora"]);
    expect(variaveisPendentes("link:\n\n[LINK_AGENDAMENTO]\n\nAssim que agendar")).toEqual(["LINK_AGENDAMENTO"]);
    expect(variaveisPendentes("ok [TRANSFERIR]")).toEqual([]);
    expect(formatarAtraso(0)).toBe("agora");
    expect(formatarAtraso(6)).toBe("6 s");
    expect(formatarAtraso(300)).toBe("5 min");
    expect(formatarAtraso(86400)).toBe("1 dia");
    expect(passoEnviavel({ tipo: "document", conteudo: "", media_url: null }, "")).toBe(false);
    expect(passoEnviavel({ tipo: "text", conteudo: "", media_url: null }, "oi")).toBe(true);
  });
});

describe("texto do SellFlux ao pé da letra", () => {
  it("[LINK_AGENDAMENTO] do roteiro troca pelo que foi preenchido", () => {
    const t = "Fechado! Segue o link pra você travar o horário que melhor encaixa pra você:\n\n[LINK_AGENDAMENTO]";
    expect(aplicarVariaveis(t, { name: "Ana" })).toBe(t);
    expect(aplicarVariaveis(t, { name: "Ana" }, { link_agendamento: "https://agenda.x/1" })).toContain("\n\nhttps://agenda.x/1");
    expect(aplicarVariaveis("Boa {{primeiro nome}}.", { name: "ana" })).toBe("Boa Ana.");
  });

  it("finalizarSaida troca o primeiro nome e segura variável crua, passando para o humano", () => {
    const r = finalizarSaida(
      interpretarResposta("Oiiii {{lead.first_name}}, como é que você está?\n\nRecebi seu formulário, sua avaliação ficou agendada para *{{data}} às {{hora}}*\n\nPosso confirmar aqui?"),
      { name: "maria", phone: "5531" },
    );
    expect(r.mensagens.map((m) => m.conteudo)).toEqual(["Oiiii Maria, como é que você está?", "Posso confirmar aqui?"]);
    expect(r.retidas).toEqual(["data", "hora"]);
    expect(r.transferir).toBe(true);
  });

  it("finalizarSaida segura [LINK_AGENDAMENTO] e não mexe em mídia nem em resposta limpa", () => {
    const r = finalizarSaida(interpretarResposta("Fechado!\n\n[LINK_AGENDAMENTO]\n[IMAGEM:https://x.com/1.jpg]"), { name: "Ana" });
    expect(r.mensagens).toEqual([{ tipo: "text", conteudo: "Fechado!" }, { tipo: "image", conteudo: "https://x.com/1.jpg" }]);
    expect(r.transferir).toBe(true);
    const limpo = finalizarSaida(interpretarResposta("Perfeitooo Ana!"), { name: "Ana" });
    expect(limpo.transferir).toBe(false);
    expect(limpo.retidas).toEqual([]);
  });

  it("a migration grava os textos originais (inclusive os erros de digitação) e não os adaptados", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261017110000_roteiros_iguais_sellflux.sql"), "utf-8");
    for (const literal of [
      "o seu glúteo é parecido com eses biotipo?",
      "tudo depois dessa avaliação especifica para um fisico mais Slim e Definido",
      "Eiii, a sua avaliação está marcada aqui, já estamos adiantando tudo, está tudo certo? Quer relatar algo antes também?",
      "o Breno acabou de liberar o segredo das estrategias que ele utilizou nessas alunas falsas magras",
      "Perfeito{{lead.first_name}} , esse é exatamente o resultado que eu mais entrego aqui dentro.",
      "Hoje as vagas dessa consultoria de elite estão fechadas",
      "NÃO MANDAR TEXTO GRANDE,  MANDAR  TODAS  FRASES separadas, como se  fosse humano",
      "Fui qualificada no formulário de avaliação!",
      "[IMAGEM:https://equipe.brenoxavier.com.br/roteiros/sellflux/fisico-1.jpg]",
      "[DOCUMENTO:https://equipe.brenoxavier.com.br/roteiros/sellflux/mapeamento.pdf]",
    ]) expect(sql).toContain(literal);
    for (const adaptado of [
      "O seu glúteo é parecido com esses biotipos?",
      "estratégias que ele usou nessas alunas",
      "sellflux.nyc3.digitaloceanspaces.com/sellflux/project_32021/b4e6",
    ]) expect(sql).not.toContain(adaptado);
  });
});
