// "Ir ao vivo" sem destino não chama o servidor; Tela cheia sem a migração avisa o que falta.
import { describe, expect, it } from "vitest";
import { mensagemErroLayout, motivoSemDestino, MSG_DESTINOS_DESLIGADOS, MSG_SEM_DESTINO } from "@/lib/lives/irAoVivo";

describe("motivoSemDestino", () => {
  it("sem destino nenhum: pede para conectar YouTube, Facebook ou RTMP", () => {
    expect(motivoSemDestino([])).toBe(MSG_SEM_DESTINO);
    expect(MSG_SEM_DESTINO).toBe("Conecte um destino (YouTube, Facebook, RTMP) antes de ir ao vivo.");
  });
  it("com destinos todos desligados: pede para ligar um", () => {
    expect(motivoSemDestino([{ ativo: false }])).toBe(MSG_DESTINOS_DESLIGADOS);
  });
  it("com um destino ligado: libera", () => {
    expect(motivoSemDestino([{ ativo: false }, { ativo: true }])).toBeNull();
  });
});

describe("mensagemErroLayout", () => {
  it("CHECK antigo recusando tela-cheia vira aviso da migração", () => {
    expect(mensagemErroLayout("tela-cheia", { code: "23514", message: 'new row violates check constraint "live_rooms_layout_check"' })).toMatch(/20261028120000/);
  });
  it("outros erros passam como vieram", () => {
    expect(mensagemErroLayout("solo", { message: "sem permissão" })).toBe("sem permissão");
  });
});
