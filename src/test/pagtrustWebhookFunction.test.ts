import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest, LIMITE_CORPO } from "../../functions/api/pagtrust/[segredo]";

// Nome válido no formato, mas que não é o da RPC (hash não bate).
const NOME_ERRADO = "wh" + "0".repeat(32);

function ctx(method: string, segredo: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return {
    request: new Request(`https://equipe.brenoxavier.com.br/api/pagtrust/${segredo}`, { method, body, headers }),
    params: { segredo },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Pages Function /api/pagtrust/[segredo]", () => {
  it("GET devolve 404 e não chama o Supabase", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const r = await onRequest(ctx("GET", NOME_ERRADO));
    expect(r.status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it("POST com nome que não bate o hash devolve 404 e não chama o Supabase", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const r = await onRequest(ctx("POST", NOME_ERRADO, "{}"));
    expect(r.status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it("POST com caminho fora do formato devolve 404", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const s of ["pagtrust_receber", "wh123", "../rpc/x"]) {
      expect((await onRequest(ctx("POST", s, "{}"))).status).toBe(404);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("corpo acima do limite: 404 antes de ler se o nome não bate (não vaza que o limite existe)", async () => {
    const grande = "x".repeat(LIMITE_CORPO + 1);
    const r = await onRequest(ctx("POST", NOME_ERRADO, grande));
    expect(r.status).toBe(404);
  });
});
