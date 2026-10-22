import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  extrairMidias,
  filtrarRoteiros,
  midiasDoPasso,
  montarInsercao,
  ordenarRoteiros,
  passoParaPreencher,
  planejarEnvio,
  type AnexoPendente,
  type InsercaoRoteiro,
} from "@/lib/crm/roteirosChat";
import { BarraDigitacao } from "@/components/crm/conversas/BarraDigitacao";

const passo = (extra: Partial<Parameters<typeof midiasDoPasso>[0]> & { id?: string; roteiro_id?: string; ordem?: number; rotulo?: string | null } = {}) => ({
  id: extra.id ?? "p1",
  roteiro_id: extra.roteiro_id ?? "r1",
  ordem: extra.ordem ?? 1,
  tipo: extra.tipo ?? ("text" as const),
  rotulo: extra.rotulo ?? null,
  conteudo: extra.conteudo ?? "",
  media_url: extra.media_url ?? null,
  file_name: extra.file_name ?? null,
});
const roteiro = (id: string, stage: string, nome: string, ordem = 1) => ({ id, stage, funil: "geral", nome, descricao: null, ordem, ativo: true });

describe("roteiros no chat: passo → caixa de mensagem", () => {
  it("separa [IMAGEM:url] / [AUDIO:url] / [DOCUMENTO:url] do texto", () => {
    const r = extrairMidias("Oi!\n[IMAGEM:https://x.com/a.jpg]\n[AUDIO:https://x.com/b.mp3]\nTchau [DOCUMENTO:https://x.com/c.pdf?t=1]");
    expect(r.texto).toBe("Oi!\n\nTchau");
    expect(r.midias).toEqual([
      { tipo: "image", url: "https://x.com/a.jpg" },
      { tipo: "audio", url: "https://x.com/b.mp3" },
      { tipo: "document", url: "https://x.com/c.pdf?t=1" },
    ]);
  });

  it("troca {primeiro_nome}/{nome}/{{lead.first_name}} e vira anexo a mídia do passo e a do texto", () => {
    const ins = montarInsercao(
      [
        passo({ id: "a", conteudo: "Oi {primeiro_nome}, tudo bem? ({nome}) {{lead.first_name}}" }),
        passo({ id: "b", tipo: "image", media_url: "https://h/f.jpg", file_name: "fisico.jpg", conteudo: "veja [AUDIO:https://h/a.mp3]" }),
      ],
      { name: "maria clara souza", phone: "5531999" },
    );
    expect(ins.texto).toBe("Oi Maria, tudo bem? (maria clara souza) Maria\n\nveja");
    expect(ins.anexos.map((a) => [a.tipo, a.url, a.nome, a.passoId])).toEqual([
      ["image", "https://h/f.jpg", "fisico.jpg", "b"],
      ["audio", "https://h/a.mp3", "a.mp3", "b"],
    ]);
    expect(ins.passoIds).toEqual(["a", "b"]);
  });

  it("passo vazio é rascunho 'preencher' e não entra na inserção", () => {
    expect(passoParaPreencher(passo({ rotulo: "PREENCHER" }))).toBe(true);
    expect(passoParaPreencher(passo({ conteudo: "oi" }))).toBe(false);
    expect(passoParaPreencher(passo({ tipo: "image", media_url: "https://h/x.jpg" }))).toBe(false);
    expect(passoParaPreencher(passo({ tipo: "image" }))).toBe(true);
  });

  it("busca sem acento por nome e texto dos passos; etapa do contato primeiro", () => {
    const rs = [roteiro("1", "leads", "1º Contato"), roteiro("2", "contato", "Avaliação | Qual o Valor?"), roteiro("3", "agendado", "Confirmação final | 1h")];
    const ps = [passo({ roteiro_id: "3", conteudo: "Sua consulta é daqui a 1 hora" })];
    expect(filtrarRoteiros(rs, ps, "avaliacao valor").map((r) => r.id)).toEqual(["2"]);
    expect(filtrarRoteiros(rs, ps, "CONSULTA").map((r) => r.id)).toEqual(["3"]);
    expect(filtrarRoteiros(rs, ps, " ").length).toBe(3);
    const etapas = ["leads", "contato", "agendado", "compareceu", "fechou"];
    expect(ordenarRoteiros(rs, "agendado", etapas).map((r) => r.id)).toEqual(["3", "1", "2"]);
  });

  it("um anexo de imagem leva o texto como legenda; áudio e vários anexos: texto primeiro", () => {
    const img: AnexoPendente = { id: "i", tipo: "image", nome: "a.jpg", url: "u" };
    const aud: AnexoPendente = { id: "s", tipo: "audio", nome: "a.mp3", url: "v" };
    expect(planejarEnvio(" oi ", [img])).toEqual([{ tipo: "anexo", anexo: img, legenda: "oi" }]);
    expect(planejarEnvio("oi", [aud])).toEqual([{ tipo: "texto", texto: "oi" }, { tipo: "anexo", anexo: aud, legenda: "" }]);
    expect(planejarEnvio("", [img, aud]).map((a) => a.tipo)).toEqual(["anexo", "anexo"]);
    expect(planejarEnvio("oi", [])).toEqual([{ tipo: "texto", texto: "oi" }]);
  });
});

