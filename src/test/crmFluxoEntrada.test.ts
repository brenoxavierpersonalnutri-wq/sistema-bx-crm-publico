import { describe, expect, it } from "vitest";
import {
  amostraSegura,
  assinaturaConfere,
  chavesDoCorpo,
  eventoCustomizado,
  extrairLead,
  formParaObjeto,
  lerCaminho,
  normalizarTelefoneBR,
  origemWebhook,
  tokenConfere,
  urlEntrada,
} from "../../supabase/functions/_shared/fluxoEntrada.ts";
import {
  bateFiltroBanco,
  eventoDoBanco,
  eventoWebhook,
  gatilhosDoFluxo,
  inicioDoGatilho,
  inicioEventosFluxo,
  inscricoesDoFluxo,
  validarGatilho,
  type EventoFluxo,
  type Fluxo,
  type GatilhoFluxo,
} from "../../supabase/functions/_shared/fluxos.ts";
import { registroParaSalvar } from "../../supabase/functions/_shared/fluxoConstrutor.ts";
import { eventosParaEscolher, rotuloEvento, resumoGatilho } from "@/lib/crm/fluxosConstrutor";
import { filtrarTags, mesclarTags, podeCriarTag, variantesDasTags } from "@/lib/crm/tags";

describe("telefone BR", () => {
  it.each([
    ["+55 (31) 99999-8888", "5531999998888"],
    ["31999998888", "5531999998888"],
    ["031 99999-8888", "5531999998888"],
    ["5531999998888", "5531999998888"],
    ["(31) 9999-8888", "5531999998888"], // celular antigo de 8 dígitos ganha o 9
    ["(31) 3333-4444", "553133334444"],  // fixo fica com 8
    ["55999998888", "5555999998888"],    // DDD 55 sem DDI
    ["+1 415 555 2671", "14155552671"],   // fora do Brasil só com +
  ])("%s → %s", (bruto, esperado) => expect(normalizarTelefoneBR(bruto)).toBe(esperado));
  it.each(["", "123", "999998888", "(31) 8999-88888", "5500999998888", "abc"])("inválido: %s", (b) => expect(normalizarTelefoneBR(b)).toBeNull());
});

