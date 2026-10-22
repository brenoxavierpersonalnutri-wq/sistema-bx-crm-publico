// Reprises em lote e recorrência: geração das datas (fuso de Brasília fixo), limite de 30, cota do YouTube,
// lote que para na cota sem quebrar, rolamento idempotente da recorrência contínua e cancelamento.
// Nada aqui fala com o YouTube: quem "cria" a reprise é uma função falsa.
import { describe, expect, it, vi } from "vitest";
import {
  cancelarVarias, criarLote, custoPorReprise, deLocalBrt, ehErroCota, ErroCotaReprise, estadoReprise, estimarCota, fimDoDiaBrt,
  formatarBrt, gerarDatas, lerPedidoReprise, MAX_REPRISES, paraLocalBrt, planejarRolamento, podeCancelarReprise, rolarSerie,
  sufixoData, tituloComSufixo, type DepsRolamento, type SerieReprise,
} from "../../supabase/functions/_shared/reprises";
import { previaReprises } from "@/lib/lives/reprises";

const AGORA = new Date("2026-10-21T12:00:00.000Z"); // 09:00 em Brasília
const iso = (d: Date) => d.toISOString();

describe("fuso de Brasília (UTC-3 fixo)", () => {
  it("datetime-local é lido como Brasília, não como o fuso do navegador", () => {
    expect(iso(deLocalBrt("2026-11-10T19:00")!)).toBe("2026-11-10T22:00:00.000Z");
    expect(iso(deLocalBrt("2026-11-10T23:30")!)).toBe("2026-11-11T02:30:00.000Z"); // vira o dia em UTC
    expect(paraLocalBrt("2026-11-11T02:30:00.000Z")).toBe("2026-11-10T23:30");
  });
  it("recusa data impossível ou incompleta", () => {
    expect(deLocalBrt("2026-02-31T10:00")).toBeNull();
    expect(deLocalBrt("2026-11-10")).toBeNull();
    expect(deLocalBrt("")).toBeNull();
    expect(deLocalBrt("2026-13-01T10:00")).toBeNull();
  });
  it("'até' vale o dia inteiro em Brasília", () => {
    expect(iso(fimDoDiaBrt("2026-12-31")!)).toBe("2027-01-01T02:59:59.999Z");
  });
  it("formatos para a tela e para o título", () => {
    expect(formatarBrt("2026-11-10T22:00:00.000Z")).toBe("ter, 10/11/2026 19:00");
    expect(sufixoData(new Date("2026-11-10T22:30:00.000Z"))).toBe("10/11 19h30");
    expect(tituloComSufixo("Aula de vendas", new Date("2026-11-10T22:00:00.000Z"))).toBe("Aula de vendas (10/11 19h)");
    const longo = tituloComSufixo("x".repeat(100), new Date("2026-11-10T22:00:00.000Z"));
    expect(longo).toHaveLength(100);
    expect(longo.endsWith("(10/11 19h)")).toBe(true);
  });
});

describe("gerarDatas", () => {
  const inicio = deLocalBrt("2026-11-10T19:00")!;
  it.each([1, 7, 14, 21, 30])("a cada %i dia(s): mesmo horário de parede em Brasília em todas", (f) => {
    const g = gerarDatas({ frequenciaDias: f, inicio, quantidade: 5 });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.datas).toHaveLength(5);
    g.datas.forEach((d, i) => {
      expect(d.getTime() - inicio.getTime()).toBe(i * f * 86_400_000);
      expect(paraLocalBrt(d).slice(11)).toBe("19:00");
    });
  });
  it("todo dia atravessando o fim do mês e do ano", () => {
    const g = gerarDatas({ frequenciaDias: 1, inicio: deLocalBrt("2026-12-30T20:00")!, quantidade: 4 });
    expect(g.ok && g.datas.map(paraLocalBrt)).toEqual(["2026-12-30T20:00", "2026-12-31T20:00", "2027-01-01T20:00", "2027-01-02T20:00"]);
  });
  it("até uma data (inclusiva)", () => {
    const g = gerarDatas({ frequenciaDias: 7, inicio, ate: fimDoDiaBrt("2026-12-01") });
    expect(g.ok && g.datas.map((d) => paraLocalBrt(d).slice(0, 10))).toEqual(["2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01"]);
  });
  it("limite de 30 por vez: recusa e diz o total", () => {
    expect(gerarDatas({ frequenciaDias: 1, inicio, quantidade: 30 }).ok).toBe(true);
    expect(gerarDatas({ frequenciaDias: 1, inicio, quantidade: 31 })).toEqual({ ok: false, motivo: "no máximo 30 reprises por vez (pediu 31)", total: 31 });
    const r = gerarDatas({ frequenciaDias: 1, inicio, ate: fimDoDiaBrt("2027-01-31") });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.total).toBe(83);
  });
  it("contínua cria só a janela (4) e devolve a próxima para o tick", () => {
    const g = gerarDatas({ frequenciaDias: 7, inicio, continua: true });
    expect(g.ok && g.datas).toHaveLength(4);
    expect(g.ok && g.continua).toBe(true);
    expect(g.ok && paraLocalBrt(g.proxima!)).toBe("2026-12-08T19:00");
  });
  it("erros: frequência fora da lista, final antes do início, sem fim escolhido", () => {
    expect(gerarDatas({ frequenciaDias: 3, inicio, quantidade: 2 }).ok).toBe(false);
    expect(gerarDatas({ frequenciaDias: 7, inicio, ate: fimDoDiaBrt("2026-11-01") }).ok).toBe(false);
    expect(gerarDatas({ frequenciaDias: 7, inicio }).ok).toBe(false);
  });
});

