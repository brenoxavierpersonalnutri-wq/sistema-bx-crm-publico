// Destino YouTube automático: toda live passa a ter o canal conectado como destino, sem clique e sem duplicar.
import { describe, expect, it } from "vitest";
import {
  adicionarContaNasLives, decidirDestinoYt, garantirDestinoYt, linhaDestinoYtAuto, SERVIDOR_YT_RTMPS,
} from "../../supabase/functions/_shared/destinoYtAuto";
import { precisaGarantirYt } from "@/lib/lives/youtube";

const CONTA = { id: "3ba6e45b-0000-4000-8000-000000000001", titulo: "Canal do Breno", status: "conectado" };

describe("decidirDestinoYt", () => {
  const base = { status: "rascunho", ligadaAWebinar: false, destinosYt: [], contas: [CONTA] };
  it("sala sem YouTube + conta conectada = criar", () => {
    expect(decidirDestinoYt(base)).toEqual({ acao: "criar", conta: CONTA });
  });
  it("já tem destino YouTube ligado = nada (nunca duplica)", () => {
    expect(decidirDestinoYt({ ...base, destinosYt: [{ id: "d1", ativo: true }] })).toEqual({ acao: "nada", motivo: "ja_tem" });
  });
  it("destino desligado: respeita (nada), mas o botão (ativar) religa em vez de criar outro", () => {
    expect(decidirDestinoYt({ ...base, destinosYt: [{ id: "d1", ativo: false }] })).toEqual({ acao: "nada", motivo: "ja_tem" });
    expect(decidirDestinoYt({ ...base, destinosYt: [{ id: "d1", ativo: false }], ativar: true })).toEqual({ acao: "ativar", destinoId: "d1" });
  });
  it("no ar, webinário ou sem conta conectada = nada", () => {
    expect(decidirDestinoYt({ ...base, status: "ao_vivo" })).toMatchObject({ motivo: "no_ar" });
    expect(decidirDestinoYt({ ...base, ligadaAWebinar: true })).toMatchObject({ motivo: "webinario" });
    expect(decidirDestinoYt({ ...base, contas: [] })).toMatchObject({ motivo: "sem_conta" });
    expect(decidirDestinoYt({ ...base, contas: [{ ...CONTA, status: "desconectado" }] })).toMatchObject({ motivo: "sem_conta" });
  });
  it("live encerrada também ganha (pode ir ao ar de novo)", () => {
    expect(decidirDestinoYt({ ...base, status: "encerrada" }).acao).toBe("criar");
  });
});

describe("linhaDestinoYtAuto", () => {
  it("ativo, Não listado, título da live, sem chave colada", () => {
    const l = linhaDestinoYtAuto({ id: "s1", titulo: "teste <b>" }, CONTA);
    expect(l).toMatchObject({
      room_id: "s1", tipo: "youtube", modo: "youtube_api", yt_conta_id: CONTA.id, yt_privacidade: "unlisted", ativo: true,
      yt_titulo: "teste b", rtmp_url: SERVIDOR_YT_RTMPS, chave_final: "conta conectada", nome: "YouTube · Canal do Breno",
    });
    expect(l).not.toHaveProperty("chave_cifrada");
  });
  it("título vazio vira 'Ao vivo' e longo é cortado em 100", () => {
    expect(linhaDestinoYtAuto({ id: "s", titulo: "" }, CONTA).yt_titulo).toBe("Ao vivo");
    expect(linhaDestinoYtAuto({ id: "s", titulo: "x".repeat(150) }, CONTA).yt_titulo).toHaveLength(100);
  });
});

