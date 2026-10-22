// Mais de um canal do YouTube: canal padrão no destino automático, canal escolhido na criação/reprise/semana,
// seletor só com 2+ canais; e "todo dia" contínuo rolando sempre 4 à frente.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { canalPadrao, decidirDestinoYt } from "../../supabase/functions/_shared/destinoYtAuto";
import { deLocalBrt, gerarDatas, planejarRolamento } from "../../supabase/functions/_shared/reprises";
import { canalPadraoYt, type ContaYoutube } from "@/lib/lives/youtube";
import { SeletorCanalYt } from "@/components/lives/SeletorCanalYt";

const FIT = { id: "11111111-1111-4111-8111-111111111111", titulo: "Fitness", status: "conectado" };
const IMP = { id: "22222222-2222-4222-8222-222222222222", titulo: "Implementação", status: "conectado" };

describe("canal padrão", () => {
  it("o marcado como padrão; sem marca, o primeiro conectado; desconectado nunca", () => {
    expect(canalPadrao([FIT, { ...IMP, padrao: true }])?.id).toBe(IMP.id);
    expect(canalPadrao([FIT, IMP])?.id).toBe(FIT.id);
    expect(canalPadrao([{ ...FIT, status: "desconectado", padrao: true }, IMP])?.id).toBe(IMP.id);
    expect(canalPadraoYt([FIT, { ...IMP, padrao: true }] as ContaYoutube[])?.id).toBe(IMP.id);
  });
  it("destino automático usa o padrão", () => {
    expect(decidirDestinoYt({ status: "rascunho", ligadaAWebinar: false, destinosYt: [], contas: [FIT, { ...IMP, padrao: true }] })).toMatchObject({ acao: "criar", conta: { id: IMP.id } });
  });
  it("canal escolhido manda, mesmo não sendo o padrão", () => {
    expect(decidirDestinoYt({ status: "rascunho", ligadaAWebinar: false, destinosYt: [], contas: [FIT, { ...IMP, padrao: true }], contaId: FIT.id })).toMatchObject({ acao: "criar", conta: { id: FIT.id } });
  });
  it("canal escolhido já está na live: não duplica; outro canal na live não impede o escolhido", () => {
    const base = { status: "rascunho", ligadaAWebinar: false, contas: [FIT, IMP] };
    expect(decidirDestinoYt({ ...base, destinosYt: [{ id: "d1", ativo: true, yt_conta_id: FIT.id }], contaId: FIT.id })).toMatchObject({ acao: "nada", motivo: "ja_tem" });
    expect(decidirDestinoYt({ ...base, destinosYt: [{ id: "d1", ativo: true, yt_conta_id: IMP.id }], contaId: FIT.id })).toMatchObject({ acao: "criar", conta: { id: FIT.id } });
  });
  it("canal escolhido desconectado = sem_conta (não cai em outro canal escondido)", () => {
    expect(decidirDestinoYt({ status: "rascunho", ligadaAWebinar: false, destinosYt: [], contas: [IMP], contaId: FIT.id })).toMatchObject({ motivo: "sem_conta" });
  });
});

describe("SeletorCanalYt", () => {
  it("com um canal não aparece; com dois, aparece com o padrão marcado", () => {
    const { container } = render(<SeletorCanalYt contas={[FIT] as ContaYoutube[]} valor={FIT.id} onChange={vi.fn()} />);
    expect(container.textContent).toBe("");
    render(<SeletorCanalYt contas={[FIT, { ...IMP, padrao: true }] as ContaYoutube[]} valor={IMP.id} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Canal do YouTube")).toHaveTextContent("Implementação (padrão)");
  });
});

describe("uma live por dia, contínua", () => {
  it("cria os próximos 4 dias e, a cada dia que passa, o tick cria o 5º (sempre 4 à frente)", () => {
    const inicio = deLocalBrt("2026-10-22T20:00")!;
    const g = gerarDatas({ frequenciaDias: 1, inicio, continua: true });
    expect(g.ok && g.datas.map((d) => d.toISOString())).toEqual(["2026-10-22T23:00:00.000Z", "2026-10-23T23:00:00.000Z", "2026-10-24T23:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
    const serie = { id: "s", frequencia_dias: 1, proxima_em: g.ok ? g.proxima!.toISOString() : "", janela: 4, ativa: true };
    // dia 22 aconteceu: sobram 3 futuras -> cria o dia 26
    const p = planejarRolamento(serie, 3, new Date("2026-10-23T00:30:00Z"));
    expect(p.criar.map((d) => d.toISOString())).toEqual(["2026-10-26T23:00:00.000Z"]);
    expect(p.proximaEm.toISOString()).toBe("2026-10-27T23:00:00.000Z");
  });
});