describe("lerPedidoReprise (edge)", () => {
  it("lista de datas: ordena, tira repetidas e valida", () => {
    const r = lerPedidoReprise({ datas: ["2026-11-12T22:00:00Z", "2026-11-10T22:00:00Z", "2026-11-10T22:00:30Z"] }, AGORA);
    expect(r.ok && r.p.datas.map(iso)).toEqual(["2026-11-10T22:00:00.000Z", "2026-11-12T22:00:00.000Z"]);
  });
  it("recusa data no passado, mais de 30 ou lista vazia", () => {
    expect(lerPedidoReprise({ datas: ["2026-10-21T11:00:00Z"] }, AGORA).ok).toBe(false);
    expect(lerPedidoReprise({ datas: Array.from({ length: 31 }, (_, i) => new Date(AGORA.getTime() + (i + 1) * 86_400_000).toISOString()) }, AGORA).ok).toBe(false);
    expect(lerPedidoReprise({ datas: [] }, AGORA).ok).toBe(false);
  });
  it("recorrência é recalculada no servidor (a lista da tela não manda)", () => {
    const r = lerPedidoReprise({ recorrencia: { frequencia_dias: 14, inicio: "2026-11-10T22:00:00Z", quantidade: 3 }, datas: ["2026-12-25T22:00:00Z"] }, AGORA);
    expect(r.ok && r.p.datas.map(iso)).toEqual(["2026-11-10T22:00:00.000Z", "2026-11-24T22:00:00.000Z", "2026-12-08T22:00:00.000Z"]);
    expect(r.ok && r.p.serie).toBeNull();
  });
  it("contínua vira série com a próxima data", () => {
    const r = lerPedidoReprise({ recorrencia: { frequencia_dias: 7, inicio: "2026-11-10T22:00:00Z", continua: true }, sufixo_data: true }, AGORA);
    expect(r.ok && r.p.serie).toEqual({ frequenciaDias: 7, proximaEm: new Date("2026-12-08T22:00:00Z"), janela: 4 });
    expect(r.ok && r.p.sufixoData).toBe(true);
  });
  it("formato antigo (uma data) continua aceito", () => {
    const r = lerPedidoReprise({ agendada_em: "2026-11-10T22:00:00Z" }, AGORA);
    expect(r.ok && r.p.datas).toHaveLength(1);
  });
});

describe("cota do YouTube", () => {
  it("custo por reprise: stream + broadcast + bind (1 cada); miniatura e playlist 50 cada", () => {
    expect(custoPorReprise({ miniatura: false, playlist: false })).toBe(3);
    expect(custoPorReprise({ miniatura: true, playlist: true })).toBe(103);
    expect(custoPorReprise({ miniatura: false, playlist: true, destinos: 2 })).toBe(106);
  });
  it("30 reprises com miniatura e playlist ainda cabem na cota diária (10.000), sem folga grande", () => {
    expect(estimarCota(MAX_REPRISES, { miniatura: true, playlist: true })).toMatchObject({ unidades: 3090, alto: false });
    expect(estimarCota(MAX_REPRISES, { miniatura: false, playlist: false }).unidades).toBe(90);
  });
  it("razões do Google que são cota", () => {
    expect(ehErroCota("quotaExceeded")).toBe(true);
    expect(ehErroCota("userRequestsExceedRateLimit")).toBe(true);
    expect(ehErroCota("forbidden")).toBe(false);
    expect(ehErroCota(undefined)).toBe(false);
  });
});

