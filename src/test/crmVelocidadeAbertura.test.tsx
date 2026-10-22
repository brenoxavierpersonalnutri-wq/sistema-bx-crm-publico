// Velocidade de abertura do /crm/conversas (22/10/2026): pré-carga da primeira página (lib/crm/preCarga),
// acesso da última visita no portão de login (lib/acessoGuardado) e pré-aquecimento das mensagens no toque.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ContatoCRM, MensagemCRM, NumeroConversa } from "@/lib/crm/conversas";
import type { EventosFonte, FonteConversas, PedidoPagina } from "@/lib/crm/fonteConversas";
import type { LinhaLista } from "@/lib/crm/listaPaginada";

const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
  key: (i: number) => [...memoria.keys()][i] ?? null,
  get length() { return memoria.size; },
});

let sessaoUsuario: string | null = "u1";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: sessaoUsuario ? { user: { id: sessaoUsuario } } : null } }) } },
}));

import { esquecerPreCarga, guardarOcultos, iniciarPreCargaConversas, lerOcultosGuardados, tomarPaginaPreCarregada } from "@/lib/crm/preCarga";
import { esquecerAcesso, guardarAcesso, lerAcessoGuardado, VALIDADE_ACESSO_MS } from "@/lib/acessoGuardado";
import { useConversas } from "@/hooks/useConversas";
import { esquecerBuscasWhatsApp, preAquecerConversa, useMensagensConversa } from "@/hooks/useMensagensConversa";

const NUM = "11111111-1111-4111-8111-111111111111";
const OCULTO = "22222222-2222-4222-8222-222222222222";
const contato = (i: number): ContatoCRM => ({
  id: `c${i}`, phone: `55319${String(i).padStart(8, "0")}`, numero_id: NUM, name: `Pessoa ${i}`, stage: "leads", tags: [],
  updated_at: "2026-10-01T10:00:00Z",
});
const hora = (i: number) => new Date(Date.UTC(2026, 9, 22, 12, 0, 0) - i * 60_000).toISOString();
const msg = (c: ContatoCRM, i: number): MensagemCRM => ({
  id: `m${c.id}-${i}`, contact_phone: c.phone, numero_id: c.numero_id, body: `texto ${i}`, created_at: hora(i), direction: "inbound",
  sender_type: "lead", status: null,
});
const linha = (i: number): LinhaLista => {
  const c = contato(i);
  return { contato: c, ultima: msg(c, i), nao_lidas: 0, ordem_em: hora(i), consultado_em: "2026-10-22T12:00:00.000Z" };
};
const BANCO = Array.from({ length: 80 }, (_, i) => linha(i));

function fonteFalsa(numeros: NumeroConversa[] = []) {
  const paginaConversas = vi.fn(async (p: PedidoPagina) => (p.desde ? [] : BANCO.slice(0, p.limite ?? 60)));
  const listarNumeros = vi.fn(async () => numeros);
  const mensagensDoContato = vi.fn(async (phone: string) => {
    const c = BANCO.find((l) => l.contato.phone === phone)!.contato;
    return [msg(c, 1), msg(c, 2)];
  });
  const f = {
    usuarioId: async () => "u1",
    listarNumeros,
    listarContatos: vi.fn(async () => []),
    mensagensRecentes: vi.fn(async () => [] as MensagemCRM[]),
    mensagensDoContato,
    paginaConversas,
    contadoresConversas: vi.fn(async () => null),
    assinar: (_e: EventosFonte) => () => undefined,
    enviarTexto: vi.fn(), enviarMidia: vi.fn(), importarHistorico: vi.fn(async () => 0), atualizarContato: async () => undefined,
  } as unknown as FonteConversas;
  return { f, paginaConversas, listarNumeros, mensagensDoContato };
}

beforeEach(() => {
  memoria.clear();
  esquecerPreCarga();
  esquecerBuscasWhatsApp();
  sessaoUsuario = "u1";
});

