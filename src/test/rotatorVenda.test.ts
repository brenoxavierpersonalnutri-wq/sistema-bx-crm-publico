import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extrairIdDoPedido,
  extrairMarcadorDoRotador,
  registrarCompraDoRotador,
} from "../../supabase/functions/pagtrust-webhook/rotatorVenda.ts";

const CLIQUE = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

// Formato 2.0.0 que os handlers já leem (data.purchase.full_price, data.buyer,
// data.commissions PRODUCER). Os campos de rastreio (origin.sck/src, tracking,
// utm) são SUPOSIÇÃO: o payload real da PagTrust não foi visto (nenhum fica
// gravado no banco; o handler só faz console.log).
function vendaAprovada(rastreio: Record<string, unknown>, transacao = "PT-123456") {
  return {
    id: "0b6e7c7e-1111-4222-8333-944455556666", // id do evento: uuid SEM cm_, não pode casar
    event: "PURCHASE_APPROVED",
    version: "2.0.0",
    creation_date: 1760356800000,
    data: {
      product: { id: 35209, ucode: "a1b2c3d4-aaaa-4bbb-8ccc-ddddeeeeffff", name: "Desafio Magra e Definida" },
      buyer: { email: "teste@example.com", checkout_full_phone: "5531999999999" },
      purchase: {
        transaction: transacao,
        status: "APPROVED",
        full_price: { value: 17, currency_value: "BRL" },
        price: { value: 17 },
        ...rastreio,
      },
      commissions: [{ source: "PRODUCER", value: 15.3 }],
    },
  };
}

describe("extrairMarcadorDoRotador", () => {
  it("acha em origin.sck (formato 2.0.0)", () => {
    expect(extrairMarcadorDoRotador(vendaAprovada({ origin: { sck: `cm_v3_${CLIQUE}` } }))).toEqual({ clickId: CLIQUE, variante: "v3" });
  });
  it("acha em origin.src e em utm_term com o termo do anúncio na frente", () => {
    expect(extrairMarcadorDoRotador(vendaAprovada({ origin: { src: `cm_v1_${CLIQUE}` } }))?.clickId).toBe(CLIQUE);
    const p = vendaAprovada({ tracking: { utm_source: "FB", utm_term: `Instagram_Reels|cm_v6_${CLIQUE}` } });
    expect(extrairMarcadorDoRotador(p)).toEqual({ clickId: CLIQUE, variante: "v6" });
  });
  it("acha dentro de URL de checkout codificada", () => {
    const url = `https://pay.pagtrust.com.br/fnc35209fa?utm_term=Reels%7Ccm_v2_${CLIQUE}`;
    expect(extrairMarcadorDoRotador({ checkout_url: url })?.clickId).toBe(CLIQUE);
    expect(extrairMarcadorDoRotador({ q: encodeURIComponent(`cm_v2_${CLIQUE}`) })?.clickId).toBe(CLIQUE);
  });
  it("marcador sem variação também vale", () => {
    expect(extrairMarcadorDoRotador({ sck: `cm_${CLIQUE.toUpperCase()}` })).toEqual({ clickId: CLIQUE, variante: null });
  });
  it("uuid solto (id do evento, ucode do produto) não é clique", () => {
    expect(extrairMarcadorDoRotador(vendaAprovada({}))).toBeNull();
    expect(extrairMarcadorDoRotador({ sck: CLIQUE })).toBeNull();
  });
  it("payload estranho não quebra", () => {
    expect(extrairMarcadorDoRotador(null)).toBeNull();
    expect(extrairMarcadorDoRotador("texto")).toBeNull();
    expect(extrairMarcadorDoRotador({ a: "%E0%A4%A" })).toBeNull();
    const ciclo: Record<string, unknown> = { a: 1 };
    ciclo.self = ciclo;
    expect(extrairMarcadorDoRotador(ciclo)).toBeNull();
  });
});

describe("extrairIdDoPedido", () => {
  it("transação do 2.0.0 antes do id do evento", () => {
    expect(extrairIdDoPedido(vendaAprovada({}, "HP999"))).toBe("HP999");
  });
  it("orderId e outros formatos", () => {
    expect(extrairIdDoPedido({ orderId: 4521 })).toBe("4521");
    expect(extrairIdDoPedido({ transaction: { id: "T-1" } })).toBe("T-1");
    expect(extrairIdDoPedido({ id: "evt" })).toBe("evt");
    expect(extrairIdDoPedido({})).toBeNull();
    expect(extrairIdDoPedido(null)).toBeNull();
  });
});

