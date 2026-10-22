// Número fora de /crm/conversas (Grupos 1): some do seletor, das listas e dos contadores, sem apagar nada.
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { numeroOcultoEmConversas, type ContatoCRM, type MensagemCRM, type NumeroConversa } from "@/lib/crm/conversas";
import { useConversas } from "@/hooks/useConversas";
import type { FonteConversas } from "@/lib/crm/fonteConversas";

const PESSOAL = "11111111-1111-4111-8111-111111111111";
const GRUPOS1 = "22222222-2222-4222-8222-222222222222";

describe("numeroOcultoEmConversas", () => {
  it("coluna manda; sem a coluna, cai para a sessão grupos-N", () => {
    expect(numeroOcultoEmConversas({ ocultar_em_conversas: true, sessao_openwa: "closer" })).toBe(true);
    expect(numeroOcultoEmConversas({ ocultar_em_conversas: false, sessao_openwa: "grupos-1" })).toBe(false);
    expect(numeroOcultoEmConversas({ sessao_openwa: "grupos-1" })).toBe(true);
    expect(numeroOcultoEmConversas({ ocultar_em_conversas: null, sessao_openwa: "grupos-2" })).toBe(true);
    expect(numeroOcultoEmConversas({ sessao_openwa: "pessoal-breno" })).toBe(false);
    expect(numeroOcultoEmConversas({})).toBe(false);
  });
});

function fonte(numeros: NumeroConversa[]): FonteConversas {
  const c = (id: string, numero: string, phone: string): ContatoCRM =>
    ({ id, phone, numero_id: numero, name: phone, stage: "leads", tags: [], updated_at: "2026-10-01T10:00:00Z" });
  const contatos = [c("a", PESSOAL, "5531911111111"), c("b", GRUPOS1, "5531911111111"), c("g", GRUPOS1, "120363@g.us")];
  const msgs: MensagemCRM[] = contatos.map((x, i) => ({
    id: `m${i}`, contact_phone: x.phone, numero_id: x.numero_id, body: "oi", created_at: "2026-10-20T10:00:00Z",
    direction: "inbound", sender_type: "lead", status: null,
  }));
  return {
    usuarioId: async () => "t", listarNumeros: async () => numeros, listarContatos: async () => contatos,
    mensagensRecentes: async () => msgs, mensagensDoContato: async () => [],
    assinar: () => () => undefined, enviarTexto: vi.fn(), enviarMidia: vi.fn(),
    importarHistorico: async () => 0, atualizarContato: async () => undefined,
  } as unknown as FonteConversas;
}

describe("useConversas com número oculto", () => {
  const base = [
    { id: PESSOAL, chave: "pessoal-breno", apelido: "Pessoal Breno", sessao_openwa: "pessoal-breno" },
    { id: GRUPOS1, chave: "grupos-1", apelido: "Grupos 1", sessao_openwa: "grupos-1" },
  ];
  for (const [nome, grupos] of [
    ["pela coluna", { ocultar_em_conversas: true }],
    ["pelo fallback (banco sem a coluna)", {}],
  ] as const) {
    it(`${nome}: Grupos 1 sai do seletor e das conversas`, async () => {
      const f = fonte([base[0], { ...base[1], ...grupos }]);
      const { result } = renderHook(() => useConversas(f));
      await waitFor(() => expect(result.current.numeros.length).toBe(1));
      await waitFor(() => expect(result.current.conversas.length).toBe(1));
      expect(result.current.numeros.map((n) => n.apelido)).toEqual(["Pessoal Breno"]);
      expect(result.current.conversas.map((x) => x.contato.numero_id)).toEqual([PESSOAL]);
      expect(result.current.contatos).toHaveLength(1);
    });
  }
  it("sem nenhum oculto, tudo aparece", async () => {
    const f = fonte([base[0], { ...base[1], ocultar_em_conversas: false }]);
    const { result } = renderHook(() => useConversas(f));
    await waitFor(() => expect(result.current.numeros.length).toBe(2));
    await waitFor(() => expect(result.current.conversas.length).toBe(3));
  });
});
