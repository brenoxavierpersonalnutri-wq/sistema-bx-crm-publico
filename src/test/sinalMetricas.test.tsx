import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Consultation } from "@/types/consultation";
import {
  FAIXAS_CONFIRMADAS,
  FAIXAS_FEITAS,
  calcularMetricasConsultas,
  dataEmSaoPaulo,
  referenciaDeFaixas,
  referenciaMeta,
  rotuloFaixa,
  proximoDiaUtil,
  rotuloDia,
  sinalConfirmadas,
  sinalFeitas,
} from "@/lib/sinalMetricas";
import { FluxoProximoDiaUtil } from "@/components/FluxoProximoDiaUtil";

afterEach(cleanup);

// Pedido do Breno, 14/10/2026: cor no "% das agendadas" de Consultas Feitas e
// no "% do total" de Call Confirmadas, mais o bloco do próximo dia útil.

describe("regra 1 — Consultas Feitas sobre agendadas", () => {
  it.each([
    [0, "vermelho"],
    [14, "vermelho"],
    [14.4, "vermelho"], // arredonda como o card: 14%
    [14.5, "laranja"], // card mostra 15%
    [15, "laranja"],
    [19, "laranja"],
    [20, "verde"],
    [25, "verde"],
    [25.4, "verde"], // card mostra 25%
    [25.5, "ouro"], // card mostra 26%
    [26, "ouro"],
    [100, "ouro"],
  ])("%s%% → %s", (pct, nivel) => {
    expect(sinalFeitas(pct)).toBe(nivel);
  });

  it("sem base (nenhuma agendada) não pinta", () => {
    expect(sinalFeitas(null)).toBeNull();
  });
});

describe("regra 2 — Call Confirmadas sobre o total", () => {
  it.each([
    [0, "vermelho"],
    [19, "vermelho"],
    [20, "laranja"],
    [29, "laranja"],
    [30, "amarelo"], // faixa suposta: o Breno não definiu 30–39
    [39, "amarelo"],
    [40, "verde"],
    [60, "verde"],
    [61, "ouro"],
    [100, "ouro"],
  ])("%s%% → %s", (pct, nivel) => {
    expect(sinalConfirmadas(pct)).toBe(nivel);
  });

  it("sem base não pinta", () => {
    expect(sinalConfirmadas(null)).toBeNull();
  });
});

describe("referência da meta (texto sempre visível)", () => {
  it("Consultas feitas: meta 20 a 25% das agendadas, ouro acima de 25%", () => {
    expect(referenciaMeta("feitas")).toEqual({
      meta: "Meta: 20 a 25%",
      ouro: "Ouro: > 25%",
      completa: "Meta: 20 a 25% das agendadas · acima de 25% é ouro",
    });
  });

  it("Call confirmadas: meta 40 a 60% do total, ouro acima de 60%", () => {
    expect(referenciaMeta("confirmadas")).toEqual({
      meta: "Meta: 40 a 60%",
      ouro: "Ouro: > 60%",
      completa: "Meta: 40 a 60% do total · acima de 60% é ouro",
    });
  });

  it("o texto sai dos limites: mudou a faixa, muda o texto", () => {
    const faixas = [
      { nivel: "vermelho" as const, min: -Infinity, max: 30, rotulo: "" },
      { nivel: "verde" as const, min: 30, max: 46, rotulo: "" },
      { nivel: "ouro" as const, min: 46, max: Infinity, rotulo: "" },
    ];
    expect(referenciaDeFaixas(faixas, "do total").completa).toBe("Meta: 30 a 45% do total · acima de 45% é ouro");
    expect(() => referenciaDeFaixas(faixas.slice(0, 2), "x")).toThrow();
  });

  it("legenda do tooltip gerada dos mesmos limites", () => {
    expect(FAIXAS_FEITAS.map((f) => f.rotulo)).toEqual(["abaixo de 15%", "15% a 19%", "20% a 25%", "acima de 25%"]);
    expect(FAIXAS_CONFIRMADAS.map((f) => f.rotulo)).toEqual([
      "abaixo de 20%",
      "20% a 29%",
      "30% a 39%",
      "40% a 60%",
      "acima de 60%",
    ]);
    expect(rotuloFaixa({ nivel: "verde", min: 20, max: 26 })).toBe("20% a 25%");
  });
});