/** Banco falso com as tabelas que o garantir lê/escreve. `conflito` simula o índice único (outra aba criou junto). */
function banco(o: { dests?: { id: string; ativo: boolean; room_id?: string }[]; webinars?: string[]; contas?: typeof CONTA[]; conflito?: boolean; salas?: { id: string; titulo: string; status: string }[] } = {}) {
  const inseridos: Record<string, unknown>[] = [];
  const atualizados: Record<string, unknown>[] = [];
  const dests = (o.dests ?? []).map((d) => ({ room_id: "s1", ...d }));
  const db = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const resultado = () => {
        if (tabela === "live_destinations") return dests.filter((d) => d.room_id === filtros.room_id).concat(inseridos.filter((d) => d.room_id === filtros.room_id) as never[]);
        if (tabela === "webinars") return (o.webinars ?? []).filter((r) => r === filtros.live_room_id).map((id) => ({ id }));
        if (tabela === "yt_contas") return o.contas ?? [CONTA];
        if (tabela === "live_rooms") return o.salas ?? [];
        return [];
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
        order: () => q,
        limit: () => q,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: resultado(), error: null }).then(ok),
        insert: (linha: Record<string, unknown>) => {
          if (o.conflito) return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
          inseridos.push({ id: `novo-${inseridos.length + 1}`, ...linha });
          return { select: () => ({ maybeSingle: async () => ({ data: { id: `novo-${inseridos.length}` }, error: null }) }) };
        },
        update: (patch: Record<string, unknown>) => {
          atualizados.push(patch);
          const u = { eq: () => u, then: (ok: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
          return u;
        },
      };
      return q;
    },
  };
  return { db, inseridos, atualizados };
}

describe("garantirDestinoYt", () => {
  it("cria uma vez; a segunda chamada (outra aba / reabrir o estúdio) não duplica", async () => {
    const b = banco();
    const sala = { id: "s1", titulo: "teste", status: "rascunho" };
    expect(await garantirDestinoYt(b.db, sala)).toMatchObject({ criado: true });
    expect(await garantirDestinoYt(b.db, sala)).toMatchObject({ criado: false, motivo: "ja_tem" });
    expect(b.inseridos).toHaveLength(1);
    expect(b.inseridos[0]).toMatchObject({ yt_privacidade: "unlisted", ativo: true, yt_titulo: "teste" });
  });
  it("corrida: o índice único recusa (23505) e vira 'já tem', não erro", async () => {
    const b = banco({ conflito: true });
    expect(await garantirDestinoYt(b.db, { id: "s1", titulo: "t", status: "rascunho" })).toEqual({ criado: false, ativado: false, destino_id: null, motivo: "ja_tem" });
  });
  it("sala de webinário não ganha YouTube sozinha", async () => {
    const b = banco({ webinars: ["s1"] });
    expect(await garantirDestinoYt(b.db, { id: "s1", titulo: "t", status: "rascunho" })).toMatchObject({ criado: false, motivo: "webinario" });
    expect(b.inseridos).toHaveLength(0);
  });
  it("botão com destino desligado: religa (update), não cria outro", async () => {
    const b = banco({ dests: [{ id: "d1", ativo: false }] });
    expect(await garantirDestinoYt(b.db, { id: "s1", titulo: "t", status: "rascunho" }, { ativar: true })).toMatchObject({ ativado: true, destino_id: "d1" });
    expect(b.inseridos).toHaveLength(0);
    expect(b.atualizados[0]).toMatchObject({ ativo: true });
  });
});

describe("adicionarContaNasLives (conta conectada agora)", () => {
  it("entra nas salas em rascunho sem YouTube e pula as que já têm", async () => {
    const b = banco({
      salas: [{ id: "s1", titulo: "A", status: "rascunho" }, { id: "s2", titulo: "B", status: "rascunho" }],
      dests: [{ id: "d9", ativo: true, room_id: "s2" }],
    });
    expect(await adicionarContaNasLives(b.db, CONTA)).toBe(1);
    expect(b.inseridos.map((d) => d.room_id)).toEqual(["s1"]);
  });
});

describe("precisaGarantirYt (estúdio)", () => {
  it("só no modo live, fora do ar e sem destino YouTube conectado", () => {
    expect(precisaGarantirYt("rascunho", [])).toBe(true);
    expect(precisaGarantirYt("rascunho", [{ modo: "manual" }])).toBe(true);
    expect(precisaGarantirYt("rascunho", [{ modo: "youtube_api" }])).toBe(false);
    expect(precisaGarantirYt("ao_vivo", [])).toBe(false);
    expect(precisaGarantirYt("rascunho", [], "gravacao")).toBe(false);
  });
});