describe("criarLote", () => {
  const datas = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 10, 10 + i, 22)));
  it("cota acaba no meio: fica o que foi criado, o resto vai pra 'faltaram', sem exceção", async () => {
    let n = 0;
    const criar = vi.fn(async (d: Date) => {
      if (++n > 2) throw new ErroCotaReprise("cota diária do YouTube esgotada");
      return { room_id: `r${d.getUTCDate()}`, links: [], avisos: ["sem canal"] };
    });
    const r = await criarLote(datas, criar, 1);
    expect(r.criadas.map((c) => c.room_id)).toEqual(["r10", "r11"]);
    expect(r.faltaram).toHaveLength(4);
    expect(r.faltaram[0].motivo).toMatch(/cota/);
    expect(r.faltaram.slice(1).every((f) => /não tentei/.test(f.motivo))).toBe(true);
    expect(criar).toHaveBeenCalledTimes(3); // depois da cota não chama mais o YouTube
    expect(r.cotaEsgotou).toBe(true);
    expect(r.avisos).toEqual(["sem canal"]); // aviso repetido aparece uma vez
  });
  it("erro comum numa data não para as outras", async () => {
    const r = await criarLote(datas.slice(0, 3), async (d) => {
      if (d.getUTCDate() === 11) throw new Error("vídeo não está pronto");
      return { room_id: "x", links: [], avisos: [] };
    }, 3);
    expect(r.criadas).toHaveLength(2);
    expect(r.faltaram).toEqual([{ agendada_em: datas[1].toISOString(), motivo: "vídeo não está pronto" }]);
    expect(r.cotaEsgotou).toBe(false);
  });
});

describe("rolamento da recorrência contínua", () => {
  const serie = (o: Partial<SerieReprise> = {}): SerieReprise => ({ id: "s1", frequencia_dias: 7, proxima_em: "2026-11-17T22:00:00.000Z", janela: 4, ativa: true, ...o });

  it("completa a janela, no máximo 2 por tick", () => {
    const p = planejarRolamento(serie(), 1, AGORA);
    expect(p.criar.map(iso)).toEqual(["2026-11-17T22:00:00.000Z", "2026-11-24T22:00:00.000Z"]);
    expect(iso(p.proximaEm)).toBe("2026-12-01T22:00:00.000Z");
  });
  it("janela cheia: nada a criar", () => {
    expect(planejarRolamento(serie(), 4, AGORA).criar).toEqual([]);
  });
  it("tick ficou fora do ar: pula as datas que já passaram (nunca cria atrasada)", () => {
    const p = planejarRolamento(serie({ proxima_em: "2026-10-01T22:00:00.000Z" }), 3, AGORA);
    expect(p.criar.map(iso)).toEqual(["2026-10-22T22:00:00.000Z"]);
  });
  it("série parada, em espera de cota ou com frequência inválida: nada", () => {
    expect(planejarRolamento(serie({ ativa: false }), 0, AGORA).criar).toEqual([]);
    expect(planejarRolamento(serie({ tentar_depois: "2026-10-21T13:00:00Z" }), 0, AGORA).criar).toEqual([]);
    expect(planejarRolamento(serie({ frequencia_dias: 3 }), 0, AGORA).criar).toEqual([]);
  });

  /** Banco em memória: proxima_em com compare-and-set e o índice único (série, data). */
  function memoria(s: SerieReprise, futuras: number, falharEm?: string) {
    const estado = { proxima: s.proxima_em, criadas: [] as string[], tentarDepois: null as string | null };
    const deps: DepsRolamento = {
      contarFuturasAtivas: async () => futuras,
      reivindicar: async (_id, antiga, nova) => {
        await Promise.resolve(); // dois ticks intercalados
        if (estado.proxima !== antiga) return false;
        estado.proxima = nova;
        return true;
      },
      criar: async (_s, d) => {
        if (iso(d) === falharEm) throw new ErroCotaReprise("cota");
        if (estado.criadas.includes(iso(d))) return false;
        estado.criadas.push(iso(d));
        return true;
      },
      devolver: async (_id, deAgora, para) => {
        if (estado.proxima === deAgora) estado.proxima = para;
        estado.tentarDepois = "depois";
      },
    };
    return { estado, deps };
  }

  it("idempotente: dois ticks ao mesmo tempo não criam a mesma data duas vezes", async () => {
    const s = serie();
    const m = memoria(s, 2);
    const [a, b] = await Promise.all([rolarSerie(s, AGORA, m.deps), rolarSerie(s, AGORA, m.deps)]);
    expect([...a.criadas, ...b.criadas].sort()).toEqual(["2026-11-17T22:00:00.000Z", "2026-11-24T22:00:00.000Z"]);
    expect(m.estado.criadas).toHaveLength(2);
    expect(m.estado.proxima).toBe("2026-12-01T22:00:00.000Z");
  });
  it("rodar de novo com a janela cheia não cria nada", async () => {
    const s = serie();
    const m = memoria(s, 4);
    expect((await rolarSerie(s, AGORA, m.deps)).criadas).toEqual([]);
    expect(m.estado.proxima).toBe(s.proxima_em);
  });
  it("cota acabou: devolve o ponteiro para a data que faltou e adia", async () => {
    const s = serie();
    const m = memoria(s, 2, "2026-11-24T22:00:00.000Z");
    const r = await rolarSerie(s, AGORA, m.deps);
    expect(r.criadas).toEqual(["2026-11-17T22:00:00.000Z"]);
    expect(r.erro).toBe("cota");
    expect(m.estado.proxima).toBe("2026-11-24T22:00:00.000Z");
    expect(m.estado.tentarDepois).toBe("depois");
  });
});