describe("pré-carga da primeira página", () => {
  it("fora de /crm/conversas não pede nada", async () => {
    const { f, paginaConversas } = fonteFalsa();
    iniciarPreCargaConversas("/crm/kanban", f);
    expect(tomarPaginaPreCarregada()).toBeNull();
    expect(paginaConversas).not.toHaveBeenCalled();
  });

  it("sem sessão não consulta o banco", async () => {
    sessaoUsuario = null;
    const { f, paginaConversas } = fonteFalsa();
    iniciarPreCargaConversas("/crm/conversas", f);
    expect(await tomarPaginaPreCarregada()).toBeNull();
    expect(paginaConversas).not.toHaveBeenCalled();
  });

  it("com os ocultos guardados, pede a página sem esperar crm_numeros, com a aba padrão", async () => {
    guardarOcultos("u1", [OCULTO]);
    const { f, paginaConversas } = fonteFalsa();
    iniciarPreCargaConversas("/crm/conversas", f);
    const pre = await tomarPaginaPreCarregada();
    expect(pre?.usuario).toBe("u1");
    expect(pre?.ocultos).toBe(OCULTO);
    expect(pre?.linhas).toHaveLength(60);
    const pedido = paginaConversas.mock.calls[0][0];
    expect(pedido.ocultos).toEqual([OCULTO]);
    expect(pedido.consulta).toEqual({ numeroId: null, atendente: "todos", filtro: "tudo", busca: "" });
    // uma vez só
    expect(tomarPaginaPreCarregada()).toBeNull();
  });

  it("useConversas usa a página pré-carregada: o banco é consultado UMA vez para a primeira página", async () => {
    const { f, paginaConversas, listarNumeros } = fonteFalsa();
    iniciarPreCargaConversas("/crm/conversas", f);
    const { result } = renderHook(() => useConversas(f, { paginada: true, preCarga: true }));
    await waitFor(() => expect(result.current.conversas.length).toBe(60));
    const primeiras = paginaConversas.mock.calls.filter(([p]) => !p.desde && !p.cursor && !p.chaves);
    expect(primeiras).toHaveLength(1);
    expect(listarNumeros).toHaveBeenCalledTimes(1);
    // os ocultos desta visita ficam para a próxima pré-carga
    await waitFor(() => expect(lerOcultosGuardados("u1")).toEqual([]));
  });

  it("ocultos mudaram desde a última visita: descarta a pré-carga e pede de novo com os certos", async () => {
    guardarOcultos("u1", []); // a pré-carga sai sem ocultos
    const numeros = [
      { id: NUM, chave: "closer", apelido: "Closer", telefone: null, tipo: "openwa", ativo: true },
      { id: OCULTO, chave: "grupos-1", apelido: "Grupos 1", telefone: null, tipo: "openwa", ativo: true, ocultar_em_conversas: true },
    ] as unknown as NumeroConversa[];
    const { f, paginaConversas } = fonteFalsa(numeros);
    iniciarPreCargaConversas("/crm/conversas", f);
    const { result } = renderHook(() => useConversas(f, { paginada: true, preCarga: true }));
    await waitFor(() => expect(result.current.conversas.length).toBe(60));
    const primeiras = paginaConversas.mock.calls.filter(([p]) => !p.desde && !p.cursor && !p.chaves);
    expect(primeiras).toHaveLength(2);
    expect(primeiras[1][0].ocultos).toEqual([OCULTO]);
    await waitFor(() => expect(lerOcultosGuardados("u1")).toEqual([OCULTO]));
  });

  it("sem a opção preCarga (Kanban, demo), a tela ignora o que foi pré-carregado", async () => {
    const { f, paginaConversas } = fonteFalsa();
    iniciarPreCargaConversas("/crm/conversas", f);
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas.length).toBe(60));
    expect(paginaConversas.mock.calls.filter(([p]) => !p.desde && !p.cursor && !p.chaves)).toHaveLength(2);
  });
});