describe("caixa de mensagem com roteiro", () => {
  const montar = (insercao: InsercaoRoteiro | null) => {
    const onEnviar = vi.fn(async () => true);
    const onEnviarAnexo = vi.fn(async () => true);
    const onEnviado = vi.fn();
    const onAviso = vi.fn();
    const props = { enviando: false, anexando: false, onEnviar, onEnviarAnexo, onEnviado, onAviso };
    const r = render(<BarraDigitacao {...props} insercao={insercao} />);
    return { ...r, props, onEnviar, onEnviarAnexo, onEnviado, onAviso };
  };

  it("'Usar' joga texto + foto na caixa; Enter manda a foto com o texto de legenda e registra o passo", async () => {
    const ins = montarInsercao(
      [passo({ id: "p9", tipo: "image", media_url: "https://h/f.jpg", file_name: "f.jpg", conteudo: "Oi {primeiro_nome}" })],
      { name: "Ana", phone: "1" },
    );
    const { onEnviarAnexo, onEnviar, onEnviado } = montar(ins);
    const campo = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("Oi Ana"));
    expect(screen.getByAltText("f.jpg")).toBeTruthy();
    fireEvent.change(campo, { target: { value: "Oi Ana, revisado" } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    expect(onEnviar).not.toHaveBeenCalled();
    expect(onEnviarAnexo).toHaveBeenCalledWith(expect.objectContaining({ url: "https://h/f.jpg", tipo: "image" }), "Oi Ana, revisado");
    expect(onEnviado).toHaveBeenCalledWith(["p9"]);
    expect(campo.value).toBe("");
    expect(screen.queryByTestId("anexos-pendentes")).toBeNull();
  });

  it("segunda inserção soma à caixa (passo a passo) e variável sem preencher bloqueia o envio", async () => {
    const a = montarInsercao([passo({ id: "x", conteudo: "Primeiro" })], { name: "Ana", phone: "1" });
    const { rerender, props, onEnviar, onAviso } = montar(a);
    const campo = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("Primeiro"));
    const b = montarInsercao([passo({ id: "y", conteudo: "Sua avaliação é {data}" })], { name: "Ana", phone: "1" });
    rerender(<BarraDigitacao {...props} insercao={b} />);
    await waitFor(() => expect(campo.value).toBe("Primeiro\n\nSua avaliação é {data}"));
    expect(screen.getByRole("status").textContent).toContain("{data}");
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    expect(onEnviar).not.toHaveBeenCalled();
    expect(onAviso).toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "Primeiro\n\nSua avaliação é amanhã 10h" } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    expect(onEnviar).toHaveBeenCalledWith("Primeiro\n\nSua avaliação é amanhã 10h");
  });

  it("falha no envio do anexo: texto e anexo continuam na caixa", async () => {
    const ins = montarInsercao([passo({ id: "z", tipo: "audio", media_url: "https://h/a.mp3", conteudo: "Escuta" })], { name: "Ana", phone: "1" });
    const { onEnviar, onEnviarAnexo, onEnviado } = montar(ins);
    onEnviarAnexo.mockResolvedValueOnce(false);
    const campo = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("Escuta"));
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    expect(onEnviar).toHaveBeenCalledWith("Escuta"); // áudio não tem legenda: texto vai antes
    expect(onEnviado).not.toHaveBeenCalled();
    expect(screen.getByTestId("anexos-pendentes")).toBeTruthy();
  });
});