// Banco de mentira com a mesma regra do índice único (event_type, order_id).
function bancoFalso(cliques: string[], opcoes: { falharInsert?: boolean } = {}) {
  const eventos: Array<Record<string, unknown>> = [];
  const cliente = {
    eventos,
    from(tabela: string) {
      if (tabela === "rotator_clicks") {
        let alvo = "";
        const q = {
          select: () => q,
          eq: (_c: string, v: string) => { alvo = v; return q; },
          maybeSingle: async () => ({ data: cliques.includes(alvo) ? { click_id: alvo } : null, error: null }),
        };
        return q;
      }
      if (tabela === "rotator_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (opcoes.falharInsert) return { error: { code: "PGRST204", message: "column order_id does not exist" } };
            if (eventos.some((e) => e.event_type === row.event_type && e.order_id != null && e.order_id === row.order_id)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
            eventos.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada ${tabela}`);
    },
  };
  return cliente;
}

describe("registrarCompraDoRotador", () => {
  it("venda com marcador de clique existente grava purchase com valor e pedido", async () => {
    const db = bancoFalso([CLIQUE]);
    const r = await registrarCompraDoRotador(db, vendaAprovada({ origin: { sck: `cm_v4_${CLIQUE}` } }), 17);
    expect(r).toEqual({ status: "registrada", click_id: CLIQUE, order_id: "PT-123456", variante: "v4" });
    expect(db.eventos).toEqual([{ click_id: CLIQUE, event_type: "purchase", value: 17, page_url: null, order_id: "PT-123456" }]);
  });
  it("mesmo pedido de novo (reenvio ou segundo webhook) não duplica", async () => {
    const db = bancoFalso([CLIQUE]);
    const p = vendaAprovada({ origin: { sck: `cm_v4_${CLIQUE}` } });
    await registrarCompraDoRotador(db, p, 17);
    const r2 = await registrarCompraDoRotador(db, p, 17);
    const r3 = await registrarCompraDoRotador(db, JSON.parse(JSON.stringify(p)), 17);
    expect(r2.status).toBe("duplicada");
    expect(r3.status).toBe("duplicada");
    expect(db.eventos).toHaveLength(1);
  });
  it("pedido diferente do mesmo clique (order bump) entra como outra linha", async () => {
    const db = bancoFalso([CLIQUE]);
    await registrarCompraDoRotador(db, vendaAprovada({ origin: { sck: `cm_v4_${CLIQUE}` } }, "PT-1"), 17);
    await registrarCompraDoRotador(db, vendaAprovada({ origin: { sck: `cm_v4_${CLIQUE}` } }, "PT-2"), 9.9);
    expect(db.eventos.map((e) => e.order_id)).toEqual(["PT-1", "PT-2"]);
  });
  it("sem pedido no payload: chave de reserva por clique+valor, ainda idempotente", async () => {
    const db = bancoFalso([CLIQUE]);
    const p = { status: "approved", value: 17, sck: `cm_v1_${CLIQUE}` };
    const r1 = await registrarCompraDoRotador(db, p, 17);
    const r2 = await registrarCompraDoRotador(db, p, 17);
    expect(r1).toMatchObject({ status: "registrada", order_id: `sem-pedido:${CLIQUE}:17` });
    expect(r2.status).toBe("duplicada");
  });
  it("sem marcador ou clique desconhecido: não grava nada", async () => {
    const db = bancoFalso([]);
    expect(await registrarCompraDoRotador(db, vendaAprovada({}), 17)).toEqual({ status: "sem-marcador" });
    expect(await registrarCompraDoRotador(db, vendaAprovada({ origin: { sck: `cm_v1_${CLIQUE}` } }), 17)).toEqual({
      status: "clique-desconhecido",
      click_id: CLIQUE,
    });
    expect(db.eventos).toHaveLength(0);
  });
  it("erro do banco (ex.: migration ainda não rodou) vira status, nunca exceção", async () => {
    const r = await registrarCompraDoRotador(bancoFalso([CLIQUE], { falharInsert: true }), { sck: `cm_${CLIQUE}`, orderId: 1 }, 17);
    expect(r.status).toBe("erro");
    const quebrado = { from: () => { throw new Error("rede"); } };
    expect(await registrarCompraDoRotador(quebrado, { sck: `cm_${CLIQUE}` }, 17)).toEqual({ status: "erro", mensagem: "rede" });
  });
});

describe("cópias do rotatorVenda.ts nas três functions", () => {
  it("são idênticas e cada handler importa e chama só em venda aprovada", () => {
    const fn = path.resolve(__dirname, "../../supabase/functions");
    const original = readFileSync(path.join(fn, "pagtrust-webhook/rotatorVenda.ts"), "utf8");
    for (const pasta of ["pagtrust-webhook-2", "webhook-receiver"]) {
      expect(readFileSync(path.join(fn, pasta, "rotatorVenda.ts"), "utf8")).toBe(original);
    }
    for (const pasta of ["pagtrust-webhook", "pagtrust-webhook-2", "webhook-receiver"]) {
      const src = readFileSync(path.join(fn, pasta, "index.ts"), "utf8");
      expect(src).toMatch(/import \{ registrarCompraDoRotador \} from ["']\.\/rotatorVenda\.ts["']/);
      expect(src.match(/registrarCompraDoRotador\(/g)).toHaveLength(1);
    }
  });
});