describe("mapeamento de campos", () => {
  const corpo = { contact: { full: "Maria Silva", whats: "+55 31 99999-0000" }, mail: "MARIA@EX.COM", etiquetas: ["Lead Site", "ebook"], produto: "Desafio", evt: "Carrinho Abandonado" };

  it("usa as chaves escolhidas (caminho com ponto) e normaliza", () => {
    const r = extrairLead(corpo, { telefone: "contact.whats", nome: "contact.full", email: "mail", tags: "etiquetas", evento: "evt" }, ["Vindo do Site"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead).toMatchObject({ telefone: "5531999990000", nome: "Maria Silva", email: "maria@ex.com", evento: "wh_carrinho_abandonado" });
    expect(r.lead.tags).toEqual(["vindo-do-site", "lead-site", "ebook"]);
    expect(r.lead.dados.produto).toBe("Desafio");
    expect(r.lead.dados.contact_full).toBe("Maria Silva");
  });

  it("sem mapeamento tenta os nomes comuns (phone/name/email, tags em texto)", () => {
    const r = extrairLead({ name: "João", phone: "31988887777", email: "j@x.com", tags: "a, b;c" }, {});
    expect(r.ok && r.lead).toMatchObject({ telefone: "5531988887777", nome: "João", email: "j@x.com", tags: ["a", "b", "c"], evento: null });
  });

  it("chave mapeada que não veio e telefone inválido viram erro claro", () => {
    expect(extrairLead({ phone: "31988887777" }, { telefone: "celular" })).toEqual({ ok: false, erro: 'a chave "celular" não veio no corpo' });
    expect(extrairLead({ telefone: "123" }, {})).toEqual({ ok: false, erro: "telefone inválido: 123" });
    expect(extrairLead({ nome: "x" }, {}).ok).toBe(false);
    expect(extrairLead([1, 2], {}).ok).toBe(false);
  });

  it("e-mail inválido é descartado (não derruba a lead)", () => {
    const r = extrairLead({ phone: "31988887777", email: "nao-e-email" }, {});
    expect(r.ok && r.lead.email).toBeNull();
  });

  it("formulário: chave literal com colchete e chave repetida vira lista", () => {
    const o = formParaObjeto(new URLSearchParams("contact[phone]=31988887777&tags=a&tags=b"));
    expect(o).toEqual({ "contact[phone]": "31988887777", tags: ["a", "b"] });
    expect(lerCaminho(o, "contact[phone]")).toBe("31988887777");
    expect(lerCaminho({ contact: { phone: "1" } }, "contact[phone]")).toBe("1");
    const r = extrairLead(o, { telefone: "contact[phone]" });
    expect(r.ok && r.lead.tags).toEqual(["a", "b"]);
  });

  it("chaves da amostra para o seletor de mapeamento", () => {
    expect(chavesDoCorpo(corpo).map((c) => c.chave)).toEqual(["contact.full", "contact.whats", "mail", "etiquetas", "produto", "evt"]);
    expect(chavesDoCorpo(corpo).find((c) => c.chave === "etiquetas")?.exemplo).toBe("Lead Site, ebook");
  });

  it("evento customizado sempre com prefixo wh_ (não finge ser formulário ou PagTrust)", () => {
    expect(eventoCustomizado("lead_qualificado")).toBe("wh_lead_qualificado");
    expect(eventoCustomizado("wh_x")).toBe("wh_x");
    expect(eventoCustomizado("  ")).toBeNull();
  });

  it("amostra corta texto longo e profundidade", () => {
    const a = amostraSegura({ t: "x".repeat(900), a: { b: { c: { d: { e: { f: 1 } } } } } }) as Record<string, unknown>;
    expect(String(a.t).length).toBe(501);
    expect(JSON.stringify(a)).toContain("[…]");
  });

  it("token e assinatura em tempo constante; URL e origem", () => {
    expect(tokenConfere("abc", "abc")).toBe(true);
    expect(tokenConfere("abd", "abc")).toBe(false);
    expect(tokenConfere("", "")).toBe(false);
    expect(assinaturaConfere("sha256=ABCD", "abcd")).toBe(true);
    expect(assinaturaConfere("abce", "abcd")).toBe(false);
    expect(assinaturaConfere(null, "abcd")).toBe(false);
    expect(urlEntrada("https://x.supabase.co/functions/v1/", "a1", "t2")).toBe("https://x.supabase.co/functions/v1/fluxo-entrada?f=a1&k=t2");
    expect(origemWebhook("Leads do Site – Ebook!")).toBe("webhook:leads-do-site-ebook");
  });
});

describe("gatilho Novo lead no banco", () => {
  const g = (p: Partial<Extract<GatilhoFluxo, { tipo: "banco" }>> = {}): Extract<GatilhoFluxo, { tipo: "banco" }> => ({ tipo: "banco", fonte: "formulario", ...p });

  it("filtro de nível e origem", () => {
    expect(bateFiltroBanco(g(), { nivel: "DQ" })).toBe(true);
    expect(bateFiltroBanco(g({ niveis: ["A", "B"] }), { nivel: "a" })).toBe(true);
    expect(bateFiltroBanco(g({ niveis: ["A", "B"] }), { nivel: "C" })).toBe(false);
    expect(bateFiltroBanco(g({ niveis: ["A"] }), {})).toBe(false);
    expect(bateFiltroBanco(g({ origens: ["individual"] }), { nivel: "A", origem: "avaliacao" })).toBe(false);
    expect(bateFiltroBanco(g({ niveis: ["A"], origens: ["avaliacao"] }), { nivel: "A", origem: "avaliacao" })).toBe(true);
    // nível não se aplica a agendamento
    expect(bateFiltroBanco(g({ fonte: "agendamento", niveis: ["A"] }), { origem: "calendly" })).toBe(true);
    expect(bateFiltroBanco(g({ fonte: "base_leads", origens: ["sellflux"] }), { origem: "SellFlux" })).toBe(true);
  });

  it("só registros NOVOS: conta do mais recente entre publicar o fluxo e criar o gatilho", () => {
    const pub = new Date("2026-10-18T10:00:00Z");
    expect(inicioDoGatilho(pub, {}).toISOString()).toBe(pub.toISOString());
    expect(inicioDoGatilho(pub, { criado_em: "2026-10-18T12:00:00Z" }).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(inicioDoGatilho(pub, { criado_em: "2026-10-01T00:00:00Z" }).toISOString()).toBe(pub.toISOString());
    expect(inicioDoGatilho(pub, { criado_em: "lixo" }).toISOString()).toBe(pub.toISOString());

    // ponta a ponta das regras do motor: evento antes da publicação não inscreve, depois inscreve
    const agora = new Date("2026-10-18T13:00:00Z");
    const f: Fluxo = { id: "f1", nome: "F", ativo: true, gatilho_tipo: "evento", gatilho_valor: "banco_formulario", parar_se_responder: false, permitir_repetir: false, passos: [{ tipo: "parar" }], ligado_em: "2026-10-18T12:00:00Z" };
    const ev = (phone: string, t: string, nivel = "A"): EventoFluxo => ({ contact_phone: phone, tipo: "evento", valor: "banco_formulario", created_at: t, dados: { nivel } });
    const evs = [ev("5531900000001", "2026-10-18T11:59:00Z"), ev("5531900000002", "2026-10-18T12:30:00Z"), ev("5531900000003", "2026-10-18T12:40:00Z", "D")]
      .filter((e) => bateFiltroBanco(g({ niveis: ["A", "B"] }), e.dados));
    const contatos = new Map(["5531900000001", "5531900000002", "5531900000003"].map((p) => [p, { phone: p }]));
    expect(inicioEventosFluxo(f, agora).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(inscricoesDoFluxo(f, evs, contatos, [], agora).map((x) => x.phone)).toEqual(["5531900000002"]);
  });

  it("nomes dos eventos e validação", () => {
    expect(eventoDoBanco("compra")).toBe("banco_compra");
    expect(eventoWebhook("8f1e2d3c-0000-4000-8000-123456789abc")).toBe("webhook_8f1e2d3c000040008000123456789abc");
    expect(validarGatilho(g(), 1, {})).toEqual([]);
    expect(validarGatilho(g({ niveis: ["Z"] }), 1, {})).toEqual(["Gatilho 1: nível inválido (A, B, C, D ou DQ)."]);
    expect(validarGatilho(g({ fonte: "nada" as never }), 1, {})[0]).toMatch(/escolha a fonte/);
    // base e WhatsApp podem chegar em lote (importação): exigem limite por dia
    expect(validarGatilho(g({ fonte: "base_leads" }), 1, {})[0]).toMatch(/limite por dia/);
    expect(validarGatilho(g({ fonte: "base_leads" }), 1, { limite_dia: 50 })).toEqual([]);
    expect(validarGatilho({ tipo: "webhook" }, 1, {})).toEqual([]);
    expect(registroParaSalvar({ nome: "x", gatilhos: [g({ fonte: "compra" })], arvore: [] })).toMatchObject({ gatilho_tipo: "banco", gatilho_valor: "banco:compra" });
    expect(registroParaSalvar({ nome: "x", gatilhos: [{ tipo: "webhook" }], arvore: [] })).toMatchObject({ gatilho_tipo: "webhook", gatilho_valor: "webhook" });
    expect(resumoGatilho(g({ niveis: ["A", "B"], origens: ["avaliacao"] }))).toBe("Formulário da avaliação · nível A/B · avaliacao · só novos");
  });
});

describe("gatilho Formulário / evento", () => {
  it("fluxo novo (evento sem nome) não tem gatilho fantasma", () => {
    expect(gatilhosDoFluxo({ gatilho_tipo: "evento", gatilho_valor: null, gatilhos: [] })).toEqual([]);
    expect(gatilhosDoFluxo({ gatilho_tipo: "evento", gatilho_valor: "lead_qualificado" })).toEqual([{ tipo: "evento", valor: "lead_qualificado" }]);
  });

  it("lista: conhecidos + banco + customizados vistos (sem o interno webhook_<uuid>)", () => {
    const l = eventosParaEscolher([
      { valor: "wh_carrinho", total: 4 },
      { valor: "webhook_8f1e2d3c000040008000123456789abc", total: 9 },
      { valor: "pagtrust_desafio_compra_aprovada", total: 2 },
    ]);
    const v = l.map((e) => e.valor);
    expect(v).toContain("lead_qualificado");
    expect(v).toContain("banco_formulario");
    expect(v).toContain("wh_carrinho");
    expect(v.some((x) => x.startsWith("webhook_"))).toBe(false);
    expect(l.find((e) => e.valor === "wh_carrinho")).toMatchObject({ rotulo: "Webhook: carrinho", produtor: true, total: 4 });
    expect(l.find((e) => e.valor === "pagtrust_desafio_compra_aprovada")?.produtor).toBe(true); // visto = tem produtor
    expect(l.find((e) => e.valor === "pagtrust_lowticket_pix_gerado")?.produtor).toBe(false);
    expect(rotuloEvento("banco_compra")).toBe("Banco: Compra PagTrust");
    expect(resumoGatilho({ tipo: "evento", valor: "" })).toBe("escolha o evento");
  });
});

describe("tags existentes", () => {
  const lista = [{ tag: "comprou", uso: 300, variantes: ["Comprou", "comprou"] }, { tag: "lead-site", uso: 10 }, { tag: "vip", uso: 50 }, { tag: "Vip", uso: 2 }];

  it("busca sem acento, mais usadas primeiro, junta grafias e inclui as escolhidas", () => {
    expect(filtrarTags(lista, "").map((x) => `${x.tag}=${x.uso}`)).toEqual(["comprou=300", "vip=52", "lead-site=10"]);
    expect(filtrarTags(lista, "Comp").map((x) => x.tag)).toEqual(["comprou"]);
    expect(filtrarTags(lista, "", ["Nova Tag"]).map((x) => x.tag)).toContain("nova-tag");
  });

  it("+ Criar tag só quando não existe (normalizada para minúsculas-com-hífen)", () => {
    expect(podeCriarTag(lista, "Lead Ébook")).toBe("lead-ebook");
    expect(podeCriarTag(lista, "VIP")).toBeNull();
    expect(podeCriarTag(lista, "  ")).toBeNull();
  });

  it("variantes para o filtro exato do Banco e grafia original mantida no chat", () => {
    expect(variantesDasTags(lista, ["comprou"]).sort()).toEqual(["Comprou", "comprou"]);
    expect(variantesDasTags(lista, ["nova"])).toEqual(["nova"]);
    expect(mesclarTags(["Comprou", "VIP"], ["comprou", "nova-tag"])).toEqual(["Comprou", "nova-tag"]);
  });
});
