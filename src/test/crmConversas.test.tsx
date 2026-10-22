import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  canalDoContato,
  contatoEhGrupo,
  indexarResumos,
  corDoAutor,
  nomeExibido,
  rotuloAutor,
  contarNaoLidas,
  filtrarConversas,
  horarioDaLista,
  iniciais,
  mesclarMensagens,
  montarConversas,
  montarItensChat,
  previaDaMensagem,
  rotuloSeparador,
  statusEntrega,
  type ContatoCRM,
  type MensagemCRM,
} from "@/lib/crm/conversas";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";
import { StatusEntregaIcone } from "@/components/crm/conversas/StatusEntregaIcone";
import { BolhaMensagem } from "@/components/crm/conversas/BolhaMensagem";
import { AvatarContato } from "@/components/crm/conversas/AvatarContato";

// 17/10/2026 15:00 no fuso local do teste
const AGORA = new Date(2026, 9, 17, 15, 0, 0);
const local = (dia: number, h: number, m = 0, mes = 9, ano = 2026) => new Date(ano, mes, dia, h, m).toISOString();

const contato = (id: string, phone: string, extra: Partial<ContatoCRM> = {}): ContatoCRM => ({
  id, phone, name: `Pessoa ${id}`, stage: "leads", tags: [], updated_at: local(1, 8), ...extra,
});
let seq = 0;
const msg = (phone: string, quando: string, direcao: "inbound" | "outbound", extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
  id: `m${++seq}`, contact_phone: phone, body: "oi", created_at: quando, direction: direcao, sender_type: "lead", status: null, ...extra,
});

describe("horário relativo da lista", () => {
  it("hoje mostra a hora, ontem mostra 'Ontem', antes mostra a data", () => {
    expect(horarioDaLista(local(17, 14, 32), AGORA)).toBe("14:32");
    expect(horarioDaLista(local(16, 23, 59), AGORA)).toBe("Ontem");
    expect(horarioDaLista(local(12, 10, 0), AGORA)).toBe("12/10/2026");
    expect(horarioDaLista(null, AGORA)).toBe("");
  });
});

describe("separador de data", () => {
  it("Hoje, Ontem, '12 de outubro' e ano quando é outro", () => {
    expect(rotuloSeparador(local(17, 0, 1), AGORA)).toBe("Hoje");
    expect(rotuloSeparador(local(16, 12), AGORA)).toBe("Ontem");
    expect(rotuloSeparador(local(12, 9), AGORA)).toBe("12 de outubro");
    expect(rotuloSeparador(local(3, 9, 0, 11, 2025), AGORA)).toBe("3 de dezembro de 2025");
  });

  it("insere um separador por dia e agrupa mensagens seguidas do mesmo lado", () => {
    const p = "551199";
    const itens = montarItensChat([
      msg(p, local(17, 9, 2), "inbound"),
      msg(p, local(12, 9, 0), "inbound"),
      msg(p, local(17, 9, 0), "inbound"),
      msg(p, local(17, 9, 10), "outbound"),
      msg(p, local(16, 20, 0), "outbound"),
      msg(p, local(17, 9, 30), "outbound"),
    ], AGORA);
    expect(itens.filter((i) => i.tipo === "data").map((i) => i.tipo === "data" && i.rotulo))
      .toEqual(["12 de outubro", "Ontem", "Hoje"]);
    const hoje = itens.slice(itens.findIndex((i) => i.tipo === "data" && i.rotulo === "Hoje") + 1);
    const flags = hoje.map((i) => (i.tipo === "msg" ? [i.primeiraDoGrupo, i.ultimaDoGrupo] : null));
    // 9:00 e 9:02 recebidas = um grupo; 9:10 enviada abre grupo; 9:30 (20 min depois) abre outro
    expect(flags).toEqual([[true, false], [false, true], [true, true], [true, true]]);
  });

  it("bolha enviada fica à direita com hora e ✓✓ de lida", () => {
    const m = msg("5511", local(17, 14, 32), "outbound", { status: "read", body: "Combinado" });
    render(<BolhaMensagem msg={m} primeiraDoGrupo ultimaDoGrupo />);
    const b = screen.getByTestId("bolha");
    expect(b.dataset.direcao).toBe("enviada");
    expect(within(b).getByText("Combinado")).toBeInTheDocument();
    expect(within(b).getByText("14:32")).toBeInTheDocument();
    expect(within(b).getByRole("img", { name: "Lida" })).toBeInTheDocument();
  });
});