describe("acesso da última visita (portão de login)", () => {
  const dados = { profile: { id: "u1", full_name: "Breno", approved: true, avatar_url: "x.png", tracking_token: "segredo" }, isAdmin: true, allowedModules: ["crm"] };

  it("guarda e lê o acesso do mesmo usuário, sem o tracking_token", () => {
    guardarAcesso("u1", dados);
    const a = lerAcessoGuardado("u1");
    expect(a?.isAdmin).toBe(true);
    expect(a?.allowedModules).toEqual(["crm"]);
    expect(a?.profile).toEqual({ id: "u1", full_name: "Breno", approved: true, avatar_url: "x.png" });
    expect([...memoria.values()].join()).not.toContain("segredo");
  });

  it("outro usuário não aproveita o acesso guardado", () => {
    guardarAcesso("u1", dados);
    expect(lerAcessoGuardado("u2")).toBeNull();
  });

  it("perfil de outro id ou sem perfil apaga em vez de guardar", () => {
    guardarAcesso("u1", dados);
    guardarAcesso("u1", { ...dados, profile: null });
    expect(lerAcessoGuardado("u1")).toBeNull();
  });

  it("acesso velho demais não abre o portão", () => {
    const antigo = new Date(Date.now() - VALIDADE_ACESSO_MS - 1000);
    guardarAcesso("u1", dados, antigo);
    expect(lerAcessoGuardado("u1")).toBeNull();
  });

  it("sair apaga o acesso de todos os usuários do aparelho", () => {
    guardarAcesso("u1", dados);
    guardarAcesso("u2", { ...dados, profile: { ...dados.profile, id: "u2" } });
    memoria.set("outra-coisa", "fica");
    esquecerAcesso();
    expect(lerAcessoGuardado("u1")).toBeNull();
    expect(lerAcessoGuardado("u2")).toBeNull();
    expect(memoria.get("outra-coisa")).toBe("fica");
  });

  it("conteúdo estranho no storage é ignorado", () => {
    memoria.set("auth:acesso:u1", "{lixo");
    expect(lerAcessoGuardado("u1")).toBeNull();
    memoria.set("auth:acesso:u1", JSON.stringify({ profile: { id: "u1", approved: "sim" }, isAdmin: true, allowedModules: [], salvoEm: new Date().toISOString() }));
    expect(lerAcessoGuardado("u1")).toBeNull();
  });
});

describe("pré-aquecimento das mensagens no toque", () => {
  // estável entre renders (é dependência do efeito que abre a conversa)
  const ouvir = () => () => undefined;

  it("abrir a conversa reaproveita o pedido feito no toque (um pedido só)", async () => {
    const { f, mensagensDoContato } = fonteFalsa();
    const c = BANCO[5].contato;
    preAquecerConversa(f, c.phone, NUM);
    preAquecerConversa(f, c.phone, NUM); // toque + mouseenter: não duplica
    expect(mensagensDoContato).toHaveBeenCalledTimes(1);
    const { result } = renderHook(() => useMensagensConversa(f, c.phone, ouvir, NUM));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));
    expect(mensagensDoContato).toHaveBeenCalledTimes(1);
  });

  it("sem toque antes, abre pedindo normalmente", async () => {
    const { f, mensagensDoContato } = fonteFalsa();
    const c = BANCO[6].contato;
    const { result } = renderHook(() => useMensagensConversa(f, c.phone, ouvir, NUM));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));
    expect(mensagensDoContato).toHaveBeenCalledTimes(1);
  });

  it("pré-aquecido há mais de 10 s não serve: pede de novo", async () => {
    const { f, mensagensDoContato } = fonteFalsa();
    const c = BANCO[7].contato;
    const agora = Date.now();
    const relogio = vi.spyOn(Date, "now").mockReturnValue(agora - 11_000);
    preAquecerConversa(f, c.phone, NUM); // feito "há 11 s"
    relogio.mockRestore();
    const { result } = renderHook(() => useMensagensConversa(f, c.phone, ouvir, NUM));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));
    expect(mensagensDoContato).toHaveBeenCalledTimes(2);
  });
});
