import { describe, it, expect, beforeEach, vi } from "vitest";
import { trackLeadQualificado } from "@/lib/novaavPixel";

describe("Lead / Lead_qualificado com versão da página", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/avaliacao/v3?utm_source=fb");
  });

  it("põe `versao` nos dois eventos quando a página manda", () => {
    const fbq = vi.fn();
    window.fbq = fbq as unknown as typeof window.fbq;
    trackLeadQualificado("avaliacao-v3");
    expect(fbq).toHaveBeenCalledWith("trackCustom", "Lead_qualificado", expect.objectContaining({ versao: "avaliacao-v3", status: "qualificado", utm_source: "fb" }));
    expect(fbq).toHaveBeenCalledWith("track", "Lead", expect.objectContaining({ versao: "avaliacao-v3" }));
  });

  it("sem versão o payload é o de sempre (sem a chave)", () => {
    const fbq = vi.fn();
    window.fbq = fbq as unknown as typeof window.fbq;
    trackLeadQualificado();
    const payload = fbq.mock.calls.find((c) => c[1] === "Lead")![2];
    expect(payload).not.toHaveProperty("versao");
    expect(payload.content_name).toBe("Agendamento Avaliacao");
  });
});