describe("próximo dia útil em São Paulo", () => {
  // 2026-10-12 é segunda-feira. Horários em UTC; BRT = UTC−3.
  it.each([
    ["segunda → terça", "2026-10-12T15:00:00Z", "2026-10-13"],
    ["terça → quarta", "2026-10-13T15:00:00Z", "2026-10-14"],
    ["quarta → quinta", "2026-10-14T15:00:00Z", "2026-10-15"],
    ["quinta → sexta", "2026-10-15T15:00:00Z", "2026-10-16"],
    ["sexta → segunda", "2026-10-16T15:00:00Z", "2026-10-19"],
    ["sábado → segunda", "2026-10-17T15:00:00Z", "2026-10-19"],
    ["domingo → segunda", "2026-10-18T15:00:00Z", "2026-10-19"],
    // Meia-noite BRT
    ["quinta 23:59 BRT ainda é quinta → sexta", "2026-10-16T02:59:00Z", "2026-10-16"],
    ["sexta 00:00 BRT já é sexta → segunda", "2026-10-16T03:00:00Z", "2026-10-19"],
    ["sexta 23:59 BRT → segunda", "2026-10-17T02:59:00Z", "2026-10-19"],
    ["domingo 23:59 BRT → segunda", "2026-10-19T02:59:00Z", "2026-10-19"],
    ["segunda 00:00 BRT → terça", "2026-10-19T03:00:00Z", "2026-10-20"],
    // Virada de mês e de ano
    ["sexta 30/10 → segunda 02/11", "2026-10-30T15:00:00Z", "2026-11-02"],
    ["quinta 31/12 → sexta 01/01", "2026-12-31T15:00:00Z", "2027-01-01"],
  ])("%s", (_nome, agoraIso, esperado) => {
    expect(proximoDiaUtil(new Date(agoraIso))).toBe(esperado);
  });

  it("a data civil é a de São Paulo, não a UTC", () => {
    expect(dataEmSaoPaulo(new Date("2026-10-15T01:00:00Z"))).toBe("2026-10-14");
  });

  it("rótulo com dia da semana", () => {
    expect(rotuloDia("2026-10-15")).toBe("quinta-feira 15/10");
    expect(rotuloDia("2026-10-19")).toBe("segunda-feira 19/10");
  });
});

let seq = 0;
const consulta = (date: string, extra: Partial<Consultation> = {}): Consultation =>
  ({ id: `c${++seq}`, clientName: "Teste", clientPhone: "", date, status: "agendado", ...extra }) as Consultation;

describe("métricas compartilhadas com os cards", () => {
  it("agendadas exclui desqualificadas; confirmadas sobre o total; feitas sobre agendadas", () => {
    const lista = [
      consulta("2026-10-15", { callConfirmed: true, attended: true }),
      consulta("2026-10-15", { callConfirmed: true }),
      consulta("2026-10-15", { disqualified: true }),
      consulta("2026-10-15", { callConfirmed: true, refunded: true }), // reembolsada não conta
      consulta("2026-10-15", { callConfirmed: true, is_future_reschedule: true }), // excluída
    ];
    const m = calcularMetricasConsultas(lista);
    expect(m.total).toBe(5);
    expect(m.desqualificadas).toBe(1);
    expect(m.agendadas).toBe(4);
    expect(m.callConfirmadas).toBe(2);
    expect(m.feitas).toBe(1);
    expect(m.pctConfirmadasDoTotal).toBe(40);
    expect(m.pctFeitasSobreAgendadas).toBe(25);
  });

  it("lista vazia não divide por zero", () => {
    const m = calcularMetricasConsultas([]);
    expect(m.pctConfirmadasDoTotal).toBeNull();
    expect(m.pctFeitasSobreAgendadas).toBeNull();
  });
});

describe("bloco Fluxo do próximo dia útil", () => {
  it("mostra só o próximo dia útil, com as cores das regras", () => {
    // Agora: sexta 16/10 15h BRT → próximo útil = segunda 19/10.
    const lista = [
      ...Array.from({ length: 5 }, () => consulta("2026-10-19", { callConfirmed: true })),
      ...Array.from({ length: 5 }, () => consulta("2026-10-19")),
      consulta("2026-10-16", { callConfirmed: true, attended: true }), // hoje: fora
      consulta("2026-10-17", { callConfirmed: true }), // sábado: fora
    ];
    render(
      <TooltipProvider>
        <FluxoProximoDiaUtil consultations={lista} agora={new Date("2026-10-16T18:00:00Z")} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Fluxo do próximo dia útil — segunda-feira 19/10")).toBeInTheDocument();
    const bloco = screen.getByText(/Fluxo do próximo dia útil/).closest("[data-bloco]") as HTMLElement;
    expect(within(bloco).getByText("10")).toBeInTheDocument();
    const conf = within(bloco).getByText("50% do total");
    expect(conf).toHaveAttribute("data-sinal", "verde");
    const feitas = within(bloco).getByText("0% das agendadas");
    expect(feitas).toHaveAttribute("data-sinal", "vermelho");
    // Referência visível nas duas métricas com cor, não na de agendadas.
    const refs = bloco.querySelectorAll("[data-referencia]");
    expect(refs).toHaveLength(2);
    const refConf = bloco.querySelector('[data-referencia="confirmadas"]') as HTMLElement;
    expect(refConf).toHaveTextContent("Meta: 40 a 60%Ouro: > 60%");
    expect(refConf).toHaveAttribute("title", "Meta: 40 a 60% do total · acima de 60% é ouro");
    const refFeitas = bloco.querySelector('[data-referencia="feitas"]') as HTMLElement;
    expect(refFeitas).toHaveTextContent("Meta: 20 a 25%Ouro: > 25%");
    expect(refFeitas).toHaveAttribute("title", "Meta: 20 a 25% das agendadas · acima de 25% é ouro");
  });

  it("dia sem nenhuma consulta: badges neutros, sem cor", () => {
    render(
      <TooltipProvider>
        <FluxoProximoDiaUtil consultations={[]} agora={new Date("2026-10-14T15:00:00Z")} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Fluxo do próximo dia útil — quinta-feira 15/10")).toBeInTheDocument();
    expect(screen.getByText("0% do total")).toHaveAttribute("data-sinal", "sem-base");
  });
});
