import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { interpretarStatusWhatsApp } from "@/hooks/useProvedorWhatsApp";

describe("interpretarStatusWhatsApp (OpenWA único provedor)", () => {
  it("resposta vazia, antiga ou com uazapi conta como openwa desconectado", () => {
    for (const d of [null, undefined, {}, { provider: "uazapi", connected: true, qr: "data:image/png;base64,AA" }]) {
      const s = interpretarStatusWhatsApp(d);
      expect(s.provider).toBe("openwa");
    }
    expect(interpretarStatusWhatsApp({}).connected).toBe(false);
  });

  it("lê status, telefone, QR em data URL e aviso", () => {
    expect(interpretarStatusWhatsApp({ provider: "openwa", connected: false, state: "qr_ready", qr: "data:image/png;base64,AAA", aviso: "x" }))
      .toEqual({ provider: "openwa", connected: false, state: "qr_ready", phone: null, qr: "data:image/png;base64,AAA", aviso: "x" });
    expect(interpretarStatusWhatsApp({ connected: true, state: "ready", phone: "5531999998888" }).connected).toBe(true);
  });

  it("QR que não é data URL de imagem é descartado", () => {
    expect(interpretarStatusWhatsApp({ qr: "javascript:alert(1)" }).qr).toBeNull();
    expect(interpretarStatusWhatsApp({ qr: "2@abc,def" }).qr).toBeNull();
  });

  it("erro da função vira aviso", () => {
    expect(interpretarStatusWhatsApp({ error: "Unauthorized" }).aviso).toBe("Unauthorized");
  });
});