describe("status de entrega", () => {
  it("mapeia o status do banco e ignora mensagem recebida", () => {
    expect(statusEntrega({ direction: "outbound", status: "read" })).toBe("lida");
    expect(statusEntrega({ direction: "outbound", status: "delivered" })).toBe("entregue");
    expect(statusEntrega({ direction: "outbound", status: "sent" })).toBe("enviada");
    expect(statusEntrega({ direction: "outbound", status: null })).toBe("enviada");
    expect(statusEntrega({ direction: "outbound", status: "pending" })).toBe("pendente");
    expect(statusEntrega({ direction: "outbound", status: "failed" })).toBe("falhou");
    expect(statusEntrega({ direction: "inbound", status: "read" })).toBeNull();
  });

  it("um ✓ para enviada, ✓✓ para entregue e ✓✓ azul para lida", () => {
    const { rerender } = render(<StatusEntregaIcone status="enviada" />);
    expect(screen.getByRole("img", { name: "Enviada" }).getAttribute("class")).toContain("crm-chat-meta");
    rerender(<StatusEntregaIcone status="entregue" />);
    expect(screen.getByRole("img", { name: "Entregue" }).getAttribute("class")).not.toContain("crm-chat-lido");
    rerender(<StatusEntregaIcone status="lida" />);
    expect(screen.getByRole("img", { name: "Lida" }).getAttribute("class")).toContain("crm-chat-lido");
    rerender(<StatusEntregaIcone status={null} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("lista de conversas", () => {
  const contatos = [
    contato("a", "5511000000001", { name: "Ana", stage: "agendado", tags: ["vip"] }),
    contato("b", "5511000000002", { name: "Bia" }),
    contato("c", "5511000000003", { name: "Caio", updated_at: local(17, 10) }),
    contato("g", "120363000000000000@g.us", { name: "Turma" }),
  ];
  const recentes = [
    msg("5511000000001", local(16, 18), "inbound"),
    msg("5511000000002", local(17, 14, 32), "outbound", { status: "read", body: "fechado então" }),
    msg("5511000000002", local(17, 9), "inbound"),
    msg("5511000000001", local(17, 8), "inbound", { body: "[foto]", media_url: "x.jpg", media_type: "image" }),
  ];

  it("ordena pela última mensagem (sem mensagem: fim, por nome — nunca updated_at) e conta não lidas após a leitura", () => {
    const lista = montarConversas(contatos, recentes, { "5511000000001": local(16, 19) }, local(10, 0));
    // Caio tem updated_at de hoje 10h (backfill) e nenhuma mensagem: vai pro fim, não pro topo
    expect(lista.map((c) => c.contato.name)).toEqual(["Bia", "Ana", "Caio", "Turma"]);
    expect(lista.find((c) => c.contato.name === "Caio")?.ordem).toBe("");
    expect(lista.find((c) => c.contato.name === "Ana")?.naoLidas).toBe(1);
    expect(lista.find((c) => c.contato.name === "Bia")?.naoLidas).toBe(1); // recebida 9h, nunca aberta, base dia 10
    expect(contarNaoLidas(recentes, null)).toBe(0);
  });

  it("prévia de mídia sem texto vira o nome do tipo", () => {
    expect(previaDaMensagem(recentes[3])).toEqual({ tipo: "image", texto: "Foto" });
    expect(iniciais("Maria da Silva")).toBe("MS");
    expect(iniciais("", "21")).toBe("21");
  });

  it("filtra por não lidas, grupos, etapa, tag e busca", () => {
    const lista = montarConversas(contatos, recentes, {}, local(17, 8, 30));
    const nomes = (f: Parameters<typeof filtrarConversas>[2], q = "") => filtrarConversas(lista, q, f).map((c) => c.contato.name);
    expect(nomes("nao-lidas")).toEqual(["Bia"]);
    expect(nomes("grupos")).toEqual(["Turma"]);
    expect(nomes("etapa:agendado")).toEqual(["Ana"]);
    expect(nomes("tag:vip")).toEqual(["Ana"]);
    expect(nomes("tudo", "fechado")).toEqual(["Bia"]);
    expect(nomes("tudo", "0003")).toEqual(["Caio"]);
  });

  it("renderiza na ordem, com ✓✓, horário relativo, badge de não lidas e etapa; clique seleciona", () => {
    const lista = montarConversas(contatos, recentes, { "5511000000001": local(16, 19) }, local(10, 0));
    const onSelecionar = vi.fn();
    render(<ListaConversas conversas={lista} selecionado={null} onSelecionar={onSelecionar} agora={AGORA} />);
    const itens = screen.getAllByTestId("item-conversa");
    expect(itens.map((i) => i.dataset.phone)).toEqual(lista.map((c) => c.contato.phone));
    const bia = itens[0];
    expect(within(bia).getByText("14:32")).toBeInTheDocument();
    expect(within(bia).getByRole("img", { name: "Lida" })).toBeInTheDocument();
    expect(within(bia).getByTestId("nao-lidas")).toHaveTextContent("1");
    const ana = itens[1];
    expect(within(ana).getByText("Agendado")).toBeInTheDocument();
    expect(within(ana).getByText("Foto")).toBeInTheDocument();
    fireEvent.click(ana);
    expect(onSelecionar).toHaveBeenCalledWith(lista[1]);
    fireEvent.click(screen.getByRole("tab", { name: /Grupos/ }));
    expect(screen.getAllByTestId("item-conversa").map((i) => i.dataset.phone)).toEqual(["120363000000000000@g.us"]);
  });

  describe("resumo do banco (crm_conversas_ultimas)", () => {
    const cs = [
      contato("v", "5511000000009", { name: "Velho", updated_at: local(17, 19, 59) }), // backfill: updated_at = agora
      contato("n", "5511000000008", { name: "Novo", updated_at: local(1, 9) }),
      contato("s", "5511000000007", { name: "Sem msg", updated_at: local(17, 19, 59) }),
      contato("i", "ig:123", { name: "Insta", canal: "instagram" }),
    ];
    const resumo = indexarResumos([
      { contact_phone: "5511000000009", ultima: msg("5511000000009", local(3, 7, 0, 7), "inbound", { body: "oi de agosto" }), nao_lidas: 0 },
      { contact_phone: "5511000000008", ultima: msg("5511000000008", local(17, 14), "inbound", { body: "e aí" }), nao_lidas: 2 },
    ], (c) => canalDoContato(c) === "whatsapp");

    it("ordena pela última mensagem real do banco, mesmo fora da janela de recentes", () => {
      const lista = montarConversas(cs, [], {}, local(10, 0), resumo);
      expect(lista.map((c) => c.contato.name)).toEqual(["Novo", "Velho", "Insta", "Sem msg"]);
      expect(horarioDaLista(lista[1].ultima?.created_at, AGORA)).toBe("03/08/2026");
      expect(previaDaMensagem(lista[1].ultima).texto).toBe("oi de agosto");
      expect(lista[0].naoLidas).toBe(2);
    });

    it("contato confirmado sem mensagem sai do Tudo e aparece em Sem conversa; Instagram não é confirmado", () => {
      const lista = montarConversas(cs, [], {}, local(10, 0), resumo);
      const nomes = (f: Parameters<typeof filtrarConversas>[2], q = "") => filtrarConversas(lista, q, f).map((c) => c.contato.name);
      expect(nomes("tudo")).toEqual(["Novo", "Velho", "Insta"]);
      expect(nomes("sem-conversa")).toEqual(["Insta", "Sem msg"]);
      expect(nomes("tudo", "sem msg")).toEqual(["Sem msg"]); // busca acha
    });

    it("mensagem nova pelo Realtime passa na frente do resumo e soma não lida", () => {
      const nova = msg("5511000000009", local(17, 14, 50), "inbound", { body: "voltei" });
      const lista = montarConversas(cs, [nova], {}, local(10, 0), resumo);
      expect(lista[0].contato.name).toBe("Velho");
      expect(lista[0].naoLidas).toBe(1);
      expect(montarConversas(cs, [msg("5511000000008", local(17, 14, 55), "inbound")], {}, local(10, 0), resumo)
        .find((c) => c.contato.name === "Novo")?.naoLidas).toBe(3);
      // leu depois da última do resumo: zera
      expect(montarConversas(cs, [], { "5511000000008": local(17, 14, 30) }, local(10, 0), resumo)[0].naoLidas).toBe(0);
    });

    it("sem resumo (fallback): sem mensagem vai pro fim mas continua no Tudo", () => {
      const lista = montarConversas(cs, [msg("5511000000008", local(17, 14), "inbound")], {}, null, null);
      expect(lista[0].contato.name).toBe("Novo");
      expect(lista.slice(1).every((c) => c.ordem === "" && !c.semConversa)).toBe(true);
      expect(filtrarConversas(lista, "", "tudo")).toHaveLength(4);
    });

    it("lista mostra a pílula Sem conversa com a contagem e horário vazio pra quem não tem mensagem", () => {
      const lista = montarConversas(cs, [], {}, local(10, 0), resumo);
      render(<ListaConversas conversas={lista} selecionado={null} onSelecionar={() => {}} agora={AGORA} />);
      expect(screen.getAllByTestId("item-conversa")).toHaveLength(3);
      fireEvent.click(screen.getByRole("tab", { name: /Sem conversa 2/ }));
      const itens = screen.getAllByTestId("item-conversa");
      expect(itens.map((i) => i.dataset.phone)).toEqual(["ig:123", "5511000000007"]);
      expect(within(itens[1]).queryByText("19:59")).toBeNull();
    });
  });

  it("mescla eventos sem duplicar e atualiza status", () => {
    const a = msg("1", local(17, 9), "outbound", { status: "sent", message_id: "w1" });
    const r = mesclarMensagens([a], [{ ...a, status: "read" }, msg("1", local(17, 8), "inbound")]);
    expect(r).toHaveLength(2);
    expect(r[1].status).toBe("read");
    expect(r[0].created_at < r[1].created_at).toBe(true);
  });
});

describe("grupos e fotos", () => {
  const G = "120363000000000000@g.us";

  it("grupo pela coluna is_group ou pelo JID; nome exibido com fallback", () => {
    expect(contatoEhGrupo({ phone: G })).toBe(true);
    expect(contatoEhGrupo({ phone: "5531999998888", is_group: true })).toBe(true);
    expect(contatoEhGrupo({ phone: "5531999998888", is_group: false })).toBe(false);
    expect(nomeExibido({ phone: G, name: "Grupo", is_group: true })).toBe("Grupo");
    expect(nomeExibido({ phone: G, name: "", is_group: true })).toBe("Grupo");
    expect(nomeExibido({ phone: G, name: "Turma Outubro", is_group: true })).toBe("Turma Outubro");
    expect(nomeExibido({ phone: "5531999998888", name: "5531999998888" })).toBe("+55 31 99999-8888");
  });

  it("autor: nome, senão telefone; cor estável por pessoa", () => {
    expect(rotuloAutor({ author_name: "Carla", author_phone: "5531999998888" })).toBe("Carla");
    expect(rotuloAutor({ author_name: null, author_phone: "5531999998888" })).toBe("+55 31 99999-8888");
    expect(rotuloAutor({})).toBeNull();
    expect(rotuloAutor({ author_id: "98765432101234@lid" })).toBe("Participante");
    expect(corDoAutor("5531999998888")).toBe(corDoAutor("5531999998888"));
    expect(corDoAutor("")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("autor diferente quebra o bloco de bolhas no grupo", () => {
    const itens = montarItensChat([
      msg(G, local(17, 9, 0), "inbound", { author_phone: "5531911111111", author_name: "Ana" }),
      msg(G, local(17, 9, 1), "inbound", { author_phone: "5531911111111", author_name: "Ana" }),
      msg(G, local(17, 9, 2), "inbound", { author_phone: "5531922222222", author_name: "Beto" }),
      msg(G, local(17, 9, 3), "inbound", { author_id: "111@lid" }),
      msg(G, local(17, 9, 4), "inbound", { author_id: "222@lid" }),
    ], AGORA).filter((i) => i.tipo === "msg");
    expect(itens.map((i) => i.tipo === "msg" && i.primeiraDoGrupo)).toEqual([true, false, true, true, true]);
  });

  it("filtro Grupos usa is_group", () => {
    const lista = montarConversas(
      [contato("1", "5531999998888"), contato("2", G, { is_group: true, name: "Turma" }), contato("3", "5531977776666", { is_group: true })],
      [], {}, null,
    );
    expect(filtrarConversas(lista, "", "grupos").map((c) => c.contato.id).sort()).toEqual(["2", "3"]);
  });

  it("bolha de grupo mostra o autor só na primeira do bloco e nunca nas enviadas", () => {
    const m = msg(G, local(17, 9, 0), "inbound", { author_name: "Carla", body: "bom dia" });
    const { rerender } = render(<BolhaMensagem msg={m} primeiraDoGrupo ultimaDoGrupo emGrupo />);
    expect(screen.getByTestId("autor-bolha").textContent).toBe("Carla");
    rerender(<BolhaMensagem msg={m} primeiraDoGrupo={false} ultimaDoGrupo emGrupo />);
    expect(screen.queryByTestId("autor-bolha")).toBeNull();
    rerender(<BolhaMensagem msg={{ ...m, direction: "outbound" }} primeiraDoGrupo ultimaDoGrupo emGrupo />);
    expect(screen.queryByTestId("autor-bolha")).toBeNull();
    rerender(<BolhaMensagem msg={m} primeiraDoGrupo ultimaDoGrupo />);
    expect(screen.queryByTestId("autor-bolha")).toBeNull();
  });

  it("avatar: sem foto, grupo mostra ícone e contato mostra iniciais", () => {
    const { rerender } = render(<AvatarContato contato={{ phone: G, name: "Turma", is_group: true, avatar_url: null }} />);
    expect(screen.getByTestId("avatar-contato").getAttribute("data-grupo")).toBe("sim");
    expect(screen.getByLabelText("Grupo")).toBeTruthy();
    rerender(<AvatarContato contato={{ phone: "5531999998888", name: "Maria Souza", avatar_url: null }} />);
    expect(screen.getByTestId("avatar-contato").textContent).toBe("MS");
  });

  it("lista: grupo sem etapa, prévia com autor, botão atualizar chama a sincronização", async () => {
    const sinc = vi.fn().mockResolvedValue(undefined);
    const lista = montarConversas(
      [contato("2", G, { is_group: true, name: "Turma" })],
      [msg(G, local(17, 9, 0), "inbound", { author_name: "Carla", body: "chegou o material" })],
      {}, null,
    );
    render(<ListaConversas conversas={lista} selecionado={null} onSelecionar={() => {}} agora={AGORA} onSincronizar={sinc} />);
    const item = screen.getByTestId("item-conversa");
    expect(within(item).getByText(/Carla:/)).toBeTruthy();
    expect(within(item).queryByTitle("Etapa do funil")).toBeNull();
    fireEvent.click(screen.getByLabelText("Atualizar conversas e fotos do WhatsApp"));
    expect(sinc).toHaveBeenCalledTimes(1);
  });
});

describe("figurinha e foto (18/10)", () => {
  const base = { id: "9", contact_phone: "5531999998888", direction: "inbound", sender_type: "lead", body: "[figurinha]", caption: null,
    created_at: "2026-10-17T12:00:00Z", media_type: "sticker", mime_type: "image/webp", media_url: "https://x/s.webp" } as unknown as MensagemCRM;
  it("figurinha renderiza imagem de 140px sem bolha", () => {
    render(<BolhaMensagem msg={base} primeiraDoGrupo ultimaDoGrupo />);
    const img = screen.getByTestId("figurinha");
    expect(img.getAttribute("src")).toBe("https://x/s.webp");
    expect(img.className).toContain("140px");
    expect(document.querySelector(".crm-bolha")).toBeNull();
  });
  it("prévia da lista diz Figurinha, com ou sem arquivo", () => {
    expect(previaDaMensagem(base)).toEqual({ tipo: "sticker", texto: "Figurinha" });
    expect(previaDaMensagem({ ...base, media_url: null })).toEqual({ tipo: null, texto: "Figurinha" });
  });
  it("avatar troca de iniciais para a foto quando a URL chega", () => {
    const c = { phone: "5531999998888", name: "Maria Souza", avatar_url: null as string | null };
    const { rerender, container } = render(<AvatarContato contato={c} />);
    expect(screen.getByTestId("avatar-contato").textContent).toBe("MS");
    rerender(<AvatarContato contato={{ ...c, avatar_url: "https://x/a.jpg" }} />);
    expect(container.querySelector("img")?.getAttribute("loading") ?? "lazy").toBe("lazy");
  });
});