describe("lista e cancelamento", () => {
  const futura = { id: "a", status: "rascunho", agendada_em: "2026-11-10T22:00:00Z" };
  it("estado de cada reprise", () => {
    expect(estadoReprise(futura, AGORA)).toBe("programada");
    expect(estadoReprise({ ...futura, reprise_cancelada_em: "x" }, AGORA)).toBe("cancelada");
    expect(estadoReprise({ ...futura, status: "ao_vivo" }, AGORA)).toBe("no_ar");
    expect(estadoReprise({ ...futura, status: "encerrada" }, AGORA)).toBe("realizada");
    expect(estadoReprise(futura, AGORA, "erro")).toBe("erro");
    expect(estadoReprise({ ...futura, agendada_em: "2026-10-01T22:00:00Z" }, AGORA)).toBe("passou");
  });
  it("só cancela a que ainda não começou", () => {
    expect(podeCancelarReprise(futura, AGORA)).toBe(true);
    expect(podeCancelarReprise({ ...futura, status: "ao_vivo" }, AGORA)).toBe(false);
    expect(podeCancelarReprise({ ...futura, reprise_cancelada_em: "x" }, AGORA)).toBe(false);
    expect(podeCancelarReprise({ ...futura, agendada_em: "2026-10-01T22:00:00Z" }, AGORA)).toBe(false);
  });
  it("cancelar todas as futuras: pula as passadas/no ar/já canceladas e junta avisos sem parar", async () => {
    const salas = [
      futura,
      { id: "b", status: "rascunho", agendada_em: "2026-11-17T22:00:00Z" },
      { id: "c", status: "encerrada", agendada_em: "2026-10-01T22:00:00Z" },
      { id: "d", status: "rascunho", agendada_em: "2026-11-24T22:00:00Z", reprise_cancelada_em: "x" },
      { id: "e", status: "rascunho", agendada_em: "2026-12-01T22:00:00Z" },
    ];
    const cancelarUma = vi.fn(async (s: { id: string }) => {
      if (s.id === "e") throw new Error("YouTube fora");
      return s.id === "b" ? "b: aviso" : null;
    });
    const r = await cancelarVarias(salas, AGORA, cancelarUma);
    expect(cancelarUma.mock.calls.map((c) => c[0].id).sort()).toEqual(["a", "b", "e"]);
    expect(r.canceladas.sort()).toEqual(["a", "b"]);
    expect(r.avisos).toEqual(expect.arrayContaining(["b: aviso", expect.stringMatching(/YouTube fora/)]));
  });
});

describe("pré-visualização na tela", () => {
  const base = { modo: "datas" as const, datas: [] as string[], freq: 7 as const, inicio: "", fim: "vezes" as const, ate: "", vezes: "8", agora: AGORA };
  it("datas avulsas, em ordem e sem repetidas", () => {
    const p = previaReprises({ ...base, datas: ["2026-11-12T19:00", "2026-11-10T19:00", "", "2026-11-10T19:00"] });
    expect(p.datas.map(paraLocalBrt)).toEqual(["2026-11-10T19:00", "2026-11-12T19:00"]);
    expect(p.erro).toBeNull();
  });
  it("data no passado aparece como erro", () => {
    expect(previaReprises({ ...base, datas: ["2026-10-20T19:00"] }).erro).toMatch(/futuro/);
  });
  it("recorrência: 8 vezes a cada 7 dias", () => {
    const p = previaReprises({ ...base, modo: "recorrencia", inicio: "2026-11-10T19:00" });
    expect(p.datas).toHaveLength(8);
    expect(paraLocalBrt(p.datas[7])).toBe("2026-12-29T19:00");
  });
  it("recorrência acima de 30 mostra o motivo, sem datas", () => {
    const p = previaReprises({ ...base, modo: "recorrencia", freq: 1, inicio: "2026-11-10T19:00", fim: "ate", ate: "2027-03-01" });
    expect(p.datas).toEqual([]);
    expect(p.erro).toMatch(/no máximo 30/);
  });
  it("sem fim: mostra as 4 que nascem agora", () => {
    const p = previaReprises({ ...base, modo: "recorrencia", inicio: "2026-11-10T19:00", fim: "sempre" });
    expect(p.datas).toHaveLength(4);
    expect(p.continua).toBe(true);
  });
});
