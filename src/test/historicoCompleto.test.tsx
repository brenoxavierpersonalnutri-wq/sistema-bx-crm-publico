// Histórico completo por número (18/10/2026): decisão de iniciar/retomar no servidor, contato novo com a data
// real, estado do cartão e o fluxo pausar/retomar na tela Conexões.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  POR_CHAT_HISTORICO_COMPLETO, contatoNovoDoBackfill, decidirInicio, textoProgresso,
} from "../../supabase/functions/_shared/waBackfill";
import { detalheHistorico, estadoHistorico } from "@/lib/crm/historicoCompleto";
import { HistoricoCompleto } from "@/components/crm/conexoes/HistoricoCompleto";
import type { JobBackfill } from "@/lib/crm/fonteConversas";

const NUM = "11111111-2222-3333-4444-555555555555";
const job = (p: Partial<JobBackfill>): JobBackfill => ({
  id: "j1", status: "importando", completo: true, total_chats: 600, chats_feitos: 150, chats_erro: 0, msgs_importadas: 9000,
  midias: 0, por_chat: 2000, aviso: null, criado_em: "2026-10-18T22:00:00Z", concluido_em: null, ...p,
});

describe("servidor: decidirInicio", () => {
  it("nada em aberto cria; ativo do mesmo tipo reusa", () => {
    expect(decidirInicio(null, true)).toBe("criar");
    expect(decidirInicio({ status: "concluido", completo: true }, true)).toBe("criar");
    expect(decidirInicio({ status: "importando", completo: true }, true)).toBe("reusar");
  });
  it("job de 90 dias ativo/pausado vira histórico completo (cancela e cria)", () => {
    expect(decidirInicio({ status: "importando", completo: false }, true)).toBe("cancelar-e-criar");
    expect(decidirInicio({ status: "pausado", completo: false }, true)).toBe("cancelar-e-criar");
  });
  it("pausado do tipo pedido retoma; pedido normal nunca derruba o completo", () => {
    expect(decidirInicio({ status: "pausado", completo: true }, true)).toBe("retomar");
    expect(decidirInicio({ status: "pausado", completo: true }, false)).toBe("retomar");
    expect(decidirInicio({ status: "listando", completo: true }, false)).toBe("reusar");
  });
  it("teto de 2000 mensagens por conversa e texto de pausado", () => {
    expect(POR_CHAT_HISTORICO_COMPLETO).toBe(2000);
    expect(textoProgresso({ status: "pausado", total_chats: 10, chats_feitos: 3 })).toBe("pausado em 3/10");
  });
});

describe("servidor: contato novo do backfill", () => {
  it("histórico completo: source whatsapp-historico e data da última mensagem real", () => {
    expect(contatoNovoDoBackfill({ kind: "individual", nome: "Kelly" }, "5531999990001", "2024-03-01T10:00:00.000Z", true, NUM)).toEqual({
      numero_id: NUM, phone: "5531999990001", name: "Kelly", source: "whatsapp-historico",
      updated_at: "2024-03-01T10:00:00.000Z", created_at: "2024-03-01T10:00:00.000Z",
    });
  });
  it("backfill normal mantém whatsapp-backfill; grupo continua grupo", () => {
    expect(contatoNovoDoBackfill({ kind: "individual", nome: null }, "5531999990001", "x", false, null)).toMatchObject({ source: "whatsapp-backfill", name: "5531999990001" });
    expect(contatoNovoDoBackfill({ kind: "group", nome: "Turma" }, "1203@g.us", "x", true, null)).toMatchObject({ is_group: true, source: "whatsapp-grupo" });
  });
});

describe("cartão: estadoHistorico", () => {
  it("sem job completo oferece iniciar (job de 90 dias não conta)", () => {
    expect(estadoHistorico(null).acoes).toEqual(["iniciar"]);
    expect(estadoHistorico(job({ completo: false })).acoes).toEqual(["iniciar"]);
  });
  it("importando: progresso X/Y, pausar e cancelar", () => {
    const e = estadoHistorico(job({}));
    expect(e).toMatchObject({ texto: "Importando 150/600 conversas", pct: 25, ativo: true, acoes: ["pausar", "cancelar"] });
    expect(detalheHistorico(job({ chats_erro: 2 }))).toBe("9000 mensagens · 2 com erro");
  });
  it("pausado: retomar; concluído: rodar de novo", () => {
    expect(estadoHistorico(job({ status: "pausado" }))).toMatchObject({ ativo: false, acoes: ["retomar", "cancelar"], pct: 25 });
    expect(estadoHistorico(job({ status: "concluido", chats_feitos: 600 }))).toMatchObject({ pct: 100, rotuloIniciar: "Rodar de novo" });
    expect(estadoHistorico(job({ status: "listando", total_chats: 0, chats_feitos: 0 }))).toMatchObject({ pct: null, ativo: true });
  });
});

describe("tela: HistoricoCompleto", () => {
  const apiCom = (inicial: JobBackfill | null) => {
    let atual = inicial;
    return {
      status: vi.fn(async () => atual),
      iniciar: vi.fn(async (_n?: string | null, o?: { completo?: boolean }) => (atual = job({ status: "listando", completo: !!o?.completo, total_chats: 0, chats_feitos: 0 }))),
      cancelar: vi.fn(async () => (atual = atual && { ...atual, status: "cancelado" })),
      pausar: vi.fn(async () => (atual = atual && { ...atual, status: "pausado" })),
      retomar: vi.fn(async () => (atual = atual && { ...atual, status: "listando" })),
    };
  };
  it("iniciar pede confirmação e manda completo: true com o numero_id", async () => {
    const api = apiCom(null);
    render(<HistoricoCompleto numeroId={NUM} apelido="Comercial Fit 2" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Trazer histórico completo/ }));
    expect(screen.getByText(/até 2000 mensagens por conversa/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trazer histórico" }));
    await waitFor(() => expect(api.iniciar).toHaveBeenCalledWith(NUM, { completo: true }));
    expect(await screen.findByText("Listando as conversas do WhatsApp…")).toBeInTheDocument();
  });
  it("pausar e retomar", async () => {
    const api = apiCom(job({}));
    render(<HistoricoCompleto numeroId={NUM} apelido="Fit" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /Pausar/ }));
    expect(await screen.findByText("Pausado em 150/600 conversas")).toBeInTheDocument();
    expect(api.pausar).toHaveBeenCalledWith(NUM);
    fireEvent.click(screen.getByRole("button", { name: /Retomar/ }));
    await waitFor(() => expect(api.retomar).toHaveBeenCalledWith(NUM));
  });
});
